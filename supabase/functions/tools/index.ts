// One edge function for every tool: POST /tools/<tool_name>.
// Also receives ElevenLabs call lifecycle webhooks at /tools/call_started and /tools/call_ended.
// Every request must carry x-tool-secret (POSTCALL_SECRET for call_ended); conversation_id and
// agent_id are injected by ElevenLabs, never supplied by the LLM.
//
// Country agents (demo_agents.hub set, see _shared/hubs.ts) also get, in this file:
// - tool calls only for conversations that call_started opened (or local text tests),
// - the capability gate: capability_enter picks the service, which decides the authority, and
//   tools outside that service are refused,
// - held sessions: after an identity concern, writes and money tools are refused,
// - step-up: money and irreversible tools need identity checked in the last 5 minutes,
// - two-step writes: the first call returns a confirmation_id, a later call commits,
// - the speech layer on references (_shared/speech.ts).

import { audit } from "../_shared/audit.ts";
import { AUTHORITIES, authority } from "../_shared/authorities.ts";
import { type Agent, db, must, ToolError } from "../_shared/db.ts";
import { languageSwitches } from "../_shared/language.ts";
import { todayIn } from "../_shared/rules/common/dates.ts";
import { HUBS, STEP_UP_TOOLS, toolAllowed, TWO_STEP_TOOLS, WRITE_TOOLS } from "../_shared/hubs.ts";
import { agentFor, ensureConversation, STEP_UP_MS } from "../_shared/session.ts";
import { withSpeech } from "../_shared/speech.ts";
import { sameSecret } from "../_shared/secret.ts";
import { argsHash, twoStepCheck } from "../_shared/twostep.ts";
import { LANGUAGE_NAMES, sha256, str } from "../_shared/util.ts";
import { accessibility } from "./common/accessibility.ts";
import { calendar } from "./common/calendar.ts";
import { common } from "./common/common.ts";
import { idReplacement } from "./common/id_replacement.ts";
import { partners } from "./common/partners.ts";
import { isResidentApp } from "../_shared/outbound.ts";
import { chooseMethod, paymentReadBack, payByPin, payments } from "./common/payments.ts";
import type { ReadBack } from "../_shared/readback.ts";
import { readBackResults } from "../_shared/readback_check.ts";
import { refunds } from "./common/refunds.ts";
import { registry } from "./common/registry.ts";
import { uploads } from "./common/uploads.ts";
import { k1 } from "./ke/k1.ts";
import { kePassport } from "./ke/pp.ts";
import { n2 } from "./ke/n2.ts";
import { s3 } from "./ke/s3.ts";
import "./konza/checker.ts";
import "./konza/pay.ts";
import "./ke/refunds.ts";
import "./ke/u3.ts";
import { konzaApi } from "./konza/api.ts";
import { konzaTools } from "./konza/tools.ts";
import { AGENCIES } from "../_shared/konza/manifest.ts";
import { withoutLabels } from "../_shared/ui/catalog.ts";
import { emitFor, screenAudit, serviceOf } from "../_shared/ui/emit.ts";
import { SUBJECT_FIELD } from "../_shared/ui/options.ts";

export type ToolCtx = {
  conversationId: string;
  agent: Agent;
  args: Record<string, unknown>;
  /** Today in the authority's own time zone. */
  today: string;
};
export type Handler = (ctx: ToolCtx) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  ...common,
  ...calendar,
  ...accessibility,
  ...partners,
  ...payments,
  ...refunds,
  ...uploads,
  ...registry,
  ...s3,
  ...idReplacement,
  ...k1,
  ...kePassport,
  ...n2,
  ...konzaTools,
};

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Two-step writes. Returns a prepare reply, or null when this call is a valid commit. */
async function twoStep(
  conversationId: string,
  agent: Agent,
  tool: string,
  args: Record<string, unknown>,
  readback: ReadBack | null = null,
): Promise<Record<string, unknown> | null> {
  const prepared = await twoStepCheck(conversationId, tool, args, async (why) => {
    await audit(conversationId, agent.authority, "Rules", `Refused ${tool}: ${why}`, {
      result: "warn",
    });
    throw new ToolError(
      "confirmation_invalid",
      `The confirmation is not valid (${why}). Call ${tool} again without confirmation_id, read back, and ask for a clear yes.`,
    );
  });
  if (!prepared) return null;
  return {
    needs_confirmation: true,
    confirmation_id: prepared.confirmation_id,
    ...(readback ? { readback } : {}),
    next: `Nothing has happened yet. ${
      readback
        ? "Say readback.sw word for word if the caller speaks Swahili, otherwise readback.en, and ask for a clear yes."
        : `Read back exactly what ${tool} will do and ask for a clear yes.`
    } Only after the caller says yes, in their next turn, call ${tool} again with the same arguments and this confirmation_id.`,
  };
}

