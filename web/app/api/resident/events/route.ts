import { noStore } from "@/lib/handset";
import { currentSession, deny } from "@/lib/resident";
import { readEvents } from "@/lib/resident-session";
import { getServiceSupabase } from "@/lib/supabase-server";

// K8 S2 (plan-k8 2.2, nudge and fetch): the screen events of the resident's own conversation after
// `after` (0 or none replays them all). The conversation comes from the session cookie only.
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return deny(401, "no_session");
  const raw = new URL(request.url).searchParams.get("after") ?? "0";
  if (!/^\d{1,9}$/.test(raw)) return deny(400, "bad_request");
  try {
    const events = await readEvents(getServiceSupabase(), session.conversationId, Number(raw));
    return Response.json({ events }, { headers: noStore });
  } catch {
    return deny(503, "events_unavailable");
  }
}
