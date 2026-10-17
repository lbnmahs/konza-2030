// K8 S2 (MED-330, plan-k8 2.2): the one mapper from tool results to ui/v1 screen events. Only
// the backend writes events, after a gate reply or a handler result, and only for conversations
// with a screen (the resident app's browser sessions). The builders live in drafts.ts.

import { db, must } from "../db.ts";
import { AGENCIES } from "../konza/manifest.ts";
import { todayIn } from "../rules/common/dates.ts";
import {
  appointmentDays,
  DESKS,
  nairobiDay,
  REVIEW_ANSWER_WORKING_DAYS,
  reviewAskBy,
  WINDOW_HOURS,
} from "../rules/konza/rules.ts";
import type { ReadBack } from "../readback.ts";
import { argsHash, CONFIRM_MIN_GAP_MS } from "../twostep.ts";
import { str } from "../util.ts";
import {
  confirmDraft,
  type Draft,
  formDraft,
  identityDraft,
  paymentDraft,
  type PaymentMethod,
  type PaymentState,
  progressDraft,
  quoteDraft,
  receiptDraft,
  shownHash,
  slotsDraft,
} from "./drafts.ts";
import { formFields } from "./catalog.ts";
import { needsResident, withOptions } from "./options.ts";

/** The service in a capability ("sps.passport_renewal"), or null. Here and not in drafts.ts:
 * the manifest's agencies open the database client on import. */
export function serviceOf(capability: string | null) {
  if (!capability) return null;
  const [agencyId, serviceId] = capability.split(".");
  const agency = Object.hasOwn(AGENCIES, agencyId) ? AGENCIES[agencyId] : undefined;
  const def = agency && Object.hasOwn(agency.services, serviceId) ? agency.services[serviceId] : undefined;
  return def ? { capability, def } : null;
}

const CONFIRM_TITLES: Record<string, string> = {
  application_submit: "Confirm application",
  review_request: "Ask for a review",
  payment_request: "Confirm payment",
  appointment_book: "Confirm appointment",
  consent_record: "Confirm consent",
  consent_withdraw: "Withdraw consent",
};

/** Every asks-first tool SIA has gets a title (MED-331: delivery_book showed only "Confirm"). */
const confirmTitle = (tool: string, args: Record<string, unknown>) =>
  tool === "delivery_book"
    ? str(args.method) === "collect" ? "Confirm collection" : "Confirm delivery"
    : tool === "delivery_change"
    ? str(args.to) === "collect" ? "Change to collection" : "Change to home delivery"
    : CONFIRM_TITLES[tool] ?? "Confirm";

/** Stores events in order; each gets the conversation's next seq. Never throws into a tool reply:
 * a screen that misses an event still has the voice, and Refresh re-prepares. */
export async function store(conversationId: string, drafts: Draft[]): Promise<void> {
  for (const d of drafts) {
    const { error } = await db.rpc("ui_event_append", {
      p_conversation_id: conversationId,
      p_kind: d.kind,
      p_payload: d.payload,
    });
    if (error) console.error(JSON.stringify({ ui_emit: "failed", kind: d.kind, error: error.message }));
  }
}

/** plan-k8 2.5.5: one konza_audit_events row per card shown, tap and screen commit. Ids and hashes
 * only, never free text: the confirmation id in request_id, a hash in request_hash, the channel in
 * reason. C8 and C10 (audit/checks.ts) read them. Never throws into a tool reply. */
export async function screenAudit(r: {
  conversationId: string;
  agency: string;
  op: "uiShown" | "uiTap" | "uiCommit";
  tool: string;
  confirmationId: string;
  outcome: string;
  hash?: string | null;
}): Promise<void> {
  const { error } = await db.from("konza_audit_events").insert({
    request_id: r.confirmationId,
    client: "sia",
    session: r.conversationId,
    agency: r.agency,
    operation: `${r.op}:${r.tool}`,
    charter: "asks_first",
    outcome: r.outcome,
    reason: "screen",
    request_hash: r.hash ?? null,
  });
  if (error) console.error(JSON.stringify({ screen_audit: "failed", op: r.op, error: error.message }));
}

/** True for conversations with a screen (the resident app binds them as channel browser). */
export async function hasScreen(conversationId: string): Promise<boolean> {
  const row = must(
    await db.from("conversations").select("channel").eq("id", conversationId).maybeSingle(),
  );
  return row?.channel === "browser";
}

/** What the core has recorded for this resident and service (the rail shows nothing else): the
 * verified resident's latest application, as applicant or subject, from any conversation (a
 * renewal applied for on an earlier call is where they are), or this
 * conversation's before verification. citizen_id comes from the conversation, never the model. */
async function recorded(
  conversationId: string,
  capability: string,
  verifiedAt: string | null,
  citizenId: string | null,
) {
  const [agency, service] = capability.split(".");
  const base = db.from("konza_applications").select("id, created_at").eq("agency", agency)
    .eq("service", service);
  const app = must(
    await (citizenId && verifiedAt
      ? base.or(`applicant_citizen_id.eq.${citizenId},subject_citizen_id.eq.${citizenId}`)
      : base.eq("session", conversationId))
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  );
  const decision = app
    ? must(
      await db.from("konza_decisions").select("created_at, decided_at, decided_by").eq("application_id", app.id)
        .maybeSingle(),
    )
    : null;
  return { verified_at: verifiedAt, submitted_at: app?.created_at ?? null, decision };
}

