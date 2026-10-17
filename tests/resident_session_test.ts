// K8 S1 (MED-329): the resident-session cookie and the same-origin check, without a network.

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { forwardAct, NOT_DONE, parseAct } from "../web/lib/resident-act.ts";
import {
  csrfOk,
  hashSessionToken,
  newSessionToken,
  sameOrigin,
  SESSION_COOKIE,
  SESSION_TTL_S,
  sessionCookie,
} from "../web/lib/resident-session.ts";

Deno.test("K8 S1: the session cookie is __Host-, HttpOnly, Secure, SameSite=Strict, path /, 45 minutes", () => {
  const c = sessionCookie("x");
  assert(SESSION_COOKIE.startsWith("__Host-"));
  assertEquals(c.name, SESSION_COOKIE);
  assertEquals([c.httpOnly, c.secure, c.sameSite, c.path], [true, true, "strict", "/"]);
  assertEquals(c.maxAge, 45 * 60);
  assertEquals(SESSION_TTL_S, 45 * 60);
  assert(!("domain" in c), "a __Host- cookie must not set a domain");
  assertEquals(sessionCookie("", 0).maxAge, 0);
});

Deno.test("K8 S1: session tokens are 256-bit random hex; only their SHA-256 is stored", () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert(/^[0-9a-f]{64}$/.test(a));
  assertNotEquals(a, b);
  assert(/^[0-9a-f]{64}$/.test(hashSessionToken(a)));
  assertNotEquals(hashSessionToken(a), a);
  assertEquals(hashSessionToken(a), hashSessionToken(a));
});

Deno.test("K8 S1: state-changing resident routes accept only same-origin requests", () => {
  const req = (origin?: string) =>
    new Request("https://sia.example.test/api/resident/start", {
      method: "POST",
      headers: origin ? { origin } : {},
    });
  assert(sameOrigin(req("https://sia.example.test")));
  assert(!sameOrigin(req("https://evil.example.test")));
  assert(!sameOrigin(req("http://sia.example.test")), "scheme counts");
  assert(!sameOrigin(req("null")));
  assert(!sameOrigin(req()), "no Origin header is refused");
});

// ---------- K8 S2 (MED-330): CSRF, taps and the act route ----------

const session = (csrf: string | null) => ({
  conversationId: "conv_a",
  agentId: "agent",
  expiresAt: "",
  csrfHash: csrf === null ? null : hashSessionToken(csrf),
});

Deno.test("K8 S2: a tap needs the CSRF token issued with its own session", () => {
  const csrf = newSessionToken();
  assert(csrfOk(session(csrf), csrf));
  assert(!csrfOk(session(csrf), newSessionToken()), "another session's token");
  assert(!csrfOk(session(csrf), hashSessionToken(csrf)), "the stored hash is not the token");
  assert(!csrfOk(session(csrf), null), "no header");
  assert(!csrfOk(session(csrf), "short"), "malformed");
  assert(!csrfOk(session(null), csrf), "a session from before S2 has no token");
});

Deno.test("K8 S2: a tap carries only an action, a confirmation id and the card's hash", () => {
  const id = crypto.randomUUID();
  const hash = "a".repeat(64);
  assertEquals(parseAct({ action: "confirm", confirmation_id: id, shown_hash: hash }), {
    action: "confirm",
    confirmation_id: id,
    shown_hash: hash,
  });
  // The conversation, tool and arguments never come from the browser.
  assertEquals(
    parseAct({ action: "refresh", confirmation_id: id, conversation_id: "conv_b", tool: "x", args: {} }),
    { action: "refresh", confirmation_id: id },
  );
  assertEquals(parseAct({ action: "confirm", confirmation_id: id }), null, "confirm needs the hash");
  assertEquals(parseAct({ action: "pay", confirmation_id: id, shown_hash: hash }), null);
  assertEquals(parseAct({ action: "confirm", confirmation_id: "1", shown_hash: hash }), null);
  assertEquals(parseAct(null), null);
});

Deno.test("K8 S2: an outage never says done; the conversation is the session's", async () => {
  const input = { action: "confirm" as const, confirmation_id: crypto.randomUUID(), shown_hash: "a".repeat(64) };
  const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fake = (status: number, body: string | null, fail = false): typeof fetch => (url, init) => {
    sent.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    if (fail) return Promise.reject(new TypeError("network down"));
    return Promise.resolve(new Response(body, { status }));
  };
  const run = (f: typeof fetch) => forwardAct(f, "http://tools.test/functions/v1/tools", "s3cret", "conv_a", input);

  for (
    const f of [
      fake(0, null, true),
      fake(502, "<html>Bad gateway</html>"),
      fake(500, JSON.stringify({ outcome: "granted" })),
      fake(503, JSON.stringify({ already_done: true })),
      fake(403, JSON.stringify({ error: "forbidden" })),
      fake(200, "not json"),
    ]
  ) {
    const r = await run(f);
    assertEquals(r, NOT_DONE);
    assert(!("outcome" in r.body) && !("already_done" in r.body));
  }
  const ok = await run(fake(200, JSON.stringify({ outcome: "granted" })));
  assertEquals([ok.status, ok.body.outcome], [200, "granted"]);
  const changed = await run(fake(409, JSON.stringify({ error: "card_changed" })));
  assertEquals([changed.status, changed.body.error], [409, "card_changed"]);
  for (const s of sent) {
    assertEquals(s.url, "http://tools.test/functions/v1/tools/ui/act");
    assertEquals(s.headers.get("x-ui-act-secret"), "s3cret");
    assertEquals(s.body.conversation_id, "conv_a");
  }
});

Deno.test("K8 S2 (plan-k8 2.5.6): no resident route or component reaches /api/pesa", async () => {
  const roots = ["web/app/sia", "web/app/api/resident", "web/components/resident", "web/lib/session"];
  const files = ["web/lib/resident.ts", "web/lib/resident-session.ts", "web/lib/resident-act.ts"];
  const walk = async (dir: string) => {
    for await (const e of Deno.readDir(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  for (const r of roots) await walk(r);
  assert(files.length > 10, `only ${files.length} files found`);
  for (const f of files) {
    const src = await Deno.readTextFile(f);
    assert(!/api\/pesa|\/pesa\b/.test(src), `${f} mentions /api/pesa`);
  }
});

Deno.test("K8 S2 (MED-331): identity and form taps carry only a six-digit code or flat short fields", () => {
  assertEquals(parseAct({ action: "identity_code", code: "123456", conversation_id: "b" }), {
    action: "identity_code",
    code: "123456",
  });
  for (const code of ["12345", "1234567", "12a456", 123456]) {
    assertEquals(parseAct({ action: "identity_code", code }), null, String(code));
  }
  assertEquals(parseAct({ action: "form_submit", fields: { pages: 34, receive: "collect" } }), {
    action: "form_submit",
    fields: { pages: 34, receive: "collect" },
  });
  for (
    const fields of [
      {},
      [],
      { pages: { nested: 1 } },
      { "Bad-Name": 1 },
      { note: "x".repeat(201) },
      Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, i])),
    ]
  ) {
    assertEquals(parseAct({ action: "form_submit", fields }), null, JSON.stringify(fields).slice(0, 40));
  }
});
