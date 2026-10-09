import { assertEquals } from "jsr:@std/assert@1";
import { canBookBiometrics, idReplacement, lossDateValid } from "./id.ts";
import { contributionDue, coverStatus, dependantDecisionBy, newbornDobValid } from "./sh.ts";
import { swTime } from "../../sw.ts";

Deno.test("ID-02: fee KES 1,000; four steps in order", () => {
  const r = idReplacement();
  assertEquals(r.fee_kes, 1000);
  assertEquals(r.steps.map((s) => s.rule_id), ["ID-01", "ID-02", "ID-03", "ID-04"]);
});

Deno.test("loss date: today or past year only", () => {
  assertEquals(lossDateValid("2026-09-29", "2026-09-30"), true);
  assertEquals(lossDateValid("2026-10-01", "2026-09-30"), false);
  assertEquals(lossDateValid("2025-09-29", "2026-09-30"), false);
});

Deno.test("ID-02 then ID-03 gate the booking", () => {
  assertEquals(canBookBiometrics({ paid: false, photoReceived: true }).ok, false);
  const noPhoto = canBookBiometrics({ paid: true, photoReceived: false });
  assertEquals(noPhoto.ok === false && noPhoto.rule_id, "ID-03");
  assertEquals(canBookBiometrics({ paid: true, photoReceived: true }).ok, true);
});

Deno.test("SH-01: last paid two months ago means no cover; KES 300 restores it", () => {
  const s = coverStatus(["2026-06", "2026-07"], "2026-09-30");
  assertEquals(s.active, false);
  assertEquals(s.months_behind, 2);
  const due = contributionDue(["2026-07"], "2026-09-30");
  assertEquals(due?.amount_kes, 300);
  assertEquals(due?.month, "2026-09");
  assertEquals(contributionDue(["2026-09"], "2026-09-30"), null);
});

Deno.test("SH-04: 2 working days, Kenya calendar (Mashujaa Day skipped)", () => {
  assertEquals(dependantDecisionBy("2026-10-16"), "2026-10-21");
  assertEquals(dependantDecisionBy("2026-09-30"), "2026-10-02");
});

Deno.test("SH-03: newborn date of birth within 12 months, not in the future", () => {
  assertEquals(newbornDobValid("2026-09-27", "2026-09-30"), true);
  assertEquals(newbornDobValid("2026-10-01", "2026-09-30"), false);
  assertEquals(newbornDobValid("1993-12-09", "2026-09-30"), false);
});

Deno.test("swTime: Swahili hours start at 7 am", () => {
  assertEquals(swTime("09:00"), "saa tatu asubuhi");
  assertEquals(swTime("11:30"), "saa tano na nusu asubuhi");
  assertEquals(swTime("14:15"), "saa nane na robo mchana");
  assertEquals(swTime("10:45"), "saa tano kasoro robo asubuhi");
  assertEquals(swTime("19:00"), "saa moja usiku");
});

Deno.test("swDayMonth: no year when spoken", async () => {
  const { swDayMonth } = await import("../../sw.ts");
  assertEquals(swDayMonth("2026-10-02"), "Ijumaa, tarehe mbili Oktoba");
});

Deno.test("swNumber: laki for hundreds of thousands", async () => {
  const { swNumber } = await import("../../sw.ts");
  assertEquals(swNumber(150_000), "laki moja na elfu hamsini");
  assertEquals(swNumber(100_000), "laki moja");
  assertEquals(swNumber(3500), "elfu tatu mia tano");
  assertEquals(swNumber(1_800_000), "milioni moja na laki nane");
});
