// Cost harness shared by `deno task cost` and the T1 runner (P13 D10).
// Spend is recorded per conversation or test run in cost_ledger. Each phase has a credit
// budget; the T1 runner refuses to start once the phase budget is spent. The phase total comes
// from the subscription counter minus the phase baseline (plus what was carried over a reset).

import { createClient } from "npm:@supabase/supabase-js@2";
import { eleven, env } from "./_eleven.ts";

/** Credit budgets per phase. Baseline: credits used at the start. */
/** carried: credits the phase spent before the monthly counter reset; baseline is then the new
 * counter at the reset (0). */
export const PHASES: Record<string, { from: string; budget: number; baseline: number; carried?: number }> = {
  // Each budget, and any raise Mahs approved, is recorded in that phase's plan.
  P13: { from: "2026-10-01T11:00:00Z", budget: 60_000, baseline: 364_122 },
  P14: { from: "2026-10-01T15:40:00Z", budget: 45_000, baseline: 423_241 },
  K3: { from: "2026-10-06T08:42:00Z", budget: 65_000, baseline: 472_965 },
  K5: { from: "2026-10-07T09:00:00Z", budget: 85_000, baseline: 549_127 },
  K6: { from: "2026-10-08T09:10:00Z", budget: 75_000, baseline: 635_005 },
  K7: { from: "2026-10-08T14:00:00Z", budget: 5_000, baseline: 709_812 },
  // K8 began before the monthly reset of 14 Oct: it had used 17,611 of the old allowance, and the
  // counter restarted at 0 (baseline 0).
  K8: { from: "2026-10-13T08:00:00Z", budget: 200_000, baseline: 0, carried: 17_611 },
};
export const CURRENT_PHASE = "K8";

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
  const counter = (PHASES[phase].carried ?? 0) + Math.max(0, s.used - PHASES[phase].baseline);
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
