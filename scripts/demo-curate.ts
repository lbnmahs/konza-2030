// deno task demo:curate <slug> <conv_id | "t1:<test name>"> [--title "..."] [--language en|sw]
//   [--until <n>]   keep only the first n lines (marked as an excerpt), e.g. to end before a step
//                   that only exists because a T1 mock could not answer it
// K6 (MED-310): turns one real call (Mahs's) or the newest passing T1 run of a test (a simulated
// caller) into a scene for the public /demo page, in web/lib/demo/<slug>.json. Redacted with
// audit/redact.ts; refuses to write while anything still looks like a code, reference or phone
// number. System lines say which rule or step the backend applied, never anything from the
// Audit Office. Mahs reads every file before it is published.

import { eleven, env } from "./_eleven.ts";
import { leftovers, type RedactedTurn, redactTranscript } from "../audit/redact.ts";

type Line = { who: "agent" | "caller" | "system"; text: string };

const [slug, source, ...rest] = Deno.args;
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
if (!slug || !source || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('usage: deno task demo:curate <slug> <conv_id | "t1:<test name>"> [--title ...]');
  Deno.exit(2);
}

/** The newest passing run of a T1 test against SIA, with its simulated conversation. */
async function latestT1(name: string) {
  const agent = env("AGENT_ID_KONZA");
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const list = await eleven(
      "GET",
      `/test-invocations?agent_id=${agent}&page_size=30${cursor ? `&cursor=${cursor}` : ""}`,
    );
    for (const s of list.results ?? []) {
      const suite = await eleven("GET", `/test-invocations/${s.id}`);
      const run = (suite.test_runs ?? []).find((t: any) =>
        t.status === "passed" && String(t.test_name).endsWith(name)
      );
      if (run) return { id: run.test_run_id as string, transcript: run.agent_responses ?? [] };
    }
    if (!list.has_more) break;
    cursor = list.next_cursor;
  }
  throw new Error(`no passing T1 run of "${name}"`);
}

const RESULT: Record<string, (v: any) => string | null> = {
  identity_start_otp: () => "Identity check: a one-time code goes by SMS to the phone on record.",
  identity_check_otp: (v) => (v?.verified ? "Code checked: identity verified." : null),
  service_open: (v) => (v?.title ? `Service card opened: ${v.title}.` : null),
  rules_lookup: (v) =>
    v?.topic
      ? `Rules looked up (${v.topic}${v.rule_ids?.length ? `, ${v.rule_ids.join(", ")}` : ""}).`
      : null,
  payment_request: (v) =>
    v?.needs_confirmation
      ? "Asks first: the amount from the rules is read back; nothing is sent before a clear yes."
      : v?.status === "pending"
      ? "DEMO payment prompt sent; the code is never read aloud."
      : null,
  payment_confirm: (
    v,
  ) => (v?.status === "approved" ? "Payment approved; the receipt goes by SMS." : null),
  send_message: (v) => (v?.sent ? "Summary sent by SMS." : null),
  create_case: () => "A case is opened for an officer to follow up.",
};

/** System line for one tool result, or null when there is nothing worth showing. */
function systemLine(tool: string, v: any): string | null {
  if (v?.error) return null;
  if (v?.needs_confirmation && tool !== "payment_request") {
    return "Asks first: the backend's read-back is said word for word; nothing happens before a clear yes.";
  }
  if (v?.outcome === "pending_officer") {
    return "Decision: waiting for an officer, who decides; the receipt gives the reason and when.";
  }
  if (v?.outcome) {
    const who = v.decided_by === "rule"
      ? `a published rule${v.rule_ids?.length ? ` (${v.rule_ids.join(", ")})` : ""}`
      : "an officer, who has not decided yet";
    return `Decision: ${
      String(v.outcome).replace("_", " ")
    }, by ${who}. The receipt gives the reason and the review route.`;
  }
  return RESULT[tool]?.(v) ?? null;
}

function scene(turns: RedactedTurn[]): Line[] {
  const lines: Line[] = [];
  for (const t of turns) {
    for (const r of t.results ?? []) {
      const s = systemLine(r.tool, r.value);
      if (s && lines.at(-1)?.text !== s) lines.push({ who: "system", text: s });
    }
    if (t.text && t.text !== "..." && !/^\.+$/.test(t.text)) {
      // The repo carries no en or em dashes (CLAUDE.md rule 1): a pause becomes a comma.
      // Voice tags such as [warm] are not speech.
      const text = t.text.replace(/\s*[\u2013\u2014]\s*/g, ", ")
        .replace(/\[(?!ref\]|id\]|date\]|number\]|digits\]|date of birth\]|code read)[a-z ]+\]\s*/g, "")
        .replace(/ +([.,?!])/g, "$1");
      lines.push({ who: t.role === "agent" ? "agent" : "caller", text });
    }
  }
  return lines;
}

const t1 = source.startsWith("t1:");
const raw = t1
  ? await latestT1(source.slice(3))
  : { id: source, transcript: (await eleven("GET", `/conversations/${source}`)).transcript ?? [] };
const turns = redactTranscript(raw.transcript);
const left = leftovers(turns);
if (left.length) {
  console.error(`refused: ${left.length} values still look like codes or references`);
  Deno.exit(1);
}
const all = scene(turns);
const until = Number(opt("until")) || all.length;
const out = {
  id: slug,
  title: opt("title") ?? slug,
  language: opt("language") ?? "en",
  source: `${t1 ? "simulated caller (T1 test)" : "a real test call by the project's author"}${
    until < all.length ? ", excerpt" : ""
  }`,
  turns: all.slice(0, until),
};
const file = new URL(`../web/lib/demo/${slug}.json`, import.meta.url);
await Deno.mkdir(new URL(".", file), { recursive: true });
await Deno.writeTextFile(file, JSON.stringify(out, null, 2) + "\n");
// The source id goes in the commit message and plan notes, never on the public page.
console.log(`${out.turns.length} lines from ${raw.id} -> ${file.pathname}`);
