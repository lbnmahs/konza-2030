// Calendar links (P15): every booking gets a calendar item, opened from the SMS at /c/<id> on
// the web app (ICS file, Google and Outlook links). The id is random and unguessable; links are
// never read aloud.

import { authority } from "./authorities.ts";
import { db, must } from "./db.ts";

// The desk's own area decides the time zone: the German visa office has a Nairobi desk, and
// Kenyan passports have desks in London and Berlin.
const AREA_TZ: Record<string, string> = {
  London: "Europe/London",
  Berlin: "Europe/Berlin",
  Nairobi: "Africa/Nairobi",
};

export async function addCalendarItem(i: {
  conversationId: string;
  authorityId: string;
  ref: string;
  title: string;
  localStart: string;
  area?: string | null;
  location: string;
}): Promise<string> {
  const timezone = AREA_TZ[i.area ?? ""] ?? authority(i.authorityId).timezone;
  const row = must(
    await db.from("calendar_items").upsert({
      conversation_id: i.conversationId,
      authority: i.authorityId,
      ref: i.ref,
      title: i.title,
      local_start: i.localStart.replace(" ", "T").slice(0, 16),
      timezone,
      location: i.location,
    }, { onConflict: "conversation_id,ref" }).select("id").single(),
  );
  return row.id;
}

export const calendarUrl = (id: string) => `${Deno.env.get("WEB_BASE_URL")}/c/${id}`;
