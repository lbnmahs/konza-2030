import "server-only";
import { cookies } from "next/headers";
import { noStore } from "./handset";
import { resolveSession, type ResidentSession, SESSION_COOKIE, sameOrigin } from "./resident-session";
import { getServiceSupabase } from "./supabase-server";

// Guards shared by /api/resident/*. No panel sign-in: start and bind need a same-origin request,
// and every route after bind needs the resident-session cookie as well.

export const deny = (status: number, error: string) =>
  Response.json({ error }, { status, headers: noStore });

/** For POST routes: a same-origin request, or the refusal to return. */
export function guardPost(request: Request): Response | null {
  return sameOrigin(request) ? null : deny(403, "bad_origin");
}

/** The caller's own conversation, from the cookie only. */
export async function currentSession(): Promise<ResidentSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resolveSession(getServiceSupabase(), token);
}
