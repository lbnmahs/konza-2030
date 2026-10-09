// Contract tests for the Konza API profile (K2, MED-267), against the LOCAL stack only.
//   supabase start
//   supabase functions serve tools --env-file tests/local.env --no-verify-jwt
//   deno task contract
// 1. The spec: valid OpenAPI 3.1, and every operation's x-konza-charter matches the core.
// 2. Every documented (operation, status) pair is exercised, and every response body validates
//    against the spec's schema for that status.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { parse } from "jsr:@std/yaml@1";
import { validate } from "npm:@readme/openapi-parser@4";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AUTHORITIES } from "../supabase/functions/_shared/authorities.ts";
import { check } from "../supabase/functions/_shared/konza/schema.ts";
import { type JsonSchema, OPERATIONS } from "../supabase/functions/_shared/konza/types.ts";
import { buildSeed, TABLE_ORDER } from "../scripts/seed/common.ts";

const status = new TextDecoder().decode(
  (await new Deno.Command("supabase", { args: ["status", "-o", "env"] }).output()).stdout,
);
const local = Object.fromEntries(
  status.split("\n").map((l) => l.match(/^(\w+)="?([^"]*)"?$/)).filter(Boolean)
    .map((m) => [m![1], m![2]]),
);
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(local.API_URL ?? "")) {
  throw new Error("contract tests only run against the local Supabase stack");
}
const BASE = `${local.API_URL}/functions/v1/tools/konza/v1`;
const db = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CLIENT_SECRET = "local-konza-client-secret";
const OFFICER_SECRET = "local-officer-secret";
const LABAN = "QK-2041-0039";
const NEEMA = "QK-2041-0036";
const IMANI = "QK-2041-0009";

const spec = parse(
  await Deno.readTextFile(new URL("../spec/konza-2030-api/openapi.yaml", import.meta.url)),
) as any;

