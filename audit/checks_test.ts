import { assertEquals } from "jsr:@std/assert@1";
import { baseline, check, type Finding, type Snapshot } from "./checks.ts";

const T0 = "2026-10-05T09:00:00.000Z";
const T1 = "2026-10-05T09:00:10.000Z";

/** A clean history: one passport renewal granted by rule, one school place for a child with a
 * parent's consent, one delivery; every write prepared, committed and logged. */
function clean(): Snapshot {
  return {
    applications: [
      {
        id: "a1",
        ref: "SPS-1",
        agency: "sps",
        service: "passport_renewal",
        applicant_citizen_id: "p",
        subject_citizen_id: "p",
        consent_id: null,
        fields: { pages: 34, receive: "home" },
        session: "s1",
        created_at: T1,
      },
      {
        id: "a2",
        agency: "siln",
        service: "primary_place",
        applicant_citizen_id: "p",
        subject_citizen_id: "c",
        consent_id: "k1",
        fields: { preferred_school_id: "z3" },
        session: "s1",
        created_at: T1,
      },
    ],
    decisions: [
      {
        id: "d1",
        application_id: "a1",
        outcome: "granted",
        decided_by: "rule",
        rule_ids: ["PP-02", "PP-01"],
        reason_en: "Renewal accepted.",
        inputs: { expires: "2027-03-01", pages: 34, fee_kes: 7550 },
        decided_at: T1,
        created_at: T1,
      },
      {
        id: "d2",
        application_id: "a2",
        outcome: "granted",
        decided_by: "rule",
        rule_ids: ["ED-03"],
        reason_en: "A place is confirmed.",
        inputs: { zone: 3, school_id: "z3" },
        decided_at: T1,
        created_at: T1,
      },
    ],
    consents: [{
      id: "k1",
      grantor_citizen_id: "p",
      delegate: "sia",
      subject_citizen_id: "c",
      scopes: ["school_application"],
      expires_at: "2027-10-05T20:59:59.000Z",
      withdrawn_at: null,
      session: "s1",
      created_at: T0,
    }],
    deliveries: [{
      id: "v1",
      item_ref: "a1",
      deliver_on: "2026-10-06",
      fee_kes: 200,
      session: "s1",
      created_at: T1,
    }],
    appeals: [],
    confirmations: [
      {
        id: "c1",
        conversation_id: "s1",
        tool: "konza:submitApplication:sps/passport_renewal",
        created_at: T0,
        committed_at: T1,
      },
      {
        id: "c2",
        conversation_id: "s1",
        tool: "konza:submitApplication:siln/primary_place",
        created_at: T0,
        committed_at: T1,
      },
      {
        id: "c3",
        conversation_id: "s1",
        tool: "konza:bookDelivery",
        created_at: T0,
        committed_at: T1,
      },
      {
        id: "c4",
        conversation_id: "s1",
        tool: "konza:recordConsent",
        created_at: T0,
        committed_at: T1,
      },
    ],
    events: [
      { session: "s1", operation: "submitApplication", outcome: "ok" },
      { session: "s1", operation: "submitApplication", outcome: "ok" },
      { session: "s1", operation: "bookDelivery", outcome: "ok" },
      { session: "s1", operation: "recordConsent", outcome: "ok" },
    ],
    citizens: [{ id: "p", dob: "1987-04-12" }, { id: "c", dob: "2017-03-10" }],
    passports: [{ citizen_id: "p", expires: "2027-03-01" }],
    addresses: [{ citizen_id: "p", zone: 3 }, { citizen_id: "c", zone: 3 }],
    guardianships: [{ guardian_citizen_id: "p", child_citizen_id: "c" }],
    schools: [{ id: "z3", zone: 3, capacity: 30 }, { id: "z4", zone: 4, capacity: 30 }],
    holds: [],
    payments: [{
      id: "y1",
      case_ref: "SPS-1",
      amount: 7550,
      status: "approved",
      method: "phone_code",
      created_at: T0,
    }],
    appointments: [],
  };
}

const codes = (f: Finding[]) => f.map((x) => `${x.check}:${x.code}`).sort();

Deno.test("K4 checker: a clean history has no findings", () => {
  const s = clean();
  assertEquals(codes(check(s, { baseline: baseline(s) })), []);
});

Deno.test("K4 checker C1: a decision without a reason or with an unknown rule", () => {
  const s = clean();
  s.decisions[0].reason_en = "";
  s.decisions[1].rule_ids = ["XX-99"];
  assertEquals(codes(check(s, { checks: ["C1"] })), ["C1:no_reason", "C1:unknown_rule"]);
});

