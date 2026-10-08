// Upload requests for any case. create_upload_link texts the link to the verified caller's
// phone at once (never read aloud); /upload/[id] runs simulated
// checks and marks the row received (files are never stored). Each authority registers which
// purposes it accepts and how to find the caller's case.

import { audit } from "../../_shared/audit.ts";
import { authority } from "../../_shared/authorities.ts";
import { type Agent, db, must, ToolError } from "../../_shared/db.ts";
import { sms } from "../../_shared/sms.ts";
import { type Citizen, requireVerified } from "../../_shared/session.ts";
import { str } from "../../_shared/util.ts";
import type { Handler, ToolCtx } from "../index.ts";

const LINK_TTL_MS = 72 * 3600_000;
// Short enough that the caller rarely has to wait in silence (the tool is not interruptible).
const LONG_POLL_MS = 8_000;
const RESEND_AFTER_MS = 60_000;

/** The SMS carrying the link, in the authority's greeting language. */
function linkMessage(authorityId: string, label: string, url: string): string {
  const a = authority(authorityId);
  return a.default_language === "sw"
    ? `${a.name} (DEMO): pakia hapa (${label}), halali saa 72: ${url} Huduma ya kubuni.`
    : `${a.name} (DEMO): upload the ${label[0].toLowerCase()}${
      label.slice(1)
    } here, valid 72 hours: ${url} Fictional demo service.`;
}

/** Purpose -> what the caller is asked to upload (shown on /upload and in the panel). */
export const PURPOSES: Record<string, string> = {
  passport_photo: "Passport-style photo",
  birth_notification: "Birth notification or certificate",
  disability_assessment: "Disability assessment report",
  income_proof: "Proof of income (payslip)",
};

type UploadCase = {
  /** Purposes this authority accepts. */
  purposes: string[];
  /** Returns the caller's case reference (shown on /upload) for this purpose, or throws a
   * ToolError (for example when the subject is not someone on the case). */
  caseRef: (ctx: ToolCtx, citizen: Citizen, purpose: string, subject: string) => Promise<string>;
};

const CASES: Record<string, UploadCase> = {};

export function registerUploads(authorityId: string, c: UploadCase) {
  CASES[authorityId] = c;
}

/** Creates the upload request once per case, purpose and subject; returns the row. */
export async function createUpload(
  conversationId: string,
  agent: Agent,
  caseRef: string,
  purpose: string,
  subject = "",
) {
  const label = PURPOSES[purpose];
  if (!label) throw new ToolError("bad_purpose", `Unknown upload purpose ${purpose}.`);
  const key = { conversation_id: conversationId, case_ref: caseRef, purpose, subject };
  const found = must(await db.from("uploads").select("*").match(key).maybeSingle());
  if (found) return found;
  const row = must(
    await db.from("uploads").insert({
      ...key,
      authority: agent.authority,
      label,
      expires_at: new Date(Date.now() + LINK_TTL_MS).toISOString(),
    }).select("*").single(),
  );
  await audit(
    conversationId,
    agent.authority,
    "Upload",
    // Label only: a subject is a name the caller gave and never goes to the audit log.
    `Upload link created: ${label}, valid 72 hours`,
  );
  return row;
}

const isExpired = (u: any) => u.status === "waiting" && Date.parse(u.expires_at) < Date.now();

export const uploads: Record<string, Handler> = {
  create_upload_link: async (ctx) => {
    const { conversationId, agent, args } = ctx;
    const citizen = await requireVerified(conversationId, agent, "create_upload_link");
    const c = CASES[agent.authority];
    const purpose = str(args.purpose);
    if (!c) throw new ToolError("no_uploads", "This service takes no uploads.");
    if (!c.purposes.includes(purpose)) {
      throw new ToolError("bad_purpose", `purpose must be one of ${c.purposes.join(", ")}.`);
    }
    const subject = str(args.subject).slice(0, 80);
    const caseRef = await c.caseRef(ctx, citizen, purpose, subject);
    const u = await createUpload(conversationId, agent, caseRef, purpose, subject);

    // Text the link now. A repeat call resends it only after a minute (SMS can be slow).
    const template = `upload_link_${u.id}`;
    const sent = must(
      await db.from("messages").select("created_at").eq("conversation_id", conversationId)
        .eq("template", template).maybeSingle(),
    );
    if (sent && Date.now() - Date.parse(sent.created_at) < RESEND_AFTER_MS) {
      return {
        created: true,
        sms_sent: true,
        just_sent: true,
        next:
          "The link was texted less than a minute ago. Ask the caller to wait a moment for the SMS; do not send it again yet.",
      };
    }
    const body = linkMessage(
      agent.authority,
      u.subject ? `${u.label} for ${u.subject}` : u.label,
      `${Deno.env.get("WEB_BASE_URL")}/upload/${u.id}`,
    );
    const { sid } = await sms(citizen.phone, body, conversationId);
    must(
      await db.from("messages").upsert({
        conversation_id: conversationId,
        citizen_id: citizen.id,
        template,
        body,
        twilio_sid: sid,
        status: "sent",
        created_at: new Date().toISOString(),
      }, { onConflict: "conversation_id,template" }),
    );
    await audit(
      conversationId,
      agent.authority,
      "Follow-up",
      `${sent ? "Upload link resent" : "Upload link sent"} to phone ending ${
        citizen.phone.slice(-3)
      }`,
    );
    return {
      created: true,
      sms_sent: true,
      phone_last3: citizen.phone.slice(-3),
      document: u.label,
      valid_hours: 72,
      next:
        "Tell the caller the link is on its way by SMS (never read it aloud). Ask them to open it and upload, then call get_upload_status.",
    };
  },

  get_upload_status: async ({ conversationId, agent, args }) => {
    await requireVerified(conversationId, agent, "get_upload_status");
    const purpose = str(args.purpose);
    const deadline = Date.now() + LONG_POLL_MS;
    while (true) {
      let q = db.from("uploads").select("*").eq("conversation_id", conversationId);
      if (purpose) q = q.eq("purpose", purpose);
      const list = must(await q.order("created_at", { ascending: false })) as any[];
      if (!list.length) throw new ToolError("no_upload", "No upload link on this call yet.");
      const waiting = list.filter((u) => u.status === "waiting" && !isExpired(u));
      if (!waiting.length || Date.now() >= deadline) {
        return {
          uploads: list.map((u) => ({
            document: u.label,
            subject: u.subject || undefined,
            status: isExpired(u) ? "expired" : u.status,
          })),
          next: waiting.length
            ? "Still waiting. Tell the caller you are waiting for the upload, then check again."
            : "Tell the caller what arrived.",
        };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
};
