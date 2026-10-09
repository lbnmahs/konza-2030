// Scenario 3: Pwani Njema County Government (market stall permit renewal, simulated payment).
// Every tool here is protected: the caller must have passed the SMS code on this call.

import { audit } from "../../_shared/audit.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { calculateRenewal } from "../../_shared/rules/ke/pn.ts";
import { type Citizen, requireVerified } from "../../_shared/session.ts";
import { swDateSpoken, swShillings } from "../../_shared/sw.ts";
import { str } from "../../_shared/util.ts";
import { freshStatus, latestPayment, registerCharge, statusReply } from "../common/payments.ts";
import type { Handler } from "../index.ts";

const kes = (n: number) => `KES ${Number(n).toLocaleString("en-GB")}`;

async function ownPermit(citizen: Citizen, permitId: string) {
  const p = must(
    await db.from("county_permits").select("*, county_markets(name, ward)").eq("id", permitId)
      .eq("citizen_id", citizen.id).maybeSingle(),
  );
  if (!p) throw new ToolError("unknown_permit", "Use permit_id from permit_lookup.");
  return p;
}

function quoteFor(p: any, today: string) {
  return calculateRenewal({
    category: p.category,
    expires: p.expires,
    arrears_kes: Number(p.arrears_kes),
    today,
  });
}

