// Synthetic Konza residents (K4, MED-271; the K4 design notes (kept private) section 1). Offline and seeded:
// the same seed and day give the same residents. Fictional formats only: QK-5xxx-xxxx resident
// numbers, Ofcom drama phones (+44 7700 900000 to 900999), world.md addresses, ZZ passports.
// Profiles (device, literacy, signal, language) stay in memory; only registry rows are loaded.

import { addDays, type ISODate } from "../../supabase/functions/_shared/rules/common/dates.ts";

export type Profile = {
  age_band: "child" | "18-29" | "30-49" | "50-64" | "65+";
  device: "smartphone" | "feature_phone";
  literacy: "ok" | "low";
  signal: "ok" | "poor";
  language: "en" | "sw" | "sheng";
  has_passport: boolean;
  has_address: boolean;
};

export type SimResident = {
  id: string;
  resident_number: string;
  household: number;
  dob: ISODate;
  adult: boolean;
  profile: Profile;
};

export type Rows = Record<string, Record<string, unknown>[]>;

export type Population = { seed: number; today: ISODate; residents: SimResident[]; rows: Rows };

/** mulberry32: small, fast, good enough for test data. */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  const weighted = <T>(xs: readonly [T, number][]) => {
    let r = next() * xs.reduce((s, [, w]) => s + w, 0);
    for (const [x, w] of xs) if ((r -= w) < 0) return x;
    return xs[xs.length - 1][0];
  };
  return { next, int, pick, weighted, chance: (p: number) => next() < p };
}

// Common first names and surnames, combined at random: no real person is described.
const FIRST = [
  "Achieng",
  "Akinyi",
  "Amani",
  "Baraka",
  "Chebet",
  "Faith",
  "Grace",
  "Halima",
  "Hassan",
  "Imani",
  "Jabari",
  "Juma",
  "Kamau",
  "Kibet",
  "Kioko",
  "Makena",
  "Mercy",
  "Moraa",
  "Mumbua",
  "Mwangi",
  "Nafula",
  "Neema",
  "Njeri",
  "Nyokabi",
  "Omondi",
  "Otieno",
  "Rehema",
  "Saida",
  "Wafula",
  "Wairimu",
  "Wanjiru",
  "Zawadi",
] as const;
const SURNAMES = [
  "Akello",
  "Barasa",
  "Chege",
  "Gitau",
  "Kariuki",
  "Kimani",
  "Kiprono",
  "Koech",
  "Maina",
  "Mutua",
  "Mwende",
  "Njoroge",
  "Nyambura",
  "Ochieng",
  "Odhiambo",
  "Ogola",
  "Onyango",
  "Rotich",
  "Simiyu",
  "Wambua",
] as const;

const CHECK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SCHOOL_SIDES = ["central", "east", "west"] as const;
export const POPULATION = 500;

const pad = (n: number, w: number) => String(n).padStart(w, "0");

function ageBand(age: number): Profile["age_band"] {
  return age < 18 ? "child" : age < 30 ? "18-29" : age < 50 ? "30-49" : age < 65 ? "50-64" : "65+";
}

