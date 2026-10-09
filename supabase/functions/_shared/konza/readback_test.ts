import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "unused");
const { AGENCIES } = await import("./manifest.ts");
const { rb, readBackProblems } = await import("../readback.ts");
const { passportQuote } = await import("../rules/ke/pp.ts");
const { BUSINESS_FEES_KES, TRADING_PERMIT_FEE_KES, WINDOW_HOURS } = await import(
  "../rules/konza/rules.ts"
);
import type { Resident } from "./types.ts";

const child = { full_name: "Imani Wanjiru Njoroge", resident_number: "QK-2041-3399" } as Resident;

/** Sample fields per service; a new service without a sample fails the test below. */
const SAMPLES: Record<string, Record<string, unknown>[]> = {
  "srr/address_registration": [{ evidence: "desk" }],
  "srr/child_registration": [{ evidence: "desk" }],
  "siln/primary_place": [{ preferred_school_id: "z3_primary", documents: [] }],
  "sca/contribution": [{ amount_kes: 300, month: "2026-10" }],
  "sca/dependant": [{ evidence: "desk" }],
  "sps/passport_renewal": [34, 50, 66].flatMap((pages) =>
    ["home", "collect"].map((receive) => ({ pages, receive }))
  ),
  "sco/business_registration": [
    { name: "Njoroge Solar", type: "business_name" },
    { name: "Njoroge Solar", type: "company" },
  ],
  "sco/trading_permit": [{ business_ref: "SCO-1A2B3C4D" }],
};

Deno.test("K5 (MED-301): every asks-first service reads back in English and Swahili from the rules", () => {
  for (const a of Object.values(AGENCIES)) {
    for (const [id, def] of Object.entries(a.services)) {
      const key = `${a.id}/${id}`;
      assert(SAMPLES[key], `no read-back sample for ${key}`);
      for (const f of SAMPLES[key]) {
        const r = def.summarize(f, child);
        assertEquals(readBackProblems(r), [], `${key} ${JSON.stringify(f)}: ${JSON.stringify(r)}`);
        // Children by first name only (charter 3.5).
        assert(!/Wanjiru|QK-/.test(r.en + r.sw), `${key}: ${r.en}`);
      }
    }
  }
});

Deno.test("K5 (MED-301): read-back amounts equal the rule outputs", () => {
  const amounts = (key: string, f: Record<string, unknown>) => {
    const [a, s] = key.split("/");
    return AGENCIES[a].services[s].summarize(f, child).items.filter((i) => i.kind === "amount")
      .map((i) => i.value);
  };
  for (const pages of [34, 50, 66]) {
    assertEquals(amounts("sps/passport_renewal", { pages, receive: "home" }), [
      passportQuote(pages)!.fee_kes,
    ]);
  }
  assertEquals(amounts("sco/business_registration", { name: "X", type: "company" }), [
    BUSINESS_FEES_KES.company,
  ]);
  assertEquals(amounts("sco/trading_permit", { business_ref: "SCO-1A2B3C4D" }), [
    TRADING_PERMIT_FEE_KES,
  ]);
  const sw =
    AGENCIES.sps.services.passport_renewal.summarize({ pages: 34, receive: "collect" }, child)
      .sw;
  assert(sw.includes("shilingi elfu saba mia tano na hamsini"), sw);
  assert(sw.includes("kurasa thelathini na nne"), sw);
});

Deno.test("K5 (MED-301): spoken items", () => {
  assertEquals(rb.amount(12050).spoken_en, "12,050 shillings");
  assertEquals(rb.amount(950).spoken_sw, "shilingi mia tisa na hamsini");
  assertEquals(rb.date("2026-10-15").spoken_en, "Thursday 15 October 2026");
  assertEquals(
    rb.date("2026-10-15").spoken_sw,
    "Alhamisi, tarehe kumi na tano Oktoba, mwaka elfu mbili na ishirini na sita",
  );
  assertEquals(rb.month("2026-10").spoken_sw, "Oktoba mwaka elfu mbili na ishirini na sita");
  // The windows match WINDOW_HOURS (8 to 12, 2 to 5).
  const morning = rb.hours("in the morning", "08:00", "12:00");
  const afternoon = rb.hours("in the afternoon", "14:00", "17:00");
  assert(morning.spoken_en.endsWith(`between ${WINDOW_HOURS.morning.replace(" to ", " and ")}`));
  assert(
    afternoon.spoken_en.endsWith(`between ${WINDOW_HOURS.afternoon.replace(" to ", " and ")}`),
  );
  assertEquals(morning.spoken_sw, "asubuhi, kati ya saa mbili na saa sita");
  assertEquals(afternoon.spoken_sw, "mchana, kati ya saa nane na saa kumi na moja");
});

Deno.test("K5 (MED-301): a read-back with digits or a missing item is refused", () => {
  const fee = rb.amount(7550);
  assertEquals(readBackProblems({ en: "Pay 7,550 shillings.", sw: "Lipa 7550.", items: [fee] }), [
    "sw lacks amount 7550",
    "sw has digits outside names and places",
  ]);
  assertEquals(
    readBackProblems({ en: "Pay.", sw: `Lipa ${fee.spoken_sw}.`, items: [fee] }),
    ["en lacks amount 7550"],
  );
});

Deno.test("K5 (MED-301): the core's read-backs (review, consent, delivery, appointment)", async () => {
  const b = await import("./readbacks.ts");
  const { formatAddress } = await import("./address.ts");
  const ap = AGENCIES.sps.services.passport_renewal.appointment!;
  const address = formatAddress({ zone: 3, block: "B12", plot: 47, unit: 2, check_code: "K7Q2ZP" });
  const all = [
    b.reviewReadBack(),
    b.consentReadBack("sia", "Imani", "2027-10-05", ["school_application", "health_cover"]),
    ...["morning", "afternoon"].flatMap((window) => [
      b.deliveryReadBack({
        item_kind: "passport",
        holderOnly: true,
        desk: "konza_passport_desk",
        address: null,
        on: "2026-10-22",
        window,
        fee_kes: 0,
      }),
      b.deliveryReadBack({
        item_kind: "resident_card",
        holderOnly: false,
        desk: null,
        address,
        on: "2026-10-22",
        window,
        fee_kes: 200,
      }),
      b.appointmentReadBack(ap, { on: "2026-10-15", window, from: null }),
      b.appointmentReadBack(ap, { on: "2026-10-16", window, from: "2026-10-15" }),
    ]),
  ];
  for (const r of all) assertEquals(readBackProblems(r), [], JSON.stringify(r));
  const consent = all[1];
  assert(consent.sw.includes("maombi ya shule, bima ya afya"), consent.sw);
  assert(consent.en.includes("until Tuesday 5 October 2027"), consent.en);
  assert(all[3].en.includes("zone three, block B twelve, plot forty-seven, unit two"), all[3].en);
  assert(all[3].sw.includes("eneo la tatu, bloku B kumi na mbili, kiwanja arobaini na saba"));
  assert(all[2].en.startsWith("The passport will be ready to collect at the Konza Passport Desk"));
  // The ready date is an estimate said after the booking, so the yes covers only the booking.
  assert(!/ready about|tayari karibu/.test(all[4].en + all[4].sw), all[4].sw);
});
