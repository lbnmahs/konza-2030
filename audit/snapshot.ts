// Reads what the checker needs (K4, MED-272). Read-only, as the Audit Office's own role
// mirror_vale (K6, MED-306), which may select only these columns.

import type { Snapshot } from "./checks.ts";
import type { Sql } from "./db.ts";

const TABLES: Record<keyof Snapshot, [string, string]> = {
  applications: [
    "konza_applications",
    "id, ref, agency, service, applicant_citizen_id, subject_citizen_id, consent_id, fields, session, created_at",
  ],
  decisions: [
    "konza_decisions",
    "id, application_id, outcome, decided_by, rule_ids, reason_en, inputs, decided_at, created_at",
  ],
  consents: [
    "delegation_consents",
    "id, grantor_citizen_id, delegate, subject_citizen_id, scopes, expires_at, withdrawn_at, session, created_at",
  ],
  deliveries: ["deliveries", "id, item_ref, deliver_on, fee_kes, session, created_at"],
  payments: ["payments", "id, case_ref, amount, status, method, created_at"],
  appointments: ["konza_appointments", "id, application_id, created_at"],
  appeals: ["konza_appeals", "id, decision_id, session, created_at"],
  confirmations: ["confirmations", "id, conversation_id, tool, created_at, committed_at"],
  events: ["konza_audit_events", "session, operation, outcome, agency, at"],
  citizens: ["citizens", "id, dob"],
  passports: ["passports", "citizen_id, expires"],
  addresses: ["addresses", "citizen_id, zone"],
  guardianships: ["guardianships", "guardian_citizen_id, child_citizen_id"],
  schools: ["schools", "id, zone, capacity"],
  holds: ["konza_holds", "id, agency, service, rule_id, opened_at, cleared_at"],
};

/** One table as JSON rows, so dates and numbers read as they did through the REST API. Table and
 * column names are the constants above, never input. */
async function all(sql: Sql, table: string, cols: string) {
  const [{ rows }] = await sql.unsafe(
    `select coalesce(json_agg(t), '[]'::json) as rows from (select ${cols} from ${table}) t`,
  );
  return rows as Record<string, unknown>[];
}

/** One query at a time (the live pooler runs in transaction mode, which does not take pipelined
 * queries), inside one read-only repeatable-read transaction, so every table is read at the same
 * moment and a decision is never seen without its application. */
export async function snapshot(sql: Sql): Promise<Snapshot> {
  return await sql.begin("isolation level repeatable read read only", async (tx) => {
    const out: Record<string, unknown> = {};
    for (const [k, [t, c]] of Object.entries(TABLES)) {
      out[k] = await all(tx as unknown as Sql, t, c);
    }
    return out as Snapshot;
  }) as Snapshot;
}
