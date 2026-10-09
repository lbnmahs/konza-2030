// Twilio outbound voice call that reads a one-time code (not Twilio Verify). From the one demo
// number to the phone on file. Local testing with SMS_DRY_RUN=1 prints instead of calling.

import { guardOutbound } from "./outbound.ts";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The spoken message: the code digit by digit, said twice. */
export function codeTwiml(authorityName: string, code: string): string {
  const digits = [...code].join(", ");
  const say = `This is ${authorityName}, demo service. Your verification code is: ${digits}. ` +
    `Again, your code is: ${digits}. Goodbye.`;
  return `<Response><Pause length="1"/><Say voice="Polly.Amy" language="en-GB">${
    escape(say)
  }</Say></Response>`;
}

/** PY-01: a payment prompt read by a code call; the code said twice. */
export function paymentTwiml(payee: string, amountSpoken: string, code: string): string {
  const digits = [...code].join(", ");
  const say = `This is a Konza payment prompt, demo service. ${amountSpoken} to ${payee}. ` +
    `To approve, tell Savannah this code: ${digits}. Again: ${digits}. To decline, do nothing. Goodbye.`;
  return `<Response><Pause length="1"/><Say voice="Polly.Amy" language="en-GB">${
    escape(say)
  }</Say></Response>`;
}

export async function voiceCall(
  to: string,
  twiml: string,
  conversationId?: string,
): Promise<{ sid: string }> {
  if (!twiml.includes("demo")) throw new Error("Voice message must say demo");
  const spoken = twiml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (await guardOutbound("voice", to, conversationId, spoken)) {
    console.log(JSON.stringify({ voice_dry_run: { to_last3: to.slice(-3), twiml } }));
    return { sid: "dry-run" };
  }
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${sid}:${Deno.env.get("TWILIO_AUTH_TOKEN")}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: Deno.env.get("TWILIO_FROM_NUMBER")!, Twiml: twiml }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message ?? "call failed"}`);
  return { sid: json.sid };
}
