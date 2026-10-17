// K8 S1 (MED-329) and S2 (MED-330): resident sessions against the LOCAL stack only (test:local).
// A cookie resolves to its own conversation and nothing else; expired, ended, unbound or malformed
// cookies resolve to nothing; a bound row issues one session only; browsers cannot read the table.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  closeSession,
  csrfOk,
  hashSessionToken,
  newSessionToken,
  openSession,
  readEvents,
  resolveSession,
} from "../web/lib/resident-session.ts";

const status = new TextDecoder().decode(
  (await new Deno.Command("supabase", { args: ["status", "-o", "env"] }).output()).stdout,
);
const local = Object.fromEntries(
  status.split("\n").map((l) => l.match(/^(\w+)="?([^"]*)"?$/)).filter(Boolean)
    .map((m) => [m![1], m![2]]),
);
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(local.API_URL ?? "")) {
  throw new Error("test:local only runs against the local Supabase stack");
}
const db = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });

/** A handset_tokens row already bound to a conversation, as /api/resident/bind leaves it. */
async function boundRow(conversationId: string) {
  const oneTime = newSessionToken();
  const now = new Date().toISOString();
  const { error } = await db.from("handset_tokens").insert({
    token_hash: hashSessionToken(oneTime),
    agent_id: "agent_test_resident",
    expires_at: new Date(Date.now() + 180_000).toISOString(),
    used_at: now,
    conversation_id: conversationId,
  });
  if (error) throw error;
  return hashSessionToken(oneTime);
}

const conv = () => `conv_test${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;

async function cleanup(ids: string[]) {
  await db.from("handset_tokens").delete().in("conversation_id", ids);
}

Deno.test("K8 S1: each cookie resolves to its own conversation only (A never reads B)", async () => {
  const [a, b] = [conv(), conv()];
  try {
    const sa = await openSession(db, await boundRow(a), a);
    const sb = await openSession(db, await boundRow(b), b);
    assert(sa && sb);
    assertEquals((await resolveSession(db, sa.token))?.conversationId, a);
    assertEquals((await resolveSession(db, sb.token))?.conversationId, b);
    assertEquals(await resolveSession(db, newSessionToken()), null, "an unknown cookie");
    assertEquals(await resolveSession(db, "not-a-token"), null, "a malformed cookie");
    assertEquals(await resolveSession(db, undefined), null, "no cookie");
    // The stored value is the hash, never the cookie itself.
    const { data } = await db.from("handset_tokens").select("session_hash").eq("conversation_id", a).single();
    assertEquals(data!.session_hash, hashSessionToken(sa.token));
  } finally {
    await cleanup([a, b]);
  }
});

Deno.test("K8 S1: a bound row issues one session; the wrong conversation gets none", async () => {
  const [a, b] = [conv(), conv()];
  try {
    const hash = await boundRow(a);
    assertEquals(await openSession(db, hash, b), null, "the one-time token belongs to another conversation");
    assert(await openSession(db, hash, a));
    assertEquals(await openSession(db, hash, a), null, "no second session from the same bind");
  } finally {
    await cleanup([a, b]);
  }
});

Deno.test("K8 S1: ended and expired sessions resolve to nothing", async () => {
  const [a, b] = [conv(), conv()];
  try {
    const sa = await openSession(db, await boundRow(a), a);
    await closeSession(db, sa!.token);
    assertEquals(await resolveSession(db, sa!.token), null, "ended with End");
    const sb = await openSession(db, await boundRow(b), b);
    await db.from("handset_tokens").update({ session_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("conversation_id", b);
    assertEquals(await resolveSession(db, sb!.token), null, "past 45 minutes");
  } finally {
    await cleanup([a, b]);
  }
});

Deno.test("K8 S2: bind issues a CSRF token; only its hash is stored, on that session's row", async () => {
  const [a, b] = [conv(), conv()];
  try {
    const sa = await openSession(db, await boundRow(a), a);
    const sb = await openSession(db, await boundRow(b), b);
    const ra = await resolveSession(db, sa!.token);
    assertEquals(ra?.csrfHash, hashSessionToken(sa!.csrf));
    assert(csrfOk(ra!, sa!.csrf));
    assert(!csrfOk(ra!, sb!.csrf), "B's token does not work on A's session");
  } finally {
    await cleanup([a, b]);
  }
});

Deno.test("K8 S2: events are read for the cookie's conversation only, in order, after a seq", async () => {
  const [a, b] = [conv(), conv()];
  for (const [c, n] of [[a, 3], [b, 2]] as const) {
    for (let i = 0; i < n; i++) {
      const { error } = await db.rpc("ui_event_append", {
        p_conversation_id: c,
        p_kind: "progress",
        p_payload: { n: i },
      });
      if (error) throw error;
    }
  }
  const all = await readEvents(db, a, 0);
  assertEquals(all.map((e) => [e.v, e.seq]), [["ui/v1", 1], ["ui/v1", 2], ["ui/v1", 3]]);
  assertEquals((await readEvents(db, a, 2)).map((e) => e.payload), [{ n: 2 }]);
  assertEquals((await readEvents(db, b, 0)).length, 2, "B sees its own two only");
  // ui_events are append-only, so these rows stay until the next demo_truncate (as audit_log).
});

Deno.test("K8 S1: browsers cannot read or write handset_tokens (no anon grants)", async () => {
  const read = await anon.from("handset_tokens").select("session_hash").limit(1);
  assert(read.error || (read.data ?? []).length === 0, "anon must not read sessions");
  const write = await anon.from("handset_tokens").insert({
    token_hash: "x".repeat(64),
    agent_id: "a",
    expires_at: new Date().toISOString(),
  });
  assert(write.error, "anon must not insert");
});

Deno.test("MED-331: codes in the resident app go to the phone; the handset keeps its inbox", async () => {
  // The guard as the deployed function runs it, without SMS_DRY_RUN. Nothing is sent here; the
  // guard only decides and logs.
  Deno.env.set("SUPABASE_URL", local.API_URL);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", local.SERVICE_ROLE_KEY);
  Deno.env.set("ALLOWED_RECIPIENTS", "+447700900123");
  Deno.env.delete("SMS_DRY_RUN");
  const { guardOutbound } = await import("../supabase/functions/_shared/outbound.ts");
  const [resident, handset] = [conv(), conv()];
  try {
    for (const id of [resident, handset]) {
      const { error } = await db.from("conversations").insert({ id, agent_id: "agent_test_resident", authority: "sia", language: "en", channel: "browser" });
      if (error) throw error;
    }
    assert(await openSession(db, await boundRow(resident), resident));
    await boundRow(handset);
    assertEquals(await guardOutbound("sms", "+447700900123", resident, "code"), false, "sent to the phone");
    assertEquals(await guardOutbound("sms", "+447700900123", handset, "code"), true, "kept for the panel");
    const { data } = await db.from("handset_inbox").select("conversation_id").in("conversation_id", [resident, handset]);
    assertEquals(data!.map((r) => r.conversation_id), [handset]);
  } finally {
    await db.from("handset_inbox").delete().in("conversation_id", [resident, handset]);
    await cleanup([resident, handset]);
    await db.from("conversations").delete().in("id", [resident, handset]);
  }
});
