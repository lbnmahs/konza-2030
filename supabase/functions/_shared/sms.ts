// Twilio Messages API, from the one demo number. Every SMS goes through the outbound guard
// (allowlist, daily budget, log). Bodies carry no "DEMO" (MED-340); emails do.

import { guardOutbound } from "./outbound.ts";

export async function sms(
  to: string,
  body: string,
  conversationId?: string,
): Promise<{ sid: string }> {
  // SMS_DRY_RUN=1 (local only, never on the deployed function), a text test or the handset: not
  // sent. The body is printed only for a local dry run; on the project it would put live codes in
  // the function logs, and the handset reads it from handset_inbox.
  if (await guardOutbound("sms", to, conversationId, body)) {
    const local = Deno.env.get("SMS_DRY_RUN") === "1";
    console.log(JSON.stringify({ sms_dry_run: { to_last3: to.slice(-3), ...(local ? { body } : {}) } }));
    return { sid: "dry-run" };
  }
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${sid}:${Deno.env.get("TWILIO_AUTH_TOKEN")}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: Deno.env.get("TWILIO_FROM_NUMBER")!, Body: body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message ?? "send failed"}`);
  return { sid: json.sid };
}
