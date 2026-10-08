// deno task push-agents [ke konza ...] [--dry-run]   (agent keys; none means all)
// --dry-run (K3, MED-283) builds every tool, webhook and agent body and prints a summary; it
// never calls ElevenLabs and never writes .env.
// Creates or updates the tool_secret secret, the webhook tools in agents/tools/, and each
// agent in agents/<country>/<agent>/ (agent.json + prompt.md, with the shared blocks in
// agents/blocks/ filled in). New agent ids go into .env.
//
// Every webhook tool gets three values the LLM never supplies:
//   conversation_id  from the system__conversation_id dynamic variable
//   agent_id         from the system__agent_id dynamic variable (the backend maps it to the
//                    authority; agent placeholders are not filled on phone calls)
//   x-tool-secret    header from the ElevenLabs secret `tool_secret`

import { eleven as liveEleven, env as liveEnv } from "./_eleven.ts";
import { findAgents } from "./agents.ts";
import { AUTHORITIES } from "../supabase/functions/_shared/authorities.ts";
import { ASR_KEYWORDS } from "../supabase/functions/_shared/lexicon.ts";
import {
  HUBS,
  KONZA_HUB_TOOLS,
  PUBLIC_TOOLS,
  SHARED_TOOLS,
} from "../supabase/functions/_shared/hubs.ts";

const ROOT = new URL("../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));
const DRY = Deno.args.includes("--dry-run");
/** SIA (K3, MED-283): identity and adjustments everywhere; the rest in the one concierge node. */
const CONCIERGE_BASE = ["identity_start_otp", "identity_check_otp", "record_adjustment"];
const only = Deno.args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());

/** In a dry run every request is recorded and answered with a stand-in; nothing leaves. */
const sent: { method: string; path: string; body?: any }[] = [];
function dryEleven(method: string, path: string, body?: unknown): Promise<any> {
  sent.push({ method, path, body });
  if (method === "GET") return Promise.resolve({ secrets: [], tools: [], webhooks: [] });
  if (path === "/secrets") return Promise.resolve({ secret_id: "dry-secret" });
  if (path === "/tools") {
    return Promise.resolve({ id: `dry-tool-${(body as any)?.tool_config?.name}` });
  }
  if (path.endsWith("/webhooks")) return Promise.resolve({ webhook_id: "dry-webhook" });
  if (path === "/agents/create") return Promise.resolve({ agent_id: "dry-agent" });
  return Promise.resolve({});
}
const eleven = DRY ? dryEleven : liveEleven;
const say = (m: string) => console.log(DRY ? `[dry run] would have: ${m}` : m);
const env = (k: string) => (DRY ? Deno.env.get(k) ?? `dry-${k}` : liveEnv(k));

// 1. Secret
const secrets = (await eleven("GET", "/secrets")).secrets ?? [];
let secretId = secrets.find((s: any) => s.name === "tool_secret")?.secret_id;
if (!secretId) {
  secretId = (await eleven("POST", "/secrets", {
    type: "new",
    name: "tool_secret",
    value: env("TOOL_SECRET"),
  })).secret_id;
  say("Created secret tool_secret");
}

// 2. Tools
const fnBase = `${env("SUPABASE_URL")}/functions/v1`;
const existingTools = (await eleven("GET", "/tools")).tools ?? [];
const toolIds: Record<string, string> = {};

for await (const f of Deno.readDir(new URL("agents/tools/", ROOT))) {
  if (!f.name.endsWith(".json")) continue;
  const t = JSON.parse(await read(`agents/tools/${f.name}`));
  const tool_config = {
    type: "webhook",
    name: t.name,
    description: t.description,
    response_timeout_secs: t.timeout_secs ?? 20,
    // Write tools finish even if the caller talks over them, so the agent always sees the result.
    ...(t.no_interrupt ? { interruption_mode: "disable_during_tool" } : {}),
    // Slow tools: say a short holding phrase first, so the caller is not left in silence.
    ...(t.pre_speech ? { force_pre_tool_speech: true } : {}),
    api_schema: {
      url: `${fnBase}/${t.function ?? `tools/${t.name}`}`,
      method: "POST",
      request_headers: { "x-tool-secret": { secret_id: secretId } },
      request_body_schema: {
        type: "object",
        description: "Tool arguments",
        properties: {
          conversation_id: { type: "string", dynamic_variable: "system__conversation_id" },
          agent_id: { type: "string", dynamic_variable: "system__agent_id" },
          ...t.params,
        },
        required: ["conversation_id", "agent_id", ...(t.required ?? [])],
      },
    },
  };
  const found = existingTools.find((x: any) => x.tool_config?.name === t.name);
  if (found) {
    await eleven("PATCH", `/tools/${found.id}`, { tool_config });
    toolIds[t.name] = found.id;
    say(`Updated tool ${t.name}`);
  } else {
    toolIds[t.name] = (await eleven("POST", "/tools", { tool_config })).id;
    say(`Created tool ${t.name}`);
  }
}

