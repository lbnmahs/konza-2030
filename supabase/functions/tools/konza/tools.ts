// K2: the Konza assistant's generic tools (SIA). Each calls the Konza core in-process, for the
// service service_open chose, as client "sia", with the resident from the verified conversation.
// No tool names an agency or a field: those come from the manifest through service_open.

import { db, must, ToolError } from "../../_shared/db.ts";
import * as core from "../../_shared/konza/core.ts";
import { type Caller, KonzaError, type Resident } from "../../_shared/konza/types.ts";
import { str } from "../../_shared/util.ts";
import type { Handler, ToolCtx } from "../index.ts";

/** K5 (MED-301): every asks-first prepare returns `readback`, built from the rules in English and
 * Swahili; the assistant says it as written, never translating amounts or dates itself. */
const READ_BACK =
  "Say readback.sw word for word if the caller speaks Swahili, otherwise readback.en, then ask for a clear yes.";

const VERIFIED_FOR_MS = 15 * 60_000;

/** The verified resident of this conversation, or null (no audit noise for general questions). */
async function verifiedResident(conversationId: string): Promise<Resident | null> {
  const conv = must(
    await db.from("conversations").select("verified_at, citizen_id").eq("id", conversationId)
      .maybeSingle(),
  );
  if (!conv?.citizen_id || !conv.verified_at) return null;
  if (Date.now() - new Date(conv.verified_at).getTime() >= VERIFIED_FOR_MS) return null;
  const r = must(await db.from("citizens").select("*").eq("id", conv.citizen_id).single());
  return r.resident_number ? r as Resident : null;
}

async function callerFor(ctx: ToolCtx): Promise<Caller> {
  return {
    client: "sia",
    requestId: crypto.randomUUID(),
    session: ctx.conversationId,
    resident: await verifiedResident(ctx.conversationId),
  };
}

/** The application the caller means: the id given, or (on a new call, MED-297) their newest
 * granted one in the open service. */
async function ownApplication(ctx: ToolCtx): Promise<string> {
  const given = str(ctx.args.application_id);
  if (given) return given;
  const [agency, service] = await openService(ctx);
  return await core.latestGranted(await callerFor(ctx), agency, service);
}

async function openService(ctx: ToolCtx): Promise<[string, string]> {
  const conv = must(
    await db.from("conversations").select("capability").eq("id", ctx.conversationId).single(),
  );
  const [agency, service] = String(conv.capability ?? "").split(".");
  if (!agency || !service) {
    throw new ToolError("no_service", "Open a service first (service_open).");
  }
  return [agency, service];
}

function parseJson(text: unknown, what: string): Record<string, unknown> {
  if (text === undefined || text === null || text === "") return {};
  try {
    const v = JSON.parse(String(text));
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch { /* falls through */ }
  throw new ToolError("bad_json", `${what} must be a JSON object, for example {"pages": 34}.`);
}

/** Konza errors become tool errors with what the assistant should do. */
const wrap = (fn: Handler): Handler => async (ctx) => {
  try {
    return await fn(ctx);
  } catch (e) {
    if (e instanceof KonzaError) throw new ToolError(e.code, e.say ?? e.message);
    throw e;
  }
};

export const konzaTools: Record<string, Handler> = {
  rules_lookup: wrap(async (ctx) => {
    const [agency, service] = await openService(ctx);
    return await core.askRules(
      await callerFor(ctx),
      agency,
      service,
      str(ctx.args.topic),
      parseJson(ctx.args.inputs_json, "inputs_json"),
    );
  }),

  application_submit: wrap(async (ctx) => {
    const [agency, service] = await openService(ctx);
    const r = await core.submitApplication(
      await callerFor(ctx),
      agency,
      service,
      parseJson(ctx.args.fields_json, "fields_json"),
      str(ctx.args.on_behalf_of) || null,
      str(ctx.args.confirmation_id) || null,
    );
    if ("needs_confirmation" in r) {
      return {
        ...r,
        next:
          `Nothing has happened yet. ${READ_BACK} Only after the yes, in their next turn, call application_submit again with the same arguments and this confirmation_id.`,
      };
    }
    return {
      ref: r.ref,
      application_id: r.id,
      decision_id: r.decision.id,
      outcome: r.decision.outcome,
      decided_by: r.decision.decided_by,
      reason: r.decision.reason_en,
      next: r.decision.next_en,
      review: r.decision.review,
      say: r.decision.outcome === "granted"
        ? "Say what was decided, the reason, what happens next, and that they can ask for a review."
        : "Say an officer will decide, why, and when. Do not guess the outcome.",
    };
  }),

  decision_explain: wrap(async (ctx) => {
    return await core.getDecision(await callerFor(ctx), str(ctx.args.decision_id));
  }),

  review_request: wrap(async (ctx) => {
    const r = await core.appealDecision(
      await callerFor(ctx),
      str(ctx.args.decision_id) || await (async () => {
        const [agency, service] = await openService(ctx);
        return await core.latestDecided(await callerFor(ctx), agency, service);
      })(),
      str(ctx.args.grounds),
      str(ctx.args.confirmation_id) || null,
    );
    return "needs_confirmation" in r
      ? {
        ...r,
        next: `${READ_BACK} Then call again with the confirmation_id.`,
      }
      : r;
  }),

  consent_record: wrap(async (ctx) => {
    const r = await core.recordConsent(
      await callerFor(ctx),
      {
        subject: str(ctx.args.subject),
        scopes: str(ctx.args.scopes).split(",").map((s) => s.trim()).filter(Boolean),
        evidence: str(ctx.args.evidence) || undefined,
      },
      str(ctx.args.confirmation_id) || null,
    );
    return "needs_confirmation" in r
      ? {
        ...r,
        next: `${READ_BACK} Then call again with the confirmation_id.`,
      }
      : r;
  }),

  consent_withdraw: wrap(async (ctx) => {
    return await core.withdrawConsent(await callerFor(ctx), str(ctx.args.consent_id));
  }),

  address_get: wrap(async (ctx) => {
    return await core.getAddress(await callerFor(ctx));
  }),

  appointment_book: wrap(async (ctx) => {
    const r = await core.bookAppointment(
      await callerFor(ctx),
      {
        application_id: await ownApplication(ctx),
        window: str(ctx.args.window),
        on_date: str(ctx.args.on_date) || undefined,
      },
      str(ctx.args.confirmation_id) || null,
    );
    return "needs_confirmation" in r
      ? {
        ...r,
        next: `${READ_BACK} Then call again with the confirmation_id.`,
      }
      : {
        ...r,
        next:
          "Say the desk, the date, the window and what to bring. If ready_by is set, say the new document is usually ready about then, and that this is an estimate, not a promise.",
      };
  }),

  delivery_book: wrap(async (ctx) => {
    const r = await core.bookDelivery(
      await callerFor(ctx),
      {
        item_kind: str(ctx.args.item_kind),
        item_ref: await ownApplication(ctx),
        window: str(ctx.args.window),
        method: str(ctx.args.method) || undefined,
      },
      str(ctx.args.confirmation_id) || null,
    );
    return "needs_confirmation" in r
      ? {
        ...r,
        next: `${READ_BACK} Then call again with the confirmation_id.`,
      }
      : r;
  }),
};