/** Country agents: gate, hold, step-up and two-step before the handler runs. Returns the agent
 * acting for the chosen service, or a reply to send instead of running the tool. */
async function hubGate(
  conversationId: string,
  agent: Agent,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ agent: Agent } | { reply: Record<string, unknown> }> {
  const hub = HUBS[agent.hub!];
  const conv = must(
    await db.from("conversations").select("capability, started_by_webhook, verified_at")
      .eq("id", conversationId).maybeSingle(),
  );
  const localTest = conversationId.startsWith("test-") &&
    Deno.env.get("ALLOW_TEST_CONVERSATIONS") === "1";
  if (!conv?.started_by_webhook && !localTest) {
    console.error(JSON.stringify({ tool, refused: "conversation_not_started" }));
    throw new ToolError(
      "unknown_conversation",
      "This call was not started properly. End politely.",
    );
  }
  if (!conv) await ensureConversation(conversationId, agent);

  // K2 Konza: the agency manifest decides which services exist; the card tells the assistant
  // the steps. Opening a service is how the caller moves between services.
  if (tool === "service_open" && hub.generic) {
    const agencyId = str(args.agency);
    const serviceId = str(args.service);
    const agency = Object.hasOwn(AGENCIES, agencyId) ? AGENCIES[agencyId] : undefined;
    if (!agency || !Object.hasOwn(agency.services, serviceId)) {
      throw new ToolError(
        "unknown_service",
        `No such service. Services: ${
          Object.values(AGENCIES).flatMap((a) =>
            Object.keys(a.services).map((s) => `${a.id}/${s} (${a.services[s].title})`)
          ).join(", ")
        }.`,
      );
    }
    const cap = `${agencyId}.${serviceId}`;
    must(await db.from("conversations").update({ capability: cap }).eq("id", conversationId));
    const owner = authority(agency.authority);
    await audit(conversationId, owner.id, "Service", `Service chosen: ${owner.name}`);
    const def = agency.services[serviceId];
    return {
      reply: {
        ok: true,
        service: cap,
        title: def.title,
        agency: agency.name,
        steps: def.card,
        rule_topics: Object.keys(def.topics),
        // K8 (MED-327): screen labels stay out of the agent's context.
        fields: withoutLabels(def.applicationSchema).properties,
        for_someone_else: def.consentScope ? `needs consent scope ${def.consentScope}` : "no",
      },
    };
  }

  if (tool === "capability_enter") {
    const cap = str(args.capability);
    if (!hub.capabilities[cap]) throw new ToolError("unknown_service", `No service ${cap}.`);
    must(await db.from("conversations").update({ capability: cap }).eq("id", conversationId));
    const owner = authority(hub.capabilities[cap].authority);
    await audit(conversationId, owner.id, "Service", `Service chosen: ${owner.name}`);
    return { reply: { ok: true, service: cap } };
  }

  const capability: string | null = conv?.capability ?? null;
  if (!toolAllowed(hub, capability, tool)) {
    await audit(
      conversationId,
      agent.authority,
      "Rules",
      `Blocked ${tool}: not part of ${capability ?? "any service yet"}`,
      { result: "warn" },
    );
    throw new ToolError(
      "wrong_service",
      "That is not part of the service you are helping with now. If the caller wants another service, say you will switch to it and let the workflow move on.",
    );
  }
  const acting: Agent = capability
    ? (() => {
      const owner = AUTHORITIES[
        hub.generic
          ? AGENCIES[capability.split(".")[0]].authority
          : hub.capabilities[capability].authority
      ];
      return { ...agent, authority: owner.id, authority_name: owner.name };
    })()
    : agent;

  if (WRITE_TOOLS.includes(tool)) {
    const held = must(
      await db.from("session_flags").select("conversation_id").eq("conversation_id", conversationId)
        .maybeSingle(),
    );
    if (held) {
      await audit(conversationId, acting.authority, "Rules", `Refused ${tool}: session held`, {
        result: "warn",
      });
      throw new ToolError(
        "session_held",
        "Nothing more can be changed on this call after the identity concern. An officer will follow up.",
      );
    }
  }
  if (STEP_UP_TOOLS.includes(tool) && conv?.verified_at) {
    if (Date.now() - new Date(conv.verified_at).getTime() >= STEP_UP_MS) {
      await audit(conversationId, acting.authority, "Identity", `Step-up needed for ${tool}`, {
        result: "warn",
      });
      throw new ToolError(
        "step_up",
        "This needs a fresh code because the last check was more than 5 minutes ago. Tell the caller, then use identity_start_otp and identity_check_otp again.",
      );
    }
  }
  if (TWO_STEP_TOOLS.includes(tool)) {
    if (!conv?.verified_at) {
      throw new ToolError(
        "not_verified",
        "This needs identity verification first. Use identity_start_otp, then identity_check_otp.",
      );
    }
    // K5 (MED-301): a payment prompt's read-back carries the rules total, before the yes.
    const readback = tool === "payment_request" && hub.generic && !str(args.confirmation_id)
      ? await paymentReadBack({
        conversationId,
        agent: acting,
        args,
        today: todayIn(authority(acting.authority).timezone),
      })
      : null;
    const prepare = await twoStep(conversationId, acting, tool, args, readback);
    if (prepare) return { reply: prepare };
  }
  return { agent: acting };
}

