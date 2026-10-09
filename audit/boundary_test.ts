// The checker is independent of what it checks (K4, MED-272; K3, MED-286): built on the real
// module graphs from `deno info --json`, the tools function and the checker share no local file,
// and the checker's graph holds nothing from supabase/functions/_shared.

import { assert, assertEquals } from "jsr:@std/assert@1";

const ROOT = new URL("../", import.meta.url);

async function localFiles(entry: string): Promise<Set<string>> {
  const out = await new Deno.Command("deno", {
    args: ["info", "--json", new URL(entry, ROOT).pathname],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(out.success, new TextDecoder().decode(out.stderr));
  const info = JSON.parse(new TextDecoder().decode(out.stdout));
  return new Set(
    (info.modules as { specifier: string }[]).map((m) => m.specifier)
      .filter((s) => s.startsWith("file://")).map((s) => s.slice(ROOT.href.length)),
  );
}

Deno.test("K3 boundary: tools and the checker share no local file (deno info)", async () => {
  const tools = await localFiles("supabase/functions/tools/index.ts");
  const checker = new Set<string>();
  for (
    const f of [
      "audit/checks.ts",
      "audit/breaker.ts",
      "audit/snapshot.ts",
      "audit/reference.ts",
      "audit/db.ts",
    ]
  ) {
    for (const m of await localFiles(f)) checker.add(m);
  }
  assert(tools.size > 20 && checker.size >= 4);
  assertEquals([...checker].filter((m) => tools.has(m)), []);
  assertEquals([...checker].filter((m) => m.startsWith("supabase/functions/")), []);
  assertEquals([...tools].filter((m) => m.startsWith("audit/")), []);
});

Deno.test("K3 boundary: the audit function reaches the checker, never the core", async () => {
  const fn = await localFiles("supabase/functions/audit/index.ts");
  assert(fn.has("audit/checks.ts"));
  assertEquals([...fn].filter((m) => m.includes("_shared/")), []);
});
