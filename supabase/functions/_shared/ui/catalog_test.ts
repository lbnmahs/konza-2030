import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { type Catalog, checkEvent, EVIDENCE_PATTERN, formFields, withoutLabels } from "./catalog.ts";

// The manifest's agencies and evidence.ts open the database client on import.
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "unused");
const { AGENCIES } = await import("../konza/manifest.ts");
const { EVIDENCE_PATTERN: DESK } = await import("../konza/evidence.ts");

const spec = (p: string) => new URL(`../../../../spec/konza-2030-api/ui/${p}`, import.meta.url);
const catalog: Catalog = JSON.parse(await Deno.readTextFile(spec("catalog.schema.json")));
const examples: any[] = JSON.parse(await Deno.readTextFile(spec("examples.json")));

Deno.test("K8 (MED-327): every example event is valid, one per kind of the catalog", () => {
  for (const ev of examples) assertEquals(checkEvent(catalog, ev), [], ev.kind);
  const kinds = (catalog.properties!.kind.enum as string[]).slice().sort();
  assertEquals(examples.map((e) => e.kind).sort(), kinds);
  for (const k of kinds) assert(catalog.$defs[k], `$defs.${k}`);
});

Deno.test("K8 (MED-327): unknown kinds, extra keys and bad bindings are refused", () => {
  const confirm = structuredClone(examples.find((e) => e.kind === "confirm"));
  const bad = (mutate: (e: any) => void) => {
    const e = structuredClone(confirm);
    mutate(e);
    return checkEvent(catalog, e);
  };
  assert(bad((e) => (e.kind = "upload")).length, "upload is deferred, so unknown");
  assert(bad((e) => (e.kind = "html")).length, "unknown kind");
  assert(bad((e) => (e.v = "ui/v2")).length, "version");
  assert(bad((e) => (e.payload.html = "<b>x</b>")).length, "no extra payload keys");
  assert(bad((e) => (e.payload.shown_hash = "abc")).length, "hash format");
  assert(bad((e) => delete e.payload.earliest_at).length, "earliest commit time required");
  assert(bad((e) => (e.payload.title = { sw: "Thibitisha" })).length, "English text required");
  assert(bad((e) => (e.seq = 0)).length, "seq from 1");
  const receipt = structuredClone(examples.find((e) => e.kind === "receipt"));
  receipt.payload.decided_by = "agent";
  assert(checkEvent(catalog, receipt).length, "an assistant never decides");
  const payment = structuredClone(examples.find((e) => e.kind === "payment"));
  payment.payload.pin = "1234";
  assert(checkEvent(catalog, payment).length, "no PIN on the payment card");
});

Deno.test("K8 (MED-327): every service field has a label and its form card is valid", () => {
  let n = 0;
  for (const agency of Object.values(AGENCIES)) {
    for (const [id, def] of Object.entries(agency.services)) {
      const fields = formFields(def.applicationSchema);
      for (const f of fields) {
        assert(f.label.en && f.label.sw, `${agency.id}.${id}.${f.name} labelled in en and sw`);
        for (const o of f.options ?? []) assert(o.label.en && o.label.sw, `${f.name} option`);
      }
      const ev = {
        v: "ui/v1",
        seq: 1,
        kind: "form",
        at: "2026-10-09T09:00:00Z",
        payload: { service: `${agency.id}.${id}`, title: { en: def.title }, fields },
      };
      assertEquals(checkEvent(catalog, ev), [], `${agency.id}.${id}`);
      n++;
    }
  }
  assert(n >= 8, `services checked: ${n}`);
  const pages = formFields(AGENCIES.sps.services.passport_renewal.applicationSchema)[0];
  assertEquals(pages.options?.map((o) => o.value), [34, 50, 66]);
  assertThrows(() => formFields({ properties: { x: { type: "string" } } }), Error, "no title");
});

Deno.test("K8 (MED-327): SIA's service_open fields carry no screen labels", () => {
  for (const agency of Object.values(AGENCIES)) {
    for (const def of Object.values(agency.services)) {
      const text = JSON.stringify(withoutLabels(def.applicationSchema));
      assert(!/"title"|x-konza-/.test(text), `${agency.id}: ${text}`);
    }
  }
  const sps = withoutLabels(AGENCIES.sps.services.passport_renewal.applicationSchema);
  assertEquals((sps.properties!.pages as any).enum, [34, 50, 66]);
  assertEquals(sps.required, ["pages", "receive"]);
});

Deno.test("K8 (MED-327): the catalog's evidence pattern is the core's", () => {
  assertEquals(EVIDENCE_PATTERN, DESK);
});

Deno.test("K8 S4 (MED-333, plan-k8 2.4): no field that holds an id is typed; the backend fills its choices", () => {
  // Typed on purpose: the month of a contribution and the name of a new business.
  const TYPED = ["month", "name"];
  for (const [a, agency] of Object.entries(AGENCIES)) {
    for (const [s, def] of Object.entries(agency.services)) {
      for (const [n, p] of Object.entries(def.applicationSchema?.properties ?? {})) {
        const pattern = p.pattern ?? p.items?.pattern;
        if (!pattern || TYPED.includes(n)) continue;
        assert(pattern === DESK || p["x-konza-options"], `${a}.${s}.${n} is an id typed by hand`);
      }
    }
  }
  // And the agent never sees the screen annotation.
  const permit = withoutLabels(AGENCIES.sco.services.trading_permit.applicationSchema);
  assertEquals(permit.properties!.business_ref["x-konza-options"], undefined);
});
