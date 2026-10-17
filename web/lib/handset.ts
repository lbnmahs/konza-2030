import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getServiceSupabase } from "./supabase-server";

// Virtual handset (P14 T2): browser calls to a country agent from the signed-in panel. K8 S1: the
// resident app (/sia) starts and binds its sessions through the same two functions.
export const TOKEN_TTL_MS = 3 * 60_000;
const DAILY_LIMIT = 20;

export const newToken = () => randomBytes(32).toString("hex");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** A signed URL from ElevenLabs (signed auth is on for every agent) and a one-time token the
 * browser presents with the new conversation id. At most 20 browser sessions a day (P15 L2/L3). */
export async function startBrowserSession(agentKey: string): Promise<
  Result<{ signedUrl: string; token: string; language: string | null }>
> {
  const db = getServiceSupabase();
  const { count } = await db.from("handset_tokens").select("token_hash", { count: "exact", head: true })
    .gt("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, status: 429, error: "daily_limit" };
  const { data: agent } = await db.from("demo_agents").select("agent_id, authority, language")
    .eq("scenario", agentKey).not("hub", "is", null).maybeSingle();
  if (!agent) return { ok: false, status: 404, error: "unknown_agent" };
  const { data: auth } = await db.from("authorities").select("default_language")
    .eq("id", agent.authority).maybeSingle();

  const res = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agent.agent_id}`,
    { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" } },
  );
  if (!res.ok) return { ok: false, status: 502, error: "signed_url_failed" };
  const { signed_url } = await res.json();

  const token = newToken();
  const { error } = await db.from("handset_tokens").insert({
    token_hash: hashToken(token),
    agent_id: agent.agent_id,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  if (error) return { ok: false, status: 500, error: "token_failed" };
  // Start in the greeting language when it is not the agent's main language (Swahili can only be
  // a main language), as call_started does for phone calls.
  const language = auth?.default_language && auth.default_language !== agent.language
    ? auth.default_language
    : null;
  return { ok: true, value: { signedUrl: signed_url, token, language } };
}

/** Registers a browser conversation: the backend then accepts its tool calls (as call_started
 * does for phone calls), and its texts and codes go to the handset inbox, not to a phone. */
export async function bindBrowserSession(
  token: unknown,
  conversationId: unknown,
  label: string,
): Promise<Result<{ oneTimeHash: string; conversationId: string }>> {
  if (!/^[0-9a-f]{64}$/.test(String(token)) || !/^conv_[0-9a-z]+$/.test(String(conversationId))) {
    return { ok: false, status: 400, error: "bad_request" };
  }
  const db = getServiceSupabase();
  const now = new Date().toISOString();
  const oneTimeHash = hashToken(String(token));
  const { data: used } = await db.from("handset_tokens")
    .update({ used_at: now, conversation_id: conversationId })
    .eq("token_hash", oneTimeHash).is("used_at", null).gt("expires_at", now)
    .select("agent_id");
  if (!used?.length) return { ok: false, status: 403, error: "token_invalid" };

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
  if (error) return { ok: false, status: 409, error: "bind_failed" };
  await db.from("audit_log").insert({
    conversation_id: conversationId,
    authority: agent!.authority,
    actor: "Call",
    action: `Call started · ${agent!.authority_name} · ${label}`,
  });
  return { ok: true, value: { oneTimeHash, conversationId: String(conversationId) } };
}

export const noStore = { "Cache-Control": "no-store" };

export const failure = (r: { status: number; error: string }) =>
  Response.json({ error: r.error }, { status: r.status, headers: noStore });
