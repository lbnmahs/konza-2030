import { db } from "./db.ts";

export type Actor =
  | "Call"
  | "Identity"
  | "Service"
  | "Rules"
  | "Payment"
  | "Follow-up"
  | "Escalation"
  | "Language"
  | "Upload"
  | "Partner"
  | "Accessibility"
  | "Refund";

export type AuditExtra = {
  data_used?: string;
  result?: "ok" | "warn" | "error";
  rule_ids?: string[];
  /** When the event happened, if not now (for rows written after the call). */
  ts?: string;
};

/** One row per actor per tool call. Protected data must already be masked. */
export async function audit(
  conversationId: string,
  authority: string,
  actor: Actor,
  action: string,
  extra: AuditExtra = {},
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    conversation_id: conversationId,
    authority,
    actor,
    action,
    data_used: extra.data_used ?? null,
    result: extra.result ?? "ok",
    rule_ids: extra.rule_ids ?? [],
    ...(extra.ts ? { ts: extra.ts } : {}),
  });
  if (error) console.error(JSON.stringify({ audit_error: error.message }));
}
