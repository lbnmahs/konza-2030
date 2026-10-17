// T0 integration tests for the country agent gates, against the LOCAL stack only.
//   supabase start
//   supabase functions serve tools --env-file tests/local.env --no-verify-jwt
//   deno task test:local
// Seeds fictional data with a phone number from the drama range, registers a test hub agent,
// and calls the real `tools` function over HTTP. Refuses to run against anything but localhost.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AUTHORITIES } from "../supabase/functions/_shared/authorities.ts";
import { buildSeed, TABLE_ORDER } from "../scripts/seed/common.ts";
import { DEMO_MOMO_PIN } from "../scripts/seed/konza.ts";
import { todayIn } from "../supabase/functions/_shared/rules/common/dates.ts";
import { appointmentDays } from "../supabase/functions/_shared/rules/konza/rules.ts";
import { connect, localAuditUrl, type Sql } from "../audit/db.ts";

const status = new TextDecoder().decode(
  (await new Deno.Command("supabase", { args: ["status", "-o", "env"] }).output()).stdout,
);
const local = Object.fromEntries(
  status.split("\n").map((l) => l.match(/^(\w+)="?([^"]*)"?$/)).filter(Boolean)
    .map((m) => [m![1], m![2]]),
);
const API = local.API_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API ?? "")) {
  throw new Error("test:local only runs against the local Supabase stack");
}
const db = createClient(API, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// The Audit Office's own role (K6, MED-306): a local-only password, set as the local superuser.
const AUDIT_URL = await localAuditUrl(local.DB_URL);
/** Runs fn as mirror_vale on a connection closed afterwards (no socket outlives a test). */
async function asAudit<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = connect(AUDIT_URL);
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 0 });
  }
}
/** Opens a hold the way the checker does: as mirror_vale. */
const insertHold = (h: { agency: string; service: string; rule_id: string; finding: string }) =>
  asAudit(async (sql) =>
    (await sql`insert into konza_holds ${sql({ ...h, opened_by: "mirror_vale" })} returning id`)[0]
      .id as string
  );
const SECRET = "local-tool-secret";
const PHONE = "+447700900123";
const HUB = "agent_test_ke_hub";
const LEGACY = "agent_test_ke_id";
const KONZA = "agent_test_konza";

