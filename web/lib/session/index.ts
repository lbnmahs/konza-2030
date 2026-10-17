"use client";

// K8 S1 (MED-329, plan 2.3): the only module that talks to the voice provider, so a provider or
// transport change (the S0 voice spike may move us from the WebSocket signed URL to WebRTC) is one
// file. The SDK is imported on demand, after first paint. Audio worklets are self-hosted under
// /vendor/elevenlabs/ (copied by scripts/vendor-worklets.mjs) so the strict CSP needs no blob:,
// data: or CDN script source.

import type { Conversation } from "@elevenlabs/client";

type Overrides = NonNullable<Parameters<typeof Conversation.startSession>[0]["overrides"]>;
type Language = NonNullable<NonNullable<Overrides["agent"]>["language"]>;

export type Mode = "listening" | "speaking";
export type Line = { role: "user" | "agent"; text: string };

export type SessionEvents = {
  onConnect: (conversationId: string) => void;
  onLine: (line: Line) => void;
  onMode: (mode: Mode) => void;
  /** A reply arriving in parts (start, delta, stop), shown as it streams. The full
   * line still comes through onLine afterwards. */
  onPart?: (part: { type: "start" | "delta" | "stop"; text: string }) => void;
  /** The agent called a tool: Live shows Working only while a tool runs. */
  onToolStart?: () => void;
  /** Fires for every tool result the agent receives; S2 fetches new ui events on it (nudge). */
  onToolResult?: () => void;
  /** The session ended; byUser is false when the connection was lost. */
  onEnd: (byUser: boolean) => void;
  onError: (message: string) => void;
};

export type Session = {
  end(): Promise<void>;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  sendText(text: string): void;
  /** A fact for the agent that is not something the resident said (a service picked in the menu). */
  context(text: string): void;
  level(): number;
};

const WORKLETS = {
  rawAudioProcessor: "/vendor/elevenlabs/raw-audio-processor.js",
  audioConcatProcessor: "/vendor/elevenlabs/audio-concat-processor.js",
};
const LIBSAMPLERATE = "/vendor/elevenlabs/libsamplerate.worklet.js";

export async function startSession(
  opts: { signedUrl: string; language: string | null; textOnly: boolean },
  on: SessionEvents,
): Promise<Session> {
  const { Conversation: SDK } = await import("@elevenlabs/client");
  let endedByUser = false;
  const conversation = await SDK.startSession({
    signedUrl: opts.signedUrl,
    textOnly: opts.textOnly,
    workletPaths: WORKLETS,
    libsampleratePath: LIBSAMPLERATE,
    // The agent shortens replies and points at the screen when there is one (MED-331 prompt
    // block); phone calls get the agent's default, false.
    dynamicVariables: { has_screen: true },
    overrides: {
      // On the web the resident speaks first (MED-342): an empty first message, so SIA waits.
      // The AI disclosure is on screen instead; phone calls keep the spoken greeting.
      agent: { firstMessage: "", ...(opts.language ? { language: opts.language as Language } : {}) },
      ...(opts.textOnly ? { conversation: { textOnly: true } } : {}),
    },
    onConnect: ({ conversationId }) => on.onConnect(conversationId),
    onMessage: ({ message, role }) => on.onLine({ role: role === "user" ? "user" : "agent", text: message }),
    onModeChange: ({ mode }) => on.onMode(mode === "speaking" ? "speaking" : "listening"),
    onAgentChatResponsePart: (p) =>
      on.onPart?.({ type: p.type === "start" || p.type === "stop" ? p.type : "delta", text: p.text ?? "" }),
    onAgentToolRequest: () => on.onToolStart?.(),
    onAgentToolResponse: () => on.onToolResult?.(),
    onDisconnect: () => on.onEnd(endedByUser),
    onError: (message) => on.onError(String(message)),
  });
  return {
    async end() {
      endedByUser = true;
      await conversation.endSession();
    },
    // Text sessions (Text and Voice modes) have no audio: the SDK throws on these, so they are
    // no-ops there. A throw here once stopped the first message and dictation (MED-342 bug).
    setMuted: (muted) => {
      if (!opts.textOnly) conversation.setMicMuted(muted);
    },
    setVolume: (volume) => {
      if (!opts.textOnly) conversation.setVolume({ volume: Math.min(Math.max(volume, 0), 1) });
    },
    sendText: (text) => conversation.sendUserMessage(text),
    context: (text) => conversation.sendContextualUpdate(text),
    level: () => (opts.textOnly ? 0 : conversation.getOutputVolume()),
  };
}

/** Asks for the microphone; false when the resident refuses or there is none (text then). */
export async function micAllowed(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}
