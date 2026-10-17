import { assert, assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import { rb, type ReadBack } from "../readback.ts";
import { type Catalog, checkEvent } from "./catalog.ts";
import {
  confirmDraft,
  type Draft,
  formDraft,
  identityDraft,
  jcs,
  progressDraft,
  paymentDraft,
  quoteDraft,
  receiptDraft,
  shownHash,
  slotsDraft,
} from "./drafts.ts";
import { appointmentDayOk, appointmentDays, WINDOW_HOURS } from "../rules/konza/rules.ts";

// K8 S2 (MED-330): every event the backend can emit is valid ui/v1, and the shown hash binds a
// tap to the stored arguments and the exact words.

const spec = new URL("../../../../spec/konza-2030-api/ui/catalog.schema.json", import.meta.url);
const catalog: Catalog = JSON.parse(await Deno.readTextFile(spec));
const valid = (d: Draft) =>
  assertEquals(checkEvent(catalog, { v: "ui/v1", seq: 1, kind: d.kind, at: "2026-10-12T09:00:00Z", payload: d.payload }), [], d.kind);

// The manifest's agencies open the database client on import (as in konza/readback_test.ts).
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "unused");
const { AGENCIES } = await import("../konza/manifest.ts");
const passport = AGENCIES.sps.services.passport_renewal;
const readback: ReadBack = {
  en: "Renew your passport with 34 pages. The fee is 7,550 shillings.",
  sw: "Kuhuisha pasipoti yako ya kurasa thelathini na nne. Ada ni shilingi elfu saba mia tano na hamsini.",
  items: [rb.amount(7550)],
};

Deno.test("K8 S2: jcs sorts keys at every level and refuses non-integers", () => {
  assertEquals(jcs({ b: 1, a: { d: [2, { z: null, y: "x" }], c: true } }), '{"a":{"c":true,"d":[2,{"y":"x","z":null}]},"b":1}');
  assertEquals(jcs({ a: undefined, b: 2 }), '{"b":2}');
  assertThrows(() => jcs({ a: 1.5 }));
});

Deno.test("K8 S2: the shown hash changes with the words, the arguments or the confirmation", async () => {
  const base = { confirmation_id: crypto.randomUUID(), tool: "konza:submitApplication", args_hash: "a".repeat(64), readback };
  const h = await shownHash(base);
  assert(/^[0-9a-f]{64}$/.test(h));
  assertEquals(await shownHash({ ...base }), h, "same input, same hash");
  assertNotEquals(await shownHash({ ...base, args_hash: "b".repeat(64) }), h, "arguments");
  assertNotEquals(await shownHash({ ...base, readback: { ...readback, en: readback.en + " " } }), h, "English words");
  assertNotEquals(await shownHash({ ...base, readback: { ...readback, sw: readback.sw + "." } }), h, "Swahili words");
  assertNotEquals(await shownHash({ ...base, confirmation_id: crypto.randomUUID() }), h, "another confirmation");
});

Deno.test("K8 S2: a passport fee answer becomes a valid quote, labelled from the application", () => {
  const q = quoteDraft("Passport renewal: fees", { values: { fees_kes: { 34: 7550, 50: 9550, 66: 12050 } }, rule_ids: ["PP-01"] }, passport.applicationSchema);
  assert(q);
  valid(q);
  assertEquals((q.payload.rows as { amount_kes: number }[]).map((r) => r.amount_kes), [7550, 9550, 12050]);
  assertEquals(quoteDraft("x", { values: { other: 1 }, rule_ids: ["PP-01"] }, null), null, "no fee, no card");
  assertEquals(quoteDraft("x", { values: { fee_kes: 200 }, rule_ids: [] }, null), null, "no rule, no card");
  valid(quoteDraft("Delivery", { values: { fee_kes: 200 }, rule_ids: ["AD-03"] }, null)!);
});