async function call(
  tool: string,
  conversationId: string,
  args: Record<string, unknown> = {},
  agentId = HUB,
) {
  const res = await fetch(`${API}/functions/v1/tools/${tool}`, {
    method: "POST",
    headers: { "x-tool-secret": SECRET, "content-type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, agent_id: agentId, ...args }),
  });
  return await res.json();
}

const ok = (r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
};

async function reset() {
  ok(await db.from("authorities").upsert(Object.values(AUTHORITIES)));
  ok(
    await db.from("demo_agents").upsert([
      {
        agent_id: HUB,
        scenario: "KE",
        authority: "njia",
        authority_name: "NJIA",
        language: "sw",
        country: "KE",
        hub: "KE",
      },
      {
        agent_id: KONZA,
        scenario: "KONZA",
        authority: "sia",
        authority_name: "SIA",
        language: "sw",
        country: "KE",
        hub: "KONZA",
      },
      {
        agent_id: LEGACY,
        scenario: "KE_ID",
        authority: "usajili_njema",
        authority_name: "Usajili Njema",
        language: "sw",
        country: "KE",
        hub: null,
      },
    ]),
  );
  ok(await db.rpc("demo_truncate"));
  // Holds survive demo_truncate (K4); the local test stack clears any left open, as an officer.
  ok(
    await db.from("konza_holds").update({
      cleared_at: new Date().toISOString(),
      cleared_by: "test_officer",
    })
      .is("cleared_at", null),
  );
  const { seed } = buildSeed((k) => (k === "DEMO_UK_MOBILE" ? PHONE : `test-${k}`));
  for (const t of TABLE_ORDER) if (seed[t]?.length) ok(await db.from(t).insert(seed[t]));
}

/** A conversation opened by call_started, verified as `citizenId` `agoMs` ago. */
async function startedCall(citizenId: string | null, agoMs = 0, agentId = HUB) {
  const id = `conv_test_${crypto.randomUUID().slice(0, 8)}`;
  const res = await fetch(`${API}/functions/v1/tools/call_started`, {
    method: "POST",
    headers: { "x-tool-secret": SECRET, "content-type": "application/json" },
    body: JSON.stringify({ conversation_id: id, agent_id: agentId, caller_id: PHONE }),
  });
  await res.json();
  if (citizenId) {
    ok(
      await db.from("conversations").update({
        verified_at: new Date(Date.now() - agoMs).toISOString(),
        citizen_id: citizenId,
      }).eq("id", id),
    );
  }
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await reset();

Deno.test("refuses tool calls on a conversation call_started never opened", async () => {
  const r = await call("permit_lookup", "conv_never_started");
  assertEquals(r.error, "unknown_conversation");
});

Deno.test("K0: the old per-scenario path is closed (an agent without a hub is refused)", async () => {
  const r = await call("rules_id_replacement", "conv_legacy_1", {}, LEGACY);
  assertEquals(r.error, "forbidden");
});

Deno.test("gate: no service tools before capability_enter, only that service's after", async () => {
  const id = await startedCall("cit_s3");
  assertEquals((await call("permit_lookup", id)).error, "wrong_service");
  assertEquals((await call("capability_enter", id, { capability: "permit" })).ok, true);
  const p = await call("permit_lookup", id);
  assertEquals(p.permit_no, "PWN-SBP-10492");
  assert(p.say?.references?.permit_no?.last4, "speech layer adds the spoken last 4");
  assertEquals(
    (await call("id_report_loss", id, { kind: "lost", lost_days_ago: 1 })).error,
    "wrong_service",
  );
  const { data } = await db.from("audit_log").select("authority").eq("conversation_id", id).eq(
    "actor",
    "Service",
  );
  assert(data!.some((r) => r.authority === "pwani_njema"), "audited under the service's authority");
});

Deno.test("two-step: prepare, refuse same-turn and changed commits, then commit", async () => {
  const id = await startedCall("cit_ke_id");
  await call("capability_enter", id, { capability: "lost_id" });
  const args = { kind: "lost", lost_days_ago: 2, location_description: "matatu" };
  const prep = await call("id_report_loss", id, args);
  assertEquals(prep.needs_confirmation, true);
  const card = async () =>
    (await db.from("id_cards").select("status").eq("citizen_id", "cit_ke_id").single()).data!
      .status;
  assertEquals(await card(), "active", "nothing happens on prepare");
  const fast = await call("id_report_loss", id, { ...args, confirmation_id: prep.confirmation_id });
  assertEquals(fast.error, "confirmation_invalid");
  const prep2 = await call("id_report_loss", id, args);
  await sleep(4200);
  const changed = await call("id_report_loss", id, {
    ...args,
    lost_days_ago: 3,
    confirmation_id: prep2.confirmation_id,
  });
  assertEquals(changed.error, "confirmation_invalid");
  const prep3 = await call("id_report_loss", id, args);
  await sleep(4200);
  const done = await call("id_report_loss", id, {
    ...args,
    confirmation_id: prep3.confirmation_id,
  });
  assertEquals(done.card_status, "BLOCKED");
  assertEquals(await card(), "blocked");
  // K8 (plan-k8 2.4): a second yes for the same confirmation gets the stored result back, and
  // nothing happens twice.
  const reuse = await call("id_report_loss", id, {
    ...args,
    confirmation_id: prep3.confirmation_id,
  });
  assertEquals([reuse.already_done, reuse.card_status], [true, "BLOCKED"]);
  const { count } = await db.from("id_losses").select("id", { count: "exact", head: true })
    .eq("conversation_id", id);
  assertEquals(count, 1);
});

Deno.test("step-up: money tools need a check from the last 5 minutes", async () => {
  const id = await startedCall("cit_s3", 6 * 60_000);
  await call("capability_enter", id, { capability: "permit" });
  assertEquals((await call("payment_request", id, { amount_kes: 3500 })).error, "step_up");
  assert(!(await call("permit_lookup", id)).error, "reads still work at 6 minutes");
});

Deno.test("identity concern holds the session: writes refused, reads allowed", async () => {
  const id = await startedCall("cit_s3");
  await call("capability_enter", id, { capability: "permit" });
  const c = await call("create_case", id, {
    type: "identity_concern",
    priority: "urgent",
    summary: "Caller says they are the permit holder's child.",
  });
  assertEquals(c.session_held, true);
  assertEquals((await call("payment_request", id, { amount_kes: 3500 })).error, "session_held");
  assert(!(await call("permit_lookup", id)).error);
});

Deno.test("refund: ID fee before biometrics is refunded (RF-04), then shows in history", async () => {
  const id = await startedCall("cit_ke_id");
  await call("capability_enter", id, { capability: "lost_id" });
  ok(
    await db.from("payments").insert({
      conversation_id: id,
      citizen_id: "cit_ke_id",
      permit_id: "n/a",
      case_ref: "UN-APP-00001",
      amount: 1000,
      currency: "KES",
      reference: "UN-APP-00001",
      status: "approved",
      txn_code: "SIMTEST5HT",
      authority: "usajili_njema",
      payee: "Usajili Njema",
      description: "test",
    }),
  );
  const args = { reason: "found the old ID" };
  const prep = await call("refund_request", id, args);
  await sleep(4200);
  const r = await call("refund_request", id, { ...args, confirmation_id: prep.confirmation_id });
  assertEquals([r.status, r.rule_id], ["processed", "RF-04"]);
  assert(r.say?.references?.refund_ref?.full, "refund reference gets spoken forms");
  const h = await call("get_history", id);
  const kinds = h.items.map((i: any) => `${i.what}:${i.status}`);
  assert(kinds.includes("refund:processed"), JSON.stringify(kinds));
  assert(kinds.includes("payment:refunded"), JSON.stringify(kinds));
});

Deno.test("refund: a permit already issued is declined (RF-03)", async () => {
  const id = await startedCall("cit_s3");
  await call("capability_enter", id, { capability: "permit" });
  const pay = (await db.from("payments").insert({
    conversation_id: id,
    citizen_id: "cit_s3",
    permit_id: "per_001",
    case_ref: "per_001",
    amount: 3500,
    currency: "KES",
    reference: "PWN-SBP-10492",
    status: "approved",
    txn_code: "SIMTEST777",
    authority: "pwani_njema",
    payee: "Pwani Njema",
    description: "test",
  }).select("id").single()).data!;
  ok(await db.from("county_permits").update({ renewed_payment_id: pay.id }).eq("id", "per_001"));
  const prep = await call("refund_request", id, { reason: "changed my mind" });
  await sleep(4200);
  const r = await call("refund_request", id, {
    reason: "changed my mind",
    confirmation_id: prep.confirmation_id,
  });
  assertEquals([r.status, r.rule_id], ["declined", "RF-03"]);
});

Deno.test("SMS goes only to allowed numbers and is logged (dry run locally)", async () => {
  const id = await startedCall(null);
  const r = await call("identity_start_otp", id, {
    id_number: "29384756",
    date_of_birth: "1988-11-05",
  });
  assertEquals(r.code_sent, true);
  const { data } = await db.from("sms_log").select("to_last3, dry_run").order("at", {
    ascending: false,
  }).limit(1);
  assertEquals(data![0], { to_last3: "123", dry_run: true });
});

Deno.test("a number outside ALLOWED_RECIPIENTS gets nothing", async () => {
  ok(await db.from("citizens").update({ phone: "+447700900999" }).eq("id", "cit_n2"));
  const id = await startedCall(null);
  const r = await call("identity_start_otp", id, {
    id_number: "27450931",
    date_of_birth: "1987-04-15",
  });
  assertEquals(r.error, "recipient_not_allowed");
});

Deno.test("no second code for a caller verified in the last 5 minutes", async () => {
  const id = await startedCall("cit_ke_id", 60_000);
  const before = (await db.from("sms_log").select("id", { count: "exact", head: true })).count;
  const r = await call("identity_start_otp", id, {
    id_number: "31234987",
    date_of_birth: "1995-02-21",
  });
  assertEquals([r.already_verified, r.first_name], [true, "Kevin"]);
  const after = (await db.from("sms_log").select("id", { count: "exact", head: true })).count;
  assertEquals(after, before);
});

Deno.test("browser calls: the code goes to the handset inbox, not Twilio", async () => {
  const id = await startedCall(null);
  ok(await db.from("conversations").update({ channel: "browser" }).eq("id", id));
  const r = await call("identity_start_otp", id, {
    id_number: "29384756",
    date_of_birth: "1988-11-05",
  });
  assertEquals(r.code_sent, true);
  const { data } = await db.from("handset_inbox").select("kind, body").eq("conversation_id", id);
  assertEquals(data!.length, 1);
  assert(!/DEMO/.test(data![0].body) && /\d{6}/.test(data![0].body));
});

Deno.test("a different person within 5 minutes gets their own code", async () => {
  const id = await startedCall("cit_ke_id", 60_000);
  const r = await call("identity_start_otp", id, {
    id_number: "28761093",
    date_of_birth: "1993-12-09",
  });
  assertEquals([r.already_verified, r.code_sent], [undefined, true]);
});

Deno.test("KE passport: fee question needs no identity; apply is two-step; desk filter; pay first", async () => {
  const id = await startedCall(null);
  await call("capability_enter", id, { capability: "passport" });
  const q = await call("passport_quote", id, { pages: 50 });
  assertEquals(q.chosen.fee_kes, 9550);
  assertEquals((await call("passport_status", id)).error, "not_verified");
  ok(
    await db.from("conversations").update({
      verified_at: new Date().toISOString(),
      citizen_id: "cit_ke_id",
    }).eq("id", id),
  );
  assertEquals((await call("passport_status", id)).renewal_open, true);
  const args = { pages: 34, desk: "london" };
  const prep = await call("passport_apply", id, args);
  assertEquals(prep.needs_confirmation, true);
  await sleep(4200);
  const app = await call("passport_apply", id, { ...args, confirmation_id: prep.confirmation_id });
  assertEquals([app.fee_kes, app.desk], [7550, "London"]);
  const offices = await call("registry_list_offices", id);
  const names = JSON.stringify(offices);
  assert(names.includes("NJIA Consular Desk London") && !names.includes("Nairobi"), names);
  const slot = offices.offices[0].slots[0].slot_id;
  // K2: booking is two-step too; the fee rule still refuses it at the commit.
  const bprep = await call("registry_book_slot", id, { slot_id: slot });
  assertEquals(bprep.needs_confirmation, true);
  await sleep(4200);
  const book = await call("registry_book_slot", id, {
    slot_id: slot,
    confirmation_id: bprep.confirmation_id,
  });
  assertEquals(book.error, "booking_refused");
});

Deno.test("K2: adding a dependant and emailing the calendar are two-step on the KE agent", async () => {
  const id = await startedCall("cit_ke_id");
  await call("capability_enter", id, { capability: "health" });
  const dep = await call("health_add_dependant", id, { name: "Baraka", born_days_ago: 3 });
  assertEquals(dep.needs_confirmation, true);
  const cal = await call("calendar_email", id);
  assertEquals(cal.needs_confirmation, true);
});

// ---------- K2 Konza (MED-264, MED-265, MED-268) ----------

/** MED-331: one passport renewal at a time. Tests here renew Laban's passport again and again in
 * one seeded database, so before each new application every renewal still in progress is recorded
 * as handed over (a delivered delivery), as when the holder receives the new passport. The test
 * "one renewal at a time" calls the tool directly to see the guard. */
async function handOverPassports() {
  const { data: apps } = await db.from("konza_applications").select("id, subject_citizen_id")
    .eq("agency", "sps").eq("service", "passport_renewal");
  for (const a of apps ?? []) {
    // The holder's address, or any seeded one (an address test may have changed the holder's);
    // the row only needs a valid address for its foreign key.
    const { data: own } = await db.from("addresses").select("id").eq("citizen_id", a.subject_citizen_id)
      .maybeSingle();
    const { data: any } = own ? { data: own } : await db.from("addresses").select("id").limit(1).maybeSingle();
    const addr = own ?? any;
    if (!addr) throw new Error("handOverPassports: no address in the seed");
    ok(
      await db.from("deliveries").upsert({
        citizen_id: a.subject_citizen_id,
        address_id: addr.id,
        item_kind: "passport",
        item_ref: a.id,
        deliver_on: new Date().toISOString().slice(0, 10),
        window: "morning",
        fee_kes: 0,
        status: "delivered",
        handover_code_hash: "test",
      }, { onConflict: "item_kind,item_ref" }),
    );
  }
}

const konza = async (tool: string, id: string, args: Record<string, unknown> = {}) => {
  if (tool === "application_submit" && !args.confirmation_id) await handOverPassports();
  return call(tool, id, args, KONZA);
};

Deno.test("Konza: service_open from the manifest; fees need no identity; personal topics do", async () => {
  const id = await startedCall(null, 0, KONZA);
  assertEquals((await konza("rules_lookup", id, { topic: "fees" })).error, "wrong_service");
  const open = await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  assertEquals(open.service, "sps.passport_renewal");
  assert(open.steps.includes("application_submit"));
  assertEquals(
    (await konza("service_open", id, { agency: "sps", service: "nope" })).error,
    "unknown_service",
  );
  const fees = await konza("rules_lookup", id, { topic: "fees" });
  assertEquals(fees.values.fees_kes["34"], 7550);
  assertEquals((await konza("rules_lookup", id, { topic: "renewal" })).error, "not_verified");
});

Deno.test("Konza passport: two-step application granted by rule with a receipt; delivery to the holder", async () => {
  const id = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  assertEquals((await konza("rules_lookup", id, { topic: "renewal" })).values.open, true);
  const args = { fields_json: JSON.stringify({ pages: 34, receive: "home" }) };
  const prep = await konza("application_submit", id, args);
  assertEquals(prep.needs_confirmation, true);
  // AD-04: home delivery is paid with the fee, said with the total before the yes.
  assert(prep.summary_en.includes("7,550 shillings plus 200 shillings for home delivery, 7,750 shillings in all"), prep.summary_en);
  // K5 (MED-301): the Swahili read-back says the rules amount in words.
  assert(prep.readback.sw.includes("shilingi elfu saba mia tano na hamsini"), prep.readback.sw);
  assert(prep.readback.items.some((i: any) => i.kind === "amount" && i.value === 7550));
  const same = await konza("application_submit", id, {
    ...args,
    confirmation_id: prep.confirmation_id,
  });
  assertEquals(same.error, "confirmation_invalid");
  const prep2 = await konza("application_submit", id, args);
  await sleep(4200);
  const app = await konza("application_submit", id, {
    ...args,
    confirmation_id: prep2.confirmation_id,
  });
  assertEquals([app.outcome, app.decided_by], ["granted", "rule"]);
  assertEquals(app.review.panel, "Aminia Review Panel");
  const why = await konza("decision_explain", id, { decision_id: app.decision_id });
  assert(why.rule_ids.includes("PP-02"));
  // K3 (MED-296): the fee is paid first, here at the desk.
  // The fee and the home delivery, one charge (AD-04).
  await payAtDesk(app.application_id, 7750);
  const dargs = { item_kind: "passport", application_id: app.application_id, window: "morning" };
  // MED-331: nothing is handed over before it is made; biometrics come first (PP-04).
  assertEquals((await konza("delivery_book", id, dargs)).error, "appointment_first");
  const bio = await twice(id, "appointment_book", { application_id: app.application_id, window: "morning" });
  assert(bio.ready_by > bio.on_date, JSON.stringify(bio));
  // Chosen when applying: collection now would leave the delivery paid for nothing.
  assertEquals((await konza("delivery_book", id, { ...dargs, method: "collect" })).error, "receive_chosen");
  const dprep = await konza("delivery_book", id, dargs);
  assert(dprep.summary_en.includes("zone three, block B twelve"), dprep.summary_en);
  assert(dprep.readback.sw.includes("eneo la tatu, bloku B kumi na mbili"), dprep.readback.sw);
  assert(dprep.readback.items.some((i: any) => i.value === "Z3 B12 P047 U02"));
  await sleep(4200);
  const d = await konza("delivery_book", id, { ...dargs, confirmation_id: dprep.confirmation_id });
  assertEquals([d.status, d.fee_kes, d.fee_paid], ["booked", 200, true]);
  assert(dprep.summary_en.includes("already paid with the fee"), dprep.summary_en);
  assertEquals(d.deliver_on, bio.ready_by, "delivered on the ready date, not the next working day");
  // Another resident cannot read Laban's decision.
  const other = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", other, { agency: "sps", service: "passport_renewal" });
  assertEquals(
    (await konza("decision_explain", other, { decision_id: app.decision_id })).error,
    "not_yours",
  );
});

Deno.test("Konza: no tool can decide; a pending decision changes only by an officer, once", async () => {
  const { data: d } = await db.from("konza_decisions").select("id").limit(1).single();
  const upd = await db.from("konza_decisions").update({ outcome: "refused", decided_by: "rule" })
    .eq("id", d!.id);
  assert(upd.error, "a decided decision must not change");
  // No assistant tool decides, approves or refuses.
  for await (const f of Deno.readDir(new URL("../agents/tools/", import.meta.url))) {
    assert(!/decide|approve|refuse|officer/.test(f.name), f.name);
  }
});

Deno.test("Konza: audit_log and konza_audit_events are append-only", async () => {
  const a = await db.from("audit_log").update({ action: "x" }).gt("id", 0);
  const b = await db.from("konza_audit_events").delete().gt("id", 0);
  assert(a.error && /append-only/.test(a.error.message), JSON.stringify(a.error));
  // K6 close: the service role has no DELETE on the audit log, and the trigger stays behind it.
  assert(b.error && /append-only|permission denied/.test(b.error.message), JSON.stringify(b.error));
  const { count } = await db.from("konza_audit_events").select("id", {
    count: "exact",
    head: true,
  });
  assert((count ?? 0) > 0);
});

// ---------- K2 gate: SILN plugged in by manifest only (MED-266) ----------

Deno.test("SILN: a parent applies for a child only with recorded consent; full school goes to an officer; withdrawal stops it", async () => {
  const id = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", id, { agency: "siln", service: "primary_place" });
  const schools = await konza("rules_lookup", id, { topic: "schools" });
  assertEquals(schools.values.zone, 3);
  const apply = (school: string, extra: Record<string, unknown> = {}) =>
    konza("application_submit", id, {
      fields_json: JSON.stringify({ preferred_school_id: school }),
      on_behalf_of: "QK-2041-0009",
      ...extra,
    });
  assertEquals((await apply("z3_north")).error, "consent_required");
  // Only a recorded parent or guardian can consent: Neema for Laban is refused.
  assertEquals(
    (await konza("consent_record", id, { subject: "QK-2041-0039", scopes: "school_application" }))
      .error,
    "not_guardian",
  );
  const cargs = { subject: "QK-2041-0009", scopes: "school_application" };
  const cprep = await konza("consent_record", id, cargs);
  assertEquals(cprep.needs_confirmation, true);
  // K5 (MED-301): the child by first name, the scope and the end date in Swahili words.
  assert(cprep.readback.sw.includes("maombi ya shule"), cprep.readback.sw);
  assert(cprep.readback.sw.includes(", mwaka elfu mbili"), cprep.readback.sw);
  assert(!/\d/.test(cprep.readback.sw), cprep.readback.sw);
  await sleep(4200);
  const consent = await konza("consent_record", id, {
    ...cargs,
    confirmation_id: cprep.confirmation_id,
  });
  assertEquals(consent.subject, "QK-2041-0009");
  // Full preferred school: pending an officer, alternative proposed, never refused by rule.
  const p1 = await apply("z3_primary");
  await sleep(4200);
  const full = await apply("z3_primary", { confirmation_id: p1.confirmation_id });
  assertEquals([full.outcome, full.decided_by], ["pending_officer", null]);
  assert(full.reason.includes("Zone 3 North Primary School"), full.reason);
  // In the catchment with space: granted by rule ED-03.
  const p2 = await apply("z3_north");
  await sleep(4200);
  const ok2 = await apply("z3_north", { confirmation_id: p2.confirmation_id });
  assertEquals([ok2.outcome, ok2.decided_by], ["granted", "rule"]);
  // Withdrawn consent stops further applications at once.
  assertEquals(
    (await konza("consent_withdraw", id, { consent_id: consent.id })).withdrawn_at !== null,
    true,
  );
  assertEquals((await apply("z3_north")).error, "consent_required");
});

// ---------- K4 circuit breaker (MED-272) ----------

Deno.test("K4: any open hold on a service holds its rule grants, even under a rule they do not cite; holds are never deleted and clear once", async () => {
  const hold = {
    id: await insertHold({
      agency: "sps",
      service: "passport_renewal",
      // A rule the passport grant does not cite (MED-280: holds cover the whole service).
      rule_id: "AR-01",
      finding: "C5:renewal_not_open",
    }),
  };
  const id = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const args = { fields_json: JSON.stringify({ pages: 50, receive: "collect" }) };
  const prep = await konza("application_submit", id, args);
  await sleep(4200);
  const app = await konza("application_submit", id, {
    ...args,
    confirmation_id: prep.confirmation_id,
  });
  assertEquals([app.outcome, app.decided_by], ["pending_officer", null]);
  assert(app.reason.includes("on hold for an officer check"), app.reason);
  assert((await db.from("konza_holds").delete().eq("id", hold!.id)).error, "never deleted");
  const at = new Date().toISOString();
  ok(
    await db.from("konza_holds").update({ cleared_at: at, cleared_by: "officer_test" }).eq(
      "id",
      hold!.id,
    ),
  );
  assert(
    (await db.from("konza_holds").update({ cleared_at: at, cleared_by: "x" }).eq("id", hold!.id))
      .error,
    "a cleared hold never changes",
  );
  const prep2 = await konza("application_submit", id, args);
  await sleep(4200);
  const app2 = await konza("application_submit", id, {
    ...args,
    confirmation_id: prep2.confirmation_id,
  });
  assertEquals([app2.outcome, app2.decided_by], ["granted", "rule"]);
});

// ---------- K3 breaker live pieces (MED-286) ----------

async function openHold(service: [string, string], rule_id = "PP-02") {
  return await insertHold({ agency: service[0], service: service[1], rule_id, finding: "test" });
}
const clearHold = async (id: string) =>
  ok(
    await db.from("konza_holds").update({
      cleared_at: new Date().toISOString(),
      cleared_by: "test_officer",
    }).eq("id", id),
  );

Deno.test("K3: a hold opened between prepare and commit still holds the grant", async () => {
  const id = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const args = { fields_json: JSON.stringify({ pages: 66, receive: "collect" }) };
  const prep = await konza("application_submit", id, args);
  const hold = await openHold(["sps", "passport_renewal"]);
  await sleep(4200);
  const app = await konza("application_submit", id, {
    ...args,
    confirmation_id: prep.confirmation_id,
  });
  await clearHold(hold);
  assertEquals([app.outcome, app.decided_by], ["pending_officer", null]);
});

Deno.test("K3: konza_store_decision re-reads holds in the same transaction", async () => {
  const hold = await openHold(["sps", "passport_renewal"]);
  const { data: laban } = await db.from("citizens").select("id").eq("id", "kz_laban").single();
  const r = await db.rpc("konza_store_decision", {
    p_app: {
      ref: `SPS-T${crypto.randomUUID().slice(0, 7).toUpperCase()}`,
      agency: "sps",
      service: "passport_renewal",
      applicant_citizen_id: laban!.id,
      subject_citizen_id: laban!.id,
      consent_id: null,
      fields: { pages: 34, receive: "collect" },
      session: "test",
    },
    p_dec: { outcome: "granted", rule_ids: ["PP-02"], reason_en: "Renewal accepted.", inputs: {} },
  });
  await clearHold(hold);
  ok(r);
  assertEquals([r.data.decision.outcome, r.data.decision.decided_by], ["pending_officer", null]);
  assertEquals(r.data.decision.inputs.held_by, [hold]);
  assertEquals(r.data.application.status, "submitted");
});

Deno.test("K3: bad input reaching the database is a 400, not an outage", async () => {
  const id = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", id, { agency: "siln", service: "primary_place" });
  // A NUL character cannot be stored in Postgres text (22xxx).
  const cargs = { subject: "QK-2041-0009", scopes: "school_application", evidence: "a\u0000b" };
  const prep = await konza("consent_record", id, cargs);
  await sleep(4200);
  const r = await konza("consent_record", id, { ...cargs, confirmation_id: prep.confirmation_id });
  assertEquals(r.error, "invalid_input");
});

Deno.test("K3: every stored decision asks the audit function to check, without waiting", async () => {
  const id = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const since = new Date().toISOString();
  const args = { fields_json: JSON.stringify({ pages: 34, receive: "collect" }) };
  const prep = await konza("application_submit", id, args);
  await sleep(4200);
  const app = await konza("application_submit", id, {
    ...args,
    confirmation_id: prep.confirmation_id,
  });
  assert(app.decision_id, JSON.stringify(app));
  let runs = 0;
  for (let i = 0; i < 20 && !runs; i++) {
    await sleep(500);
    const { count } = await db.from("konza_audit_events").select("id", {
      count: "exact",
      head: true,
    })
      .eq("operation", "checkerRun").gt("at", since);
    runs = count ?? 0;
  }
  assert(runs > 0, "the checker ran after the decision");
});

Deno.test("K3: a checker that is down never blocks; the failure is in the audit log", async () => {
  Deno.env.set("SUPABASE_URL", API);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", local.SERVICE_ROLE_KEY);
  Deno.env.set("AUDIT_SECRET", "x");
  Deno.env.set("AUDIT_URL", "http://127.0.0.1:9/unreachable");
  const { notifyChecker } = await import("../supabase/functions/tools/konza/checker.ts");
  const rid = crypto.randomUUID();
  await notifyChecker(rid);
  const { data } = await db.from("konza_audit_events").select("outcome").eq("request_id", rid);
  assertEquals(data?.map((e) => e.outcome), ["refused:unreachable"]);
});

// ---------- K3 payments and desks (MED-282, MED-294) ----------

/** A SIA call on the browser channel: dry-run texts land in handset_inbox, where tests read them. */
async function browserCall(citizenId: string, agoMs = 0) {
  const id = await startedCall(citizenId, agoMs, KONZA);
  ok(await db.from("conversations").update({ channel: "browser" }).eq("id", id));
  return id;
}
const twice = async (id: string, tool: string, args: Record<string, unknown>) => {
  const prep = await konza(tool, id, args);
  if (!prep.needs_confirmation) return prep;
  await sleep(4200);
  return await konza(tool, id, { ...args, confirmation_id: prep.confirmation_id });
};
async function grantedPassport(id: string, pages = 34) {
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const app = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ pages, receive: "collect" }),
  });
  assertEquals(app.outcome, "granted", JSON.stringify(app));
  return app;
}
async function payAtDesk(applicationId: string, amount_kes: number) {
  const r = await officer("/desk/payments", {
    application_id: applicationId,
    amount_kes,
    desk: "konza_passport_desk",
  });
  assertEquals(r.status, 201, JSON.stringify(r.json));
}
async function codeFrom(id: string) {
  const { data } = await db.from("handset_inbox").select("body").eq("conversation_id", id)
    .order("at", { ascending: false }).limit(1);
  const m = String(data?.[0]?.body ?? "").match(/code: (\d{6})/);
  assert(m, JSON.stringify(data));
  assert(!data![0].body.includes("DEMO"));
  return m[1];
}
const officer = (path: string, body: unknown) =>
  fetch(`${API}/functions/v1/tools/konza/v1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-officer-secret": "local-officer-secret",
      "x-konza-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

Deno.test("K3 PY-01: pay by phone code; wrong code, then right; no second charge", async () => {
  const id = await browserCall("kz_laban");
  const app = await grantedPassport(id);
  // K5 (MED-301): the prepare reads back the rules total and payee in both languages.
  const pprep = await konza("payment_request", id, { amount: 7550 });
  assertEquals(pprep.needs_confirmation, true, JSON.stringify(pprep));
  assert(pprep.readback.en.includes("7,550 shillings"), pprep.readback.en);
  assert(pprep.readback.sw.includes("shilingi elfu saba mia tano na hamsini"), pprep.readback.sw);
  const wrongAmount = await twice(id, "payment_request", { amount: 1 });
  assertEquals(wrongAmount.error, "amount_mismatch", JSON.stringify(wrongAmount));
  const req = await twice(id, "payment_request", { amount: 7550 });
  assertEquals(req.status, "pending", JSON.stringify(req));
  const code = await codeFrom(id);
  const bad = await konza("payment_confirm", id, { code: code === "000000" ? "111111" : "000000" });
  assertEquals([bad.wrong_code, bad.tries_left], [true, 2]);
  const good = await konza("payment_confirm", id, { code });
  assertEquals(good.status, "approved");
  // Used once: confirming again changes nothing, and this application is never charged twice
  // (a new request moves on to another unpaid application, if any).
  assertEquals((await konza("payment_confirm", id, { code })).status, "approved");
  await twice(id, "payment_request", { amount: 7550 });
  const { data: ref } = await db.from("konza_applications").select("ref").eq(
    "id",
    app.application_id,
  )
    .single();
  const { data: charged } = await db.from("payments").select("status").eq("case_ref", ref!.ref);
  assertEquals(charged?.map((p) => p.status), ["approved"]);
});

Deno.test("K3 PY-01: three wrong codes decline; an expired prompt cannot be approved", async () => {
  const id = await browserCall("kz_laban");
  await grantedPassport(id, 50);
  await twice(id, "payment_request", { amount: 9550 });
  for (let i = 0; i < 2; i++) await konza("payment_confirm", id, { code: "000001" });
  assertEquals((await konza("payment_confirm", id, { code: "000001" })).status, "declined");
  const id2 = await browserCall("kz_laban");
  await grantedPassport(id2, 66);
  await twice(id2, "payment_request", { amount: 12050 });
  const code = await codeFrom(id2);
  ok(
    await db.from("payments").update({ code_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("conversation_id", id2),
  );
  assertEquals((await konza("payment_confirm", id2, { code })).status, "expired");
});

Deno.test("K3 PY-01: paying needs identity checked in the last 5 minutes", async () => {
  const id = await browserCall("kz_laban", 6 * 60_000);
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  assertEquals((await konza("payment_request", id, { amount: 7550 })).error, "step_up");
  assertEquals((await konza("payment_confirm", id, { code: "123456" })).error, "step_up");
});

Deno.test("K3 DK-01: a desk document counts only for the person it is about", async () => {
  const tumaini = await officer("/desk/documents", {
    resident: "QK-2041-0003",
    presented_by: "QK-2041-0036",
    doc_type: "birth_certificate",
    result: "accepted",
    desk: "lango_square",
  });
  const imani = await officer("/desk/documents", {
    resident: "QK-2041-0009",
    presented_by: "QK-2041-0036",
    doc_type: "birth_certificate",
    result: "accepted",
    desk: "lango_square",
  });
  assertEquals([tumaini.status, imani.status], [201, 201]);
  const id = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", id, { agency: "siln", service: "primary_place" });
  const base = { subject: "QK-2041-0009", scopes: "school_application" };
  assertEquals(
    (await twice(id, "consent_record", { ...base, evidence: tumaini.json.evidence_id })).error,
    "evidence_not_valid",
  );
  const c = await twice(id, "consent_record", { ...base, evidence: imani.json.evidence_id });
  assertEquals(c.subject, "QK-2041-0009", JSON.stringify(c));
});

Deno.test("K3 DK-02: collection needs no address; passports only at the Konza Passport Desk", async () => {
  const id = await browserCall("kz_laban");
  const app = await grantedPassport(id);
  // Earlier tests booked deliveries to this address; clear them so the address can go.
  ok(await db.from("deliveries").delete().eq("citizen_id", "kz_laban"));
  ok(await db.from("addresses").delete().eq("citizen_id", "kz_laban"));
  const base = { item_kind: "passport", application_id: app.application_id, window: "morning" };
  // Nothing is handed over before the fee is paid (MED-296).
  assertEquals(
    (await twice(id, "delivery_book", { ...base, method: "collect" })).error,
    "not_paid",
  );
  await payAtDesk(app.application_id, 7550);
  assertEquals(
    (await twice(id, "delivery_book", { ...base, method: "collect" })).error,
    "appointment_first",
  );
  const bio = await twice(id, "appointment_book", { application_id: app.application_id, window: "morning" });
  // This renewal chose collection when applying (AD-04): home delivery is not on offer.
  assertEquals((await twice(id, "delivery_book", base)).error, "receive_chosen");
  const d = await twice(id, "delivery_book", { ...base, method: "collect" });
  assertEquals([d.method, d.desk, d.fee_kes], ["collect", "the Konza Passport Desk", 0]);
  // MED-331: collection from the ready date, never the biometrics day.
  assertEquals(d.deliver_on, bio.ready_by);
  assert(d.deliver_on > bio.on_date);
});

// ---------- K3 passport scene on SPS (MED-284, MED-291) ----------

Deno.test("K3 passport scene: quote, apply, pay by code, biometrics, collect, receipt; the checker agrees", async () => {
  const anon = await startedCall(null, 0, KONZA);
  await konza("service_open", anon, { agency: "sps", service: "passport_renewal" });
  assertEquals((await konza("rules_lookup", anon, { topic: "fees" })).values.fees_kes["50"], 9550);

  const id = await browserCall("kz_laban");
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  assertEquals((await konza("rules_lookup", id, { topic: "renewal" })).values.open, true);
  const app = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ pages: 50, receive: "collect" }),
  });
  assertEquals([app.outcome, app.decided_by], ["granted", "rule"], JSON.stringify(app));
  // Biometrics only after paying.
  assertEquals(
    (await konza("appointment_book", id, { application_id: app.application_id, window: "morning" }))
      .error,
    "not_paid",
  );
  await twice(id, "payment_request", { amount: 9550, deliver: "sms" });
  assertEquals(
    (await konza("payment_confirm", id, { code: await codeFrom(id) })).status,
    "approved",
  );
  const bioPrep = await konza("appointment_book", id, {
    application_id: app.application_id,
    window: "morning",
  });
  assert(
    bioPrep.readback.sw.includes("asubuhi, kati ya saa mbili na saa sita"),
    bioPrep.readback.sw,
  );
  assert(bioPrep.readback.items.some((i: any) => i.kind === "date"));
  const bio = await twice(id, "appointment_book", {
    application_id: app.application_id,
    window: "morning",
  });
  assertEquals(
    [bio.kind, bio.desk],
    ["biometrics", "the Konza Passport Desk"],
    JSON.stringify(bio),
  );
  assert(bio.ready_by > bio.on_date);
  const col = await twice(id, "delivery_book", {
    item_kind: "passport",
    application_id: app.application_id,
    window: "afternoon",
    method: "collect",
  });
  assertEquals([col.desk, col.fee_kes], ["the Konza Passport Desk", 0]);
  const why = await konza("decision_explain", id, { decision_id: app.decision_id });
  assert(why.rule_ids.includes("PP-02") && why.review, JSON.stringify(why));

  // The receipt SMS (no "DEMO" since MED-340): sender, reference, payment, biometrics,
  // collection, the review route.
  const sent = await konza("send_message", id, {});
  assertEquals(sent.sent, true, JSON.stringify(sent));
  const { data: inbox } = await db.from("handset_inbox").select("body").eq("conversation_id", id)
    .order("at", { ascending: false }).limit(1);
  const body = String(inbox?.[0]?.body);
  for (
    const part of [
      "SIA: ",
      "Paid KES 9,550",
      "Biometrics",
      "Collect",
      "Aminia",
      `/r/${app.decision_id}`,
    ]
  ) {
    assert(body.includes(part), `${part} missing: ${body}`);
  }

  // The checker's own recomputation agrees with this decision (C5), and nothing needs a hold.
  const { check } = await import("../audit/checks.ts");
  const { snapshot } = await import("../audit/snapshot.ts");
  const findings = check(await asAudit(snapshot)).filter((f) => f.ref === app.decision_id);
  assertEquals(findings, []);
});

// ---------- K3 scenes (MED-283, MED-287 to MED-290) ----------

const deskDoc = async (resident: string, doc_type: string, presented_by = resident) => {
  const r = await officer("/desk/documents", {
    resident,
    presented_by,
    doc_type,
    result: "accepted",
    desk: "lango_square",
  });
  assertEquals(r.status, 201, JSON.stringify(r.json));
  return r.json.evidence_id as string;
};

Deno.test("K3 SIA gate: only SIA's tools, and service tools only after service_open", async () => {
  const id = await startedCall("kz_laban", 0, KONZA);
  for (const t of ["capability_enter", "calendar_email", "permit_lookup", "payment_get_status"]) {
    assert((await konza(t, id, {})).error, `${t} must be refused on SIA`);
  }
  assertEquals((await konza("send_message", id, {})).error, "wrong_service");
  assertEquals((await konza("rules_lookup", id, { topic: "fees" })).error, "wrong_service");
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  assertEquals((await konza("rules_lookup", id, { topic: "fees" })).topic, "fees");
});

Deno.test("K3 arrival (SRR): address with a Lango Square tenancy, card collected; a child by a parent; a wrong document goes to an officer", async () => {
  const id = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", id, { agency: "srr", service: "address_registration" });
  const tenancy = await deskDoc("QK-2041-0039", "tenancy");
  const addr = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ evidence: tenancy }),
  });
  assertEquals([addr.outcome, addr.decided_by], ["granted", "rule"], JSON.stringify(addr));
  const card = await twice(id, "delivery_book", {
    item_kind: "resident_card",
    application_id: addr.application_id,
    window: "morning",
    method: "collect",
  });
  assertEquals([card.desk, card.fee_kes], ["Lango Square", 0]);
  // Neema's tenancy is not Laban's: an officer looks, nothing is refused by rule.
  const other = await deskDoc("QK-2041-0036", "tenancy");
  const wrong = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ evidence: other }),
  });
  assertEquals([wrong.outcome, wrong.decided_by], ["pending_officer", null]);

  const mum = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", mum, { agency: "srr", service: "child_registration" });
  const cert = await deskDoc("QK-2041-0003", "birth_certificate", "QK-2041-0036");
  const child = { fields_json: JSON.stringify({ evidence: cert }), on_behalf_of: "QK-2041-0003" };
  assertEquals((await konza("application_submit", mum, child)).error, "consent_required");
  await twice(mum, "consent_record", { subject: "QK-2041-0003", scopes: "registration" });
  const reg = await twice(mum, "application_submit", child);
  assertEquals([reg.outcome, reg.decided_by], ["granted", "rule"], JSON.stringify(reg));
});

Deno.test("K3 health cover (SCA): contribution paid by code makes cover active; a child added with consent", async () => {
  const id = await browserCall("kz_neema");
  await konza("service_open", id, { agency: "sca", service: "contribution" });
  assertEquals((await konza("rules_lookup", id, { topic: "cover_status" })).values.active, false);
  const month = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
  assertEquals(
    (await konza("application_submit", id, {
      fields_json: JSON.stringify({ amount_kes: 200, month }),
    })).error,
    "bad_fields",
  );
  const c = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ amount_kes: 500, month }),
  });
  assertEquals(c.outcome, "granted", JSON.stringify(c));
  await twice(id, "payment_request", { amount: 500 });
  assertEquals(
    (await konza("payment_confirm", id, { code: await codeFrom(id) })).status,
    "approved",
  );
  assertEquals((await konza("rules_lookup", id, { topic: "cover_status" })).values.active, true);

  await konza("service_open", id, { agency: "sca", service: "dependant" });
  const cert = await deskDoc("QK-2041-0009", "birth_certificate", "QK-2041-0036");
  const dep = { fields_json: JSON.stringify({ evidence: cert }), on_behalf_of: "QK-2041-0009" };
  assertEquals((await konza("application_submit", id, dep)).error, "consent_required");
  await twice(id, "consent_record", { subject: "QK-2041-0009", scopes: "health_cover" });
  const added = await twice(id, "application_submit", dep);
  assertEquals([added.outcome, added.decided_by], ["granted", "rule"], JSON.stringify(added));
});

Deno.test("K3 business (SCO): name check, registration with a tax number, fee, permit; a government-sounding name goes to an officer", async () => {
  const anon = await startedCall(null, 0, KONZA);
  await konza("service_open", anon, { agency: "sco", service: "business_registration" });
  const chk = await konza("rules_lookup", anon, {
    topic: "name_check",
    inputs_json: JSON.stringify({ name: "Konza Solar" }),
  });
  assertEquals(chk.values?.reserved, true, JSON.stringify(chk));

  const id = await browserCall("kz_laban");
  await konza("service_open", id, { agency: "sco", service: "business_registration" });
  const name = `Njoroge Solar Repairs ${crypto.randomUUID().slice(0, 4)}`;
  const reg = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ name, type: "business_name" }),
  });
  assertEquals([reg.outcome, reg.decided_by], ["granted", "rule"], JSON.stringify(reg));
  await twice(id, "payment_request", { amount: 950 });
  assertEquals(
    (await konza("payment_confirm", id, { code: await codeFrom(id) })).status,
    "approved",
  );
  const gov = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ name: "Konza Government Solar", type: "business_name" }),
  });
  assertEquals([gov.outcome, gov.decided_by], ["pending_officer", null]);

  await konza("service_open", id, { agency: "sco", service: "trading_permit" });
  const permit = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ business_ref: reg.ref }),
  });
  assertEquals([permit.outcome, permit.decided_by], ["granted", "rule"], JSON.stringify(permit));
});

Deno.test("K3 school (SILN): documents from Lango Square, full school to an officer, a review asked; a non-guardian refused", async () => {
  const id = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", id, { agency: "siln", service: "primary_place" });
  await twice(id, "consent_record", { subject: "QK-2041-0009", scopes: "school_application" });
  const docs = [
    await deskDoc("QK-2041-0009", "birth_certificate", "QK-2041-0036"),
    await deskDoc("QK-2041-0009", "immunisation_card", "QK-2041-0036"),
  ];
  const full = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ preferred_school_id: "z3_primary", documents: docs }),
    on_behalf_of: "QK-2041-0009",
  });
  assertEquals([full.outcome, full.decided_by], ["pending_officer", null], JSON.stringify(full));
  const decided = await fetch(
    `${API}/functions/v1/tools/konza/v1/decisions/${full.decision_id}/officer-decision`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-officer-secret": "local-officer-secret",
        "x-konza-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        outcome: "offered_alternative",
        reason_en: "Zone 3 Primary is full; Zone 3 North has space.",
        officer: "OF-3",
      }),
    },
  );
  assertEquals(decided.status, 200, await decided.text());
  const review = await twice(id, "review_request", {
    decision_id: full.decision_id,
    grounds: "We live next to Zone 3 Primary.",
  });
  assert(review.id && review.answer_by, JSON.stringify(review));
  // Imani cannot consent for her sister: only a recorded parent or guardian can.
  const kid = await startedCall("kz_imani", 0, KONZA);
  await konza("service_open", kid, { agency: "siln", service: "primary_place" });
  assertEquals(
    (await konza("consent_record", kid, { subject: "QK-2041-0003", scopes: "school_application" }))
      .error,
    "not_guardian",
  );
});

// ---------- K3 security review fixes (MED-296) ----------

Deno.test("MED-296: the biometrics check is about this application, not the newest unpaid one", async () => {
  const id = await browserCall("kz_laban");
  const older = await grantedPassport(id, 34);
  await grantedPassport(id, 50);
  assertEquals(
    (await konza("appointment_book", id, {
      application_id: older.application_id,
      window: "morning",
    })).error,
    "not_paid",
  );
  // The older one can be paid by its reference, and then booked.
  const { data } = await db.from("konza_applications").select("ref").eq("id", older.application_id)
    .single();
  await twice(id, "payment_request", { amount: 7550, reference: data!.ref });
  assertEquals(
    (await konza("payment_confirm", id, { code: await codeFrom(id) })).status,
    "approved",
  );
  const bio = await twice(id, "appointment_book", {
    application_id: older.application_id,
    window: "morning",
  });
  assertEquals(bio.kind, "biometrics", JSON.stringify(bio));
});

Deno.test("MED-296: a fee paid at the desk while a code prompt waits is not taken twice", async () => {
  const id = await browserCall("kz_laban");
  const app = await grantedPassport(id, 66);
  await twice(id, "payment_request", { amount: 12050 });
  const code = await codeFrom(id);
  await payAtDesk(app.application_id, 12050);
  const late = await konza("payment_confirm", id, { code });
  assert(["expired"].includes(late.status), JSON.stringify(late));
  const { data: ref } = await db.from("konza_applications").select("ref").eq(
    "id",
    app.application_id,
  ).single();
  const { data: paid } = await db.from("payments").select("method").eq("case_ref", ref!.ref).eq(
    "status",
    "approved",
  );
  assertEquals(paid?.map((p) => p.method), ["desk"]);
});

Deno.test("MED-296: a resident cannot add themselves as a dependant", async () => {
  const id = await startedCall("kz_laban", 0, KONZA);
  await deskDoc("QK-2041-0039", "birth_certificate");
  await konza("service_open", id, { agency: "sca", service: "dependant" });
  const self = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ evidence: "desk" }),
  });
  assertEquals([self.outcome, self.decided_by], ["pending_officer", null], JSON.stringify(self));
});

Deno.test("MED-297: on a new call, biometrics is booked without the application id", async () => {
  const first = await browserCall("kz_laban");
  const app = await grantedPassport(first, 34);
  await payAtDesk(app.application_id, 7550);
  const later = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", later, { agency: "sps", service: "passport_renewal" });
  const bio = await twice(later, "appointment_book", { window: "afternoon" });
  assertEquals(
    [bio.kind, bio.desk],
    ["biometrics", "the Konza Passport Desk"],
    JSON.stringify(bio),
  );
  const none = await startedCall("kz_tumaini", 0, KONZA);
  await konza("service_open", none, { agency: "sps", service: "passport_renewal" });
  assertEquals(
    (await konza("appointment_book", none, { window: "morning" })).error,
    "no_application",
  );
});

Deno.test("MED-298: a parent names the child; a review is asked on a new call without the id", async () => {
  const id = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", id, { agency: "siln", service: "primary_place" });
  const c = await twice(id, "consent_record", { subject: "Imani", scopes: "school_application" });
  assertEquals(c.subject, "QK-2041-0009", JSON.stringify(c));
  const app = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ preferred_school_id: "z3_north" }),
    on_behalf_of: "imani",
  });
  assert(app.outcome, JSON.stringify(app));
  // A name that is not one of her own children never resolves to anyone else.
  assertEquals(
    (await konza("consent_record", id, { subject: "Laban", scopes: "school_application" })).error,
    "unknown_subject",
  );
  // A later call: review the newest decided decision without giving its id.
  const later = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", later, { agency: "siln", service: "primary_place" });
  const rv = await twice(later, "review_request", {
    grounds: "We live next to Zone 3 Primary School.",
  });
  assert(rv.id || rv.error === "not_decided", JSON.stringify(rv));
});

// ---------- MED-299: from Mahs's passport calls ----------

Deno.test("MED-299: renewal is said in words; the rules need no identity; status and receipt on a later call", async () => {
  const anon = await startedCall(null, 0, KONZA);
  await konza("service_open", anon, { agency: "sps", service: "passport_renewal" });
  const rules = await konza("rules_lookup", anon, { topic: "renewal_rules" });
  assertEquals(rules.values.pages_left_matter, false);

  const first = await browserCall("kz_laban");
  const app = await grantedPassport(first, 50);
  await payAtDesk(app.application_id, 9550);
  const later = await browserCall("kz_laban");
  await konza("service_open", later, { agency: "sps", service: "passport_renewal" });
  const renewal = await konza("rules_lookup", later, { topic: "renewal" });
  assert(renewal.reason_en.startsWith("Renewal is open now"), renewal.reason_en);
  const mine = await konza("rules_lookup", later, { topic: "my_application" });
  assertEquals([mine.values.has_application, mine.values.paid, mine.values.owed_kes], [
    true,
    true,
    0,
  ], JSON.stringify(mine));
  const sent = await konza("send_message", later, {});
  assertEquals(sent.sent, true, JSON.stringify(sent));
});

Deno.test("MED-299: biometrics on a chosen working day, then moved; a weekend is refused", async () => {
  const first = await browserCall("kz_laban");
  const app = await grantedPassport(first, 66);
  await payAtDesk(app.application_id, 12050);
  const later = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", later, { agency: "sps", service: "passport_renewal" });
  // The first two days the rules offer: working days, so public holidays are skipped too (the
  // naive weekday walk picks Mashujaa Day, 20 Oct).
  const days = appointmentDays(todayIn("Africa/Nairobi")).slice(0, 2);
  const saturday = (() => {
    const d = new Date(Date.now() + 3 * 3_600_000);
    d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
    return d.toISOString().slice(0, 10);
  })();
  assertEquals(
    (await konza("appointment_book", later, { window: "morning", on_date: saturday })).error,
    "bad_day",
  );
  const bio = await twice(later, "appointment_book", { window: "morning", on_date: days[1] });
  assertEquals(
    [bio.on_date, bio.hours, bio.moved],
    [days[1], "8 to 12", false],
    JSON.stringify(bio),
  );
  const moved = await twice(later, "appointment_book", { window: "afternoon", on_date: days[1] });
  assertEquals([moved.window, moved.moved], ["afternoon", true], JSON.stringify(moved));
});

Deno.test("K5 (MED-302): call_ended keeps one read-back result per commit and no transcript text", async () => {
  const id = await startedCall("kz_laban", 0, KONZA);
  const cid = crypto.randomUUID();
  const readback = {
    en: "Pay 7,550 shillings.",
    sw: "Lipa shilingi elfu saba mia tano na hamsini.",
    items: [{
      kind: "amount",
      value: 7550,
      spoken_en: "7,550 shillings",
      spoken_sw: "shilingi elfu saba mia tano na hamsini",
    }],
  };
  const turn = (role: string, message: string, extra: Record<string, unknown> = {}) => ({
    role,
    message,
    time_in_call_secs: 1,
    ...extra,
  });
  const transcript = [
    turn("agent", "Shall I go ahead?", {
      tool_results: [{
        tool_name: "application_submit",
        result_value: JSON.stringify({ needs_confirmation: true, confirmation_id: cid, readback }),
      }],
    }),
    turn("user", "Yes, my secret note QK-9999"),
    turn("agent", "Done.", {
      tool_calls: [{
        tool_name: "application_submit",
        params_as_json: JSON.stringify({ confirmation_id: cid }),
      }],
    }),
  ];
  const res = await fetch(`${API}/functions/v1/tools/call_ended`, {
    method: "POST",
    headers: { "x-tool-secret": "local-postcall-secret", "content-type": "application/json" },
    body: JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: id, transcript, metadata: { call_duration_secs: 30 } },
    }),
  });
  assertEquals(res.status, 200);
  await res.json();
  const { data } = await db.from("konza_audit_events").select("*").eq("session", id)
    .like("operation", "readBack:%");
  assertEquals(
    data!.map((e) => [e.operation, e.outcome, e.reason]),
    [["readBack:application_submit", "missed", "no amount"]],
  );
  assert(!JSON.stringify(data).includes("QK-9999"));
});

// ---------- K6 the Audit Office's own role (MED-306) ----------

Deno.test("K6: SIA's backend cannot open a hold or write a finding; the Audit Office can", async () => {
  const hold = { agency: "sps", service: "passport_renewal", rule_id: "PP-09", finding: "test" };
  assert((await db.from("konza_holds").insert({ ...hold, opened_by: "mirror_vale" })).error);
  assert(
    (await db.from("konza_findings").insert({
      run_id: crypto.randomUUID(),
      check: "C1",
      code: "x",
      severity: "info",
    })).error,
  );
  const id = await insertHold(hold);
  await clearHold(id);
});

Deno.test("K6: mirror_vale reads only the checker's columns and writes nothing else", async () => {
  await asAudit(async (sql) => {
    const refused = async (q: () => Promise<unknown>, what: string) => {
      try {
        await q();
      } catch {
        return;
      }
      throw new Error(`mirror_vale could ${what}`);
    };
    // Reads what the snapshot needs.
    await sql`select id, dob from citizens limit 1`;
    await sql`select id, amount, status from payments limit 1`;
    // Not names, code hashes or applications' writes.
    await refused(() => sql`select full_name from citizens limit 1`, "read names");
    await refused(() => sql`select code_hash from payments limit 1`, "read code hashes");
    await refused(() => sql`select * from sms_log limit 1`, "read the SMS log");
    await refused(
      () => sql`update konza_decisions set outcome = 'granted' where false`,
      "change a decision",
    );
    await refused(
      () =>
        sql`insert into konza_audit_events (request_id, client, operation, charter, outcome)
          values ('x', 'sia', 'fake', 'acts_alone', 'ok')`,
      "write an event as SIA",
    );
    await refused(
      () =>
        sql`insert into konza_holds (agency, service, rule_id, finding, opened_by)
          values ('sps', 'passport_renewal', 'PP-08', 'x', 'someone_else')`,
      "open a hold in another name",
    );
    // Findings are append-only, for every role.
    const [f] = await sql`insert into konza_findings (run_id, "check", code, severity)
      values (${crypto.randomUUID()}, 'C1', 'test', 'info') returning id`;
    await refused(() => sql`delete from konza_findings where id = ${f.id}`, "delete a finding");
  });
  assert((await db.from("konza_findings").delete().gte("id", 0)).error, "service role deletes");
});

Deno.test("K6: a checker run as mirror_vale records every finding and logs the run", async () => {
  const requestId = crypto.randomUUID();
  const res = await fetch(`${API}/functions/v1/audit`, {
    method: "POST",
    headers: { "x-audit-secret": "local-audit-secret", "content-type": "application/json" },
    body: JSON.stringify({ request_id: requestId }),
  });
  assertEquals(res.status, 200, await res.clone().text());
  const body = await res.json();
  const total = Object.values(body.findings ?? {}).reduce((a: number, n) => a + Number(n), 0);
  const { count } = await db.from("konza_findings").select("id", { count: "exact", head: true })
    .eq("run_id", requestId);
  assertEquals(count, total);
  const { data: run } = await db.from("konza_audit_events").select("client")
    .eq("operation", "checkerRun").eq("request_id", requestId).single();
  assertEquals(run!.client, "mirror_vale");
});

// ---------- K6 receipts and payment lows (MED-311) ----------

Deno.test("K6: the panel role cannot read code hashes; it still reads the rest", async () => {
  const sql = connect(local.DB_URL);
  try {
    await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select id, amount, status, code_tries from payments limit 1`;
      let refused = false;
      try {
        await tx.savepoint((sp) => sp`select code_hash from payments limit 1`);
      } catch {
        refused = true;
      }
      assert(refused, "the panel role read code_hash");
    });
  } finally {
    await sql.end({ timeout: 0 });
  }
});