async function callStarted(body: Record<string, unknown>) {
  const conversationId = str(body.conversation_id);
  const agent = await agentFor(str(body.agent_id));
  const caller = str(body.caller_id);
  // ElevenLabs only allows Swahili as an agent's main language, not as a preset. An agent that
  // speaks Swahili but greets in English or Arabic has Swahili as its main language, and each
  // call starts in the authority's greeting language (that language's preset voice).
  const greeting = authority(agent.authority).default_language;
  const startIn = agent.language !== greeting ? greeting : null;
  if (conversationId) {
    await ensureConversation(conversationId, agent);
    // Marks the call as really started, and keeps only a hash of the calling number (for the
    // per-number code limit).
    must(
      await db.from("conversations").update({
        started_by_webhook: true,
        caller_hash: caller ? await sha256(`${caller}:${Deno.env.get("OTP_PEPPER") ?? ""}`) : null,
      }).eq("id", conversationId),
    );
  }
  return json({
    type: "conversation_initiation_client_data",
    dynamic_variables: {},
    ...(startIn ? { conversation_config_override: { agent: { language: startIn } } } : {}),
  });
}

async function callEnded(body: Record<string, any>) {
  if (body.type !== "post_call_transcription") return json({ ok: true });
  const d = body.data ?? {};
  const conversationId = str(d.conversation_id);
  const conv = must(
    await db.from("conversations").select("authority, language, ended_at").eq("id", conversationId)
      .maybeSingle(),
  );
  if (!conv || conv.ended_at) return json({ ok: true });
  const secs = Number(d.metadata?.call_duration_secs ?? 0);
  const started = Number(d.metadata?.start_time_unix_secs ?? 0);
  const switches = languageSwitches(d.transcript ?? [], conv.language);
  for (const s of switches) {
    await audit(
      conversationId,
      conv.authority,
      "Language",
      `${LANGUAGE_NAMES[s.from] ?? s.from} to ${LANGUAGE_NAMES[s.to] ?? s.to}`,
      started ? { ts: new Date((started + s.atSecs) * 1000).toISOString() } : {},
    );
  }
  // K5 (MED-302): did each asks-first commit follow a spoken read-back and a clear yes? Only the
  // result is kept (no transcript text); the checker's C8 reads it.
  const tapped = must(
    await db.from("confirmations").select("id, ui_tool").eq("conversation_id", conversationId)
      .eq("committed_via", "screen"),
  ) as { id: string; ui_tool: string }[];
  const readBacks = readBackResults(d.transcript ?? [], new Map(tapped.map((c) => [c.id, c.ui_tool])));
  if (readBacks.length) {
    const { error } = await db.from("konza_audit_events").insert(readBacks.map((r) => ({
      request_id: `call_ended:${conversationId}`,
      client: "sia",
      session: conversationId,
      agency: conv.authority,
      operation: `readBack:${r.tool}`,
      charter: "asks_first",
      outcome: r.ok ? "ok" : "missed",
      reason: r.screen
        ? "screen"
        : r.ok
        ? null
        : [...r.missing.map((k) => `no ${k}`), ...(r.yes ? [] : ["no yes"])].join(", "),
    })));
    if (error) {
      console.error(JSON.stringify({ call_ended: "readback_log_failed", error: error.message }));
    }
  }
  must(
    await db.from("conversations").update({
      ended_at: new Date(started ? (started + secs) * 1000 : Date.now()).toISOString(),
      duration_secs: secs,
      ...(switches.length ? { language: switches[switches.length - 1].to } : {}),
    }).eq("id", conversationId),
  );
  await audit(
    conversationId,
    conv.authority,
    "Call",
    `Call ended · ${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`,
  );
  return json({ ok: true });
}

