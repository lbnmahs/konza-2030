// K8 S1 (MED-329, plan 2.7): fails when a resident route's first-load JavaScript is over budget.
// Reads the chunks Next lists per route in .next/diagnostics/route-bundle-stats.json (written by
// `next build`), gzips each and sums them. The voice SDK, the WebGL orb (three) and later the docs
// renderer load on demand, so they are not in this number. Run after a build: `npm run budget`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = { "/sia": 150 };

const web = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const stats = JSON.parse(readFileSync(join(web, ".next", "diagnostics", "route-bundle-stats.json"), "utf8"));
let failed = false;
for (const [route, budget] of Object.entries(BUDGET_KB)) {
  const entry = stats.find((s) => s.route === route);
  if (!entry) {
    console.error(`budget: ${route} is not in the build`);
    failed = true;
    continue;
  }
  const kb = entry.firstLoadChunkPaths
    .reduce((sum, p) => sum + gzipSync(readFileSync(join(web, p))).length, 0) / 1024;
  const ok = kb <= budget;
  failed ||= !ok;
  console.log(`budget: ${route} first-load JS ${kb.toFixed(1)} KB gzip (budget ${budget} KB) ${ok ? "ok" : "OVER"}`);
}
process.exit(failed ? 1 : 0);
