import { panelUser, unauthorized } from "@/lib/auth";
import { hashToken } from "@/lib/handset";
import { getServiceSupabase } from "@/lib/supabase-server";

// Registers a browser call: the one-time token from /api/handset/start plus the conversation
// id from the ElevenLabs client. The backend then accepts the call's tool calls (as call_started
// does for phone calls), and its texts and codes go to the handset inbox, not to a phone.

export async function POST(request: Request) {
  if (!(await panelUser())) return unauthorized();
  const { token, conversationId } = (await request.json().catch(() => null)) ?? {};
  if (!/^[0-9a-f]{64}$/.test(String(token)) || !/^conv_[0-9a-z]+$/.test(String(conversationId))) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const { data: used } = await db.from("handset_tokens")
    .update({ used_at: now, conversation_id: conversationId })
    .eq("token_hash", hashToken(String(token))).is("used_at", null).gt("expires_at", now)
    .select("agent_id");
  if (!used?.length) return Response.json({ error: "token_invalid" }, { status: 403 });

  const { data: agent } = await db.from("demo_agents").select("agent_id, authority, authority_name")
    .eq("agent_id", used[0].agent_id).single();
  const { data: auth } = await db.from("authorities").select("default_language")
    .eq("id", agent!.authority).single();
  const { error } = await db.from("conversations").insert({
    id: conversationId,
    agent_id: agent!.agent_id,
    authority: agent!.authority,
    language: auth!.default_language,
    started_by_webhook: true,
    channel: "browser",
  });
  if (error) return Response.json({ error: "bind_failed" }, { status: 409 });
  await db.from("audit_log").insert({
    conversation_id: conversationId,
    authority: agent!.authority,
    actor: "Call",
    action: `Call started · ${agent!.authority_name} · browser handset`,
  });
  return Response.json({ bound: true }, { headers: { "Cache-Control": "no-store" } });
}
