// K8: web mirror of spec/konza-2030-api/ui/catalog.schema.json (ui/v1). A test fails if the
// kinds here and in the schema drift apart. Text is always rendered as text, never as markup.

export type Lang = "en" | "sw";
export type Text = { en: string; sw?: string };
export const say = (t: Text | undefined, lang: Lang) => (t ? (lang === "sw" && t.sw) || t.en : "");

export const KINDS = [
  "progress",
  "quote",
  "identity",
  "form",
  "confirm",
  "slots",
  "payment",
  "receipt",
] as const;
export type Kind = (typeof KINDS)[number];

export type StepId = "identity" | "consent" | "details" | "confirm" | "pay" | "book" | "deliver" | "decision";

export type Progress = {
  service: string;
  title: Text;
  steps: { id: StepId; state: "todo" | "current" | "done" }[];
  /** The newest recorded step: when, and by what. */
  updated?: { at: string; source: Text };
};

export type Identity = {
  step: "details" | "code" | "verified";
  channel?: "sms" | "voice";
  expires_at?: string;
  attempts_left?: number;
};

export type FormField = {
  name: string;
  type: "integer" | "string" | "boolean" | "evidence";
  multiple?: boolean;
  label: Text;
  required: boolean;
  options?: { value: string | number; label: Text }[];
  value?: string | number | boolean;
};

export type Form = { service: string; title: Text; fields: FormField[] };

/** A resident's own payment method, masked (MED-332). */
export type PayMethod = { method_id: string; type: "card" | "mobile_money"; label: Text; masked: string };

/** MED-332: choose a method, then the card's texted code or the mobile money PIN, then paid. */
export type Payment = {
  payment_id: string;
  state: "choose" | "code" | "pin" | "waiting" | "approved" | "declined" | "expired";
  amount_kes: number;
  label: Text;
  channel?: "sms" | "voice";
  expires_at: string;
  desk: Text;
  methods?: PayMethod[];
  method_id?: string;
  attempts_left?: number;
  /** The transaction reference once approved (MED-331). */
  reference?: string;
};

export type Quote = {
  title: Text;
  rows: { label: Text; amount_kes: number }[];
  rule_ids: string[];
};

export type Confirm = {
  confirmation_id: string;
  tool: string;
  variant: "action" | "consent";
  state: "open" | "done" | "refused" | "expired";
  title: Text;
  readback: Text;
  items: { kind: string; spoken: Text }[];
  expires_at: string;
  earliest_at: string;
  shown_hash: string;
};

export type Slots = {
  title: Text;
  place: Text;
  days: { date: string; label: Text }[];
  windows: { id: "morning" | "afternoon"; label: Text }[];
  selected?: { date: string; window: "morning" | "afternoon" };
};

export type Receipt = {
  decision_id: string;
  outcome: "granted" | "pending_officer" | "refused" | "offered_alternative";
  decided_by: "rule" | "officer" | "pending";
  rule_ids: string[];
  reason: Text;
  next?: Text;
  review: { panel: string; ask_by: string; free: true; answer_within_working_days: number };
  link?: string;
  /** The application's reference (MED-331). */
  ref?: string;
};

export type UiEvent = { v: "ui/v1"; seq: number; kind: string; at: string; payload: unknown };

export const kes = (n: number) => `KES ${new Intl.NumberFormat("en-GB").format(n)}`;