Deno.test("K6: two wrong codes at the same moment both count", async () => {
  const { data: pay, error } = await db.from("payments").insert({
    conversation_id: `k6-wrong-${crypto.randomUUID().slice(0, 8)}`,
    amount: 100,
    currency: "KES",
    reference: "TEST",
  }).select("id").single();
  ok({ error });
  const both = await Promise.all(
    [1, 2].map(() => db.rpc("payment_wrong_code", { payment: pay!.id, max_tries: 3 })),
  );
  both.forEach(ok);
  const { data } = await db.from("payments").select("code_tries, status").eq("id", pay!.id)
    .single();
  assertEquals([data!.code_tries, data!.status], [2, "pending"]);
  const third = await db.rpc("payment_wrong_code", { payment: pay!.id, max_tries: 3 });
  assertEquals(third.data, [{ code_tries: 3, status: "declined" }]);
  assertEquals((await db.rpc("payment_wrong_code", { payment: pay!.id, max_tries: 3 })).data, []);
});

// ---------- K6 status outside passports (MED-312) ----------

Deno.test("K6: a parent asks about the child's school place on a later call; no one else sees it", async () => {
  const id = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", id, { agency: "siln", service: "primary_place" });
  await twice(id, "consent_record", { subject: "Imani", scopes: "school_application" });
  const app = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ preferred_school_id: "z3_north" }),
    on_behalf_of: "imani",
  });
  const later = await startedCall("kz_neema", 0, KONZA);
  await konza("service_open", later, { agency: "siln", service: "primary_place" });
  const mine = await konza("rules_lookup", later, { topic: "my_application" });
  assertEquals(
    [mine.values.has_application, mine.values.outcome],
    [true, app.outcome],
    JSON.stringify(mine),
  );
  assert(mine.reason_en.includes(app.reason ?? ""), mine.reason_en);
  // Another resident has no school application of their own, and never sees this one.
  const other = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", other, { agency: "siln", service: "primary_place" });
  const theirs = await konza("rules_lookup", other, { topic: "my_application" });
  assertEquals(theirs.values.has_application, false, JSON.stringify(theirs));
});

