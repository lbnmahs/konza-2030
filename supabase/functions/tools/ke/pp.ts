// Kenyan passport renewal on NJIA (P15): Njema Passport Service (fictional). Rules in
// _shared/rules/ke/pp.ts. Order: quote (public), status (verified), apply (two-step), pay, then
// biometrics at the chosen desk (Nairobi, or the NJIA consular desks in London and Berlin).

import { audit } from "../../_shared/audit.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { PASSPORT_FEES_KES, passportQuote, renewalOpen } from "../../_shared/rules/ke/pp.ts";
import { type Citizen, requireVerified } from "../../_shared/session.ts";
import { swDateSpoken, swShillings } from "../../_shared/sw.ts";
import { digits, mask, spokenDate, str } from "../../_shared/util.ts";
import type { Handler } from "../index.ts";
import { feePaid } from "../common/id_replacement.ts";
import { registerCharge } from "../common/payments.ts";
import { registerRefund } from "../common/refunds.ts";
import { registerBooking } from "../common/registry.ts";

const AUTHORITY = "njema_passports";
const AREAS: Record<string, string> = { nairobi: "Nairobi", london: "London", berlin: "Berlin" };

async function currentPassport(citizen: Citizen) {
  return must(
    await db.from("passports").select("*").eq("citizen_id", citizen.id).eq("status", "active")
      .order("expires", { ascending: false }).limit(1),
  )[0] ?? null;
}

async function applicationOf(conversationId: string, citizen: Citizen) {
  const app = must(
    await db.from("passport_applications").select("*").eq("conversation_id", conversationId)
      .eq("citizen_id", citizen.id).eq("status", "submitted").maybeSingle(),
  );
  if (!app) {
    throw new ToolError("no_application", "There is no passport application on this call yet.");
  }
  return app;
}

registerCharge(AUTHORITY, {
  rulesTool: "passport_quote",
  nextOnApproved:
    "Payment received. Offer the biometrics appointment at the desk the caller chose (registry_list_offices, then registry_book_slot after a clear yes).",
  resolve: async ({ conversationId }, citizen) => {
    const app = await applicationOf(conversationId, citizen);
    return {
      case_ref: app.ref,
      amount: Number(app.fee),
      payee: "Njema Passport Service",
      description: `Passport renewal ${app.ref}`,
      reference: app.ref,
      rule_ids: ["PP-01"],
      say: { amount_spoken_sw: swShillings(Number(app.fee)) },
    };
  },
});

registerBooking(AUTHORITY, {
  service: "passport_biometrics",
  refPrefix: "NPS-BIO",
  rule_ids: ["PP-03"],
  caseRef: async ({ conversationId }, citizen) =>
    (await applicationOf(conversationId, citizen)).ref,
  check: async ({ conversationId, agent }, _citizen, caseRef) => {
    if (!await feePaid(conversationId, caseRef)) {
      await audit(conversationId, agent.authority, "Rules", "PP-03: refused, fee not paid", {
        result: "warn",
        rule_ids: ["PP-03"],
      });
      throw new ToolError(
        "booking_refused",
        "The fee must be paid first (payment_request, then payment_get_status).",
      );
    }
  },
  // Only desks in the area the caller chose when applying.
  officeFilter: async ({ conversationId }) => {
    const conv = must(
      await db.from("conversations").select("citizen_id").eq("id", conversationId).single(),
    );
    const app = must(
      await db.from("passport_applications").select("desk_area").eq(
        "conversation_id",
        conversationId,
      )
        .eq("citizen_id", conv.citizen_id).maybeSingle(),
    );
    return (office: any) => !app || office.area === app.desk_area;
  },
});

registerRefund(AUTHORITY, {
  refundable: true,
  serviceStarted: async (pay) =>
    must(
      await db.from("registry_bookings").select("id").eq("case_ref", pay.case_ref).limit(1),
    ).length > 0,
});

