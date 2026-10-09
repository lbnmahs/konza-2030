// Tiba Njema Cover Authority health cover rules (modelled on Kenya's social health scheme).
// SH-01 cover is active only when the current month's contribution has cleared.
// SH-02 informal-sector minimum contribution KES 300 a month.
// SH-03 newborns are added with a birth notification or certificate.
// SH-04 (fictional) a dependant request is decided within 2 working days (Kenya calendar);
//       the dependant is covered from approval.

import { addMonths, type ISODate } from "../common/dates.ts";
import { keCalendar } from "./calendar.ts";

export const SH_MIN_MONTHLY_KES = 300;

export const monthOf = (d: ISODate) => d.slice(0, 7);

export function coverStatus(paidMonths: string[], today: ISODate) {
  const sorted = [...paidMonths].sort();
  return {
    active: sorted.includes(monthOf(today)),
    last_paid_month: sorted.at(-1) ?? null,
    months_behind: sorted.length ? monthsBetween(sorted.at(-1)!, monthOf(today)) : null,
    rule_ids: ["SH-01"],
  };
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** What restores cover now: this month's contribution (SH-01, SH-02), or null if active. */
export function contributionDue(paidMonths: string[], today: ISODate) {
  if (coverStatus(paidMonths, today).active) return null;
  return {
    month: monthOf(today),
    amount_kes: SH_MIN_MONTHLY_KES,
    cover_from: today,
    cover_until: addMonths(`${monthOf(today)}-01`, 1), // first day of next month
    rule_ids: ["SH-01", "SH-02"],
  };
}

/** SH-04: decision date for a dependant request made today. */
export const dependantDecisionBy = (today: ISODate) => keCalendar.addWorkingDays(today, 2);

/** SH-03 is for a child already born: date of birth in the past 12 months. */
export function newbornDobValid(dob: ISODate, today: ISODate): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dob) && dob <= today && dob >= addMonths(today, -12);
}