// ---------- K8 S2 screen taps (MED-330, plan-k8 2.4 and 2.5) ----------

const UI_ACT_SECRET = "local-ui-act-secret";
const act = (body: Record<string, unknown>, secret = UI_ACT_SECRET) =>
  fetch(`${API}/functions/v1/tools/ui/act`, {
    method: "POST",
    headers: { "x-ui-act-secret": secret, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
const passportArgs = { fields_json: JSON.stringify({ pages: 34, receive: "collect" }) };

/** A SIA browser call with a passport application prepared, as the resident's screen shows it. */
async function shownCard(citizenId = "kz_laban") {
  const id = await browserCall(citizenId);
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const prep = await konza("application_submit", id, passportArgs);
  assertEquals(prep.needs_confirmation, true, JSON.stringify(prep));
  const { data } = await db.from("confirmations").select("ui_tool, args, shown_hash")
    .eq("id", prep.confirmation_id).single();
  assertEquals(data!.ui_tool, "application_submit");
  assert(data!.shown_hash, "the shown card's hash is recorded at emit");
  return { id, confirmationId: prep.confirmation_id as string, hash: data!.shown_hash as string };
}
const tap = (c: { id: string; confirmationId: string; hash: string }, conversationId = c.id) =>
  act({
    conversation_id: conversationId,
    action: "confirm",
    confirmation_id: c.confirmationId,
    shown_hash: c.hash,
  });
const stored = async (confirmationId: string) =>
  (await db.from("confirmations").select("result, committed_via").eq("id", confirmationId)
    .single()).data!;
const applications = async () =>
  (await db.from("konza_applications").select("id", { count: "exact", head: true })
    .eq("applicant_citizen_id", "kz_laban")).count ?? 0;

Deno.test("K8 S2: service_open and the prepare emit progress and a confirm card with its hash", async () => {
  const card = await shownCard();
  const { data } = await db.from("ui_events").select("seq, kind, payload")
    .eq("conversation_id", card.id).order("seq");
  assertEquals(data!.map((e) => e.seq), data!.map((_, i) => i + 1), "seq counts from 1, no gaps");
  assertEquals(data![0].kind, "progress");
  const confirm = data!.find((e) => e.kind === "confirm");
  assertEquals(confirm?.payload.shown_hash, card.hash);
  assertEquals(confirm?.payload.confirmation_id, card.confirmationId);
});

Deno.test("K8 S2: the act route takes only its own secret, never TOOL_SECRET", async () => {
  const card = await shownCard();
  const body = {
    conversation_id: card.id,
    action: "confirm",
    confirmation_id: card.confirmationId,
    shown_hash: card.hash,
  };
  assertEquals((await act(body, "wrong")).status, 403);
  assertEquals((await act(body, SECRET)).status, 403);
  assertEquals((await stored(card.confirmationId)).result, null);
});

Deno.test("K8 S2: a confirm with the wrong shown_hash is refused and audited; nothing is committed", async () => {
  const card = await shownCard();
  const before = await applications();
  await sleep(4200);
  const r = await tap({ ...card, hash: "0".repeat(64) });
  assertEquals([r.status, r.json.error], [409, "card_changed"]);
  assertEquals((await stored(card.confirmationId)).result, null);
  assertEquals(await applications(), before);
  const { data } = await db.from("audit_log").select("action, result").eq("conversation_id", card.id);
  assert(data!.some((a) => /card changed/.test(a.action) && a.result === "warn"), JSON.stringify(data));
});

Deno.test("K8 S2: a tap within 4 s is refused, the same tap later commits once; a double tap gets the stored result", async () => {
  const card = await shownCard();
  const before = await applications();
  const fast = await tap(card);
  assertEquals(fast.json.error, "confirmation_invalid", JSON.stringify(fast.json));
  assertEquals((await stored(card.confirmationId)).result, null);
  await sleep(4200);
  const first = await tap(card);
  assertEquals([first.status, first.json.outcome, first.json.already_done], [200, "granted", undefined]);
  assertEquals((await stored(card.confirmationId)).committed_via, "screen");
  const second = await tap(card);
  assertEquals([second.json.already_done, second.json.application_id], [true, first.json.application_id]);
  assertEquals(await applications(), before + 1, "one application, not two");
  const receipts = await db.from("ui_events").select("kind").eq("conversation_id", card.id)
    .eq("kind", "receipt");
  assertEquals(receipts.data!.length, 1, "one receipt on screen");
});

Deno.test("K8 S2: a tap then the agent's commit, and the agent then a tap, both return the stored result", async () => {
  const a = await shownCard();
  await sleep(4200);
  const tapped = await tap(a);
  assertEquals(tapped.json.outcome, "granted", JSON.stringify(tapped.json));
  const agent = await konza("application_submit", a.id, { ...passportArgs, confirmation_id: a.confirmationId });
  assertEquals([agent.already_done, agent.application_id], [true, tapped.json.application_id]);

  const b = await shownCard();
  await sleep(4200);
  const spoken = await konza("application_submit", b.id, { ...passportArgs, confirmation_id: b.confirmationId });
  assertEquals(spoken.outcome, "granted", JSON.stringify(spoken));
  assertEquals((await stored(b.confirmationId)).committed_via, "voice");
  const late = await tap(b);
  assertEquals([late.json.already_done, late.json.application_id], [true, spoken.application_id]);
});

Deno.test("K8 S2: session A cannot act on B's card, and a phone call has no screen to act on", async () => {
  const a = await shownCard("kz_laban");
  const b = await shownCard("kz_neema");
  await sleep(4200);
  const cross = await tap(b, a.id);
  assertEquals([cross.status, cross.json.error], [404, "unknown_confirmation"]);
  const refreshB = await act({ conversation_id: a.id, action: "refresh", confirmation_id: b.confirmationId });
  assertEquals(refreshB.status, 404);
  assertEquals((await stored(b.confirmationId)).result, null);
  // A phone call never gets screen events, so it has nothing to tap.
  const phone = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", phone, { agency: "sps", service: "passport_renewal" });
  const prep = await konza("application_submit", phone, passportArgs);
  const { count } = await db.from("ui_events").select("id", { count: "exact", head: true })
    .eq("conversation_id", phone);
  assertEquals(count, 0);
  const onPhone = await tap({ id: phone, confirmationId: prep.confirmation_id, hash: "x" });
  assertEquals([onPhone.status, onPhone.json.error], [404, "unknown_conversation"]);
});

Deno.test("K8 S2: Refresh prepares again with a new id and a new hash; the old card is untouched", async () => {
  const card = await shownCard();
  const r = await act({ conversation_id: card.id, action: "refresh", confirmation_id: card.confirmationId });
  assertEquals([r.status, r.json.needs_confirmation], [200, true], JSON.stringify(r.json));
  assert(r.json.confirmation_id !== card.confirmationId, "a new confirmation");
  const { data } = await db.from("confirmations").select("shown_hash")
    .eq("id", r.json.confirmation_id).single();
  assert(data!.shown_hash && data!.shown_hash !== card.hash, "a new hash");
  assertEquals((await stored(card.confirmationId)).result, null);
  await sleep(4200);
  const done = await tap({ id: card.id, confirmationId: r.json.confirmation_id, hash: data!.shown_hash });
  assertEquals(done.json.outcome, "granted", JSON.stringify(done.json));
});

Deno.test("K8 S2: browsers cannot read, insert or append ui_events; the service role cannot rewrite them", async () => {
  const card = await shownCard();
  const sql = connect(local.DB_URL);
  try {
    for (const role of ["anon", "authenticated"]) {
      await sql.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        for (
          const q of [
            `select * from ui_events limit 1`,
            `insert into ui_events (conversation_id, seq, kind, payload) values ('x', 1, 'progress', '{}')`,
            `select * from ui_event_append('x', 'progress', '{}')`,
          ]
        ) {
          let refused = false;
          try {
            await tx.savepoint((sp) => sp.unsafe(q));
          } catch {
            refused = true;
          }
          assert(refused, `${role}: ${q}`);
        }
      });
    }
  } finally {
    await sql.end({ timeout: 0 });
  }
  assert((await db.from("ui_events").update({ kind: "receipt" }).eq("conversation_id", card.id)).error, "update");
  assert((await db.from("ui_events").delete().eq("conversation_id", card.id)).error, "delete");
});

// ---------- K8 S2 cards (MED-331) ----------

const events = async (id: string) =>
  (await db.from("ui_events").select("seq, kind, payload").eq("conversation_id", id).order("seq")).data!;
const railOf = (e: { payload: any }) => Object.fromEntries(e.payload.steps.map((s: any) => [s.id, s.state]));

Deno.test("K8 S2 (MED-331): service_open shows the rail (recorded steps only) and the form", async () => {
  await handOverPassports();
  const id = await browserCall("kz_laban");
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const [rail, form] = await events(id);
  assertEquals(rail.kind, "progress");
  // The rail is where Laban is in the service: his latest renewal from any earlier call counts.
  const { count } = await db.from("konza_applications").select("id", { count: "exact", head: true })
    .eq("subject_citizen_id", "kz_laban").eq("service", "passport_renewal");
  assertEquals(railOf(rail).identity, "done");
  assertEquals(railOf(rail).confirm, count ? "done" : "todo");
  assertEquals(rail.payload.updated.source.en, "Identity check");
  assertEquals(form.kind, "form");
  assert(form.payload.fields.some((f: any) => f.name === "pages" && f.label.en), JSON.stringify(form.payload));
});

Deno.test("MED-331: no form while the resident's renewal is in progress (the core would refuse it)", async () => {
  await handOverPassports();
  const id = await browserCall("kz_laban");
  await grantedPassport(id);
  const again = await browserCall("kz_laban");
  await konza("service_open", again, { agency: "sps", service: "passport_renewal" });
  assertEquals((await events(again)).map((e) => e.kind), ["progress"]);
});

Deno.test("K8 S2 (MED-331): a commit turns the shown card done, then the rail, then the receipt", async () => {
  const card = await shownCard();
  await sleep(4200);
  const before = (await events(card.id)).length;
  const r = await tap(card);
  assertEquals(r.json.outcome, "granted", JSON.stringify(r.json));
  const after = (await events(card.id)).slice(before);
  assertEquals(after.map((e) => e.kind), ["confirm", "progress", "receipt"]);
  assertEquals([after[0].payload.confirmation_id, after[0].payload.state], [card.confirmationId, "done"]);
  assertEquals(railOf(after[1]), { identity: "done", confirm: "done", decision: "done" });
  assertEquals(after[1].payload.updated.source.en, "A published rule");
});

Deno.test("K8 S2 (MED-331): the form card prepares; the agent's yes with only the id commits what the card showed", async () => {
  const id = await browserCall("kz_laban");
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  await handOverPassports();
  const prep = await act({ conversation_id: id, action: "form_submit", fields: { pages: 34, receive: "collect" } });
  assertEquals([prep.status, prep.json.needs_confirmation], [200, true], JSON.stringify(prep.json));
  const shown = (await events(id)).filter((e) => e.kind === "confirm").at(-1)!;
  assertEquals(shown.payload.confirmation_id, prep.json.confirmation_id);
  await sleep(4200);
  // The agent never sees the form values; it says yes with the id only, and even different
  // arguments commit exactly what the card showed.
  const yes = await konza("application_submit", id, {
    fields_json: JSON.stringify({ pages: 66, receive: "home" }),
    confirmation_id: prep.json.confirmation_id,
  });
  assertEquals(yes.outcome, "granted", JSON.stringify(yes));
  const { data } = await db.from("konza_applications").select("fields").eq("id", yes.application_id).single();
  assertEquals([data!.fields.pages, data!.fields.receive], [34, "collect"]);
  assertEquals((await stored(prep.json.confirmation_id)).committed_via, "voice");
  const bad = await act({ conversation_id: id, action: "form_submit", fields: [] });
  assertEquals(bad.status, 400);
});

Deno.test("K8 S2 (MED-331): the identity card's code verifies the conversation; a wrong code counts", async () => {
  const id = await startedCall(null, 0, KONZA);
  ok(await db.from("conversations").update({ channel: "browser" }).eq("id", id));
  const noCode = await act({ conversation_id: id, action: "identity_code", code: "123456" });
  assertEquals([noCode.status, noCode.json.error], [404, "unknown_verification"]);
  // As in a real call: the service is open first, so the gate acts as the agency; the code
  // still comes from SIA, never "NJIA".
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const start = await konza("identity_start_otp", id, { id_number: "QK-2041-0039", date_of_birth: "1987-04-12" });
  assertEquals(start.code_sent, true, JSON.stringify(start));
  assertEquals((await events(id)).at(-1)!.kind, "identity");
  const { data: sms } = await db.from("handset_inbox").select("body").eq("conversation_id", id);
  assert(String(sms!.at(-1)!.body).startsWith("SIA: your code is"), sms!.at(-1)!.body);
  const code = String(sms!.at(-1)!.body).match(/\b(\d{6})\b/)![1];
  const wrong = await act({ conversation_id: id, action: "identity_code", code: code === "000000" ? "111111" : "000000" });
  assertEquals([wrong.status, wrong.json.error, wrong.json.attempts_left], [409, "wrong_code", 2]);
  const right = await act({ conversation_id: id, action: "identity_code", code });
  assertEquals(right.json.verified, true, JSON.stringify(right.json));
  const { data } = await db.from("conversations").select("citizen_id, verified_at").eq("id", id).single();
  assertEquals(data!.citizen_id, "kz_laban");
  assert(data!.verified_at);
  const [card, rail] = (await events(id)).slice(-2);
  assertEquals([card.kind, card.payload.step], ["identity", "verified"]);
  assertEquals([rail.kind, railOf(rail).identity, rail.payload.updated.source.en], ["progress", "done", "Identity check"]);
});

Deno.test("K8 S2 (MED-331): shown, tap and screen commit are audited with matching hashes; C8 counts the tap", async () => {
  const card = await shownCard();
  await sleep(4200);
  assertEquals((await tap(card)).json.outcome, "granted");
  const { data: rows } = await db.from("konza_audit_events").select("operation, outcome, reason, request_hash")
    .eq("request_id", card.confirmationId).order("id");
  assertEquals(rows!.map((r) => [r.operation, r.outcome, r.reason]), [
    ["uiShown:application_submit", "shown", "screen"],
    ["uiTap:application_submit", "accepted", "screen"],
    ["uiCommit:application_submit", "committed", "screen"],
  ]);
  // C10 holds on a real commit: the arguments hash at commit equals the one recorded when shown.
  assertEquals(rows![2].request_hash, rows![0].request_hash);
  assertEquals(rows![1].request_hash, card.hash);
  // The Audit Office can read the two columns C10 needs, and still not the free text.
  await asAudit(async (sql) => {
    const r = await sql`select request_id, request_hash from konza_audit_events where request_id = ${card.confirmationId}`;
    assertEquals(r.length, 3);
    let refused = false;
    try {
      await sql`select reason from konza_audit_events limit 1`;
    } catch {
      refused = true;
    }
    assert(refused, "mirror_vale must not read reason");
  });
  // After the call: the tap is the read-back and yes (C8 ok), even though nobody said yes.
  const res = await fetch(`${API}/functions/v1/tools/call_ended`, {
    method: "POST",
    headers: { "x-tool-secret": "local-postcall-secret", "content-type": "application/json" },
    body: JSON.stringify({
      type: "post_call_transcription",
      data: { conversation_id: card.id, metadata: { call_duration_secs: 60 }, transcript: [] },
    }),
  });
  assertEquals(res.status, 200, await res.clone().text());
  await res.body?.cancel();
  const { data: rb } = await db.from("konza_audit_events").select("outcome, reason")
    .eq("session", card.id).eq("operation", "readBack:application_submit");
  assertEquals(rb, [{ outcome: "ok", reason: "screen" }]);
});

Deno.test("MED-331: one passport renewal at a time; a new one only once the passport is handed over", async () => {
  await handOverPassports();
  const id = await startedCall("kz_laban", 0, KONZA);
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const args = { fields_json: JSON.stringify({ pages: 34, receive: "collect" }) };
  const first = await twice(id, "application_submit", args);
  assertEquals(first.outcome, "granted", JSON.stringify(first));
  // The tool directly (not the konza helper, which hands passports over first).
  const again = await call("application_submit", id, { ...args, fields_json: JSON.stringify({ pages: 50, receive: "home" }) }, KONZA);
  assertEquals(again.error, "application_open", JSON.stringify(again));
  assert(String(again.message ?? "").includes("my_application"), JSON.stringify(again));
  const { count } = await db.from("confirmations").select("id", { count: "exact", head: true })
    .eq("conversation_id", id).is("committed_at", null);
  assertEquals(count, 0, "nothing was prepared for the second one");
  // On a screen too: the form tap is refused the same way, and no confirm card is shown.
  ok(await db.from("conversations").update({ channel: "browser" }).eq("id", id));
  const tapped = await act({ conversation_id: id, action: "form_submit", fields: { pages: 66, receive: "collect" } });
  assertEquals([tapped.status, tapped.json.error], [409, "application_open"]);
  // Once the new passport is handed over, a later renewal can be applied for.
  await handOverPassports();
  const later = await call("application_submit", id, args, KONZA);
  assertEquals(later.needs_confirmation, true, JSON.stringify(later));
});

Deno.test("MED-331: the collection card is titled for collection; the renewal reason says the date in words", async () => {
  const id = await browserCall("kz_laban");
  const app = await grantedPassport(id);
  await payAtDesk(app.application_id, 7550);
  await twice(id, "appointment_book", { application_id: app.application_id, window: "morning" });
  const prep = await konza("delivery_book", id, {
    item_kind: "passport",
    application_id: app.application_id,
    window: "morning",
    method: "collect",
  });
  assertEquals(prep.needs_confirmation, true, JSON.stringify(prep));
  const card = (await db.from("ui_events").select("payload").eq("conversation_id", id).eq("kind", "confirm")
    .order("seq", { ascending: false }).limit(1).single()).data!;
  assertEquals(card.payload.title.en, "Confirm collection");
  const renewal = await konza("rules_lookup", id, { topic: "renewal" });
  assert(!/\d{4}-\d{2}-\d{2}/.test(renewal.reason_en), renewal.reason_en);
  assert(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2} \w+ \d{4}\b/.test(renewal.reason_en), renewal.reason_en);
});

