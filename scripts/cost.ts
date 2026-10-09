// deno task cost [days]   (default 7)
// Pulls the charging data of every conversation of our agents from ElevenLabs into cost_ledger,
// then prints spend by agent and kind for the current phase, the phase budget, and the credits
// left before the next reset.

import { eleven } from "./_eleven.ts";
import {
  CURRENT_PHASE,
  type LedgerRow,
  PHASES,
  phaseSpend,
  record,
  subscription,
  USD_PER_CREDIT,
} from "./_cost.ts";

const days = Number(Deno.args[0] ?? 7);
const since = Date.now() / 1000 - days * 86400;
const phaseStart = Date.parse(PHASES[CURRENT_PHASE].from) / 1000;
const agents = Object.entries(Deno.env.toObject())
  .filter(([k]) => k.startsWith("AGENT_ID_")).map(([k, v]) => [k.slice(9), v]);

const rows: LedgerRow[] = [];
for (const [key, id] of agents) {
  const list = await eleven("GET", `/conversations?agent_id=${id}&page_size=100`);
  for (const c of list.conversations ?? []) {
    if (c.start_time_unix_secs < since) continue;
    const full = await eleven("GET", `/conversations/${c.conversation_id}`);
    const m = full.metadata ?? {};
    if (!m.cost) continue;
    rows.push({
      id: c.conversation_id,
      agent_key: key,
      kind: m.phone_call ? "call" : "browser",
      phase: c.start_time_unix_secs >= phaseStart ? CURRENT_PHASE : "before",
      at: new Date(c.start_time_unix_secs * 1000).toISOString(),
      seconds: m.call_duration_secs ?? null,
      credits: Number(m.cost),
      llm_usd: m.charging?.llm_price ?? null,
      platform_usd: m.charging?.platform_price ?? null,
    });
  }
}
const stored = await record(rows);

const usd = (credits: number) => `$${(credits * USD_PER_CREDIT).toFixed(2)}`;
console.log(
  `Conversations in the last ${days} days (${
    stored ? "saved to cost_ledger" : "cost_ledger not on the live database yet, not saved"
  }):`,
);
const byAgent = new Map<string, { n: number; secs: number; credits: number }>();
for (const r of rows.filter((r) => r.phase === CURRENT_PHASE)) {
  const k = `${r.agent_key} ${r.kind}`;
  const a = byAgent.get(k) ?? { n: 0, secs: 0, credits: 0 };
  byAgent.set(k, { n: a.n + 1, secs: a.secs + (r.seconds ?? 0), credits: a.credits + r.credits });
}
for (const [k, a] of byAgent) {
  console.log(
    `  ${k.padEnd(22)} ${String(a.n).padStart(3)} calls ${String(a.secs).padStart(5)} s ${
      String(a.credits).padStart(7)
    } credits ${usd(a.credits)}`,
  );
}
const spend = await phaseSpend();
const p = PHASES[CURRENT_PHASE];
const s = await subscription();
console.log(
  `${CURRENT_PHASE}: ${spend.credits} of ${p.budget} credits (${
    usd(spend.credits)
  }, from the ${spend.source}); ` +
    `account ${s.used} of ${s.limit} used, ${s.limit - s.used} left until ${s.reset}.`,
);
