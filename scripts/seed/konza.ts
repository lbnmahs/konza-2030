// Konza seed (K2, docs/konza/world.md section 5): the invented Njoroge family, their address,
// guardianships and Laban's Kenyan passport. Fictional formats only (QK- numbers, ZZ passport).
// Real phone numbers come only from .env.

import { addMonths, type ISODate } from "../../supabase/functions/_shared/rules/common/dates.ts";
import { createHash } from "node:crypto";
import type { Seed } from "./common.ts";

const FAMILY = [
  { id: "kz_laban", name: "Laban Njoroge", dob: "1987-04-12", rn: "QK-2041-0039" },
  { id: "kz_neema", name: "Neema Achieng Njoroge", dob: "1990-06-20", rn: "QK-2041-0036" },
  { id: "kz_imani", name: "Imani Njoroge", dob: "2017-03-10", rn: "QK-2041-0009" },
  { id: "kz_tumaini", name: "Tumaini Njoroge", dob: "2023-05-02", rn: "QK-2041-0003" },
];

/** MED-332: the one fictional mobile money PIN of every demo resident (CLAUDE.md, demo
 * section). Not a secret: nothing real is behind it. Kept on the rows only as a hash. */
export const DEMO_MOMO_PIN = "2468";

/** The hash the backend checks (payments.ts pinHash): sha256 of the method id and the PIN. */
export const momoPinHash = (methodId: string, pin: string) =>
  createHash("sha256").update(`momo:${methodId}:${pin}`).digest("hex");

/** PY-03: the adults' payment methods, masked only (fictional digits, never a real number). */
const METHODS = [
  { citizen_id: "kz_laban", card: "•••• 4417", mobile: "07•• ••• 318" },
  { citizen_id: "kz_neema", card: "•••• 5528", mobile: "07•• ••• 640" },
];

export function seedKonza(today: ISODate, env: (k: string) => string): Seed {
  return {
    // Konza residents sign in with their resident number (id_number) and date of birth.
    citizens: FAMILY.map((p) => ({
      id: p.id,
      full_name: p.name,
      dob: p.dob,
      id_number: p.rn,
      resident_number: p.rn,
      phone: env("DEMO_UK_MOBILE"),
      preferred_language: "sw",
      authority: "srr",
    })),
    passports: [{
      id: "pp_kz_laban",
      citizen_id: "kz_laban",
      number: "ZZ0418273",
      pages: 34,
      expires: addMonths(today, 5),
      status: "active",
    }],
    addresses: FAMILY.map((p) => ({
      citizen_id: p.id,
      zone: 3,
      block: "B12",
      plot: 47,
      unit: 2,
      check_code: "K7Q2ZP",
      verified_at: `${today}T08:00:00+03:00`,
    })),
    guardianships: ["kz_laban", "kz_neema"].flatMap((g) =>
      ["kz_imani", "kz_tumaini"].map((c) => ({
        guardian_citizen_id: g,
        child_citizen_id: c,
        evidence: "Birth certificate (seed)",
      }))
    ),
    payment_methods: METHODS.flatMap((m) => {
      const momo = crypto.randomUUID();
      return [
        { id: crypto.randomUUID(), citizen_id: m.citizen_id, type: "card", masked: m.card, pin_hash: null },
        { id: momo, citizen_id: m.citizen_id, type: "mobile_money", masked: m.mobile, pin_hash: momoPinHash(momo, DEMO_MOMO_PIN) },
      ];
    }),
    // MED-333: the children's birth certificates, already handed in at Lango Square
    // and accepted, so a parent can add a child to health cover (or register one) on the demo.
    desk_documents: ["kz_imani", "kz_tumaini"].map((c) => ({
      id: crypto.randomUUID(),
      citizen_id: c,
      presented_by: "kz_laban",
      doc_type: "birth_certificate",
      result: "accepted",
      desk: "lango_square",
      officer: "seed",
      created_at: `${today}T08:00:00+03:00`,
    })),
    // K2 gate (MED-266): SILN primary schools. Zone 3 Primary is full on purpose (ED-04).
    schools: [
      { id: "z3_primary", name: "Zone 3 Primary School", zone: 3, capacity: 1, places_taken: 1 },
      {
        id: "z3_north",
        name: "Zone 3 North Primary School",
        zone: 3,
        capacity: 30,
        places_taken: 12,
      },
      { id: "z4_primary", name: "Zone 4 Primary School", zone: 4, capacity: 40, places_taken: 5 },
    ],
  };
}
