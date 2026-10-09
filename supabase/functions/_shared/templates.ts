// SMS bodies, composed only from rows this conversation created or the verified citizen owns.
// The LLM picks a template key; it never supplies references, dates or amounts.

import { db, must } from "./db.ts";
import type { Citizen } from "./session.ts";
import { swDate, swMonth, swTime } from "./sw.ts";
import { mask, spokenDate } from "./util.ts";

const OTP: Record<string, (code: string) => string> = {
  sia: (c) =>
    `SIA (DEMO): your code is ${c}, valid 5 minutes. / Code yako ni ${c}, itaisha baada ya dakika 5.`,
  njia: (c) => `NJIA (DEMO): code yako ya uthibitisho ni ${c}. Itaisha baada ya dakika 5.`,
  pwani_njema: (c) =>
    `Kaunti ya Pwani Njema (DEMO): code yako ya uthibitisho ni ${c}. Itaisha baada ya dakika 5.`,
  usajili_njema: (c) =>
    `Usajili Njema (DEMO): code yako ya uthibitisho ni ${c}. Itaisha baada ya dakika 5.`,
  tiba_njema: (c) =>
    `Tiba Njema (DEMO): code yako ya uthibitisho ni ${c}. Itaisha baada ya dakika 5.`,
  wezesha_njema: (c) =>
    `Wezesha Njema (DEMO): code yako ya uthibitisho ni ${c}. Itaisha baada ya dakika 5.`,
};

export function otpMessage(authority: string, code: string): string {
  return (OTP[authority] ?? OTP.njia)(code);
}

/** One sentence per partner decision on this call (names only, never the data sent). */
async function partnerLines(conversationId: string): Promise<string[]> {
  const rows = must(
    await db.from("partner_referrals").select("status, partners(name)")
      .eq("conversation_id", conversationId).order("created_at"),
  );
  return rows.map((r: any) =>
    r.status === "sent"
      ? `Shared with ${r.partners.name}.`
      : r.status === "scheduled"
      ? `${r.partners.name} will be told once your application is approved.`
      : `Not shared with ${r.partners.name}, as you asked.`
  );
}

type Composer = (conversationId: string, citizen: Citizen) => Promise<string | null>;

/** Bookings on this call whose reference starts with the prefix (a country agent call can have
 * several). */
async function bookingsWith(conversationId: string, prefix: string) {
  const rows = must(
    await db.from("registry_bookings").select("ref, registry_slots(starts_at)")
      .eq("conversation_id", conversationId).like("ref", `${prefix}-%`).order("ref"),
  );
  const cal = must(
    await db.from("calendar_items").select("id, ref").eq("conversation_id", conversationId),
  );
  return rows.map((b: any) => {
    const [date, time] = String(b.registry_slots.starts_at).replace(" ", "T").split("T");
    const c = cal.find((x: any) => x.ref === b.ref);
    // P15: the add-to-calendar link rides in the booking line of the SMS.
    return {
      ref: b.ref,
      when: `${spokenDate(date, true)} at ${time.slice(0, 5)}${
        c ? ` (add to calendar: ${Deno.env.get("WEB_BASE_URL")}/c/${c.id})` : ""
      }`,
    };
  });
}

