// In-person appointments at an authority's offices (e.g. ID biometrics). Offices and slots
// live in registry_offices and registry_slots with the authority and service. Each authority
// registers what must be true before a booking (its rules), so the LLM cannot skip a step.

import { audit } from "../../_shared/audit.ts";
import { addCalendarItem } from "../../_shared/calendar.ts";
import { recommend } from "../../_shared/rules/common/recommend.ts";
import { db, must, ToolError } from "../../_shared/db.ts";
import { type Citizen, requireVerified } from "../../_shared/session.ts";
import { slotTime } from "../../_shared/slot_time.ts";
import { swSlotSpoken } from "../../_shared/sw.ts";
import { digits, str } from "../../_shared/util.ts";
import type { Handler, ToolCtx } from "../index.ts";

type Booking = {
  service: string;
  refPrefix: string;
  /** The caller's case this booking belongs to (throws a ToolError if there is none). */
  caseRef: (ctx: ToolCtx, citizen: Citizen) => Promise<string>;
  /** Throws a ToolError (after auditing) when the rules do not allow booking yet. */
  check: (ctx: ToolCtx, citizen: Citizen, caseRef: string) => Promise<void>;
  rule_ids: string[];
  /** Optional rules on which offices and slot dates may be offered and booked (for example
   * step-free venues only, or a date window). Applied when listing and again when booking. */
  officeFilter?: (ctx: ToolCtx) => Promise<(office: any) => boolean>;
  slotFilter?: (ctx: ToolCtx) => Promise<(date: string) => boolean>;
};

const ALL = () => Promise.resolve(() => true);

const BOOKINGS: Record<string, Booking> = {};

export function registerBooking(authorityId: string, b: Booking) {
  BOOKINGS[authorityId] = b;
}

function spoken(startsAt: string) {
  const t = slotTime(String(startsAt));
  return {
    date: t.date,
    time: t.time,
    start_spoken: t.start_spoken,
    start_spoken_sw: swSlotSpoken(String(startsAt)),
  };
}

