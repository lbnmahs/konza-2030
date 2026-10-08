// K5 (MED-302): did the caller hear the read-back and say yes before an asks-first step went
// through? Read from the post-call transcript, so the backend keeps only the result (operation,
// ok, which kinds were missing), never the text. The checker (C8) reads these results.

import { isYes } from "./lexicon.ts";
import type { ReadBackItem } from "./readback.ts";
import { swNumber } from "./sw.ts";

type Turn = {
  role?: string;
  message?: string | null;
  tool_calls?: { tool_name?: string; params_as_json?: string }[];
  tool_results?: { tool_name?: string; result_value?: string; is_error?: boolean }[];
};

export type ReadBackResult = {
  tool: string;
  ok: boolean;
  /** Kinds of item (amount, date, time) the agent did not say between prepare and commit. */
  missing: string[];
  yes: boolean;
};

/** Kinds the caller must hear before a yes counts: what costs money, and when. */
const CHECKED = new Set(["amount", "date", "time"]);

const norm = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const json = (s: string | undefined) => {
  try {
    return JSON.parse(s ?? "");
  } catch {
    return null;
  }
};

const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
};
const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  twentieth: 20,
  thirtieth: 30,
};

/** English number words as digits, as a speech model says them: "seven thousand five hundred
 * fifty" is 7550, "the twelfth" is 12, "twenty twenty-six" (a year) is 2026. */
export function enNumbersToDigits(text: string): string {
  const words = text.toLowerCase().replace(/-/g, " ").split(/\s+/);
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    // A year said as two pairs ("twenty twenty six", "nineteen eighty seven").
    const pairs: number[] = [];
    let cur = -1;
    for (const w of run) {
      if (w in TENS) {
        if (cur >= 0) pairs.push(cur);
        cur = TENS[w];
      } else if (w in ONES) {
        if (cur >= 0 && cur % 10 === 0 && cur >= 20 && ONES[w] < 10) cur += ONES[w];
        else {
          if (cur >= 0) pairs.push(cur);
          cur = ONES[w];
        }
      } else cur = -2;
    }
    if (cur >= 0) pairs.push(cur);
    if (
      cur !== -2 && pairs.length === 2 && pairs[0] >= 10 && pairs[1] >= 10 &&
      !run.some((w) => w === "hundred" || w === "thousand")
    ) {
      out.push(String(pairs[0] * 100 + pairs[1]));
    } else {
      let total = 0, part = 0;
      for (const w of run) {
        if (w in ONES) part += ONES[w];
        else if (w in TENS) part += TENS[w];
        else if (w === "hundred") part *= 100;
        else if (w === "thousand") {
          total += part * 1000;
          part = 0;
        }
      }
      out.push(String(total + part));
    }
    run = [];
  };
  for (const raw of words) {
    const w = raw.replace(/[^a-z]/g, "");
    const isNum = w in ONES || w in TENS || w === "hundred" || w === "thousand";
    if (isNum || (w === "and" && run.length && words.length)) {
      if (w !== "and") run.push(w);
      continue;
    }
    flush();
    out.push(raw);
  }
  flush();
  return out.join(" ");
}

const EN_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const SW_MONTHS = [
  "januari",
  "februari",
  "machi",
  "aprili",
  "mei",
  "juni",
  "julai",
  "agosti",
  "septemba",
  "oktoba",
  "novemba",
  "desemba",
];

/** The item was said in either language, or (amounts) as digits with or without a comma, or as
 * English number words; a date by its day and month in either language; hours by their window or
 * both hours. */
function said(text: string, i: ReadBackItem): boolean {
  const t = norm(text);
  const forms = [i.spoken_en, i.spoken_sw];
  if (i.kind === "amount") forms.push(String(i.value), Number(i.value).toLocaleString("en-GB"));
  if (forms.some((f) => t.includes(norm(f)))) return true;
  const digits = norm(enNumbersToDigits(text.replace(/(\d),(\d{3})/g, "$1$2")));
  const has = (n: number | string) => new RegExp(`(^| )${n}( |$)`).test(digits);
  if (i.kind === "amount") return has(Number(i.value));
  const iso = String(i.value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (i.kind === "date" && iso) {
    const [d, m] = [Number(iso[3]), Number(iso[2])];
    const en = digits.includes(EN_MONTHS[m - 1]) && has(d);
    const sw = t.includes(SW_MONTHS[m - 1]) && t.includes(norm(swNumber(d)));
    return en || sw;
  }
  const hours = String(i.value).match(/^(\d{2}):00-(\d{2}):00$/);
  if (i.kind === "time" && hours) {
    const h12 = (h: number) => ((h + 11) % 12) + 1;
    const window = /morning|asubuhi|afternoon|mchana|alasiri/.exec(
      norm(`${i.spoken_en} ${i.spoken_sw}`),
    );
    return (window !== null && t.includes(window[0])) ||
      (has(h12(Number(hours[1]))) && has(h12(Number(hours[2]))));
  }
  return false;
}

/** One result per asks-first commit in the call (a prepare followed by a call with its id). */
export function readBackResults(transcript: Turn[]): ReadBackResult[] {
  const out: ReadBackResult[] = [];
  // Open prepares by confirmation id: their items and what the agent has said since.
  const open = new Map<
    string,
    { tool: string; items: ReadBackItem[]; said: string; lastUser: string }
  >();
  for (const turn of transcript ?? []) {
    for (const call of turn.tool_calls ?? []) {
      const id = String(json(call.params_as_json)?.confirmation_id ?? "");
      const p = id ? open.get(id) : undefined;
      if (!p || p.tool !== call.tool_name) continue;
      open.delete(id);
      const missing = [
        ...new Set(
          p.items.filter((i) => CHECKED.has(i.kind) && !said(p.said, i)).map((i) => i.kind),
        ),
      ];
      const yes = isYes(p.lastUser);
      out.push({ tool: p.tool, ok: !missing.length && yes, missing, yes });
    }
    for (const r of turn.tool_results ?? []) {
      const v = json(r.result_value);
      if (r.is_error || !v?.needs_confirmation || !v.confirmation_id) continue;
      open.set(String(v.confirmation_id), {
        tool: String(r.tool_name),
        items: Array.isArray(v.readback?.items) ? v.readback.items : [],
        said: "",
        lastUser: "",
      });
    }
    // An agent turn's words come after its tool results (the read-back follows the prepare).
    const text = turn.message ?? "";
    for (const p of open.values()) {
      if (turn.role === "agent") p.said += ` ${text}`;
      else if (turn.role === "user" && text) p.lastUser = text;
    }
  }
  return out;
}
