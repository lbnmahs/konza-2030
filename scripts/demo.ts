// deno task demo ke
// 1. Registers authorities and agents, then resets all demo data relative to today in Nairobi.
// 2. Points the imported phone number at the scenario's agent and prints what is live.

import { createClient } from "npm:@supabase/supabase-js@2";
import { AUTHORITIES } from "../supabase/functions/_shared/authorities.ts";
import { normPhone } from "../supabase/functions/_shared/outbound.ts";
import { eleven, env } from "./_eleven.ts";
import { CODES, findAgents } from "./agents.ts";
import { buildSeed, TABLE_ORDER } from "./seed/common.ts";

const code = (Deno.args[0] ?? "").toLowerCase();
const key = CODES[code];
if (!key) {
  console.error(`Usage: deno task demo ${Object.keys(CODES).join("|")}`);
  Deno.exit(1);
}
const agentId = Deno.env.get(`AGENT_ID_${key}`);
if (!agentId) {
  console.error(`${code} needs agent ${key}, which is not built yet (no AGENT_ID_${key} in .env)`);
  Deno.exit(1);
}

const phoneId = env("ELEVENLABS_PHONE_NUMBER_ID");
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});
const check = (label: string, r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
};

// 1a. Authorities and every agent that exists (agent_id -> authority), so tools resolve them.
check("authorities", await db.from("authorities").upsert(Object.values(AUTHORITIES)));
const agents = [];
for (const { agent: a } of await findAgents()) {
  const id = Deno.env.get(`AGENT_ID_${a.key}`);
  if (id) {
    agents.push({
      agent_id: id,
      scenario: a.key,
      authority: a.authority,
      authority_name: a.authority_name,
      language: a.language,
      country: AUTHORITIES[a.authority]?.country ?? null,
      hub: a.hub ?? null,
    });
  }
}
check("demo_agents", await db.from("demo_agents").upsert(agents));

// 1b. Every phone number in the seed must be an allowed recipient (fail closed).
const allowed = (Deno.env.get("ALLOWED_RECIPIENTS") ?? "").split(",").map(normPhone);
for (const k of ["DEMO_UK_MOBILE"]) {
  if (!allowed.includes(normPhone(env(k)))) {
    console.error(`${k} is not in ALLOWED_RECIPIENTS in .env: refusing to seed it`);
    Deno.exit(1);
  }
}

// 1c. Wipe and reseed.
check("truncate", await db.rpc("demo_truncate"));
const { seed, today } = buildSeed(env);
for (const table of TABLE_ORDER) {
  if (seed[table]?.length) check(table, await db.from(table).insert(seed[table]));
}
console.log(
  `Reset: demo data reseeded (KE ${today.KE}; ${TABLE_ORDER.length} tables).`,
);

// 2. Point the number at the agent.
await eleven("PATCH", `/phone-numbers/${phoneId}`, { agent_id: agentId });
const phone = await eleven("GET", `/phone-numbers/${phoneId}`);
const liveId = phone.assigned_agent?.agent_id ?? phone.agent_id;
if (liveId !== agentId) {
  console.error(`Switch failed: number is on ${liveId}, expected ${agentId}`);
  Deno.exit(1);
}
const agent = await eleven("GET", `/agents/${agentId}`);
console.log(`Live: ${phone.label ?? "phone number"} -> ${agent.name} (${code})`);
