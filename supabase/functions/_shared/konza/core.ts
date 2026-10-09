// Konza API core (K2). One implementation behind both surfaces: the REST profile
// (tools/konza/api.ts) and the assistant's tools (tools/konza/tools.ts). It enforces the charter
// (docs/konza/charter.md): asks_first operations are two-step, never_acts operations need an
// officer, rules only grant (anything else waits for an officer), acting for someone else needs
// a valid DelegationConsent, and every operation writes an append-only audit event.

import { audit } from "../audit.ts";
import { authority } from "../authorities.ts";
import { db, must } from "../db.ts";
import { addDays, todayIn } from "../rules/common/dates.ts";
import {
  APPOINTMENT_WITHIN_WORKING_DAYS,
  appointmentDayOk,
  COLLECTION_FEE_KES,
  collectionDesk,
  DELIVERY_FEE_KES,
  deliveryDate,
  type DeskId,
  DESKS,
  DOC_TYPES,
  nairobiDay,
  REVIEW_ANSWER_WORKING_DAYS,
  reviewAnswerBy,
  reviewAskBy,
  WINDOW_HOURS,
} from "../rules/konza/rules.ts";
import type { ReadBack } from "../readback.ts";
import { twoStepCheck } from "../twostep.ts";
import { isUuid, sha256, str } from "../util.ts";
import { formatAddress } from "./address.ts";
import {
  appointmentReadBack,
  consentReadBack,
  deliveryReadBack,
  reviewReadBack,
} from "./readbacks.ts";
import { checkEvidence } from "./evidence.ts";
import { AGENCIES } from "./manifest.ts";
import { check } from "./schema.ts";
import {
  type Agency,
  type Caller,
  type DecisionDraft,
  KonzaError,
  OPERATIONS,
  type Resident,
  type ServiceDef,
} from "./types.ts";

const TZ = "Africa/Nairobi";
/** Operations outside the REST profile, still logged with their charter level (K4). */
const INTERNAL_OPERATIONS: Record<string, "acts_alone" | "asks_first" | "never_acts"> = {
  clearHold: "never_acts",
};

/** Called after every stored decision, without waiting (K3, MED-286): the tools function sets it
 * to notify the separate audit function. The core never imports the checker. */
let decisionHook: ((requestId: string) => void) | null = null;
export function onDecisionStored(fn: ((requestId: string) => void) | null) {
  decisionHook = fn;
}
/** Input keys only the core may set on a decision (K4, MED-280). */
const RESERVED_INPUTS = ["held_by", "effect_failed"];
const today = () => todayIn(TZ);
const CONSENT_DEFAULT_DAYS = 365;

// ---------- helpers ----------

async function event(
  caller: Caller,
  operation: string,
  outcome: string,
  extra: { agency?: string; onBehalfOf?: string | null; reason?: string; body?: unknown } = {},
) {
  const { error } = await db.from("konza_audit_events").insert({
    request_id: caller.requestId,
    client: caller.officer ? `officer:${caller.officer}` : caller.client,
    session: caller.session,
    resident: caller.resident?.resident_number ?? null,
    on_behalf_of: extra.onBehalfOf ?? null,
    agency: extra.agency ?? null,
    operation,
    charter: OPERATIONS[operation] ?? INTERNAL_OPERATIONS[operation],
    outcome,
    reason: extra.reason?.slice(0, 300) ?? null,
    request_hash: extra.body === undefined ? null : await sha256(JSON.stringify(extra.body)),
  });
  if (error) console.error(JSON.stringify({ konza_audit_error: error.message.slice(0, 300) }));
  return !error;
}

/** What the assistant says when part of Konza is down (K4 outage family, MED-277): never "done",
 * always a fallback route. */
const fallbackSay = (desk?: string) =>
  `Do not say it is done. Offer to open a case (create_case) so an officer follows up${
    desk ? `, or ${desk}` : ""
  }, and say the resident can try again later.`;

/** Runs an agency's own code. A failure there is an outage of that agency, with a fallback. */
async function agencyCall<T>(agency: Agency, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof KonzaError) throw e;
    console.error(
      JSON.stringify({ konza_agency_error: agency.id, error: String(e).slice(0, 300) }),
    );
    throw new KonzaError(
      503,
      "agency_unavailable",
      `${agency.name} is not answering right now.`,
      `${agency.name} is not answering right now. ${fallbackSay(agency.desk)}`,
    );
  }
}

/** Bad input that reached the database is the caller's to fix, not an outage (MED-286):
 * Postgres 22xxx (data exceptions) is 400, 23xxx (constraint violations) is 409. */
export function dbInputError(e: unknown): KonzaError | null {
  const code = String((e as { code?: unknown })?.code ?? "");
  if (code.startsWith("22")) return new KonzaError(400, "invalid_input", "The input is not valid.");
  if (code.startsWith("23")) {
    return new KonzaError(409, "conflict", "That conflicts with a record that already exists.");
  }
  return null;
}

/** Runs an operation and records its outcome, including refusals. */
async function run<T>(
  caller: Caller,
  operation: string,
  extra: { agency?: string; onBehalfOf?: string | null; body?: unknown },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    // Anything touching a resident's records, any write and any officer action is logged before
    // it acts; if the audit log cannot take the event, it does not act (K4, MED-277). Public
    // answers still work.
    if (
      caller.resident || caller.officer || (OPERATIONS[operation] ?? "never_acts") !== "acts_alone"
    ) {
      if (!(await event(caller, operation, "attempt", extra))) {
        throw new KonzaError(
          503,
          "audit_unavailable",
          "The audit log is not answering, so nothing was done.",
          `The audit log is not answering, so nothing was done. ${fallbackSay()}`,
        );
      }
    }
    const result = await fn();
    const outcome = (result as any)?.needs_confirmation ? "prepared" : "ok";
    await event(caller, operation, outcome, extra);
    return result;
  } catch (e) {
    const err = e instanceof KonzaError ? e : dbInputError(e) ?? new KonzaError(
      503,
      "unavailable",
      "Part of Konza is not answering right now.",
      `Part of Konza is not answering right now. ${fallbackSay()}`,
    );
    if (err !== e) {
      console.error(JSON.stringify({ konza_error: operation, error: String(e).slice(0, 300) }));
    }
    await event(caller, operation, `refused:${err.code}`, { ...extra, reason: err.message });
    throw err;
  }
}

