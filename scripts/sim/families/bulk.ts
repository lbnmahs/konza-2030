// Bulk-harm family (K4 gate, MED-273; the K4 design notes (kept private) section 3). One deliberately wrong
// rule applied to the whole population; the checker runs after every batch of 25 decisions and
// trips the circuit breaker. Scored: decisions out before the first hold, wrong decisions that
// reached residents, grants under the held rule after the hold, holds on a clean run.
//   F1 fee: the 34-page booklet charged at the 50-page fee (the rules table itself is wrong).
//   F2 catchment: every application granted at the preferred school, full or out of zone.
//   F3 window: renewal opens 13 months before expiry instead of 12.
// Each runs twice: all checks, then the drift check (C6) alone. The drift check compares with a
// history of three clean runs on other seeds, as an auditor compares with past years.

import {
  type Baseline,
  baseline,
  check,
  type Finding,
  type Snapshot,
} from "../../../audit/checks.ts";
import { toReview, trip } from "../../../audit/breaker.ts";
import { snapshot } from "../../../audit/snapshot.ts";
import { prng } from "../residents.ts";
import {
  attempt,
  caller,
  fresh,
  type Outcome,
  pool,
  residents,
  shuffle,
  type Sim,
  sleep,
  twoStep,
} from "../harness.ts";

const BATCH = 25;
type Fault = "clean" | "F1" | "F2" | "F3";
/** all: every check after each batch of 25; C6: the drift check alone; submit: every check
 * after each decision, as the live checker runs (K3, MED-286). */
type Mode = "all" | "C6" | "submit";

const ageOn = (dob: string, day: string) => {
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = day.split("-").map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
};

function inject(sim: Sim, fault: Fault): () => void {
  if (fault === "F1") {
    const before = sim.pp.PASSPORT_FEES_KES[34];
    sim.pp.PASSPORT_FEES_KES[34] = sim.pp.PASSPORT_FEES_KES[50];
    return () => {
      sim.pp.PASSPORT_FEES_KES[34] = before;
    };
  }
  if (fault === "F2") {
    const def = sim.AGENCIES.siln.services.primary_place;
    const decide = def.decide;
    def.decide = async (ctx) => {
      const d = await decide(ctx);
      if (d.outcome === "granted" || d.rule_ids.includes("ED-06")) return d;
      return {
        outcome: "granted",
        rule_ids: ["ED-03"],
        reason_en: "A place is confirmed at the preferred school.",
        inputs: { zone: d.inputs.zone, school_id: ctx.fields.preferred_school_id },
      };
    };
    return () => {
      def.decide = decide;
    };
  }
  if (fault === "F3") {
    const def = sim.AGENCIES.sps.services.passport_renewal;
    const decide = def.decide;
    def.decide = (ctx) => decide({ ...ctx, today: sim.dates.addMonths(ctx.today, 1) });
    return () => {
      def.decide = decide;
    };
  }
  return () => {};
}

