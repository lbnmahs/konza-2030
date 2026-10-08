import { type ISODate, weekday } from "./rules/common/dates.ts";

const MONTHS = [
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

/** "Tuesday 29 September" for the agent to say; with year "Tuesday 29 September 2026" (SMS). */
export function spokenDate(d: ISODate, withYear = false): string {
  const [y, m, day] = d.split("-").map(Number);
  return `${weekday(d)} ${day} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** "ID ••••8273": never show more than the last four characters. */
export function mask(label: string, value: string): string {
  const clean = value.replace(/[^0-9A-Za-z]/g, "");
  return `${label} ••••${clean.slice(-4)}`;
}

export function digits(n: number): string {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => String(x % 10)).join("");
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  sw: "Swahili",
  ar: "Arabic",
};

/** No bullets or currency symbols for a screen reader: "••••8273" is "ending 8273". */
export function plainText(body: string): string {
  return body
    .replace(/••••/g, "ending ")
    .replace(/£(\d+)\.(\d{2})/g, (_m, p, d) => (d === "00" ? `${p} pounds` : `${p} pounds ${d}`));
}
