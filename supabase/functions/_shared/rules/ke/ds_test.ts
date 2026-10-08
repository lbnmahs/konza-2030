import { assertEquals } from "jsr:@std/assert@1";
import { certificateDates, exemptPortion } from "./ds.ts";

Deno.test("DS-01: exempt up to KES 150,000 a month", () => {
  assertEquals(exemptPortion(90_000), 90_000);
  assertEquals(exemptPortion(220_000), 150_000);
});

Deno.test("DS-05: starts on the 1st of next month, valid 5 years", () => {
  assertEquals(certificateDates("2026-09-30"), {
    start_date: "2026-10-01",
    valid_until: "2031-10-01",
  });
});
