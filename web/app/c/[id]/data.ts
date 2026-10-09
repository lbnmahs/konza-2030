import "server-only";
import { getServiceSupabase } from "@/lib/supabase-server";
import type { CalendarItem } from "@/lib/ics";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A calendar item by its random id (the link in the SMS), or null. */
export async function calendarItem(id: string): Promise<CalendarItem | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await getServiceSupabase().from("calendar_items")
    .select("id, title, local_start, timezone, duration_min, location, ref").eq("id", id)
    .maybeSingle<CalendarItem>();
  return data ?? null;
}
