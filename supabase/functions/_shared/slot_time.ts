// Spoken forms of a local appointment time ("2026-09-29T09:40") in English and Arabic.

import { spokenDate } from "./util.ts";

const AR_DAYS: Record<string, string> = {
  Monday: "الاثنين",
  Tuesday: "الثلاثاء",
  Wednesday: "الأربعاء",
  Thursday: "الخميس",
  Friday: "الجمعة",
  Saturday: "السبت",
  Sunday: "الأحد",
};
const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** "2026-09-29T09:40:00" -> date, time and spoken forms in English and Arabic (UAE local). */
export function slotTime(startsAt: string) {
  const [date, t] = startsAt.replace(" ", "T").split("T");
  const [h, m] = t.split(":").map(Number);
  const en = spokenDate(date);
  const hh = h % 12 || 12;
  const time = `${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  const [, mo, d] = date.split("-").map(Number);
  const weekdayEn = en.split(" ")[0];
  return {
    date,
    time,
    start_spoken: `${en} at ${time}`,
    start_spoken_ar: `${AR_DAYS[weekdayEn]} ${d} ${AR_MONTHS[mo - 1]}، الساعة ${hh}:${
      String(m).padStart(2, "0")
    } ${h < 12 ? "صباحاً" : "مساءً"}`,
  };
}

/** "الاثنين 5 أكتوبر" (to say in Arabic, no year). */
export function arDayMonth(date: string): string {
  const [, mo, d] = date.split("-").map(Number);
  return `${AR_DAYS[spokenDate(date).split(" ")[0]]} ${d} ${AR_MONTHS[mo - 1]}`;
}
