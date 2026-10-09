// The simulator's only way to a database (K4, MED-271): the local Supabase stack, read from
// `supabase status`. Refuses anything that is not localhost, and never reads .env. It sets the
// environment the core's db client reads, so import the core only after calling localStack().

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { connect, localAuditUrl, type Sql } from "../../audit/db.ts";
import type { Rows } from "./residents.ts";

export const LOCAL_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

async function statusEnv(): Promise<Record<string, string>> {
  const out = new TextDecoder().decode(
    (await new Deno.Command("supabase", { args: ["status", "-o", "env"] }).output()).stdout,
  );
  return Object.fromEntries(
    out.split("\n").map((l) => l.match(/^(\w+)="?([^"]*)"?$/)).filter(Boolean)
      .map((m) => [m![1], m![2]]),
  );
}

export async function localStack(): Promise<{ url: string; db: SupabaseClient }> {
  const env = await statusEnv();
  const url = env.API_URL ?? "";
  if (!LOCAL_URL.test(url)) throw new Error("the simulator only runs against the local stack");
  Deno.env.set("SUPABASE_URL", url);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", env.SERVICE_ROLE_KEY);
  return { url, db: createClient(url, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } }) };
}

/** The checker's own connection on the local stack, as the role mirror_vale (K6, MED-306), the way
 * it reads and trips the breaker live. */
export async function localAudit(): Promise<Sql> {
  return connect(await localAuditUrl((await statusEnv()).DB_URL ?? ""));
}

const ORDER = ["citizens", "passports", "addresses", "guardianships", "schools"];

/** Inserts rows in foreign-key order, in chunks. */
export async function load(db: SupabaseClient, rows: Rows) {
  for (const t of ORDER) {
    for (let i = 0; i < (rows[t]?.length ?? 0); i += 250) {
      const { error } = await db.from(t).insert(rows[t].slice(i, i + 250));
      if (error) throw new Error(`${t}: ${error.message}`);
    }
  }
}
