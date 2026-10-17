import { cookies } from "next/headers";
import { noStore } from "@/lib/handset";
import { guardPost } from "@/lib/resident";
import { closeSession, SESSION_COOKIE, sessionCookie } from "@/lib/resident-session";
import { getServiceSupabase } from "@/lib/supabase-server";

// K8 S1: ends the resident session at once (End, or End session in Settings) and clears the cookie.
export async function POST(request: Request) {
  const refused = await guardPost(request);
  if (refused) return refused;
  const store = await cookies();
  await closeSession(getServiceSupabase(), store.get(SESSION_COOKIE)?.value);
  const c = sessionCookie("", 0);
  store.set(c.name, c.value, c);
  return Response.json({ ended: true }, { headers: noStore });
}