function service(agencyId: string, serviceId: string): { agency: Agency; def: ServiceDef } {
  const agency = Object.hasOwn(AGENCIES, agencyId) ? AGENCIES[agencyId] : undefined;
  const def = agency && Object.hasOwn(agency.services, serviceId)
    ? agency.services[serviceId]
    : undefined;
  if (!agency || !def) {
    throw new KonzaError(
      404,
      "unknown_service",
      `No service ${str(agencyId).slice(0, 40)}/${str(serviceId).slice(0, 40)}.`,
    );
  }
  return { agency, def };
}

function needResident(caller: Caller): Resident {
  if (!caller.resident) {
    throw new KonzaError(
      403,
      "not_verified",
      "This needs the resident's verified identity.",
      "This needs identity verification first. Use identity_start_otp, then identity_check_otp.",
    );
  }
  return caller.resident;
}

export async function residentByNumber(n: string): Promise<Resident | null> {
  // Checked before any query: nothing else is a resident number (K4, MED-279).
  if (!/^QK-[0-9]{4}-[0-9]{4}$/.test(n)) return null;
  return must(
    await db.from("citizens").select("*").eq("resident_number", n).maybeSingle(),
  ) as Resident | null;
}

/** A resident number, or (MED-298) a child's first name resolved only among the caller's own
 * recorded children: parents do not know their children's numbers. Never across residents. */
async function personFor(caller: Resident, value: string): Promise<Resident> {
  if (/^QK-/i.test(value)) {
    const r = await residentByNumber(value.toUpperCase());
    if (!r) throw new KonzaError(404, "unknown_subject", "No resident with that number.");
    return r;
  }
  const name = value.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const links = name && name.length <= 40
    ? must(
      await db.from("guardianships").select("child_citizen_id").eq(
        "guardian_citizen_id",
        caller.id,
      ),
    ) as { child_citizen_id: string }[]
    : [];
  const children = links.length
    ? must(
      await db.from("citizens").select("*").in("id", links.map((l) => l.child_citizen_id)),
    ) as Resident[]
    : [];
  const found = children.filter((c) => c.full_name.split(/\s+/)[0].toLowerCase() === name);
  if (found.length === 1) return found[0];
  throw new KonzaError(
    404,
    "unknown_subject",
    "No single recorded child with that first name.",
    found.length > 1
      ? "More than one of the caller's children has that first name: ask for the child's resident number."
      : "That is not one of the caller's recorded children. A parent or guardian acts only for their own recorded children; offer a case for an officer.",
  );
}

async function residentById(id: string): Promise<Resident> {
  return must(await db.from("citizens").select("*").eq("id", id).single()) as Resident;
}

/** asks_first: the first call returns a confirmation, a later identical call commits. */
async function asksFirst(
  caller: Caller,
  op: string,
  args: Record<string, unknown>,
  summary: ReadBack,
): Promise<
  | {
    needs_confirmation: true;
    confirmation_id: string;
    summary_en: string;
    readback: ReadBack;
    expires_at: string;
  }
  | null
> {
  if (!caller.session) {
    throw new KonzaError(400, "session_required", "Two-step operations need X-Konza-Session.");
  }
  const prepared = await twoStepCheck(caller.session, `konza:${op}`, args, (why) => {
    throw new KonzaError(
      409,
      "confirmation_invalid",
      `The confirmation is not valid (${why}).`,
      `The confirmation is not valid (${why}). Call again without confirmation_id, read back, and ask for a clear yes.`,
    );
  });
  return prepared
    ? { needs_confirmation: true, summary_en: summary.en, readback: summary, ...prepared }
    : null;
}

/** A valid, unexpired, unwithdrawn consent letting `client` act for `subject` in `scope`. */
async function consentFor(grantor: Resident, subject: Resident, scope: string, client: string) {
  const rows = must(
    await db.from("delegation_consents").select("id, scopes, delegate")
      .eq("grantor_citizen_id", grantor.id).eq("subject_citizen_id", subject.id)
      .is("withdrawn_at", null).gt("expires_at", new Date().toISOString()),
  ) as { id: string; scopes: string[]; delegate: string }[];
  return rows.find((r) => r.scopes.includes(scope) && r.delegate === client) ?? null;
}

const decisionOut = (d: any) => {
  const decidedOn = nairobiDay(d.decided_at ?? d.created_at ?? new Date().toISOString());
  return {
    id: d.id,
    application_id: d.application_id,
    outcome: d.outcome,
    decided_by: d.decided_by,
    rule_ids: d.rule_ids,
    reason_en: d.reason_en,
    reason_sw: d.reason_sw,
    inputs: d.inputs,
    next_en: d.next_en,
    decided_at: d.decided_at,
    review: {
      panel: "Aminia Review Panel",
      ask_by: reviewAskBy(decidedOn),
      free: true,
      answer_within_working_days: REVIEW_ANSWER_WORKING_DAYS,
    },
  };
};

async function applicationOut(a: any) {
  const [applicant, subject, d] = await Promise.all([
    residentById(a.applicant_citizen_id),
    residentById(a.subject_citizen_id),
    db.from("konza_decisions").select("*").eq("application_id", a.id).single().then(must),
  ]);
  return {
    id: a.id,
    ref: a.ref,
    agency: a.agency,
    service: a.service,
    applicant: applicant.resident_number,
    subject: subject.resident_number,
    consent_id: a.consent_id,
    status: a.status,
    fields: a.fields,
    decision: decisionOut(d),
  };
}

/** The resident may see an application if it is about them, or if they made it for someone else
 * and still hold a valid consent for that service's scope (withdrawal or expiry ends access). */