// 3. Call lifecycle webhooks (only attached to agents with "call_webhooks": true).
//    call_started: conversation initiation webhook, fires as the call connects.
//    call_ended: post-call transcription webhook, fires after the call.
//    Since P13 call_ended has its own secret (POSTCALL_SECRET). Webhook headers cannot be read
//    back, so the webhook that sends it has its own name. Push only after POSTCALL_SECRET is set
//    on the function and the function is deployed.
const postCallSecret = Deno.env.get("POSTCALL_SECRET");
const WEBHOOK_NAME = postCallSecret
  ? "gov-voice-demo call_ended (postcall secret)"
  : "gov-voice-demo call_ended";
const hooks = (await eleven("GET", "/v1/workspace/webhooks")).webhooks ?? [];
let postCallId = hooks.find((h: any) => h.name === WEBHOOK_NAME)?.webhook_id;
if (!postCallId) {
  postCallId = (await eleven("POST", "/v1/workspace/webhooks", {
    settings: {
      auth_type: "hmac",
      name: WEBHOOK_NAME,
      webhook_url: `${fnBase}/tools/call_ended`,
      request_headers: { "x-tool-secret": postCallSecret ?? env("TOOL_SECRET") },
    },
  })).webhook_id;
  say(`Created workspace webhook ${WEBHOOK_NAME}`);
}

// 4. Agents
const guardrails = await read("agents/blocks/guardrails.md");
const languageBlock = await read("agents/blocks/language.md");
const accessibilityBlock = await read("agents/blocks/accessibility.md");
const LANGUAGE_NAMES: Record<string, string> = { en: "English", sw: "Swahili", ar: "Arabic" };
let dotenv = DRY ? "" : await Deno.readTextFile(new URL(".env", ROOT));