const resolve = (ref: string): any =>
  ref.replace(/^#\//, "").split("/").reduce((o: any, k: string) => o[k], spec);
/** A response object, inline or by $ref. */
const response = (r: any) => (r.$ref ? resolve(r.$ref) : r);

// ---------- spec checks ----------

type Op = { id: string; method: string; template: string; re: RegExp; statuses: string[] };
const ops: Op[] = [];
for (const [template, item] of Object.entries<any>(spec.paths)) {
  for (const method of ["get", "post", "delete"]) {
    const op = item[method];
    if (!op) continue;
    ops.push({
      id: op.operationId,
      method: method.toUpperCase(),
      template,
      re: new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`),
      statuses: Object.keys(op.responses),
    });
  }
}

Deno.test("spec: OpenAPI 3.1 with every operation carrying the core's charter level", async () => {
  assertEquals(spec.openapi, "3.1.0");
  const v = await validate(new URL("../spec/konza-2030-api/openapi.yaml", import.meta.url).pathname);
  assert(v.valid, JSON.stringify(v));
  assertEquals(ops.map((o) => o.id).sort(), Object.keys(OPERATIONS).sort());
  for (const [template, item] of Object.entries<any>(spec.paths)) {
    for (const method of ["get", "post", "delete"]) {
      const op = item[method];
      if (!op) continue;
      assertEquals(op["x-konza-charter"], OPERATIONS[op.operationId], op.operationId);
      for (const r of Object.values<any>(op.responses)) {
        assert(response(r)?.content, `${template} ${JSON.stringify(r)}`);
      }
    }
  }
  // never_acts operations accept only an officer credential.
  for (const item of Object.values<any>(spec.paths)) {
    for (const op of Object.values<any>(item)) {
      if (op?.["x-konza-charter"] === "never_acts") {
        assert(!JSON.stringify(op.security ?? spec.security).includes("sharedClient"));
      }
    }
  }
});

// ---------- calls ----------

const covered = new Set<string>();

async function api(
  method: string,
  path: string,
  o: {
    body?: unknown;
    resident?: string;
    onBehalfOf?: string;
    session?: string;
    auth?: "client" | "officer" | "agent" | "none";
    client?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-konza-request-id": crypto.randomUUID(),
    "x-konza-client": o.client ?? "contract",
  };
  const auth = o.auth ?? "client";
  if (auth === "client") headers["x-tool-secret"] = CLIENT_SECRET;
  if (auth === "officer") headers["x-officer-secret"] = OFFICER_SECRET;
  // The assistant's own tool secret is not a member credential.
  if (auth === "agent") headers["x-tool-secret"] = "local-tool-secret";
  if (o.resident) headers["x-konza-resident"] = o.resident;
  if (o.onBehalfOf) headers["x-konza-on-behalf-of"] = o.onBehalfOf;
  if (o.session) headers["x-konza-session"] = o.session;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const json = await res.json();
  const op = ops.find((x) => x.method === method && x.re.test(path));
  assert(op, `undocumented ${method} ${path}`);
  const st = String(res.status);
  assert(op.statuses.includes(st), `${op.id} returned undocumented ${st}: ${JSON.stringify(json)}`);
  const resp = response(spec.paths[op.template][method.toLowerCase()].responses[st]);
  const [ctype, content] = Object.entries<any>(resp.content)[0];
  assertEquals(res.headers.get("content-type")?.split(";")[0], ctype, `${op.id} ${st}`);
  const errors = check(content.schema as JsonSchema, json, "$", resolve);
  assertEquals(errors, [], `${op.id} ${st}: ${JSON.stringify(json)}`);
  covered.add(`${op.id} ${st}`);
  return { status: res.status, json };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ZERO = "00000000-0000-4000-8000-000000000000";

/** asks_first: prepare, wait, commit. */
async function twoStep(method: string, path: string, o: Parameters<typeof api>[2] & { body: any }) {
  const session = o.session ?? `contract-${crypto.randomUUID()}`;
  const prep = await api(method, path, { ...o, session });
  assertEquals(prep.status, 202);
  await sleep(4200);
  return await api(method, path, {
    ...o,
    session,
    body: { ...o.body, confirmation_id: prep.json.confirmation_id },
  });
}

async function reset() {
  const ok = (r: { error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
  };
  ok(await db.from("authorities").upsert(Object.values(AUTHORITIES)));
  ok(await db.rpc("demo_truncate"));
  // Holds survive demo_truncate (K4); the local test stack clears any left open, as an officer.
  ok(
    await db.from("konza_holds").update({
      cleared_at: new Date().toISOString(),
      cleared_by: "test_officer",
    })
      .is("cleared_at", null),
  );
  const { seed } = buildSeed((k) => (k === "DEMO_UK_MOBILE" ? "+447700900123" : `test-${k}`));
  for (const t of TABLE_ORDER) if (seed[t]?.length) ok(await db.from(t).insert(seed[t]));
  // A Konza resident with no address on record (getAddress 404).
  ok(
    await db.from("citizens").insert({
      id: "kz_noaddr",
      full_name: "Test Resident",
      dob: "1990-01-01",
      id_number: "QK-2041-0099",
      resident_number: "QK-2041-0099",
      phone: "+447700900123",
      preferred_language: "en",
      authority: "srr",
    }),
  );
}
await reset();

Deno.test("every documented path and status code, with responses that match the spec", async () => {
  // 401 for every operation without a credential; the officer endpoint refuses the client secret.
  for (const o of ops) {
    const path = o.template.replace("{agency}", "sps").replace("{service}", "passport_renewal")
      .replace("{id}", ZERO);
    await api(o.method, path, {
      auth: "none",
      body: o.method === "GET" || o.method === "DELETE" ? undefined : {},
    });
  }
  assertEquals(
    (await api("POST", `/decisions/${ZERO}/officer-decision`, { body: {} })).status,
    401,
  );

  assertEquals((await api("GET", "/agencies", { auth: "agent" })).status, 401);
  // A member system cannot claim the assistant's client id.
  assertEquals(
    (await api("POST", "/agencies/sps/services/passport_renewal/rules", {
      client: "sia",
      body: { topic: "fees" },
    })).status,
    400,
  );

  // Catalogue.
  assertEquals((await api("GET", "/agencies")).json.agencies.length, 5);
  await api("GET", "/agencies/sps/services/passport_renewal");
  assertEquals((await api("GET", "/agencies/sps/services/nope")).status, 404);

  // Rules.
  const fees = await api("POST", "/agencies/sps/services/passport_renewal/rules", {
    body: { topic: "fees" },
  });
  assertEquals(fees.json.values.fees_kes["50"], 9550);
  assertEquals(
    (await api("POST", "/agencies/sps/services/passport_renewal/rules", {
      body: { topic: "nope" },
    })).status,
    400,
  );
  assertEquals(
    (await api("POST", "/agencies/sps/services/passport_renewal/rules", {
      body: { topic: "renewal" },
    })).status,
    403,
  );
  assertEquals(
    (await api("POST", "/agencies/xx/services/yy/rules", { body: { topic: "fees" } })).status,
    404,
  );
  // K6 (MED-312): status outside passports needs the resident, and answers from the records.
  for (
    const [agency, service] of [
      ["siln", "primary_place"],
      ["sca", "contribution"],
      ["sca", "dependant"],
      ["srr", "address_registration"],
      ["srr", "child_registration"],
    ]
  ) {
    const path = `/agencies/${agency}/services/${service}/rules`;
    assertEquals((await api("POST", path, { body: { topic: "my_application" } })).status, 403);
    const mine = await api("POST", path, { resident: LABAN, body: { topic: "my_application" } });
    assertEquals(typeof mine.json.values.has_application, "boolean", `${path}`);
  }

  // Applications: Laban's passport (granted by rule), Neema's (no passport: pending an officer).
  const app = "/agencies/sps/services/passport_renewal/applications";
  assertEquals(
    (await api("POST", app, {
      resident: LABAN,
      session: "s1",
      body: { fields: { pages: 35, receive: "home" } },
    })).status,
    400,
  );
  assertEquals(
    (await api("POST", app, { body: { fields: { pages: 34, receive: "home" } } })).status,
    403,
  );
  assertEquals(
    (await api("POST", "/agencies/xx/services/yy/applications", {
      resident: LABAN,
      body: { fields: {} },
    })).status,
    404,
  );
  assertEquals(
    (await api("POST", app, {
      resident: LABAN,
      session: "s2",
      body: { fields: { pages: 34, receive: "home" }, confirmation_id: ZERO },
    })).status,
    409,
  );
  const granted = await twoStep("POST", app, {
    resident: LABAN,
    body: { fields: { pages: 34, receive: "home" } },
  });
  assertEquals([granted.status, granted.json.decision.decided_by], [201, "rule"]);
  const pending = await twoStep("POST", app, {
    resident: NEEMA,
    body: { fields: { pages: 34, receive: "collect" } },
  });
  assertEquals(pending.json.decision.outcome, "pending_officer");

  await api("GET", `/applications/${granted.json.id}`, { resident: LABAN });
  assertEquals(
    (await api("GET", `/applications/${granted.json.id}`, { resident: NEEMA })).status,
    403,
  );
  assertEquals((await api("GET", `/applications/${ZERO}`, { resident: LABAN })).status, 404);
  const dg = granted.json.decision.id;
  const dp = pending.json.decision.id;
  await api("GET", `/decisions/${dg}`, { resident: LABAN });
  assertEquals((await api("GET", `/decisions/${dg}`, { resident: NEEMA })).status, 403);
  assertEquals((await api("GET", `/decisions/${ZERO}`, { resident: LABAN })).status, 404);

  // Officer decisions (never_acts).
  const od = `/decisions/${dp}/officer-decision`;
  assertEquals(
    (await api("POST", od, {
      auth: "officer",
      body: { outcome: "approve", reason_en: "Checked in person.", officer: "OF-7" },
    })).status,
    400,
  );
  assertEquals(
    (await api("POST", `/decisions/${ZERO}/officer-decision`, {
      auth: "officer",
      body: { outcome: "granted", reason_en: "Checked in person.", officer: "OF-7" },
    })).status,
    404,
  );
  assertEquals(
    (await api("POST", `/decisions/${dg}/officer-decision`, {
      auth: "officer",
      body: { outcome: "refused", reason_en: "Trying to change it.", officer: "OF-7" },
    })).status,
    409,
  );

  // Appeals: not before an officer decides (409), not someone else's (403), grounds needed (400).
  const appeal = (id: string) => `/decisions/${id}/appeals`;
  assertEquals(
    (await api("POST", appeal(dp), {
      resident: NEEMA,
      session: "s3",
      body: { grounds: "I need it." },
    })).status,
    409,
  );
  const refused = await api("POST", od, {
    auth: "officer",
    body: { outcome: "refused", reason_en: "No passport on record to renew.", officer: "OF-7" },
  });
  assertEquals([refused.json.outcome, refused.json.decided_by], ["refused", "officer"]);
  assertEquals(
    (await api("POST", appeal(dp), { resident: LABAN, session: "s4", body: { grounds: "x" } }))
      .status,
    403,
  );
  assertEquals(
    (await api("POST", appeal(ZERO), { resident: NEEMA, session: "s5", body: { grounds: "x" } }))
      .status,
    404,
  );
  assertEquals(
    (await api("POST", appeal(dp), { resident: NEEMA, session: "s6", body: { grounds: "" } }))
      .status,
    400,
  );
  const ap = await twoStep("POST", appeal(dp), {
    resident: NEEMA,
    body: { grounds: "My passport is at home; I can bring it." },
  });
  assertEquals([ap.status, ap.json.status], [201, "received"]);

  // Consents.
  assertEquals(
    (await api("POST", "/consents", {
      resident: NEEMA,
      session: "s7",
      body: { subject: IMANI, scopes: [] },
    })).status,
    400,
  );
  assertEquals(
    (await api("POST", "/consents", {
      resident: NEEMA,
      session: "s8",
      body: { subject: LABAN, scopes: ["school_application"] },
    })).status,
    403,
  );
  assertEquals(
    (await api("POST", "/consents", {
      resident: NEEMA,
      session: "s9",
      body: { subject: "QK-9999-9999", scopes: ["x"] },
    })).status,
    404,
  );
  assertEquals(
    (await api("POST", "/consents", {
      resident: NEEMA,
      session: "s10",
      body: { subject: IMANI, scopes: ["school_application"], confirmation_id: ZERO },
    })).status,
    409,
  );
  const consent = await twoStep("POST", "/consents", {
    resident: NEEMA,
    body: { subject: IMANI, scopes: ["school_application"] },
  });
  assertEquals(consent.status, 201);
  assertEquals(
    (await api("DELETE", `/consents/${consent.json.id}`, { resident: LABAN })).status,
    403,
  );
  assertEquals((await api("DELETE", `/consents/${ZERO}`, { resident: NEEMA })).status, 404);

  // SILN through the same generic paths, for a child, with consent.
  const school = await twoStep("POST", "/agencies/siln/services/primary_place/applications", {
    resident: NEEMA,
    onBehalfOf: IMANI,
    body: { fields: { preferred_school_id: "z3_north" } },
  });
  assertEquals([school.json.subject, school.json.decision.outcome], [IMANI, "granted"]);
  await api("GET", `/applications/${school.json.id}`, { resident: NEEMA });
  assertEquals(
    (await api("DELETE", `/consents/${consent.json.id}`, { resident: NEEMA })).json.withdrawn_at !==
      null,
    true,
  );
  // Withdrawn consent also ends the parent's access to the child's application.
  assertEquals(
    (await api("GET", `/applications/${school.json.id}`, { resident: NEEMA })).status,
    403,
  );
  assertEquals(
    (await api("GET", `/applications/${school.json.id}`, { resident: IMANI })).status,
    200,
  );

  // Address and delivery.
  assertEquals(
    (await api("GET", "/residents/me/address", { resident: LABAN })).json.written,
    "Z3 B12 P047 U02",
  );
  assertEquals((await api("GET", "/residents/me/address")).status, 403);
  assertEquals(
    (await api("GET", "/residents/me/address", { resident: "QK-2041-0099" })).status,
    404,
  );
  const del = { item_kind: "passport", item_ref: granted.json.id, window: "afternoon" };
  assertEquals(
    (await api("POST", "/deliveries", {
      resident: LABAN,
      session: "s11",
      body: { ...del, window: "night" },
    })).status,
    400,
  );
  assertEquals(
    (await api("POST", "/deliveries", { resident: NEEMA, session: "s12", body: del })).status,
    403,
  );
  assertEquals(
    (await api("POST", "/deliveries", {
      resident: LABAN,
      session: "s13",
      body: { ...del, item_ref: ZERO },
    })).status,
    404,
  );
  assertEquals(
    (await api("POST", "/deliveries", {
      resident: NEEMA,
      session: "s14",
      body: { ...del, item_ref: pending.json.id },
    })).status,
    409,
  );
  // MED-296: nothing is handed over before its fee is paid.
  assertEquals(
    (await api("POST", "/deliveries", { resident: LABAN, session: "s14b", body: del })).status,
    409,
    "not paid yet",
  );

  // K3 (PP-03): biometrics only after the fee is paid.
  const appt = `/applications/${del.item_ref}/appointments`;
  assertEquals(
    (await api("POST", appt, { resident: LABAN, session: "a1", body: { window: "morning" } }))
      .status,
    409,
    "not paid yet",
  );

  // K3 desk work (PY-02, DK-01): officer credential only; the amount must equal the open charge.
  const fee = (await api("GET", `/applications/${del.item_ref}`, { resident: LABAN })).json.decision
    .inputs.fee_kes;
  const dpay = {
    application_id: del.item_ref,
    amount_kes: fee - 1,
    desk: "konza_passport_desk",
    officer: "OF-9",
  };
  assertEquals((await api("POST", "/desk/payments", { body: dpay })).status, 401);
  assertEquals(
    (await api("POST", "/desk/payments", { auth: "officer", body: { ...dpay, desk: "nowhere" } }))
      .status,
    400,
  );
  assertEquals(
    (await api("POST", "/desk/payments", {
      auth: "officer",
      body: { ...dpay, application_id: ZERO },
    }))
      .status,
    404,
  );
  assertEquals((await api("POST", "/desk/payments", { auth: "officer", body: dpay })).status, 409);
  const paid = await api("POST", "/desk/payments", {
    auth: "officer",
    body: { ...dpay, amount_kes: fee },
  });
  assertEquals([paid.status, paid.json.amount_kes, paid.json.status], [201, fee, "approved"]);
  assertEquals(
    (await api("POST", "/desk/payments", { auth: "officer", body: { ...dpay, amount_kes: fee } }))
      .status,
    409,
    "nothing left to pay",
  );
  assertEquals(
    (await api("POST", appt, { resident: LABAN, session: "a2", body: { window: "night" } }))
      .status,
    400,
  );
  assertEquals(
    (await api("POST", appt, { resident: NEEMA, session: "a3", body: { window: "morning" } }))
      .status,
    403,
  );
  assertEquals(
    (await api("POST", `/applications/${ZERO}/appointments`, {
      resident: LABAN,
      session: "a4",
      body: { window: "morning" },
    })).status,
    404,
  );
  const booked2 = await twoStep("POST", appt, { resident: LABAN, body: { window: "morning" } });
  assertEquals([booked2.status, booked2.json.kind], [201, "biometrics"]);
  assertEquals(
    (await api("POST", appt, { resident: LABAN, session: "a5", body: { window: "morning" } }))
      .status,
    409,
    "already booked",
  );

  // Paid at the desk: now it can be delivered.
  const booked = await twoStep("POST", "/deliveries", { resident: LABAN, body: del });
  assertEquals([booked.status, booked.json.fee_kes], [201, 200]);
  assertEquals(
    (await api("POST", "/deliveries", { resident: LABAN, session: "s15", body: del })).status,
    409,
  );

  const ddoc = {
    resident: IMANI,
    presented_by: NEEMA,
    doc_type: "birth_certificate",
    result: "accepted",
    desk: "lango_square",
  };
  assertEquals((await api("POST", "/desk/documents", { body: ddoc })).status, 401);
  assertEquals(
    (await api("POST", "/desk/documents", {
      auth: "officer",
      body: { ...ddoc, doc_type: "selfie" },
    }))
      .status,
    400,
  );
  assertEquals(
    (await api("POST", "/desk/documents", {
      auth: "officer",
      body: { ...ddoc, resident: "QK-0000-0000" },
    }))
      .status,
    404,
  );
  const doc = await api("POST", "/desk/documents", { auth: "officer", body: ddoc });
  assertEquals(doc.status, 201);
  assert(doc.json.evidence_id.startsWith("desk:"));

  // Officer grants a pending decision (200), now with an earlier refused one already done.
  const p2 = await twoStep("POST", app, {
    resident: "QK-2041-0099",
    body: { fields: { pages: 50, receive: "collect" } },
  });
  const g2 = await api("POST", `/decisions/${p2.json.decision.id}/officer-decision`, {
    auth: "officer",
    body: { outcome: "granted", reason_en: "Full passport seen at the desk.", officer: "OF-7" },
  });
  assertEquals(g2.status, 200);

  const documented = ops.flatMap((o) => o.statuses.map((s) => `${o.id} ${s}`));
  const missing = documented.filter((d) => !covered.has(d));
  assertEquals(missing, [], `not exercised: ${missing.join(", ")}`);
});