class Refused extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(String(body.error));
  }
}

/** One tool call, from the agent (voice) or a tap (screen, through /tools/ui/act): the same gate,
 * the same handler, then the screen events. K8 (plan-k8 2.4): whichever yes comes first wins, so a
 * commit of a confirmation that is already done returns its stored result with already_done. */
async function runTool(
  conversationId: string,
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  via: "voice" | "screen",
): Promise<Record<string, unknown>> {
  // K0: only country agents remain; the old per-scenario path (no gate) is closed.
  if (!agent.hub) throw new Refused(403, { error: "forbidden" });
  if (!HANDLERS[name] && name !== "capability_enter" && name !== "service_open") {
    throw new Refused(404, { error: "unknown_tool" });
  }
  const confirmationId = str(args.confirmation_id);
  if (confirmationId) {
    const c = must(
      await db.from("confirmations").select("result, ui_tool, args").eq("id", confirmationId)
        .eq("conversation_id", conversationId).maybeSingle(),
    );
    if (c?.result) return { ...(c.result as Record<string, unknown>), already_done: true };
    // MED-331: a confirmation shown on a screen commits exactly what the card showed, whoever says
    // yes (a tap, or the agent after a tap or a form filled on screen, which it never sees).
    if (c?.ui_tool === name && c.args) args = { ...(c.args as Record<string, unknown>), confirmation_id: confirmationId };
  }

  const gate = await hubGate(conversationId, agent, name, args);
  if ("reply" in gate) {
    await emitFor(conversationId, name, args, gate.reply);
    return gate.reply;
  }
  const acting = gate.agent;
  const today = todayIn(authority(acting.authority).timezone);
  const result = await HANDLERS[name]({ conversationId, agent: acting, args, today });
  // The conversation's language, not the authority's default: SIA's default is Swahili, so English
  // sessions would get the reference rule in Swahili. On a screen the references are on cards.
  const conv = must(
    await db.from("conversations").select("language, channel").eq("id", conversationId).maybeSingle(),
  );
  const lang = conv?.language ?? authority(acting.authority).default_language;
  // Cards: the resident app only (the handset is a browser conversation without them).
  const screen = conv?.channel === "browser" && (await isResidentApp(conversationId));
  const out = withSpeech(result, lang, screen) as Record<string, unknown>;
  console.log(JSON.stringify({ tool: name, conversation_id: conversationId, ok: true, via }));
  // A commit (not a fresh prepare): keep its result so a later yes for the same confirmation, by
  // voice or tap, gets it back instead of a refusal.
  if (confirmationId && !out.needs_confirmation && !out.error) {
    must(
      await db.from("confirmations").update({ result: out, committed_via: via })
        .eq("id", confirmationId).eq("conversation_id", conversationId).is("result", null),
    );
    // C10: the arguments a screen commit actually ran with, hashed as its card's were when shown.
    if (via === "screen") {
      await screenAudit({
        conversationId,
        agency: acting.authority,
        op: "uiCommit",
        tool: name,
        confirmationId,
        outcome: "committed",
        hash: await argsHash(`ui:${name}`, args),
      });
    }
  }
  await emitFor(conversationId, name, args, out);
  return out;
}

/** K8 S2: taps from the resident app (web /api/resident/act, which resolves the conversation from
 * the session cookie and checks Origin and CSRF). Its own secret, never TOOL_SECRET. A confirm tap
 * commits the stored arguments only when the card it came from is the one recorded (shown_hash);
 * the 4 s minimum, expiry and single use apply as for a spoken yes. Refresh prepares again. The
 * identity card sends its code (identity_code) and the form card its fields (form_submit). */
