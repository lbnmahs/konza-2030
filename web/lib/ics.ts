// Copy of supabase/functions/_shared/ics.ts (the web app builds the same file for /c/<id>/ics).
// ICS (RFC 5545) for calendar items: VCALENDAR with PRODID and VERSION, one VEVENT per item with
// UID, DTSTAMP, DTSTART and DTEND in UTC.

/** UTC instant for a local wall time in an IANA time zone. */
export function zonedToUtc(local: string, timeZone: string): Date {
  const guess = new Date(`${local}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/([\\,;])/g, "\\$1").replace(/\n/g, "\\n");

export type CalendarItem = {
  id: string;
  title: string;
  local_start: string;
  timezone: string;
  duration_min: number;
  location: string;
  ref: string;
};

export function buildIcs(items: CalendarItem[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//gov-voice-demo//DEMO//EN"];
  for (const it of items) {
    const start = zonedToUtc(it.local_start, it.timezone);
    const end = new Date(start.getTime() + it.duration_min * 60_000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.id}@gov-voice-demo`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(it.title)}`,
      `LOCATION:${esc(it.location)}`,
      `DESCRIPTION:${esc(`Reference ${it.ref}. konza-2030, independent open-source project.`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