async function mayRead(
  r: Resident,
  a: { applicant_citizen_id: string; subject_citizen_id: string; agency: string; service: string },
) {
  if (a.subject_citizen_id === r.id) return true;
  if (a.applicant_citizen_id !== r.id) return false;
  const scope = AGENCIES[a.agency]?.services[a.service]?.consentScope;
  if (!scope) return false;
  const rows = must(
    await db.from("delegation_consents").select("scopes").eq("grantor_citizen_id", r.id)
      .eq("subject_citizen_id", a.subject_citizen_id).is("withdrawn_at", null)
      .gt("expires_at", new Date().toISOString()),
  ) as { scopes: string[] }[];
  return rows.some((c) => c.scopes.includes(scope));
}

/** The circuit breaker (K4): while the checker holds any rule of a service, every grant by rule
 * in that service waits for an officer (a wrong rule can sit behind any rule id the grant cites;
 * MED-280). A grant citing no rule waits too. No adverse outcome, nothing reversed. */
async function held(agencyId: string, serviceId: string, agencyDraft: DecisionDraft) {
  // Only the core sets these keys.
  const inputs = Object.fromEntries(
    Object.entries(agencyDraft.inputs).filter(([k]) => !RESERVED_INPUTS.includes(k)),
  );
  const draft = { ...agencyDraft, inputs };
  if (draft.outcome !== "granted") return draft;
  const holds = must(
    await db.from("konza_holds").select("id").eq("agency", agencyId).eq("service", serviceId)
      .is("cleared_at", null),
  ) as { id: string }[];
  if (!holds.length && draft.rule_ids.length) return draft;
  return {
    outcome: "pending_officer",
    rule_ids: draft.rule_ids,
    reason_en: holds.length
      ? "The rules would grant this, but they are on hold for an officer check, so an officer will decide."
      : "No rule was cited for this grant, so an officer will decide.",
    inputs: { ...inputs, held_by: holds.map((h) => h.id) },
  } satisfies DecisionDraft;
}

/** Officers clear a hold once the rule is fixed or found correct (never_acts: officer only). */
export function clearHold(caller: Caller, id: string) {
  return run(caller, "clearHold", { body: { id } }, async () => {
    if (!caller.officer) {
      throw new KonzaError(401, "officer_only", "Only an officer can clear a hold.");
    }
    const h = must(
      await db.from("konza_holds").update({
        cleared_at: new Date().toISOString(),
        cleared_by: str(caller.officer).slice(0, 40),
      }).eq("id", id).is("cleared_at", null).select("id, agency, service, rule_id, cleared_at")
        .maybeSingle(),
    );
    if (!h) throw new KonzaError(409, "not_open", "No open hold with that id.");
    return h;
  });
}

// ---------- operations ----------

export function listAgencies(caller: Caller) {
  return run(caller, "listAgencies", {}, () =>
    Promise.resolve({
      agencies: Object.values(AGENCIES).map((a) => ({
        id: a.id,
        name: a.name,
        services: Object.keys(a.services),
      })),
    }));
}

export function getService(caller: Caller, agencyId: string, serviceId: string) {
  return run(caller, "getService", { agency: agencyId }, () => {
    const { agency, def } = service(agencyId, serviceId);
    return Promise.resolve({
      agency: agency.id,
      service: serviceId,
      title: def.title,
      card: def.card,
      rule_topics: Object.keys(def.topics),
      application_schema: def.applicationSchema,
      consent_scope: def.consentScope,
      operations: OPERATIONS,
    });
  });
}

export function askRules(
  caller: Caller,
  agencyId: string,
  serviceId: string,
  topic: string,
  inputs: Record<string, unknown> = {},
) {
  return run(caller, "askRules", { agency: agencyId, body: { topic, inputs } }, async () => {
    const { agency, def } = service(agencyId, serviceId);
    const t = Object.hasOwn(def.topics, topic) ? def.topics[topic] : undefined;
    if (!t) {
      throw new KonzaError(
        400,
        "unknown_topic",
        `No topic ${str(topic).slice(0, 40)}. Topics: ${Object.keys(def.topics).join(", ")}.`,
      );
    }
    if (t.needsResident) needResident(caller);
    return await agencyCall(agency, () => t.answer(caller.resident, inputs, today()));
  });
}

