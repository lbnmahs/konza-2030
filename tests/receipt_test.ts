import { assert, assertEquals } from "jsr:@std/assert@1";
import { expired, SHOWN, shownInputs } from "../web/lib/receipt.ts";

Deno.test("K6 (MED-311): a receipt shows only allowlisted inputs, never ids or tax numbers", () => {
  assertEquals(
    shownInputs("sco", {
      fee_kes: 3000,
      tax_number: "QK-T-12345678",
      name_check: "free",
    }),
    [["name check", "free"], ["fee (KES)", "3000"]],
  );
  assertEquals(
    shownInputs("siln", {
      zone: "z3",
      school_id: "s1",
      alternative_school_id: null,
    }),
    [["zone", "z3"]],
  );
  assertEquals(
    shownInputs("sps", { held_by: ["h1"], effect_failed: true }),
    [],
  );
  assertEquals(shownInputs("unknown", { fee_kes: 1 }), []);
  for (const keys of Object.values(SHOWN)) {
    assert(
      !Object.keys(keys).some((k) => /(_id|number|phone|name)$/.test(k)),
      "no ids",
    );
  }
});

Deno.test("K6 (MED-311): a receipt link expires 60 days after the decision", () => {
  const now = new Date("2026-12-10T12:00:00Z");
  assert(!expired("2026-10-12T09:00:00Z", now));
  assert(expired("2026-10-10T09:00:00Z", now));
});