export const TEMPLATES: Record<string, { authority: string; compose: Composer }> = {
  s3_permit_issued_sw: {
    authority: "pwani_njema",
    compose: async (conversationId, citizen) => {
      const pay = must(
        await db.from("payments").select("id, amount, txn_code").eq(
          "conversation_id",
          conversationId,
        )
          .eq("citizen_id", citizen.id).eq("status", "approved").order("created_at", {
            ascending: false,
          }).limit(1),
      )[0];
      if (!pay) return null;
      const permit = must(
        await db.from("county_permits").select("permit_no, expires, verify_code")
          .eq("renewed_payment_id", pay.id).maybeSingle(),
      );
      if (!permit) return null;
      return `Kaunti ya Pwani Njema: Permit ${permit.permit_no} imesasishwa. Halali hadi ${
        swDate(permit.expires)
      }. Code ya uthibitisho: ${permit.verify_code}. Malipo: KES ${
        Number(pay.amount).toLocaleString("en-GB")
      } (${pay.txn_code}). DEMO: huduma ya kubuni.`;
    },
  },
  id_replacement_ke_sw: {
    authority: "usajili_njema",
    compose: async (conversationId) => {
      const loss = must(
        await db.from("id_losses").select("ref, id_cards(card_no)").eq(
          "conversation_id",
          conversationId,
        ).maybeSingle(),
      );
      if (!loss) return null;
      const parts = [
        `${mask("Kitambulisho", loss.id_cards.card_no)} kimezuiwa (${loss.ref}).`,
      ];
      const app = must(
        await db.from("id_applications").select("ref").eq("conversation_id", conversationId)
          .maybeSingle(),
      );
      if (app) {
        const pay = must(
          await db.from("payments").select("amount, txn_code").eq("conversation_id", conversationId)
            .eq("case_ref", app.ref).eq("status", "approved").limit(1),
        )[0];
        parts.push(
          `Ombi ${app.ref}${
            pay
              ? `: malipo KES ${Number(pay.amount).toLocaleString("en-GB")} (${pay.txn_code})`
              : ""
          }.`,
        );
      }
      const booking = must(
        await db.from("registry_bookings").select(
          "ref, registry_offices(name), registry_slots(starts_at)",
        )
          .eq("conversation_id", conversationId).like("ref", "UN-BIO-%").maybeSingle(),
      );
      if (booking) {
        const [date, time] = String(booking.registry_slots.starts_at).replace(" ", "T").split("T");
        parts.push(
          `Miadi: ${booking.registry_offices.name}, ${swDate(date)} ${
            swTime(time.slice(0, 5))
          } (${booking.ref}). Fika na risiti ya malipo.`,
        );
      }
      return `Usajili Njema (DEMO): ${parts.join(" ")} Huduma ya kubuni.`;
    },
  },
  k1_summary_sw: {
    authority: "tiba_njema",
    compose: async (conversationId) => {
      const parts: string[] = [];
      const pays = must(
        await db.from("payments").select("id, txn_code").eq("conversation_id", conversationId)
          .eq("status", "approved"),
      );
      const contrib = pays.length
        ? must(
          await db.from("health_contributions").select("month, amount, payment_id")
            .in("payment_id", pays.map((p: any) => p.id)).limit(1),
        )[0]
        : null;
      if (contrib) {
        parts.push(
          `Mchango wa ${swMonth(contrib.month)} KES ${
            Number(contrib.amount).toLocaleString("en-GB")
          } umepokelewa (${
            pays.find((p: any) => p.id === contrib.payment_id)?.txn_code
          }). Bima iko hai.`,
        );
      }
      const dep = must(
        await db.from("health_dependants").select("ref, decision_by").eq(
          "conversation_id",
          conversationId,
        ).order("created_at", { ascending: false }).limit(1),
      )[0];
      if (dep) {
        parts.push(
          `Ombi la kuongeza mtoto ${dep.ref}: uamuzi kufikia ${swDate(dep.decision_by)}.`,
        );
      }
      if (!parts.length) return null;
      return `Tiba Njema (DEMO): ${parts.join(" ")} Huduma ya kubuni.`;
    },
  },
  n2_summary_sw: {
    authority: "wezesha_njema",
    compose: async (conversationId) => {
      const app = must(
        await db.from("tax_exemption_applications").select("ref, status").eq(
          "conversation_id",
          conversationId,
        ).maybeSingle(),
      );
      if (!app) return null;
      const parts = [`Ombi la tax exemption ${app.ref} limepokelewa, linasubiri vetting.`];
      const b = must(
        await db.from("registry_bookings").select(
          "ref, registry_offices(name), registry_slots(starts_at)",
        )
          .eq("conversation_id", conversationId).like("ref", "WNC-VT-%").maybeSingle(),
      );
      if (b) {
        const [date, time] = String(b.registry_slots.starts_at).replace(" ", "T").split("T");
        parts.push(
          `Vetting: ${b.registry_offices.name} (step-free), ${swDate(date)} ${
            swTime(time.slice(0, 5))
          } (${b.ref}).`,
        );
      }
      for (const line of await partnerLines(conversationId)) parts.push(line);
      return `Wezesha Njema (DEMO): ${parts.join(" ")} Huduma ya kubuni.`;
    },
  },
  // P14: GP registration and the study visa desk on the FHS country agent.
  passport_ke_sw: {
    authority: "njema_passports",
    compose: async (conversationId) => {
      const app = must(
        await db.from("passport_applications").select("ref, pages, fee, desk_area")
          .eq("conversation_id", conversationId).maybeSingle(),
      );
      if (!app) return null;
      const parts = [
        `Njema Passport Service (DEMO): ombi ${app.ref}, kurasa ${app.pages}, ada KES ${
          Number(app.fee).toLocaleString("en-GB")
        }.`,
      ];
      for (const b of await bookingsWith(conversationId, "NPS-BIO")) {
        parts.push(`Biometrics ${app.desk_area} ${b.when}, ref ${b.ref}.`);
      }
      parts.push("Pasipoti ya zamani ni halali hadi uchukue mpya. Huduma ya kubuni.");
      return parts.join(" ");
    },
  },
};

