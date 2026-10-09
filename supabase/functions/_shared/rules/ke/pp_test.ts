import { assertEquals } from "jsr:@std/assert@1";
import { passportQuote, readyBy, renewalOpen } from "./pp.ts";
import { keCalendar } from "./calendar.ts";

Deno.test("PP-01: fees by booklet, unknown sizes refused", () => {
  assertEquals(passportQuote(34)?.fee_kes, 7550);
  assertEquals(passportQuote(66)?.fee_kes, 12050);
  assertEquals(passportQuote(40), null);
});

Deno.test("PP-02: open within 12 months of expiry, expired, or full", () => {
  assertEquals(renewalOpen({ expires: "2027-03-01", today: "2026-10-01" }).open, true);
  assertEquals(renewalOpen({ expires: "2026-09-01", today: "2026-10-01" }).open, true);
  assertEquals(renewalOpen({ expires: "2028-03-01", today: "2026-10-01" }).open, false);
  assertEquals(
    renewalOpen({ expires: "2028-03-01", today: "2026-10-01", fullOrDamaged: true }).open,
    true,
  );
});

Deno.test("PP-04: ready 10 working days after biometrics", () => {
  assertEquals(readyBy("2026-10-05", keCalendar), "2026-10-19");
});
