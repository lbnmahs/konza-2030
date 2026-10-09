// K5 (MED-301): what the assistant reads back before an asks-first step, in English and Swahili,
// built from rule outputs. Amounts, dates and numbers are spoken from code (sw.ts), so the LLM
// never translates them; the items let the checker (C8) look for each one in the call.

import { type ISODate, weekday } from "./rules/common/dates.ts";
import { swDateSpoken, swMonth, swNumber, swShillings, swTime } from "./sw.ts";

export type ReadBackItem = {
  kind: "amount" | "date" | "time" | "number" | "name" | "place";
  value: string | number;
  spoken_en: string;
  spoken_sw: string;
};
export type ReadBack = { en: string; sw: string; items: ReadBackItem[] };

const EN_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const same = (kind: ReadBackItem["kind"], s: string): ReadBackItem => ({
  kind,
  value: s,
  spoken_en: s,
  spoken_sw: s,
});

/** One item per kind of value; both spoken forms come from code. */
export const rb = {
  amount: (kes: number): ReadBackItem => ({
    kind: "amount",
    value: kes,
    spoken_en: `${kes.toLocaleString("en-GB")} shillings`,
    spoken_sw: swShillings(kes),
  }),
  date: (d: ISODate): ReadBackItem => {
    const [y, m, day] = d.split("-").map(Number);
    return {
      kind: "date",
      value: d,
      spoken_en: `${weekday(d)} ${day} ${EN_MONTHS[m - 1]} ${y}`,
      spoken_sw: swDateSpoken(d),
    };
  },
  /** "2026-10" */
  month: (ym: string): ReadBackItem => {
    const [y, m] = ym.split("-").map(Number);
    return {
      kind: "date",
      value: ym,
      spoken_en: `${EN_MONTHS[m - 1]} ${y}`,
      spoken_sw: swMonth(ym).replace(/\d+$/, (yr) => `mwaka ${swNumber(Number(yr))}`),
    };
  },
  /** A window between two whole hours, "08:00" to "12:00". */
  hours: (label_en: string, from: string, to: string): ReadBackItem => {
    const h = (t: string) => Number(t.slice(0, 2));
    const en12 = (t: string) => String(((h(t) + 11) % 12) + 1);
    const [swFrom, period] = swTime(from).split(/ (?=\S+$)/);
    return {
      kind: "time",
      value: `${from}-${to}`,
      spoken_en: `${label_en}, between ${en12(from)} and ${en12(to)}`,
      spoken_sw: `${period}, kati ya ${swFrom} na ${swTime(to).replace(/ \S+$/, "")}`,
    };
  },
  number: (n: number): ReadBackItem => ({
    kind: "number",
    value: n,
    spoken_en: String(n),
    spoken_sw: swNumber(n),
  }),
  name: (s: string): ReadBackItem => same("name", s),
  place: (s: string): ReadBackItem => same("place", s),
  /** A place with its own spoken forms (an address). */
  spokenPlace: (value: string, spoken_en: string, spoken_sw: string): ReadBackItem => ({
    kind: "place",
    value,
    spoken_en,
    spoken_sw,
  }),
};

type Spoken<K extends string> = Record<K, string>;

/** Builds a read-back: both texts are written from the same items, so they say the same values. */
export function readBack<K extends string>(
  items: Record<K, ReadBackItem>,
  en: (s: Spoken<K>) => string,
  sw: (s: Spoken<K>) => string,
): ReadBack {
  const pick = (k: "spoken_en" | "spoken_sw") =>
    Object.fromEntries(
      Object.entries(items).map(([n, i]) => [n, (i as ReadBackItem)[k]]),
    ) as Spoken<
      K
    >;
  return { en: en(pick("spoken_en")), sw: sw(pick("spoken_sw")), items: Object.values(items) };
}

/** Problems that make a read-back unsafe to say: an item missing from a text, or a Swahili text
 * with an amount or number left in digits (the LLM would then say it in English or guess). */
export function readBackProblems(r: ReadBack): string[] {
  const out: string[] = [];
  if (!r.en.trim() || !r.sw.trim()) out.push("empty text");
  for (const i of r.items) {
    if (!r.en.includes(i.spoken_en)) out.push(`en lacks ${i.kind} ${i.value}`);
    if (!r.sw.includes(i.spoken_sw)) out.push(`sw lacks ${i.kind} ${i.value}`);
  }
  const spokenSw = r.items.filter((i) => i.kind === "place" || i.kind === "name")
    .reduce((t, i) => t.split(i.spoken_sw).join(""), r.sw);
  if (/\d/.test(spokenSw)) out.push("sw has digits outside names and places");
  return out;
}