Deno.test("MED-331: the decision card shows the application reference; a code-approved payment its transaction reference", async () => {
  const id = await browserCall("kz_laban");
  const app = await grantedPassport(id);
  const { data: a } = await db.from("konza_applications").select("ref").eq("id", app.application_id).single();
  const last = async (kind: string) =>
    (await db.from("ui_events").select("payload").eq("conversation_id", id).eq("kind", kind)
      .order("seq", { ascending: false }).limit(1).single()).data!.payload;
  assertEquals((await last("receipt")).ref, a!.ref);
  await twice(id, "payment_request", { amount: 7550 });
  const good = await konza("payment_confirm", id, { code: await codeFrom(id) });
  assertEquals(good.status, "approved", JSON.stringify(good));
  const paid = await last("payment");
  assertEquals([paid.state, paid.amount_kes, paid.reference], ["approved", 7550, good.txn_code]);
});

// ---------- K8 S4 payment card (MED-332, plan-k8 2.10) ----------

/** A resident app conversation (/sia): a browser call bound to a resident session. */
async function residentCall(citizenId: string) {
  const id = await browserCall(citizenId);
  ok(
    await db.from("handset_tokens").insert({
      token_hash: crypto.randomUUID(),
      agent_id: KONZA,
      expires_at: new Date(Date.now() + 180_000).toISOString(),
      used_at: new Date().toISOString(),
      conversation_id: id,
      session_hash: crypto.randomUUID(),
      session_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  );
  return id;
}

/** A contribution granted and its payment started on the screen: the card offers the methods. */
async function payingOnScreen(citizenId = "kz_neema") {
  const id = await residentCall(citizenId);
  await konza("service_open", id, { agency: "sca", service: "contribution" });
  const month = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
  const c = await twice(id, "application_submit", { fields_json: JSON.stringify({ amount_kes: 500, month }) });
  assertEquals(c.outcome, "granted", JSON.stringify(c));
  const prep = await konza("payment_request", id, { amount: 500 });
  assert(/payment card/.test(prep.readback?.en ?? ""), "the read-back names the card, not an SMS prompt");
  await sleep(4200);
  const pay = await konza("payment_request", id, { amount: 500, confirmation_id: prep.confirmation_id });
  assertEquals([pay.status, pay.on_screen], ["pending", true], JSON.stringify(pay));
  const card = (await events(id)).filter((e) => e.kind === "payment").at(-1)!;
  assertEquals(card.payload.state, "choose");
  const methods = card.payload.methods as { method_id: string; type: string; masked: string }[];
  assertEquals(methods.map((m) => m.type).sort(), ["card", "mobile_money"]);
  return { id, paymentId: pay.payment_id as string, methods };
}

Deno.test("MED-332: mobile money on screen: the PIN typed on the card approves it; a wrong PIN counts", async () => {
  const { id, paymentId, methods } = await payingOnScreen();
  const momo = methods.find((m) => m.type === "mobile_money")!;
  // Nothing is texted for mobile money, and the agent cannot approve it with anything said aloud.
  const chose = await act({ conversation_id: id, action: "pay_method", payment_id: paymentId, method_id: momo.method_id });
  assertEquals([chose.status, chose.json.method], [200, "mobile_money"], JSON.stringify(chose.json));
  assertEquals((await events(id)).filter((e) => e.kind === "payment").at(-1)!.payload.state, "pin");
  assertEquals((await konza("payment_confirm", id, { code: DEMO_MOMO_PIN })).error, "pin_on_screen");
  const wrong = await act({ conversation_id: id, action: "pay_pin", pin: "0000" });
  assertEquals([wrong.json.wrong_pin, wrong.json.tries_left], [true, 2], JSON.stringify(wrong.json));
  const paid = await act({ conversation_id: id, action: "pay_pin", pin: DEMO_MOMO_PIN });
  assertEquals(paid.json.status, "approved", JSON.stringify(paid.json));
  const card = (await events(id)).filter((e) => e.kind === "payment").at(-1)!;
  assertEquals(card.payload.state, "approved");
  assert(/^KZP/.test(card.payload.reference), JSON.stringify(card.payload));
  assertEquals((await konza("rules_lookup", id, { topic: "cover_status" })).values.active, true);
  // The PIN is nowhere: not in the payment row, the audit or the events.
  const { data: row } = await db.from("payments").select("*").eq("id", paymentId).single();
  const { data: logs } = await db.from("audit_log").select("*").eq("conversation_id", id);
  for (const blob of [row, logs, await events(id)]) {
    assert(!JSON.stringify(blob).includes(DEMO_MOMO_PIN), "the PIN is not stored or logged");
  }
});

Deno.test("MED-332: a card on screen: the texted code, typed on the card or read aloud, approves it", async () => {
  const { id, paymentId, methods } = await payingOnScreen();
  const card = methods.find((m) => m.type === "card")!;
  const chose = await act({ conversation_id: id, action: "pay_method", payment_id: paymentId, method_id: card.method_id });
  assertEquals(chose.json.method, "card", JSON.stringify(chose.json));
  assertEquals((await events(id)).filter((e) => e.kind === "payment").at(-1)!.payload.state, "code");
  const code = await codeFrom(id);
  const typed = await act({ conversation_id: id, action: "pay_code", code });
  assertEquals(typed.json.status, "approved", JSON.stringify(typed.json));
  // Read aloud instead, on another payment: the agent's payment_confirm takes the same code.
  const other = await payingOnScreen("kz_laban");
  const lc = other.methods.find((m) => m.type === "card")!;
  await act({ conversation_id: other.id, action: "pay_method", payment_id: other.paymentId, method_id: lc.method_id });
  assertEquals((await konza("payment_confirm", other.id, { code: await codeFrom(other.id) })).status, "approved");
});

Deno.test("MED-332 (16 Oct): in the resident app, deliver pesa still shows the payment card", async () => {
  // Asked for mobile money, Savannah sent deliver pesa: the KE PIN simulator's payment, never shown.
  const id = await residentCall("kz_neema");
  await konza("service_open", id, { agency: "sca", service: "contribution" });
  const month = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
  await twice(id, "application_submit", { fields_json: JSON.stringify({ amount_kes: 500, month }) });
  const pay = await twice(id, "payment_request", { amount: 500, deliver: "pesa" });
  assertEquals([pay.status, pay.on_screen], ["pending", true], JSON.stringify(pay));
  assertEquals((await db.from("payments").select("method").eq("id", pay.payment_id).single()).data!.method, "screen");
  assertEquals((await events(id)).filter((e) => e.kind === "payment").at(-1)!.payload.state, "choose");
});

Deno.test("Plan-k8 2.12: the card chosen by voice texts one code, the code read back pays once; a tap after it changes nothing", async () => {
  const { id, paymentId, methods } = await payingOnScreen();
  const card = methods.find((m) => m.type === "card")!;
  const said = await konza("payment_confirm", id, { method: "card" });
  assertEquals([said.status, said.method, said.payment_id], ["pending", "card", paymentId], JSON.stringify(said));
  assertEquals((await events(id)).filter((e) => e.kind === "payment").at(-1)!.payload.state, "code");
  const tapped = await act({ conversation_id: id, action: "pay_method", payment_id: paymentId, method_id: card.method_id });
  assertEquals(tapped.json.already_chosen, true, JSON.stringify(tapped.json));
  const { data: texts } = await db.from("handset_inbox").select("body").eq("conversation_id", id);
  assertEquals((texts ?? []).filter((t) => /card payment/.test(t.body)).length, 1, "one code texted");
  assertEquals((await konza("payment_confirm", id, { code: await codeFrom(id) })).status, "approved");
  const { count } = await db.from("payments").select("id", { count: "exact", head: true })
    .eq("conversation_id", id).eq("status", "approved");
  assertEquals(count, 1, "paid once");
  const { data: logs } = await db.from("audit_log").select("action").eq("conversation_id", id);
  assert((logs ?? []).some((l) => /Card chosen by voice/.test(l.action)), JSON.stringify(logs));
});

Deno.test("Plan-k8 2.12: mobile money by voice shows the PIN box, a spoken PIN is still refused; no card waiting is refused; step-up applies", async () => {
  const { id } = await payingOnScreen();
  // An identity check older than 5 minutes: a fresh code first, as for a tap.
  ok(await db.from("conversations").update({ verified_at: new Date(Date.now() - 6 * 60_000).toISOString() }).eq("id", id));
  assertEquals((await konza("payment_confirm", id, { method: "mobile_money" })).error, "step_up");
  ok(await db.from("conversations").update({ verified_at: new Date().toISOString() }).eq("id", id));
  const said = await konza("payment_confirm", id, { method: "mobile_money" });
  assertEquals([said.status, said.method], ["pending", "mobile_money"], JSON.stringify(said));
  assertEquals((await events(id)).filter((e) => e.kind === "payment").at(-1)!.payload.state, "pin");
  assertEquals((await konza("payment_confirm", id, { code: DEMO_MOMO_PIN })).error, "pin_on_screen");
  // A call with no payment card at all.
  const none = await residentCall("kz_neema");
  await konza("service_open", none, { agency: "sca", service: "contribution" });
  assertEquals((await konza("payment_confirm", none, { method: "card" })).error, "no_payment");
});

Deno.test("MED-332 (16 Oct): a double tap on Pay texts one code, and that code still approves", async () => {
  const { id, paymentId, methods } = await payingOnScreen();
  const card = methods.find((m) => m.type === "card")!;
  const momo = methods.find((m) => m.type === "mobile_money")!;
  const tapPay = (method_id: string) => act({ conversation_id: id, action: "pay_method", payment_id: paymentId, method_id });
  // Two taps in the same instant, then a late one for the other method: one choice, one code.
  const both = await Promise.all([tapPay(card.method_id), tapPay(card.method_id)]);
  assertEquals(both.map((r) => r.json.status), ["pending", "pending"], JSON.stringify(both.map((r) => r.json)));
  assertEquals(both.filter((r) => r.json.already_chosen).length, 1, JSON.stringify(both.map((r) => r.json)));
  const late = await tapPay(momo.method_id);
  assertEquals([late.json.method, late.json.already_chosen], ["card", true], JSON.stringify(late.json));
  const { data: texts } = await db.from("handset_inbox").select("body").eq("conversation_id", id);
  assertEquals((texts ?? []).filter((t) => /card payment/.test(t.body)).length, 1, "one code texted");
  assertEquals((await act({ conversation_id: id, action: "pay_code", code: await codeFrom(id) })).json.status, "approved");
  const { count } = await db.from("payments").select("id", { count: "exact", head: true })
    .eq("conversation_id", id).eq("status", "approved");
  assertEquals(count, 1, "paid once");
});

Deno.test("MED-332: the payment card refuses another resident's method, an unchosen method and a held session", async () => {
  const { id, paymentId, methods } = await payingOnScreen();
  assertEquals((await konza("payment_confirm", id, { code: "123456" })).error, "choose_method");
  const { data: lab } = await db.from("payment_methods").select("id").eq("citizen_id", "kz_laban").limit(1).single();
  const foreign = await act({ conversation_id: id, action: "pay_method", payment_id: paymentId, method_id: lab!.id });
  assertEquals(foreign.json.error, "unknown_method", JSON.stringify(foreign.json));
  // A PIN before mobile money was chosen.
  assertEquals((await act({ conversation_id: id, action: "pay_pin", pin: DEMO_MOMO_PIN })).json.error, "no_payment");
  // After an identity concern nothing more is paid on this session.
  await konza("create_case", id, { type: "identity_concern", summary: "test", priority: "routine" });
  const held = await act({
    conversation_id: id,
    action: "pay_method",
    payment_id: paymentId,
    method_id: methods.find((m) => m.type === "mobile_money")!.method_id,
  });
  assertEquals(held.status, 409, JSON.stringify(held.json));
  assert(!held.json.method, JSON.stringify(held.json));
});

Deno.test("C5 (13 Oct): a health cover contribution records every amount its reason quotes, so no hold opens", async () => {
  const since = new Date().toISOString();
  await payingOnScreen("kz_laban");
  // The audit function runs after each decision without being waited for.
  await sleep(3000);
  const { data } = await db.from("konza_holds").select("finding").eq("agency", "sca").gte("opened_at", since);
  assertEquals(data, [], "no checker hold after a contribution grant");
});

Deno.test("MED-332: after the fee is paid on screen, the slots card books biometrics through a confirm", async () => {
  await handOverPassports();
  const id = await residentCall("kz_laban");
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const app = await twice(id, "application_submit", passportArgs);
  assertEquals(app.outcome, "granted", JSON.stringify(app));
  const prep = await konza("payment_request", id, { amount: 7550 });
  await sleep(4200);
  const pay = await konza("payment_request", id, { amount: 7550, confirmation_id: prep.confirmation_id });
  const card = (await db.from("payment_methods").select("id").eq("citizen_id", "kz_laban").eq("type", "card").single()).data!;
  await act({ conversation_id: id, action: "pay_method", payment_id: pay.payment_id, method_id: card.id });
  assertEquals((await act({ conversation_id: id, action: "pay_code", code: await codeFrom(id) })).json.status, "approved");
  // Paid: the slots card follows, with the days the rules accept.
  const slots = (await events(id)).filter((e) => e.kind === "slots").at(-1)!;
  assert(slots, "a slots card after the payment");
  const day = slots.payload.days[2].date as string;
  // A day outside the rules is refused; a listed day prepares appointment_book and its confirm card.
  assertEquals((await act({ conversation_id: id, action: "slot_pick", date: "2026-01-01", window: "morning" })).json.error, "bad_day");
  const picked = await act({ conversation_id: id, action: "slot_pick", date: day, window: "afternoon" });
  assertEquals(picked.json.needs_confirmation, true, JSON.stringify(picked.json));
  const { data: c } = await db.from("confirmations").select("ui_tool, shown_hash").eq("id", picked.json.confirmation_id).single();
  assertEquals(c!.ui_tool, "appointment_book");
  await sleep(4200);
  const booked = await tap({ id, confirmationId: picked.json.confirmation_id, hash: c!.shown_hash });
  assertEquals([booked.json.on_date, booked.json.window], [day, "afternoon"], JSON.stringify(booked.json));
});

Deno.test("15 Oct: a business status lookup, the decision card on a status lookup, and no form for a paid month", async () => {
  // Business: the newest registration, with its reference.
  const id = await residentCall("kz_laban");
  await konza("service_open", id, { agency: "sco", service: "business_registration" });
  const reg = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ name: `Njoroge Works ${crypto.randomUUID().slice(0, 4)}`, type: "business_name" }),
  });
  const mine = await konza("rules_lookup", id, { topic: "my_application" });
  assertEquals([mine.values.has_application, mine.values.ref], [true, reg.ref], JSON.stringify(mine));
  // The decision card with that reference is on the screen.
  const receipt = (await events(id)).filter((e) => e.kind === "receipt").at(-1)!;
  assertEquals(receipt.payload.ref, reg.ref);
  // Health cover paid this month: opening the service shows no fresh form.
  const paid = await payingOnScreen("kz_neema");
  const momo = paid.methods.find((m) => m.type === "mobile_money")!;
  await act({ conversation_id: paid.id, action: "pay_method", payment_id: paid.paymentId, method_id: momo.method_id });
  assertEquals((await act({ conversation_id: paid.id, action: "pay_pin", pin: DEMO_MOMO_PIN })).json.status, "approved");
  const later = await residentCall("kz_neema");
  await konza("service_open", later, { agency: "sca", service: "contribution" });
  assertEquals((await events(later)).map((e) => e.kind), ["progress"], "rail only, no form");
});

