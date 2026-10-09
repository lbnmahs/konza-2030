// Kenya: public holidays (Public Holidays Act, Cap 110) and working days, Monday to Friday.
// Time zone Africa/Nairobi. A holiday on a Sunday moves to the Monday; one on a Saturday does
// not move. Idd dates are gazetted after moon sighting, so the ones below are approximate.

import { type ISODate, makeCalendar, todayIn } from "../common/dates.ts";

export const TIMEZONE = "Africa/Nairobi";

export const KENYA_PUBLIC_HOLIDAYS: ReadonlySet<ISODate> = new Set([
  "2026-01-01", // New Year's Day
  "2026-03-20", // Idd-ul-Fitr (approximate)
  "2026-04-03", // Good Friday
  "2026-04-06", // Easter Monday
  "2026-05-01", // Labour Day
  "2026-05-27", // Idd-ul-Azha (approximate)
  "2026-06-01", // Madaraka Day
  "2026-10-10", // Mazingira Day (Saturday)
  "2026-10-20", // Mashujaa Day
  "2026-12-12", // Jamhuri Day (Saturday)
  "2026-12-25", // Christmas Day
  "2026-12-26", // Utamaduni Day (Saturday)
  "2027-01-01",
  "2027-03-10", // Idd-ul-Fitr (approximate)
  "2027-03-26",
  "2027-03-29",
  "2027-05-01", // Saturday
  "2027-05-17", // Idd-ul-Azha (approximate)
  "2027-06-01",
  "2027-10-11", // Mazingira Day falls on Sunday 10 October
  "2027-10-20",
  "2027-12-13", // Jamhuri Day falls on Sunday 12 December
  "2027-12-25", // Saturday
  "2027-12-27", // Utamaduni Day falls on Sunday 26 December
]);

export const keCalendar = makeCalendar(KENYA_PUBLIC_HOLIDAYS);

export const todayNairobi = (now = new Date()) => todayIn(TIMEZONE, now);