Deno.test("K4 checker C2: an adverse outcome by rule opens a hold", () => {
  const s = clean();
  s.decisions[0].outcome = "refused";
  const f = check(s, { checks: ["C2"] });
  assertEquals(codes(f), ["C2:adverse_by_rule", "C2:adverse_not_by_officer"]);
  assertEquals(f[0].severity, "hold");
});

Deno.test("K4 checker C3 and C7: a write with no prepare, and a write with no audit event", () => {
  const s = clean();
  s.confirmations = s.confirmations.filter((c) => c.tool !== "konza:bookDelivery");
  s.events = s.events.filter((e) => e.operation !== "recordConsent");
  assertEquals(codes(check(s, { checks: ["C3", "C7"] })), [
    "C3:commit_without_prepare",
    "C7:unlogged_write",
  ]);
  s.confirmations[0].committed_at = "2026-10-05T09:00:01.000Z";
  assertEquals(codes(check(s, { checks: ["C3"] })).includes("C3:commit_outside_window"), true);
});

Deno.test("K4 checker C4: acting for a child without a valid consent, or consent by a non-guardian", () => {
  const s = clean();
  s.consents[0].withdrawn_at = T0;
  assertEquals(codes(check(s, { checks: ["C4"] })), ["C4:consent_invalid"]);
  const t = clean();
  t.guardianships = [];
  assertEquals(codes(check(t, { checks: ["C4"] })), ["C4:consent_not_guardian"]);
});

Deno.test("K4 checker C5: fee, renewal window, catchment, age, delivery and consent recomputed", () => {
  const s = clean();
  s.decisions[0].inputs.fee_kes = 9550;
  s.decisions[0].inputs.expires = "2028-01-01";
  s.passports[0].expires = "2028-01-01";
  s.applications[1].fields.preferred_school_id = "z4";
  s.decisions[1].inputs.school_id = "z4";
  s.deliveries[0].fee_kes = 150;
  s.consents[0].expires_at = "2030-01-01T00:00:00.000Z";
  assertEquals(codes(check(s, { checks: ["C5"] })), [
    "C5:consent_too_long",
    "C5:delivery_fee_wrong",
    "C5:fee_wrong",
    "C5:outside_catchment",
    "C5:renewal_not_open",
  ]);
  const t = clean();
  t.citizens[1].dob = "2023-05-02";
  assertEquals(codes(check(t, { checks: ["C5"] })), ["C5:age_outside"]);
});

Deno.test("K4 checker C6: amounts and dates never seen before, and grant rates out of band", () => {
  const base = baseline(clean());
  const s = clean();
  s.decisions[0].inputs.fee_kes = 9550;
  assertEquals(codes(check(s, { checks: ["C6"], baseline: base })), ["C6:amount_drift"]);
  s.decisions[0].inputs.fee_kes = 7550;
  s.decisions[0].inputs.expires = "2027-11-01";
  assertEquals(codes(check(s, { checks: ["C6"], baseline: base })), ["C6:date_drift"]);
  // A history that granted up to 361 days out and did not grant from 362: a grant 363 days out
  // is past that edge, although within 3 days of the granted range.
  const edge = clean();
  edge.decisions[0].inputs.expires = "2027-10-01";
  edge.passports[0].expires = "2027-10-01";
  edge.applications.push({ ...edge.applications[0], id: "a9" });
  edge.decisions.push({
    ...edge.decisions[0],
    id: "d9",
    application_id: "a9",
    outcome: "pending_officer",
    decided_by: null,
    inputs: { expires: "2027-10-02" },
  });
  const e = clean();
  e.decisions[0].inputs.expires = "2027-10-03";
  assertEquals(codes(check(e, { checks: ["C6"], baseline: baseline(edge) })), ["C6:date_drift"]);

  // Rate: a history granting half, then a run granting everything.
  const hist = clean();
  for (let i = 0; i < 40; i++) {
    hist.applications.push({ ...hist.applications[1], id: `h${i}` });
    hist.decisions.push({
      ...hist.decisions[1],
      id: `hd${i}`,
      application_id: `h${i}`,
      outcome: i % 2 ? "granted" : "pending_officer",
      decided_by: i % 2 ? "rule" : null,
    });
  }
  const run = clean();
  for (let i = 0; i < 30; i++) {
    run.applications.push({ ...run.applications[1], id: `r${i}` });
    run.decisions.push({ ...run.decisions[1], id: `rd${i}`, application_id: `r${i}` });
  }
  const f = check(run, { checks: ["C6"], baseline: baseline(hist) });
  assertEquals(codes(f), ["C6:rate_high"]);
  assertEquals(f[0].rule_ids, ["ED-03"]);
});