/** One run over the whole population; returns the timeline and the final snapshot. */
async function run(sim: Sim, seed: number, fault: Fault, mode: Mode, base?: Baseline) {
  const { db, audit, core, KonzaError: K } = sim;
  const pop = await fresh(db, seed);
  const people = await residents(db);
  const r = prng(seed * 7919 + 17);
  const today = pop.today;
  const zoneOf = new Map(pop.rows.addresses.map((a) => [a.citizen_id as string, a.zone as number]));
  const pass = new Map(pop.rows.passports.map((p) => [p.citizen_id as string, p]));
  const in18 = sim.dates.addMonths(today, 18);
  const session = (id: string) => `sim:bulk:${fault}:${mode}:${id}`;

  type App = (c: string | null) => Promise<any>;
  const apps: { kind: "sps" | "siln"; op: App }[] = [];
  const consents: App[] = [];
  for (const res of pop.residents) {
    const p = pass.get(res.id);
    if (res.adult && p && String(p.expires) <= in18) {
      const fields = { pages: p.pages, receive: zoneOf.has(res.id) ? "home" : "collect" };
      apps.push({
        kind: "sps",
        op: (c) =>
          core.submitApplication(
            caller(people.get(res.id), session(res.id)),
            "sps",
            "passport_renewal",
            fields,
            null,
            c,
          ),
      });
    }
    const age = ageOn(res.dob, today);
    const g = pop.rows.guardianships.find((x) => x.child_citizen_id === res.id);
    const zone = zoneOf.get(res.id);
    if (!res.adult && age >= 4 && age <= 14 && g && zone) {
      const inZone = pop.rows.schools.filter((s) => s.zone === zone);
      const school = r.chance(0.75) && inZone.length
        ? r.pick(inZone)
        : r.pick(pop.rows.schools.filter((s) => s.zone !== zone));
      const parent = people.get(g.guardian_citizen_id as string);
      const child = people.get(res.id);
      consents.push((c) =>
        core.recordConsent(caller(parent, session(parent.id)), {
          subject: child.resident_number,
          scopes: ["school_application"],
        }, c)
      );
      apps.push({
        kind: "siln",
        op: (c) =>
          core.submitApplication(
            caller(parent, session(parent.id)),
            "siln",
            "primary_place",
            { preferred_school_id: school.id },
            child.resident_number,
            c,
          ),
      });
    }
  }
  // Parents consent first (one consent per parent and child).
  await twoStep(consents, K);

  const order = shuffle(apps, r.next);
  const restore = inject(sim, fault);
  const timeline: { batch: number; decisions: string[] }[] = [];
  type Hold = { batch: number; decisionsOut: number; holds: string[] };
  let firstHold = null as Hold | null;
  const findingsSeen: Finding[] = [];
  const seen = new Set<string>();
  try {
    // In submit mode the checker runs after each commit; prepares are still batched.
    const checkNow = async () => {
      const findings = check(await snapshot(audit), {
        checks: mode === "C6" ? ["C6"] : undefined,
        baseline: base,
      });
      for (const f of findings) {
        const k = `${f.check}:${f.code}:${f.ref ?? f.service}`;
        if (!seen.has(k)) seen.add(k) && findingsSeen.push(f);
      }
      const opened = await trip(audit, findings);
      if (opened.length && !firstHold) {
        firstHold = {
          batch: timeline.length - 1,
          decisionsOut: timeline.reduce((s, t) => s + t.decisions.length, 0),
          holds: opened,
        };
      }
    };
    const idOf = (o: Outcome) => (o.ok && o.value?.decision ? [o.value.decision.id as string] : []);
    for (let i = 0; i < order.length; i += BATCH) {
      const batch = order.slice(i, i + BATCH);
      if (mode === "submit") {
        const prepared = await pool(batch.map((a) => () => attempt(() => a.op(null), K)), 10);
        await sleep(4_200);
        for (const [j, a] of batch.entries()) {
          const p = prepared[j];
          const o = p.ok && p.value?.needs_confirmation
            ? await attempt(() => a.op(p.value.confirmation_id), K)
            : p;
          timeline.push({ batch: timeline.length, decisions: idOf(o) });
          await checkNow();
        }
        continue;
      }
      const outs = await twoStep(batch.map((a) => a.op), K);
      timeline.push({ batch: timeline.length, decisions: outs.flatMap(idOf) });
      if (fault === "clean" && !base) continue; // building the history: no checker
      await checkNow();
    }
  } finally {
    restore();
  }
  // Set inside checkNow, which TypeScript's narrowing does not follow.
  return {
    timeline,
    firstHold: firstHold as Hold | null,
    findingsSeen,
    snap: await snapshot(audit),
  };
}

function concat(snaps: Snapshot[]): Snapshot {
  const out = {} as Snapshot;
  for (const k of Object.keys(snaps[0]) as (keyof Snapshot)[]) out[k] = snaps.flatMap((s) => s[k]);
  return out;
}