export const s3: Record<string, Handler> = {
  permit_lookup: async ({ conversationId, agent, args }) => {
    const citizen = await requireVerified(conversationId, agent, "permit_lookup");
    // Only the verified caller's own permits are ever searched. Callers often give the stall
    // ("B17") rather than the permit number, so match either; if nothing matches, return their
    // permit anyway and ask the agent to confirm it.
    const own = must(
      await db.from("county_permits").select("*, county_markets(name, ward)")
        .eq("citizen_id", citizen.id).order("expires"),
    );
    if (!own.length) {
      await audit(conversationId, agent.authority, "Service", "No permit found for this trader", {
        result: "warn",
      });
      throw new ToolError(
        "not_found",
        "No permit found. Offer a case for an officer to call back.",
      );
    }
    const key = str(args.permit_no).toUpperCase().replace(/[^0-9A-Z]/g, "");
    const norm = (v: string) => String(v).toUpperCase().replace(/[^0-9A-Z]/g, "");
    const matched = key
      ? own.filter((r: any) => norm(r.permit_no) === key || norm(r.stall) === key)
      : own;
    const confirmNeeded = key !== "" && matched.length === 0;
    const permits = matched.length ? matched : own;
    const p = permits[0];
    await audit(
      conversationId,
      agent.authority,
      "Service",
      `Permit found: ${p.permit_no}, stall ${p.stall}, ${p.county_markets.name}`,
    );
    return {
      permit_id: p.id,
      permit_no: p.permit_no,
      category: p.category,
      business_name: p.business_name,
      market: p.county_markets.name,
      stall: p.stall,
      expires: p.expires,
      expires_spoken_sw: swDateSpoken(p.expires),
      status: p.status,
      other_permits: permits.length - 1,
      ...(confirmNeeded
        ? {
          confirm_with_caller:
            "The number the caller gave did not match exactly. Read back the stall and market and continue only if the caller confirms this is their permit.",
        }
        : {}),
    };
  },

  rules_calculate_renewal: async ({ conversationId, agent, args, today }) => {
    const citizen = await requireVerified(conversationId, agent, "rules_calculate_renewal");
    const p = await ownPermit(citizen, str(args.permit_id));
    const q = quoteFor(p, today);
    if (!q.eligible) {
      await audit(
        conversationId,
        agent.authority,
        "Rules",
        `${q.ruleIds.join(", ")}: ${q.reason_en}`,
        {
          result: "warn",
          rule_ids: q.ruleIds,
        },
      );
      return {
        eligible: false,
        blocked: q.blocked,
        reason_sw: q.reason_sw,
        reason_en: q.reason_en,
        opens_on_spoken_sw: q.opens_on ? swDateSpoken(q.opens_on) : undefined,
        next: q.blocked
          ? "Explain the block and offer create_case for an officer. Do not take payment."
          : "Explain when renewal opens. Do not take payment.",
        rule_ids: q.ruleIds,
      };
    }
    await audit(
      conversationId,
      agent.authority,
      "Rules",
      `${q.ruleIds.filter((r) => r !== "PN-05").join(", ")}: eligible, total ${kes(q.total_kes)}`,
      { rule_ids: q.ruleIds },
    );
    return {
      eligible: true,
      fee_lines: q.fee_lines.map((l) => ({
        label_sw: l.label_sw,
        label_en: l.label_en,
        amount_kes: l.amount_kes,
        amount_spoken_sw: swShillings(l.amount_kes),
      })),
      total_kes: q.total_kes,
      total_spoken_sw: swShillings(q.total_kes),
      new_expiry_spoken_sw: swDateSpoken(q.new_expiry),
      rule_ids: q.ruleIds,
    };
  },

  permit_issue: async ({ conversationId, agent, args, today }) => {
    const citizen = await requireVerified(conversationId, agent, "permit_issue");
    const p = await ownPermit(citizen, str(args.permit_id));
    // Prefer an approved payment on this call for this permit; otherwise the newest one.
    const approved = must(
      await db.from("payments").select("*").eq("conversation_id", conversationId)
        .eq("permit_id", p.id).eq("status", "approved").order("created_at", { ascending: false })
        .limit(1),
    );
    const pay = approved[0] ?? await latestPayment(conversationId, p.id);
    if (!pay) throw new ToolError("no_payment", "No payment request on this call yet.");

    // Already issued for this payment: return the same result.
    if (p.renewed_payment_id === pay.id) {
      return {
        issued: true,
        permit_no: p.permit_no,
        new_expiry_spoken_sw: swDateSpoken(p.expires),
        verify_code: p.verify_code,
        txn_code: pay.txn_code,
      };
    }

    const cur = await freshStatus(pay, conversationId, agent);
    if (cur.status !== "approved") {
      await audit(
        conversationId,
        agent.authority,
        "Service",
        `Permit not issued: payment ${cur.status}`,
        {
          result: "warn",
        },
      );
      throw new ToolError(
        "payment_not_approved",
        `The payment is ${cur.status}, so the permit cannot be issued. ${
          statusReply(cur, agent).next
        }`,
        { payment_status: cur.status },
      );
    }

    const q = quoteFor(p, today);
    if (!q.eligible) throw new ToolError("not_eligible", "The rules no longer allow this renewal.");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const verifyCode = `PN-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;

    // Conditional on the permit not having changed since we read it (no double renewal).
    let upd = db.from("county_permits").update({
      expires: q.new_expiry,
      status: "active",
      verify_code: verifyCode,
      renewed_payment_id: pay.id,
    }).eq("id", p.id);
    upd = p.renewed_payment_id
      ? upd.eq("renewed_payment_id", p.renewed_payment_id)
      : upd.is("renewed_payment_id", null);
    const updated = must(await upd.select("id"));
    if (!updated.length) throw new ToolError("conflict", "Try permit_issue once more.");

    await audit(
      conversationId,
      agent.authority,
      "Service",
      `Permit ${p.permit_no} renewed to ${q.new_expiry}, code ${verifyCode}`,
      { rule_ids: ["PN-05"] },
    );
    return {
      issued: true,
      permit_no: p.permit_no,
      new_expiry_spoken_sw: swDateSpoken(q.new_expiry),
      verify_code: verifyCode,
      txn_code: pay.txn_code,
      next:
        "Read back the new expiry and the transaction code, then offer the SMS (send_message, template s3_permit_issued_sw).",
    };
  },
};

// payment_request for a permit renewal: the total always comes from PN rules (PN-02).
registerCharge("pwani_njema", {
  rulesTool: "rules_calculate_renewal",
  nextOnApproved: "Call permit_issue now.",
  resolve: async ({ args, today }, citizen) => {
    const p = await ownPermit(citizen, str(args.permit_id ?? args.case_ref));
    const q = quoteFor(p, today);
    if (!q.eligible) {
      throw new ToolError("not_eligible", "The rules do not allow payment for this permit now.");
    }
    return {
      case_ref: p.id,
      permit_id: p.id,
      amount: q.total_kes,
      payee: "Pwani Njema County",
      description: `permit renewal ${p.permit_no}`,
      reference: p.permit_no,
      rule_ids: ["PN-02"],
      say: { amount_spoken_sw: swShillings(q.total_kes) },
    };
  },
});
