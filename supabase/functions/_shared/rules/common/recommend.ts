// Scheduling recommender (P15 D7). Deterministic: ranks free slots and returns the top 3 with a
// one-line reason. Inputs: the slots, an optional deadline, the caller's preference (morning or
// afternoon) and a mock calendar for the citizen (busy half days derived from the citizen id, so
// the demo is stable without a calendar integration).
// RC-01 slots after a deadline are never recommended.
// RC-02 a half day the caller is busy is skipped.
// RC-03 a slot matching the caller's preference (morning or afternoon) comes first; then earlier
//       is better.

export type Slot = { slot_id: string; date: string; time: string; office: string };

/** Mock calendar: each citizen is busy one fixed weekday afternoon and one weekday morning. */
export function mockBusy(citizenId: string, date: string, time: string): boolean {
  let h = 0;
  for (const ch of citizenId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const afternoon = time >= "12:00";
  return afternoon ? day === 1 + (h % 5) : day === 1 + ((h >> 3) % 5);
}

export function recommend(i: {
  slots: Slot[];
  citizenId?: string | null;
  prefer?: "morning" | "afternoon" | "";
  deadline?: string | null;
}) {
  const out: (Slot & { reason: string; rule_ids: string[]; score: number })[] = [];
  const first =
    [...i.slots].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  for (const s of i.slots) {
    if (i.deadline && s.date > i.deadline) continue;
    if (i.citizenId && mockBusy(i.citizenId, s.date, s.time)) continue;
    const half = s.time >= "12:00" ? "afternoon" : "morning";
    const matches = !!i.prefer && half === i.prefer;
    const reasons = [];
    if (s === first) reasons.push("the earliest free slot");
    if (matches) reasons.push(`in the ${half}, as you prefer`);
    if (i.citizenId) reasons.push("your calendar is free then");
    if (i.deadline) reasons.push("before the deadline");
    const days = (Date.parse(s.date) - Date.parse(first.date)) / 86_400_000;
    out.push({
      ...s,
      score: (i.prefer && !matches ? 1000 : 0) + days * 10 + (s.time >= "12:00" ? 0.1 : 0),
      reason: reasons.length ? reasons.join(", ") : "a free slot",
      rule_ids: ["RC-01", "RC-02", "RC-03"],
    });
  }
  return out.sort((a, b) => a.score - b.score || a.time.localeCompare(b.time)).slice(0, 3)
    .map(({ score: _s, ...r }) => r);
}
