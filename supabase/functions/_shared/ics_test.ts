import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { buildIcs, zonedToUtc } from "./ics.ts";

Deno.test("zonedToUtc: Nairobi is UTC+3, London BST in October", () => {
  assertEquals(
    zonedToUtc("2026-10-05T10:00", "Africa/Nairobi").toISOString(),
    "2026-10-05T07:00:00.000Z",
  );
  assertEquals(
    zonedToUtc("2026-10-05T10:00", "Europe/London").toISOString(),
    "2026-10-05T09:00:00.000Z",
  );
  assertEquals(
    zonedToUtc("2026-12-05T10:00", "Europe/Berlin").toISOString(),
    "2026-12-05T09:00:00.000Z",
  );
});

Deno.test("buildIcs: required properties (RFC 5545)", () => {
  const ics = buildIcs([{
    id: "abc",
    title: "DEMO: Desk",
    local_start: "2026-10-05T10:00",
    timezone: "Africa/Nairobi",
    duration_min: 30,
    location: "Nairobi",
    ref: "NPS-BIO-1",
  }], new Date("2026-10-01T00:00:00Z"));
  for (
    const p of [
      "BEGIN:VCALENDAR",
      "PRODID:",
      "VERSION:2.0",
      "UID:abc@",
      "DTSTAMP:20261001T000000Z",
      "DTSTART:20261005T070000Z",
      "DTEND:20261005T073000Z",
    ]
  ) {
    assertStringIncludes(ics, p);
  }
});
