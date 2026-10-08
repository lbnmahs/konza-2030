// deno task wer <conversation_id>   word error rate of Mahs's Swahili script call (his own voice)
//
// K5 (MED-304; the K5 design notes (kept private)). Mahs reads the SCRIPT phrases from scripts/voice/phrases.json
// in order on one call to SIA; his turns, as SIA's speech recognition heard them, are compared with
// the phrases. Prints the rate overall and on the critical phrases (amounts, dates, resident number,
// address, read-backs). Reads the transcript only; nothing is stored. The blind voice ranking was
// dropped on 7 Oct (Mahs): SIA keeps Halima on eleven_v4_turbo.

import { CRITICAL, wer } from "./voice/wer.ts";

/** The 10 Swahili phrases Mahs reads on his script call: the ones where a wrong word costs most. */
export const SCRIPT = [
  "amt-1",
  "amt-2",
  "amt-3",
  "date-1",
  "date-3",
  "id-1",
  "addr-1",
  "consent-1",
  "rb-1",
  "officer-1",
];

type Phrase = { id: string; category: string; en: string; sw: string };

if (import.meta.main) {
  const callId = Deno.args[0];
  const { phrases } = JSON.parse(
    await Deno.readTextFile(new URL("./voice/phrases.json", import.meta.url)),
  ) as { phrases: Phrase[] };
  const byId = new Map(phrases.map((p) => [p.id, p]));
  if (!callId) {
    console.log("Read these on one call to SIA, in order, one per turn:\n");
    SCRIPT.forEach((id, i) => console.log(`${i + 1}. ${byId.get(id)!.sw}`));
    console.log("\nThen: deno task wer <conversation_id>");
    Deno.exit(0);
  }
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  if (!key) throw new Error("Missing ELEVENLABS_API_KEY in .env");
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${callId}`, {
    headers: { "xi-api-key": key },
  });
  if (!res.ok) throw new Error(`conversation ${callId}: ${res.status}`);
  const said = ((await res.json()).transcript ?? [])
    .filter((t: any) => t.role === "user" && t.message)
    .map((t: any) => String(t.message));
  const pairs = SCRIPT.map((id, i) => ({
    ref: byId.get(id)!.sw,
    hyp: said[i] ?? "",
    critical: CRITICAL.has(byId.get(id)!.category),
  }));
  console.log(JSON.stringify(
    {
      call: callId,
      phrases: pairs.length,
      turns_heard: said.length,
      wer: Number(wer(pairs).toFixed(3)),
      wer_critical: Number(wer(pairs.filter((p) => p.critical)).toFixed(3)),
    },
    null,
    2,
  ));
}
