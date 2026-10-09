// Kenyan passport renewal on NJIA (P15), Njema Passport Service (fictional). Fees checked on
// immigration.go.ke on 1 Oct 2026 (page shows no effective date). The rest is modelled.
// PP-01 fees by booklet: 34 pages KES 7,550; 50 pages KES 9,550; 66 pages KES 12,050.
// PP-02 renewal is open when the passport expires within 12 months, has expired, or is full or
//       damaged (modelled).
// PP-03 apply online, then biometrics in person at a desk: Nairobi, or for the diaspora the NJIA
//       consular desks in London and Berlin (fictional). The fee is paid before booking.
// PP-04 the new passport is ready about 10 working days after biometrics (approximate).
// PP-05 the old passport stays valid until the new one is collected (modelled).

import type { Calendar, ISODate } from "../common/dates.ts";
import { addMonths } from "../common/dates.ts";

export const PASSPORT_FEES_KES: Record<number, number> = { 34: 7550, 50: 9550, 66: 12050 };

export const PP_FACTS = {
  fees: { approximate: false, source: "immigration.go.ke/type-and-fees", as_of: "2026-10-01" },
  ready_days: { value: 10, approximate: true, source: "Kenya mission pages (secondary)" },
};

export type PassportCheck = { expires: ISODate; today: ISODate; fullOrDamaged?: boolean };

export function renewalOpen(
  i: PassportCheck,
): { open: boolean; rule_id: string; reason_en: string } {
  if (i.fullOrDamaged) {
    return {
      open: true,
      rule_id: "PP-02",
      reason_en: "A full or damaged passport can be renewed.",
    };
  }
  if (i.expires <= addMonths(i.today, 12)) {
    return {
      open: true,
      rule_id: "PP-02",
      reason_en: i.expires < i.today ? "The passport has expired." : "It expires within 12 months.",
    };
  }
  return {
    open: false,
    rule_id: "PP-02",
    reason_en: "Renewal opens 12 months before the passport expires.",
  };
}

export function passportQuote(pages: number) {
  const fee = PASSPORT_FEES_KES[pages];
  if (!fee) return null;
  return { pages, fee_kes: fee, rule_ids: ["PP-01"] };
}

/** When the new passport should be ready, from the biometrics date (PP-04, approximate). */
export function readyBy(biometricsOn: ISODate, cal: Calendar): ISODate {
  return cal.addWorkingDays(biometricsOn, PP_FACTS.ready_days.value);
}
