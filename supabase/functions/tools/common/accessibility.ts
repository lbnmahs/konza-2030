// Accessibility adjustments (W.9). Recorded only with the caller's consent, as a need (for
// example "slower speech"), never a diagnosis. voice_otp makes the next code a voice call.

import { audit } from "../../_shared/audit.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { str } from "../../_shared/util.ts";
import type { Handler } from "../index.ts";

export const ADJUSTMENTS: Record<string, string> = {
  sms_preferred: "prefers text messages",
  voice_otp: "codes by voice call",
  slower_speech: "slower speech",
  extra_time: "extra time",
  helper_present: "helper on the call",
  easy_read: "easy read",
  accessible_letters_audio: "audio letters",
  accessible_letters_large_print: "large print letters",
  accessible_letters_braille: "braille letters",
};

export const accessibility: Record<string, Handler> = {
  record_adjustment: async ({ conversationId, agent, args }) => {
    const adjustment = str(args.adjustment);
    if (!ADJUSTMENTS[adjustment]) {
      throw new ToolError(
        "bad_adjustment",
        `adjustment must be one of ${Object.keys(ADJUSTMENTS).join(", ")}.`,
      );
    }
    if (args.caller_consented !== true) {
      throw new ToolError(
        "no_consent",
        "Only record an adjustment after the caller agrees to it being noted. Ask first.",
      );
    }
    const conv = must(
      await db.from("conversations").select("citizen_id, verified_at").eq("id", conversationId)
        .maybeSingle(),
    );
    const { error } = await db.from("adjustments").insert({
      conversation_id: conversationId,
      citizen_id: conv?.verified_at ? conv.citizen_id : null,
      adjustment,
    });
    if (!error) {
      await audit(
        conversationId,
        agent.authority,
        "Accessibility",
        `Adjustment noted: ${ADJUSTMENTS[adjustment]}`,
      );
    }
    return {
      recorded: true,
      adjustment: ADJUSTMENTS[adjustment],
      next: adjustment === "voice_otp"
        ? "Verification codes on this call will come by a voice call to the phone on file instead of SMS."
        : "Confirm it is noted and carry on with it in mind.",
    };
  },
};
