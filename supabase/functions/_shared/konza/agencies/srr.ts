// Savanahlands Residents Registry (SRR): arrival (K3, MED-287; world.md AR-01 to AR-04, DK-01,
// DK-02). An address is registered with a tenancy or an employer letter; a parent registers a
// child with the birth certificate; the resident card is delivered or collected at Lango Square.
// Evidence is a Lango Square desk record. A document that does not check out
// goes to an officer; nothing is refused by rule.

import { db, must } from "../../db.ts";
import { checkEvidence } from "../evidence.ts";
import { myApplication } from "../status.ts";
import { type DecisionDraft, KonzaError, type Resident, type ServiceDef } from "../types.ts";
import type { Agency } from "../types.ts";
import { rb, readBack } from "../../readback.ts";

const EVIDENCE = { type: "string", pattern: "^desk(:[0-9a-f-]{36})?$" };

async function evidenceOrOfficer(
  evidence: string,
  about: Resident,
  types: string[],
  granted: Omit<DecisionDraft, "outcome">,
): Promise<DecisionDraft> {
  try {
    const e = await checkEvidence(evidence, about.id, types);
    return {
      outcome: "granted",
      ...granted,
      inputs: { ...granted.inputs, document: e.type, via: e.kind },
    };
  } catch (err) {
    if (!(err instanceof KonzaError)) throw err;
    return {
      outcome: "pending_officer",
      rule_ids: granted.rule_ids,
      reason_en: "The document could not be checked automatically, so an officer will look at it.",
      inputs: { document_check: err.code },
    };
  }
}

const card = { kind: "resident_card" as const, holderOnly: false };

const addressRegistration: ServiceDef = {
  title: "Address registration and resident card",
  card: [
    "Requirements need no personal details: rules_lookup topic requirements.",
    "A returning caller: rules_lookup topic my_application gives their application (or their child's), the decision and its reason, any fee still owed, and delivery.",
    "Verify the resident. The address is registered with a tenancy agreement or an employer letter (AR-02): handed in at Lango Square (an officer records it); then field evidence is just desk.",
    "application_submit with field evidence; read back, clear yes, then again with the confirmation_id.",
    "Say the decision and its reason. If an officer must check the document, say so; never say it was refused.",
    "The resident card can be delivered home (delivery_book) or collected free at Lango Square (method collect).",
  ].join("\n"),
  topics: {
    my_application: myApplication("srr", "address_registration", "address registration"),
    requirements: {
      needsResident: false,
      answer: () =>
        Promise.resolve({
          topic: "requirements",
          values: {
            free: true,
            address_documents: ["tenancy", "employer_letter"],
            child_documents: ["birth_certificate"],
            hand_in: "Lango Square, Z1 B01 P001 U01, working days 8 to 5",
          },
          rule_ids: ["AR-01", "AR-02", "AR-03", "DK-01"],
          reason_en:
            "Registering is free. An address needs a tenancy agreement or an employer letter; a child needs the birth certificate. Paper can be handed in at Lango Square.",
        }),
    },
  },
  applicationSchema: {
    type: "object",
    required: ["evidence"],
    additionalProperties: false,
    properties: { evidence: EVIDENCE },
  },
  consentScope: null,
  summarize: () =>
    readBack(
      {},
      () => "Register your address with the document you gave, and issue your resident card.",
      () => "Kusajili anwani yako kwa hati uliyotoa, na kukupa kadi yako ya mkazi.",
    ),
  decide: async ({ subject, fields }) =>
    await evidenceOrOfficer(String(fields.evidence), subject, ["tenancy", "employer_letter"], {
      rule_ids: ["AR-02"],
      reason_en: "The address is registered: the document checks out for this resident.",
      inputs: {},
      next_en: "Your resident card can be delivered home or collected free at Lango Square.",
    }),
  deliverable: card,
};

const childRegistration: ServiceDef = {
  title: "Registering a child",
  card: [
    "Verify the parent. Only a recorded parent or guardian registers a child, with consent recorded first (consent_record, scope registration).",
    "The birth certificate is handed in at Lango Square; then field evidence is just desk.",
    "application_submit with on_behalf_of the child and field evidence; read back, clear yes, then again with the confirmation_id.",
    "Speak about the child by first name only.",
    "A returning caller: rules_lookup topic my_application gives their application (or their child's), the decision and its reason, any fee still owed, and delivery.",
  ].join("\n"),
  topics: {
    requirements: addressRegistration.topics.requirements,
    my_application: myApplication("srr", "child_registration", "child registration"),
  },
  applicationSchema: addressRegistration.applicationSchema,
  consentScope: "registration",
  summarize: (_f, subject) =>
    readBack(
      { child: rb.name(subject.full_name.split(" ")[0]) },
      (s) => `Register ${s.child} as a resident with the birth certificate you gave.`,
      (s) => `Kumsajili ${s.child} kama mkazi kwa cheti cha kuzaliwa ulichotoa.`,
    ),
  decide: async ({ applicant, subject, fields }) => {
    const g = must(
      await db.from("guardianships").select("guardian_citizen_id").eq(
        "guardian_citizen_id",
        applicant.id,
      )
        .eq("child_citizen_id", subject.id).maybeSingle(),
    );
    if (!g) {
      return {
        outcome: "pending_officer",
        rule_ids: ["AR-03"],
        reason_en: "The parent link is not on record, so an officer will check it.",
        inputs: {},
      };
    }
    return await evidenceOrOfficer(String(fields.evidence), subject, ["birth_certificate"], {
      rule_ids: ["AR-03"],
      reason_en:
        "The child is registered: the parent is on record and the birth certificate checks out.",
      inputs: {},
      next_en: "The child's resident card can be delivered home or collected free at Lango Square.",
    });
  },
  deliverable: card,
};

export const srr: Agency = {
  id: "srr",
  name: "Savanahlands Residents Registry",
  authority: "srr",
  desk: "Lango Square (Z1 B01 P001 U01)",
  services: { address_registration: addressRegistration, child_registration: childRegistration },
};
