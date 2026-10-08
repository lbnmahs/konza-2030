import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { zonedToUtc } from "@/lib/ics";
import { calendarItem } from "./data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add to calendar", robots: { index: false } };

const compact = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Add a booking to a calendar: ICS download, Google and Outlook links. Linked from the SMS.
export default async function CalendarPage(props: PageProps<"/c/[id]">) {
  const { id } = await props.params;
  const item = await calendarItem(id);
  if (!item) notFound();
  const start = zonedToUtc(item.local_start, item.timezone);
  const end = new Date(start.getTime() + item.duration_min * 60_000);
  const details = `Reference ${item.ref}. konza-2030, independent open-source project.`;
  const google = "https://calendar.google.com/calendar/render?" + new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
    dates: `${compact(start)}/${compact(end)}`,
    details,
    location: item.location,
  });
  const outlook = "https://outlook.live.com/calendar/0/deeplink/compose?" + new URLSearchParams({
    subject: item.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: details,
    location: item.location,
  });
  const when = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: item.timezone,
  }).format(start);
  return (
    <main style={{ maxWidth: 420, margin: "8vh auto", padding: 16 }}>
      <h1 style={{ fontSize: 20 }}>{item.title}</h1>
      <p>{when} ({item.timezone})</p>
      <p>{item.location}</p>
      <p>Reference {item.ref}</p>
      <ul style={{ listStyle: "none", padding: 0, lineHeight: 2.2 }}>
        <li><a href={`/c/${item.id}/ics`}>Download calendar file (.ics)</a></li>
        <li><a href={google} rel="noopener noreferrer">Add to Google Calendar</a></li>
        <li><a href={outlook} rel="noopener noreferrer">Add to Outlook</a></li>
      </ul>
    </main>
  );
}
