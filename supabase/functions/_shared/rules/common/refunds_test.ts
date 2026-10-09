import { assertEquals } from "jsr:@std/assert@1";
import { refundDecision } from "./refunds.ts";

const base = { duplicate: false, refundable: true, serviceStarted: false, daysSincePayment: 2 };

Deno.test("RF-01: a duplicate is refunded even when the service has started", () => {
  const d = refundDecision({ ...base, duplicate: true, serviceStarted: true, refundable: false });
  assertEquals([d.outcome, d.rule_id], ["approved", "RF-01"]);
});

Deno.test("RF-02: a non-refundable fee is declined", () => {
  assertEquals(refundDecision({ ...base, refundable: false }).rule_id, "RF-02");
});

Deno.test("RF-03: a started service is declined", () => {
  const d = refundDecision({ ...base, serviceStarted: true });
  assertEquals([d.outcome, d.rule_id], ["declined", "RF-03"]);
});

Deno.test("RF-04: within 14 days and not started is approved, day 14 included", () => {
  assertEquals(refundDecision({ ...base, daysSincePayment: 14 }).rule_id, "RF-04");
});

Deno.test("RF-05: after 14 days goes to an officer", () => {
  const d = refundDecision({ ...base, daysSincePayment: 15 });
  assertEquals([d.outcome, d.rule_id], ["routed", "RF-05"]);
});