Deno.test("K8 S2: progress, form, identity and confirm events are valid", () => {
  valid(progressDraft("sps.passport_renewal", passport.title, {}));
  valid(progressDraft("sps.passport_renewal", passport.title, { verified_at: "2026-10-12T09:00:00Z" }));
  valid(formDraft("sps.passport_renewal", passport.title, passport.applicationSchema));
  valid(identityDraft("code", { channel: "sms", expires_at: "2026-10-12T09:05:00Z" }));
  valid(identityDraft("verified"));
  for (const consent of [false, true]) {
    valid(confirmDraft({
      confirmation_id: crypto.randomUUID(),
      uiTool: "application_submit",
      title: "Confirm application",
      consent,
      readback,
      earliest_at: "2026-10-12T09:00:04Z",
      expires_at: "2026-10-12T09:03:00Z",
      shown_hash: "c".repeat(64),
    }));
  }
});

Deno.test("K8 S2: receipts follow the charter (adverse only by an officer, rules named)", () => {
  const review = { panel: "Aminia Review Panel", ask_by: "2026-11-11", free: true, answer_within_working_days: 10 };
  const d = { id: crypto.randomUUID(), reason_en: "Within the renewal window.", review };
  valid(receiptDraft({ ...d, outcome: "granted", decided_by: "rule", rule_ids: ["PP-02"], next_en: "Pay the fee." }));
  valid(receiptDraft({ ...d, outcome: "pending_officer", decided_by: "pending", rule_ids: [] }));
  valid(receiptDraft({ ...d, outcome: "refused", decided_by: "officer", rule_ids: [] }));
  const bad = receiptDraft({ ...d, outcome: "refused", decided_by: "rule", rule_ids: ["PP-02"] });
  assert(checkEvent(catalog, { v: "ui/v1", seq: 1, kind: "receipt", at: "2026-10-12T09:00:00Z", payload: bad.payload }).length > 0);
});

Deno.test("K8 S2 (Mahs, 12 Oct): the rail shows only recorded steps, each on its own record", () => {
  const steps = (d: Draft) =>
    Object.fromEntries((d.payload.steps as { id: string; state: string }[]).map((s) => [s.id, s.state]));
  const none = progressDraft("sps.passport_renewal", passport.title, {});
  assertEquals(steps(none), { identity: "todo", confirm: "todo", decision: "todo" });
  assertEquals(none.payload.updated, undefined, "nothing recorded, no update line");
  // Verified only: nothing else is inferred from it (no "current" details step).
  const verified = progressDraft("sps.passport_renewal", passport.title, { verified_at: "2026-10-12T09:00:00Z" });
  assertEquals(steps(verified), { identity: "done", confirm: "todo", decision: "todo" });
  const waiting = progressDraft("sps.passport_renewal", passport.title, {
    verified_at: "2026-10-12T09:00:00Z",
    submitted_at: "2026-10-12T09:01:00Z",
    decision: { created_at: "2026-10-12T09:01:00.5Z", decided_at: null, decided_by: null },
  });
  valid(waiting);
  assertEquals(steps(waiting), { identity: "done", confirm: "done", decision: "current" });
  assertEquals((waiting.payload.updated as any).source.en, "Waiting for an officer");
  const granted = progressDraft("sps.passport_renewal", passport.title, {
    verified_at: "2026-10-12T09:00:00Z",
    submitted_at: "2026-10-12T09:01:00Z",
    decision: { created_at: "2026-10-12T09:01:01Z", decided_at: "2026-10-12T09:01:01Z", decided_by: "rule" },
  });
  valid(granted);
  assertEquals(steps(granted).decision, "done");
  assertEquals(granted.payload.updated, {
    at: "2026-10-12T09:01:01.000Z",
    source: { en: "A published rule", sw: "Kanuni iliyochapishwa" },
  });
  assert(!JSON.stringify(granted).includes("percent"));
});

