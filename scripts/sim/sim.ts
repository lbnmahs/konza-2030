// deno task sim <bulk|outage|delegation|manipulation|exclusion|all> [--seed n]
// K4 simulator (the K4 design notes (kept private) section 4). Local stack only: it reads the URL and key
// from `supabase status`, refuses anything that is not localhost, and never reads .env.
// Results go to docs/konza/sim/<family>-seed<n>.json: counts only, no personal data.

import { setup, writeResults } from "./harness.ts";

const family = Deno.args[0];
const seedAt = Deno.args.indexOf("--seed");
const seed = seedAt >= 0 ? Number(Deno.args[seedAt + 1]) : 1;
const FAMILIES = ["bulk", "outage", "delegation", "manipulation", "exclusion"];
if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a whole number");
if (![...FAMILIES, "all"].includes(family)) {
  console.error(`usage: deno task sim <${FAMILIES.join("|")}|all> [--seed n]`);
  Deno.exit(2);
}

const sim = await setup();
let failed = false;
for (const f of family === "all" ? FAMILIES : [family]) {
  const started = Date.now();
  const mod = await import(`./families/${f}.ts`);
  const result = await mod[f](sim, seed);
  const file = await writeResults(`${f}-seed${seed}`, result);
  console.log(
    `${f}: ${result.pass ? "PASS" : "FAIL"} (${
      Math.round((Date.now() - started) / 1000)
    } s) -> ${file}`,
  );
  failed ||= !result.pass;
}
await sim.audit.end();
Deno.exit(failed ? 1 : 0);
