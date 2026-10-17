// Guard for every SMS and code call (P13 security P0). Fails closed:
// - the recipient must be in ALLOWED_RECIPIENTS (comma separated, E.164); unset means nobody,
// - at most SMS_DAILY_BUDGET sends (default 100) in any 24 hours, counted in sms_log,
// - every send is logged with the last 3 digits only.
// Text tests (conversation ids starting "test-") never reach Twilio. Browser calls from the
// panel's handset get their texts and codes in handset_inbox, shown on the panel, not sent; the
// resident app (/sia) sends them to the phone.

import { ToolError } from "./errors.ts";

export const normPhone = (p: string) => p.replace(/[^\d+]/g, "");

export function allowedRecipients(): string[] {
  return (Deno.env.get("ALLOWED_RECIPIENTS") ?? "").split(",").map(normPhone).filter(Boolean);
}

/** True when this send must be printed instead of sent. */
export function dryRun(conversationId?: string): boolean {
  return Deno.env.get("SMS_DRY_RUN") === "1" || !!conversationId?.startsWith("test-");
}

/** A conversation of the resident app (/sia): a browser conversation bound to a resident session.
 * The panel's handset is a browser conversation too, without one (and without cards). */
export async function isResidentApp(conversationId: string): Promise<boolean> {
  const { db, must } = await import("./db.ts");
  return !!must(
    await db.from("handset_tokens").select("conversation_id").eq("conversation_id", conversationId)
      .not("session_hash", "is", null).limit(1).maybeSingle(),
  );
}

/** Throws unless the send is allowed; logs it. Returns whether to print instead of sending. */
export async function guardOutbound(
  channel: "sms" | "voice",
  to: string,
  conversationId?: string,
  body?: string,
): Promise<boolean> {
  // Loaded here so modules that only build messages stay free of database access (unit tests).
  const { db, must } = await import("./db.ts");
  const conv = conversationId
    ? must(
      await db.from("conversations").select("channel").eq("id", conversationId).maybeSingle(),
    )
    : null;
  // The panel's handset keeps its texts in handset_inbox. The resident app (/sia, a browser
  // conversation bound to a resident session) sends them to the phone like a call does: a resident
  // waits for the code on their phone.
  const resident = conv?.channel === "browser" && await isResidentApp(conversationId!);
  const browser = conv?.channel === "browser" && !resident;
  const dry = dryRun(conversationId) || browser;
  if (!allowedRecipients().includes(normPhone(to))) {
    console.error(JSON.stringify({ outbound_blocked: channel, reason: "not_allowed" }));
    throw new ToolError(
      "recipient_not_allowed",
      "This demo can only send to registered demo phones. Tell the caller it could not be sent and offer a case.",
    );
  }
  const budget = Number(Deno.env.get("SMS_DAILY_BUDGET") ?? 100);
  const { count } = await db.from("sms_log").select("id", { count: "exact", head: true })
    .gt("at", new Date(Date.now() - 24 * 3600_000).toISOString()).eq("dry_run", false);
  if (!dry && (count ?? 0) >= budget) {
    console.error(JSON.stringify({ outbound_blocked: channel, reason: "daily_budget" }));
    throw new ToolError(
      "daily_limit",
      "The demo has reached today's message limit. Tell the caller and offer a case.",
    );
  }
  must(await db.from("sms_log").insert({ channel, to_last3: to.slice(-3), dry_run: dry }));
  // Not sent from a browser (the handset, or the resident app in a local dry run): the text waits
  // in handset_inbox, where the panel and the tests read it.
  if (conv?.channel === "browser" && dry && body) {
    must(
      await db.from("handset_inbox").insert({
        conversation_id: conversationId,
        kind: channel,
        body,
      }),
    );
  }
  return dry;
}
