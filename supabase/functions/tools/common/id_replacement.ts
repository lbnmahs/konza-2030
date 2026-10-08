// Lost national ID, shared by every ID authority (U3-KE Usajili Njema, U3-AE Qamar Bay Identity
// Services). Order is enforced here: block the old card first, then the fee, then the photo;
// each country registers its rules, currency and how the new card is handed over.

import { audit } from "../../_shared/audit.ts";
import { type Agent, db, must, ToolError } from "../../_shared/db.ts";
import { addDays, type ISODate } from "../../_shared/rules/common/dates.ts";
import { type Citizen, requireVerified } from "../../_shared/session.ts";
import { digits, mask, spokenDate, str } from "../../_shared/util.ts";
import { registerCharge } from "./payments.ts";
import { registerUploads } from "./uploads.ts";
import type { Handler } from "../index.ts";

export type IdConfig = {
  /** Reference prefix, e.g. "UN" gives UN-LOSS-12345. */
  prefix: string;
  payee: string;
  rules: {
    block: string;
    fee: string;
    photo: string;
    lossDateValid: (lostOn: ISODate, today: ISODate) => boolean;
    replacement: () => {
      fee: number;
      steps: Record<string, string>[];
      rule_ids: string[];
    };
  };
  /** Fee fields for the agent, e.g. {fee_kes, fee_spoken_sw}. */
  feeFields: (fee: number) => Record<string, unknown>;
  /** Spoken forms of a date in the languages this authority uses (English is added). */
  dateFields: (prefix: string, d: ISODate) => Record<string, string>;
  /** The payment_request argument that carries the amount. */
  amountArg: "amount_kes" | "amount";
};

const CONFIGS: Record<string, IdConfig> = {};

function config(agent: Agent): IdConfig {
  const c = CONFIGS[agent.authority];
  if (!c) throw new ToolError("no_id_service", "This service does not replace ID cards.");
  return c;
}

export async function lossOnCall(conversationId: string) {
  return must(
    await db.from("id_losses").select("*, id_cards(card_no, status)")
      .eq("conversation_id", conversationId).maybeSingle(),
  );
}

export async function applicationOnCall(conversationId: string, citizen: Citizen) {
  const app = must(
    await db.from("id_applications").select("*").eq("conversation_id", conversationId)
      .eq("citizen_id", citizen.id).order("created_at", { ascending: false }).limit(1),
  )[0];
  if (!app) {
    throw new ToolError(
      "no_application",
      "There is no replacement application on this call yet. Use id_create_replacement first.",
    );
  }
  return app;
}

export async function feePaid(conversationId: string, caseRef: string) {
  const paid = must(
    await db.from("payments").select("id").eq("conversation_id", conversationId)
      .eq("case_ref", caseRef).eq("status", "approved").limit(1),
  );
  return paid.length > 0;
}

export async function photoReceived(conversationId: string, caseRef: string) {
  const got = must(
    await db.from("uploads").select("id").eq("conversation_id", conversationId)
      .eq("case_ref", caseRef).eq("purpose", "passport_photo").eq("status", "received").limit(1),
  );
  return got.length > 0;
}

/** Audits a refused handover (booking or delivery) and tells the agent what is missing. */
export async function refuseHandover(
  conversationId: string,
  agent: Agent,
  ruleId: string,
  reason: string,
): Promise<never> {
  const c = config(agent);
  await audit(conversationId, agent.authority, "Rules", `${ruleId}: refused, ${reason}`, {
    result: "warn",
    rule_ids: [ruleId],
  });
  throw new ToolError(
    "booking_refused",
    `${reason} ${
      ruleId === c.rules.photo
        ? "Ask the caller to upload the photo from the SMS link, then check with get_upload_status."
        : "The fee must be paid first (payment_request, then payment_get_status)."
    }`,
    { rule_id: ruleId },
  );
}

export function registerIdReplacement(authorityId: string, c: IdConfig) {
  CONFIGS[authorityId] = c;
  registerCharge(authorityId, {
    rulesTool: "rules_id_replacement",
    nextOnApproved:
      `Payment received. Next is the new photo (${c.rules.photo}): offer to text the upload link, and after a yes call create_upload_link with purpose passport_photo.`,
    resolve: async ({ conversationId }, citizen) => {
      const app = await applicationOnCall(conversationId, citizen);
      return {
        case_ref: app.ref,
        amount: Number(app.fee),
        payee: c.payee,
        description: `ID replacement ${app.ref}`,
        reference: app.ref,
        rule_ids: [c.rules.fee],
        // The agent reads amount_spoken_* after a payment request (fee_spoken_* before it).
        say: Object.fromEntries(
          Object.entries(c.feeFields(Number(app.fee)))
            .filter(([k]) => k.startsWith("fee_spoken"))
            .map(([k, v]) => [k.replace("fee_", "amount_"), v]),
        ),
      };
    },
  });
  registerUploads(authorityId, {
    purposes: ["passport_photo"],
    caseRef: async ({ conversationId }, citizen) =>
      (await applicationOnCall(conversationId, citizen)).ref,
  });
}

