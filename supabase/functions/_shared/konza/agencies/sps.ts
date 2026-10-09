// Savanahlands Passport Services (SPS): Kenyan passport renewal in Konza (PP-01 to PP-05,
// AD-06). Reuses the Kenyan passport rules (rules/ke/pp.ts).

import { db, must } from "../../db.ts";
import { PASSPORT_FEES_KES, passportQuote, readyBy, renewalOpen } from "../../rules/ke/pp.ts";
import { keCalendar } from "../../rules/ke/calendar.ts";
import { DELIVERY_FEE_KES } from "../../rules/konza/rules.ts";
import type { Agency, Resident } from "../types.ts";
import { rb, readBack } from "../../readback.ts";

async function passportOf(r: Resident) {
  return must(
    await db.from("passports").select("number, pages, expires, status").eq("citizen_id", r.id)
      .eq("status", "active").maybeSingle(),
  ) as { number: string; pages: number; expires: string; status: string } | null;
}

export const sps: Agency = {
  id: "sps",
  name: "Savanahlands Passport Services",
  authority: "sps",
  desk: "the Konza Passport Desk",
  services: {
    passport_renewal: {
      title: "Kenyan passport renewal",
      card: [
        "Fees and the renewal rules need no personal details: rules_lookup topic fees, topic renewal_rules (for example, do pages left matter).",
        "A returning caller: rules_lookup topic my_application gives their application, the fee still owed (owed_kes, the amount for payment_request), payment, biometrics and delivery.",
        "To renew: verify the caller, then rules_lookup topic renewal for their passport.",
        "Ask which booklet (34, 50 or 66 pages) and whether they want it delivered home or will collect it at the Konza Passport Desk.",
        "application_submit with fields pages and receive; read back the summary and the fee, get a clear yes, then call it again with the confirmation_id.",
        "Say the decision and its reason from the result. If an officer must decide, say so and when; never guess the outcome.",
        "Biometrics (PP-03): in person at the Konza Passport Desk, on a working day (Monday to Friday, not a public holiday) within the next 10 working days, morning 8 to 12 or afternoon 2 to 5; appointment_book checks the day you ask for.",
        "Once the fee is paid and biometrics are booked, delivery_book books home delivery or collection at the Konza Passport Desk (method collect).",
        "Delivery is handed only to the holder in person, with ID and a one-time code.",
      ].join("\n"),
      topics: {
        fees: {
          needsResident: false,
          answer: () =>
            Promise.resolve({
              topic: "fees",
              values: { fees_kes: PASSPORT_FEES_KES },
              rule_ids: ["PP-01"],
              reason_en:
                "Fees by booklet: 34 pages KES 7,550, 50 pages KES 9,550, 66 pages KES 12,050.",
            }),
        },
        delivery: {
          needsResident: false,
          answer: () =>
            Promise.resolve({
              topic: "delivery",
              values: {
                fee_kes: DELIVERY_FEE_KES,
                windows: ["morning", "afternoon"],
                holder_only: true,
              },
              rule_ids: ["AD-03", "AD-04", "AD-06"],
              reason_en:
                "Delivery is the next working day, morning or afternoon, for KES 200; a passport is handed only to its holder, who shows ID and gives a one-time code. Collection at the desk is free.",
            }),
        },
        renewal_rules: {
          needsResident: false,
          answer: () =>
            Promise.resolve({
              topic: "renewal_rules",
              values: {
                opens_months_before_expiry: 12,
                full_or_damaged: true,
                pages_left_matter: false,
              },
              rule_ids: ["PP-02"],
              reason_en:
                "A passport can be renewed within 12 months of its expiry date, after it has expired, or at any time if it is full or damaged. Otherwise the number of pages left does not matter.",
            }),
        },
        my_application: {
          needsResident: true,
          answer: async (r, _inputs, today) => {
            const a = r
              ? must(
                await db.from("konza_applications").select("id, ref, status, created_at")
                  .eq("agency", "sps").eq("subject_citizen_id", r.id)
                  .order("created_at", { ascending: false }).limit(1),
              )[0]
              : null;
            if (!a) {
              return {
                topic: "my_application",
                values: { has_application: false },
                rule_ids: ["PP-03"],
                reason_en: "There is no passport application on record for this resident.",
              };
            }
            const [d, paid, appt, del] = await Promise.all([
              db.from("konza_decisions").select("outcome, decided_by, inputs").eq(
                "application_id",
                a.id,
              )
                .single()
                .then(must),
              db.from("payments").select("amount").eq("case_ref", a.ref).eq("status", "approved")
                .then(must),
              db.from("konza_appointments").select("on_date, window").eq("application_id", a.id)
                .maybeSingle().then(must),
              db.from("deliveries").select("method, deliver_on, window").eq("item_ref", a.id)
                .neq("status", "cancelled").maybeSingle().then(must),
            ]);
            const fee = d.outcome === "granted" && typeof d.inputs?.fee_kes === "number"
              ? d.inputs.fee_kes
              : 0;
            const owed = Math.max(
              0,
              fee - paid.reduce((n: number, p: { amount: number }) => n + Number(p.amount), 0),
            );
            return {
              topic: "my_application",
              values: {
                has_application: true,
                ref: a.ref,
                outcome: d.outcome,
                paid: paid.length > 0,
                // The fee still owed, from the decision's recorded fee (PP-01): what payment_request
                // takes as amount_kes.
                owed_kes: owed,
                // K6: whether biometrics are done is a date comparison, made here, never by the
                // assistant (a past booking counts as done).
                biometrics: appt ? { ...appt, done: appt.on_date < today } : null,
                delivery: del ?? null,
              },
              rule_ids: ["PP-03", "PP-04"],
              reason_en: `Application ${a.ref}: ${d.outcome.replace("_", " ")}; fee ${
                owed ? `not paid yet (KES ${owed} owed)` : paid.length ? "paid" : "none due"
              }; biometrics ${
                appt
                  ? appt.on_date < today
                    ? `done on ${appt.on_date}`
                    : `booked for ${appt.on_date}, ${appt.window}`
                  : "not booked"
              }; ${
                del
                  ? del.method === "collect"
                    ? `collection from ${del.deliver_on}`
                    : `delivery on ${del.deliver_on}, ${del.window}`
                  : "no delivery or collection booked"
              }.`,
            };
          },
        },
        renewal: {
          needsResident: true,
          answer: async (r, _inputs, today) => {
            const p = r ? await passportOf(r) : null;
            if (!p) {
              return {
                topic: "renewal",
                values: { has_passport: false },
                rule_ids: ["PP-02"],
                reason_en:
                  "There is no active passport on record; an officer can help with a first passport.",
              };
            }
            const o = renewalOpen({ expires: p.expires, today });
            // MED-299: the answer in words, so nobody works out dates (a call got it backwards).
            return {
              topic: "renewal",
              values: { has_passport: true, open: o.open, expires: p.expires, pages: p.pages },
              rule_ids: [o.rule_id],
              reason_en: o.open
                ? `Renewal is open now for this passport (it expires on ${p.expires}): ${
                  o.reason_en.charAt(0).toLowerCase()
                }${o.reason_en.slice(1)}`
                : `Renewal is not open yet for this passport (it expires on ${p.expires}): ${
                  o.reason_en.charAt(0).toLowerCase()
                }${o.reason_en.slice(1)}`,
              say:
                "Say whether renewal is open exactly as reason_en says. Never compare dates yourself.",
            };
          },
        },
      },
      applicationSchema: {
        type: "object",
        required: ["pages", "receive"],
        additionalProperties: false,
        properties: {
          pages: { type: "integer", enum: [34, 50, 66] },
          receive: { type: "string", enum: ["home", "collect"] },
          full_or_damaged: { type: "boolean" },
        },
      },
      consentScope: null,
      summarize: (f) => {
        const items = {
          pages: rb.number(Number(f.pages)),
          fee: rb.amount(passportQuote(Number(f.pages))!.fee_kes),
        };
        return f.receive === "home"
          ? readBack(
            items,
            (s) =>
              `Apply to renew the Kenyan passport with a ${s.pages}-page booklet, fee ${s.fee}, delivered home.`,
            (s) =>
              `Kuomba kurenew pasipoti ya Kenya yenye kurasa ${s.pages}, ada ${s.fee}, utaletewa nyumbani.`,
          )
          : readBack(
            { ...items, desk: rb.place("Konza Passport Desk") },
            (s) =>
              `Apply to renew the Kenyan passport with a ${s.pages}-page booklet, fee ${s.fee}, collected at the ${s.desk}.`,
            (s) =>
              `Kuomba kurenew pasipoti ya Kenya yenye kurasa ${s.pages}, ada ${s.fee}, utaichukua kwenye ${s.desk}.`,
          );
      },
      decide: async ({ subject, fields, today }) => {
        const p = await passportOf(subject);
        const fee = passportQuote(Number(fields.pages))!;
        if (!p) {
          return {
            outcome: "pending_officer",
            rule_ids: ["PP-02"],
            reason_en:
              "There is no active passport on record, so an officer will check the application.",
            inputs: { has_passport: false },
          };
        }
        const o = renewalOpen({
          expires: p.expires,
          today,
          fullOrDamaged: fields.full_or_damaged === true,
        });
        if (!o.open) {
          return {
            outcome: "pending_officer",
            rule_ids: [o.rule_id],
            reason_en: `${o.reason_en} An officer will check whether another reason applies.`,
            inputs: { expires: p.expires },
          };
        }
        return {
          outcome: "granted",
          rule_ids: [o.rule_id, ...fee.rule_ids],
          reason_en: `The renewal is accepted: ${o.reason_en.charAt(0).toLowerCase()}${
            o.reason_en.slice(1)
          }`,
          // Every amount the decision quotes is on the record (K4: the checker recomputes it).
          inputs: { expires: p.expires, pages: fee.pages, fee_kes: fee.fee_kes },
          next_en:
            `Pay KES ${fee.fee_kes}, then give biometrics at the Konza Passport Desk. The old passport stays valid until the new one is handed over.`,
        };
      },
      // PY-01, PY-02: the fee the decision recorded (PP-01), paid after acceptance (PP-03).
      charge: (fields, inputs) =>
        typeof inputs.fee_kes === "number"
          ? {
            amount_kes: inputs.fee_kes,
            rule_ids: ["PP-01"],
            description: `Kenyan passport renewal, ${fields.pages}-page booklet`,
          }
          : null,
      // PP-03, PP-04: biometrics at the Konza Passport Desk once the fee is paid.
      appointment: {
        kind: "biometrics",
        desk: "konza_passport_desk",
        title: "Biometrics",
        title_sw: "Biometriki",
        afterPayment: true,
        rule_ids: ["PP-03", "PP-04"],
        bring: "your current passport and your resident number",
        bring_sw: "pasipoti yako ya sasa na namba yako ya mkazi",
        readyBy: (onDate) => readyBy(onDate, keCalendar),
      },
      deliverable: { kind: "passport", holderOnly: true },
    },
  },
};
