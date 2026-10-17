// K8 (MED-327): the web app mirrors the UI catalog. web/lib/ui holds checked copies of the spec's
// catalog and examples (the Vercel build only sees web/), and its kinds match the schema.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { type Catalog, checkEvent } from "../supabase/functions/_shared/ui/catalog.ts";
import { announcement, apply, EMPTY, hide, markRefused, visible } from "../web/lib/ui/stream.ts";
import { KINDS } from "../web/lib/ui/types.ts";

const text = (p: string) => Deno.readTextFile(new URL(`../${p}`, import.meta.url));

Deno.test("K8 (MED-327): web copies of the catalog and examples match the spec; kinds match", async () => {
  for (const f of ["catalog.schema.json", "examples.json"]) {
    assertEquals(
      await text(`web/lib/ui/${f}`),
      await text(`spec/konza-2030-api/ui/${f}`),
      `web/lib/ui/${f} differs: copy it from spec/konza-2030-api/ui/`,
    );
  }
  const catalog = JSON.parse(await text("spec/konza-2030-api/ui/catalog.schema.json"));
  assertEquals([...KINDS].sort(), [...catalog.properties.kind.enum].sort());
});

Deno.test("K8 (MED-327): a full 2020-12 validator and the backend's checker agree on every case", async () => {
  // CommonJS packages: the class and function sit on .default under Deno's interop.
  const cjs = (m: any) => m.default?.default ?? m.default;
  const Ajv2020 = cjs(await import("npm:ajv@8.17.1/dist/2020.js"));
  const addFormats = cjs(await import("npm:ajv-formats@3.0.1"));
  const catalog: Catalog = JSON.parse(await text("spec/konza-2030-api/ui/catalog.schema.json"));
  const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
  addFormats(ajv);
  const full = ajv.compile(catalog);
  const examples: any[] = JSON.parse(await text("spec/konza-2030-api/ui/examples.json"));
  for (const ev of examples) {
    assert(full(ev), `${ev.kind}: ${JSON.stringify(full.errors)}`);
    assertEquals(checkEvent(catalog, ev), [], ev.kind);
  }
  const receipt = examples.find((e) => e.kind === "receipt");
  const bad: [string, (e: any) => void][] = [
    ["unknown kind", (e) => (e.kind = "upload")],
    ["refused by a rule", (e) => (e.payload.outcome = "refused")],
    ["other offer by a rule", (e) => (e.payload.outcome = "offered_alternative")],
    ["granted while pending", (e) => (e.payload.decided_by = "pending")],
    ["pending with a decider", (e) => (e.payload.outcome = "pending_officer")],
    ["rule without rules", (e) => (e.payload.rule_ids = [])],
    ["an assistant decides", (e) => (e.payload.decided_by = "agent")],
  ];
  for (const [why, mutate] of bad) {
    const e = structuredClone(receipt);
    mutate(e);
    assert(!full(e), `full validator accepts: ${why}`);
    assert(checkEvent(catalog, e).length, `checker accepts: ${why}`);
  }
  const officer = structuredClone(receipt);
  Object.assign(officer.payload, { outcome: "refused", decided_by: "officer", rule_ids: [] });
  assert(full(officer) && !checkEvent(catalog, officer).length, "an officer may refuse");
});

// ---------- K8 S2 (MED-331): the screen state from events ----------

const ev = (seq: number, kind: string, payload: Record<string, unknown>, at = "2026-10-12T09:00:00Z") => ({
  v: "ui/v1" as const,
  seq,
  kind,
  at,
  payload,
});

Deno.test("K8 S2: events apply once, in seq order; repeats and stale events change nothing", () => {
  const b1 = apply(EMPTY, [ev(2, "quote", { n: 2 }), ev(1, "progress", { n: 1 })]);
  assertEquals(b1.seq, 2);
  assertEquals(Object.keys(b1.cards).sort(), ["progress", "quote"]);
  assert(apply(b1, [ev(2, "quote", { n: 9 }), ev(1, "progress", { n: 9 })]) === b1, "nothing new");
  const b2 = apply(b1, [ev(3, "quote", { n: 3 })]);
  assertEquals((b2.cards.quote.payload as any).n, 3, "a later event replaces the card");
});

Deno.test("K8 S2: Refresh's new confirmation replaces the old card; the done state replaces the open one", () => {
  const open = apply(EMPTY, [ev(1, "confirm", { tool: "application_submit", confirmation_id: "a", state: "open" })]);
  const refreshed = apply(open, [ev(2, "confirm", { tool: "application_submit", confirmation_id: "b", state: "open" })]);
  assertEquals(Object.keys(refreshed.cards), ["confirm:application_submit"]);
  assertEquals((refreshed.cards["confirm:application_submit"].payload as any).confirmation_id, "b");
  const done = apply(refreshed, [ev(3, "confirm", { tool: "application_submit", confirmation_id: "b", state: "done" })]);
  assertEquals((done.cards["confirm:application_submit"].payload as any).state, "done");
});