Deno.test("K4 checker (MED-280): reserved keys on a grant, quoted amounts, holds that do not exist", () => {
  const s = clean();
  s.decisions[0].inputs.held_by = ["h1"];
  s.decisions[1].next_en = "Pay KES 9,550 on the first day.";
  assertEquals(codes(check(s, { checks: ["C2", "C5"] })), [
    "C2:reserved_key_on_grant",
    "C5:quoted_amount_mismatch",
  ]);
  // A pending decision naming a hold that does not exist is not "held": C6 still sees it.
  const t = clean();
  t.decisions[0] = {
    ...t.decisions[0],
    outcome: "pending_officer",
    decided_by: null,
    inputs: { ...t.decisions[0].inputs, held_by: ["ghost"] },
  };
  const base = baseline(clean());
  assertEquals(check(t, { checks: ["C6"], baseline: base }).length, 0);
  t.holds = [];
  const counted = baseline(t)["sps/passport_renewal"].n;
  assertEquals(counted, 1, "an unproven hold is counted like any other decision");
});

Deno.test("K3 checker C5: health, business and registry decisions recomputed", () => {
  const s = clean();
  const add = (
    id: string,
    key: string,
    fields: any,
    inputs: any,
    rule_ids: string[],
    subject = "p",
  ) => {
    const [agency, service] = key.split("/");
    s.applications.push({
      ...s.applications[0],
      ref: `R-${id}`,
      id,
      agency,
      service,
      fields,
      subject_citizen_id: subject,
      applicant_citizen_id: "p",
    });
    s.decisions.push({
      ...s.decisions[0],
      id: `d_${id}`,
      application_id: id,
      rule_ids,
      inputs,
      next_en: null,
    });
  };
  add("k1", "sca/contribution", { amount_kes: 300, month: "2026-10" }, { contribution_kes: 300 }, [
    "SH-02",
  ]);
  add("k2", "sco/business_registration", { name: "Njoroge Solar", type: "business_name" }, {
    fee_kes: 950,
  }, ["BZ-01", "BZ-03"]);
  add("k3", "srr/address_registration", { evidence: "desk:x" }, { document: "tenancy" }, ["AR-02"]);
  add(
    "k4",
    "sca/dependant",
    { evidence: "desk:y" },
    { document: "birth_certificate" },
    ["SH-03"],
    "c",
  );
  assertEquals(codes(check(s, { checks: ["C5"] })), []);
  s.decisions.find((d) => d.id === "d_k1")!.inputs.contribution_kes = 200;
  s.applications.find((a) => a.id === "k2")!.fields.name = "Konza Government Solar";
  s.decisions.find((d) => d.id === "d_k3")!.inputs.document = "selfie";
  s.decisions.find((d) => d.id === "d_k4")!.application_id = "k4";
  s.applications.find((a) => a.id === "k4")!.subject_citizen_id = "p";
  assertEquals(codes(check(s, { checks: ["C5"] })), [
    "C5:age_outside",
    "C5:evidence_wrong",
    "C5:fee_wrong",
    "C5:reserved_name_granted",
  ]);
});

Deno.test("K3 checker C5 (MED-296): a fee paid twice, and a delivery booked before payment", () => {
  const s = clean();
  assertEquals(codes(check(s, { checks: ["C5"] })), []);
  s.payments.push({
    id: "y2",
    case_ref: "SPS-1",
    amount: 7550,
    status: "approved",
    method: "desk",
    created_at: T1,
  });
  assertEquals(codes(check(s, { checks: ["C5"] })), ["C5:paid_twice"]);
  const t = clean();
  t.payments[0].created_at = "2026-10-05T10:00:00.000Z";
  assertEquals(codes(check(t, { checks: ["C5"] })), ["C5:before_payment"]);
});

Deno.test("K5 checker C8: an asks-first step without a spoken read-back or a yes is reported, never held", () => {
  const s = clean();
  s.events.push(
    { session: "conv-1", operation: "readBack:application_submit", outcome: "ok", agency: "sia" },
    { session: "conv-1", operation: "readBack:payment_request", outcome: "missed", agency: "sia" },
  );
  const f = check(s, { checks: ["C8"] });
  assertEquals(codes(f), ["C8:readback_missed"]);
  assertEquals([f[0].severity, f[0].ref], ["report", "payment_request"]);
  // Read-back events never count as, or against, the logged writes C3 and C7 look for.
  assertEquals(codes(check(s, { checks: ["C3", "C7"] })), []);
});