export function submitApplication(
  caller: Caller,
  agencyId: string,
  serviceId: string,
  fields: Record<string, unknown>,
  onBehalfOf: string | null,
  confirmationId: string | null,
) {
  return run(
    caller,
    "submitApplication",
    { agency: agencyId, onBehalfOf, body: fields },
    async () => {
      const { agency, def } = service(agencyId, serviceId);
      const applicant = needResident(caller);
      const problems = check(def.applicationSchema, fields, "fields");
      if (problems.length) {
        throw new KonzaError(400, "bad_fields", problems.join("; ").slice(0, 300));
      }

      let subject = applicant;
      let consentId: string | null = null;
      if (onBehalfOf && onBehalfOf !== applicant.resident_number) {
        if (!def.consentScope) {
          throw new KonzaError(403, "self_only", "This service is only for the resident themself.");
        }
        const s = await personFor(applicant, onBehalfOf);
        const c = await consentFor(applicant, s, def.consentScope, caller.client);
        if (!c) {
          throw new KonzaError(
            403,
            "consent_required",
            `No valid consent for ${def.consentScope}.`,
            "There is no recorded consent to act for this person. Offer consent_record first (the parent or guardian consents for the child).",
          );
        }
        subject = s;
        consentId = c.id;
      }

      const prepared = await asksFirst(
        caller,
        `submitApplication:${agencyId}/${serviceId}`,
        {
          fields: JSON.stringify(fields),
          on_behalf_of: subject.resident_number,
          confirmation_id: confirmationId,
        },
        await agencyCall(agency, () => def.summarize(fields, subject)),
      );
      if (prepared) return prepared;

      let draft = await held(
        agency.id,
        serviceId,
        await agencyCall(agency, () => def.decide({ applicant, subject, fields, today: today() })),
      );
      // A grant's effect (a school place) happens before the decision is stored; if it cannot,
      // the decision waits for an officer instead of saying granted (K4, MED-277).
      let took = false;
      if (draft.outcome === "granted" && def.onGranted) {
        const g = draft;
        const done = await agencyCall(agency, () => def.onGranted!(fields, g.inputs, "granted"))
          .catch(() => false);
        took = done !== false;
        if (done === false) {
          draft = {
            outcome: "pending_officer",
            rule_ids: g.rule_ids,
            reason_en:
              "The rules grant this, but it could not be completed automatically, so an officer will finish it.",
            inputs: { ...g.inputs, effect_failed: true },
          };
        }
      }
      const ref = `${agency.id.toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      // If storing fails after the grant took effect, the effect is undone (MED-280).
      const undo = async () => {
        if (!took) return;
        const g = draft;
        await agencyCall(agency, () => def.onUndo?.(fields, g.inputs, "granted")).catch((e) =>
          console.error(
            JSON.stringify({ konza_undo_failed: agency.id, error: String(e).slice(0, 300) }),
          )
        );
      };
      // One transaction: the application, its decision, and a re-read of the service's open
      // holds, so a hold opened while this submit was in flight still applies (MED-286).
      const stored = await db.rpc("konza_store_decision", {
        p_app: {
          ref,
          agency: agency.id,
          service: serviceId,
          applicant_citizen_id: applicant.id,
          subject_citizen_id: subject.id,
          consent_id: consentId,
          fields,
          session: caller.session,
        },
        p_dec: {
          outcome: draft.outcome,
          rule_ids: draft.rule_ids,
          reason_en: draft.reason_en,
          reason_sw: draft.reason_sw ?? null,
          inputs: draft.inputs,
          next_en: draft.next_en ?? null,
        },
      });
      if (stored.error) {
        await undo();
        throw Object.assign(new Error(stored.error.message), { code: stored.error.code });
      }
      const app = stored.data.application;
      const dec = { data: stored.data.decision };
      // Held in the transaction after the effect was taken: give it back.
      if (draft.outcome === "granted" && dec.data.outcome !== "granted") await undo();
      // The checker is told without waiting; nothing it does can turn a stored decision into a
      // failure (found by the sim outage family, audit function down).
      try {
        decisionHook?.(caller.requestId);
      } catch (e) {
        console.error(JSON.stringify({ konza_checker_hook: String(e).slice(0, 300) }));
      }
      if (caller.client === "sia" && caller.session) {
        await audit(
          caller.session,
          agency.authority,
          "Rules",
          `${def.title}: ${dec.data.outcome.replace("_", " ")}`,
          {
            rule_ids: draft.rule_ids,
          },
        );
      }
      // Built from the stored rows: once the decision exists, nothing can turn it into a failure.
      return {
        id: app.id,
        ref: app.ref,
        agency: app.agency,
        service: app.service,
        applicant: applicant.resident_number,
        subject: subject.resident_number,
        consent_id: app.consent_id,
        status: app.status,
        fields: app.fields,
        decision: decisionOut(dec.data),
      };
    },
  );
}

async function applicationFor(caller: Caller, id: string) {
  const r = needResident(caller);
  const a = must(await db.from("konza_applications").select("*").eq("id", id).maybeSingle());
  if (!a) throw new KonzaError(404, "not_found", "No such application.");
  if (!(await mayRead(r, a))) {
    throw new KonzaError(403, "not_yours", "This is not the resident's application.");
  }
  return a;
}

export function getApplication(caller: Caller, id: string) {
  return run(
    caller,
    "getApplication",
    {},
    async () => await applicationOut(await applicationFor(caller, id)),
  );
}

async function decisionFor(caller: Caller, id: string) {
  const d = must(await db.from("konza_decisions").select("*").eq("id", id).maybeSingle());
  if (!d) throw new KonzaError(404, "not_found", "No such decision.");
  const a = await applicationFor(caller, d.application_id);
  return { d, a };
}

export function getDecision(caller: Caller, id: string) {
  return run(caller, "getDecision", {}, async () => decisionOut((await decisionFor(caller, id)).d));
}

export function decideAsOfficer(
  caller: Caller,
  id: string,
  body: { outcome: string; reason_en: string; reason_sw?: string; officer: string },
) {
  return run(caller, "decideAsOfficer", { body }, async () => {
    if (!caller.officer) throw new KonzaError(401, "officer_only", "Only an officer can decide.");
    if (!["granted", "refused", "offered_alternative"].includes(body.outcome)) {
      throw new KonzaError(
        400,
        "bad_outcome",
        "outcome must be granted, refused or offered_alternative.",
      );
    }
    if (str(body.reason_en).length < 10) {
      throw new KonzaError(400, "reason_required", "Give a reason.");
    }
    const d = must(await db.from("konza_decisions").select("*").eq("id", id).maybeSingle());
    if (!d) throw new KonzaError(404, "not_found", "No such decision.");
    if (d.decided_by) {
      throw new KonzaError(409, "already_decided", "This decision is already made.");
    }
    // The grant takes effect first; the decision changes only if it did (K4, MED-277).
    const a0 = must(
      await db.from("konza_applications").select("*").eq("id", d.application_id).single(),
    );
    const agency = AGENCIES[a0.agency];
    const def = agency && Object.hasOwn(agency.services, a0.service)
      ? agency.services[a0.service]
      : undefined;
    if (body.outcome !== "refused" && def?.onGranted) {
      const done = await agencyCall(
        agency,
        () =>
          def.onGranted!(a0.fields, d.inputs, body.outcome as "granted" | "offered_alternative"),
      );
      if (done === false) {
        throw new KonzaError(
          409,
          "could_not_complete",
          "The grant could not take effect (for example, no place is left). Choose another outcome.",
        );
      }
    }
    const tookEffect = body.outcome !== "refused" && !!def?.onGranted;
    const upd = await db.from("konza_decisions").update({
      outcome: body.outcome,
      decided_by: "officer",
      officer: str(body.officer).slice(0, 40),
      reason_en: body.reason_en,
      reason_sw: body.reason_sw ?? null,
      decided_at: new Date().toISOString(),
    }).eq("id", id).is("decided_by", null).select("*").maybeSingle();
    if (upd.error || !upd.data) {
      // Lost a race or failed: undo the effect taken above (MED-280).
      if (tookEffect) {
        await agencyCall(
          agency,
          () =>
            def!.onUndo?.(a0.fields, d.inputs, body.outcome as "granted" | "offered_alternative"),
        ).catch(() => {});
      }
      if (upd.error) throw new Error(upd.error.message);
      throw new KonzaError(409, "already_decided", "This decision is already made.");
    }
    const updated = upd.data;
    must(
      await db.from("konza_applications").update({ status: "decided" }).eq("id", d.application_id),
    );
    return decisionOut(updated);
  });
}

export function appealDecision(
  caller: Caller,
  id: string,
  grounds: string,
  confirmationId: string | null,
) {
  return run(caller, "appealDecision", { body: { grounds } }, async () => {
    const r = needResident(caller);
    const { d } = await decisionFor(caller, id);
    if (!d.decided_by) {
      throw new KonzaError(
        409,
        "not_decided",
        "An officer has not decided yet; a review can be asked once it is decided.",
      );
    }
    const t = today();
    if (t > reviewAskBy(nairobiDay(d.decided_at))) {
      throw new KonzaError(
        409,
        "review_window_closed",
        "Reviews must be asked within 30 days of the decision.",
      );
    }
    const text = str(grounds).slice(0, 1000);
    if (!text) {
      throw new KonzaError(400, "grounds_required", "Say why the decision should be reviewed.");
    }
    const prepared = await asksFirst(
      caller,
      "appealDecision",
      { decision: id, grounds: text, confirmation_id: confirmationId },
      reviewReadBack(),
    );
    if (prepared) return prepared;
    const appeal = must(
      await db.from("konza_appeals").insert({
        decision_id: id,
        citizen_id: r.id,
        grounds: text,
        answer_by: reviewAnswerBy(t),
        session: caller.session,
      }).select("id, decision_id, status, answer_by").single(),
    );
    if (caller.client === "sia" && caller.session) {
      await audit(caller.session, "aminia", "Escalation", "Review asked (Aminia Review Panel)", {
        rule_ids: ["RV-01", "RV-02", "RV-03"],
      });
    }
    return appeal;
  });
}

const consentOut = async (c: any) => ({
  id: c.id,
  grantor: (await residentById(c.grantor_citizen_id)).resident_number,
  delegate: c.delegate,
  subject: (await residentById(c.subject_citizen_id)).resident_number,
  scopes: c.scopes,
  expires_at: c.expires_at,
  withdrawn_at: c.withdrawn_at,
});

export function recordConsent(
  caller: Caller,
  req: {
    subject: string;
    scopes: string[];
    delegate?: string;
    expires_on?: string;
    evidence?: string;
  },
  confirmationId: string | null,
) {
  return run(caller, "recordConsent", { onBehalfOf: req.subject, body: req }, async () => {
    const grantor = needResident(caller);
    const subject = await personFor(grantor, str(req.subject)).catch(() => null);
    if (!subject) throw new KonzaError(404, "unknown_subject", "No resident with that number.");
    const g = must(
      await db.from("guardianships").select("evidence").eq("guardian_citizen_id", grantor.id)
        .eq("child_citizen_id", subject.id).maybeSingle(),
    );
    if (!g) {
      throw new KonzaError(
        403,
        "not_guardian",
        "Only a recorded parent or guardian can consent for this person.",
        "Only a recorded parent or guardian can give this consent. Offer a case for an officer.",
      );
    }
    if (!Array.isArray(req.scopes)) {
      throw new KonzaError(400, "scopes_required", "scopes must be a list.");
    }
    const scopes = req.scopes.map(str).filter((x) => /^[a-z][a-z0-9_]{1,47}$/.test(x));
    if (!scopes.length || scopes.length !== req.scopes.length) {
      throw new KonzaError(
        400,
        "scopes_required",
        "Give at least one scope; scopes are lowercase ids.",
      );
    }
    const evidence = str(req.evidence).slice(0, 200);
    // DK-01: a desk document counts as evidence only for this child, as a birth certificate.
    if (/^(desk|upload)(:|$)/.test(evidence)) {
      // Anything shaped like an evidence id is checked (MED-296); plain words stay a note.
      await checkEvidence(evidence, subject.id, ["birth_certificate"]);
    }
    const delegate = str(req.delegate) || caller.client;
    if (!/^[a-z0-9_-]{1,32}$/.test(delegate)) {
      throw new KonzaError(
        400,
        "bad_delegate",
        "delegate must be a client id (a to z, 0 to 9, _ or -).",
      );
    }
    const until = req.expires_on && /^\d{4}-\d{2}-\d{2}$/.test(req.expires_on)
      ? new Date(`${req.expires_on}T23:59:59+03:00`)
      : new Date(`${addDays(today(), CONSENT_DEFAULT_DAYS)}T23:59:59+03:00`);
    const eighteenth = new Date(
      `${Number(subject.dob.slice(0, 4)) + 18}${subject.dob.slice(4)}T00:00:00+03:00`,
    );
    const expires = until < eighteenth ? until : eighteenth;
    const prepared = await asksFirst(
      caller,
      "recordConsent",
      {
        subject: subject.resident_number,
        scopes: JSON.stringify(scopes),
        evidence,
        delegate,
        expires: expires.toISOString(),
        confirmation_id: confirmationId,
      },
      consentReadBack(
        delegate,
        subject.full_name.split(" ")[0],
        todayIn("Africa/Nairobi", expires),
        scopes,
      ),
    );
    if (prepared) return prepared;
    const c = must(
      await db.from("delegation_consents").insert({
        grantor_citizen_id: grantor.id,
        delegate,
        subject_citizen_id: subject.id,
        scopes,
        evidence: evidence || g.evidence,
        expires_at: expires.toISOString(),
        session: caller.session,
      }).select("*").single(),
    );
    if (caller.client === "sia" && caller.session) {
      await audit(caller.session, "srr", "Identity", `Consent recorded: ${scopes.join(", ")}`);
    }
    return await consentOut(c);
  });
}

export function withdrawConsent(caller: Caller, id: string) {
  return run(caller, "withdrawConsent", {}, async () => {
    const r = needResident(caller);
    const c = must(await db.from("delegation_consents").select("*").eq("id", id).maybeSingle());
    if (!c) throw new KonzaError(404, "not_found", "No such consent.");
    if (c.grantor_citizen_id !== r.id) {
      throw new KonzaError(403, "not_yours", "Only the person who gave it can withdraw it.");
    }
    const done = c.withdrawn_at ? c : must(
      await db.from("delegation_consents").update({ withdrawn_at: new Date().toISOString() })
        .eq("id", id).select("*").single(),
    );
    return await consentOut(done);
  });
}

async function addressOf(r: Resident) {
  const a = must(await db.from("addresses").select("*").eq("citizen_id", r.id).maybeSingle());
  if (!a) throw new KonzaError(404, "no_address", "No registered address.");
  return a;
}

export function getAddress(caller: Caller) {
  return run(
    caller,
    "getAddress",
    {},
    async () => formatAddress(await addressOf(needResident(caller))),
  );
}

export function bookDelivery(
  caller: Caller,
  req: { item_kind: string; item_ref: string; window: string; method?: string },
  confirmationId: string | null,
) {
  return run(caller, "bookDelivery", { body: req }, async () => {
    const r = needResident(caller);
    const method = str(req.method) || "home";
    if (!["home", "collect"].includes(method)) {
      throw new KonzaError(400, "bad_method", "method must be home or collect.");
    }
    if (!["morning", "afternoon"].includes(req.window)) {
      throw new KonzaError(400, "bad_window", "window must be morning or afternoon.");
    }
    const a = await applicationFor(caller, str(req.item_ref));
    const def = AGENCIES[a.agency]?.services[a.service];
    if (!def?.deliverable || def.deliverable.kind !== req.item_kind) {
      throw new KonzaError(400, "not_deliverable", "That application produces nothing to deliver.");
    }
    const d = must(
      await db.from("konza_decisions").select("outcome").eq("application_id", a.id).single(),
    );
    if (d.outcome !== "granted") {
      throw new KonzaError(409, "not_granted", "Only a granted application can be delivered.");
    }
    if (def.deliverable.holderOnly && a.subject_citizen_id !== r.id) {
      throw new KonzaError(
        403,
        "holder_only",
        "Only the holder can book delivery of this document.",
      );
    }
    // Nothing is handed over while its fee is unpaid (MED-296).
    const owed = await chargeFor(a);
    if (owed) {
      throw new KonzaError(
        409,
        "not_paid",
        `The fee of KES ${owed.amount_kes} is not paid yet.`,
        `The fee of KES ${owed.amount_kes} is not paid yet. Offer payment_request first (or payment at a desk).`,
      );
    }
    const already = must(
      await db.from("deliveries").select("id").eq("item_kind", req.item_kind).eq("item_ref", a.id)
        .neq("status", "cancelled").maybeSingle(),
    );
    if (already) throw new KonzaError(409, "already_booked", "This delivery is already booked.");
    const holder = await residentById(a.subject_citizen_id);
    const on = deliveryDate(today());
    // DK-02: collection needs no address; the desk follows from the document (AD-06).
    const desk = method === "collect" ? collectionDesk(req.item_kind) : null;
    const addr = desk ? null : await addressOf(holder);
    const fee = desk ? COLLECTION_FEE_KES : DELIVERY_FEE_KES;
    const summary = deliveryReadBack({
      item_kind: req.item_kind,
      holderOnly: def.deliverable.holderOnly,
      desk,
      address: desk ? null : formatAddress(addr!),
      on,
      window: req.window,
      fee_kes: fee,
    });
    const prepared = await asksFirst(
      caller,
      "bookDelivery",
      {
        item_kind: req.item_kind,
        item_ref: a.id,
        window: req.window,
        method,
        confirmation_id: confirmationId,
      },
      summary,
    );
    if (prepared) return prepared;
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    const row = must(
      await db.from("deliveries").insert({
        citizen_id: holder.id,
        address_id: addr?.id ?? null,
        method,
        desk,
        item_kind: req.item_kind,
        item_ref: a.id,
        deliver_on: on,
        window: req.window,
        fee_kes: fee,
        handover_code_hash: await sha256(`${a.id}:${code}`),
        session: caller.session,
      }).select("*").single(),
    );
    if (caller.client === "sia" && caller.session) {
      await audit(
        caller.session,
        AGENCIES[a.agency].authority,
        "Follow-up",
        desk
          ? `Collection booked at ${DESKS[desk].name} from ${on}`
          : `Delivery booked for ${on}, ${req.window}`,
        {
          rule_ids: [
            "AD-02",
            "AD-03",
            "AD-04",
            ...(def.deliverable.holderOnly ? ["AD-06"] : []),
            ...(desk ? ["DK-02"] : []),
          ],
        },
      );
    }
    return {
      id: row.id,
      item_kind: row.item_kind,
      item_ref: row.item_ref,
      deliver_on: row.deliver_on,
      window: row.window,
      method: row.method,
      desk: desk ? DESKS[desk].name : null,
      fee_kes: row.fee_kes,
      status: row.status,
      handover: def.deliverable.holderOnly
        ? "Only the holder, in person, with ID and the one-time code sent on the delivery day."
        : "The resident or a parent with consent, with the one-time code sent on the delivery day.",
    };
  });
}

/** PP-03 (MED-284): the in-person step a granted application needs, booked by the holder, after the
 * fee is paid; the next working day, morning or afternoon. */
export function bookAppointment(
  caller: Caller,
  req: { application_id: string; window: string; on_date?: string },
  confirmationId: string | null,
) {
  return run(caller, "bookAppointment", { body: req }, async () => {
    const r = needResident(caller);
    if (!["morning", "afternoon"].includes(req.window)) {
      throw new KonzaError(400, "bad_window", "window must be morning or afternoon.");
    }
    const a = await applicationFor(caller, str(req.application_id));
    const def = AGENCIES[a.agency]?.services[a.service];
    const ap = def?.appointment;
    if (!ap) throw new KonzaError(400, "no_appointment", "That service needs no appointment.");
    const d = must(
      await db.from("konza_decisions").select("outcome").eq("application_id", a.id).single(),
    );
    if (d.outcome !== "granted") {
      throw new KonzaError(409, "not_granted", "Only a granted application gets an appointment.");
    }
    if (a.subject_citizen_id !== r.id) {
      throw new KonzaError(403, "holder_only", "Only the holder attends this appointment.");
    }
    if (ap.afterPayment) {
      const open = await chargeFor(a);
      if (open) {
        throw new KonzaError(
          409,
          "not_paid",
          `The fee of KES ${open.amount_kes} is not paid yet.`,
          `The fee of KES ${open.amount_kes} is not paid yet. Offer payment_request first (or payment at the desk).`,
        );
      }
    }
    // PP-03 (amended, MED-299): any working day within the next 10, the next one by default; an
    // existing appointment can be moved until the day before it.
    const t = today();
    const wanted = str(req.on_date);
    if (wanted && !appointmentDayOk(t, wanted)) {
      throw new KonzaError(
        400,
        "bad_day",
        `on_date must be a working day within the next ${APPOINTMENT_WITHIN_WORKING_DAYS} working days.`,
      );
    }
    const on = wanted || deliveryDate(t);
    const already = must(
      await db.from("konza_appointments").select("id, on_date, window").eq("application_id", a.id)
        .eq("kind", ap.kind).maybeSingle(),
    );
    if (already && already.on_date === on && already.window === req.window) {
      throw new KonzaError(409, "already_booked", "This appointment is already booked.");
    }
    if (already && already.on_date <= t) {
      throw new KonzaError(
        409,
        "too_late_to_move",
        "An appointment can be moved only until the day before it.",
      );
    }
    const ready = ap.readyBy?.(on) ?? null;
    const prepared = await asksFirst(
      caller,
      "bookAppointment",
      { application_id: a.id, window: req.window, on_date: on, confirmation_id: confirmationId },
      // The ready date is an estimate, said after the booking (ready_by), not part of the yes.
      appointmentReadBack(ap, { on, window: req.window, from: already?.on_date ?? null }),
    );
    if (prepared) return prepared;
    const row = must(
      already
        ? await db.from("konza_appointments").update({
          on_date: on,
          window: req.window,
          session: caller.session,
        })
          .eq("id", already.id).select("id, kind, on_date, window").single()
        : await db.from("konza_appointments").insert({
          application_id: a.id,
          citizen_id: r.id,
          kind: ap.kind,
          desk: ap.desk,
          on_date: on,
          window: req.window,
          session: caller.session,
        }).select("id, kind, on_date, window").single(),
    );
    if (caller.client === "sia" && caller.session) {
      await audit(
        caller.session,
        AGENCIES[a.agency].authority,
        "Follow-up",
        `${ap.title} ${already ? "moved to" : "booked for"} ${on}, ${req.window}`,
        {
          rule_ids: ap.rule_ids,
        },
      );
    }
    return {
      id: row.id,
      kind: row.kind,
      desk: DESKS[ap.desk].name,
      on_date: row.on_date,
      window: row.window,
      hours: WINDOW_HOURS[row.window],
      moved: !!already,
      bring: ap.bring,
      ready_by: ready,
      rule_ids: ap.rule_ids,
    };
  });
}

/** The charge still open on the resident's newest granted application in a service (PY-01,
 * PY-02): the amount comes from the agency's charge resolver, never from the caller. */
export async function openCharge(
  payer: Resident,
  agencyId: string,
  serviceId: string,
  ref?: string,
) {
  service(agencyId, serviceId);
  let q = db.from("konza_applications").select("*").eq("agency", agencyId).eq("service", serviceId)
    .eq("applicant_citizen_id", payer.id).eq("status", "decided");
  if (ref) q = q.eq("ref", ref);
  const apps = must(await q.order("created_at", { ascending: false }).limit(5)) as any[];
  for (const a of apps) {
    const c = await chargeFor(a);
    if (c) return c;
  }
  return null;
}

/** What is still owed on exactly this application (MED-296): its granted decision's charge less
 * the approved payments for its reference; null when nothing is owed. */
export async function chargeFor(a: any) {
  const agency = Object.hasOwn(AGENCIES, a.agency) ? AGENCIES[a.agency] : undefined;
  const def = agency && Object.hasOwn(agency.services, a.service)
    ? agency.services[a.service]
    : undefined;
  if (!agency || !def?.charge) return null;
  const d = must(
    await db.from("konza_decisions").select("outcome, inputs").eq("application_id", a.id)
      .maybeSingle(),
  );
  if (d?.outcome !== "granted") return null;
  const c = def.charge(a.fields, d.inputs);
  if (!c) return null;
  const paid = (must(
    await db.from("payments").select("amount").eq("case_ref", a.ref).eq("status", "approved"),
  ) as { amount: number }[]).reduce((sum, p) => sum + Number(p.amount), 0);
  if (paid >= c.amount_kes) return null;
  return { ...c, application: a, agency, amount_kes: c.amount_kes - paid };
}

/** The resident's newest granted application in a service, as its holder (MED-297): a new call
 * can book biometrics or delivery without the caller knowing an id. */
export async function latestGranted(caller: Caller, agencyId: string, serviceId: string) {
  const r = needResident(caller);
  service(agencyId, serviceId);
  const apps = must(
    await db.from("konza_applications").select("id").eq("agency", agencyId).eq("service", serviceId)
      .eq("subject_citizen_id", r.id).eq("status", "decided")
      .order("created_at", { ascending: false }).limit(5),
  ) as { id: string }[];
  for (const a of apps) {
    const d = must(
      await db.from("konza_decisions").select("outcome").eq("application_id", a.id).single(),
    );
    if (d.outcome === "granted") return a.id;
  }
  throw new KonzaError(
    404,
    "no_application",
    "No granted application for this person in this service.",
    "There is no granted application in this service for the verified caller. Offer to start one (application_submit).",
  );
}

/** The caller's newest decided decision in a service (MED-298): a review can be asked on a new
 * call without the decision id. */
export async function latestDecided(caller: Caller, agencyId: string, serviceId: string) {
  const r = needResident(caller);
  service(agencyId, serviceId);
  const apps = must(
    await db.from("konza_applications").select("id").eq("agency", agencyId).eq("service", serviceId)
      .eq("status", "decided").or(`applicant_citizen_id.eq.${r.id},subject_citizen_id.eq.${r.id}`)
      .order("created_at", { ascending: false }).limit(1),
  ) as { id: string }[];
  const d = apps[0]
    ? must(
      await db.from("konza_decisions").select("id").eq("application_id", apps[0].id).single(),
    )
    : null;
  if (!d) {
    throw new KonzaError(
      404,
      "no_decision",
      "No decided decision in this service for this person.",
    );
  }
  return d.id as string;
}

/** The owed amount on the application with this reference, for re-checks at approval. */
export async function chargeForRef(ref: string) {
  const a = must(await db.from("konza_applications").select("*").eq("ref", ref).maybeSingle());
  return a ? await chargeFor(a) : null;
}

/** PY-02: an officer records a fee paid at a desk; it must equal the open charge (never_acts). */
export function recordDeskPayment(
  caller: Caller,
  body: { application_id: string; amount_kes: number; desk: string },
) {
  return run(caller, "recordDeskPayment", { body }, async () => {
    if (!caller.officer) {
      throw new KonzaError(401, "officer_only", "Only an officer can record this.");
    }
    if (!Object.hasOwn(DESKS, str(body.desk))) {
      throw new KonzaError(400, "bad_desk", "desk must be lango_square or konza_passport_desk.");
    }
    const a = isUuid(str(body.application_id))
      ? must(
        await db.from("konza_applications").select("*").eq("id", body.application_id).maybeSingle(),
      )
      : null;
    if (!a) throw new KonzaError(404, "not_found", "No such application.");
    const charge = await chargeFor(a);
    if (!charge) {
      throw new KonzaError(409, "nothing_to_pay", "There is no open charge on that application.");
    }
    if (Number(body.amount_kes) !== charge.amount_kes) {
      throw new KonzaError(409, "amount_mismatch", `The open charge is KES ${charge.amount_kes}.`);
    }
    const desk = body.desk as DeskId;
    const row = must(
      await db.from("payments").insert({
        conversation_id: `desk:${desk}`,
        citizen_id: a.applicant_citizen_id,
        case_ref: a.ref,
        amount: charge.amount_kes,
        currency: "KES",
        reference: a.ref,
        authority: charge.agency.authority,
        payee: charge.agency.name,
        description: charge.description,
        status: "approved",
        txn_code: `DSK${crypto.randomUUID().slice(0, 7).toUpperCase()}`,
        method: "desk",
        desk,
        recorded_by: str(caller.officer).slice(0, 40),
      }).select("id, case_ref, amount, status, txn_code, desk").single(),
    );
    // Paid: any phone prompt still waiting for this reference can no longer be approved.
    must(
      await db.from("payments").update({ status: "expired" }).eq("case_ref", a.ref)
        .eq("status", "pending"),
    );
    try {
      decisionHook?.(caller.requestId);
    } catch (e) {
      console.error(JSON.stringify({ konza_checker_hook: String(e).slice(0, 300) }));
    }
    return {
      ...row,
      amount_kes: Number(row.amount),
      amount: undefined,
      rule_ids: ["PY-02", ...charge.rule_ids],
    };
  });
}

/** DK-01: an officer records a paper document handed in at a desk (never_acts). Nothing is
 * scanned; the record is the evidence (`desk:<id>`). */
export function recordDeskDocument(
  caller: Caller,
  body: { resident: string; presented_by?: string; doc_type: string; result: string; desk: string },
) {
  return run(caller, "recordDeskDocument", { body }, async () => {
    if (!caller.officer) {
      throw new KonzaError(401, "officer_only", "Only an officer can record this.");
    }
    if (!DOC_TYPES.includes(str(body.doc_type))) {
      throw new KonzaError(400, "bad_doc_type", `doc_type must be one of ${DOC_TYPES.join(", ")}.`);
    }
    if (!["accepted", "rejected"].includes(str(body.result))) {
      throw new KonzaError(400, "bad_result", "result must be accepted or rejected.");
    }
    if (!Object.hasOwn(DESKS, str(body.desk))) {
      throw new KonzaError(400, "bad_desk", "desk must be lango_square or konza_passport_desk.");
    }
    const about = await residentByNumber(str(body.resident));
    const by = body.presented_by ? await residentByNumber(str(body.presented_by)) : about;
    if (!about || !by) {
      throw new KonzaError(404, "unknown_resident", "No resident with that number.");
    }
    const row = must(
      await db.from("desk_documents").insert({
        citizen_id: about.id,
        presented_by: by.id,
        doc_type: body.doc_type,
        result: body.result,
        desk: body.desk,
        officer: str(caller.officer).slice(0, 40),
      }).select("id, doc_type, result, desk, created_at").single(),
    );
    return { evidence_id: `desk:${row.id}`, ...row, id: undefined, rule_ids: ["DK-01"] };
  });
}

/** Authority facts for an agency (time zone, language). */
export const agencyAuthority = (agencyId: string) => authority(AGENCIES[agencyId].authority);
