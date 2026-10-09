import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { generate, POPULATION, profileCounts } from "./residents.ts";

const TODAY = "2026-10-05";

Deno.test("K4 residents: the same seed gives the same residents", () => {
  assertEquals(generate(1, TODAY), generate(1, TODAY));
  assertNotEquals(generate(1, TODAY).rows.citizens, generate(2, TODAY).rows.citizens);
});

Deno.test("K4 residents: 500 residents in about 200 households, fictional formats only", () => {
  const p = generate(1, TODAY);
  assertEquals(p.residents.length, POPULATION);
  const households = new Set(p.residents.map((r) => r.household)).size;
  assert(households >= 150 && households <= 230, `${households} households`);
  const numbers = new Set<string>();
  for (const c of p.rows.citizens) {
    assert(/^QK-5\d{3}-\d{4}$/.test(String(c.resident_number)));
    assert(/^\+447700900\d{3}$/.test(String(c.phone)), "Ofcom drama range only");
    numbers.add(String(c.resident_number));
  }
  assertEquals(numbers.size, POPULATION);
  for (const a of p.rows.addresses) {
    assert(/^[A-HJ-NP-Z2-9]{6}$/.test(String(a.check_code)));
    assert(/^[A-Z]\d{2}$/.test(String(a.block)));
  }
  for (const pp of p.rows.passports) assert(/^ZZ\d{7}$/.test(String(pp.number)));
});

Deno.test("K4 residents: children have guardians with evidence; profiles cover the mix", () => {
  const p = generate(1, TODAY);
  const children = p.residents.filter((r) => !r.adult);
  assert(children.length > 125 && children.length < 225, `${children.length} children`);
  for (const c of children) {
    const links = p.rows.guardianships.filter((g) => g.child_citizen_id === c.id);
    assert(links.length >= 1, "every child has a guardian");
    for (const l of links) assert(String(l.evidence).length > 0);
  }
  const counts = profileCounts(p.residents);
  for (const key of ["device", "literacy", "signal", "language", "has_passport", "has_address"]) {
    assert(Object.keys(counts[key]).length >= 2, key);
  }
});
