import { assertEquals } from "jsr:@std/assert@1";
import { todayIn } from "./dates.ts";
import { keCalendar, todayNairobi } from "../ke/calendar.ts";

Deno.test("KE: Mashujaa Day and Sunday substitutes are not working days", () => {
  assertEquals(keCalendar.isWorkingDay("2026-10-20"), false); // Mashujaa Day, Tuesday
  assertEquals(keCalendar.isWorkingDay("2027-10-11"), false); // Mazingira Day moved to Monday
  assertEquals(keCalendar.isWorkingDay("2026-10-19"), true);
  // 2 working days after Friday 16 October 2026: Mon 19, (Tue 20 holiday), Wed 21.
  assertEquals(keCalendar.addWorkingDays("2026-10-16", 2), "2026-10-21");
});

Deno.test("today follows the authority's time zone", () => {
  const lateLondon = new Date("2026-09-30T22:30:00Z"); // 23:30 London, 01:30 Nairobi
  assertEquals(todayIn("Europe/London", lateLondon), "2026-09-30");
  assertEquals(todayNairobi(lateLondon), "2026-10-01");
});
