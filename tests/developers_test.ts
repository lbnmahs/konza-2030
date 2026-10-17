// K8 S5 (MED-335, plan-k8 2.8): /developers reads checked copies of the spec in web/lib/spec (the
// Vercel build sees only web/). They must equal the spec; the page's data shows the spec's version,
// every operation with its charter level, and every card kind of the catalog.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { parse } from "jsr:@std/yaml@1";
import { OPERATIONS } from "../supabase/functions/_shared/konza/types.ts";
import { cardKinds, markdownBlocks, operations, VERSION } from "../web/lib/developers.ts";

const text = (p: string) => Deno.readTextFile(new URL(`../${p}`, import.meta.url));

Deno.test("MED-335: the web copies of the spec and the changelog equal the spec (run deno task spec:web)", async () => {
  const spec = parse(await text("spec/konza-2030-api/openapi.yaml"));
  assertEquals(JSON.parse(await text("web/lib/spec/openapi.json")), spec, "web/lib/spec/openapi.json differs");
  assertEquals(
    JSON.parse(await text("web/lib/spec/changelog.json")).markdown,
    await text("spec/konza-2030-api/CHANGELOG.md"),
    "web/lib/spec/changelog.json differs",
  );
});

Deno.test("MED-335: the page shows the spec's version, every operation with its charter, every card kind", async () => {
  const spec = parse(await text("spec/konza-2030-api/openapi.yaml")) as { info: { version: string } };
  assertEquals(VERSION, spec.info.version);
  const ops = operations().flatMap((g) => g.ops);
  assertEquals(Object.fromEntries(ops.map((o) => [o.id, o.charter])), OPERATIONS);
  const catalog = JSON.parse(await text("spec/konza-2030-api/ui/catalog.schema.json"));
  assertEquals(cardKinds().map((k) => k.kind), catalog.properties.kind.enum);
  assert(cardKinds().every((k) => k.words.length > 0), "every kind has words");
});

Deno.test("MED-335: the changelog is read as text: no markup survives", () => {
  const blocks = markdownBlocks("# T\n\n## 0.1.0\n\n- **bold** and `code` and [a link](https://x.example)\n<img src=x>\n");
  assertEquals(blocks, [
    { kind: "h2", text: "0.1.0" },
    { kind: "li", text: "bold and code and a link" },
    { kind: "p", text: "<img src=x>" },
  ]);
});
