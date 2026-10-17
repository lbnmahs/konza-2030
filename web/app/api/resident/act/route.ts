import { noStore } from "@/lib/handset";
import { currentSession, deny, guardPost } from "@/lib/resident";
import { forwardAct, parseAct } from "@/lib/resident-act";
import { csrfOk, readEvents } from "@/lib/resident-session";
import { getServiceSupabase } from "@/lib/supabase-server";

// K8 S2 (plan-k8 2.4): a tap on a card. Panel user, same origin, the session's CSRF token, and the
// conversation from the cookie only; then the tools function's /ui/act (UI_ACT_SECRET, server
// only), which runs the same gate and handler as the agent's tool. The reply carries the events
// after `after`, so the card changes without waiting for the next poll.
export async function POST(request: Request) {
  const refused = await guardPost(request);
  if (refused) return refused;
  const session = await currentSession();
  if (!session) return deny(401, "no_session");
  if (!csrfOk(session, request.headers.get("x-csrf-token"))) return deny(403, "bad_csrf");
  const body = await request.json().catch(() => null);
  const input = parseAct(body);
  if (!input) return deny(400, "bad_request");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.UI_ACT_SECRET;
  if (!url || !secret) return deny(503, "act_unavailable");
  const reply = await forwardAct(fetch, `${url}/functions/v1/tools`, secret, session.conversationId, input);
  const after = Number.isInteger(body?.after) && body.after >= 0 ? body.after : null;
  const events = after === null
    ? undefined
    : await readEvents(getServiceSupabase(), session.conversationId, after).catch(() => undefined);
  return Response.json({ ...reply.body, events }, { status: reply.status, headers: noStore });
}
