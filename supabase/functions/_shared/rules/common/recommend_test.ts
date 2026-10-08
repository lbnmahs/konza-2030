import { assertEquals } from "jsr:@std/assert@1";
import { mockBusy, recommend } from "./recommend.ts";

const slots = [
  { slot_id: "a", date: "2026-10-05", time: "09:00", office: "X" },
  { slot_id: "b", date: "2026-10-05", time: "14:00", office: "X" },
  { slot_id: "c", date: "2026-10-07", time: "10:00", office: "X" },
  { slot_id: "d", date: "2026-10-20", time: "10:00", office: "X" },
];

Deno.test("RC-01: nothing after the deadline", () => {
  assertEquals(recommend({ slots, deadline: "2026-10-10" }).map((s) => s.slot_id), ["a", "b", "c"]);
});

Deno.test("RC-03: the preference comes first, then the earliest date", () => {
  assertEquals(recommend({ slots, prefer: "afternoon" })[0].slot_id, "b");
  assertEquals(recommend({ slots, prefer: "morning" }).map((s) => s.slot_id), ["a", "c", "d"]);
});

Deno.test("RC-02: busy half days are skipped, deterministically", () => {
  const busy = slots.filter((s) => mockBusy("cit_ke_id", s.date, s.time)).map((s) => s.slot_id);
  const got = recommend({ slots, citizenId: "cit_ke_id" }).map((s) => s.slot_id);
  for (const b of busy) assertEquals(got.includes(b), false);
  assertEquals(
    mockBusy("cit_ke_id", "2026-10-05", "09:00"),
    mockBusy("cit_ke_id", "2026-10-05", "09:00"),
  );
});
