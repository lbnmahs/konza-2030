import { panelUser, unauthorized } from "@/lib/auth";
import { failure, noStore, startBrowserSession } from "@/lib/handset";

// Starts a browser call: a signed URL from ElevenLabs (country agents require one) and a
// one-time token the browser presents with the new conversation id (/api/handset/bind).

export async function POST(request: Request) {
  if (!(await panelUser())) return unauthorized();
  const { agentKey } = (await request.json().catch(() => null)) ?? {};
  const r = await startBrowserSession(String(agentKey));
  return r.ok ? Response.json(r.value, { headers: noStore }) : failure(r);
}
