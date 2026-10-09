// Plain calendar dates as "YYYY-MM-DD" strings. All arithmetic is done in UTC on the date
// only, so there are no time zone or DST surprises. Holidays live in each country's
// calendar.ts, built with makeCalendar(); "today" comes from todayIn(the authority's zone).

export type ISODate = string;

const toUTC = (d: ISODate) => new Date(`${d}T00:00:00Z`);
const fromUTC = (d: Date): ISODate => d.toISOString().slice(0, 10);

export function addDays(d: ISODate, n: number): ISODate {
  const t = toUTC(d);
  t.setUTCDate(t.getUTCDate() + n);
  return fromUTC(t);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = d.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0))
    .getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUTC(target);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86_400_000);
}

export function weekday(d: ISODate): string {
  return toUTC(d).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

/** 0 = Sunday ... 6 = Saturday. */
export const dayOfWeek = (d: ISODate) => toUTC(d).getUTCDay();

/** First day of the next month (the 1st after d, never d itself). */
export function nextFirstOfMonth(d: ISODate): ISODate {
  return addMonths(`${d.slice(0, 8)}01`, 1);
}

export function todayIn(timeZone: string, now = new Date()): ISODate {
  return now.toLocaleDateString("en-CA", { timeZone });
}

export type Calendar = {
  holidays: ReadonlySet<ISODate>;
  isWorkingDay(d: ISODate): boolean;
  /** The n-th working day after d (n >= 1). */
  addWorkingDays(d: ISODate, n: number): ISODate;
  /** Latest working day strictly before d. */
  previousWorkingDay(d: ISODate): ISODate;
  /** Working days after `from` up to and including `to` (0 if to <= from). */
  workingDaysBetween(from: ISODate, to: ISODate): number;
};

/** A working-day calendar from a country's holidays and weekend days (0 = Sunday). */
export function makeCalendar(holidays: ReadonlySet<ISODate>, weekend = [0, 6]): Calendar {
  const isWorkingDay = (d: ISODate) => !weekend.includes(dayOfWeek(d)) && !holidays.has(d);
  return {
    holidays,
    isWorkingDay,
    addWorkingDays(d, n) {
      let cur = d;
      let left = n;
      while (left > 0) {
        cur = addDays(cur, 1);
        if (isWorkingDay(cur)) left--;
      }
      return cur;
    },
    previousWorkingDay(d) {
      let cur = addDays(d, -1);
      while (!isWorkingDay(cur)) cur = addDays(cur, -1);
      return cur;
    },
    workingDaysBetween(from, to) {
      let count = 0;
      for (let cur = addDays(from, 1); cur <= to; cur = addDays(cur, 1)) {
        if (isWorkingDay(cur)) count++;
      }
      return count;
    },
  };
}
