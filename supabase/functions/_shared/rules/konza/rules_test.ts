import { assertEquals } from "jsr:@std/assert@1";
import {
  ageOn,
  allocate,
  appointmentDayOk,
  BUSINESS_FEES_KES,
  CHECK_CODE,
  COLLECTION_FEE_KES,
  collectionDesk,
  deliveryDate,
  DESKS,
  normalName,
  PHONE_CODE_TRIES,
  PHONE_CODE_TTL_MS,
  primaryAgeOk,
  reservedName,
  reviewAnswerBy,
  reviewAskBy,
  type School,
  SH_MIN_CONTRIBUTION_KES,
  TRADING_PERMIT_FEE_KES,
  WINDOW_HOURS,
} from "./rules.ts";
import { formatAddress } from "../../konza/address.ts";

const schools: School[] = [
  { id: "z3_primary", name: "Zone 3 Primary", zone: 3, capacity: 1, places_taken: 1 },
  { id: "z3_north", name: "Zone 3 North Primary", zone: 3, capacity: 30, places_taken: 12 },
  { id: "z4_primary", name: "Zone 4 Primary", zone: 4, capacity: 40, places_taken: 5 },
];

Deno.test("ED-03: preferred school in the child's zone with space is granted", () => {
  const r = allocate("z3_north", 3, schools);
  assertEquals(r.outcome, "granted");
});

Deno.test("ED-04: a full preferred school goes to an officer with the nearest alternative", () => {
  const r = allocate("z3_primary", 3, schools);
  assertEquals(r.outcome, "pending_officer");
  if (r.outcome === "pending_officer") {
    assertEquals(r.why, "full");
    assertEquals(r.alternative?.id, "z3_north");
  }
});

Deno.test("ED-03: a school outside the catchment is never refused by rule", () => {
  const r = allocate("z4_primary", 3, schools);
  assertEquals(r.outcome, "pending_officer");
  if (r.outcome === "pending_officer") assertEquals(r.why, "outside_catchment");
});

Deno.test("ED-06: primary age 5 to 13 on the day", () => {
  assertEquals(ageOn("2017-03-10", "2026-10-05"), 9);
  assertEquals(primaryAgeOk("2017-03-10", "2026-10-05"), true);
  assertEquals(primaryAgeOk("2023-01-01", "2026-10-05"), false);
});

Deno.test("AD-03: delivery the next working day (Mashujaa Day skipped)", () => {
  assertEquals(deliveryDate("2026-10-19"), "2026-10-21");
  assertEquals(deliveryDate("2026-10-09"), "2026-10-12");
});

Deno.test("RV-01 and RV-03: review window and answer date", () => {
  assertEquals(reviewAskBy("2026-10-05"), "2026-11-04");
  assertEquals(reviewAnswerBy("2026-10-05"), "2026-10-19");
  assertEquals(reviewAnswerBy("2026-10-06"), "2026-10-21"); // Mashujaa Day skipped
});

Deno.test("AD-01: address written and spoken forms; check code alphabet", () => {
  const a = formatAddress({ zone: 3, block: "B12", plot: 47, unit: 2, check_code: "K7Q2ZP" });
  assertEquals(a.written, "Z3 B12 P047 U02");
  assertEquals(a.spoken, "zone three, block B twelve, plot forty-seven, unit two");
  assertEquals(CHECK_CODE.test("K7Q2ZP"), true);
  assertEquals(CHECK_CODE.test("K0Q1ZP"), false);
});

Deno.test("K3 PY and DK rules: code window, desks, collection", () => {
  assertEquals(PHONE_CODE_TTL_MS, 300_000);
  assertEquals(PHONE_CODE_TRIES, 3);
  assertEquals(COLLECTION_FEE_KES, 0);
  assertEquals(DESKS.lango_square.address, "Z1 B01 P001 U01");
  assertEquals(collectionDesk("passport"), "konza_passport_desk");
  assertEquals(collectionDesk("resident_card"), "lango_square");
  assertEquals(collectionDesk("certificate"), "lango_square");
});

Deno.test("K3 SH and BZ rules: minimum, fees, reserved names", () => {
  assertEquals(SH_MIN_CONTRIBUTION_KES, 300);
  assertEquals(BUSINESS_FEES_KES.business_name, 950);
  assertEquals(BUSINESS_FEES_KES.company, 10500);
  assertEquals(TRADING_PERMIT_FEE_KES, 5000);
  for (const n of ["Konza Solar", "Government Repairs", "Sun Authority", "technopolis fix"]) {
    assertEquals(reservedName(n), true, n);
  }
  for (const n of ["Njoroge Solar Repairs", "Konzaa Lights", "Authorityless"]) {
    assertEquals(reservedName(n), false, n);
  }
  assertEquals(normalName("  Njoroge   Solar "), "njoroge solar");
});

Deno.test("K3 PP-03 amended: an appointment day is a working day within the next 10", () => {
  // Tuesday 6 Oct 2026: Wednesday is fine, Saturday is not, today is not.
  assertEquals(appointmentDayOk("2026-10-06", "2026-10-07"), true);
  assertEquals(appointmentDayOk("2026-10-06", "2026-10-10"), false);
  assertEquals(appointmentDayOk("2026-10-06", "2026-10-06"), false);
  // 20 Oct is Mashujaa Day, so 21 Oct is the 10th working day and 22 Oct the 11th.
  assertEquals(appointmentDayOk("2026-10-06", "2026-10-21"), true);
  assertEquals(appointmentDayOk("2026-10-06", "2026-10-22"), false);
  assertEquals(appointmentDayOk("2026-10-06", "next week"), false);
  assertEquals(WINDOW_HOURS.morning, "8 to 12");
});
