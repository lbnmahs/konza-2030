// Konza rules (K2, docs/konza/world.md). Fictional unless marked in world.md.
// AD-03 delivery is the next working day, morning or afternoon.
// AD-04 delivery costs KES 200 per item; collection at a desk is free.
// AD-06 a passport is handed only to its holder in person (ID and one-time code).
// ED-03 places by catchment (the child's zone) first, then distance, then capacity.
// ED-04 if the preferred school is full, the nearest school with space is offered, and an
//       officer confirms the offer (adverse outcomes are never automatic).
// ED-06 primary places are for children aged 5 to 13 on the day of the application.
// RV-01 a decision can be reviewed if asked within 30 days; RV-02 by an officer who did not
//       make it, free; RV-03 answered within 10 working days.

import { addDays, type ISODate } from "../common/dates.ts";
import { keCalendar } from "../ke/calendar.ts";

export const DELIVERY_FEE_KES = 200;
export const REVIEW_WINDOW_DAYS = 30;
export const REVIEW_ANSWER_WORKING_DAYS = 10;

export const deliveryDate = (today: ISODate) => keCalendar.addWorkingDays(today, 1);

export const reviewAskBy = (decidedOn: ISODate) => addDays(decidedOn, REVIEW_WINDOW_DAYS);
export const reviewAnswerBy = (askedOn: ISODate) =>
  keCalendar.addWorkingDays(askedOn, REVIEW_ANSWER_WORKING_DAYS);

export function ageOn(dob: ISODate, day: ISODate): number {
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = day.split("-").map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

export const primaryAgeOk = (dob: ISODate, day: ISODate) => {
  const age = ageOn(dob, day);
  return age >= 5 && age <= 13;
};

export type School = {
  id: string;
  name: string;
  zone: number;
  capacity: number;
  places_taken: number;
};

export const placesLeft = (s: School) => Math.max(0, s.capacity - s.places_taken);

/** ED-03 and ED-04: grant the preferred school when it is in the child's zone and has space;
 * otherwise propose the nearest school with space for an officer to confirm. */
export function allocate(
  preferredId: string,
  childZone: number,
  schools: School[],
):
  | { outcome: "granted"; school: School; rule_ids: string[] }
  | {
    outcome: "pending_officer";
    why: "full" | "outside_catchment" | "unknown";
    alternative: School | null;
    rule_ids: string[];
  } {
  const preferred = schools.find((s) => s.id === preferredId);
  if (preferred && preferred.zone === childZone && placesLeft(preferred) > 0) {
    return { outcome: "granted", school: preferred, rule_ids: ["ED-03"] };
  }
  const alternative = schools
    .filter((s) => placesLeft(s) > 0 && s.id !== preferredId)
    .sort((a, b) =>
      Math.abs(a.zone - childZone) - Math.abs(b.zone - childZone) || placesLeft(b) - placesLeft(a)
    )[0] ?? null;
  return {
    outcome: "pending_officer",
    why: !preferred ? "unknown" : preferred.zone !== childZone ? "outside_catchment" : "full",
    alternative,
    rule_ids: ["ED-03", "ED-04"],
  };
}

/** AD-01 check codes: 6 characters without 0, O, 1 or I, so they read back unambiguously. */
export const CHECK_CODE = /^[A-HJ-NP-Z2-9]{6}$/;

// K3 (world.md PY-01, PY-02, DK-01, DK-02).
// PY-01 a fee can be paid on the phone with a 6-digit code: 5 minutes, 3 tries.
// PY-02 a fee can be paid at a desk; an officer records it; the amount equals the open charge.
// DK-01 Lango Square takes paper documents; an officer records type and result.
// DK-02 anything but a passport can be collected free at Lango Square; passports only at the
//       Konza Passport Desk (AD-06).
export const PHONE_CODE_TTL_MS = 5 * 60_000;
export const PHONE_CODE_TRIES = 3;
export const COLLECTION_FEE_KES = 0;
export const DESKS = {
  lango_square: {
    name: "Lango Square",
    address: "Z1 B01 P001 U01",
    what: "the Savanahlands Residents Registry public counter, working days 8 to 5",
  },
  konza_passport_desk: { name: "the Konza Passport Desk", address: null, what: "passports only" },
} as const;
export type DeskId = keyof typeof DESKS;
export const DOC_TYPES = ["tenancy", "employer_letter", "birth_certificate", "immunisation_card"];

/** DK-02 and AD-06: where a deliverable is collected. */
export const collectionDesk = (kind: string): DeskId =>
  kind === "passport" ? "konza_passport_desk" : "lango_square";

// K3 scenes (world.md section 4).
// SH-02 minimum contribution KES 300 a month; SH-01 cover is active once this month's has cleared.
// BZ-01 business name KES 950; BZ-02 private limited company KES 10,500; BZ-03 a tax number comes
//       with the registration; BZ-04 a trading permit for a small workshop KES 5,000 a year;
//       BZ-05 a name already registered, or one suggesting a government body, goes to an officer.
export const SH_MIN_CONTRIBUTION_KES = 300;
export const BUSINESS_FEES_KES = { business_name: 950, company: 10500 } as const;
export const TRADING_PERMIT_FEE_KES = 5000;
const RESERVED_NAME = /\b(konza|government|authority|technopolis)\b/i;
export const normalName = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");
/** BZ-05: true when the name suggests a government body (never refused by rule: an officer). */
export const reservedName = (n: string) => RESERVED_NAME.test(n);

// PP-03 (amended K3, MED-299, after Mahs's calls): biometrics on any working day within the next
// 10 working days, morning (8 to 12) or afternoon (2 to 5); it can be moved until the day before.
export const APPOINTMENT_WITHIN_WORKING_DAYS = 10;
export const WINDOW_HOURS: Record<string, string> = { morning: "8 to 12", afternoon: "2 to 5" };
export const appointmentDayOk = (today: ISODate, day: ISODate) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) && day > today && keCalendar.isWorkingDay(day) &&
  day <= keCalendar.addWorkingDays(today, APPOINTMENT_WITHIN_WORKING_DAYS);
