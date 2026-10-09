// The Mirror Vale Audit Office's checker (K4, MED-272; the K4 design notes (kept private) section 2).
// Deterministic checks C1 to C8 over a snapshot of the Konza logs. Pure functions: the snapshot
// is read by audit/snapshot.ts, and audit/breaker.ts acts on the findings.

import { ageOn, daysBetween, nairobiDay, plusMonths, REFERENCE as R } from "./reference.ts";

type Row = Record<string, any>;

export type Snapshot = {
  applications: Row[];
  decisions: Row[];
  consents: Row[];
  deliveries: Row[];
  appeals: Row[];
  confirmations: Row[];
  events: Row[];
  citizens: Row[];
  passports: Row[];
  addresses: Row[];
  guardianships: Row[];
  schools: Row[];
  holds: Row[];
  payments: Row[];
  appointments: Row[];
};

export type Finding = {
  check: "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9";
  code: string;
  /** hold: opens the circuit breaker; report: an officer looks; info: no action. */
  severity: "hold" | "report" | "info";
  agency?: string;
  service?: string;
  rule_ids: string[];
  ref?: string;
};

/** What a clean history looked like, per service (C6). */
export type Baseline = Record<
  string,
  {
    n: number;
    granted: number;
    amounts: Record<string, number[]>;
    margins: Record<string, [number, number]>;
    /** The nearest date a clean history did not grant: where the rule's boundary lies. */
    notGrantedFrom: Record<string, number>;
  }
>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const by = <T extends Row>(rows: T[], key: string) => new Map(rows.map((r) => [r[key], r]));

type Joined = { d: Row; a: Row; key: string; day: string; held: boolean };

function join(s: Snapshot): Joined[] {
  const apps = by(s.applications, "id");
  const holds = new Set((s.holds ?? []).map((h) => h.id));
  return s.decisions.flatMap((d) => {
    const a = apps.get(d.application_id);
    if (!a) return [];
    // Held only if it waits for an officer and every hold it names exists (MED-280).
    const ids = d.inputs?.held_by;
    const held = d.outcome === "pending_officer" && Array.isArray(ids) &&
      ids.every((h: string) => holds.has(h));
    return [{
      d,
      a,
      key: `${a.agency}/${a.service}`,
      day: nairobiDay(d.decided_at ?? d.created_at),
      held,
    }];
  });
}

const ruleGrant = (j: Joined) => j.d.outcome === "granted" && j.d.decided_by === "rule";
const isHeld = (j: Joined) => j.held;
const RESERVED = ["held_by", "effect_failed"];
/** Amounts written in a decision's text, e.g. "KES 7,550". */
const quoted = (t: unknown) =>
  [...String(t ?? "").matchAll(/KES\s?([0-9][0-9,]*)/g)].map((m) => Number(m[1].replace(/,/g, "")));

/** The amount key: an input ending in _kes, keyed by the application's numeric fields. */
function amountEntries(j: Joined): [string, number][] {
  const cond = Object.entries(j.a.fields ?? {}).filter(([, v]) => typeof v === "number")
    .sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => `${k}=${v}`).join(",");
  return Object.entries(j.d.inputs ?? {}).filter(([k, v]) =>
    k.endsWith("_kes") && typeof v === "number"
  )
    .map(([k, v]) => [`${k}|${cond}`, v as number]);
}

function marginEntries(j: Joined): [string, number][] {
  return Object.entries(j.d.inputs ?? {}).filter(([, v]) =>
    typeof v === "string" && ISO_DAY.test(v)
  )
    .map(([k, v]) => [k, daysBetween(j.day, v as string)]);
}

export function baseline(s: Snapshot): Baseline {
  const out: Baseline = {};
  for (const j of join(s)) {
    if (j.d.decided_by === "officer" || isHeld(j)) continue;
    const b = out[j.key] ??= { n: 0, granted: 0, amounts: {}, margins: {}, notGrantedFrom: {} };
    b.n++;
    if (!ruleGrant(j)) {
      for (const [k, v] of marginEntries(j)) {
        b.notGrantedFrom[k] = Math.min(b.notGrantedFrom[k] ?? Infinity, v);
      }
      continue;
    }
    b.granted++;
    for (const [k, v] of amountEntries(j)) {
      (b.amounts[k] ??= []).includes(v) || b.amounts[k].push(v);
    }
    for (const [k, v] of marginEntries(j)) {
      const m = b.margins[k] ??= [v, v];
      m[0] = Math.min(m[0], v);
      m[1] = Math.max(m[1], v);
    }
  }
  return out;
}

