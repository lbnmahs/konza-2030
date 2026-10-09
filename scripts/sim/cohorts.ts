// Picks residents for a family from the generated population (K4). Deterministic: the same
// population gives the same cohorts.

import type { Population } from "./residents.ts";

const ageOn = (dob: string, day: string) => {
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = day.split("-").map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
};

export function cohorts(pop: Population) {
  const { rows, today } = pop;
  const addr = new Map(rows.addresses.map((a) => [a.citizen_id as string, a]));
  const pass = new Map(rows.passports.map((p) => [p.citizen_id as string, p]));
  const inYear = new Date(Date.parse(`${today}T00:00:00Z`) + 360 * 86_400_000).toISOString()
    .slice(0, 10);
  const placesLeft = (s: any) => s.capacity - s.places_taken;

  /** Adults whose renewal is open (expires within about 12 months) and who have an address. */
  const renewers = pop.residents.filter((r) => {
    const p = pass.get(r.id);
    return r.adult && p && String(p.expires) <= inYear && addr.has(r.id);
  });
  /** Children of primary age with an address and a guardian, with a school in their zone that
   * has space. */
  const pupils = pop.residents.flatMap((r) => {
    if (r.adult || !addr.has(r.id)) return [];
    const age = ageOn(r.dob, today);
    if (age < 5 || age > 13) return [];
    const guardian = rows.guardianships.find((g) => g.child_citizen_id === r.id);
    const zone = addr.get(r.id)!.zone;
    const school = rows.schools.find((s) => s.zone === zone && placesLeft(s) > 2);
    if (!guardian || !school) return [];
    return [{
      child: r,
      guardian: guardian.guardian_citizen_id as string,
      school: school.id as string,
      zone,
    }];
  });
  return { renewers, pupils, addr, pass };
}
