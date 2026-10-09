// Refunds (P13 D5) and history (D4), shared by every authority. Each authority registers whether
// its fees are refundable and when its service has started; the outcome comes from
// _shared/rules/common/refunds.ts, never from the LLM. Approved refunds are processed at once
// (simulated). Routed refunds open an officer case.

import { audit } from "../../_shared/audit.ts";
import { type Agent, db, must, ToolError } from "../../_shared/db.ts";
import { daysBetween } from "../../_shared/rules/common/dates.ts";
import { refundDecision } from "../../_shared/rules/common/refunds.ts";
import { requireVerified } from "../../_shared/session.ts";
import { recordState } from "../../_shared/state.ts";
import { digits, str } from "../../_shared/util.ts";
import { money } from "./payments.ts";
import type { Handler } from "../index.ts";

type RefundPolicy = {
  refundable: boolean;
  /** Whether the service this payment paid for has started. */
  serviceStarted: (pay: any) => Promise<boolean>;
};

const POLICIES: Record<string, RefundPolicy> = {};

export function registerRefund(authorityId: string, p: RefundPolicy) {
  POLICIES[authorityId] = p;
}

async function paymentFor(citizenId: string, agent: Agent, ref: string) {
  const rows = must(
    await db.from("payments").select("*").eq("citizen_id", citizenId)
      .eq("authority", agent.authority).eq("status", "approved")
      .order("created_at", { ascending: false }),
  );
  if (!ref) return rows[0] ?? null;
  const want = ref.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return rows.find((p: any) =>
    [p.txn_code, p.reference, p.case_ref].some((v) =>
      v && String(v).replace(/[^0-9A-Za-z]/g, "").toUpperCase().endsWith(want)
    )
  ) ?? null;
}

const LABELS: Record<string, string> = {
  payments: "payment",
  id_cards: "ID card",
  county_permits: "market permit",
  id_applications: "ID replacement application",
  tax_exemption_applications: "tax exemption application",
  refunds: "refund",
};

export const refunds: Record<string, Handler> = {
  refund_request: async ({ conversationId, agent, args, today }) => {
    const citizen = await requireVerified(conversationId, agent, "refund_request");
    const pay = await paymentFor(citizen.id, agent, str(args.payment_ref));
    if (!pay) {
      throw new ToolError(
        "no_payment",
        "There is no completed payment to this service on the caller's record. Ask which payment they mean, or offer a case.",
      );
    }
    const existing = must(
      await db.from("refunds").select("*").eq("payment_id", pay.id)
        .neq("status", "declined").maybeSingle(),
    );
    if (existing) {
      return { status: existing.status, refund_ref: existing.ref, already_requested: true };
    }

    const policy = POLICIES[agent.authority];
    const dupes = must(
      await db.from("payments").select("id").eq("citizen_id", citizen.id)
        .eq("case_ref", pay.case_ref).eq("status", "approved").lt("created_at", pay.created_at),
    );
    const d = refundDecision({
      duplicate: dupes.length > 0,
      refundable: policy?.refundable ?? false,
      serviceStarted: policy ? await policy.serviceStarted(pay) : true,
      daysSincePayment: daysBetween(String(pay.created_at).slice(0, 10), today),
    });
    const reason = str(args.reason).slice(0, 300) || "not given";
    const ref = `RF-${digits(6)}`;

    let caseId: string | null = null;
    if (d.outcome === "routed") {
      caseId = must(
        await db.from("cases").upsert({
          conversation_id: conversationId,
          type: "refund_review",
          priority: "routine",
          summary: `${ref}: refund review for ${pay.reference} (${
            money(Number(pay.amount), pay.currency)
          }). Caller's reason: ${reason}`,
        }, { onConflict: "conversation_id,type" }).select("id").single(),
      ).id;
    }
    const status = d.outcome === "approved" ? "processed" : d.outcome;
    const row = must(
      await db.from("refunds").insert({
        ref,
        conversation_id: conversationId,
        citizen_id: citizen.id,
        payment_id: pay.id,
        authority: agent.authority,
        amount: pay.amount,
        currency: pay.currency,
        reason,
        status,
        rule_id: d.rule_id,
        case_id: caseId,
        processed_at: status === "processed" ? new Date().toISOString() : null,
      }).select("*").single(),
    );
    await recordState({
      citizenId: citizen.id,
      conversationId,
      entityType: "refunds",
      entityId: ref,
      from: null,
      to: status,
      reason: `${d.reason_en} Caller's reason: ${reason}`,
      ruleId: d.rule_id,
    });
    if (status === "processed") {
      await recordState({
        citizenId: citizen.id,
        conversationId,
        entityType: "payments",
        entityId: pay.id,
        from: "approved",
        to: "refunded",
        reason: `Refund ${ref}`,
        ruleId: d.rule_id,
      });
    }
    await audit(
      conversationId,
      agent.authority,
      "Refund",
      `${d.rule_id}: refund ${status} for ${money(Number(pay.amount), pay.currency)}`,
      { rule_ids: [d.rule_id], result: status === "declined" ? "warn" : "ok" },
    );
    return {
      status,
      refund_ref: row.ref,
      amount: Number(pay.amount),
      currency: pay.currency,
      rule_id: d.rule_id,
      reason: d.reason_en,
      next: status === "processed"
        ? "Tell the caller the refund is approved and on its way back to the account that paid. Offer the SMS summary."
        : status === "declined"
        ? "Tell the caller plainly that the refund is not possible and why. Offer a case if they disagree."
        : "Tell the caller an officer will review the refund and call back. The case is already open.",
    };
  },

  get_history: async ({ conversationId, agent, args }) => {
    const citizen = await requireVerified(conversationId, agent, "get_history");
    const asOf = str(args.as_of);
    let q = db.from("state_events").select("*").eq("citizen_id", citizen.id);
    if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) q = q.lte("at", `${asOf}T23:59:59Z`);
    const rows = must(await q.order("at", { ascending: true }).limit(200));
    const superseded = new Set(rows.map((r: any) => r.supersedes).filter(Boolean));
    const byEntity = new Map<string, any>();
    for (const r of rows) {
      const key = `${r.entity_type}:${r.entity_id}`;
      const e = byEntity.get(key) ??
        { what: LABELS[r.entity_type] ?? r.entity_type, ref: r.entity_id, changes: [] };
      e.changes.push({
        on: String(r.at).slice(0, 10),
        from: r.from_status,
        to: r.to_status,
        ...(r.reason ? { reason: r.reason } : {}),
        ...(r.rule_id ? { rule_id: r.rule_id } : {}),
        ...(superseded.has(r.id) ? { overridden: true } : {}),
      });
      e.status = r.to_status;
      e.last = r.at;
      byEntity.set(key, e);
    }
    const items = [...byEntity.values()].sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 6)
      .map(({ last: _last, ...e }) => ({ ...e, changes: e.changes.slice(-4) }));
    await audit(conversationId, agent.authority, "Service", "History read for the caller");
    return {
      items,
      ...(asOf ? { as_of: asOf } : {}),
      next:
        "Answer only what the caller asked: the current status first, then what changed and when. Do not read references aloud.",
    };
  },
};
