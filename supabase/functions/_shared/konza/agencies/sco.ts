// Savanahlands Company Office (SCO): starting a business (K3, MED-289; world.md BZ-01 to BZ-05).
// A name check needs no personal details. A business name or company registration brings a tax
// number in one go (BZ-03); a trading permit follows (BZ-04). A name already taken, or one that
// suggests a government body, goes to an officer (BZ-05): never refused by rule.

import { db, must } from "../../db.ts";
import {
  BUSINESS_FEES_KES,
  normalName,
  reservedName,
  TRADING_PERMIT_FEE_KES,
} from "../../rules/konza/rules.ts";
import type { Agency, ServiceDef } from "../types.ts";
import { rb, readBack } from "../../readback.ts";

/** BZ-05: is the name already registered or waiting for an officer? */
async function nameTaken(name: string): Promise<boolean> {
  const apps = must(
    await db.from("konza_applications").select("fields, status").eq("agency", "sco")
      .eq("service", "business_registration"),
  ) as { fields: Record<string, unknown> }[];
  return apps.some((a) => normalName(String(a.fields.name ?? "")) === normalName(name));
}

const fees = {
  needsResident: false,
  answer: () =>
    Promise.resolve({
      topic: "business_fees",
      values: {
        business_name_kes: BUSINESS_FEES_KES.business_name,
        company_kes: BUSINESS_FEES_KES.company,
        trading_permit_kes: TRADING_PERMIT_FEE_KES,
      },
      rule_ids: ["BZ-01", "BZ-02", "BZ-03", "BZ-04"],
      reason_en:
        "A business name is KES 950, a private limited company KES 10,500, each with a tax number at no extra cost; a small workshop's trading permit is KES 5,000 a year.",
    }),
};

const registration: ServiceDef = {
  title: "Business registration with a tax number",
  card: [
    "Fees and a name check need no personal details: rules_lookup topic business_fees, topic name_check with inputs name.",
    "Verify the resident. application_submit with fields name and type (business_name or company); read back, clear yes, then again with the confirmation_id.",
    "The tax number comes with the registration (BZ-03). Then payment_request for the fee (a DEMO code prompt, or at any desk) and payment_confirm.",
    "A taken name, or one suggesting a government body, goes to an officer: say so and when; never say it was refused. Offer to try a different name, which a rule can register at once.",
    "The certificate can be delivered home or collected free at Lango Square.",
  ].join("\n"),
  topics: {
    business_fees: fees,
    name_check: {
      needsResident: false,
      answer: async (_r, inputs) => {
        const name = String(inputs.name ?? "").slice(0, 80);
        const reserved = reservedName(name);
        const taken = name ? await nameTaken(name) : false;
        return {
          topic: "name_check",
          values: { name, available: !!name && !reserved && !taken, reserved, taken },
          rule_ids: ["BZ-05"],
          reason_en: !name
            ? "Say the name to check."
            : reserved
            ? "That name suggests a government body, so an officer would decide on it."
            : taken
            ? "That name is already registered or waiting for an officer."
            : "That name looks free.",
        };
      },
    },
  },
  applicationSchema: {
    type: "object",
    required: ["name", "type"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 3, maxLength: 60, pattern: "^[A-Za-z0-9 '&.-]+$" },
      type: { type: "string", enum: ["business_name", "company"] },
    },
  },
  consentScope: null,
  summarize: (f) => {
    const company = f.type === "company";
    return readBack(
      {
        name: rb.name(String(f.name)),
        fee: rb.amount(BUSINESS_FEES_KES[f.type as "company" | "business_name"]),
      },
      (s) =>
        `Register "${s.name}" as a ${
          company ? "private limited company" : "business name"
        } with a tax number, fee ${s.fee}.`,
      (s) =>
        `Kusajili "${s.name}" kama ${
          company ? "kampuni binafsi yenye dhima ndogo" : "jina la biashara"
        } pamoja na namba ya kodi, ada ${s.fee}.`,
    );
  },
  decide: async ({ fields }) => {
    const name = String(fields.name);
    const type = fields.type as "business_name" | "company";
    const rule = type === "company" ? "BZ-02" : "BZ-01";
    if (reservedName(name) || (await nameTaken(name))) {
      return {
        outcome: "pending_officer",
        rule_ids: ["BZ-05"],
        reason_en: reservedName(name)
          ? "The name suggests a government body, so an officer will decide on it."
          : "The name is already registered or waiting, so an officer will look at it.",
        inputs: { name_check: reservedName(name) ? "reserved" : "taken" },
      };
    }
    const fee = BUSINESS_FEES_KES[type];
    return {
      outcome: "granted",
      rule_ids: [rule, "BZ-03"],
      reason_en:
        `"${name}" is registered: the name is free and does not suggest a government body.`,
      inputs: {
        fee_kes: fee,
        tax_number: `QK-T-${
          String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e8).padStart(8, "0")
        }`,
      },
      next_en: `Pay KES ${fee}. The tax number is issued with the registration.`,
    };
  },
  charge: (fields, inputs) =>
    typeof inputs.fee_kes === "number"
      ? {
        amount_kes: inputs.fee_kes,
        rule_ids: [fields.type === "company" ? "BZ-02" : "BZ-01"],
        description: `Business registration: ${fields.name}`,
      }
      : null,
  deliverable: { kind: "certificate", holderOnly: false },
};