Deno.test("K8 S2: a refused tap marks only its own card; Not now hides it; the screen shows the rail and the newest card", () => {
  let b = apply(EMPTY, [
    ev(1, "progress", {}),
    ev(2, "quote", {}),
    ev(3, "confirm", { tool: "application_submit", confirmation_id: "a", state: "open" }),
  ]);
  assertEquals(visible(b).current?.[0], "confirm:application_submit");
  assertEquals(visible(b).progress?.seq, 1);
  assert(markRefused(b, "other") === b);
  b = markRefused(b, "a");
  assertEquals((b.cards["confirm:application_submit"].payload as any).state, "refused");
  b = hide(b, "confirm:application_submit");
  assertEquals(visible(b).current?.[0], "quote");
  b = apply(b, [ev(4, "receipt", { decision_id: "d1" })]);
  assertEquals(visible(b).current?.[0], "receipt:d1");
});

Deno.test("K8 S2: the server clock offset never runs ahead of the server (Confirm never opens early)", () => {
  const received = Date.parse("2026-10-12T09:00:02Z");
  assertEquals(apply(EMPTY, [ev(1, "progress", {}, "2026-10-12T09:00:00Z")], received).offsetMs, -2000);
  // A device clock behind the server would give a positive offset; it is capped at 0.
  assertEquals(apply(EMPTY, [ev(1, "progress", {}, "2026-10-12T09:00:05Z")], received).offsetMs, 0);
});

