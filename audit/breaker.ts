// The circuit breaker (K4, MED-272; Mahs chose option B on 5 Oct). A finding of severity "hold"
// opens a hold on (agency, service, rule id). While it is open, the core turns grants under that
// rule into pending_officer; grants already made are listed for an officer, never reversed.
// Only the checker opens holds, as its own role mirror_vale (K6, MED-306: the service role cannot),
// and only an officer clears them (core.clearHold).

import type { Finding } from "./checks.ts";
import type { Sql } from "./db.ts";

export const CHECKER = "mirror_vale";
const RULE_ID = /^[A-Z]{2}-[0-9]{2}$/;

/** Opens a hold for every (agency, service, rule) a hold finding names; returns the new ones. */
export async function trip(sql: Sql, findings: Finding[]) {
  const wanted = new Map<
    string,
    { agency: string; service: string; rule_id: string; finding: string }
  >();
  for (const f of findings) {
    if (f.severity !== "hold" || !f.agency || !f.service) continue;
    // A malformed or missing rule id still holds the service (rule id *), MED-280.
    const ids = f.rule_ids.map((r) => (RULE_ID.test(r) ? r : "*"));
    for (const rule_id of ids.length ? ids : ["*"]) {
      const k = `${f.agency}/${f.service}/${rule_id}`;
      if (!wanted.has(k)) {
        wanted.set(k, {
          agency: f.agency,
          service: f.service,
          rule_id,
          finding: `${f.check}:${f.code}`.slice(0, 200),
        });
      }
    }
  }
  const opened: string[] = [];
  for (const [k, h] of wanted) {
    // Already held (one open hold per rule): nothing to do. Any other error is reported, and the
    // rest of the holds are still opened.
    try {
      const rows = await sql`
        insert into konza_holds ${sql({ ...h, opened_by: CHECKER })}
        on conflict (agency, service, rule_id) where cleared_at is null do nothing
        returning id`;
      if (!rows.length) continue;
    } catch (e) {
      console.error(JSON.stringify({ konza_hold_error: k, error: String(e).slice(0, 200) }));
      continue;
    }
    opened.push(k);
    // Every hold opened is in the append-only audit log.
    await event(sql, h.agency, "openHold", `${h.service} ${h.rule_id} ${h.finding}`);
  }
  return opened;
}

/** One row in the append-only audit log, as the Audit Office. */
export const event = (
  sql: Sql,
  agency: string | null,
  operation: string,
  reason: string,
  requestId: string = crypto.randomUUID(),
) =>
  sql`insert into konza_audit_events ${
    sql({
      request_id: requestId,
      client: CHECKER,
      agency,
      operation,
      charter: "acts_alone",
      outcome: "ok",
      reason: reason.slice(0, 300),
    })
  }`;

/** Every finding of one checker run, one row each (no text, no personal data). */
export async function record(sql: Sql, runId: string, findings: Finding[]) {
  for (let i = 0; i < findings.length; i += 500) {
    const rows = findings.slice(i, i + 500).map((f) => ({
      run_id: runId,
      check: f.check,
      code: f.code.slice(0, 60),
      severity: f.severity,
      agency: f.agency ?? null,
      service: f.service ?? null,
      rule_ids: f.rule_ids,
      ref: f.ref ? String(f.ref).slice(0, 80) : null,
    }));
    await sql`insert into konza_findings ${sql(rows)}`;
  }
}

/** Grants made before the hold, which an officer should look at again. */
export const toReview = (
  findings: Finding[],
) => [...new Set(findings.filter((f) => f.severity === "hold" && f.ref).map((f) => f.ref!))];
