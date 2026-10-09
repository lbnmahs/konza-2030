// K1: Tiba Njema Cover Authority, "the hospital says I'm not covered". Cover first (SH-01,
// SH-02: pay this month's contribution), confirmation code by SMS, then the newborn
// (SH-03 birth notification upload, SH-04 decision in 2 working days).

import { audit } from "../../_shared/audit.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { addDays } from "../../_shared/rules/common/dates.ts";
import {
  contributionDue,
  coverStatus,
  dependantDecisionBy,
  monthOf,
  newbornDobValid,
} from "../../_shared/rules/ke/sh.ts";
import { type Citizen, requireVerified } from "../../_shared/session.ts";
import { sms } from "../../_shared/sms.ts";
import { swDayMonth, swMonth, swShillings } from "../../_shared/sw.ts";
import { digits, mask, spokenDate, str } from "../../_shared/util.ts";
import { latestPayment, registerCharge, statusReply } from "../common/payments.ts";
import { registerUploads } from "../common/uploads.ts";
import type { Handler } from "../index.ts";

const AUTHORITY = "tiba_njema";
const CONFIRMATION_TEMPLATE = "k1_cover_confirmation";

async function memberOf(citizen: Citizen) {
  const m = must(
    await db.from("health_members").select("*").eq("citizen_id", citizen.id).maybeSingle(),
  );
  if (!m) {
    throw new ToolError("not_a_member", "No membership found. Offer a case for an officer.");
  }
  return m;
}

async function paidMonths(memberId: string): Promise<string[]> {
  return must(
    await db.from("health_contributions").select("month").eq("member_id", memberId),
  ).map((r: any) => r.month);
}

