import { failure, noStore, startBrowserSession } from "@/lib/handset";
import { guardPost } from "@/lib/resident";

// K8 S1: starts a resident session with SIA (signed URL plus one-time token), exactly like the
// handset and within the same 20 a day. The agent is fixed: the resident app only talks to SIA.
export async function POST(request: Request) {
  const refused = await guardPost(request);
  if (refused) return refused;
  const r = await startBrowserSession("KONZA");
  return r.ok ? Response.json(r.value, { headers: noStore }) : failure(r);
}
