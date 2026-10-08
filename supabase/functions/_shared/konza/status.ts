// A resident's own application with an agency (K6, MED-312): the topic my_application for the
// agencies that had none (school, health cover, residents registry). Everything comes from the
// stored decision and payments, never from the assistant: the outcome and who decided, the
// decision's own reason and next step, any fee still owed, and delivery or collection. Covers
// applications the resident made (a parent for a child) or that are about them.

import { db, must } from "../db.ts";
import type { ServiceDef } from "./types.ts";

type Topic = ServiceDef["topics"][string];

/** The newest application of this agency's service for or by the resident. */
export function myApplication(agency: string, service: string, what: string): Topic {
  return {
    needsResident: true,
    answer: async (r) => {
      const a = r
        ? must(
          await db.from("konza_applications").select("id, ref").eq("agency", agency)
            .eq("service", service)
            .or(`applicant_citizen_id.eq.${r.id},subject_citizen_id.eq.${r.id}`)
            .order("created_at", { ascending: false }).limit(1),
        )[0]
        : null;
      if (!a) {
        return {
          topic: "my_application",
          values: { has_application: false },
          rule_ids: [],
          reason_en: `There is no ${what} on record for this resident.`,
        };
      }
      const [d, paid, del] = await Promise.all([
        db.from("konza_decisions").select(
          "outcome, decided_by, rule_ids, reason_en, next_en, inputs",
        )
          .eq("application_id", a.id).single().then(must),
        db.from("payments").select("amount").eq("case_ref", a.ref).eq("status", "approved")
          .then(must),
        db.from("deliveries").select("method, deliver_on, window").eq("item_ref", a.id)
          .neq("status", "cancelled").maybeSingle().then(must),
      ]);
      // A fee or contribution the rules set on the decision, less what has cleared.
      const due = d.outcome === "granted"
        ? Number(d.inputs?.fee_kes ?? d.inputs?.contribution_kes ?? 0) || 0
        : 0;
      const owed = Math.max(
        0,
        due - paid.reduce((n: number, p: { amount: number }) => n + Number(p.amount), 0),
      );
      const who = d.decided_by === "rule"
        ? "decided by a published rule"
        : d.decided_by === "officer"
        ? "decided by an officer"
        : "waiting for an officer";
      return {
        topic: "my_application",
        values: {
          has_application: true,
          ref: a.ref,
          outcome: d.outcome,
          decided_by: d.decided_by,
          owed_kes: owed,
          paid: paid.length > 0,
          delivery: del ?? null,
        },
        rule_ids: d.rule_ids ?? [],
        reason_en: `Application ${a.ref}: ${d.outcome.replace("_", " ")}, ${who}. ${d.reason_en}${
          owed ? ` KES ${owed} is still owed.` : ""
        }${d.next_en ? ` Next: ${d.next_en}` : ""}`,
      };
    },
  };
}
