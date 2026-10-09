"use client";

import { useEffect, useRef, useState } from "react";
import { Conversation } from "@elevenlabs/client";

type Agent = { scenario: string; authority_name: string };
type Msg = { id: number; kind: "sms" | "voice"; body: string; at: string };
type Line = { role: "user" | "agent"; text: string };

// The handset: call a country agent from the browser. Codes and texts for this call appear in
// the inbox below; nothing is sent to a phone. Uses the microphone.
export default function Handset({ agents }: { agents: Agent[] }) {
  // K3: SIA (KONZA) is the default once it is registered; the KE agent stays until retired.
  const [agentKey, setAgentKey] = useState(
    agents.find((a) => a.scenario === "KONZA")?.scenario ?? agents[0]?.scenario ?? "",
  );
  const [status, setStatus] = useState("idle");
  const [conversationId, setConversationId] = useState("");
  const [inbox, setInbox] = useState<Msg[]>([]);
  const [textOnly, setTextOnly] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const session = useRef<Conversation | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    const poll = setInterval(async () => {
      const r = await fetch(`/api/handset/inbox?c=${conversationId}`);
      if (r.ok) setInbox((await r.json()).messages);
    }, 2000);
    return () => clearInterval(poll);
  }, [conversationId]);

  async function call() {
    setStatus("connecting");
    setInbox([]);
    setLines([]);
    const start = await fetch("/api/handset/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentKey }),
    });
    if (!start.ok) {
      setStatus("could not start");
      return;
    }
    const { signedUrl, token, language } = await start.json();
    if (!textOnly) await navigator.mediaDevices.getUserMedia({ audio: true });
    session.current = await Conversation.startSession({
      signedUrl,
      textOnly,
      overrides: {
        ...(language ? { agent: { language } } : {}),
        ...(textOnly ? { conversation: { textOnly: true } } : {}),
      },
      onMessage: ({ message, role }) =>
        setLines((l) => [...l, { role: role === "user" ? "user" : "agent", text: message }]),
      onConnect: async ({ conversationId: id }) => {
        const bind = await fetch("/api/handset/bind", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token, conversationId: id }),
        });
        setConversationId(id);
        setStatus(bind.ok ? "in call" : "in call (not registered: tools will refuse)");
      },
      onDisconnect: () => setStatus("ended"),
      onError: () => setStatus("error"),
    });
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    session.current?.sendUserMessage(draft.trim());
    setDraft("");
  }

  async function hangUp() {
    await session.current?.endSession();
    session.current = null;
  }

  return (
    <main style={{ maxWidth: 520, margin: "6vh auto", padding: 16 }}>
      <h1 style={{ fontSize: 20 }}>Virtual handset</h1>
      <p>Browser call to a country agent. Codes and texts show below instead of on a phone.</p>
      <label htmlFor="agent">Agent</label>
      <select
        id="agent"
        value={agentKey}
        onChange={(e) => setAgentKey(e.target.value)}
        disabled={status === "connecting" || status.startsWith("in call")}
        style={{ display: "block", margin: "8px 0 12px", padding: 6 }}
      >
        {agents.map((a) => (
          <option key={a.scenario} value={a.scenario}>{a.scenario}: {a.authority_name}</option>
        ))}
      </select>
      <label style={{ display: "block", marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={textOnly}
          onChange={(e) => setTextOnly(e.target.checked)}
          disabled={status === "connecting" || status.startsWith("in call")}
        />{" "}
        Text only (type instead of speaking)
      </label>
      {status.startsWith("in call")
        ? <button onClick={hangUp}>Hang up</button>
        : <button onClick={call} disabled={!agentKey || status === "connecting"}>Call</button>}
      <p role="status">Status: {status}{conversationId ? ` · ${conversationId}` : ""}</p>
      <h2 style={{ fontSize: 16 }}>Conversation</h2>
      <ol aria-live="polite" style={{ paddingLeft: 18 }}>
        {lines.map((l, i) => (
          <li key={i}><strong>{l.role === "user" ? "You" : "Agent"}</strong>: {l.text}</li>
        ))}
      </ol>
      {status.startsWith("in call") && (
        <form onSubmit={send} style={{ display: "flex", gap: 8 }}>
          <label htmlFor="say" style={{ position: "absolute", left: -9999 }}>Message</label>
          <input id="say" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1, padding: 6 }} />
          <button type="submit">Send</button>
        </form>
      )}
      <h2 style={{ fontSize: 16 }}>Inbox</h2>
      <ul aria-live="polite">
        {inbox.map((m) => (
          <li key={m.id}>
            <strong>{m.kind === "sms" ? "SMS" : "Code call"}</strong>: {m.body}
          </li>
        ))}
      </ul>
    </main>
  );
}
