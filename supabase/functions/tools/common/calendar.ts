// calendar_email (P15): with the caller's consent, emails this call's bookings as an ICS file to
// the address on file (in the demo: the first allowed demo address).

import { audit } from "../../_shared/audit.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { allowedEmails, sendEmail } from "../../_shared/email.ts";
import { buildIcs } from "../../_shared/ics.ts";
import { requireVerified } from "../../_shared/session.ts";
import type { Handler } from "../index.ts";

export const calendar: Record<string, Handler> = {
  calendar_email: async ({ conversationId, agent }) => {
    await requireVerified(conversationId, agent, "calendar_email");
    const items = must(
      await db.from("calendar_items").select("*").eq("conversation_id", conversationId)
        .order("local_start"),
    );
    if (!items.length) {
      throw new ToolError(
        "nothing_to_send",
        "There is no booking on this call to add to a calendar.",
      );
    }
    const to = allowedEmails()[0];
    if (!to) throw new ToolError("email_unavailable", "Email is not set up in this demo.");
    const r = await sendEmail({
      to,
      subject: `DEMO: ${
        items.length === 1 ? items[0].title.replace(/^DEMO: /, "") : "your appointments"
      }`,
      text: `${
        items.map((i: any) =>
          `${i.title.replace(/^DEMO: /, "")}, ${
            i.local_start.replace("T", " ")
          } (${i.timezone}). Reference ${i.ref}.`
        ).join("\n")
      }\n\nThe calendar file is attached. Fictional demo service.`,
      kind: "calendar",
      ref: items[0].ref,
      conversationId,
      attachment: {
        filename: "demo-appointment.ics",
        content: buildIcs(items),
        contentType: "text/calendar",
      },
    });
    await audit(
      conversationId,
      agent.authority,
      "Follow-up",
      "Calendar file emailed to the address on file",
      {
        result: r.dry_run ? "warn" : "ok",
      },
    );
    return { sent: true, next: "Say the calendar file is on its way to the email on file." };
  },
};