/** Wrong decisions by the reference (scoring only; uses all checks whatever the mode). */
function wrongIds(snap: Snapshot): Set<string> {
  return new Set(
    check(snap, { checks: ["C2", "C5"] }).filter((f) => f.severity === "hold" && f.ref)
      .map((f) => f.ref!),
  );
}

export async function bulk(sim: Sim, seed: number) {
  // History: three clean runs on other seeds.
  const history: Snapshot[] = [];
  for (const s of [seed + 1000, seed + 2000, seed + 3000]) {
    history.push((await run(sim, s, "clean", "all")).snap);
  }
  const base = baseline(concat(history));

  const runs: Record<string, unknown> = {};
  let pass = true;
  for (const fault of ["clean", "F1", "F2", "F3"] as Fault[]) {
    for (const mode of ["all", "C6", "submit"] as Mode[]) {
      const { timeline, firstHold, findingsSeen, snap } = await run(sim, seed, fault, mode, base);
      const wrong = wrongIds(snap);
      const batchOf = new Map(
        timeline.flatMap((t) => t.decisions.map((d) => [d, t.batch] as const)),
      );
      const holdBatch = firstHold?.batch ?? Infinity;
      const wrongBefore = [...wrong].filter((d) =>
        (batchOf.get(d) ?? Infinity) <= holdBatch
      ).length;
      const wrongAfter = [...wrong].filter((d) => (batchOf.get(d) ?? -1) > holdBatch).length;
      const held = snap.decisions.filter((d) => Array.isArray(d.inputs?.held_by)).length;
      const decisions = timeline.reduce((s, t) => s + t.decisions.length, 0);

      // An officer clears the holds afterwards (exercises the officer path).
      const { data: open } = await sim.db.from("konza_holds").select("id").is("cleared_at", null);
      for (const h of open ?? []) {
        await sim.core.clearHold({
          client: "officer",
          requestId: crypto.randomUUID(),
          session: null,
          resident: null,
          officer: "sim_officer",
        }, h.id);
      }

      // Batches: decisions out when the hold opened. Per submit: decisions out after the first
      // wrong one (the live checker cannot act before a wrong decision exists).
      const firstWrong = Math.min(...[...wrong].map((d) => batchOf.get(d) ?? Infinity));
      const outAtFlag = !firstHold
        ? null
        : mode === "submit"
        ? firstHold.decisionsOut - firstWrong
        : firstHold.decisionsOut;
      const limit = mode === "all" ? 25 : mode === "C6" ? 50 : 5;
      const ok = fault === "clean"
        ? !firstHold
        : outAtFlag !== null && outAtFlag <= limit && wrongAfter === 0;
      pass &&= ok;
      runs[`${fault}:${mode}`] = {
        pass: ok,
        decisions,
        wrong_decisions_total: wrong.size,
        flagged: !!firstHold,
        decisions_out_at_flag: outAtFlag,
        wrong_out_before_hold: firstHold ? wrongBefore : wrong.size,
        wrong_after_hold: firstHold ? wrongAfter : null,
        held_for_officer: held,
        holds_opened: firstHold?.holds.map((h) => h.split("/").pop()) ?? [],
        grants_listed_for_review: toReview(findingsSeen.filter((f) =>
          f.severity === "hold"
        )).length,
        holds_cleared_by_officer: open?.length ?? 0,
        findings: Object.fromEntries(
          [...new Set(findingsSeen.map((f) => `${f.check}:${f.code}`))].map((
            k,
          ) => [k, findingsSeen.filter((f) => `${f.check}:${f.code}` === k).length]),
        ),
      };
    }
  }
  return {
    family: "bulk",
    seed,
    batch: BATCH,
    targets:
      "each fault flagged with <= 25 decisions out (all checks, batches), <= 50 (C6 alone), <= 5 after the first wrong one (per submit); 0 wrong grants after the hold; 0 holds on the clean run",
    history: { runs: 3, decisions: history.reduce((s, h) => s + h.decisions.length, 0) },
    pass,
    runs,
  };
}