export function generate(seed: number, today: ISODate, count = POPULATION): Population {
  const r = prng(seed);
  const residents: SimResident[] = [];
  const rows: Rows = { citizens: [], passports: [], addresses: [], guardianships: [], schools: [] };
  const usedAddresses = new Set<string>();
  const dobFor = (age: number) => addDays(today, -(age * 365 + r.int(0, 364)));

  let household = 0;
  while (residents.length < count) {
    household++;
    const kind = r.weighted(
      [
        ["couple_children", 40],
        ["single_parent", 10],
        ["grandparent", 5],
        ["single", 30],
        ["couple", 15],
      ] as const,
    );
    const adults = kind === "couple_children" || kind === "couple" ? 2 : 1;
    const children = kind === "single" || kind === "couple"
      ? 0
      : r.weighted([[1, 50], [2, 35], [3, 12], [4, 3]] as const);
    const surname = r.pick(SURNAMES);
    const device = r.weighted([["smartphone", 65], ["feature_phone", 35]] as const);
    const hasAddress = r.chance(0.95);
    let address: Record<string, unknown> | null = null;
    if (hasAddress) {
      let key = "";
      do {
        address = {
          zone: r.int(1, 9),
          block: `${"ABCDEFGH"[r.int(0, 7)]}${pad(r.int(1, 20), 2)}`,
          plot: r.int(1, 999),
          unit: r.int(1, 20),
          check_code: Array.from({ length: 6 }, () => r.pick([...CHECK_ALPHABET])).join(""),
        };
        key = `${address.zone}${address.block}${address.plot}${address.unit}`;
      } while (usedAddresses.has(key));
      usedAddresses.add(key);
    }

    const members: SimResident[] = [];
    const add = (age: number, adult: boolean) => {
      if (residents.length >= count) return;
      const i = residents.length + 1;
      const id = `sim_${pad(i, 4)}`;
      const dob = dobFor(age);
      const res: SimResident = {
        id,
        resident_number: `QK-5${pad(Math.floor(i / 10000), 3)}-${pad(i % 10000, 4)}`,
        household,
        dob,
        adult,
        profile: {
          age_band: ageBand(age),
          device,
          literacy: r.chance(0.15) ? "low" : "ok",
          signal: r.chance(0.2) ? "poor" : "ok",
          language: r.weighted([["sw", 50], ["en", 30], ["sheng", 20]] as const),
          has_passport: adult && r.chance(0.6),
          has_address: hasAddress,
        },
      };
      residents.push(res);
      members.push(res);
      rows.citizens.push({
        id,
        full_name: `${r.pick(FIRST)} ${surname}`,
        dob,
        id_number: res.resident_number,
        resident_number: res.resident_number,
        phone: `+447700900${pad(i % 1000, 3)}`,
        preferred_language: res.profile.language === "en" ? "en" : "sw",
        authority: "srr",
      });
      if (address) {
        rows.addresses.push({ citizen_id: id, ...address, verified_at: `${today}T08:00:00+03:00` });
      }
      if (res.profile.has_passport) {
        rows.passports.push({
          id: `pp_${id}`,
          citizen_id: id,
          number: `ZZ${pad(5_000_000 + i, 7)}`,
          pages: r.weighted([[34, 60], [50, 30], [66, 10]] as const),
          expires: addDays(today, r.int(-90, 36 * 30)),
          status: "active",
        });
      }
    };
    for (let a = 0; a < adults; a++) {
      add(kind === "grandparent" ? r.int(55, 80) : r.int(19, 64), true);
    }
    const guardians = [...members];
    for (let c = 0; c < children; c++) add(r.int(0, 17), false);
    for (const child of members.filter((m) => !m.adult)) {
      for (const g of guardians) {
        rows.guardianships.push({
          guardian_citizen_id: g.id,
          child_citizen_id: child.id,
          evidence: kind === "grandparent" ? "Guardianship order (sim)" : "Birth certificate (sim)",
        });
      }
    }
  }

  // Schools: two or three per zone; about a quarter full on purpose (ED-04).
  for (let zone = 1; zone <= 9; zone++) {
    for (const side of SCHOOL_SIDES.slice(0, r.int(2, 3))) {
      const capacity = r.int(20, 60);
      rows.schools.push({
        id: `sim_z${zone}_${side}`,
        name: `Zone ${zone} ${side[0].toUpperCase()}${side.slice(1)} Primary School`,
        zone,
        capacity,
        places_taken: r.chance(0.25) ? capacity : r.int(0, capacity - 5),
      });
    }
  }
  return { seed, today, residents, rows };
}

/** Counts for results files: no names, numbers or addresses. */
export function profileCounts(residents: SimResident[]) {
  const out: Record<string, Record<string, number>> = {};
  for (const res of residents) {
    for (const [k, v] of Object.entries(res.profile)) {
      out[k] ??= {};
      out[k][String(v)] = (out[k][String(v)] ?? 0) + 1;
    }
  }
  return out;
}
