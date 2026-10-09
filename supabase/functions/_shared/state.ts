// State history (P13 D4). Status changes on payments, ID cards, permits, ID applications and
// tax exemption applications are recorded by database triggers. The backend adds rows that
// need a reason and a rule id (refunds, holds), optionally superseding an earlier row.

import { db, must } from "./db.ts";

export type StateEvent = {
  citizenId: string | null;
  conversationId: string;
  entityType: string;
  entityId: string;
  from: string | null;
  to: string;
  actor?: string;
  reason?: string;
  ruleId?: string;
  supersedes?: number;
};

export async function recordState(e: StateEvent): Promise<number> {
  const row = must(
    await db.from("state_events").insert({
      citizen_id: e.citizenId,
      conversation_id: e.conversationId,
      entity_type: e.entityType,
      entity_id: e.entityId,
      from_status: e.from,
      to_status: e.to,
      actor: e.actor ?? "agent",
      source: "backend",
      reason: e.reason ?? null,
      rule_id: e.ruleId ?? null,
      supersedes: e.supersedes ?? null,
    }).select("id").single(),
  );
  return row.id;
}