export const k1: Record<string, Handler> = {
  health_get_member_status: async ({ conversationId, agent, today }) => {
    const citizen = await requireVerified(conversationId, agent, "health_get_member_status");
    const m = await memberOf(citizen);
    const s = coverStatus(await paidMonths(m.id), today);
    const deps = must(
      await db.from("health_dependants").select("relationship, status").eq("member_id", m.id),
    );
    await audit(
      conversationId,
      agent.authority,
      "Rules",
      `SH-01: cover ${s.active ? "ACTIVE" : "INACTIVE"}${
        s.last_paid_month ? `, last contribution ${s.last_paid_month}` : ""
      }`,
      {
        data_used: mask("Member", m.member_no),
        result: s.active ? "ok" : "warn",
        rule_ids: s.rule_ids,
      },
    );
    return {
      member_no: m.member_no,
      scheme: m.scheme,
      cover_active: s.active,
      last_paid_month_spoken_sw: s.last_paid_month
        ? swMonth(s.last_paid_month).split(" ")[0]
        : null,
      months_behind: s.months_behind,
      dependants: deps,
      rule_ids: s.rule_ids,
      next: s.active
        ? "Cover is active. Offer the cover confirmation (health_issue_cover_confirmation)."
        : "Cover is not active because this month's contribution has not cleared. Call rules_contribution_due and explain it.",
    };
  },

  rules_contribution_due: async ({ conversationId, agent, today }) => {
    const citizen = await requireVerified(conversationId, agent, "rules_contribution_due");
    const m = await memberOf(citizen);
    const due = contributionDue(await paidMonths(m.id), today);
    if (!due) {
      return { cover_active: true, amount_kes: 0, next: "Nothing is due; cover is active." };
    }
    await audit(
      conversationId,
      agent.authority,
      "Rules",
      `SH-01, SH-02: KES ${due.amount_kes} for ${due.month} restores cover`,
      { rule_ids: due.rule_ids },
    );
    return {
      cover_active: false,
      amount_kes: due.amount_kes,
      amount_spoken_sw: swShillings(due.amount_kes),
      month_spoken_sw: swMonth(due.month).split(" ")[0],
      cover_from_spoken_sw: swDayMonth(due.cover_from),
      cover_from_spoken: spokenDate(due.cover_from),
      rule_ids: due.rule_ids,
      next:
        "Explain the amount and that cover is active once it clears. Ask a clear yes, then payment_request with amount_kes.",
    };
  },

  health_record_contribution: async ({ conversationId, agent, today }) => {
    const citizen = await requireVerified(conversationId, agent, "health_record_contribution");
    const m = await memberOf(citizen);
    const month = monthOf(today);
    const pay = await latestPayment(conversationId);
    if (!pay || pay.status !== "approved" || pay.case_ref !== `${m.member_no}-${month}`) {
      const reason = pay ? statusReply(pay, agent).next : "No payment request on this call yet.";
      throw new ToolError("payment_not_approved", `The contribution has not cleared. ${reason}`);
    }
    const { error } = await db.from("health_contributions").insert({
      member_id: m.id,
      month,
      amount: pay.amount,
      payment_id: pay.id,
      paid_on: today,
    });
    if (!error) {
      await audit(
        conversationId,
        agent.authority,
        "Service",
        `Contribution for ${month} recorded (${pay.txn_code}); cover ACTIVE`,
        { rule_ids: ["SH-01", "SH-02"] },
      );
    }
    return {
      recorded: true,
      cover_active: true,
      txn_code: pay.txn_code,
      next:
        "Tell the caller cover is active now. Offer the cover confirmation code by SMS for the hospital (health_issue_cover_confirmation).",
    };
  },

  health_issue_cover_confirmation: async ({ conversationId, agent, today }) => {
    const citizen = await requireVerified(
      conversationId,
      agent,
      "health_issue_cover_confirmation",
    );
    const m = await memberOf(citizen);
    if (!coverStatus(await paidMonths(m.id), today).active) {
      await audit(
        conversationId,
        agent.authority,
        "Rules",
        "SH-01: no confirmation, cover inactive",
        {
          result: "warn",
          rule_ids: ["SH-01"],
        },
      );
      throw new ToolError(
        "cover_inactive",
        "Cover is not active, so no confirmation can be issued. The contribution must clear first.",
      );
    }
    const found = must(
      await db.from("health_cover_confirmations").select("code").eq(
        "conversation_id",
        conversationId,
      )
        .maybeSingle(),
    );
    if (found) return { sent: true, already_sent: true, code: found.code };

    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from(
      crypto.getRandomValues(new Uint8Array(6)),
      (b) => alphabet[b % alphabet.length],
    ).join("");
    const body = `Tiba Njema (DEMO): uthibitisho wa bima ${code}. ${
      mask("Mwanachama", m.member_no)
    }, bima hai ${swMonth(monthOf(today))}. Onyesha code hii hospitalini. Huduma ya kubuni.`;
    const { sid } = await sms(citizen.phone, body, conversationId);
    must(
      await db.from("health_cover_confirmations").insert({
        conversation_id: conversationId,
        member_id: m.id,
        code,
      }),
    );
    must(
      await db.from("messages").upsert({
        conversation_id: conversationId,
        citizen_id: citizen.id,
        template: CONFIRMATION_TEMPLATE,
        body,
        twilio_sid: sid,
        status: "sent",
      }, { onConflict: "conversation_id,template" }),
    );
    await audit(
      conversationId,
      agent.authority,
      "Follow-up",
      `Cover confirmation sent to phone ending ${citizen.phone.slice(-3)}`,
      { rule_ids: ["SH-01"] },
    );
    return {
      sent: true,
      code,
      phone_last3: citizen.phone.slice(-3),
      next:
        "Say the code one character at a time. It confirms active cover only; never say whether a specific treatment is covered, the hospital checks that.",
    };
  },

  health_add_dependant: async ({ conversationId, agent, args, today }) => {
    const citizen = await requireVerified(conversationId, agent, "health_add_dependant");
    const m = await memberOf(citizen);
    const name = str(args.dependant_name).slice(0, 80);
    const bornDaysAgo = Number(args.born_days_ago);
    const dob = str(args.born_days_ago) !== "" && Number.isInteger(bornDaysAgo) && bornDaysAgo >= 0
      ? addDays(today, -bornDaysAgo)
      : str(args.dependant_dob);
    const relationship = str(args.relationship) || "child";
    if (!name) throw new ToolError("missing_name", "Ask for the baby's name.");
    if (relationship === "child" && !newbornDobValid(dob, today)) {
      throw new ToolError(
        "bad_dob",
        "Give born_days_ago or dependant_dob (YYYY-MM-DD), a real date in the past 12 months. Ask the caller again.",
      );
    }
    const existing = must(
      await db.from("health_dependants").select("ref, decision_by").eq(
        "conversation_id",
        conversationId,
      )
        .eq("member_id", m.id).eq("dependant_name", name).maybeSingle(),
    );
    if (existing) {
      return {
        requested: true,
        dependant_ref: existing.ref,
        decision_by_spoken_sw: swDayMonth(existing.decision_by),
        decision_by_spoken: spokenDate(existing.decision_by),
      };
    }
    const upload = must(
      await db.from("uploads").select("id").eq("conversation_id", conversationId)
        .eq("purpose", "birth_notification").eq("status", "received")
        .order("received_at", { ascending: false }).limit(1),
    )[0];
    if (!upload) {
      await audit(
        conversationId,
        agent.authority,
        "Rules",
        "SH-03: dependant refused, no birth notification yet",
        {
          result: "warn",
          rule_ids: ["SH-03"],
        },
      );
      throw new ToolError(
        "needs_birth_notification",
        "SH-03: the birth notification or certificate must be uploaded first. Offer the upload link (create_upload_link, purpose birth_notification) and check with get_upload_status.",
      );
    }
    const decisionBy = dependantDecisionBy(today);
    const ref = `TN-DEP-${digits(5)}`;
    must(
      await db.from("health_dependants").insert({
        ref,
        conversation_id: conversationId,
        member_id: m.id,
        dependant_name: name,
        dependant_dob: dob,
        relationship,
        upload_id: upload.id,
        decision_by: decisionBy,
      }),
    );
    await audit(
      conversationId,
      agent.authority,
      "Service",
      `Dependant request ${ref} (${relationship}) submitted; decision by ${decisionBy}`,
      { rule_ids: ["SH-03", "SH-04"] },
    );
    return {
      requested: true,
      dependant_ref: ref,
      dob_spoken_sw: swDayMonth(dob),
      decision_by_spoken_sw: swDayMonth(decisionBy),
      decision_by_spoken: spokenDate(decisionBy),
      rule_ids: ["SH-03", "SH-04"],
      next:
        "Explain the baby is covered from approval, decided by the date given. Offer the SMS summary (send_message, template k1_summary_sw).",
    };
  },
};

registerCharge(AUTHORITY, {
  rulesTool: "rules_contribution_due",
  nextOnApproved: "Call health_record_contribution now.",
  resolve: async ({ today }, citizen) => {
    const m = await memberOf(citizen);
    const due = contributionDue(await paidMonths(m.id), today);
    if (!due) throw new ToolError("not_due", "Cover is already active; nothing to pay.");
    return {
      case_ref: `${m.member_no}-${due.month}`,
      amount: due.amount_kes,
      payee: "Tiba Njema Cover Authority",
      description: `contribution ${swMonth(due.month)}`,
      reference: m.member_no,
      rule_ids: ["SH-02"],
      say: { amount_spoken_sw: swShillings(due.amount_kes) },
    };
  },
});

registerUploads(AUTHORITY, {
  purposes: ["birth_notification"],
  caseRef: async (_ctx, citizen) => (await memberOf(citizen)).member_no,
});
