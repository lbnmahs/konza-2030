export type Conversation = {
  id: string;
  agent_id: string | null;
  authority: string;
  language: string;
  started_at: string;
  ended_at: string | null;
  duration_secs: number | null;
  verified_at: string | null;
  citizen_id: string | null;
};

export type AuditRow = {
  id: number;
  ts: string;
  conversation_id: string | null;
  authority: string | null;
  actor: string;
  action: string;
  data_used: string | null;
  result: "ok" | "warn" | "error";
  rule_ids: string[] | null;
};

export type PaymentStatus = "pending" | "approved" | "declined" | "expired";

export type Payment = {
  id: string;
  conversation_id: string | null;
  citizen_id: string | null;
  permit_id: string | null;
  amount: number | string;
  currency: string;
  reference: string | null;
  status: PaymentStatus;
  txn_code: string | null;
  created_at: string;
  authority: string | null;
  payee: string | null;
  description: string | null;
  case_ref: string | null;
};

// Reference row from the `authorities` table (anon can read it).
export type Authority = {
  id: string;
  country: "GB" | "KE" | "AE";
  name: string;
  default_language: string;
  languages: string[];
  currency: "GBP" | "KES" | "AED";
  timezone: string;
  payment_skin: PaymentSkin;
};

export type PaymentSkin = "mobile_money" | "card";

// The authority's skin; if its row is missing, KES reads as mobile money and
// anything else as a card. The route and /pesa use the same rule.
export function paymentSkin(
  authoritySkin: PaymentSkin | null | undefined,
  currency: string,
): PaymentSkin {
  return authoritySkin ?? (currency === "KES" ? "mobile_money" : "card");
}

// A pending payment older than this reads as expired (no background job).
export const PAYMENT_TTL_MS = 90_000;