export const kePassport: Record<string, Handler> = {
  passport_quote: async ({ conversationId, args }) => {
    const pages = Number(args.pages);
    const q = passportQuote(pages);
    await audit(conversationId, AUTHORITY, "Rules", "PP-01: passport fees given", {
      rule_ids: ["PP-01"],
    });
    return {
      fees: Object.entries(PASSPORT_FEES_KES).map(([p, fee]) => ({
        pages: Number(p),
        fee_kes: fee,
        fee_spoken_sw: swShillings(fee),
      })),
      ...(q ? { chosen: { ...q, fee_spoken_sw: swShillings(q.fee_kes) } } : {}),
      steps: [
        "Apply on this call (the fee is paid by mobile money).",
        "Biometrics in person at the NJIA desk in Nairobi, or the NJIA consular desk in London or Berlin.",
        "The new passport is ready about 10 working days after biometrics (modelled).",
        "The old passport stays valid until you collect the new one.",
      ],
      rule_ids: ["PP-01", "PP-03", "PP-04", "PP-05"],
      approximate: ["PP-04"],
      next:
        "Answer the question. Only if the caller wants to renew now, check their passport with passport_status (that needs verification).",
    };
  },

  passport_status: async ({ conversationId, agent, today }) => {
    const citizen = await requireVerified(conversationId, agent, "passport_status");
    const p = await currentPassport(citizen);
    if (!p) {
      throw new ToolError(
        "no_passport",
        "No passport on this record. A first passport is not on this line: offer a case.",
      );
    }
    const r = renewalOpen({ expires: p.expires, today });
    await audit(conversationId, AUTHORITY, "Service", `Passport checked (${r.rule_id})`, {
      data_used: mask("Passport", p.number),
      rule_ids: [r.rule_id],
    });
    return {
      passport_last4: String(p.number).slice(-4),
      pages: p.pages,
      expires_spoken: spokenDate(p.expires, true),
      expires_spoken_sw: swDateSpoken(p.expires),
      renewal_open: r.open,
      reason: r.reason_en,
      rule_id: r.rule_id,
      next: r.open
        ? "Ask which booklet (34, 50 or 66 pages) and where they will give biometrics (Nairobi, London or Berlin), then passport_apply."
        : "Explain renewal is not open yet and when it opens. Ask if the passport is full or damaged; if so, passport_apply with full_or_damaged true.",
    };
  },

  passport_apply: async ({ conversationId, agent, args, today }) => {
    const citizen = await requireVerified(conversationId, agent, "passport_apply");
    const p = await currentPassport(citizen);
    const pages = Number(args.pages);
    const q = passportQuote(pages);
    const area = AREAS[str(args.desk).toLowerCase()];
    if (!q || !area) {
      throw new ToolError(
        "need_details",
        "Ask which booklet (34, 50 or 66 pages) and which desk (Nairobi, London or Berlin).",
      );
    }
    if (p) {
      const r = renewalOpen({
        expires: p.expires,
        today,
        fullOrDamaged: args.full_or_damaged === true,
      });
      if (!r.open) throw new ToolError("not_open", `${r.reason_en} Explain this to the caller.`);
    }
    const existing = must(
      await db.from("passport_applications").select("*").eq("conversation_id", conversationId)
        .eq("citizen_id", citizen.id).maybeSingle(),
    );
    const app = existing ?? must(
      await db.from("passport_applications").insert({
        ref: `NPS-APP-${digits(5)}`,
        conversation_id: conversationId,
        citizen_id: citizen.id,
        passport_id: p?.id ?? null,
        authority: AUTHORITY,
        pages,
        fee: q.fee_kes,
        desk_area: area,
      }).select("*").single(),
    );
    if (!existing) {
      await audit(
        conversationId,
        AUTHORITY,
        "Service",
        `Passport application ${app.ref}: ${pages} pages, biometrics in ${area}`,
        { rule_ids: ["PP-01", "PP-03"] },
      );
    }
    return {
      application_ref: app.ref,
      fee_kes: Number(app.fee),
      fee_spoken_sw: swShillings(Number(app.fee)),
      desk: area,
      ready_after_biometrics_days: 10,
      next:
        "Say the fee and ask a clear yes before payment_request with amount_kes equal to the fee. After approval, offer the biometrics appointment.",
    };
  },
};
