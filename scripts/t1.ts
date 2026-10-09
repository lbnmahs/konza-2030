// deno task t1 <agent key> [repeat] [name filter]   e.g. deno task t1 ke 1
// The filter may list several parts with |: deno task t1 konza 1 "collection|spouse" runs only those.
// T1: ElevenLabs simulation tests for a country agent, from tests/t1/<key>.json. Every tool is
// mocked (backend rules and gates are covered by deno task test:local), so these tests check
// routing, language, scope and what the agent says. Refuses to start when the phase budget
// (scripts/_cost.ts) cannot cover the run; records each run's credits in cost_ledger.

import { eleven, env } from "./_eleven.ts";
import { CURRENT_PHASE, record, requireBudget, USD_PER_CREDIT } from "./_cost.ts";

const [keyArg = "", repeatArg = "1", filter = ""] = Deno.args;
// K3: scene files run against an agent of another key (tests/t1/k3.json against KONZA).
const FILE_AGENT: Record<string, string> = { k3: "KONZA" };
const key = FILE_AGENT[keyArg.toLowerCase()] ?? keyArg.toUpperCase();
const repeat = Math.max(1, Math.min(5, Number(repeatArg) || 1));
const agentId = env(`AGENT_ID_${key}`);
type Mock = { when?: Record<string, string>; result: unknown; is_error?: boolean };
const specs: {
  name: string;
  scenario: string;
  conditions: string[];
  max_turns?: number;
  /** K5: this test's own mocks by tool name, tried before the shared ones (state such as a paid fee). */
  mocks?: Record<string, Mock[]>;
}[] = JSON
  .parse(
    await Deno.readTextFile(new URL(`../tests/t1/${keyArg.toLowerCase()}.json`, import.meta.url)),
  )
  .filter((t: any) => !filter || filter.split("|").some((f) => t.name.includes(f)));

// About 1,000 credits per simulated run (S0 measured 586 on a smaller agent).
await requireBudget(specs.length * repeat * 1000);

// Mock replies (tests/t1/mocks.json) are stored on the workspace tools; they only apply in tests.
const mocks = JSON.parse(
  await Deno.readTextFile(new URL("../tests/t1/mocks.json", import.meta.url)),
);
const asMock = (m: Mock) => ({
  mock_result: JSON.stringify(m.result),
  is_error: m.is_error ?? false,
  parameter_conditions: Object.entries(m.when ?? {}).map(([path, pattern]) => ({
    path,
    eval: { type: "regex", pattern },
  })),
});
const toolId: Record<string, string> = {};
for (const t of (await eleven("GET", "/tools")).tools ?? []) {
  toolId[t.tool_config?.name] = t.id;
  const list = mocks[t.tool_config?.name];
  if (!Array.isArray(list)) continue;
  await eleven("PATCH", `/tools/${t.id}`, {
    tool_config: t.tool_config,
    response_mocks: list.map(asMock),
  });
}
const overrides = (m: Record<string, Mock[]> = {}) =>
  Object.fromEntries(
    Object.entries(m).map(([name, list]) => {
      if (!toolId[name]) throw new Error(`mocks: unknown tool ${name}`);
      return [toolId[name], list.map(asMock)];
    }),
  );

const prefix = `T1 ${key} `;
const existing = (await eleven("GET", "/agent-testing?page_size=100")).tests ?? [];
const ids: string[] = [];
for (const s of specs) {
  const old = existing.find((t: any) => t.name === prefix + s.name);
  if (old) await eleven("DELETE", `/agent-testing/${old.id}`);
  ids.push(
    (await eleven("POST", "/agent-testing/create", {
      name: prefix + s.name,
      type: "simulation",
      simulation_scenario: s.scenario,
      success_conditions: s.conditions,
      simulation_max_turns: s.max_turns ?? 12,
      tool_mock_config: { mocking_strategy: "all", fallback_strategy: "raise_error" },
      tool_mock_overrides: overrides(s.mocks),
      chat_history: [],
    })).id,
  );
}

const suite = await eleven("POST", `/agents/${agentId}/run-tests`, {
  tests: ids.map((test_id) => ({ test_id })),
  repeat_count: repeat,
});
console.log(`Suite ${suite.id}: ${suite.test_runs.length} runs on ${key}`);
let r: any;
do {
  await new Promise((res) => setTimeout(res, 15000));
  r = await eleven("GET", `/test-invocations/${suite.id}`);
} while (r.test_runs.some((t: any) => t.status === "pending"));

let credits = 0, passed = 0;
for (const t of r.test_runs) {
  credits += t.credits_used ?? 0;
  if (t.status === "passed") passed++;
  console.log(
    `${t.status.padEnd(7)} ${t.test_name.slice(prefix.length)}  (${t.credits_used} credits)`,
  );
  if (t.status !== "passed") {
    const msgs = t.condition_result?.rationale?.messages ?? [];
    for (const m of msgs.filter((m: string) => /fail/i.test(m))) {
      console.log(`        ${m.slice(0, 300)}`);
    }
  }
}
const stored = await record(r.test_runs.map((t: any) => ({
  id: t.test_run_id,
  agent_key: key,
  kind: "test",
  phase: CURRENT_PHASE,
  at: new Date().toISOString(),
  seconds: null,
  credits: t.credits_used ?? 0,
  llm_usd: null,
  platform_usd: null,
})));
console.log(
  `${passed}/${r.test_runs.length} passed, ${credits} credits ($${
    (credits * USD_PER_CREDIT).toFixed(2)
  })` +
    (stored ? "" : "; cost_ledger not on the live database yet, counter used"),
);
