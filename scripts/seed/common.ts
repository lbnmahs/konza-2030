// Builds the whole demo seed: each country's rows with dates relative to today in that
// country's time zone.

import { todayIn } from "../../supabase/functions/_shared/rules/common/dates.ts";
import { seedKE } from "./ke.ts";
import { seedKonza } from "./konza.ts";

export type Seed = Record<string, Record<string, unknown>[]>;

/** Insert order matters (foreign keys). */
export const TABLE_ORDER = [
  "citizens",
  "passports",
  "partners",
  "disability_registrations",
  "registry_offices",
  "registry_slots",
  "county_markets",
  "county_permits",
  "id_cards",
  "health_members",
  "health_contributions",
  // K2 Konza
  "addresses",
  "guardianships",
  "schools",
];

/** Extra fictional citizens from `deno task seed:gen` (scripts/seed/fixtures/generated.json). */
const GENERATED_AUTHORITY: Record<string, { authority: string; lang: string }> = {
  KE: { authority: "usajili_njema", lang: "sw" },
};

function generatedCitizens(env: (k: string) => string) {
  let data: { people?: Record<string, { full_name: string; dob: string; id_number: string }[]> };
  try {
    data = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/generated.json", import.meta.url)));
  } catch {
    return [];
  }
  // K0: only Kenyan generated people are loaded; the other countries were retired.
  return Object.entries(data.people ?? {}).filter(([country]) => country in GENERATED_AUTHORITY)
    .flatMap(([country, people]) =>
      people.map((p, i) => ({
        id: `gen_${country.toLowerCase()}_${i + 1}`,
        full_name: p.full_name,
        dob: p.dob,
        id_number: p.id_number,
        phone: env("DEMO_UK_MOBILE"),
        preferred_language: GENERATED_AUTHORITY[country].lang,
        authority: GENERATED_AUTHORITY[country].authority,
      }))
    );
}

export function buildSeed(env: (k: string) => string, now = new Date()) {
  const today = { KE: todayIn("Africa/Nairobi", now) };
  const seed: Seed = {};
  for (
    const part of [
      seedKE(today.KE, env),
      seedKonza(today.KE, env),
      { citizens: generatedCitizens(env) },
    ]
  ) {
    for (const [table, rows] of Object.entries(part)) (seed[table] ??= []).push(...rows);
  }
  return { seed, today };
}