Deno.test("K8 (MED-331): no effect returns a value (React calls it as the cleanup)", async () => {
  // scrollIntoView returns a Promise in current Chrome; `useEffect(() => x.scrollIntoView())`
  // returns that Promise as a cleanup and crashes the page. Effects in the web app use a block body.
  const found: string[] = [];
  const walk = async (dir: string) => {
    for await (const e of Deno.readDir(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const src = await Deno.readTextFile(p);
        if (/use(Layout)?Effect\(\(\) => [^{(\s]/.test(src)) found.push(p);
      }
    }
  };
  for (const d of ["web/app", "web/components", "web/lib"]) await walk(d);
  assertEquals(found, []);
});

Deno.test("K8 (MED-331): an approved payment is announced as received, not as review and pay", () => {
  const words = { payment: "Review and pay.", "payment.approved": "Payment received.", receipt: "Decision." };
  const paid = apply(EMPTY, [ev(1, "payment", { payment_id: "p1", state: "approved" })]);
  assertEquals(announcement(paid, words), "Payment received.");
  const open = apply(EMPTY, [ev(1, "payment", { payment_id: "p1", state: "pending" })]);
  assertEquals(announcement(open, words), "Review and pay.");
  assertEquals(announcement(EMPTY, words), "");
});

Deno.test("MED-331: a code card waiting for its code stays on screen under a newer card", () => {
  const now = Date.parse("2026-10-13T09:40:00Z");
  const at = "2026-10-13T09:40:00Z";
  const code = ev(1, "identity", { step: "code", expires_at: "2026-10-13T09:44:00Z" }, at);
  const fee = ev(2, "quote", { rows: [] }, at);
  const b = apply(EMPTY, [code, fee], now);
  const v = visible(b, now);
  assertEquals(v.current?.[0], "quote");
  assertEquals(v.pending.map(([k]) => k), ["identity"]);
  // Expired, verified or dismissed: only the newest card.
  assertEquals(visible(b, Date.parse("2026-10-13T09:45:00Z")).pending, []);
  const verified = apply(b, [ev(3, "identity", { step: "verified" }, at)], now);
  assertEquals(visible(verified, now).pending, []);
  assertEquals(visible(hide(b, "identity"), now).pending, []);
  // The code card itself newest: shown once, as current.
  assertEquals(visible(apply(EMPTY, [code], now), now).pending, []);
});

Deno.test("MED-331: a reply streams in parts and the finished line settles it without a copy", async () => {
  const { addLine, addPart } = await import("../web/lib/lines.ts");
  let l = addLine([], { role: "user", text: "Renew my passport" });
  l = addPart(l, { type: "start", text: "" });
  l = addPart(l, { type: "delta", text: "I can " });
  l = addPart(l, { type: "delta", text: "help." });
  assertEquals(l.at(-1), { role: "agent", text: "I can help.", parts: ["I can ", "help."], streaming: true });
  l = addPart(l, { type: "stop", text: "" });
  l = addLine(l, { role: "agent", text: "I can help." });
  assertEquals(l.length, 2, "no second copy");
  assertEquals(l[1], { role: "agent", text: "I can help.", parts: ["I can ", "help."] });
  // A corrected reply shows as finally said; a line that never streamed is simply added.
  let c = addPart([], { type: "delta", text: "Draft" });
  c = addLine(c, { role: "agent", text: "Final words." });
  assertEquals(c, [{ role: "agent", text: "Final words." }]);
  assertEquals(addLine(c, { role: "agent", text: "Next." }).length, 2);
});

Deno.test("MED-331: references are said to be on the screen there, in the session's language", async () => {
  const { withSpeech } = await import("../supabase/functions/_shared/speech.ts");
  const r = { ref: "SPS-8D062037" };
  const screen = withSpeech(r, "en", true) as { say: { rule: string } };
  assert(/on the screen/.test(screen.say.rule) && !/text message/.test(screen.say.rule), screen.say.rule);
  const call = withSpeech(r, "en") as { say: { rule: string } };
  assert(/text message/.test(call.say.rule), call.say.rule);
  assert(/skrini/.test((withSpeech(r, "sw", true) as { say: { rule: string } }).say.rule));
});

Deno.test("MED-331 (15 Oct): the empty start and stop before a tool call leave no empty line", async () => {
  const { addLine, addPart } = await import("../web/lib/lines.ts");
  // As the live stream sent it: start, stop (no words), the tool, then the reply in parts.
  let l = addLine([], { role: "user", text: "And how long does it take?" });
  for (const p of [{ type: "start", text: "" }, { type: "stop", text: "" }, { type: "start", text: "" }] as const) {
    l = addPart(l, p);
  }
  assertEquals(l.length, 1, "nothing shown until words arrive");
  l = addPart(l, { type: "delta", text: "About " });
  l = addPart(l, { type: "delta", text: "ten days." });
  l = addPart(l, { type: "stop", text: "" });
  l = addLine(l, { role: "agent", text: "About ten days." });
  assertEquals(l.map((x) => x.text), ["And how long does it take?", "About ten days."]);
});

Deno.test("MED-332: a finished card replaced by a newer one leaves one line, once", async () => {
  const { logLines } = await import("../web/lib/ui/stream.ts");
  const w = {
    confirmed: (t: string) => `Done: ${t}`,
    paid: (k: number, r: string) => `Paid KES ${k} · ${r}`,
    decision: (o: string, r: string) => `Decision: ${o} · ${r}`,
    verified: "Identity checked",
  };
  const at = "2026-10-15T09:00:00Z";
  let b = apply(EMPTY, [ev(1, "payment", { payment_id: "p1", state: "approved", amount_kes: 9550, reference: "KZP1" }, at)]);
  assertEquals(logLines(b, new Set(), w), [], "still on screen: no line yet");
  b = apply(b, [ev(2, "slots", { title: { en: "Biometrics" } }, at)]);
  const lines = logLines(b, new Set(), w);
  assertEquals(lines.map((l) => l.text), ["Paid KES 9550 · KZP1"]);
  assertEquals(logLines(b, new Set(lines.map((l) => l.id)), w), [], "logged once");
  // An open confirm or a waiting payment leaves nothing.
  const open = apply(EMPTY, [ev(1, "confirm", { tool: "x", state: "open", title: { en: "T" } }, at), ev(2, "quote", {}, at)]);
  assertEquals(logLines(open, new Set(), w), []);
});

Deno.test("MED-332 (15 Oct): a payment waiting for its PIN stays on screen under a fresh identity check", () => {
  const now = Date.parse("2026-10-15T05:47:00Z");
  const at = "2026-10-15T05:47:00Z";
  const pay = ev(1, "payment", { payment_id: "p1", state: "pin", expires_at: "2026-10-15T05:51:00Z" }, at);
  const verified = ev(2, "identity", { step: "verified" }, at);
  const v = visible(apply(EMPTY, [pay, verified], now), now);
  assertEquals(v.current?.[0], "identity");
  assertEquals(v.pending.map(([k]) => k), ["payment:p1"]);
  // Paid, or closed: no longer waiting.
  const paid = ev(3, "payment", { payment_id: "p1", state: "approved" }, at);
  assertEquals(visible(apply(EMPTY, [pay, verified, paid], now), now).pending, []);
  assertEquals(visible(apply(EMPTY, [pay, verified], now), Date.parse("2026-10-15T05:52:00Z")).pending, []);
});
