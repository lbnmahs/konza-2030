// Email through Resend (P15), from demo@malinoir.com with "DEMO" in the subject. Fails closed:
// recipients only from ALLOWED_EMAIL_RECIPIENTS, at most EMAIL_DAILY_BUDGET (default 20) a day
// and 5 a day per recipient, every send logged in email_log (address hashed). Text tests and
// browser calls do not send.

import { ToolError } from "./errors.ts";
import { sha256 } from "./util.ts";

export function allowedEmails(): string[] {
  return (Deno.env.get("ALLOWED_EMAIL_RECIPIENTS") ?? "").split(",").map((e) =>
    e.trim().toLowerCase()
  ).filter(Boolean);
}

export async function sendEmail(m: {
  to: string;
  subject: string;
  text: string;
  kind: string;
  ref?: string;
  conversationId: string;
  attachment?: { filename: string; content: string; contentType: string };
}): Promise<{ sent: boolean; dry_run: boolean }> {
  const { db, must } = await import("./db.ts");
  const to = m.to.trim().toLowerCase();
  if (!allowedEmails().includes(to)) {
    throw new ToolError(
      "recipient_not_allowed",
      "This demo can only email registered demo addresses.",
    );
  }
  const toHash = await sha256(`${to}:${Deno.env.get("OTP_PEPPER") ?? ""}`);
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const count = async (q: any) => (await q).count ?? 0;
  const all = await count(
    db.from("email_log").select("id", { count: "exact", head: true }).gt("at", since).eq(
      "dry_run",
      false,
    ),
  );
  const mine = await count(
    db.from("email_log").select("id", { count: "exact", head: true }).gt("at", since)
      .eq("to_hash", toHash).eq("dry_run", false),
  );
  if (all >= Number(Deno.env.get("EMAIL_DAILY_BUDGET") ?? 20) || mine >= 5) {
    throw new ToolError(
      "daily_limit",
      "The demo has reached today's email limit. Tell the caller.",
    );
  }
  const conv = must(
    await db.from("conversations").select("channel").eq("id", m.conversationId).maybeSingle(),
  );
  const dry = Deno.env.get("SMS_DRY_RUN") === "1" || m.conversationId.startsWith("test-") ||
    conv?.channel === "browser";
  if (!m.subject.startsWith("DEMO")) throw new Error("Email subject must start with DEMO");
  if (!dry) {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) throw new ToolError("email_unavailable", "Email is not set up in this demo.");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "Gov Voice Demo <demo@malinoir.com>",
        to: [to],
        subject: m.subject,
        text: m.text,
        ...(m.attachment
          ? {
            attachments: [{
              filename: m.attachment.filename,
              content: btoa(m.attachment.content),
              content_type: m.attachment.contentType,
            }],
          }
          : {}),
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
  }
  must(
    await db.from("email_log").insert({
      to_hash: toHash,
      kind: m.kind,
      ref: m.ref ?? null,
      dry_run: dry,
    }),
  );
  return { sent: true, dry_run: dry };
}
