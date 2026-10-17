// The conversational T1 tests for SIA (K4, MED-276; K8, MED-337). This dry parse checks the files
// the T1 runner reads, without credits.

import { assert, assertEquals } from "jsr:@std/assert@1";

const tests: { name: string; scenario: string; conditions: string[]; max_turns?: number }[] = JSON
  .parse(await Deno.readTextFile(new URL("../../tests/t1/konza.json", import.meta.url)));

Deno.test("K5 T1 definitions: 31 tests (13 advice, 12 language, 6 manipulation; K6 close adds one), well formed", () => {
  assertEquals(tests.length, 31);
  const kind = (k: string) => tests.filter((t) => t.name.startsWith(`${k}:`)).length;
  assertEquals([kind("advice"), kind("language"), kind("manipulation")], [13, 12, 6]);
  // K5: English and Swahili only; each language test has its pair.
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

Deno.test("K8 (MED-328): SIA's prompt, node and agent name say nothing of Sheng; the simulator has none", async () => {
  const read = (p: string) => Deno.readTextFile(new URL(`../../${p}`, import.meta.url));
  for (
    const p of [
      "agents/konza/sia/prompt.md",
      "agents/konza/sia/nodes/concierge.md",
      "agents/konza/sia/agent.json",
      "agents/blocks/language.md",
    ]
  ) {
    assert(!/sheng/i.test(await read(p)), p);
  }
  assert(!/"sheng"/.test(await read("scripts/sim/residents.ts")), "simulator languages");
});

Deno.test("K8 (MED-337) T1 k8: 14 tests, each scene with and without a screen, mocks on SIA's tools", async () => {
  const { KONZA_HUB_TOOLS } = await import("../../supabase/functions/_shared/hubs.ts");
  const k8: {
    name: string;
    scenario: string;
    conditions: string[];
    dynamic_variables?: { has_screen?: unknown };
    mocks?: Record<string, { when?: Record<string, string>; result: any }[]>;
  }[] = JSON.parse(await Deno.readTextFile(new URL("../../tests/t1/k8.json", import.meta.url)));
  assertEquals(k8.length, 14);
  assertEquals(new Set(k8.map((t) => t.name)).size, 14);
  for (const scene of ["passport apply", "pay", "health", "arrival", "business", "school"]) {
    const of = (mode: string) => k8.filter((t) => t.name.startsWith(`${mode}: ${scene}`)).length;
    assert(of("screen") >= 1 && of("phone") >= 1, `${scene} with and without a screen`);
  }
  assertEquals(k8.filter((t) => /Swahili/.test(t.name)).length, 2);
  for (const t of k8) {
    assertEquals(typeof t.dynamic_variables?.has_screen, "boolean", t.name);
    assertEquals(t.dynamic_variables!.has_screen, t.name.startsWith("screen:"), t.name);
    assert(t.scenario.length > 40 && t.conditions.length >= 2, t.name);
    for (const m of t.scenario.matchAll(/QK-\d{4}-\d{4}/g)) {
      assert(["QK-2041-0039", "QK-2041-0036"].includes(m[0]), m[0]);
    }
    for (const [tool, list] of Object.entries(t.mocks ?? {})) {
      assert(KONZA_HUB_TOOLS.includes(tool), `${t.name}: ${tool} is not on SIA's hub`);
      for (const m of list.filter((m) => m.result?.needs_confirmation)) {
        assert(m.result.readback?.en && m.result.readback?.sw, `${t.name}: ${tool} read-back in both languages`);
      }
    }
  }
});
