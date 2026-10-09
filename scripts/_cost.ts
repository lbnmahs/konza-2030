// Cost harness shared by `deno task cost` and the T1 runner (P13 D10).
// Spend is recorded per conversation or test run in cost_ledger. Each phase has a credit
// budget; the T1 runner refuses to start once the phase budget is spent. Until cost_ledger
// exists on the live database, spend is the subscription counter minus the phase baseline.

import { createClient } from "npm:@supabase/supabase-js@2";
import { eleven, env } from "./_eleven.ts";

/** Credit budgets per phase. Baseline: credits used at the start. */
export const PHASES: Record<string, { from: string; budget: number; baseline: number }> = {
  // P13 raised from 50k to 60k on 1 Oct for the routing fix check, after Mahs added funds.
  P13: { from: "2026-10-01T11:00:00Z", budget: 60_000, baseline: 364_122 },
  P14: { from: "2026-10-01T15:40:00Z", budget: 45_000, baseline: 423_241 },
  // K3 (plan-k3 section 4, MED-292): 65k credits for T1 (k3.json, konza.json) and Mahs's 3 calls.
  // Mahs fills `from` and `baseline` from `deno task cost` after the top-up, before any run;
  // until then requireBudget refuses every run.
  // Set on 6 Oct after Mahs added 20 USD (counter 472,965 of 583,000).
  K3: { from: "2026-10-06T08:42:00Z", budget: 65_000, baseline: 472_965 },
  // K5 (plan-k5 section 4, MED-305): 65k credits for T1 (konza.json, 30 tests, run twice) and
  // Mahs's 2 calls; the bake-off clips were dropped on 7 Oct. Baseline set by Mahs on 7 Oct.
  // Raised to 75k, then 85k on 7 Oct for T1 reruns after Mahs added credits (limit 748,000).
  K5: { from: "2026-10-07T09:00:00Z", budget: 85_000, baseline: 549_127 },
  // K6 (plan-k6 section 4, MED-261): 60k credits for the T1 regression (47 tests) and Mahs's dry
  // run, approved by Mahs on 8 Oct; baseline from deno task cost the same day. The counter resets
  // when credits renew on 14 Oct: a run after that needs a new baseline first.
  // Raised to 75k by Mahs on 8 Oct for the 8 T1 reruns and the dry run.
  K6: { from: "2026-10-08T09:10:00Z", budget: 75_000, baseline: 635_005 },
  // K7 (plan-k7 section 4, MED-262): 5k credits for Mahs's Swahili script call (MED-304), approved
  // by Mahs on 8 Oct. Baseline from deno task cost the same day; the counter resets on 14 Oct.
  K7: { from: "2026-10-08T14:00:00Z", budget: 5_000, baseline: 709_812 },
};
export const CURRENT_PHASE = "K7";

/** ElevenLabs Creator: 1,000 credits is about $0.18 (measured on early test calls). */
export const USD_PER_CREDIT = 1.19 / 6565;

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

export type LedgerRow = {
  id: string;
  agent_key: string | null;
  kind: "call" | "test" | "browser";
  phase: string;
  at: string;
  seconds: number | null;
  credits: number;
  llm_usd: number | null;
  platform_usd: number | null;
};

/** Writes rows; returns false when cost_ledger is not on the live database yet. */
export async function record(rows: LedgerRow[]): Promise<boolean> {
  if (!rows.length) return true;
  const { error } = await db.from("cost_ledger").upsert(rows);
  if (error && /cost_ledger/.test(error.message)) return false;
  if (error) throw new Error(error.message);
  return true;
}

export async function subscription() {
  const s = await eleven("GET", "/v1/user/subscription");
  return {
    used: Number(s.character_count),
    limit: Number(s.character_limit),
    reset: new Date(Number(s.next_character_count_reset_unix) * 1000).toISOString().slice(0, 10),
  };
}

/** Credits spent in the phase so far: from the ledger, or the counter if there is no ledger. */
export async function phaseSpend(
  phase = CURRENT_PHASE,
): Promise<{ credits: number; source: string }> {
  // The ledger misses spend from before it existed, and the counter resets with the plan
  // month; report whichever is larger.
  const { data, error } = await db.from("cost_ledger").select("credits").eq("phase", phase);
  const ledger = error ? 0 : data.reduce((n, r) => n + Number(r.credits), 0);
  const s = await subscription();
  if (!Number.isFinite(PHASES[phase].baseline)) {
    return { credits: 0, source: `baseline not set (counter now ${s.used})` };
  }
  const counter = Math.max(0, s.used - PHASES[phase].baseline);
  return ledger >= counter
    ? { credits: ledger, source: "ledger" }
    : { credits: counter, source: "counter" };
}

/** Throws when the phase budget does not leave room for `estimate` more credits. */
export async function requireBudget(estimate: number, phase = CURRENT_PHASE) {
  if (!PHASES[phase].from || !Number.isFinite(PHASES[phase].baseline)) {
    throw new Error(
      `${phase} has no baseline yet: run deno task cost, then set from and baseline in scripts/_cost.ts. Stopping.`,
    );
  }
  const { credits, source } = await phaseSpend(phase);
  const left = PHASES[phase].budget - credits;
  if (left < estimate) {
    throw new Error(
      `${phase} budget: ${credits} of ${PHASES[phase].budget} credits spent (${source}), ` +
        `${left} left, this run needs about ${estimate}. Stopping.`,
    );
  }
  return left;
}
