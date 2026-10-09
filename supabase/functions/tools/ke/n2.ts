// N2: Wezesha Njema Council with Kodi Njema Revenue Service, income tax exemption for persons
// with disabilities (DS-01 to DS-05). Registration and tax status, two uploads, an application
// awaiting vetting, a step-free vetting slot only when needed, payroll told only on approval
// (certificate number and start date), and a mobility charity now if the caller agrees.

import { audit } from "../../_shared/audit.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { DS_DOCUMENTS, DS_MONTHLY_LIMIT_KES } from "../../_shared/rules/ke/ds.ts";
import { type Citizen, requireVerified } from "../../_shared/session.ts";
import { swNumber } from "../../_shared/sw.ts";
import { digits, mask } from "../../_shared/util.ts";
import { registerPartnerFields } from "../common/partners.ts";
import { registerBooking } from "../common/registry.ts";
import { registerUploads } from "../common/uploads.ts";
import type { Handler } from "../index.ts";

const AUTHORITY = "wezesha_njema";

async function registrationOf(citizen: Citizen) {
  const r = must(
    await db.from("disability_registrations").select("*").eq("citizen_id", citizen.id)
      .maybeSingle(),
  );
  if (!r) {
    throw new ToolError(
      "not_registered",
      "DS-02: no registration with the council on this record. Offer a case so an officer explains how to register.",
    );
  }
  return r;
}

async function applicationOnCall(conversationId: string) {
  return must(
    await db.from("tax_exemption_applications").select("*").eq("conversation_id", conversationId)
      .maybeSingle(),
  );
}

async function documentsIn(conversationId: string, regNo: string) {
  const rows = must(
    await db.from("uploads").select("purpose").eq("conversation_id", conversationId)
      .eq("case_ref", regNo).eq("status", "received").in("purpose", [...DS_DOCUMENTS]),
  );
  return new Set(rows.map((r: any) => r.purpose));
}

async function verifiedCitizen(conversationId: string): Promise<Citizen | null> {
  const conv = must(
    await db.from("conversations").select("citizen_id, verified_at").eq("id", conversationId)
      .maybeSingle(),
  );
  if (!conv?.verified_at || !conv.citizen_id) return null;
  return must(await db.from("citizens").select("*").eq("id", conv.citizen_id).single());
}

export const n2: Record<string, Handler> = {
  disability_get_status: async ({ conversationId, agent }) => {
    const citizen = await requireVerified(conversationId, agent, "disability_get_status");
    const r = await registrationOf(citizen);
    await audit(
      conversationId,
      agent.authority,
      "Service",
      `Registration found; tax exemption: ${r.tax_exemption}`,
      { data_used: mask("Reg", r.reg_no), rule_ids: ["DS-02"] },
    );
    return {
      registered: true,
      registration_no: r.reg_no,
      tax_exemption: r.tax_exemption,
      employer: r.employer,
      needs_step_free_venue: r.step_free_needed,
      rule_ids: ["DS-02"],
      next:
        "Say they are registered and have no tax exemption yet. Explain the exemption with rules_disability_exemption.",
    };
  },

  rules_disability_exemption: async ({ conversationId, agent }) => {
    await audit(
      conversationId,
      agent.authority,
      "Rules",
      "DS-01 to DS-05: exempt up to KES 150,000 a month; two documents; joint vetting; certificate 5 years",
      { rule_ids: ["DS-01", "DS-02", "DS-03", "DS-04", "DS-05"] },
    );
    return {
      monthly_limit_kes: DS_MONTHLY_LIMIT_KES,
      monthly_limit_spoken_sw: `shilingi ${swNumber(DS_MONTHLY_LIMIT_KES)}`,
      documents: [
        {
          purpose: "disability_assessment",
          en: "disability assessment report",
          sw: "ripoti ya tathmini ya ulemavu",
        },
        {
          purpose: "income_proof",
          en: "proof of income, such as a payslip",
          sw: "uthibitisho wa mapato, kama payslip",
        },
      ],
      steps_sw: [
        "Pakia hati mbili.",
        "Ombi linasubiri vetting ya pamoja, ana kwa ana.",
        "Ukikubaliwa, cheti ni halali miaka mitano na payroll inakitumia kuanzia tarehe ya kuanza.",
      ],
      rule_ids: ["DS-01", "DS-02", "DS-03", "DS-04", "DS-05"],
      next:
        "Explain briefly. After a yes, send the two upload links (create_upload_link with purpose disability_assessment, then income_proof).",
    };
  },

  disability_submit_application: async ({ conversationId, agent }) => {
    const citizen = await requireVerified(conversationId, agent, "disability_submit_application");
    const r = await registrationOf(citizen);
    const existing = await applicationOnCall(conversationId);
    if (existing) return { application_ref: existing.ref, status: existing.status };
    const got = await documentsIn(conversationId, r.reg_no);
    const missing = DS_DOCUMENTS.filter((d) => !got.has(d));
    if (missing.length) {
      await audit(
        conversationId,
        agent.authority,
        "Rules",
        `DS-03: not submitted, ${missing.length} document(s) missing`,
        {
          result: "warn",
          rule_ids: ["DS-03"],
        },
      );
      throw new ToolError(
        "documents_missing",
        `DS-03: still waiting for ${missing.join(" and ")}. Check with get_upload_status.`,
        { missing },
      );
    }
    const ref = `WNC-TX-${digits(5)}`;
    must(
      await db.from("tax_exemption_applications").insert({
        ref,
        conversation_id: conversationId,
        citizen_id: citizen.id,
      }),
    );
    await audit(
      conversationId,
      agent.authority,
      "Service",
      `Application ${ref} submitted; awaiting joint vetting (DS-04)`,
      {
        rule_ids: ["DS-03", "DS-04"],
      },
    );
    return {
      application_ref: ref,
      status: "awaiting vetting",
      next:
        "Say it is submitted and waits for an in-person vetting. Offer a vetting slot (registry_list_offices); only step-free venues are offered if the caller needs one.",
    };
  },
};

registerUploads(AUTHORITY, {
  purposes: [...DS_DOCUMENTS],
  caseRef: async (_ctx, citizen) => (await registrationOf(citizen)).reg_no,
});

// DS-04: vetting in person; a caller who needs step-free access is only offered step-free venues.
registerBooking(AUTHORITY, {
  service: "disability_vetting",
  refPrefix: "WNC-VT",
  rule_ids: ["DS-04"],
  caseRef: async ({ conversationId }) => {
    const app = await applicationOnCall(conversationId);
    if (!app) {
      throw new ToolError(
        "no_application",
        "Submit the application first (disability_submit_application).",
      );
    }
    return app.ref;
  },
  check: async () => {},
  officeFilter: async ({ conversationId }) => {
    const citizen = await verifiedCitizen(conversationId);
    const r = citizen
      ? must(
        await db.from("disability_registrations").select("step_free_needed").eq(
          "citizen_id",
          citizen.id,
        ).maybeSingle(),
      )
      : null;
    return (office) => !r?.step_free_needed || office.step_free === true;
  },
});

// Partners: the payroll gets only the certificate number and start date, and only on approval;
// the mobility trust gets name, masked phone and area now.
registerPartnerFields(AUTHORITY, async ({ conversationId }, citizen) => {
  const r = await registrationOf(citizen);
  const app = await applicationOnCall(conversationId);
  const fields: Record<string, string> = { area: r.area };
  if (app?.certificate_no) fields.certificate_number = app.certificate_no;
  if (app?.start_date) fields.start_date = app.start_date;
  return { fields, case_ref: app?.ref ?? r.reg_no, linked_ref: app?.ref };
});
