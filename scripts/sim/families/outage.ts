// Outage family (K4, MED-273; the K4 design notes (kept private) section 3). Each dependency is cut in turn:
// SPS, SILN, the address registry, the audit log, and SILN's onGranted failing mid-write.
// Scored per operation: a read-only answer, or a refusal that names a fallback route (a case
// for an officer, or a desk). Then partial writes and false "done" are counted.

import { check, tally } from "../../../audit/checks.ts";
import { snapshot } from "../../../audit/snapshot.ts";
import { cohorts } from "../cohorts.ts";
import {
  attempt,
  caller,
  cutTables,
  fresh,
  type Outcome,
  patch,
  residents,
  type Sim,
  twoStep,
} from "../harness.ts";

const FALLBACK_CODES = new Set(["agency_unavailable", "unavailable", "audit_unavailable"]);
const PER_GROUP = 8;

type Scenario = { name: string; cut: (sim: Sim) => () => void };

function cutAgency(sim: Sim, id: string) {
  const restores: (() => void)[] = [];
  const fail = () => {
    throw new Error(`sim outage: ${id}`);
  };
  for (const def of Object.values(sim.AGENCIES[id].services)) {
    restores.push(
      patch(def, { summarize: fail, decide: fail, ...(def.onGranted ? { onGranted: fail } : {}) }),
    );
    for (const t of Object.values(def.topics)) restores.push(patch(t, { answer: fail }));
  }
  return () => restores.forEach((r) => r());
}

const SCENARIOS: Scenario[] = [
  { name: "sps", cut: (sim) => cutAgency(sim, "sps") },
  { name: "siln", cut: (sim) => cutAgency(sim, "siln") },
  { name: "address_registry", cut: (sim) => cutTables(sim.coreDb, ["addresses"]) },
  { name: "audit_log", cut: (sim) => cutTables(sim.coreDb, ["konza_audit_events"]) },
  // The decision cannot be stored after a school place was taken (MED-280): the place must be
  // given back.
  { name: "decisions_table", cut: (sim) => cutTables(sim.coreDb, ["konza_decisions"]) },
  // The audit function is down (K3, MED-286): submits still work, and the hold re-check in the
  // store transaction still runs.
  {
    name: "audit_function",
    cut: (sim) => {
      sim.core.onDecisionStored(() => {
        throw new Error("sim outage: audit function");
      });
      return () => sim.core.onDecisionStored(null);
    },
  },
  {
    name: "siln_ongranted_midwrite",
    cut: (sim) =>
      patch(sim.AGENCIES.siln.services.primary_place, {
        onGranted: () => Promise.reject(new Error("sim outage: school places")),
      }),
  },
];

type Scored = { op: string; write: boolean; o: Outcome };

function classify(s: Scored) {
  if (s.o.ok) return s.write ? "done" : "answered";
  if (FALLBACK_CODES.has(s.o.code) && /create_case|desk/i.test(s.o.say)) return "route";
  if (!s.o.konza) return "no_route";
  return "wrong_refusal";
}