Deno.test("AD-04 (16 Oct): a business certificate delivered home is paid with the registration fee, in one payment", async () => {
  const id = await residentCall("kz_laban");
  await konza("service_open", id, { agency: "sco", service: "business_registration" });
  const args = {
    fields_json: JSON.stringify({ name: `Kibanda ${crypto.randomUUID().slice(0, 4)}`, type: "business_name", receive: "home" }),
  };
  const prep = await konza("application_submit", id, args);
  assert(/Delivered home for 200 shillings, paid with the fee: 1,150 shillings in all/.test(prep.readback.en), prep.readback.en);
  await sleep(4200);
  const reg = await konza("application_submit", id, { ...args, confirmation_id: prep.confirmation_id });
  assertEquals(reg.outcome, "granted", JSON.stringify(reg));
  // The open charge is the fee and the delivery together: the read-back before the yes says 1,150.
  const pay = await konza("payment_request", id, { amount: 1150 });
  assert(pay.readback.items.some((i: any) => i.kind === "amount" && i.value === 1150), JSON.stringify(pay.readback));
  // No choice made means collection: home delivery is not added unpaid afterwards.
  await konza("service_open", id, { agency: "sco", service: "business_registration" });
  const plain = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ name: `Duka ${crypto.randomUUID().slice(0, 4)}`, type: "business_name" }),
  });
  await payAtDesk(plain.application_id, 950);
  const home = await konza("delivery_book", id, { item_kind: "certificate", application_id: plain.application_id, method: "home", window: "morning" });
  assertEquals(home.error, "receive_chosen", JSON.stringify(home));
});

