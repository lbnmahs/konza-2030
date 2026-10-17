// K8 S2 (MED-330, plan-k8 2.2 and 2.5): pure builders for ui/v1 screen events, and the hash
// that binds a tap to what was shown. No database here, so the unit tests check every builder
// against the catalog (drafts_test.ts); emit.ts looks things up and stores the events.

import type { JsonSchema } from "../konza/types.ts";
import type { ReadBack } from "../readback.ts";
import { sha256 } from "../util.ts";
import { type FormField, formFields, type Text } from "./catalog.ts";

export type Draft = { kind: string; payload: Record<string, unknown> };

/** RFC 8785 (JCS) for the values we hash: objects with sorted keys, arrays, strings, integers,
 * booleans and null. Integers serialise the same in JCS and JSON.stringify. */
export function jcs(v: unknown): string {
  if (v === null || typeof v !== "object") {
    if (typeof v === "number" && !Number.isInteger(v)) throw new Error("jcs: only integers are hashed");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${
    Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`)
      .join(",")
  }}`;
}

/** plan-k8 2.5: binds a tap to the stored arguments and the exact words shown and spoken. */
export function shownHash(p: {
  confirmation_id: string;
  tool: string;
  args_hash: string;
  readback: ReadBack;
}): Promise<string> {
  return sha256(jcs({
    confirmation_id: p.confirmation_id,
    tool: p.tool,
    args_hash: p.args_hash,
    readback_en: p.readback.en,
    readback_sw: p.readback.sw,
    items: p.readback.items.map((i) => ({ kind: i.kind, en: i.spoken_en, sw: i.spoken_sw })),
  }));
}

const text = (en: string, sw?: string): Text => (sw ? { en, sw } : { en });

/** The service rail. K8 shows the steps every Konza service shares; S3 adds pay and book where the
 * service has them. Never a percentage, never a step the backend has not recorded. */
export type Recorded = {
  /** conversations.verified_at */
  verified_at?: string | null;
  /** The application this conversation stored for the service (konza_applications.created_at). */
  submitted_at?: string | null;
  /** Its decision: decided_at is null while it waits for an officer. */
  decision?: { created_at: string; decided_at: string | null; decided_by: string | null } | null;
};

export type PaymentState = "choose" | "code" | "pin" | "waiting" | "approved" | "declined" | "expired";
export type PaymentMethod = { id: string; type: "card" | "mobile_money"; masked: string };

const METHOD_LABEL: Record<PaymentMethod["type"], Text> = {
  card: text("Debit or credit card", "Kadi ya benki"),
  mobile_money: text("Mobile money", "Pesa ya simu"),
};

/** The payment card (MED-331 reference; MED-332 methods, plan-k8 2.10): choose a
 * method, then the card's code or the mobile money PIN, then paid with its transaction reference.
 * Masked method details only; the card never carries a code or a PIN. */
export function paymentDraft(p: {
  id: string;
  state: PaymentState;
  amount_kes: number;
  description: string;
  expires_at: string;
  desk: string;
  methods?: PaymentMethod[];
  method_id?: string | null;
  attempts_left?: number;
  reference?: string | null;
}): Draft {
  const asking = p.state === "choose" || p.state === "code" || p.state === "pin";
  return {
    kind: "payment",
    payload: {
      payment_id: p.id,
      state: p.state,
      amount_kes: p.amount_kes,
      label: text(p.description),
      ...(p.state === "code" || p.state === "waiting" ? { channel: "sms" } : {}),
      expires_at: new Date(p.expires_at).toISOString(),
      desk: text(`Or pay at ${p.desk}`),
      ...(asking && p.methods?.length
        ? {
          methods: p.methods.map((m) => ({
            method_id: m.id,
            type: m.type,
            label: METHOD_LABEL[m.type],
            masked: m.masked,
          })),
        }
        : {}),
      ...(p.method_id && p.state !== "choose" ? { method_id: p.method_id } : {}),
      ...(asking && p.state !== "choose" && p.attempts_left !== undefined
        ? { attempts_left: p.attempts_left }
        : {}),
      ...(p.state === "approved" && p.reference ? { reference: p.reference } : {}),
    },
  };
}

/** The service rail: only what the core has recorded, each step on its own record.
 * done is recorded, current is recorded as waiting (a decision with an officer), todo is nothing
 * yet; `updated` is the newest record's time and source. Never a percentage or an inferred step. */
export function progressDraft(capability: string, title: string, r: Recorded): Draft {
  const d = r.decision;
  const steps = [
    { id: "identity", state: r.verified_at ? "done" : "todo" },
    { id: "confirm", state: r.submitted_at ? "done" : "todo" },
    { id: "decision", state: d ? (d.decided_at ? "done" : "current") : "todo" },
  ];
  const records: { at: string; source: Text }[] = [
    ...(r.verified_at ? [{ at: r.verified_at, source: text("Identity check", "Uthibitisho wa utambulisho") }] : []),
    ...(r.submitted_at ? [{ at: r.submitted_at, source: text("Your application", "Ombi lako") }] : []),
    ...(d
      ? [{
        at: d.decided_at ?? d.created_at,
        source: d.decided_by === "rule"
          ? text("A published rule", "Kanuni iliyochapishwa")
          : d.decided_by === "officer"
          ? text("An officer", "Afisa")
          : text("Waiting for an officer", "Inasubiri afisa"),
      }]
      : []),
  ];
  // The newest record; on a tie (one transaction stores the application and its decision) the
  // later step.
  const updated = records.reduce<(typeof records)[number] | undefined>(
    (best, r) => (!best || Date.parse(r.at) >= Date.parse(best.at) ? r : best),
    undefined,
  );
  return {
    kind: "progress",
    payload: {
      service: capability,
      title: text(title),
      steps,
      ...(updated ? { updated: { at: new Date(updated.at).toISOString(), source: updated.source } } : {}),
    },
  };
}

/** The slots card (MED-332, PP-03): the working days the rules allow and the two windows; picking
 * prepares appointment_book, whose confirm card follows. Days and hours come from the rules. */
export function slotsDraft(p: {
  title: string;
  title_sw?: string;
  place: string;
  days: string[];
  hours: Record<string, string>;
}): Draft {
  const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return {
    kind: "slots",
    payload: {
      title: text(p.title, p.title_sw),
      place: text(p.place),
      days: p.days.slice(0, 10).map((date) => ({ date, label: text(fmt.format(new Date(`${date}T00:00:00Z`))) })),
      windows: [
        { id: "morning", label: text(`Morning, ${p.hours.morning}`, `Asubuhi, ${p.hours.morning}`) },
        { id: "afternoon", label: text(`Afternoon, ${p.hours.afternoon}`, `Mchana, ${p.hours.afternoon}`) },
      ],
    },
  };
}

/** `fields`: the schema's fields with the choices the backend filled (MED-333, ui/options.ts). */
export function formDraft(capability: string, title: string, schema: JsonSchema, fields?: FormField[]): Draft {
  return {
    kind: "form",
    payload: { service: capability, title: text(title), fields: fields ?? formFields(schema) },
  };
}

/** A fee from a rules answer: `fees_kes` (one row per option, labelled from the application's own
 * enum labels) or a single `fee_kes`. Null when the answer carries no fee. */
export function quoteDraft(
  title: string,
  answer: { values?: Record<string, unknown>; rule_ids?: string[] },
  schema: JsonSchema | null,
): Draft | null {
  const values = answer.values ?? {};
  const ruleIds = answer.rule_ids ?? [];
  if (!ruleIds.length) return null;
  const labelFor = (option: string): Text => {
    for (const p of Object.values(schema?.properties ?? {})) {
      const i = (p.enum ?? []).findIndex((e) => String(e) === option);
      if (i >= 0 && p["x-konza-enum-en"]?.[i]) {
        return text(p["x-konza-enum-en"][i], p["x-konza-enum-sw"]?.[i]);
      }
    }
    return text(option);
  };
  let rows: { label: Text; amount_kes: number }[] = [];
  if (values.fees_kes && typeof values.fees_kes === "object") {
    rows = Object.entries(values.fees_kes as Record<string, number>)
      .filter(([, kes]) => Number.isInteger(kes))
      .map(([option, kes]) => ({ label: labelFor(option), amount_kes: kes }));
  } else if (Number.isInteger(values.fee_kes)) {
    rows = [{ label: text("Fee", "Ada"), amount_kes: values.fee_kes as number }];
  }
  if (!rows.length) return null;
  return { kind: "quote", payload: { title: text(title), rows: rows.slice(0, 6), rule_ids: ruleIds } };
}

export function identityDraft(
  step: "code" | "verified",
  extra: { channel?: string; expires_at?: string } = {},
): Draft {
  return {
    kind: "identity",
    payload: step === "verified"
      ? { step }
      : {
        step,
        ...(extra.channel === "voice" || extra.channel === "sms" ? { channel: extra.channel } : {}),
        ...(extra.expires_at ? { expires_at: extra.expires_at } : {}),
        attempts_left: 3,
      },
  };
}

/** An asks-first step waiting for a clear yes: the same read-back SIA speaks. */
export function confirmDraft(p: {
  confirmation_id: string;
  uiTool: string;
  title: string;
  consent: boolean;
  readback: ReadBack;
  /** When a commit becomes valid: the prepare time plus the 4 s minimum (twostep.ts). */
  earliest_at: string;
  expires_at: string;
  shown_hash: string;
}): Draft {
  return {
    kind: "confirm",
    payload: {
      confirmation_id: p.confirmation_id,
      tool: p.uiTool,
      variant: p.consent ? "consent" : "action",
      state: "open",
      title: text(p.title),
      readback: text(p.readback.en, p.readback.sw),
      items: p.readback.items.slice(0, 12).map((i) => ({
        kind: i.kind,
        spoken: text(i.spoken_en, i.spoken_sw),
        ...(typeof i.value === "string" || Number.isInteger(i.value) ? { value: i.value } : {}),
      })),
      expires_at: p.expires_at,
      earliest_at: p.earliest_at,
      shown_hash: p.shown_hash,
    },
  };
}

/** A decision, from its stored row (the tool result leaves out the rule ids and Swahili). */
export function receiptDraft(d: {
  id: string;
  outcome: string;
  decided_by: string;
  rule_ids: string[] | null;
  reason_en: string;
  reason_sw?: string | null;
  next_en?: string | null;
  review: { panel: string; ask_by: string; free: boolean; answer_within_working_days: number };
  /** The application's reference (MED-331: SIA says it is on the screen, so it is). */
  ref?: string | null;
}): Draft {
  return {
    kind: "receipt",
    payload: {
      decision_id: d.id,
      ...(d.ref ? { ref: d.ref } : {}),
      outcome: d.outcome,
      decided_by: d.decided_by,
      rule_ids: d.rule_ids ?? [],
      reason: text(d.reason_en, d.reason_sw ?? undefined),
      ...(d.next_en ? { next: text(d.next_en) } : {}),
      review: d.review,
      link: `/r/${d.id}`,
    },
  };
}

