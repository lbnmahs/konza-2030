// K8 S2 (MED-330, plan-k8 2.4): what a tap may send, and how it reaches the backend. Plain
// functions with no Next imports, so the Deno tests check them without a network
// (tests/resident_session_test.ts).
//
// For a confirm or Refresh the browser sends only the action, the confirmation id and the hash of
// the card it shows: the tool and its arguments come from the stored confirmation in the backend.
// The identity card sends a six-digit code and the form card its fields (MED-331), which the
// backend checks as it would the agent's call. The conversation always comes from the session
// cookie, never the body.

export type ActInput =
  | { action: "confirm" | "refresh"; confirmation_id: string; shown_hash?: string }
  | { action: "identity_code"; code: string }
  | { action: "form_submit"; fields: Record<string, string | number | boolean> }
  // MED-332: the payment card. The PIN passes through here to the backend's check and nowhere else.
  | { action: "pay_method"; payment_id: string; method_id: string }
  | { action: "pay_code"; code: string }
  | { action: "pay_pin"; pin: string }
  // MED-332: a day and window from the slots card; the rules check the day.
  | { action: "slot_pick"; date: string; window: "morning" | "afternoon" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const FIELD = /^[a-z][a-z0-9_]{0,39}$/;

/** Form values: a flat object of short scalars under field-like names. The backend validates them
 * against the service's schema; this only keeps anything else from leaving the browser. */
function formFields(v: unknown): Record<string, string | number | boolean> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length || entries.length > 20) return null;
  for (const [k, x] of entries) {
    if (!FIELD.test(k)) return null;
    if (typeof x === "string" ? x.length > 200 : typeof x !== "number" && typeof x !== "boolean") return null;
  }
  return Object.fromEntries(entries) as Record<string, string | number | boolean>;
}

/** The tap, or null when it is not one we accept. Any other key (a conversation id, a tool,
 * arguments) is dropped. */
export function parseAct(body: unknown): ActInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.action === "identity_code") {
    return typeof b.code === "string" && /^\d{6}$/.test(b.code) ? { action: "identity_code", code: b.code } : null;
  }
  if (b.action === "form_submit") {
    const fields = formFields(b.fields);
    return fields ? { action: "form_submit", fields } : null;
  }
  if (b.action === "pay_method") {
    const p = typeof b.payment_id === "string" ? b.payment_id : "";
    const m = typeof b.method_id === "string" ? b.method_id : "";
    return UUID.test(p) && UUID.test(m) ? { action: "pay_method", payment_id: p, method_id: m } : null;
  }
  if (b.action === "pay_code") {
    return typeof b.code === "string" && /^\d{6}$/.test(b.code) ? { action: "pay_code", code: b.code } : null;
  }
  if (b.action === "slot_pick") {
    const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : "";
    const window = b.window === "morning" || b.window === "afternoon" ? b.window : null;
    return date && window ? { action: "slot_pick", date, window } : null;
  }
  if (b.action === "pay_pin") {
    return typeof b.pin === "string" && /^\d{4,6}$/.test(b.pin) ? { action: "pay_pin", pin: b.pin } : null;
  }
  const id = typeof b.confirmation_id === "string" ? b.confirmation_id : "";
  if (!UUID.test(id)) return null;
  if (b.action === "refresh") return { action: "refresh", confirmation_id: id };
  if (b.action === "confirm" && typeof b.shown_hash === "string" && HASH.test(b.shown_hash)) {
    return { action: "confirm", confirmation_id: id, shown_hash: b.shown_hash };
  }
  return null;
}

export type ActReply = { status: number; body: Record<string, unknown> };

/** Never "done" unless the backend said so: a network failure, a timeout or a reply that is not
 * JSON becomes this, and the card stays as it was (the resident can try again or say yes). */
export const NOT_DONE: ActReply = {
  status: 502,
  body: { error: "act_unavailable", message: "That could not be done. Nothing has changed." },
};

/** Forwards a tap to the tools function's /ui/act with the server-only secret. */
export async function forwardAct(
  fetchImpl: typeof fetch,
  toolsUrl: string,
  secret: string,
  conversationId: string,
  input: ActInput,
  timeoutMs = 15_000,
): Promise<ActReply> {
  try {
    const res = await fetchImpl(`${toolsUrl}/ui/act`, {
      method: "POST",
      // In London, next to the database (as the agent's tools are; scripts/push-agents.ts).
      headers: { "content-type": "application/json", "x-ui-act-secret": secret, "x-region": "eu-west-2" },
      body: JSON.stringify({ ...input, conversation_id: conversationId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NOT_DONE;
    // A 5xx is an outage whatever its body says; a 403 means our own secret is wrong.
    if (res.status >= 500 || res.status === 403) return NOT_DONE;
    return { status: res.status, body: body as Record<string, unknown> };
  } catch {
    return NOT_DONE;
  }
}
