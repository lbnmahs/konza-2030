// deno task calls <code|key> [n]     list the latest n calls (default 5) for that agent
// deno task calls show <conversation_id>   print the transcript with tool calls and results
// Transcripts are redacted by audit/redact.ts, the one copy of the rules (K6, MED-307): one-time
// codes (and anything read aloud while one is pending), references, resident numbers and phone
// digits; tool fields are kept only when a check needs them.

import { eleven, env } from "./_eleven.ts";
import { CODES } from "./agents.ts";
import { redactTranscript } from "../audit/redact.ts";

const [cmd, arg] = Deno.args;
if (!cmd) {
  console.error("Usage: deno task calls <code|key> [n] | deno task calls show <conversation_id>");
  Deno.exit(1);
}

const time = (unix: number) =>
  new Date(unix * 1000).toLocaleString("en-GB", { timeZone: "Europe/London" });
if (cmd === "show") {
  const c = await eleven("GET", `/conversations/${arg}`);
  console.log(`${c.conversation_id} · ${c.status} · ${c.metadata?.call_duration_secs ?? "?"} s`);
  for (const t of redactTranscript(c.transcript ?? [])) {
    const at = `${String(t.at).padStart(4)}s`;
    if (t.text) console.log(`${at} ${t.role === "agent" ? "AGENT" : "USER "}: ${t.text}`);
    for (const call of t.calls ?? []) {
      console.log(`${at}   -> ${call.tool} ${JSON.stringify(call.args)}`);
    }
    for (const r of t.results ?? []) {
      console.log(
        `${at}   <- ${r.tool}${r.error ? " (error)" : ""} ${JSON.stringify(r.value).slice(0, 600)}`,
      );
    }
  }
} else {
  const key = CODES[cmd.toLowerCase()] ?? cmd.toUpperCase();
  const agentId = env(`AGENT_ID_${key}`);
  const n = Number(arg) || 5;
  const list = await eleven("GET", `/conversations?agent_id=${agentId}&page_size=${n}`);
  for (const c of list.conversations ?? []) {
    console.log(
      `${c.conversation_id}  ${
        time(c.start_time_unix_secs)
      }  ${c.call_duration_secs}s  ${c.status}  ${c.call_successful ?? ""}`,
    );
  }
}
