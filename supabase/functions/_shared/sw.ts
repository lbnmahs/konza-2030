// Swahili numbers and dates, so the agent says amounts and dates from code, not from the LLM.
// Draft wording; Mahs reviews.

import { type ISODate, weekday } from "./rules/common/dates.ts";

const UNITS = ["sifuri", "moja", "mbili", "tatu", "nne", "tano", "sita", "saba", "nane", "tisa"];
const TENS = [
  "",
  "kumi",
  "ishirini",
  "thelathini",
  "arobaini",
  "hamsini",
  "sitini",
  "sabini",
  "themanini",
  "tisini",
];

function below100(n: number): string {
  if (n < 10) return UNITS[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t} na ${UNITS[n % 10]}` : t;
}

function below1000(n: number): string[] {
  const parts: string[] = [];
  if (n >= 100) parts.push(`mia ${UNITS[Math.floor(n / 100)]}`);
  if (n % 100) parts.push(below100(n % 100));
  return parts;
}

/** 3500 -> "elfu tatu mia tano"; 150000 -> "laki moja na elfu hamsini". Up to 999,999,999. */
export function swNumber(n: number): string {
  n = Math.round(n);
  if (n === 0) return UNITS[0];
  const parts: string[] = [];
  // Kenyan usage: 100,000 is "laki moja"; 150,000 is "laki moja na elfu hamsini".
  const milioni = Math.floor(n / 1_000_000);
  if (milioni) parts.push(`milioni ${below1000(milioni).join(" na ")}`);
  const laki = Math.floor((n % 1_000_000) / 100_000);
  if (laki) parts.push(`${milioni ? "na " : ""}laki ${below1000(laki).join(" na ")}`);
  const thousands = Math.floor((n % 100_000) / 1000);
  if (thousands) {
    parts.push(`${laki || milioni ? "na " : ""}elfu ${below1000(thousands).join(" na ")}`);
  }
  const rest = below1000(n % 1000);
  // "na" joins a final part below 100 to what comes before it.
  if (rest.length && parts.length + rest.length > 1 && n % 100 && n % 1000 < 100) {
    parts.push(`na ${rest.join(" ")}`);
  } else if (rest.length === 2) {
    parts.push(`${rest[0]} na ${rest[1]}`);
  } else {
    parts.push(...rest);
  }
  return parts.join(" ");
}

/** "shilingi elfu tatu mia tano" */
export const swShillings = (n: number) => `shilingi ${swNumber(n)}`;

const MONTHS = [
  "Januari",
  "Februari",
  "Machi",
  "Aprili",
  "Mei",
  "Juni",
  "Julai",
  "Agosti",
  "Septemba",
  "Oktoba",
  "Novemba",
  "Desemba",
];
const DAYS: Record<string, string> = {
  Monday: "Jumatatu",
  Tuesday: "Jumanne",
  Wednesday: "Jumatano",
  Thursday: "Alhamisi",
  Friday: "Ijumaa",
  Saturday: "Jumamosi",
  Sunday: "Jumapili",
};

/** "7 Oktoba 2027" (for SMS). */
export function swDate(d: ISODate): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/** "Alhamisi, tarehe saba Oktoba, mwaka elfu mbili na ishirini na saba" (to say). */
export function swDateSpoken(d: ISODate): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${DAYS[weekday(d)]}, tarehe ${swNumber(day)} ${MONTHS[m - 1]}, mwaka ${swNumber(y)}`;
}

/** "09:00" -> "saa tatu asubuhi". Swahili hours count from 7 am (saa moja). */
export function swTime(hhmm: string): string {
  let [h, m] = hhmm.split(":").map(Number);
  let mins = "";
  if (m === 30) mins = " na nusu";
  else if (m === 15) mins = " na robo";
  else if (m === 45) {
    mins = " kasoro robo";
    h = (h + 1) % 24;
  } else if (m) mins = ` na dakika ${swNumber(m)}`;
  const period = h < 12 ? "asubuhi" : h < 16 ? "mchana" : h < 19 ? "jioni" : "usiku";
  const swHour = ((h + 6) % 12) || 12;
  return `saa ${swNumber(swHour)}${mins} ${period}`;
}

/** "2026-10-02T09:00" -> "Ijumaa, tarehe mbili Oktoba, saa tatu asubuhi". */
export function swSlotSpoken(startsAt: string): string {
  const [date, t] = startsAt.replace(" ", "T").split("T");
  const [y] = date.split("-");
  return `${swDateSpoken(date).replace(`, mwaka ${swNumber(Number(y))}`, "")}, ${
    swTime(t.slice(0, 5))
  }`;
}

/** "2026-09" -> "Septemba 2026". */
export function swMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Ijumaa, tarehe mbili Oktoba" (to say, no year). */
export function swDayMonth(d: ISODate): string {
  const [, m, day] = d.split("-").map(Number);
  return `${DAYS[weekday(d)]}, tarehe ${swNumber(day)} ${MONTHS[m - 1]}`;
}
