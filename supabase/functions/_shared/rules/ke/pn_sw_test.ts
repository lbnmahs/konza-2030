import { assertEquals } from "jsr:@std/assert@1";
import { calculateRenewal, startedMonthsSince } from "./pn.ts";
import { swDate, swDateSpoken, swNumber, swShillings } from "../../sw.ts";

const base = { category: "small_trader_market_stall", arrears_kes: 0 };

Deno.test("PN-01 + PN-02 + PN-05: 10 days before expiry, KES 3,500, +12 months", () => {
  const q = calculateRenewal({ ...base, expires: "2026-10-07", today: "2026-09-27" });
  assertEquals(q.eligible, true);
  if (!q.eligible) return;
  assertEquals(q.total_kes, 3500);
  assertEquals(q.fee_lines.map((l) => l.amount_kes), [3000, 500]);
  assertEquals(q.new_expiry, "2027-10-07");
  assertEquals(q.ruleIds, ["PN-01", "PN-02", "PN-05"]);
});

Deno.test("PN-01: not open more than 30 days before expiry", () => {
  const q = calculateRenewal({ ...base, expires: "2026-12-01", today: "2026-09-27" });
  assertEquals(q.eligible, false);
  if (q.eligible) return;
  assertEquals(q.blocked, false);
  assertEquals(q.opens_on, "2026-11-01");
  assertEquals(q.ruleIds, ["PN-01"]);
  // Exactly 30 days before is open.
  assertEquals(
    calculateRenewal({ ...base, expires: "2026-10-27", today: "2026-09-27" }).eligible,
    true,
  );
});

Deno.test("PN-03: 10% of the permit fee per started month after expiry", () => {
  assertEquals(startedMonthsSince("2026-09-01", "2026-09-01"), 0);
  assertEquals(startedMonthsSince("2026-09-01", "2026-09-02"), 1);
  assertEquals(startedMonthsSince("2026-09-01", "2026-10-01"), 1);
  assertEquals(startedMonthsSince("2026-09-01", "2026-10-02"), 2);
  const q = calculateRenewal({ ...base, expires: "2026-08-20", today: "2026-09-27" });
  if (!q.eligible) throw new Error("expected eligible");
  assertEquals(q.total_kes, 3500 + 600);
  assertEquals(q.new_expiry, "2027-08-20");
  assertEquals(q.ruleIds, ["PN-01", "PN-02", "PN-03", "PN-05"]);
});

Deno.test("PN-04: arrears block renewal", () => {
  const q = calculateRenewal({
    ...base,
    arrears_kes: 1200,
    expires: "2026-10-07",
    today: "2026-09-27",
  });
  assertEquals(q.eligible, false);
  if (q.eligible) return;
  assertEquals(q.blocked, true);
  assertEquals(q.ruleIds, ["PN-04"]);
});

Deno.test("Swahili numbers", () => {
  assertEquals(swNumber(3500), "elfu tatu mia tano");
  assertEquals(swNumber(3000), "elfu tatu");
  assertEquals(swNumber(500), "mia tano");
  assertEquals(swNumber(4100), "elfu nne mia moja");
  assertEquals(swNumber(3850), "elfu tatu mia nane na hamsini");
  assertEquals(swNumber(3025), "elfu tatu na ishirini na tano");
  assertEquals(swNumber(17), "kumi na saba");
  assertEquals(swNumber(2027), "elfu mbili na ishirini na saba");
  assertEquals(swShillings(3500), "shilingi elfu tatu mia tano");
});

Deno.test("Swahili dates", () => {
  assertEquals(swDate("2027-10-07"), "7 Oktoba 2027");
  assertEquals(
    swDateSpoken("2027-10-07"),
    "Alhamisi, tarehe saba Oktoba, mwaka elfu mbili na ishirini na saba",
  );
});