const permit: ServiceDef = {
  title: "Trading permit for a small workshop",
  card: [
    "Verify the resident. The business must be registered first (its reference starts SCO-).",
    "application_submit with field business_ref; read back the fee, clear yes, then again with the confirmation_id; then payment_request and payment_confirm.",
  ].join("\n"),
  topics: { business_fees: fees },
  applicationSchema: {
    type: "object",
    required: ["business_ref"],
    additionalProperties: false,
    properties: { business_ref: { type: "string", pattern: "^SCO-[A-F0-9]{8}$" } },
  },
  consentScope: null,
  // The business reference is texted, never read aloud (speech layer), so the read-back names the
  // business, not its reference.
  summarize: () =>
    readBack(
      { fee: rb.amount(TRADING_PERMIT_FEE_KES) },
      (s) => `Apply for a trading permit for the business you registered, ${s.fee} a year.`,
      (s) => `Kuomba kibali cha biashara kwa biashara uliyosajili, ${s.fee} kwa mwaka.`,
    ),
  decide: async ({ applicant, fields }) => {
    const reg = must(
      await db.from("konza_applications").select("id, status").eq("ref", fields.business_ref)
        .eq("agency", "sco").eq("service", "business_registration")
        .eq("applicant_citizen_id", applicant.id).maybeSingle(),
    );
    const granted = reg
      ? must(
        await db.from("konza_decisions").select("outcome").eq("application_id", reg.id).single(),
      ).outcome === "granted"
      : false;
    if (!granted) {
      return {
        outcome: "pending_officer",
        rule_ids: ["BZ-04"],
        reason_en: "The business is not registered to this resident yet, so an officer will check.",
        inputs: {},
      };
    }
    return {
      outcome: "granted",
      rule_ids: ["BZ-04"],
      reason_en: "The trading permit is granted: the business is registered to this resident.",
      inputs: { fee_kes: TRADING_PERMIT_FEE_KES },
      next_en: `Pay KES ${TRADING_PERMIT_FEE_KES}; the permit runs for a year.`,
    };
  },
  charge: (fields, inputs) =>
    typeof inputs.fee_kes === "number"
      ? {
        amount_kes: inputs.fee_kes,
        rule_ids: ["BZ-04"],
        description: `Trading permit for ${fields.business_ref}`,
      }
      : null,
  deliverable: { kind: "certificate", holderOnly: false },
};

export const sco: Agency = {
  id: "sco",
  name: "Savanahlands Company Office",
  authority: "sco",
  desk: "Lango Square (Z1 B01 P001 U01)",
  services: { business_registration: registration, trading_permit: permit },
};