export const idReplacement: Record<string, Handler> = {
  id_report_loss: async ({ conversationId, agent, args, today }) => {
    const c = config(agent);
    const citizen = await requireVerified(conversationId, agent, "id_report_loss");
    const existing = await lossOnCall(conversationId);
    if (existing) {
      return { loss_ref: existing.ref, card_status: "BLOCKED", already_reported: true };
    }
    const daysAgo = Number(args.lost_days_ago);
    const lostOn = Number.isInteger(daysAgo) && daysAgo >= 0 && str(args.lost_days_ago) !== ""
      ? addDays(today, -daysAgo)
      : str(args.lost_on);
    if (!c.rules.lossDateValid(lostOn, today)) {
      throw new ToolError(
        "bad_date",
        "Give lost_days_ago (0 today, 1 yesterday) or lost_on (YYYY-MM-DD), today or within the past year. Ask the caller for the day.",
      );
    }
    const kind = str(args.kind) === "stolen" ? "stolen" : "lost";
    const card = must(
      await db.from("id_cards").select("*").eq("citizen_id", citizen.id)
        .eq("authority", agent.authority).eq("status", "active").maybeSingle(),
    );
    if (!card) {
      throw new ToolError(
        "no_active_card",
        "There is no active card on this record. Offer a case for an officer to call back.",
      );
    }

    const ref = `${c.prefix}-LOSS-${digits(5)}`;
    const { error } = await db.from("id_losses").insert({
      ref,
      conversation_id: conversationId,
      card_id: card.id,
      kind,
      lost_on: lostOn,
      location_description: str(args.location_description).slice(0, 300) || "not given",
    });
    if (error) throw new ToolError("conflict", "Try id_report_loss once more.");
    must(
      await db.from("id_cards").update({ status: "blocked", blocked_at: new Date().toISOString() })
        .eq("id", card.id),
    );
    await audit(
      conversationId,
      agent.authority,
      "Service",
      `Card BLOCKED after a confirmed ${kind} declaration (${ref})`,
      { data_used: mask("Card", card.card_no), rule_ids: [c.rules.block] },
    );
    return {
      loss_ref: ref,
      card_status: "BLOCKED",
      card_last4: card.card_no.slice(-4),
      lost_on_spoken: spokenDate(lostOn),
      ...c.dateFields("lost_on_spoken", lostOn),
      rule_ids: [c.rules.block],
      next: kind === "stolen"
        ? "Tell the caller the old card is blocked now. Because it was stolen, offer create_case (type id_misuse) so an officer follows up. Then explain the replacement with rules_id_replacement."
        : "Tell the caller the old card is blocked now, then explain the replacement with rules_id_replacement.",
    };
  },

  rules_id_replacement: async ({ conversationId, agent }) => {
    const c = config(agent);
    // The block comes first: no fee talk before the old card is blocked on this call.
    if (!await lossOnCall(conversationId)) {
      return {
        must_block_first: true,
        next:
          "Block the old card first: verify the caller, read back the loss details, and call id_report_loss after a clear yes. Do not mention the fee yet.",
      };
    }
    const r = c.rules.replacement();
    await audit(
      conversationId,
      agent.authority,
      "Rules",
      `${r.rule_ids.join(", ")}: replacement fee ${r.fee.toLocaleString("en-GB")}`,
      { rule_ids: r.rule_ids },
    );
    return {
      ...c.feeFields(r.fee),
      steps: r.steps,
      rule_ids: r.rule_ids,
      next:
        "Explain the steps briefly, then call id_create_replacement and ask a clear yes before any payment.",
    };
  },

  id_create_replacement: async ({ conversationId, agent }) => {
    const c = config(agent);
    const citizen = await requireVerified(conversationId, agent, "id_create_replacement");
    const loss = await lossOnCall(conversationId);
    if (!loss) {
      throw new ToolError("no_loss", "Take the loss declaration first (id_report_loss).");
    }
    let app = must(
      await db.from("id_applications").select("*").eq("conversation_id", conversationId)
        .eq("loss_id", loss.id).maybeSingle(),
    );
    if (!app) {
      app = must(
        await db.from("id_applications").insert({
          ref: `${c.prefix}-APP-${digits(5)}`,
          conversation_id: conversationId,
          loss_id: loss.id,
          citizen_id: citizen.id,
          authority: agent.authority,
          fee: c.rules.replacement().fee,
        }).select("*").single(),
      );
      await audit(
        conversationId,
        agent.authority,
        "Service",
        `Replacement application ${app.ref} created (linked to ${loss.ref})`,
        { rule_ids: [c.rules.fee] },
      );
    }
    return {
      application_ref: app.ref,
      ...c.feeFields(Number(app.fee)),
      next:
        `Read back the fee and ask a clear yes. Only then call payment_request with ${c.amountArg} equal to the fee.`,
    };
  },
};
