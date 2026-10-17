// K8 S5 (MED-335, plan-k8 2.8): /developers is generated from the spec, but the Vercel build sees
// only web/. This writes the checked copies the page reads: openapi.yaml as JSON (no YAML parser in
// the web app) and the changelog (as JSON). The UI catalog is already copied in web/lib/ui. A test
// (tests/developers_test.ts) fails if a copy differs from the spec. Run after any spec change:
//   deno task spec:web

import { parse } from "jsr:@std/yaml@1";

const root = new URL("../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, root));
const out = new URL("web/lib/spec/", root);
await Deno.mkdir(out, { recursive: true });

const spec = parse(await read("spec/konza-2030-api/openapi.yaml"));
await Deno.writeTextFile(new URL("openapi.json", out), JSON.stringify(spec, null, 2) + "\n");
// The changelog as JSON, so the page imports it like the spec (no Markdown loader in the build).
await Deno.writeTextFile(
  new URL("changelog.json", out),
  JSON.stringify({ markdown: await read("spec/konza-2030-api/CHANGELOG.md") }, null, 2) + "\n",
);
console.log(`spec:web: web/lib/spec/openapi.json (${(spec as { info: { version: string } }).info.version}) and changelog.json`);