for (const { dir, agent: a } of await findAgents()) {
  if (only.length && !only.includes(a.key)) continue;

  // Greeting language first. When it is not the main language (Swahili can only be a main
  // language), call_started starts each call in the greeting language.
  const greeting = AUTHORITIES[a.authority]?.default_language ?? a.language;
  const startsElsewhere = greeting !== a.language;
  const langs = [
    greeting,
    ...[a.language, ...(a.additional_languages ?? [])]
      .filter((l: string) => l !== greeting),
  ].map((l: string) => LANGUAGE_NAMES[l] ?? l);
  // "prompt_file" lets two agents share one prompt (Northfield in English and in Swahili).
  // A language twin ("source_dir") uses another agent's prompt and nodes, so they never drift.
  const prompt = (await read(a.prompt_file ?? `${a.source_dir ?? dir}/prompt.md`))
    .replace(
      "{language}",
      langs.length > 1
        ? languageBlock.replace("{default_language}", langs[0])
          .replace("{other_languages}", langs.slice(1).join(" and "))
        : "",
    )
    .replace(
      "{guardrails}",
      `${guardrails.replaceAll("{authority_name}", a.authority_name)}\n${accessibilityBlock}`,
    );
  // Every public agent can note adjustments (Wave 3 inclusive design). A country agent's base
  // tools are the ones allowed in every node; each service node adds its own (see hubWorkflow).
  // create_case is only in service nodes: in triage and wrap the model used it instead of
  // routing (Kenya calls and T1 on 1 Oct).
  const generic = !!(a.hub && HUBS[a.hub]?.generic);
  const tools: string[] = generic
    ? CONCIERGE_BASE
    : a.hub
    ? PUBLIC_TOOLS.filter((t) => t !== "capability_enter" && t !== "create_case")
    : [...new Set([...a.tools, "record_adjustment"])];
  const voices = [
    a.voice_id,
    ...Object.values<any>(a.language_presets ?? {}).map((p) => p.voice_id),
  ];
  if (!DRY && voices.some((v) => /^CHOOSE/.test(v ?? ""))) {
    throw new Error(
      `${a.key}: pick a voice first (voice_id is ${a.voice_id}; see docs/konza/voice.md)`,
    );
  }

  const builtIn: Record<string, unknown> = {};
  if (a.end_call) {
    builtIn.end_call = {
      type: "system",
      name: "end_call",
      description: "",
      params: { system_tool_type: "end_call" },
    };
  }
  if (a.language_detection) {
    builtIn.language_detection = {
      type: "system",
      name: "language_detection",
      description: "",
      params: { system_tool_type: "language_detection", ...a.language_detection },
    };
  }

  const platform_settings = a.call_webhooks
    ? {
      overrides: {
        enable_conversation_initiation_client_data_from_webhook: true,
        // Country agents also accept text-only sessions from the panel handset (P15 L2).
        ...(startsElsewhere || a.hub
          ? {
            conversation_config_override: {
              ...(startsElsewhere ? { agent: { language: true } } : {}),
              ...(a.hub ? { conversation: { text_only: true } } : {}),
            },
          }
          : {}),
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: {
          url: `${fnBase}/tools/call_started`,
          request_headers: { "x-tool-secret": { secret_id: secretId } },
        },
        webhooks: { post_call_webhook_id: postCallId, events: ["transcript"] },
      },
    }
    : undefined;

  const body = {
    name: a.name,
    ...(a.hub
      ? {
        workflow: generic
          ? await conciergeWorkflow(a, dir, toolIds)
          : await hubWorkflow(a, dir, toolIds),
      }
      : {}),
    platform_settings: {
      ...platform_settings,
      ...(a.call_limits ? { call_limits: a.call_limits } : {}),
      // Country agents only take browser calls through a signed URL from the panel (P14).
      ...(a.hub ? { auth: { enable_auth: true } } : {}),
      ...(a.privacy ? { privacy: a.privacy } : {}),
    },
    conversation_config: {
      agent: {
        first_message: a.first_message,
        language: a.language,
        prompt: {
          prompt,
          ...(a.llm ? { llm: a.llm } : {}),
          tool_ids: tools.map((n: string) => {
            if (!toolIds[n]) throw new Error(`${a.key}: unknown tool ${n}`);
            return toolIds[n];
          }),
          built_in_tools: builtIn,
        },
      },
      // Inclusive design: a longer wait before re-prompting and slightly slower speech on every
      // public agent (overridable per agent with "turn_timeout" and "speed").
      // K5: T1 showed audio tags ([calm], [gentle]) in replies; keep them out of what SIA says.
      tts: {
        model_id: a.tts_model,
        voice_id: a.voice_id,
        speed: a.speed ?? 0.95,
        expressive_mode: false,
      },
      turn: { turn_timeout: a.turn_timeout ?? 10 },
      // K5 (MED-303): the concierge also expects the shared English and Swahili lexicon.
      asr: a.asr_keywords || generic
        ? { keywords: [...new Set([...(a.asr_keywords ?? []), ...(generic ? ASR_KEYWORDS : [])])] }
        : undefined,
      language_presets: languagePresets(a),
    },
  };

  const envKey = `AGENT_ID_${a.key}`;
  const currentId = Deno.env.get(envKey);
  if (DRY) {
    const wf = (body as any).workflow;
    const nodeTools = Object.entries<any>(wf?.nodes ?? {}).map(([k, n]) =>
      `${k}:${(n.additional_tool_ids ?? []).length}`
    );
    console.log(JSON.stringify({
      dry_run: a.key,
      would: currentId ? "update" : "create",
      first_message_says_ai: /\bAI\b/.test(a.first_message) &&
        Object.values<any>(a.language_presets ?? {}).every((p) =>
          !p.first_message || /\bAI\b/.test(p.first_message)
        ),
      base_tools: tools,
      nodes: nodeTools,
      prompt_chars: prompt.length,
      prompt_has_unfilled: /\{(language|guardrails)\}/.test(prompt),
      voice: a.voice_id,
      tts_model: body.conversation_config.tts.model_id,
      asr_keywords: body.conversation_config.asr?.keywords?.length ?? 0,
      prompt_sections: [...prompt.matchAll(/^# (.+)$/gm)].map((m) => m[1]),
    }));
    continue;
  }
  if (currentId) {
    await eleven("PATCH", `/agents/${currentId}`, body);
    console.log(`Updated agent ${a.name}`);
  } else {
    const id = (await eleven("POST", "/agents/create", body)).agent_id;
    const line = `${envKey}=${id}`;
    dotenv = new RegExp(`^${envKey}=.*$`, "m").test(dotenv)
      ? dotenv.replace(new RegExp(`^${envKey}=.*$`, "m"), line)
      : `${dotenv.trimEnd()}\n${line}\n`;
    await Deno.writeTextFile(new URL(".env", ROOT), dotenv);
    console.log(`Created agent ${a.name}, id written to .env as ${envKey}`);
  }
}

/** Generic hub workflow: start, one concierge node with the service cards' tools, end. No node per
 * service: in P13 and P14 most defects were routing between nodes. */
async function conciergeWorkflow(a: any, dir: string, toolIds: Record<string, string>) {
  const id = (n: string) => {
    if (!toolIds[n]) throw new Error(`${a.key}: unknown tool ${n}`);
    return toolIds[n];
  };
  return {
    prevent_subagent_loops: false,
    nodes: {
      start_node: { type: "start", position: { x: 0, y: 0 }, edge_order: ["start_to_concierge"] },
      concierge: {
        type: "override_agent",
        label: "Concierge",
        entry_behavior: "auto",
        additional_prompt: await read(`${dir}/nodes/concierge.md`),
        additional_tool_ids: KONZA_HUB_TOOLS.filter((t) => !CONCIERGE_BASE.includes(t)).map(id),
        additional_knowledge_base: [],
        conversation_config: {},
        position: { x: 0, y: 160 },
        edge_order: ["concierge_to_end"],
      },
      end_node: { type: "end", position: { x: 0, y: 320 }, edge_order: [] },
    },
    edges: {
      start_to_concierge: {
        source: "start_node",
        target: "concierge",
        forward_condition: { type: "unconditional" },
      },
      concierge_to_end: {
        source: "concierge",
        target: "end_node",
        forward_condition: {
          type: "llm",
          condition: "The resident has nothing more and goodbye is said.",
          label: "Goodbye",
        },
      },
    },
  };
}

/** One preset per additional language. A preset may set its own voice, TTS model and first
 * message ("language_presets": {"sw": {"voice_id", "tts_model", "first_message"}}). */
function languagePresets(a: any) {
  const langs: string[] = a.additional_languages ?? [];
  return Object.fromEntries(langs.map((l) => {
    const p = a.language_presets?.[l] ?? {};
    const tts = {
      ...(p.voice_id ? { voice_id: p.voice_id } : {}),
      ...(p.tts_model ? { model_id: p.tts_model } : {}),
    };
    return [l, {
      overrides: {
        ...(Object.keys(tts).length ? { tts } : {}),
        ...(p.first_message ? { agent: { first_message: p.first_message } } : {}),
      },
    }];
  }));
}

/** Country agent workflow: triage, then per service a tool node that records the service
 * (capability_enter, fixed per node) and the service node; every service node can go back to
 * triage (another service) or on to wrap (done); wrap goes back to triage or ends. */
async function hubWorkflow(a: any, dir: string, toolIds: Record<string, string>) {
  const hub = HUBS[a.hub];
  const id = (n: string) => {
    if (!toolIds[n]) throw new Error(`${a.key}: unknown tool ${n}`);
    return toolIds[n];
  };
  const node = async (
    label: string,
    file: string,
    tools: string[],
    x: number,
    y: number,
    edges: string[],
    llm?: string,
    entry_behavior = "auto",
    scope?: string,
  ) => ({
    type: "override_agent",
    label,
    entry_behavior,
    additional_prompt: (await read(`${a.source_dir ?? dir}/nodes/${file}`)) + (scope ?? ""),
    additional_tool_ids: tools.map(id),
    additional_knowledge_base: [],
    conversation_config: llm ? { agent: { prompt: { llm } } } : {},
    position: { x, y },
    edge_order: edges,
  });
  const llmEdge = (source: string, target: string, condition: string, label: string) => ({
    source,
    target,
    forward_condition: { type: "llm", condition, label },
  });
  const caps = Object.keys(a.nodes);
  // Triage stays on the main model unless triage_llm names a different one.
  const triageLlm = a.triage_llm && a.triage_llm !== a.llm ? a.triage_llm : undefined;
  const nodes: Record<string, unknown> = {
    start_node: { type: "start", position: { x: 0, y: 0 }, edge_order: ["start_to_triage"] },
    triage: await node(
      "Triage",
      "triage.md",
      [],
      0,
      120,
      caps.map((c) => `triage_to_enter_${c}`),
      triageLlm,
    ),
    // Wrap speaks as soon as the call moves there: waiting for the caller left 10 s or more of
    // silence after "that will be all" (P14 handset calls). Its prompt avoids asking twice.
    wrap: await node("Wrap", "wrap.md", [], 0, 600, ["wrap_to_triage", "wrap_to_end"]),
    end_node: { type: "end", position: { x: 0, y: 760 }, edge_order: [] },
  };
  const edges: Record<string, unknown> = {
    start_to_triage: {
      source: "start_node",
      target: "triage",
      forward_condition: { type: "unconditional" },
    },
    wrap_to_triage: llmEdge(
      "wrap",
      "triage",
      "The caller asks for anything to be done, including going back to or finishing something from earlier in the call.",
      "Another topic",
    ),
    wrap_to_end: llmEdge(
      "wrap",
      "end_node",
      "The caller has nothing else and goodbye is said.",
      "Goodbye",
    ),
  };
  for (const [i, c] of caps.entries()) {
    const x = (i - (caps.length - 1) / 2) * 300;
    const n = a.nodes[c];
    if (!hub.capabilities[c]) throw new Error(`${a.key}: ${c} is not in HUBS.${a.hub}`);
    nodes[`enter_${c}`] = {
      type: "tool",
      tools: [{
        tool_id: id("capability_enter"),
        schema_overrides: { "request_body.capability": { source: "constant", constant_value: c } },
      }],
      position: { x, y: 280 },
      edge_order: [`enter_${c}_to_${c}`],
    };
    nodes[c] = await node(
      n.label,
      `${c}.md`,
      [...new Set(["create_case", ...SHARED_TOOLS, ...hub.capabilities[c].tools])],
      x,
      420,
      [
        `${c}_to_wrap`,
        ...caps.filter((o) => o !== c).map((o) => `${c}_to_enter_${o}`),
        `${c}_to_triage`,
      ],
      undefined,
      "auto",
      // Kenya T1 on 1 Oct: in the health node the model used shared tools (upload status,
      // create_case) for the lost ID step instead of switching.
      `\n# Scope\n- This step is only ${n.label.toLowerCase()}. If the caller asks for anything that belongs to another service (its photo, payment, appointment or case), call no tool for it: say you will switch to it now, and the call moves there.\n`,
    );
    edges[`triage_to_enter_${c}`] = llmEdge("triage", `enter_${c}`, n.when, n.label);
    edges[`enter_${c}_to_${c}`] = {
      source: `enter_${c}`,
      target: c,
      forward_condition: { type: "unconditional" },
    };
    edges[`${c}_to_wrap`] = llmEdge(
      c,
      "wrap",
      `The caller says they need nothing more with ${n.label.toLowerCase()} and has not asked for anything else.`,
      "Done",
    );
    // Second Kenya call: the caller went back to an unfinished step and the node stayed put.
    // Out of scope only; other services are reached directly (Kenya T1 on 1 Oct: going back
    // through triage, the model answered instead of routing and claimed a booking).
    edges[`${c}_to_triage`] = llmEdge(
      c,
      "triage",
      "The caller asks for something that is none of this line's services.",
      "Other request",
    );
    for (const o of caps.filter((o) => o !== c)) {
      edges[`${c}_to_enter_${o}`] = llmEdge(
        c,
        `enter_${o}`,
        `${
          a.nodes[o].when
        } This includes going back to it or finishing a step from it started earlier in the call.`,
        a.nodes[o].label,
      );
    }
  }
  return { prevent_subagent_loops: false, nodes, edges };
}

if (DRY) {
  const external = sent.filter((r) => r.method !== "GET").length;
  console.log(
    `Dry run: ${sent.length} requests built (${external} writes), none sent; .env untouched.`,
  );
}