async function uiAct(body: Record<string, unknown>): Promise<Response> {
  const conversationId = str(body.conversation_id);
  const action = str(body.action);
  const conv = must(
    await db.from("conversations").select("agent_id, channel").eq("id", conversationId).maybeSingle(),
  );
  if (!conv || conv.channel !== "browser") return json({ error: "unknown_conversation" }, 404);
  const agent = await agentFor(conv.agent_id);

  // MED-331: the code from the identity card, checked against this conversation's newest code.
  // The agent hears only that the resident is verified, never the code.
  if (action === "identity_code") {
    const code = str(body.code);
    if (!/^\d{6}$/.test(code)) return json({ error: "bad_request" }, 400);
    const v = must(
      await db.from("verifications").select("id").eq("conversation_id", conversationId)
        .is("verified_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    );
    if (!v) return json({ error: "unknown_verification" }, 404);
    return json(
      await runTool(conversationId, agent, "identity_check_otp", { verification_id: v.id, code }, "screen"),
    );
  }
  // MED-331: the form card prepares the application, exactly as the agent's call would; the new
  // confirm card then waits for a tap or a spoken yes.
  if (action === "form_submit") {
    const raw = body.fields;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return json({ error: "bad_request" }, 400);
    }
    // MED-333: the child the form names goes as on_behalf_of, as the agent's call sends it; a
    // single choice for a list field (documents) becomes a list.
    const { [SUBJECT_FIELD]: child, ...fields } = raw as Record<string, unknown>;
    const conv = must(
      await db.from("conversations").select("capability").eq("id", conversationId).maybeSingle(),
    );
    const svc = serviceOf(conv?.capability ?? null);
    for (const [k, v] of Object.entries(fields)) {
      if (svc?.def.applicationSchema?.properties?.[k]?.type === "array" && !Array.isArray(v)) fields[k] = [v];
    }
    try {
      return json(
        await runTool(
          conversationId,
          agent,
          "application_submit",
          { fields_json: JSON.stringify(fields), ...(str(child) ? { on_behalf_of: str(child) } : {}) },
          "screen",
        ),
      );
    } catch (e) {
      // A child's form with no consent yet: the consent is prepared here, as a slot pick prepares
      // the booking, so the child's number never reaches the agent. Its card is the consent
      // variant; after its yes the app sends the form again.
      if (!(e instanceof ToolError) || e.code !== "consent_required" || !str(child) || !svc?.def.consentScope) {
        throw e;
      }
      const consent = await runTool(
        conversationId,
        agent,
        "consent_record",
        { subject: str(child), scopes: svc.def.consentScope },
        "screen",
      );
      return json({ ...(consent as Record<string, unknown>), consent_for_form: true });
    }
  }

  // MED-332: the payment card. The method (card or mobile money) is chosen with a tap; a card's code
  // is typed (or read aloud to the agent, payment_confirm); mobile money's PIN is typed only and goes
  // no further than the check. The agent hears ids and outcomes only.
  // The same gate as the agent's payment_confirm (hold, chosen service, step-up), and the agent
  // acting for the service, whose charge rules apply.
  const payGate = action === "pay_method" || action === "pay_pin"
    ? await hubGate(conversationId, agent, "payment_confirm", {})
    : null;
  if (payGate && "reply" in payGate) return json(payGate.reply, 409);
  const payAgent = payGate && "agent" in payGate ? payGate.agent : agent;
  if (action === "pay_method") {
    const out = await chooseMethod(conversationId, payAgent, str(body.payment_id), str(body.method_id));
    await emitFor(conversationId, "payment_method", {}, out);
    return json(out);
  }
  if (action === "pay_code") {
    const code = str(body.code);
    if (!/^\d{6}$/.test(code)) return json({ error: "bad_request" }, 400);
    return json(await runTool(conversationId, agent, "payment_confirm", { code }, "screen"));
  }
  if (action === "pay_pin") {
    const pin = str(body.pin);
    if (!/^\d{4,6}$/.test(pin)) return json({ error: "bad_request" }, 400);
    const out = await payByPin(conversationId, payAgent, pin);
    await emitFor(conversationId, "payment_pin", {}, out);
    return json(out);
  }

  // MED-332: a day and window picked on the slots card prepare appointment_book, exactly as the
  // agent's call would (the rules check the day); its confirm card then waits for a tap or a yes.
  if (action === "slot_pick") {
    const date = str(body.date);
    const window = str(body.window);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["morning", "afternoon"].includes(window)) {
      return json({ error: "bad_request" }, 400);
    }
    return json(await runTool(conversationId, agent, "appointment_book", { window, on_date: date }, "screen"));
  }

  const c = must(
    await db.from("confirmations").select("id, ui_tool, args, shown_hash, result")
      .eq("id", str(body.confirmation_id)).eq("conversation_id", conversationId).maybeSingle(),
  );
  if (!c?.ui_tool) return json({ error: "unknown_confirmation" }, 404);

  if (action === "refresh") {
    return json(await runTool(conversationId, agent, c.ui_tool, { ...(c.args ?? {}) }, "screen"));
  }
  if (action !== "confirm") return json({ error: "unknown_action" }, 400);
  if (c.result) return json({ ...(c.result as Record<string, unknown>), already_done: true });
  if (!c.shown_hash || str(body.shown_hash) !== c.shown_hash) {
    await audit(conversationId, agent.authority, "Rules", `Refused screen confirm: card changed`, {
      result: "warn",
    });
    await screenAudit({
      conversationId,
      agency: agent.authority,
      op: "uiTap",
      tool: c.ui_tool,
      confirmationId: c.id,
      outcome: "refused:card_changed",
      hash: /^[0-9a-f]{64}$/.test(str(body.shown_hash)) ? str(body.shown_hash) : null,
    });
    return json({
      error: "card_changed",
      message: "What you tapped is no longer what is being confirmed. Refresh to see it again.",
    }, 409);
  }
  await audit(conversationId, agent.authority, "Rules", `Confirmed on screen: ${c.ui_tool}`);
  await screenAudit({
    conversationId,
    agency: agent.authority,
    op: "uiTap",
    tool: c.ui_tool,
    confirmationId: c.id,
    outcome: "accepted",
    hash: c.shown_hash,
  });
  return json(
    await runTool(conversationId, agent, c.ui_tool, { ...(c.args ?? {}), confirmation_id: c.id }, "screen"),
  );
}