Deno.test("AD-07 (16 Oct): collection changed to home before paying moves the charge, closes the waiting card, then pays once", async () => {
  const since = new Date().toISOString();
  const id = await residentCall("kz_laban");
  await konza("service_open", id, { agency: "sco", service: "business_registration" });
  const reg = await twice(id, "application_submit", {
    fields_json: JSON.stringify({ name: `Kiosk ${crypto.randomUUID().slice(0, 4)}`, type: "business_name", receive: "collect" }),
  });
  assertEquals(reg.outcome, "granted", JSON.stringify(reg));
  // A payment card for the old amount is waiting on the screen.
  const old = await twice(id, "payment_request", { amount: 950 });
  assertEquals([old.status, old.on_screen], ["pending", true], JSON.stringify(old));
  // The change is asked first, with the rules' total in the read-back.
  const prep = await konza("delivery_change", id, { to: "home" });
  assertEquals(prep.needs_confirmation, true, JSON.stringify(prep));
  assert(/home delivery for 200 shillings: 1,150 shillings in all/.test(prep.readback.en), prep.readback.en);
  const card = (await events(id)).filter((e) => e.kind === "confirm").at(-1)!;
  assertEquals(card.payload.title.en, "Change to home delivery");
  await sleep(4200);
  const done = await konza("delivery_change", id, { to: "home", confirmation_id: prep.confirmation_id });
  assertEquals([done.receive, done.amount_kes, done.payment_id], ["home", 1150, old.payment_id], JSON.stringify(done));
  // A repeated yes changes nothing more; the decision is untouched.
  const again = await konza("delivery_change", id, { to: "home", confirmation_id: prep.confirmation_id });
  assertEquals(again.already_done, true, JSON.stringify(again));
  const { data: rows } = await db.from("konza_receive_changes").select("to_receive").eq("application_id", reg.application_id);
  assertEquals(rows, [{ to_receive: "home" }]);
  const { data: dec } = await db.from("konza_decisions").select("inputs").eq("application_id", reg.application_id).single();
  assertEquals(dec!.inputs.delivery_kes, undefined, "the decision is not edited");
  // The old card is closed and its code would be refused; the status and the charge say 1,150.
  assertEquals((await db.from("payments").select("status").eq("id", old.payment_id).single()).data!.status, "expired");
  assertEquals((await events(id)).filter((e) => e.kind === "payment").at(-1)!.payload.state, "expired");
  const mine = await konza("rules_lookup", id, { topic: "my_application" });
  assertEquals([mine.values.owed_kes, mine.values.receive], [1150, "home"], JSON.stringify(mine));
  // The next payment reads back the new total, whatever amount is asked for.
  const next = await konza("payment_request", id, { amount: 950 });
  assert(next.readback.items.some((i: any) => i.kind === "amount" && i.value === 1150), JSON.stringify(next.readback));
  const pay = await twice(id, "payment_request", { amount: 1150 });
  const { data: method } = await db.from("payment_methods").select("id").eq("citizen_id", "kz_laban").eq("type", "card").single();
  await act({ conversation_id: id, action: "pay_method", payment_id: pay.payment_id, method_id: method!.id });
  assertEquals((await act({ conversation_id: id, action: "pay_code", code: await codeFrom(id) })).json.status, "approved");
  // Paid: no more changes here, and delivery_book keeps the changed choice.
  assertEquals((await konza("delivery_change", id, { to: "collect" })).error, "already_paid");
  // (Only the refusal is checked: an earlier test, DK-02, removes Laban's address.)
  assertEquals((await konza("delivery_book", id, { item_kind: "certificate", method: "collect", window: "morning" })).error, "receive_chosen");
  const { count } = await db.from("payments").select("id", { count: "exact", head: true })
    .eq("case_ref", reg.ref).eq("status", "approved");
  assertEquals(count, 1, "paid once");
  // The checker opens no hold for it (C5 reads the decision, which is unchanged).
  await sleep(3000);
  assertEquals((await db.from("konza_holds").select("finding").eq("agency", "sco").gte("opened_at", since)).data, []);
});

