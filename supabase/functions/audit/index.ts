// The Mirror Vale Audit Office checker as its own edge function (K3, MED-286). The tools function
// calls it after every stored decision, without waiting; it runs the deterministic checks in
// audit/ over the logs, records every finding and trips the circuit breaker. Its own secret
// (AUDIT_SECRET) and, since K6 (MED-306), its own database role (AUDIT_DB_URL, role mirror_vale),
// never the service role. It never imports the Konza core, and the core never imports it.

import { event, record, trip } from "../../../audit/breaker.ts";
import { check, tally } from "../../../audit/checks.ts";
import { connect } from "../../../audit/db.ts";
import { snapshot } from "../../../audit/snapshot.ts";

const sql = connect(Deno.env.get("AUDIT_DB_URL")!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Constant-time comparison (kept here: the checker shares no code with the core). */
async function same(a: string | null, b: string | undefined) {
  if (!a || !b) return false;
  const h = async (x: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)));
  const [x, y] = await Promise.all([h(a), h(b)]);
  return x.reduce((d, v, i) => d | (v ^ y[i]), 0) === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!(await same(req.headers.get("x-audit-secret"), Deno.env.get("AUDIT_SECRET")))) {
    return new Response("unauthorised", { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const requestId = UUID.test(String(body?.request_id)) ? body.request_id : crypto.randomUUID();
  try {
    // Live, the drift check (C6) has no history to compare with; C1 to C5, C7 and C8 run.
    const findings = check(await snapshot(sql));
    await record(sql, requestId, findings);
    const opened = await trip(sql, findings);
    const counts = tally(findings);
    await event(
      sql,
      null,
      "checkerRun",
      JSON.stringify({ findings: counts, holds_opened: opened.length }),
      requestId,
    );
    return Response.json({ findings: counts, holds_opened: opened.length });
  } catch (e) {
    console.error(JSON.stringify({ audit_error: String(e).slice(0, 300) }));
    return Response.json({ error: "checker_failed" }, { status: 500 });
  }
});