Deno.serve(async (req) => {
  // K2: the Konza API profile (REST) shares this function and checks its own credentials.
  const konza = new URL(req.url).pathname.match(/\/konza\/v1(\/.*)$/);
  if (konza) return await konzaApi(req, konza[1]);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // K8 S2: taps from the resident app, with their own secret (UI_ACT_SECRET).
  if (new URL(req.url).pathname.endsWith("/ui/act")) {
    if (!sameSecret(req.headers.get("x-ui-act-secret"), Deno.env.get("UI_ACT_SECRET"))) {
      return json({ error: "forbidden" }, 403);
    }
    try {
      return await uiAct((await req.json().catch(() => null)) ?? {});
    } catch (e) {
      if (e instanceof Refused) return json(e.body, e.status);
      if (e instanceof ToolError) return json({ error: e.code, message: e.message, ...e.extra }, 409);
      console.error(JSON.stringify({ ui_act: "fatal", error: String(e) }));
      return json({ error: "act_failed", message: "That could not be done. Nothing has changed." }, 500);
    }
  }
  const name = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  // The post-call webhook has its own secret; until it is set, it falls back to the tool secret.
  const expected = name === "call_ended"
    ? Deno.env.get("POSTCALL_SECRET") ?? Deno.env.get("TOOL_SECRET")
    : Deno.env.get("TOOL_SECRET");
  if (!sameSecret(req.headers.get("x-tool-secret"), expected)) {
    return json({ error: "forbidden" }, 403);
  }
  const body = (await req.json().catch(() => null)) ?? {};

  try {
    if (name === "call_started") return await callStarted(body);
    if (name === "call_ended") return await callEnded(body);

    const { conversation_id, agent_id, ...args } = body;
    const conversationId = str(conversation_id);
    if (!conversationId) return json({ error: "missing_conversation_id" }, 400);
    return json(await runTool(conversationId, await agentFor(str(agent_id)), name, args, "voice"));
  } catch (e) {
    if (e instanceof Refused) return json(e.body, e.status);
    if (e instanceof ToolError) {
      console.log(JSON.stringify({ tool: name, error: e.code }));
      return json({ error: e.code, message: e.message, ...e.extra });
    }
    console.error(JSON.stringify({ tool: name, fatal: String(e) }));
    return json({
      error: "tool_failed",
      message:
        "The system could not complete this. Tell the caller plainly and offer a case for an officer to call back.",
    });
  }
});
