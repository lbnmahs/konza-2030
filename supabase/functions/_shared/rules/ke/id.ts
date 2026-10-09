// Usajili Njema national ID replacement rules (fictional, modelled on Kenyan practice).
// ID-01 a confirmed loss declaration blocks the old card at once.
// ID-02 replacement fee KES 1,000.
// ID-03 a new photo is required before a biometrics booking.
// ID-04 biometrics and collection happen in person at a registration office.

import { addDays, type ISODate } from "../common/dates.ts";

export const ID_REPLACEMENT_FEE_KES = 1000;

export type ReplacementSteps = {
  fee_kes: number;
  steps: { rule_id: string; en: string; sw: string }[];
  rule_ids: string[];
};

export function idReplacement(): ReplacementSteps {
  return {
    fee_kes: ID_REPLACEMENT_FEE_KES,
    steps: [
      {
        rule_id: "ID-01",
        en: "The old card is blocked as soon as the loss is confirmed.",
        sw: "Kitambulisho cha zamani kinazuiwa mara hasara inapothibitishwa.",
      },
      {
        rule_id: "ID-02",
        en: "The replacement fee is KES 1,000.",
        sw: "Ada ya kitambulisho kipya ni shilingi elfu moja.",
      },
      {
        rule_id: "ID-03",
        en: "A new passport-style photo is needed before booking biometrics.",
        sw: "Picha mpya inahitajika kabla ya kupanga miadi ya alama za vidole.",
      },
      {
        rule_id: "ID-04",
        en: "Biometrics and collection are in person at a registration office.",
        sw: "Alama za vidole na kuchukua kitambulisho ni ana kwa ana katika ofisi ya usajili.",
      },
    ],
    rule_ids: ["ID-01", "ID-02", "ID-03", "ID-04"],
  };
}

/** A loss date must be today or in the past year. */
export function lossDateValid(lostOn: ISODate, today: ISODate): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(lostOn) && lostOn <= today && lostOn >= addDays(today, -365);
}

/** ID-02 and ID-03 must both be met before a biometrics slot is booked. */
export function canBookBiometrics(s: { paid: boolean; photoReceived: boolean }) {
  if (!s.paid) {
    return {
      ok: false as const,
      rule_id: "ID-02",
      reason_en: "The replacement fee is not paid yet.",
    };
  }
  if (!s.photoReceived) {
    return {
      ok: false as const,
      rule_id: "ID-03",
      reason_en: "The new photo has not been received yet.",
    };
  }
  return { ok: true as const, rule_ids: ["ID-03", "ID-04"] };
}
