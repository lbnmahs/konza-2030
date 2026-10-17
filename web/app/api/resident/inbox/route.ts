import { noStore } from "@/lib/handset";
import { currentSession, deny } from "@/lib/resident";
import { getServiceSupabase } from "@/lib/supabase-server";

// Texts held for the resident's own conversation: only in a local dry run (SMS_DRY_RUN), since the
// app's texts otherwise go to the phone. The conversation comes from the session cookie only.
export async function GET() {
  const session = await currentSession();
  if (!session) return deny(401, "no_session");
  const { data } = await getServiceSupabase().from("handset_inbox").select("id, kind, body, at")
    .eq("conversation_id", session.conversationId).order("at");
  return Response.json({ messages: data ?? [] }, { headers: noStore });
}