// K3 (MED-291): the explain-why receipt for a Konza decision on this call, one template per
// agency. Built only from rows this call created: what, who decided, the rules, the reason, the
// next step, the payment, appointment or collection, the review route and the receipt page.
async function konzaReceipt(
  conversationId: string,
  agencyId: string,
  citizenId: string,
): Promise<string | null> {
  const { nairobiDay, reviewAskBy } = await import("./rules/konza/rules.ts");
  const { AGENCIES } = await import("./konza/manifest.ts");
  // This call's newest application with the agency; on a later call (MED-299) the verified
  // resident's newest one, as applicant or subject.
  const app = must(
    await db.from("konza_applications").select("id, ref, service").eq("session", conversationId)
      .eq("agency", agencyId).order("created_at", { ascending: false }).limit(1),
  )[0] ?? must(
    await db.from("konza_applications").select("id, ref, service").eq("agency", agencyId)
      .or(`applicant_citizen_id.eq.${citizenId},subject_citizen_id.eq.${citizenId}`)
      .order("created_at", { ascending: false }).limit(1),
  )[0];
  if (!app) return null;
  const d = must(
    await db.from("konza_decisions").select("*").eq("application_id", app.id).single(),
  );
  const title = AGENCIES[agencyId]?.services[app.service]?.title ?? app.service;
  const who = d.decided_by === "rule"
    ? `by rule ${d.rule_ids.join(", ")}`
    : d.decided_by === "officer"
    ? "by an officer"
    : "waiting for an officer";
  const parts = [`${title} ${app.ref}: ${d.outcome.replace("_", " ")} ${who}. ${d.reason_en}`];
  if (d.next_en) parts.push(`Next: ${d.next_en}`);
  const pay = must(
    await db.from("payments").select("amount, txn_code").eq("case_ref", app.ref)
      .eq("status", "approved").order("created_at", { ascending: false }).limit(1),
  )[0];
  if (pay) parts.push(`Paid KES ${Number(pay.amount).toLocaleString("en-GB")} (${pay.txn_code}).`);
  const appt = must(
    await db.from("konza_appointments").select("on_date, window").eq("application_id", app.id)
      .maybeSingle(),
  );
  if (appt) {
    parts.push(
      `Biometrics: Konza Passport Desk, ${spokenDate(appt.on_date, true)}, ${appt.window}.`,
    );
  }
  const del = must(
    await db.from("deliveries").select("method, deliver_on, window").eq("item_ref", app.id)
      .neq("status", "cancelled").maybeSingle(),
  );
  if (del) {
    parts.push(
      del.method === "collect"
        ? `Collect from ${spokenDate(del.deliver_on, true)} with ID and the one-time code.`
        : `Delivery ${spokenDate(del.deliver_on, true)}, ${del.window}.`,
    );
  }
  if (d.decided_at) {
    parts.push(
      `Review: ask the Aminia Review Panel by ${
        spokenDate(reviewAskBy(nairobiDay(String(d.decided_at))), true)
      }, free.`,
    );
  }
  parts.push(`Receipt: ${Deno.env.get("WEB_BASE_URL")}/r/${d.id}`);
  return `SIA (DEMO): ${parts.join(" ")} Fictional Konza.`;
}

for (const agencyId of ["sps", "siln", "srr", "sca", "sco"]) {
  TEMPLATES[`konza_receipt_${agencyId}`] = {
    authority: agencyId,
    compose: (conversationId, citizen) => konzaReceipt(conversationId, agencyId, citizen.id),
  };
}
