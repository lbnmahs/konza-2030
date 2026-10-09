// Twilio Messages API, from the one demo number. Every SMS must say DEMO, and goes through the
// outbound guard (allowlist, daily budget, log).

import { guardOutbound } from "./outbound.ts";

export async function sms(
  to: string,
  body: string,
  conversationId?: string,
): Promise<{ sid: string }> {
  if (!body.includes("DEMO")) throw new Error("SMS body must contain DEMO");
  // SMS_DRY_RUN=1 (local only, never on the deployed function) or a text test: print instead.
  if (await guardOutbound("sms", to, conversationId, body)) {
    console.log(JSON.stringify({ sms_dry_run: { to_last3: to.slice(-3), body } }));
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
