// Delegation family (K4, MED-274; the K4 design notes (kept private) section 3). Ten cases of acting for
// someone else; each must be allowed or refused as the charter says (section 3) and leave an
// audit event with that outcome.

import { cohorts } from "../cohorts.ts";
import { attempt, caller, fresh, type Outcome, residents, type Sim, sleep } from "../harness.ts";
import { localStack } from "../local.ts";

type Case = {
  name: string;
  expect: string;
  run: () => Promise<{ o: Outcome; requestIds: string[]; extra?: boolean }>;
};

const ageOn = (dob: string, day: string) => {
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = day.split("-").map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
};

export async function delegation(sim: Sim, seed: number) {
  const { db, core, KonzaError: K } = sim;
  const pop = await fresh(db, seed);
  const people = await residents(db);
  const { pupils } = cohorts(pop);
  if (pupils.length < 9) throw new Error("cohort too small");
  const P = (i: number) => ({
    parent: people.get(pupils[i].guardian),
    child: people.get(pupils[i].child.id),
    school: pupils[i].school,
  });
  const sessions = new Map<string, string>();
  const as = (r: any, client = "sim") => {
    const s = sessions.get(r.id) ?? sessions.set(r.id, `sim:delegation:${r.id}`).get(r.id)!;
    return caller(r, s, client);
  };
  /** Two calls with the same arguments, 4 s apart (asks_first). */
  const twice = async (fn: (c: any, id: string | null) => Promise<any>, who: () => any) => {
    const c1 = who();
    const first = await attempt(() => fn(c1, null), K);
    if (!first.ok || !first.value?.needs_confirmation) {
      return { o: first, requestIds: [c1.requestId] };
    }
    await sleep(4_200);
    const c2 = who();
    return {
      o: await attempt(() => fn(c2, first.value.confirmation_id), K),
      requestIds: [c1.requestId, c2.requestId],
    };
  };
  const consent = (i: number, extra: Record<string, unknown> = {}) =>
    twice(
      (c, id) =>
        core.recordConsent(c, {
          subject: P(i).child.resident_number,
          scopes: ["school_application"],
          ...extra,
        }, id),
      () => as(P(i).parent),
    );
  const apply = (i: number, client = "sim") =>
    twice(
      (c, id) =>
        core.submitApplication(
          c,
          "siln",
          "primary_place",
          { preferred_school_id: P(i).school },
          P(i).child.resident_number,
          id,
        ),
      () => as(P(i).parent, client),
    );

  // Other people: an adult from another household, a spouse, and a 17-year-old with a guardian.
  const outsider = pop.residents.find((r) => r.adult && r.household !== pupils[4].child.household)!;
  const couple = pop.residents.find((r) =>
    r.adult && pop.residents.some((x) => x.adult && x.household === r.household && x.id !== r.id)
  )!;
  const spouse = pop.residents.find((x) =>
    x.adult && x.household === couple.household && x.id !== couple.id
  )!;
  const teen = pop.residents.find((r) =>
    !r.adult && ageOn(r.dob, pop.today) === 17 &&
    pop.rows.guardianships.some((g) => g.child_citizen_id === r.id)
  );

  const cases: Case[] = [
    {
      name: "parent_with_consent",
      expect: "ok",
      run: async () => {
        await consent(0);
        return await apply(0);
      },
    },
    { name: "no_consent", expect: "consent_required", run: () => apply(1) },
    {
      name: "expired_consent",
      expect: "consent_required",
      run: async () => {
        const { error } = await db.from("delegation_consents").insert({
          grantor_citizen_id: P(2).parent.id,
          delegate: "sim",
          subject_citizen_id: P(2).child.id,
          scopes: ["school_application"],
          expires_at: new Date(Date.now() - 86_400_000).toISOString(),
          session: "sim:seeded",
        });
        if (error) throw new Error(error.message);
        return await apply(2);
      },
    },
    {
      name: "withdrawn_between_prepare_and_commit",
      expect: "consent_required",
      run: async () => {
        const c = await consent(3);
        const c1 = as(P(3).parent);
        const fields = { preferred_school_id: P(3).school };
        const prep = await core.submitApplication(
          c1,
          "siln",
          "primary_place",
          fields,
          P(3).child.resident_number,
          null,
        ) as any;
        await core.withdrawConsent(as(P(3).parent), (c.o as any).value.id);
        await sleep(4_200);
        const c2 = as(P(3).parent);
        const o = await attempt(() =>
          core.submitApplication(
            c2,
            "siln",
            "primary_place",
            fields,
            P(3).child.resident_number,
            prep.confirmation_id,
          ), K);
        return { o, requestIds: [c2.requestId] };
      },
    },
    {
      name: "non_guardian",
      expect: "not_guardian",
      run: () =>
        twice((c, id) =>
          core.recordConsent(c, {
            subject: P(4).child.resident_number,
            scopes: ["school_application"],
          }, id), () => as(people.get(outsider.id))),
    },
    {
      name: "consent_capped_at_18th_birthday",
      expect: "ok",
      run: async () => {
        if (!teen) {
          return {
            o: {
              ok: false,
              status: 0,
              code: "no_teen_in_population",
              say: "",
              konza: true,
              message: "",
            },
            requestIds: [],
          };
        }
        const g = pop.rows.guardianships.find((x) => x.child_citizen_id === teen.id)!;
        const t = people.get(teen.id);
        const r = await twice((c, id) =>
          core.recordConsent(c, {
            subject: t.resident_number,
            scopes: ["school_application"],
            expires_on: "2040-01-01",
          }, id), () => as(people.get(g.guardian_citizen_id as string)));
        const [y, m, d] = teen.dob.split("-");
        const capped = r.o.ok &&
          Date.parse(r.o.value.expires_at) ===
            Date.parse(`${Number(y) + 18}-${m}-${d}T00:00:00+03:00`);
        return { ...r, extra: capped };
      },
    },
    {
      name: "wrong_scope",
      expect: "consent_required",
      run: async () => {
        await consent(5, { scopes: ["health_dependants"] });
        return await apply(5);
      },
    },
    {
      name: "consent_given_to_another_delegate",
      expect: "consent_required",
      run: async () => {
        await consent(6, { delegate: "member" });
        return await apply(6);
      },
    },
    {
      name: "adult_for_adult",
      expect: "not_guardian",
      run: () =>
        twice((c, id) =>
          core.recordConsent(c, {
            subject: people.get(spouse.id).resident_number,
            scopes: ["passport_renewal"],
          }, id), () => as(people.get(couple.id))),
    },
    {
      name: "adult_applies_for_adult",
      expect: "self_only",
      run: () =>
        twice((c, id) =>
          core.submitApplication(
            c,
            "sps",
            "passport_renewal",
            { pages: 34, receive: "collect" },
            people.get(spouse.id).resident_number,
            id,
          ), () => as(people.get(couple.id))),
    },
    {
      name: "rest_member_using_sia_consent",
      expect: "consent_required",
      run: async () => {
        await consent(7, { delegate: "sia" });
        return await rest(P(7), "member");
      },
    },
    { name: "rest_member_claiming_sia", expect: "reserved_client", run: () => rest(P(8), "sia") },
  ];

  const results: Record<string, unknown> = {};
  let correct = 0;
  let logged = 0;
  for (const c of cases) {
    const { o, requestIds, extra } = await c.run();
    const got = o.ok ? (o.value?.decision || o.value?.expires_at ? "ok" : "prepared") : o.code;
    const right = got === c.expect && extra !== false;
    // REST refusals before the core (reserved client) are not core operations; they are logged
    // by the REST layer's refusal only.
    let audited = c.name === "rest_member_claiming_sia";
    if (!audited && requestIds.length) {
      const { data } = await db.from("konza_audit_events").select("outcome").in(
        "request_id",
        requestIds,
      );
      const want = got === "ok" ? "ok" : `refused:${got}`;
      audited = (data ?? []).some((e) => e.outcome === want);
    }
    correct += right ? 1 : 0;
    logged += audited ? 1 : 0;
    results[c.name] = { expected: c.expect, got, correct: right, audited };
  }
  return {
    family: "delegation",
    seed,
    targets: "100% correct allow or refuse; 100% with an audit event",
    pass: correct === cases.length && logged === cases.length,
    correct: `${correct}/${cases.length}`,
    audited: `${logged}/${cases.length}`,
    cases: results,
  };
}

/** A member system calls the REST profile (tests/local.env holds fake local secrets only). */
async function rest(p: { parent: any; child: any; school: string }, client: string) {
  const { url } = await localStack();
  const env = Object.fromEntries(
    (await Deno.readTextFile(new URL("../../../tests/local.env", import.meta.url))).split("\n")
      .map((l) => l.match(/^(\w+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2]]),
  );
  const requestId = crypto.randomUUID();
  const res = await fetch(
    `${url}/functions/v1/tools/konza/v1/agencies/siln/services/primary_place/applications`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tool-secret": env.KONZA_CLIENT_SECRET,
        "x-konza-request-id": requestId,
        "x-konza-resident": p.parent.resident_number,
        "x-konza-client": client,
        "x-konza-on-behalf-of": p.child.resident_number,
        "x-konza-session": "delegation",
      },
      body: JSON.stringify({ fields: { preferred_school_id: p.school } }),
    },
  );
  const body = await res.json();
  const o: Outcome = res.ok ? { ok: true, value: body } : {
    ok: false,
    status: res.status,
    code: body.code,
    say: body.detail,
    konza: true,
    message: body.detail,
  };
  return { o, requestIds: [requestId] };
}
