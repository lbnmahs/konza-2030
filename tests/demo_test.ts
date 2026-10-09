// K6 (MED-310): the public demo stays clean. Every curated scene passes the same leftovers check
// as anything sent out of the system, holds nothing from the Audit Office, and the public pages
// never read an audit table.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { leftovers } from "../audit/redact.ts";

const DIR = new URL("../web/lib/demo/", import.meta.url);
/** En and em dashes, built from their codes so no dash appears in this file. */
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const AUDIT = /mirror vale|audit office|finding|circuit breaker|\bhold\b|\bC[1-9]\b/i;

Deno.test("K6: every demo scene is redacted and free of Audit Office output", async () => {
  let n = 0;
  for await (const f of Deno.readDir(DIR)) {
    if (!f.name.endsWith(".json")) continue;
    n++;
    const s = JSON.parse(await Deno.readTextFile(new URL(f.name, DIR)));
    const turns = s.turns.map((t: { who: string; text: string }, i: number) => ({
      i,
      at: 0,
      role: t.who === "agent" ? "agent" : "user",
      text: t.text,
    }));
    assertEquals(leftovers(turns), [], f.name);
    for (const t of s.turns) {
      assert(!AUDIT.test(t.text), `${f.name}: ${t.text}`);
      assert(!DASH.test(t.text), `${f.name}: dash in ${t.text}`);
    }
    assert(s.turns[0].who === "agent" && /\bAI\b/.test(s.turns[0].text), `${f.name}: no AI line`);
  }
  assertEquals(n, 6);
});

async function* files(dir: URL): AsyncGenerator<URL> {
  for await (const f of Deno.readDir(dir)) {
    const u = new URL(f.isDirectory ? `${f.name}/` : f.name, dir);
    if (f.isDirectory) yield* files(u);
    else yield u;
  }
}

Deno.test("K6: public pages never read an audit table", async () => {
  let n = 0;
  for (const dir of ["demo", "transparency", "r", "c", "upload"]) {
    try {
      for await (const f of files(new URL(`../web/app/${dir}/`, import.meta.url))) {
        n++;
        const src = await Deno.readTextFile(f);
        assert(!/konza_findings|konza_holds|konza_audit_events/.test(src), f.pathname);
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  assert(n >= 5, `only ${n} files checked`);
});

Deno.test("K6 (MED-308): tier 1 on /transparency equals tier 1 in the transparency record", async () => {
  const { TIER1 } = await import("../web/lib/transparency.ts");
  const doc = await Deno.readTextFile(new URL("../docs/konza/transparency.md", import.meta.url));
  for (const t of TIER1) assert(doc.includes(`**${t.heading}.** ${t.text}`), t.heading);
  assert(!DASH.test(JSON.stringify(TIER1)));
});
