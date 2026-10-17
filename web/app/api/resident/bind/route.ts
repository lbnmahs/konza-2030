import { cookies } from "next/headers";
import { bindBrowserSession, failure, noStore } from "@/lib/handset";
import { deny, guardPost } from "@/lib/resident";
import { openSession, sessionCookie } from "@/lib/resident-session";
import { getServiceSupabase } from "@/lib/supabase-server";

// K8 S1: binds the new conversation (one-time token plus conversation id, as the handset does),
// then issues the resident-session cookie for that one conversation (45 minutes). K8 S2: also the
// session's CSRF token, in the body only; the page keeps it in memory and sends it on every tap.
export async function POST(request: Request) {
  const refused = await guardPost(request);
  if (refused) return refused;
  const { token, conversationId } = (await request.json().catch(() => null)) ?? {};
  const bound = await bindBrowserSession(token, conversationId, "resident app");
  if (!bound.ok) return failure(bound);
  const session = await openSession(getServiceSupabase(), bound.value.oneTimeHash, bound.value.conversationId);
  if (!session) return deny(409, "session_failed");
  const c = sessionCookie(session.token);
  (await cookies()).set(c.name, c.value, c);
  return Response.json({ bound: true, expiresAt: session.expiresAt, csrf: session.csrf }, {
    headers: noStore,
  });
}