export type Options = { checks?: Finding["check"][]; baseline?: Baseline; minSample?: number };

export function check(s: Snapshot, opts: Options = {}): Finding[] {
  const on = (c: Finding["check"]) => !opts.checks || opts.checks.includes(c);
  const out: Finding[] = [];
  const joined = join(s);
  const citizens = by(s.citizens, "id");
  const addresses = by(s.addresses, "citizen_id");
  const schools = by(s.schools, "id");
  const passportsOf = (id: string) => s.passports.filter((p) => p.citizen_id === id);
  const at = (j: Joined, f: Omit<Finding, "agency" | "service" | "ref">) =>
    out.push({ ...f, agency: j.a.agency, service: j.a.service, ref: j.d.id });

  for (const j of joined) {
    const { d } = j;
    if (on("C1")) {
      if (String(d.reason_en ?? "").length < 10) {
        at(j, { check: "C1", code: "no_reason", severity: "report", rule_ids: d.rule_ids ?? [] });
      }
      if (!d.rule_ids?.length) {
        at(j, { check: "C1", code: "no_rule_ids", severity: "report", rule_ids: [] });
      }
      const unknown = (d.rule_ids ?? []).filter((r: string) => !R.ruleIds.has(r));
      if (unknown.length) {
        at(j, { check: "C1", code: "unknown_rule", severity: "report", rule_ids: unknown });
      }
      if (d.decided_by && !d.decided_at) {
        at(j, {
          check: "C1",
          code: "no_review_route",
          severity: "report",
          rule_ids: d.rule_ids ?? [],
        });
      }
    }
    if (on("C2")) {
      if (d.decided_by === "rule" && d.outcome !== "granted") {
        at(j, {
          check: "C2",
          code: "adverse_by_rule",
          severity: "hold",
          rule_ids: d.rule_ids ?? [],
        });
      }
      if (["refused", "offered_alternative"].includes(d.outcome) && d.decided_by !== "officer") {
        at(j, {
          check: "C2",
          code: "adverse_not_by_officer",
          severity: "hold",
          rule_ids: d.rule_ids ?? [],
        });
      }
    }
    if (
      on("C2") && d.outcome === "granted" && RESERVED.some((k) => Object.hasOwn(d.inputs ?? {}, k))
    ) {
      at(j, {
        check: "C2",
        code: "reserved_key_on_grant",
        severity: "hold",
        rule_ids: d.rule_ids ?? [],
      });
    }
    if (on("C5") && ruleGrant(j)) {
      // Every amount the text quotes must be one the decision records (MED-280).
      const recorded = Object.entries(d.inputs ?? {}).filter(([k]) => k.endsWith("_kes")).map((
        [, v],
      ) => v);
      if ([...quoted(d.reason_en), ...quoted(d.next_en)].some((v) => !recorded.includes(v))) {
        at(j, {
          check: "C5",
          code: "quoted_amount_mismatch",
          severity: "hold",
          rule_ids: d.rule_ids ?? [],
        });
      }
      const subject = citizens.get(j.a.subject_citizen_id);
      if (j.key === "sps/passport_renewal") {
        const fee = R.passportFeesKes[Number(j.a.fields?.pages)];
        if (d.inputs?.fee_kes !== fee) {
          at(j, { check: "C5", code: "fee_wrong", severity: "hold", rule_ids: ["PP-01"] });
        }
        const pp = passportsOf(j.a.subject_citizen_id).find((p) => p.expires === d.inputs?.expires);
        if (!pp) {
          at(j, {
            check: "C5",
            code: "input_not_on_record",
            severity: "hold",
            rule_ids: ["PP-02"],
          });
        }
        const open = j.a.fields?.full_or_damaged === true ||
          String(d.inputs?.expires) <= plusMonths(j.day, R.renewalOpensMonths);
        if (!open) {
          at(j, { check: "C5", code: "renewal_not_open", severity: "hold", rule_ids: ["PP-02"] });
        }
      } else if (j.key === "siln/primary_place") {
        const age = subject ? ageOn(subject.dob, j.day) : -1;
        if (age < R.primaryAges[0] || age > R.primaryAges[1]) {
          at(j, { check: "C5", code: "age_outside", severity: "hold", rule_ids: ["ED-06"] });
        }
        const zone = addresses.get(j.a.subject_citizen_id)?.zone ??
          addresses.get(j.a.applicant_citizen_id)?.zone;
        const school = schools.get(String(d.inputs?.school_id ?? j.a.fields?.preferred_school_id));
        if (!school || school.zone !== zone) {
          at(j, { check: "C5", code: "outside_catchment", severity: "hold", rule_ids: ["ED-03"] });
        }
      } else if (j.key === "sca/contribution") {
        const amount = d.inputs?.contribution_kes;
        if (amount !== j.a.fields?.amount_kes || !(amount >= R.shMinContributionKes)) {
          at(j, { check: "C5", code: "fee_wrong", severity: "hold", rule_ids: ["SH-02"] });
        }
      } else if (j.key === "sca/dependant") {
        if (!subject || ageOn(subject.dob, j.day) >= 18) {
          at(j, { check: "C5", code: "age_outside", severity: "hold", rule_ids: ["SH-03"] });
        }
        if (d.inputs?.document !== "birth_certificate") {
          at(j, { check: "C5", code: "evidence_wrong", severity: "hold", rule_ids: ["SH-03"] });
        }
      } else if (j.key === "sco/business_registration") {
        const fee = R.businessFeesKes[String(j.a.fields?.type)];
        if (d.inputs?.fee_kes !== fee) {
          at(j, {
            check: "C5",
            code: "fee_wrong",
            severity: "hold",
            rule_ids: [j.a.fields?.type === "company" ? "BZ-02" : "BZ-01"],
          });
        }
        if (R.reservedName.test(String(j.a.fields?.name ?? ""))) {
          at(j, {
            check: "C5",
            code: "reserved_name_granted",
            severity: "hold",
            rule_ids: ["BZ-05"],
          });
        }
      } else if (j.key === "sco/trading_permit") {
        if (d.inputs?.fee_kes !== R.tradingPermitKes) {
          at(j, { check: "C5", code: "fee_wrong", severity: "hold", rule_ids: ["BZ-04"] });
        }
      } else if (j.key === "srr/address_registration" || j.key === "srr/child_registration") {
        const ok = j.key === "srr/address_registration"
          ? ["tenancy", "employer_letter"]
          : ["birth_certificate"];
        if (!ok.includes(String(d.inputs?.document))) {
          at(j, {
            check: "C5",
            code: "evidence_wrong",
            severity: "hold",
            rule_ids: [j.key === "srr/address_registration" ? "AR-02" : "AR-03"],
          });
        }
      } else {
        at(j, { check: "C5", code: "no_reference", severity: "info", rule_ids: d.rule_ids ?? [] });
      }
    }
    if (on("C4")) {
      if (j.a.applicant_citizen_id !== j.a.subject_citizen_id) {
        const scope = R.consentScopes[j.key];
        const c = s.consents.find((x) => x.id === j.a.consent_id);
        const when = j.a.created_at;
        const valid = scope && c && c.grantor_citizen_id === j.a.applicant_citizen_id &&
          c.subject_citizen_id === j.a.subject_citizen_id && c.scopes?.includes(scope) &&
          c.created_at <= when && c.expires_at > when && (!c.withdrawn_at || c.withdrawn_at > when);
        if (!valid) {
          at(j, {
            check: "C4",
            code: scope ? "consent_invalid" : "self_only",
            severity: "hold",
            rule_ids: d.rule_ids ?? [],
          });
        }
      }
    }
  }

  if (on("C4") || on("C5")) {
    for (const c of s.consents) {
      const guardian = s.guardianships.some((g) =>
        g.guardian_citizen_id === c.grantor_citizen_id &&
        g.child_citizen_id === c.subject_citizen_id
      );
      if (on("C4") && !guardian) {
        out.push({
          check: "C4",
          code: "consent_not_guardian",
          severity: "report",
          rule_ids: ["AR-03"],
          ref: c.id,
        });
      }
      const subject = citizens.get(c.subject_citizen_id);
      if (on("C5") && subject) {
        const [y, m, d] = subject.dob.split("-");
        const eighteenth = Date.parse(`${Number(y) + 18}-${m}-${d}T00:00:00+03:00`);
        const yearOn = Date.parse(c.created_at) + (R.consentDefaultDays + 1) * 86_400_000;
        if (Date.parse(c.expires_at) > Math.min(eighteenth, yearOn)) {
          out.push({
            check: "C5",
            code: "consent_too_long",
            severity: "report",
            rule_ids: ["AR-03"],
            ref: c.id,
          });
        }
      }
    }
  }

  // MED-296: a fee is paid once, and nothing is booked or handed over before it is paid. The fee
  // is the amount the decision recorded.
  if (on("C5")) {
    const approved = (ref: string) =>
      (s.payments ?? []).filter((p) => p.case_ref === ref && p.status === "approved");
    for (const j of joined.filter(ruleGrant)) {
      const fee = Number(j.d.inputs?.fee_kes ?? j.d.inputs?.contribution_kes ?? 0);
      if (!fee) continue;
      const paid = approved(j.a.ref);
      const total = paid.reduce((n, p) => n + Number(p.amount), 0);
      if (total > fee || paid.length > 1) {
        at(j, {
          check: "C5",
          code: "paid_twice",
          severity: "report",
          rule_ids: ["PY-01", "PY-02"],
        });
      }
      const paidAt = paid.map((p) => p.created_at).sort()[0];
      const before = (when: string) => !paidAt || when < paidAt;
      const booked = [
        ...(s.appointments ?? []).filter((x) => x.application_id === j.a.id),
        ...s.deliveries.filter((x) => x.item_ref === j.a.id),
      ];
      if (booked.some((x) => before(x.created_at))) {
        at(j, { check: "C5", code: "before_payment", severity: "report", rule_ids: ["PP-03"] });
      }
    }
  }

  if (on("C5")) {
    for (const dl of s.deliveries) {
      const day = nairobiDay(dl.created_at);
      const wd = new Date(`${dl.deliver_on}T00:00:00Z`).getUTCDay();
      const gap = daysBetween(day, dl.deliver_on);
      if (dl.fee_kes !== R.deliveryFeeKes) {
        out.push({
          check: "C5",
          code: "delivery_fee_wrong",
          severity: "report",
          rule_ids: ["AD-04"],
          ref: dl.id,
        });
      }
      if (wd === 0 || wd === 6 || gap < 1 || gap > R.deliveryWithinDays) {
        out.push({
          check: "C5",
          code: "delivery_date_wrong",
          severity: "report",
          rule_ids: ["AD-03"],
          ref: dl.id,
        });
      }
    }
  }

  if (on("C3") || on("C7")) {
    const count = (rows: Row[], f: (r: Row) => string) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
      return m;
    };
    const committed = s.confirmations.filter((c) =>
      c.committed_at && String(c.tool).startsWith("konza:")
    );
    if (on("C3")) {
      for (const c of committed) {
        const gap = Date.parse(c.committed_at) - Date.parse(c.created_at);
        if (gap < R.confirmMinGapMs || gap > R.confirmTtlMs) {
          out.push({
            check: "C3",
            code: "commit_outside_window",
            severity: "report",
            rule_ids: [],
            ref: c.id,
          });
        }
      }
    }
    const commits = count(committed, (c) => `${c.conversation_id}|${c.tool}`);
    const okEvents = count(
      s.events.filter((e) => e.outcome === "ok"),
      (e) => `${e.session}|${e.operation}`,
    );
    const writes: [Row[], (r: Row) => string, string][] = [
      [s.applications, (a) => `submitApplication:${a.agency}/${a.service}`, "submitApplication"],
      [s.deliveries, () => "bookDelivery", "bookDelivery"],
      [s.consents, () => "recordConsent", "recordConsent"],
      [s.appeals, () => "appealDecision", "appealDecision"],
    ];
    for (const [rows, tool, op] of writes) {
      for (const [k, n] of count(rows, (r) => `${r.session}|${tool(r)}`)) {
        const [session] = k.split("|");
        if (on("C3") && (commits.get(`${session}|konza:${k.split("|")[1]}`) ?? 0) < n) {
          out.push({
            check: "C3",
            code: "commit_without_prepare",
            severity: "report",
            rule_ids: [],
            ref: `${op}:${n}`,
          });
        }
        if (on("C7") && (okEvents.get(`${session}|${op}`) ?? 0) < n) {
          out.push({
            check: "C7",
            code: "unlogged_write",
            severity: "report",
            rule_ids: [],
            ref: `${op}:${n}`,
          });
        }
      }
    }
    if (on("C7")) {
      const officer = s.decisions.filter((d) => d.decided_by === "officer").length;
      const logged = s.events.filter((e) =>
        e.operation === "decideAsOfficer" && e.outcome === "ok"
      ).length;
      if (logged < officer) {
        out.push({
          check: "C7",
          code: "unlogged_officer_decision",
          severity: "report",
          rule_ids: [],
          ref: `${officer - logged}`,
        });
      }
    }
  }

  // C8 (K5, MED-302): an asks-first step went through without the read-back's amounts and dates
  // being said, or without a clear yes (from the post-call transcript; charter 4.3). An officer
  // looks; it never opens a hold, since the transcript arrives after the call.
  if (on("C8")) {
    for (const e of s.events) {
      if (!String(e.operation).startsWith("readBack:") || e.outcome === "ok") continue;
      out.push({
        check: "C8",
        code: "readback_missed",
        severity: "report",
        agency: e.agency ?? undefined,
        rule_ids: [],
        ref: String(e.operation).slice("readBack:".length),
      });
    }
  }

  if (on("C6") && opts.baseline) out.push(...drift(joined, opts.baseline, opts.minSample ?? 20));
  return out;
}