export const registry: Record<string, Handler> = {
  registry_list_offices: async (ctx) => {
    const { conversationId, agent, args, today } = ctx;
    const b = BOOKINGS[agent.authority];
    if (!b) throw new ToolError("no_bookings", "This service has no office appointments.");
    const area = str(args.area).toLowerCase();
    const offices = must(
      await db.from("registry_offices").select("*").eq("authority", agent.authority)
        .eq("service", b.service).order("id"),
    ) as any[];
    const booked = new Set(
      must(await db.from("registry_bookings").select("slot_id")).map((r: any) => r.slot_id),
    );
    const slots = must(
      await db.from("registry_slots").select("*").in("office_id", offices.map((o) => o.id))
        .gte("starts_at", `${today}T00:00`).order("starts_at"),
    ) as any[];
    const officeOk = await (b.officeFilter ?? ALL)(ctx);
    const slotOk = await (b.slotFilter ?? ALL)(ctx);
    const list = offices
      .filter(officeOk)
      .filter((o) =>
        !area || String(o.area ?? "").toLowerCase().includes(area) ||
        o.name.toLowerCase().includes(area)
      )
      .map((o) => ({
        office_id: o.id,
        office: o.name,
        area: o.area,
        address: o.address,
        step_free: o.step_free,
        slots: slots.filter((s) =>
          s.office_id === o.id && !booked.has(s.id) && slotOk(String(s.starts_at).slice(0, 10))
        ).slice(0, 3)
          // hhmm: 24-hour local time for the recommender ("time" is "9:40 am").
          .map((s) => ({
            slot_id: s.id,
            hhmm: String(s.starts_at).replace(" ", "T").slice(11, 16),
            ...spoken(s.starts_at),
          })),
      }));
    // P15 recommender: top 3 with a reason (deadline, preference, the caller's mock calendar).
    const conv = must(
      await db.from("conversations").select("citizen_id, verified_at").eq("id", conversationId)
        .maybeSingle(),
    );
    const prefer = ["morning", "afternoon"].includes(str(args.prefer))
      ? str(args.prefer) as "morning" | "afternoon"
      : "";
    const recommended = recommend({
      slots: list.flatMap((o) =>
        o.slots.map((s: any) => ({
          slot_id: s.slot_id,
          date: s.date,
          time: s.hhmm,
          office: o.office,
        }))
      ),
      citizenId: conv?.verified_at ? conv.citizen_id : null,
      prefer,
    }).map((r) => {
      const s = list.flatMap((o) => o.slots).find((x: any) => x.slot_id === r.slot_id)!;
      return { ...r, start_spoken: s.start_spoken, start_spoken_sw: s.start_spoken_sw };
    });
    await audit(
      conversationId,
      agent.authority,
      "Service",
      `Offices listed (${list.length}), ${list.reduce((n, o) => n + o.slots.length, 0)} free slots`,
      { rule_ids: ["RC-01", "RC-02", "RC-03"] },
    );
    return {
      offices: list,
      recommended,
      next: list.length
        ? "Offer the first recommended slot with its reason in a few words (offer another if the caller asks). Read back office, date and time and ask yes or no before registry_book_slot."
        : "No office matched. Ask which area suits the caller and list again.",
    };
  },

  registry_book_slot: async (ctx) => {
    const { conversationId, agent, args } = ctx;
    const citizen = await requireVerified(conversationId, agent, "registry_book_slot");
    const b = BOOKINGS[agent.authority];
    if (!b) throw new ToolError("no_bookings", "This service has no office appointments.");
    const caseRef = await b.caseRef(ctx, citizen);

    const existing = must(
      await db.from("registry_bookings").select(
        "ref, registry_offices(name), registry_slots(starts_at)",
      )
        .eq("conversation_id", conversationId).eq("case_ref", caseRef).maybeSingle(),
    );
    if (existing) {
      return {
        booked: true,
        booking_ref: existing.ref,
        office: existing.registry_offices.name,
        ...spoken(existing.registry_slots.starts_at),
      };
    }

    await b.check(ctx, citizen, caseRef);

    const slot = must(
      await db.from("registry_slots").select("*, registry_offices(*)")
        .eq("id", str(args.slot_id)).maybeSingle(),
    );
    if (
      !slot || slot.registry_offices.authority !== agent.authority ||
      slot.registry_offices.service !== b.service
    ) {
      throw new ToolError("unknown_slot", "Use slot_id from registry_list_offices.");
    }
    const officeOk = await (b.officeFilter ?? ALL)(ctx);
    const slotOk = await (b.slotFilter ?? ALL)(ctx);
    if (!officeOk(slot.registry_offices) || !slotOk(String(slot.starts_at).slice(0, 10))) {
      throw new ToolError(
        "slot_not_allowed",
        "The rules do not allow that slot for this caller. List offices again and offer one of those.",
      );
    }
    const ref = `${b.refPrefix}-${digits(5)}`;
    const { error } = await db.from("registry_bookings").insert({
      ref,
      conversation_id: conversationId,
      office_id: slot.office_id,
      slot_id: slot.id,
      case_ref: caseRef,
    });
    if (error) throw new ToolError("slot_taken", "That slot was just taken. List offices again.");
    await addCalendarItem({
      conversationId,
      authorityId: agent.authority,
      ref,
      title: `DEMO: ${slot.registry_offices.name}`,
      localStart: String(slot.starts_at),
      area: slot.registry_offices.area,
      location: `${slot.registry_offices.name}, ${slot.registry_offices.address}`,
    });
    const t = spoken(slot.starts_at);
    await audit(
      conversationId,
      agent.authority,
      "Service",
      `Appointment booked: ${slot.registry_offices.name}, ${t.start_spoken}`,
      { rule_ids: b.rule_ids },
    );
    return {
      booked: true,
      booking_ref: ref,
      office: slot.registry_offices.name,
      ...t,
      calendar_link_in_sms: true,
      next:
        "Confirm the booking, then offer the SMS summary (it has an add-to-calendar link; never read links aloud). If the caller wants it by email too, offer calendar_email.",
    };
  },
};
