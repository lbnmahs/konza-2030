import { audit } from "../../_shared/audit.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { checkOtp, requireVerified, startOtp } from "../../_shared/session.ts";
import { sms } from "../../_shared/sms.ts";
import { TEMPLATES } from "../../_shared/templates.ts";
import { digits, str } from "../../_shared/util.ts";
import type { Handler } from "../index.ts";

export const common: Record<string, Handler> = {
  identity_start_otp: ({ conversationId, agent, args }) => startOtp(conversationId, agent, args),

  identity_check_otp: ({ conversationId, agent, args }) => checkOtp(conversationId, agent, args),

  send_message: async ({ conversationId, agent, args }) => {
    // Each authority has one summary template. If the LLM names another service's template,
    // use this authority's own instead of failing the SMS the caller agreed to.
    let key = str(args.template);
    if (TEMPLATES[key]?.authority !== agent.authority) {
      const own = Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].authority === agent.authority);
      if (own.length !== 1) {
        throw new ToolError("unknown_template", `No template ${key} for this service.`);
      }
      key = own[0];
    }
    const tpl = TEMPLATES[key];
    const citizen = await requireVerified(conversationId, agent, "send_message");

    const existing = must(
      await db.from("messages").select("status").eq("conversation_id", conversationId)
        .eq("template", key).maybeSingle(),
    );
    if (existing?.status === "sent") return { sent: true, already_sent: true };

    const body = await tpl.compose(conversationId, citizen);
    if (!body) {
      throw new ToolError("nothing_to_send", "There is nothing from this call to send yet.");
    }

    try {
      const { sid } = await sms(citizen.phone, body, conversationId);
      must(
        await db.from("messages").upsert({
          conversation_id: conversationId,
          citizen_id: citizen.id,
          template: key,
          body,
          twilio_sid: sid,
          status: "sent",
        }, { onConflict: "conversation_id,template" }),
      );
    } catch (e) {
      await audit(conversationId, agent.authority, "Follow-up", "SMS failed to send", {
        result: "error",
      });
      throw e;
    }
    await audit(
      conversationId,
      agent.authority,
      "Follow-up",
      `SMS sent to phone ending ${citizen.phone.slice(-3)}`,
    );
    return { sent: true, phone_last3: citizen.phone.slice(-3) };
  },

  create_case: async ({ conversationId, agent, args }) => {
    const type = str(args.type) || "general";
    const priority = str(args.priority) === "urgent" ? "urgent" : "routine";
    const summary = str(args.summary).slice(0, 1000);
    const found = must(
      await db.from("cases").select("id").eq("conversation_id", conversationId).eq("type", type)
        .maybeSingle(),
    );
    const ref = `CASE-${digits(5)}`;
    let caseId = found?.id ?? null;
    if (!found) {
      caseId = must(
        await db.from("cases").insert({
          conversation_id: conversationId,
          type,
          priority: type === "identity_concern" ? "urgent" : priority,
          summary: `${ref}: ${summary}`,
        }).select("id").single(),
      ).id;
      await audit(
        conversationId,
        agent.authority,
        "Escalation",
        `Case created for an officer call back (${type}, ${priority})`,
        { result: priority === "urgent" ? "warn" : "ok" },
      );
    }
    // An identity concern (the caller is not who they verified as, or admits it) holds the
    // session: the backend refuses every write and money tool for the rest of the call.
    if (type === "identity_concern") {
      must(
        await db.from("session_flags").upsert({
          conversation_id: conversationId,
          reason: summary.slice(0, 300),
          case_id: caseId,
        }),
      );
      await audit(conversationId, agent.authority, "Identity", "Session held: identity concern", {
        result: "warn",
      });
      return {
        case_created: true,
        officer_will_call_back: true,
        session_held: true,
        next:
          "Tell the caller calmly that, for safety, nothing more can be changed on this call and an officer will review what was done today and call the record holder. Do not say the earlier action was fine.",
      };
    }
    return { case_created: true, officer_will_call_back: true };
  },
};
