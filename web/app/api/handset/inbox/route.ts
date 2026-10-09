import { panelUser, unauthorized } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase-server";

// Texts and code calls for a browser call, shown on the handset instead of sent to a phone.
export async function GET(request: Request) {
  if (!(await panelUser())) return unauthorized();
  const c = new URL(request.url).searchParams.get("c") ?? "";
  if (!/^conv_[0-9a-z]+$/.test(c)) return Response.json({ messages: [] });
  const { data } = await getServiceSupabase().from("handset_inbox").select("id, kind, body, at")
    .eq("conversation_id", c).order("at");
  return Response.json({ messages: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