/** C6: the bulk-harm signal. Compares the service's recent behaviour with a clean history:
 * amounts never seen for the same inputs, dates outside the historical range, grant rates
 * outside the band. */
function drift(joined: Joined[], base: Baseline, minSample: number): Finding[] {
  const out: Finding[] = [];
  const live = joined.filter((j) => j.d.decided_by !== "officer" && !isHeld(j));
  const services = new Map<string, Joined[]>();
  for (const j of live) services.set(j.key, [...(services.get(j.key) ?? []), j]);
  for (const [key, js] of services) {
    const b = base[key];
    const [agency, service] = key.split("/");
    if (!b) {
      out.push({
        check: "C6",
        code: "no_baseline",
        severity: "info",
        agency,
        service,
        rule_ids: [],
      });
      continue;
    }
    for (const j of js.filter(ruleGrant)) {
      for (const [k, v] of amountEntries(j)) {
        if (!b.amounts[k]?.includes(v)) {
          out.push({
            check: "C6",
            code: "amount_drift",
            severity: "hold",
            agency,
            service,
            rule_ids: j.d.rule_ids,
            ref: j.d.id,
          });
        }
      }
      for (const [k, v] of marginEntries(j)) {
        const m = b.margins[k];
        const edge = b.notGrantedFrom[k];
        const pastEdge = m && edge !== undefined && edge > m[1] && v >= edge;
        if (m && (v < m[0] - 3 || v > m[1] + 3 || pastEdge)) {
          out.push({
            check: "C6",
            code: "date_drift",
            severity: "hold",
            agency,
            service,
            rule_ids: j.d.rule_ids,
            ref: j.d.id,
          });
        }
      }
    }
    if (js.length >= minSample && b.n >= minSample) {
      const p0 = b.granted / b.n;
      const p = js.filter(ruleGrant).length / js.length;
      const band = 3 * Math.sqrt((p0 * (1 - p0)) / js.length) + 0.05;
      const rules = [...new Set(js.filter(ruleGrant).flatMap((j) => j.d.rule_ids as string[]))];
      if (p > p0 + band) {
        out.push({
          check: "C6",
          code: "rate_high",
          severity: "hold",
          agency,
          service,
          rule_ids: rules,
        });
      }
      if (p < p0 - band) {
        out.push({
          check: "C6",
          code: "rate_low",
          severity: "info",
          agency,
          service,
          rule_ids: rules,
        });
      }
    }
  }
  return out;
}

/** Counts by check and code, for results files (no personal data). */
export function tally(findings: Finding[]) {
  const t: Record<string, number> = {};
  for (const f of findings) t[`${f.check}:${f.code}`] = (t[`${f.check}:${f.code}`] ?? 0) + 1;
  return t;
}