/** The card a confirmation showed, now done (the yes came by voice or by a tap). */
async function doneCard(conversationId: string, confirmationId: string): Promise<Draft | null> {
  const shown = must(
    await db.from("ui_events").select("payload").eq("conversation_id", conversationId).eq("kind", "confirm")
      .eq("payload->>confirmation_id", confirmationId).order("seq", { ascending: false }).limit(1)
      .maybeSingle(),
  );
  return shown ? { kind: "confirm", payload: { ...shown.payload, state: "done" } } : null;
}

/** The events for one tool reply or result. Records the shown confirmation (tool, arguments and
 * hash) so a tap can commit exactly it. */
export async function emitFor(
  conversationId: string,
  tool: string,
  args: Record<string, unknown>,
  out: Record<string, unknown>,
): Promise<void> {
  try {
    if (!(await hasScreen(conversationId))) return;
    const conv = must(
      await db.from("conversations").select("capability, verified_at, authority, citizen_id").eq("id", conversationId)
        .maybeSingle(),
    );
    const svc = serviceOf(conv?.capability ?? null);
    const drafts: Draft[] = [];
    const rail = async () =>
      svc
        ? [progressDraft(svc.capability, svc.def.title, await recorded(conversationId, svc.capability, conv?.verified_at ?? null, conv?.citizen_id ?? null))]
        : [];
    // A commit (not a prepare, not a refusal): the shown card turns done, then the rail.
    const committed = str(args.confirmation_id) && !out.error && !out.needs_confirmation;
    if (committed) {
      const done = await doneCard(conversationId, str(args.confirmation_id));
      if (done) drafts.push(done);
      drafts.push(...await rail());
    }

    // The payment card (MED-331 reference, MED-332 methods): shown when the payment starts on a
    // screen, then after each choice, code or PIN, from the stored row, never from the model.
    // delivery_change closes a payment card waiting on the old amount (AD-07): it shows as closed.
    const paymentTools = ["payment_request", "payment_method", "payment_confirm", "payment_pin", "delivery_change"];
    if (paymentTools.includes(tool) && str(out.payment_id) && !out.needs_confirmation) {
      const pay = must(
        await db.from("payments").select(
          "id, amount, description, code_expires_at, created_at, status, method, method_id, code_tries, txn_code, citizen_id",
        ).eq("id", str(out.payment_id)).eq("conversation_id", conversationId).maybeSingle(),
      );
      const state = !pay
        ? null
        : pay.status === "approved"
        ? "approved"
        : pay.status === "declined"
        ? "declined"
        : pay.status === "expired"
        ? "expired"
        : ({ screen: "choose", screen_card: "code", screen_mobile: "pin", phone_code: "waiting" } as Record<
          string,
          PaymentState
        >)[pay.method] ?? null;
      if (pay && state) {
        const agency = svc ? AGENCIES[svc.capability.split(".")[0]] : undefined;
        const methods = ["choose", "code", "pin"].includes(state)
          ? must(
            await db.from("payment_methods").select("id, type, masked").eq("citizen_id", pay.citizen_id)
              .order("type"),
          ) as PaymentMethod[]
          : [];
        drafts.push(paymentDraft({
          id: pay.id,
          state,
          amount_kes: Number(pay.amount),
          description: str(pay.description) || "Fee",
          expires_at: pay.code_expires_at ?? pay.created_at,
          desk: agency?.desk ?? "a desk",
          methods,
          method_id: pay.method_id,
          attempts_left: Math.max(0, 3 - Number(pay.code_tries ?? 0)),
          reference: pay.txn_code,
        }));
      }
    }

    // A returning resident's own application (rules_lookup my_application): its decision card with
    // the reference, so "the reference is on your screen" is true.
    const mine = (out.values ?? {}) as Record<string, unknown>;
    if (tool === "rules_lookup" && str(args.topic) === "my_application" && str(mine.ref)) {
      const app = must(
        await db.from("konza_applications").select("id, ref").eq("ref", str(mine.ref)).maybeSingle(),
      );
      const d = app
        ? must(
          await db.from("konza_decisions").select("id, outcome, decided_by, rule_ids, reason_en, reason_sw, next_en, decided_at, created_at")
            .eq("application_id", app.id).maybeSingle(),
        )
        : null;
      if (app && d) {
        drafts.push(receiptDraft({
          ...d,
          ref: app.ref,
          review: {
            panel: "Aminia Review Panel",
            ask_by: reviewAskBy(nairobiDay(d.decided_at ?? d.created_at)),
            free: true,
            answer_within_working_days: REVIEW_ANSWER_WORKING_DAYS,
          },
        }));
      }
    }

    // MED-332: the slots card once the next step is the in-person appointment: right after the fee
    // is paid on screen, or when the resident's application shows it paid and not booked. Days and
    // windows come from the rules (PP-03); a pick prepares appointment_book (slot_pick).
    const ap = svc?.def.appointment;
    const v = (out.values ?? {}) as Record<string, unknown>;
    const paidNow = (tool === "payment_confirm" || tool === "payment_pin") && out.status === "approved";
    const unbooked = tool === "rules_lookup" && str(args.topic) === "my_application" &&
      v.outcome === "granted" && v.paid === true && v.biometrics == null;
    if (ap && (paidNow || unbooked)) {
      drafts.push(slotsDraft({
        title: ap.title,
        title_sw: ap.title_sw,
        place: (DESKS as Record<string, { name: string }>)[ap.desk]?.name ?? ap.desk,
        days: appointmentDays(todayIn("Africa/Nairobi")),
        hours: WINDOW_HOURS,
      }));
    }

    // The service's form with the choices the backend fills (MED-333, ui/options.ts). No form for a
    // verified resident whose application is still in progress: the core would refuse it
    // (application_open), and the form would read as a fresh start; none for a
    // month already paid (formDone); and one whose choices come from the resident's own records
    // waits for the identity check.
    const form = async (): Promise<Draft[]> => {
      const schema = svc?.def.applicationSchema;
      if (!svc || !schema) return [];
      const citizen = conv?.verified_at && conv.citizen_id ? conv.citizen_id : null;
      const open = citizen && svc.def.openApplication
        ? await svc.def.openApplication({ id: citizen } as never).catch(() => null)
        : null;
      const done = citizen && svc.def.formDone
        ? await svc.def.formDone({ id: citizen } as never).catch(() => false)
        : false;
      if (open || done) return [];
      const fields = await withOptions(formFields(schema), schema, {
        consentScope: svc.def.consentScope,
        citizenId: citizen,
      });
      return fields ? [formDraft(svc.capability, svc.def.title, schema, fields)] : [];
    };

    if (tool === "service_open" && out.ok && svc) {
      drafts.push(...await rail());
      drafts.push(...await form());
    } else if (tool === "rules_lookup" && svc && !out.error) {
      const q = quoteDraft(`${svc.def.title}: fees`, out as never, svc.def.applicationSchema);
      if (q) drafts.push(q);
    } else if (tool === "identity_start_otp" && out.code_sent) {
      const v = str(out.verification_id)
        ? must(
          await db.from("verifications").select("expires_at").eq("id", str(out.verification_id))
            .maybeSingle(),
        )
        : null;
      drafts.push(identityDraft("code", { channel: str(out.channel) || "sms", expires_at: v?.expires_at }));
    } else if (tool === "identity_check_otp" && out.verified) {
      drafts.push(identityDraft("verified"));
      drafts.push(...await rail());
      // A form that needed the resident's own records (a child, a business) can show now.
      if (svc?.def.applicationSchema && needsResident(svc.def.applicationSchema, svc.def.consentScope)) {
        drafts.push(...await form());
      }
    } else if (out.needs_confirmation && out.readback && str(out.confirmation_id)) {
      const id = str(out.confirmation_id);
      const row = must(
        await db.from("confirmations").select("tool, args_hash, created_at, expires_at").eq("id", id)
          .eq("conversation_id", conversationId).maybeSingle(),
      );
      if (row) {
        const readback = out.readback as ReadBack;
        const hash = await shownHash({ confirmation_id: id, tool: row.tool, args_hash: row.args_hash, readback });
        const { confirmation_id: _c, ...committed } = args;
        must(
          await db.from("confirmations").update({ ui_tool: tool, args: committed, shown_hash: hash })
            .eq("id", id),
        );
        await screenAudit({
          conversationId,
          agency: conv?.authority ?? "sia",
          op: "uiShown",
          tool,
          confirmationId: id,
          outcome: "shown",
          // The arguments this card commits, hashed as the commit row hashes its own (C10).
          hash: await argsHash(`ui:${tool}`, committed),
        });
        drafts.push(confirmDraft({
          confirmation_id: id,
          uiTool: tool,
          title: confirmTitle(tool, args),
          // The consent variant (MED-333): consent itself, or anything done for someone else.
          consent: tool === "consent_record" || !!str(args.on_behalf_of),
          readback,
          earliest_at: new Date(new Date(row.created_at).getTime() + CONFIRM_MIN_GAP_MS).toISOString(),
          expires_at: row.expires_at,
          shown_hash: hash,
        }));
      }
    } else if (str(out.decision_id)) {
      const d = must(
        await db.from("konza_decisions").select("id, application_id, outcome, decided_by, rule_ids, reason_en, reason_sw, next_en, decided_at, created_at")
          .eq("id", str(out.decision_id)).maybeSingle(),
      );
      const app = d
        ? must(await db.from("konza_applications").select("ref").eq("id", d.application_id).maybeSingle())
        : null;
      if (!committed) drafts.push(...await rail());
      if (d && out.review) drafts.push(receiptDraft({ ...d, review: out.review as never, ref: app?.ref ?? null }));
    }
    await store(conversationId, drafts);
  } catch (e) {
    console.error(JSON.stringify({ ui_emit: "skipped", tool, error: String(e) }));
  }
}
