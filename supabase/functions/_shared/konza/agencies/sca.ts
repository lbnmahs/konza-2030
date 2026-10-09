// Savanahlands Cover Authority (SCA): health cover (K3, MED-288; world.md SH-01 to SH-04). The
// month's contribution is an application the rules accept and the resident then pays (PY-01 or
// PY-02); cover is active once it has cleared. A parent adds a child as a dependant with consent
// and the birth certificate (a Lango Square desk record); a document that does
// not check out goes to an officer.

import { db, must } from "../../db.ts";
import { ageOn, SH_MIN_CONTRIBUTION_KES } from "../../rules/konza/rules.ts";
import { checkEvidence } from "../evidence.ts";
import { myApplication } from "../status.ts";
import { type Agency, KonzaError, type Resident, type ServiceDef } from "../types.ts";
import { rb, readBack } from "../../readback.ts";

const month = (day: string) => day.slice(0, 7);

/** SH-01: cover is active when a contribution for this month has been paid. */
async function coverActive(r: Resident, day: string) {
  const apps = must(
    await db.from("konza_applications").select("ref, fields").eq("agency", "sca")
      .eq("service", "contribution").eq("applicant_citizen_id", r.id),
  ) as { ref: string; fields: Record<string, unknown> }[];
  const refs = apps.filter((a) => a.fields.month === month(day)).map((a) => a.ref);
  if (!refs.length) return false;
  const paid = must(
    await db.from("payments").select("id").in("case_ref", refs).eq("status", "approved").limit(1),
  );
  return paid.length > 0;
}

const contribution: ServiceDef = {
  title: "Monthly health cover contribution",
  card: [
    "Minimum and cover rules need no personal details: rules_lookup topic minimum.",
    "A returning caller: rules_lookup topic my_application gives their application (or their child's), the decision and its reason, any fee still owed, and delivery.",
    "Verify the resident, then rules_lookup topic cover_status.",
    "To pay this month: application_submit with fields amount_kes (at least the minimum) and month (YYYY-MM, this month); read back, clear yes, then again with the confirmation_id.",
    "Then payment_request for that amount (a DEMO code prompt, or at any desk) and payment_confirm. Cover is active once it has cleared.",
  ].join("\n"),
  topics: {
    my_application: myApplication("sca", "contribution", "health cover contribution"),
    minimum: {
      needsResident: false,
      answer: () =>
        Promise.resolve({
          topic: "minimum",
          values: { minimum_kes: SH_MIN_CONTRIBUTION_KES },
          rule_ids: ["SH-01", "SH-02"],
          reason_en:
            "The minimum contribution is KES 300 a month; cover is active once this month's contribution has cleared.",
        }),
    },
    cover_status: {
      needsResident: true,
      answer: async (r, _inputs, today) => {
        const active = r ? await coverActive(r, today) : false;
        return {
          topic: "cover_status",
          values: { active, month: month(today) },
          rule_ids: ["SH-01"],
          reason_en: active
            ? "Cover is active: this month's contribution has cleared."
            : "Cover is not active yet: this month's contribution has not cleared.",
        };
      },
    },
  },
  applicationSchema: {
    type: "object",
    required: ["amount_kes", "month"],
    additionalProperties: false,
    properties: {
      amount_kes: { type: "integer", minimum: SH_MIN_CONTRIBUTION_KES, maximum: 100000 },
      month: { type: "string", pattern: "^20[0-9]{2}-(0[1-9]|1[0-2])$" },
    },
  },
  consentScope: null,
  summarize: (f) =>
    readBack(
      { amount: rb.amount(Number(f.amount_kes)), month: rb.month(String(f.month)) },
      (s) => `Pay the health cover contribution of ${s.amount} for ${s.month}.`,
      (s) => `Kulipa mchango wa bima ya afya wa ${s.amount} kwa ${s.month}.`,
    ),
  decide: ({ fields, today }) => {
    if (fields.month !== month(today)) {
      return Promise.resolve({
        outcome: "pending_officer",
        rule_ids: ["SH-01", "SH-02"],
        reason_en: "Contributions for another month are checked by an officer.",
        inputs: { month: fields.month },
      });
    }
    const amount = Number(fields.amount_kes);
    return Promise.resolve({
      outcome: "granted",
      rule_ids: ["SH-02", "SH-01"],
      reason_en:
        `The contribution is accepted: KES ${amount} is at least the KES ${SH_MIN_CONTRIBUTION_KES} minimum.`,
      inputs: { month: fields.month, contribution_kes: amount },
      next_en: `Pay KES ${amount}; cover is active once it has cleared.`,
    });
  },
  charge: (_fields, inputs) =>
    typeof inputs.contribution_kes === "number"
      ? {
        amount_kes: inputs.contribution_kes,
        rule_ids: ["SH-02"],
        description: `Health cover contribution, ${inputs.month}`,
      }
      : null,
};

