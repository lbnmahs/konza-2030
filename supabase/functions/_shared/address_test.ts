import { assertEquals } from "jsr:@std/assert@1";
import { matchProperty, normHouse } from "./address.ts";

const rows = [
  { id: "prop_001", postcode: "NF4 7QD", house: "14" },
  { id: "prop_002", postcode: "NF4 7QE", house: "3A" },
];

Deno.test("normHouse pulls the number out of spoken forms", () => {
  assertEquals(normHouse("flat number 14"), "14");
  assertEquals(normHouse("number 14"), "14");
  assertEquals(normHouse("No. 3a"), "3A");
  assertEquals(normHouse("14"), "14");
  assertEquals(normHouse("Rose Cottage"), "ROSECOTTAGE");
});

Deno.test("exact match ignores case and spaces", () => {
  assertEquals(matchProperty(rows, "nf47qd", "flat 14")?.property.id, "prop_001");
  assertEquals(matchProperty(rows, "NF4 7QD", "14")?.exact, true);
});

Deno.test("one misheard postcode character is a near match that needs confirming", () => {
  const m = matchProperty(rows, "LF4 7QD", "number 14");
  assertEquals(m?.property.id, "prop_001");
  assertEquals(m?.exact, false);
});

Deno.test("no match when two characters differ or the house differs", () => {
  assertEquals(matchProperty(rows, "LS4 7QD", "14"), null);
  assertEquals(matchProperty(rows, "NF4 7QD", "37"), null);
});
