import { noStore } from "@/lib/handset";
import { currentSession, deny, guardPost } from "@/lib/resident";

// K8 Voice mode (MED-342): a single-use Scribe token (15 minutes, consumed on connect) so the
// browser can turn the resident's speech into text without ever holding the API key. Only for a
// live resident session, so dictation stays inside the 20 sessions a day.
export async function POST(request: Request) {
  const refused = await guardPost(request);
  if (refused) return refused;
  if (!(await currentSession())) return deny(401, "no_session");
  const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
  });
  if (!res.ok) return deny(502, "token_failed");
  const { token } = await res.json();
  return Response.json({ token }, { headers: noStore });
}
