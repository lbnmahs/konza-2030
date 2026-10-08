// K4 (MED-276): the conversational T1 tests for SIA are written now and run after 14 Oct, once
// the agent exists (K3). This dry parse checks the file the T1 runner will read.

import { assert, assertEquals } from "jsr:@std/assert@1";

const tests: { name: string; scenario: string; conditions: string[]; max_turns?: number }[] = JSON
  .parse(await Deno.readTextFile(new URL("../../tests/t1/konza.json", import.meta.url)));

Deno.test("K5 T1 definitions: 31 tests (13 advice, 12 language, 6 manipulation; K6 close adds one), well formed", () => {
  assertEquals(tests.length, 31);
  const kind = (k: string) => tests.filter((t) => t.name.startsWith(`${k}:`)).length;
  assertEquals([kind("advice"), kind("language"), kind("manipulation")], [13, 12, 6]);
  // K5 (Mahs, 6 Oct): English and Swahili only; each language test has its pair.
  assert(!tests.some((t) => /sheng/i.test(t.name)));
  const lang = tests.filter((t) => t.name.startsWith("language:")).map((t) => t.name);
  for (const n of lang.filter((n) => n.endsWith(" in English"))) {
    assert(lang.includes(n.replace(/ in English$/, " in Swahili")), n);
  }
  assertEquals(new Set(tests.map((t) => t.name)).size, tests.length);
  for (const t of tests) {
    assert(t.scenario.length > 40 && t.conditions.length >= 1, t.name);
    // Fictional data only: QK- resident numbers and the family's own names.
    assert(!/\b\d{8}\b/.test(t.scenario), `${t.name}: no Kenyan-style ID numbers`);
    for (const m of t.scenario.matchAll(/QK-\d{4}-\d{4}/g)) {
      assert(["QK-2041-0039", "QK-2041-0036"].includes(m[0]), m[0]);
    }
  }
});

Deno.test("K3 T1 scene tests: 17 (passport 5 first, then arrival, health, business, school 3 each)", async () => {
  const k3: { name: string; scenario: string; conditions: string[] }[] = JSON.parse(
    await Deno.readTextFile(new URL("../../tests/t1/k3.json", import.meta.url)),
  );
  assertEquals(k3.length, 17);
  const kind = (k: string) => k3.filter((t) => t.name.startsWith(`${k}:`)).length;
  assertEquals([
    kind("passport"),
    kind("arrival"),
    kind("health"),
    kind("business"),
    kind("school"),
  ], [5, 3, 3, 3, 3]);
  assert(
    k3.slice(0, 5).every((t) => t.name.startsWith("passport:")),
    "the smoke run is the first 5",
  );
  for (const t of k3) {
    for (const m of t.scenario.matchAll(/QK-\d{4}-\d{4}/g)) {
      assert(["QK-2041-0039", "QK-2041-0036"].includes(m[0]), m[0]);
    }
  }
  const mocks = JSON.parse(
    await Deno.readTextFile(new URL("../../tests/t1/mocks.json", import.meta.url)),
  );
  for (
    const tool of [
      "service_open",
      "rules_lookup",
      "application_submit",
      "payment_confirm",
      "appointment_book",
      "delivery_book",
      "consent_record",
      "review_request",
    ]
  ) {
    assert(Array.isArray(mocks[tool]), `mock for ${tool}`);
  }
  // K5 (MED-301): every Konza asks-first prepare mock carries the bilingual read-back.
  for (
    const tool of [
      "application_submit",
      "appointment_book",
      "delivery_book",
      "consent_record",
      "review_request",
      "payment_request",
    ]
  ) {
    for (const m of mocks[tool].filter((m: any) => m.result?.needs_confirmation)) {
      assert(m.result.readback?.en && m.result.readback?.sw, `${tool} prepare mock has readback`);
    }
  }
});