export async function outage(sim: Sim, seed: number) {
  const { db, audit, core, KonzaError: K } = sim;
  const results: Record<string, unknown> = {};
  for (const sc of SCENARIOS) {
    const pop = await fresh(db, seed);
    const people = await residents(db);
    const { renewers, pupils } = cohorts(pop);
    const granted = renewers.slice(0, PER_GROUP);
    const applying = renewers.slice(PER_GROUP, 2 * PER_GROUP);
    const families = pupils.slice(0, PER_GROUP);
    if (applying.length < PER_GROUP || families.length < PER_GROUP) {
      throw new Error("cohort too small");
    }

    // Before the cut: granted passport applications (to read and deliver), parents' consents.
    const sessions = new Map<string, string>();
    const sess = (id: string) =>
      sessions.get(id) ?? sessions.set(id, `sim:outage:${sc.name}:${id}`).get(id)!;
    const as = (id: string) => caller(people.get(id), sess(id));
    const prepApps = await twoStep(
      granted.map((r) => (c) =>
        core.submitApplication(
          as(r.id),
          "sps",
          "passport_renewal",
          { pages: 34, receive: "home" },
          null,
          c,
        )
      ),
      K,
    );
    const appIds = prepApps.map((o) => (o.ok ? o.value.id : null));
    // K3 (MED-296): nothing is delivered before its fee is paid; an officer takes it at the desk.
    const officer = {
      client: "officer",
      requestId: "",
      session: null,
      resident: null,
      officer: "sim_officer",
    };
    for (const appId of appIds.filter(Boolean)) {
      await core.recordDeskPayment(
        { ...officer, requestId: crypto.randomUUID() },
        { application_id: appId!, amount_kes: 7550, desk: "konza_passport_desk" },
      );
    }
    await twoStep(
      families.map((f) => (c) =>
        core.recordConsent(as(f.guardian), {
          subject: f.child.resident_number,
          scopes: ["school_application"],
        }, c)
      ),
      K,
    );
    const places0 = await placesTaken(db);

    const restore = sc.cut(sim);
    const scored: Scored[] = [];
    const run = async (op: string, write: boolean, fn: () => Promise<any>) =>
      scored.push({ op, write, o: await attempt(fn, K) });
    try {
      await run(
        "askRules:sps/fees",
        false,
        () => core.askRules(caller(null), "sps", "passport_renewal", "fees"),
      );
      await run(
        "askRules:siln/eligibility",
        false,
        () => core.askRules(caller(null), "siln", "primary_place", "eligibility"),
      );
      for (const r of applying) {
        await run(
          "askRules:sps/renewal",
          false,
          () => core.askRules(as(r.id), "sps", "passport_renewal", "renewal"),
        );
      }
      for (const f of families) {
        await run(
          "askRules:siln/schools",
          false,
          () => core.askRules(as(f.guardian), "siln", "primary_place", "schools"),
        );
      }
      for (const [i, r] of granted.entries()) {
        if (!appIds[i]) continue;
        await run("getApplication", false, () => core.getApplication(as(r.id), appIds[i]));
        await run("getAddress", false, () => core.getAddress(as(r.id)));
      }
      const writes: [string, (c: string | null) => Promise<any>][] = [
        ...applying.map((r) =>
          [
            "submitApplication:sps",
            (c: string | null) =>
              core.submitApplication(
                as(r.id),
                "sps",
                "passport_renewal",
                { pages: 50, receive: "collect" },
                null,
                c,
              ),
          ] as [string, (c: string | null) => Promise<any>]
        ),
        ...families.map((f) =>
          [
            "submitApplication:siln",
            (c: string | null) =>
              core.submitApplication(
                as(f.guardian),
                "siln",
                "primary_place",
                { preferred_school_id: f.school },
                f.child.resident_number,
                c,
              ),
          ] as [string, (c: string | null) => Promise<any>]
        ),
        ...granted.flatMap((r, i) =>
          appIds[i]
            ? [[
              "bookDelivery",
              (c: string | null) =>
                core.bookDelivery(as(r.id), {
                  item_kind: "passport",
                  item_ref: appIds[i],
                  window: "morning",
                }, c),
            ] as [string, (c: string | null) => Promise<any>]]
            : []
        ),
      ];
      const outs = await twoStep(writes.map(([, fn]) => fn), K, 4);
      writes.forEach(([op], i) => scored.push({ op, write: true, o: outs[i] }));
    } finally {
      restore();
    }

    // After the cut: integrity.
    const snap = await snapshot(audit);
    const findings = check(snap, { checks: ["C3", "C7"] });
    const decided = new Set(snap.decisions.map((d) => d.application_id));
    const orphanApps = snap.applications.filter((a) => !decided.has(a.id)).length;
    const silnGrants = snap.decisions.filter((d) =>
      d.outcome === "granted" && snap.applications.find((a) =>
          a.id === d.application_id
        )?.agency === "siln"
    ).length;
    const placesMismatch = (await placesTaken(db)) - places0 - silnGrants;
    const kinds = scored.map(classify);
    const count = (k: string) => kinds.filter((x) => x === k).length;
    const unlogged = findings.filter((f) => f.check === "C7").length;
    const falseDone = unlogged + (placesMismatch !== 0 ? Math.abs(placesMismatch) : 0);
    const byOp: Record<string, Record<string, number>> = {};
    scored.forEach((s, i) => {
      byOp[s.op] ??= {};
      byOp[s.op][kinds[i]] = (byOp[s.op][kinds[i]] ?? 0) + 1;
    });
    results[sc.name] = {
      operations: scored.length,
      with_answer_or_route: count("answered") + count("done") + count("route"),
      no_route: count("no_route"),
      wrong_refusal: count("wrong_refusal"),
      partial_writes: orphanApps + Math.abs(placesMismatch),
      false_done: falseDone,
      by_operation: byOp,
      checker: tally(findings),
    };
  }
  const all = Object.values(results) as any[];
  const pass = all.every((r) =>
    r.no_route === 0 && r.wrong_refusal === 0 && r.partial_writes === 0 && r.false_done === 0
  );
  return {
    family: "outage",
    seed,
    targets: "100% answered or routed; 0 partial writes; 0 false done",
    pass,
    scenarios: results,
  };
}

async function placesTaken(db: Sim["db"]) {
  const { data, error } = await db.from("schools").select("places_taken");
  if (error) throw new Error(error.message);
  return data.reduce((s: number, r: any) => s + r.places_taken, 0);
}
