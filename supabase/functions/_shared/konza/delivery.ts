// AD-04: anything Konza hands over is delivered home for KES 200, chosen when
// applying and paid together with the service's fee in one payment (a free service then has a
// KES 200 charge of its own), or collected free at a desk. The choice is the application field
// `receive`; delivery_book keeps it. The core adds the fee to the read-back, the decision and the
// charge for every deliverable service, except one that prices delivery itself (deliveryPriced).

// AD-07: the choice can be changed while nothing is paid on the application. The
// decision is never edited: each change is a row in konza_receive_changes, the newest is the choice
// in force, and the charge, delivery_book and the status read it through the helpers below.

import { db, must } from "../db.ts";
import { DELIVERY_FEE_KES } from "../rules/konza/rules.ts";
import { rb, type ReadBack } from "../readback.ts";
import { str } from "../util.ts";
import type { DecisionDraft, JsonSchema } from "./types.ts";

export type Receive = "home" | "collect";

/** AD-07: the newest change of home or collect on this application, if any. */
export async function receiveChange(applicationId: string) {
  const rows = must(
    await db.from("konza_receive_changes").select("to_receive").eq("application_id", applicationId)
      .order("created_at", { ascending: false }).limit(1),
  ) as { to_receive: Receive }[];
  return rows[0]?.to_receive ?? null;
}

/** The choice in force: the newest change, else the application's own `receive` (none: collect). */
export async function receiveOf(a: { id: string; fields?: Record<string, unknown> | null }): Promise<Receive> {
  return (await receiveChange(a.id)) ?? (str(a.fields?.receive) === "home" ? "home" : "collect");
}

/** A decision's inputs as if `to` had been chosen: home records the delivery fee (and the total
 * when there is a fee), collection drops both. */
export function inputsFor(inputs: Record<string, unknown> | null | undefined, to: Receive) {
  const { delivery_kes: _d, total_kes: _t, ...rest } = inputs ?? {};
  if (to !== "home") return rest;
  const fee = typeof rest.fee_kes === "number" ? rest.fee_kes : null;
  return { ...rest, delivery_kes: DELIVERY_FEE_KES, ...(fee !== null ? { total_kes: fee + DELIVERY_FEE_KES } : {}) };
}

/** The decision's inputs with the delivery choice in force; unchanged when nothing was changed. */
export async function inputsInForce(
  a: { id: string },
  inputs: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  const to = await receiveChange(a.id);
  return to ? inputsFor(inputs, to) : (inputs ?? {});
}

/** The `receive` field, optional: left out, the item is collected free at the desk. */
export function receiveField(desk: string, deskSw = desk): JsonSchema {
  return {
    type: "string",
    enum: ["home", "collect"],
    title: "Receive",
    "x-konza-title-sw": "Kupokea",
    "x-konza-enum-en": [`Delivered home (adds KES ${DELIVERY_FEE_KES})`, `Collect at ${desk} (free)`],
    "x-konza-enum-sw": [`Kuletewa nyumbani (KES ${DELIVERY_FEE_KES} zaidi)`, `Kuchukua ${deskSw} (bure)`],
  } as JsonSchema;
}

/** True when the application chose home delivery. */
export const homeChosen = (fields: Record<string, unknown> | null | undefined) => fields?.receive === "home";

type Def = { deliverable?: unknown; deliveryPriced?: boolean };
const generic = (def: Def, fields: Record<string, unknown>) =>
  !!def.deliverable && !def.deliveryPriced && homeChosen(fields);

/** The read-back says the delivery fee and the total before the yes (charter: amounts read back). */
export function withDeliveryReadBack(def: Def, fields: Record<string, unknown>, r: ReadBack): ReadBack {
  if (!generic(def, fields)) return r;
  const fee = r.items.find((i) => i.kind === "amount")?.value;
  const delivery = rb.amount(DELIVERY_FEE_KES);
  const total = typeof fee === "number" ? rb.amount(fee + DELIVERY_FEE_KES) : null;
  return {
    en: `${r.en} Delivered home for ${delivery.spoken_en}${
      total ? `, paid with the fee: ${total.spoken_en} in all` : ", paid on the payment card"
    }.`,
    sw: `${r.sw} Kuletewa nyumbani kwa ${delivery.spoken_sw}${
      total ? `, pamoja na ada: jumla ${total.spoken_sw}` : ""
    }.`,
    items: [...r.items, delivery, ...(total ? [total] : [])],
  };
}

/** A grant records the delivery fee (and the total when there is a fee), so the charge, the
 * resident's status and the checker (C5) all see it; the next step says it. */
export function withDeliveryFee(def: Def, fields: Record<string, unknown>, d: DecisionDraft): DecisionDraft {
  if (!generic(def, fields) || d.outcome !== "granted") return d;
  const fee = Number(d.inputs.fee_kes);
  const total = Number.isFinite(fee) ? fee + DELIVERY_FEE_KES : null;
  return {
    ...d,
    rule_ids: [...d.rule_ids, "AD-04"],
    inputs: { ...d.inputs, delivery_kes: DELIVERY_FEE_KES, ...(total ? { total_kes: total } : {}) },
    next_en: total
      ? `${d.next_en ? `${d.next_en} ` : ""}Home delivery adds KES ${DELIVERY_FEE_KES}: pay KES ${total} in all, in one payment.`
      : `${d.next_en ? `${d.next_en} ` : ""}Pay KES ${DELIVERY_FEE_KES} for home delivery.`,
  };
}
