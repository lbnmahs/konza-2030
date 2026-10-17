"use client";

// K8 Voice mode (MED-342): the resident speaks, SIA replies in text. Speech is turned into text by
// ElevenLabs Scribe (real time) in the browser and lands in the message box; the resident reads it
// and taps send, so they always see what was heard before it goes. The single-use token comes from
// /api/resident/scribe-token (tied to the resident session); the worklet is self-hosted for the
// strict CSP. English first, Swahili recognised too.

export type Dictation = { stop(): Promise<void> };

export async function startDictation(on: {
  /** The text so far: everything committed plus the current partial. */
  onText: (text: string) => void;
  onEnd: () => void;
  onError: () => void;
}): Promise<Dictation> {
  const res = await fetch("/api/resident/scribe-token", { method: "POST" });
  if (!res.ok) throw new Error("scribe_token_failed");
  const { token } = await res.json();
  const { Scribe, CommitStrategy, RealtimeEvents } = await import("@elevenlabs/client");
  const connection = Scribe.connect({
    token,
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    languageCode: "en",
    secondaryLanguages: ["sw"],
    microphone: {
      echoCancellation: true,
      noiseSuppression: true,
      workletPaths: { scribeAudioProcessor: "/vendor/elevenlabs/scribe-audio-processor.js" },
    },
  });
  let committed = "";
  const join = (a: string, b: string) => [a, b].filter((x) => x.trim()).join(" ").trim();
  connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (m) => on.onText(join(committed, m.text)));
  connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (m) => {
    committed = join(committed, m.text);
    on.onText(committed);
  });
  connection.on(RealtimeEvents.CLOSE, () => on.onEnd());
  connection.on(RealtimeEvents.ERROR, () => on.onError());
  return {
    async stop() {
      try {
        connection.commit();
      } catch {
        // Nothing left to commit.
      }
      connection.close();
    },
  };
}