Deno.test("K8 S2: an application and its decision stored at the same instant show the decision as newest", () => {
  const at = "2026-10-12T09:01:00Z";
  const d = progressDraft("sps.passport_renewal", passport.title, {
    submitted_at: at,
    decision: { created_at: at, decided_at: at, decided_by: "rule" },
  });
  assertEquals((d.payload.updated as any).source.en, "A published rule");
});

Deno.test("MED-331: the receipt carries the application reference; an approved payment its transaction reference", () => {
  const d = {
    id: crypto.randomUUID(),
    reason_en: "The renewal is accepted.",
    review: { panel: "Aminia Review Panel", ask_by: "2026-11-11", free: true, answer_within_working_days: 10 },
  };
  const r = receiptDraft({ ...d, outcome: "granted", decided_by: "rule", rule_ids: ["PP-02"], ref: "SPS-5DE0FCB5" });
  valid(r);
  assertEquals(r.payload.ref, "SPS-5DE0FCB5");
  assertEquals("ref" in receiptDraft({ ...d, outcome: "granted", decided_by: "rule", rule_ids: ["PP-02"] }).payload, false);
  const p = paymentDraft({
    id: crypto.randomUUID(),
    state: "approved",
    amount_kes: 7550,
    description: "Kenyan passport renewal, 34-page booklet",
    expires_at: "2026-10-12T09:05:00Z",
    desk: "the Konza Passport Desk",
    reference: "KZP9F1EA2D",
  });
  valid(p);
  assertEquals([p.payload.state, p.payload.reference], ["approved", "KZP9F1EA2D"]);
});

Deno.test("MED-332: the payment card offers masked methods, then a code or PIN box, never a secret", () => {
  const base = {
    id: crypto.randomUUID(),
    amount_kes: 1000,
    description: "Health cover contribution, 2026-10",
    expires_at: "2026-10-13T10:05:00Z",
    desk: "Lango Square",
    methods: [
      { id: crypto.randomUUID(), type: "card" as const, masked: "•••• 4417" },
      { id: crypto.randomUUID(), type: "mobile_money" as const, masked: "07•• ••• 318" },
    ],
    attempts_left: 3,
  };
  const choose = paymentDraft({ ...base, state: "choose" });
  valid(choose);
  assertEquals((choose.payload.methods as unknown[]).length, 2);
  assertEquals("method_id" in choose.payload || "attempts_left" in choose.payload, false);
  const pin = paymentDraft({ ...base, state: "pin", method_id: base.methods[1].id, attempts_left: 2 });
  valid(pin);
  assertEquals([pin.payload.method_id, pin.payload.attempts_left], [base.methods[1].id, 2]);
  const code = paymentDraft({ ...base, state: "code", method_id: base.methods[0].id });
  valid(code);
  assertEquals(code.payload.channel, "sms");
  // Paid: no methods, the reference; a masked number never becomes anything else.
  const paid = paymentDraft({ ...base, state: "approved", reference: "KZP099F35B" });
  valid(paid);
  assertEquals("methods" in paid.payload, false);
  for (const d of [choose, pin, code, paid]) {
    assert(!["code", "pin", "card_number"].some((k) => k in d.payload), "no secret on the card");
  }
});

Deno.test("MED-332: the slots card offers exactly the days the rules accept, and the two windows", () => {
  const today = "2026-10-15"; // a Thursday
  const days = appointmentDays(today);
  assertEquals(days.length, 10);
  assert(days.every((d) => appointmentDayOk(today, d)), "every offered day can be booked");
  assertEquals(days[0], "2026-10-16");
  assert(!days.some((d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())), "working days only");
  const card = slotsDraft({ title: "Biometrics", place: "Konza Passport Desk", days, hours: WINDOW_HOURS });
  valid(card);
  const p = card.payload as { days: { date: string; label: { en: string } }[]; windows: { id: string }[] };
  assertEquals(p.days[0].label.en, "Friday 16 October");
  assertEquals(p.windows.map((w) => w.id), ["morning", "afternoon"]);
});
