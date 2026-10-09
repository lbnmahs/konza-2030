// K5 (MED-301): the core's own asks-first read-backs (review, consent, delivery, appointment), in
// English and Swahili, as pure functions so they are unit tested and the T1 mocks come from them.
// The agencies' application read-backs live in each agency's `summarize`. Swahili is a draft for
// Mahs to review.

import { rb, type ReadBack, readBack, type ReadBackItem } from "../readback.ts";
import type { ISODate } from "../rules/common/dates.ts";
import { type DeskId, DESKS, REVIEW_ANSWER_WORKING_DAYS } from "../rules/konza/rules.ts";
import type { ServiceDef } from "./types.ts";

const SCOPE_WORDS: Record<string, { en: string; sw: string }> = {
  registration: { en: "registration", sw: "usajili" },
  health_cover: { en: "health cover", sw: "bima ya afya" },
  school_application: { en: "school applications", sw: "maombi ya shule" },
};
const ITEM_WORDS: Record<string, { en: string; sw: string }> = {
  passport: { en: "passport", sw: "Pasipoti" },
  resident_card: { en: "resident card", sw: "Kadi ya mkazi" },
  certificate: { en: "certificate", sw: "Cheti" },
};

/** WINDOW_HOURS as a spoken item: morning 8 to 12, afternoon 2 to 5. */
const windowItem = (w: string) =>
  w === "afternoon"
    ? rb.hours("in the afternoon", "14:00", "17:00")
    : rb.hours("in the morning", "08:00", "12:00");

/** "Lango Square" or "Konza Passport Desk", and whether English says "the" before it. */
const deskName = (d: DeskId) => ({
  name: DESKS[d].name.replace(/^the /, ""),
  the: DESKS[d].name.startsWith("the ") ? "the " : "",
});

export const reviewReadBack = (): ReadBack =>
  readBack(
    { days: rb.number(REVIEW_ANSWER_WORKING_DAYS) },
    (s) =>
      `Ask the Aminia Review Panel to review this decision. It is free, and an officer who did not make the decision answers within ${s.days} working days.`,
    (s) =>
      `Kuiomba Aminia Review Panel ipitie upya uamuzi huu. Ni bure, na afisa ambaye hakufanya uamuzi huo atajibu ndani ya siku ${s.days} za kazi.`,
  );

export const consentReadBack = (
  delegate: string,
  childFirstName: string,
  until: ISODate,
  scopes: string[],
): ReadBack =>
  readBack(
    {
      delegate: rb.name(delegate === "sia" ? "SIA" : delegate),
      child: rb.name(childFirstName),
      until: rb.date(until),
    },
    (s) =>
      `Record consent for ${s.delegate} to act for ${s.child} in ${
        scopes.map((x) => SCOPE_WORDS[x]?.en ?? x).join(", ")
      }, until ${s.until}. It can be withdrawn at any time.`,
    (s) =>
      `Kurekodi ridhaa ya ${s.delegate} kumhudumia ${s.child} katika ${
        scopes.map((x) => SCOPE_WORDS[x]?.sw ?? x).join(", ")
      }, hadi ${s.until}. Unaweza kuiondoa wakati wowote.`,
  );

export function deliveryReadBack(o: {
  item_kind: string;
  holderOnly: boolean;
  desk: DeskId | null;
  address: { written: string; spoken: string; spoken_sw: string } | null;
  on: ISODate;
  window: string;
  fee_kes: number;
}): ReadBack {
  const kind = ITEM_WORDS[o.item_kind] ?? { en: o.item_kind, sw: o.item_kind };
  const holderEn = o.holderOnly
    ? "Only the holder can receive it, showing ID and a one-time code."
    : "Bring ID and the one-time code.";
  const holderSw = o.holderOnly
    ? "Mwenye nayo pekee ndiye anaweza kuipokea, akionyesha kitambulisho na namba ya siri ya mara moja."
    : "Leta kitambulisho na namba ya siri ya mara moja.";
  if (o.desk) {
    const d = deskName(o.desk);
    return readBack(
      { desk: rb.place(d.name), on: rb.date(o.on), hours: windowItem(o.window) },
      (s) =>
        `The ${kind.en} will be ready to collect at ${d.the}${s.desk} from ${s.on}, ${s.hours}, free. ${holderEn}`,
      (s) =>
        `${kind.sw} itakuwa tayari kuchukuliwa ${s.desk} kuanzia ${s.on}, ${s.hours}, bure. ${holderSw}`,
    );
  }
  const a = o.address!;
  return readBack(
    {
      address: rb.spokenPlace(a.written, a.spoken, a.spoken_sw),
      on: rb.date(o.on),
      hours: windowItem(o.window),
      fee: rb.amount(o.fee_kes),
    },
    (s) =>
      `The ${kind.en} will be delivered to ${s.address} on ${s.on}, ${s.hours}, for ${s.fee}. ${holderEn}`,
    (s) => `${kind.sw} italetwa ${s.address} ${s.on}, ${s.hours}, kwa ${s.fee}. ${holderSw}`,
  );
}

export function appointmentReadBack(
  ap: NonNullable<ServiceDef["appointment"]>,
  o: { on: ISODate; window: string; from: ISODate | null },
): ReadBack {
  const d = deskName(ap.desk);
  const items: Record<string, ReadBackItem> = {
    on: rb.date(o.on),
    hours: windowItem(o.window),
    desk: rb.place(d.name),
    ...(o.from ? { from: rb.date(o.from) } : {}),
  };
  return readBack(
    items,
    (s) =>
      `${
        o.from
          ? `Move ${ap.title.toLowerCase()} from ${s.from} to ${s.on}, ${s.hours}`
          : `${ap.title} on ${s.on}, ${s.hours}`
      }, at ${d.the}${s.desk}. Come any time in that window. Bring ${ap.bring}.`,
    (s) =>
      `${
        o.from
          ? `Kuhamisha miadi ya ${ap.title_sw.toLowerCase()} kutoka ${s.from} hadi ${s.on}, ${s.hours}`
          : `Miadi ya ${ap.title_sw.toLowerCase()} ${s.on}, ${s.hours}`
      }, kwenye ${s.desk}. Njoo wakati wowote katika muda huo. Leta ${ap.bring_sw}.`,
  );
}

/** A phone-code payment prompt (PY-01): the rules total and the payee, before the yes. */
export const paymentReadBack = (amount_kes: number, payee: string, description: string) =>
  readBack(
    { amount: rb.amount(amount_kes), payee: rb.name(payee) },
    (s) =>
      `Send a DEMO payment prompt for ${s.amount} to ${s.payee}, ${description}. You approve it by telling me the 6-digit code; doing nothing declines it.`,
    (s) =>
      `Kutuma ombi la malipo la DEMO la ${s.amount} kwa ${s.payee}. Utaidhinisha kwa kuniambia namba ya siri yenye tarakimu sita; usipofanya chochote, malipo yatakataliwa.`,
  );
