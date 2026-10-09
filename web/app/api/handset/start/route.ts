import { panelUser, unauthorized } from "@/lib/auth";
import { hashToken, newToken, TOKEN_TTL_MS } from "@/lib/handset";
import { getServiceSupabase } from "@/lib/supabase-server";

// Starts a browser call: a signed URL from ElevenLabs (country agents require one) and a
// one-time token the browser presents with the new conversation id (/api/handset/bind).

export async function POST(request: Request) {
  if (!(await panelUser())) return unauthorized();
  const { agentKey } = await request.json().catch(() => ({ agentKey: "" }));
  const db = getServiceSupabase();
  // Rate limit (P15 L2/L3): at most 20 browser sessions a day across the panel.
  const { count } = await db.from("handset_tokens").select("token_hash", {
    count: "exact",
    head: true,
  }).gt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if ((count ?? 0) >= 20) return Response.json({ error: "daily_limit" }, { status: 429 });
  const { data: agent } = await db.from("demo_agents").select("agent_id, authority, language")
    .eq("scenario", String(agentKey)).not("hub", "is", null).maybeSingle();
  if (!agent) return Response.json({ error: "unknown_agent" }, { status: 404 });
  const { data: auth } = await db.from("authorities").select("default_language")
    .eq("id", agent.authority).maybeSingle();

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agent.agent_id}`,
    { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" } },
  );
  if (!res.ok) return Response.json({ error: "signed_url_failed" }, { status: 502 });
  const { signed_url } = await res.json();

  const token = newToken();
  const { error } = await db.from("handset_tokens").insert({
    token_hash: hashToken(token),
    agent_id: agent.agent_id,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  if (error) return Response.json({ error: "token_failed" }, { status: 500 });
  return Response.json(
    // Start in the greeting language when it is not the agent's main language (Swahili can only
    // be a main language), as call_started does for phone calls.
    {
      signedUrl: signed_url,
      token,
      language: auth?.default_language && auth.default_language !== agent.language
        ? auth.default_language
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
