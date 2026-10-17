import { panelUser, unauthorized } from "@/lib/auth";
import { bindBrowserSession, failure, noStore } from "@/lib/handset";

// Registers a browser call: the one-time token from /api/handset/start plus the conversation
// id from the ElevenLabs client. The backend then accepts the call's tool calls (as call_started
// does for phone calls), and its texts and codes go to the handset inbox, not to a phone.

export async function POST(request: Request) {
  if (!(await panelUser())) return unauthorized();
  const { token, conversationId } = (await request.json().catch(() => null)) ?? {};
  const r = await bindBrowserSession(token, conversationId, "browser handset");
  return r.ok ? Response.json({ bound: true }, { headers: noStore }) : failure(r);
}
