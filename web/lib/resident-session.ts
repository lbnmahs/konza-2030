import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// K8 S1 (MED-329): the resident session behind /sia. Plain functions with no Next imports, so the
// Deno tests can exercise them against the local stack (tests/resident_session_test.ts).
//
// After the browser binds its conversation (the handset's one-time token), the server sets one
// cookie: __Host- (Secure, path /, no domain), HttpOnly, SameSite=Strict, 45 minutes, no panel
// role. Only its SHA-256 is stored, on that handset_tokens row, so a cookie maps to exactly one
// conversation. Every /api/resident/* route resolves the conversation from the cookie only, never
// from a parameter, so session A can never read or act on B.

export const SESSION_COOKIE = "__Host-sia_session";
export const SESSION_TTL_S = 45 * 60;

const TOKEN = /^[0-9a-f]{64}$/;

export const newSessionToken = () => randomBytes(32).toString("hex");
export const hashSessionToken = (t: string) => createHash("sha256").update(t).digest("hex");

export const sessionCookie = (value: string, maxAge = SESSION_TTL_S) => ({
  name: SESSION_COOKIE,
  value,
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge,
});

/** State-changing resident routes accept only same-origin requests (the Origin header must match
 * the route's own origin; browsers always send it on POST). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}

// The service-role client (supabase-js), typed structurally so the Deno tests need no npm types.
type Db = { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type ResidentSession = {
  conversationId: string;
  agentId: string;
  expiresAt: string;
  csrfHash: string | null;
};

/** The conversation behind a cookie value, or null (malformed, unknown, expired or unbound). */
export async function resolveSession(db: Db, token: string | undefined): Promise<ResidentSession | null> {
  if (!token || !TOKEN.test(token)) return null;
  const { data } = await db.from("handset_tokens")
    .select("conversation_id, agent_id, session_expires_at, csrf_hash")
    .eq("session_hash", hashSessionToken(token))
    .gt("session_expires_at", new Date().toISOString())
    .not("conversation_id", "is", null)
    .maybeSingle();
  return data
    ? {
      conversationId: data.conversation_id,
      agentId: data.agent_id,
      expiresAt: data.session_expires_at,
      csrfHash: data.csrf_hash ?? null,
    }
    : null;
}

/** Issues the session for a conversation that was just bound with its one-time token hash, with
 * its CSRF token (K8 S2): the value goes to the page (kept in memory, sent as x-csrf-token on every
 * tap), only its hash is stored. */
export async function openSession(
  db: Db,
  oneTimeHash: string,
  conversationId: string,
): Promise<{ token: string; csrf: string; expiresAt: string } | null> {
  const token = newSessionToken();
  const csrf = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_S * 1000).toISOString();
  const { data } = await db.from("handset_tokens")
    .update({
      session_hash: hashSessionToken(token),
      session_expires_at: expiresAt,
      csrf_hash: hashSessionToken(csrf),
    })
    .eq("token_hash", oneTimeHash)
    .eq("conversation_id", conversationId)
    .is("session_hash", null)
    .select("conversation_id");
  return data?.length ? { token, csrf, expiresAt } : null;
}

/** True when the request's x-csrf-token is the one issued with this session (constant time). */
export function csrfOk(session: ResidentSession, header: string | null): boolean {
  if (!session.csrfHash || !header || !TOKEN.test(header)) return false;
  return timingSafeEqual(Buffer.from(hashSessionToken(header)), Buffer.from(session.csrfHash));
}

/** The screen events of one conversation after `after` (0 replays them all), in order, as ui/v1
 * events (`UiEvent` in lib/ui/types.ts; not imported, so the Deno tests need no path mapping). */
export async function readEvents(
  db: Db,
  conversationId: string,
  after: number,
): Promise<{ v: "ui/v1"; seq: number; kind: string; payload: unknown; at: string }[]> {
  const { data, error } = await db.from("ui_events").select("seq, kind, payload, created_at")
    .eq("conversation_id", conversationId).gt("seq", after).order("seq").limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: { seq: number; kind: string; payload: unknown; created_at: string }) => ({
    v: "ui/v1" as const,
    seq: e.seq,
    kind: e.kind,
    payload: e.payload,
    at: e.created_at,
  }));
}

/** Ends a session at once (the End button); the cookie is cleared by the route. */
export async function closeSession(db: Db, token: string | undefined): Promise<void> {
  if (!token || !TOKEN.test(token)) return;
  await db.from("handset_tokens")
    .update({ session_expires_at: new Date().toISOString() })
    .eq("session_hash", hashSessionToken(token));
}