Deno.test("AD-07 (16 Oct): a passport's home delivery changed to collection drops the KES 200; the same choice is refused", async () => {
  await handOverPassports();
  const id = await residentCall("kz_laban");
  await konza("service_open", id, { agency: "sps", service: "passport_renewal" });
  const app = await twice(id, "application_submit", { fields_json: JSON.stringify({ pages: 34, receive: "home" }) });
  assertEquals(app.outcome, "granted", JSON.stringify(app));
  const { data: dec } = await db.from("konza_decisions").select("inputs").eq("application_id", app.application_id).single();
  const fee = dec!.inputs.fee_kes as number;
  assertEquals((await konza("rules_lookup", id, { topic: "my_application" })).values.owed_kes, fee + 200);
  assertEquals((await konza("delivery_change", id, { to: "home" })).error, "same_choice");
  const done = await twice(id, "delivery_change", { to: "collect" });
  assertEquals([done.receive, done.amount_kes], ["collect", fee], JSON.stringify(done));
  const mine = await konza("rules_lookup", id, { topic: "my_application" });
  assertEquals([mine.values.owed_kes, mine.values.receive], [fee, "collect"], JSON.stringify(mine));
  const pay = await konza("payment_request", id, { amount: fee });
  assert(pay.readback.items.some((i: any) => i.kind === "amount" && i.value === fee), JSON.stringify(pay.readback));
});

Deno.test("MED-333: a child's form waits for the identity check, names the child, and asks the parent's consent first", async () => {
  const id = await startedCall(null, 0, KONZA);
  ok(await db.from("conversations").update({ channel: "browser" }).eq("id", id));
  await konza("service_open", id, { agency: "sca", service: "dependant" });
  assertEquals((await events(id)).filter((e) => e.kind === "form").length, 0, "no form before the identity check");
  // The suite's earlier codes reach the daily code limits (per resident, per caller and 50 in all,
  // session.ts) by the time this test runs: move them out of the 24 hours counted.
  ok(
    await db.from("verifications").update({ created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() })
      .gt("created_at", new Date(Date.now() - 86_400_000).toISOString()),
  );
  const start = await konza("identity_start_otp", id, { id_number: "QK-2041-0036", date_of_birth: "1990-06-20" });
  assertEquals(start.code_sent, true, JSON.stringify(start));
  const { data: sms } = await db.from("handset_inbox").select("body").eq("conversation_id", id);
  const code = String(sms!.at(-1)!.body).match(/\b(\d{6})\b/)![1];
  assertEquals((await act({ conversation_id: id, action: "identity_code", code })).json.verified, true);
  // Verified: the form names the children on record by first name, and the document is a choice.
  const form = (await events(id)).filter((e) => e.kind === "form").at(-1)!;
  const fields = form.payload.fields as { name: string; options?: { value: string; label: { en: string } }[] }[];
  assertEquals(fields[0].name, "on_behalf_of");
  assertEquals(fields[0].options!.map((o) => o.label.en).sort(), ["Imani", "Tumaini"]);
  assertEquals(fields.find((f) => f.name === "evidence")!.options!.map((o) => o.value), ["desk"]);
  // No consent yet for Tumaini: the form tap prepares the consent, a consent card.
  ok(
    await db.from("delegation_consents").update({ withdrawn_at: new Date().toISOString() })
      .eq("grantor_citizen_id", "kz_neema").eq("subject_citizen_id", "kz_tumaini").is("withdrawn_at", null),
  );
  // Tumaini's birth certificate is the seed's (accepted at Lango Square), so "desk" finds it.
  const values = { on_behalf_of: "QK-2041-0003", evidence: "desk" };
  const sent = await act({ conversation_id: id, action: "form_submit", fields: values });
  assertEquals([sent.json.consent_for_form, sent.json.needs_confirmation], [true, true], JSON.stringify(sent.json));
  const consent = (await events(id)).filter((e) => e.kind === "confirm").at(-1)!;
  assertEquals([consent.payload.tool, consent.payload.variant], ["consent_record", "consent"]);
  await sleep(4200);
  const yes = await tap({ id, confirmationId: sent.json.confirmation_id, hash: consent.payload.shown_hash });
  assert(!yes.json.error, JSON.stringify(yes.json));
  // The app sends the form again: the application is prepared, its card the consent variant too.
  const again = await act({ conversation_id: id, action: "form_submit", fields: values });
  assertEquals(again.json.needs_confirmation, true, JSON.stringify(again.json));
  const app = (await events(id)).filter((e) => e.kind === "confirm").at(-1)!;
  assertEquals([app.payload.tool, app.payload.variant], ["application_submit", "consent"]);
  await sleep(4200);
  const added = await tap({ id, confirmationId: again.json.confirmation_id, hash: app.payload.shown_hash });
  assertEquals(added.json.outcome, "granted", JSON.stringify(added.json));
});

Deno.test("MED-333: the school form offers the schools; the permit form waits for the identity check and offers the resident's businesses", async () => {
  const laban = await residentCall("kz_laban");
  await konza("service_open", laban, { agency: "siln", service: "primary_place" });
  const school = (await events(laban)).filter((e) => e.kind === "form").at(-1)!;
  const sf = school.payload.fields as { name: string; options?: { value: string }[] }[];
  assert(sf.find((f) => f.name === "preferred_school_id")!.options!.length > 0, JSON.stringify(sf));
  assertEquals(sf.find((f) => f.name === "documents")!.options!.map((o) => o.value), ["desk"]);
  // Not verified: no permit form. Verified: the resident's own granted businesses, by name.
  const anon = await startedCall(null, 0, KONZA);
  ok(await db.from("conversations").update({ channel: "browser" }).eq("id", anon));
  await konza("service_open", anon, { agency: "sco", service: "trading_permit" });
  assertEquals((await events(anon)).filter((e) => e.kind === "form").length, 0);
  await konza("service_open", laban, { agency: "sco", service: "business_registration" });
  const reg = await twice(laban, "application_submit", {
    fields_json: JSON.stringify({ name: `Fundi ${crypto.randomUUID().slice(0, 4)}`, type: "business_name" }),
  });
  await konza("service_open", laban, { agency: "sco", service: "trading_permit" });
  const permit = (await events(laban)).filter((e) => e.kind === "form").at(-1)!;
  const biz = (permit.payload.fields as { name: string; options?: { value: string }[] }[])
    .find((f) => f.name === "business_ref")!;
  assert(biz.options!.some((o) => o.value === reg.ref), JSON.stringify(biz));
});
