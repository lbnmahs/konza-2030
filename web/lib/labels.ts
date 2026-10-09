export const AUTHORITY_NAMES: Record<string, string> = {
  pwani_njema: "Pwani Njema County Government",
};

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  sw: "Swahili",
  ar: "Arabic",
};

export const INDEPENDENT_TAG =
  "Independent open-source project · not affiliated with any government body";
/** The label in Swahili, where a page or scene is in Swahili (docs/konza/labelling.md). */
export const INDEPENDENT_TAG_SW =
  "Mradi huru wa chanzo huria · hauhusiani na chombo chochote cha serikali";

// Static names first, then the `authorities` table (if loaded), then the key.
export function authorityName(
  key: string | null | undefined,
  table?: Record<string, { name: string }>,
): string {
  if (!key) return "Unknown authority";
  return AUTHORITY_NAMES[key] ?? table?.[key]?.name ?? key;
}

// "Africa/Nairobi" -> "Nairobi". Used for local clocks and time labels.
export function timezoneCity(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

// Label for "(... time)": the UK reads better than London on citizen pages.
export function timezoneLabel(tz: string): string {
  return tz === "Europe/London" ? "UK" : timezoneCity(tz);
}

export function languageName(code: string | null | undefined): string {
  if (!code) return "Unknown";
  return LANGUAGE_NAMES[code] ?? code;
}

const TZ = "Europe/London";

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const startFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

// Row times in the panel are always UK time.
export const ROW_TIME_ZONE_LABEL = "UK time";

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatStart(iso: string): string {
  return startFmt.format(new Date(iso));
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatClock(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

// Date and time in an authority's zone, e.g. "3 Oct 2026, 14:05 (Dubai time)".
export function formatInZone(iso: string, tz: string): string {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
  return `${text} (${timezoneLabel(tz)} time)`;
}

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: "£" };

// "£35.00" for GBP, otherwise "AED 300.00" or "KES 3,500.00".
export function formatMoney(amount: number | string, currency: string): string {
  const n = new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount));
  const symbol = CURRENCY_SYMBOLS[currency];
  return symbol ? `${symbol}${n}` : `${currency} ${n}`;
}
