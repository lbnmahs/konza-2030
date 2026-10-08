// Partner referrals with consent per partner (W.9). One partner_notify call per partner, only
// after a yes for that partner. The server fills field values from the verified caller's
// records, strips anything the partner is not allowed, and logs both. Partners set to
// "on_approval" are scheduled and released by scripts/approve.ts when the linked application
// is approved.

import { audit } from "../../_shared/audit.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { filterFields, maskPhone } from "../../_shared/partners.ts";
import { type Citizen, requireVerified } from "../../_shared/session.ts";
import { digits, str } from "../../_shared/util.ts";
import type { Handler, ToolCtx } from "../index.ts";

type PartnerContext = {
  /** Field values this authority can share for the caller (P11 scenarios add their own). */
  fields: Record<string, string>;
  /** The case the referral belongs to, and the application that releases scheduled ones. */
  case_ref?: string;
  linked_ref?: string;
};

type Resolver = (ctx: ToolCtx, citizen: Citizen) => Promise<PartnerContext>;
const RESOLVERS: Record<string, Resolver> = {};

export function registerPartnerFields(authorityId: string, r: Resolver) {
  RESOLVERS[authorityId] = r;
}

const CONTACT: Record<string, string> = {
  sms_preferred: "text messages",
  accessible_letters_audio: "audio letters",
  accessible_letters_large_print: "large print letters",
  accessible_letters_braille: "braille letters",
  easy_read: "easy read",
};

/** Fields every authority can share: name, masked phone, and how the caller wants contact. */
async function commonFields(conversationId: string, citizen: Citizen) {
  const adj = must(
    await db.from("adjustments").select("adjustment").eq("conversation_id", conversationId),
  ).map((r: any) => CONTACT[r.adjustment]).filter(Boolean);
  return {
    full_name: citizen.full_name,
    phone: maskPhone(citizen.phone),
    ...(adj.length ? { contact_preference: adj.join(", ") } : {}),
  };
}

export const partners: Record<string, Handler> = {
  partner_list_options: async ({ conversationId, agent }) => {
    const list = must(
      await db.from("partners").select("*").eq("authority", agent.authority).order("id"),
    );
    if (!list.length) throw new ToolError("no_partners", "This service has no partner referrals.");
    await audit(
      conversationId,
      agent.authority,
      "Partner",
      `Partner options listed (${list.length})`,
    );
    return {
      partners: list.map((p: any) => ({
        partner_id: p.id,
        name: p.name,
        offer: p.offer,
        fields_shared: p.allowed_fields,
        when: p.send_when === "on_approval" ? "only once the application is approved" : "now",
      })),
      next:
        "Describe each partner, its offer and exactly which details it would receive. Ask about each partner separately and accept a no or not yet. Then call partner_notify once per partner.",
    };
  },

  partner_notify: async (ctx) => {
    const { conversationId, agent, args } = ctx;
    const citizen = await requireVerified(conversationId, agent, "partner_notify");
    const partner = must(
      await db.from("partners").select("*").eq("id", str(args.partner_id))
        .eq("authority", agent.authority).maybeSingle(),
    );
    if (!partner) {
      throw new ToolError("unknown_partner", "Use partner_id from partner_list_options.");
    }

    const existing = must(
      await db.from("partner_referrals").select("ref, status").eq("conversation_id", conversationId)
        .eq("partner_id", partner.id).maybeSingle(),
    );
    if (existing) {
      return { referral_ref: existing.ref, status: existing.status, already_done: true };
    }

    const ref = `REF-${digits(5)}`;
    if (args.caller_consented_to_this_partner !== true) {
      must(
        await db.from("partner_referrals").insert({
          ref,
          conversation_id: conversationId,
          partner_id: partner.id,
          status: "declined",
          send_when: partner.send_when,
        }),
      );
      await audit(
        conversationId,
        agent.authority,
        "Partner",
        `Not shared with ${partner.name}: caller said no or not yet`,
      );
      return {
        referral_ref: ref,
        status: "declined",
        next: "Confirm nothing was shared with this partner and that the caller can ask later.",
      };
    }

    const scenario = RESOLVERS[agent.authority]
      ? await RESOLVERS[agent.authority](ctx, citizen)
      : { fields: {} };
    const available = { ...await commonFields(conversationId, citizen), ...scenario.fields };
    const requested = Array.isArray(args.fields) ? args.fields.map(String) : [];
    const r = filterFields(
      requested.length ? requested : partner.allowed_fields,
      partner.allowed_fields,
      available,
    );
    const scheduled = partner.send_when === "on_approval";
    // A scheduled referral records which allowed fields it will get; the values (for example a
    // certificate number) only exist once the application is approved (scripts/approve.ts).
    if (scheduled) {
      for (const f of r.unavailable) r.sent[f] = "released on approval";
      r.unavailable = [];
    }
    if (!Object.keys(r.sent).length) {
      throw new ToolError(
        "nothing_to_share",
        `None of the requested details can be shared with ${partner.name}. It may receive: ${
          partner.allowed_fields.join(", ")
        }.`,
      );
    }
    if (scheduled && !scenario.linked_ref) {
      throw new ToolError(
        "no_application",
        "This partner is only told once an application is approved, and there is no application on this call yet.",
      );
    }
    must(
      await db.from("partner_referrals").insert({
        ref,
        conversation_id: conversationId,
        case_ref: scenario.case_ref ?? null,
        partner_id: partner.id,
        fields_sent: r.sent,
        fields_stripped: r.stripped,
        status: scheduled ? "scheduled" : "sent",
        send_when: partner.send_when,
        linked_ref: scenario.linked_ref ?? null,
        sent_at: scheduled ? null : new Date().toISOString(),
      }),
    );
    const n = Object.keys(r.sent).length;
    await audit(
      conversationId,
      agent.authority,
      "Partner",
      scheduled
        ? `Scheduled for ${partner.name}: ${n} fields, sent when ${scenario.linked_ref} is approved`
        : `Shared with ${partner.name}: ${n} fields`,
      { data_used: Object.keys(r.sent).join(", ") },
    );
    if (r.stripped.length) {
      await audit(
        conversationId,
        agent.authority,
        "Partner",
        `Stripped ${r.stripped.length} field(s) not allowed for ${partner.name}`,
        { result: "warn", data_used: r.stripped.join(", ") },
      );
    }
    return {
      referral_ref: ref,
      status: scheduled ? "scheduled" : "sent",
      fields_sent: Object.keys(r.sent),
      fields_stripped: r.stripped,
      fields_unavailable: r.unavailable,
      next: scheduled
        ? "Tell the caller the partner will only be told once the application is approved, and exactly which details."
        : "Tell the caller which details were shared with this partner.",
    };
  },
};