const dependant: ServiceDef = {
  title: "Adding a child to health cover",
  card: [
    "Verify the parent. Only a recorded parent or guardian adds a child, with consent recorded first (consent_record, scope health_cover).",
    "The birth certificate is handed in at Lango Square (an officer records it); then field evidence is just desk.",
    "application_submit with on_behalf_of the child and field evidence; read back, clear yes, then again with the confirmation_id.",
    "Cover for the child starts when the request is approved (SH-04). Speak about the child by first name only.",
    "A returning caller: rules_lookup topic my_application gives their application (or their child's), the decision and its reason, any fee still owed, and delivery.",
  ].join("\n"),
  topics: {
    minimum: contribution.topics.minimum,
    my_application: myApplication("sca", "dependant", "request to add a child to health cover"),
  },
  applicationSchema: {
    type: "object",
    required: ["evidence"],
    additionalProperties: false,
    properties: { evidence: { type: "string", pattern: "^desk(:[0-9a-f-]{36})?$" } },
  },
  consentScope: "health_cover",
  summarize: (_f, subject) =>
    readBack(
      { child: rb.name(subject.full_name.split(" ")[0]) },
      (s) =>
        `Add ${s.child} to your health cover as a dependant, with the birth certificate you gave.`,
      (s) =>
        `Kumwongeza ${s.child} kwenye bima yako ya afya kama mtegemezi, kwa cheti cha kuzaliwa ulichotoa.`,
    ),
  decide: async ({ applicant, subject, fields, today }) => {
    // SH-03 (MED-296): a parent or guardian on record adds a child under 18; anything else is an
    // officer's to look at.
    const g = applicant.id === subject.id ? null : must(
      await db.from("guardianships").select("guardian_citizen_id")
        .eq("guardian_citizen_id", applicant.id).eq("child_citizen_id", subject.id).maybeSingle(),
    );
    if (!g || ageOn(subject.dob, today) >= 18) {
      return {
        outcome: "pending_officer",
        rule_ids: ["SH-03", "SH-04"],
        reason_en:
          "A dependant is a child of a parent or guardian on record, so an officer will look at this within 2 working days.",
        inputs: {},
      };
    }
    try {
      const e = await checkEvidence(String(fields.evidence), subject.id, ["birth_certificate"]);
      return {
        outcome: "granted",
        rule_ids: ["SH-03", "SH-04"],
        reason_en:
          "The child is added: the parent is on record and the birth certificate checks out.",
        inputs: { document: e.type, via: e.kind, cover_from: today },
        next_en: "Cover for the child starts today.",
      };
    } catch (err) {
      if (!(err instanceof KonzaError)) throw err;
      return {
        outcome: "pending_officer",
        rule_ids: ["SH-03", "SH-04"],
        reason_en:
          "The document could not be checked automatically, so an officer will decide within 2 working days.",
        inputs: { document_check: err.code },
      };
    }
  },
};

export const sca: Agency = {
  id: "sca",
  name: "Savanahlands Cover Authority",
  authority: "sca",
  desk: "Lango Square (Z1 B01 P001 U01)",
  services: { contribution, dependant },
};
