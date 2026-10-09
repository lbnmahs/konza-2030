// Shared simulator plumbing (K4). The Konza core runs in-process against the local stack, as
// client "sim" in its own session namespace. Faults are injected here by wrapping manifest
// functions or the database client; production code has no fault hooks.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { load, localAudit, localStack } from "./local.ts";
import { generate, type Population } from "./residents.ts";

export type Core = typeof import("../../supabase/functions/_shared/konza/core.ts");

export async function setup() {
  const { db } = await localStack();
  // Only after localStack() has pointed the core's db client at the local stack.
  const core: Core = await import("../../supabase/functions/_shared/konza/core.ts");
  const { AGENCIES } = await import("../../supabase/functions/_shared/konza/manifest.ts");
  const shared = await import("../../supabase/functions/_shared/db.ts");
  const types = await import("../../supabase/functions/_shared/konza/types.ts");
  const pp = await import("../../supabase/functions/_shared/rules/ke/pp.ts");
  const dates = await import("../../supabase/functions/_shared/rules/common/dates.ts");
  const audit = await localAudit();
  return { db, audit, core, AGENCIES, coreDb: shared.db, KonzaError: types.KonzaError, pp, dates };
}
export type Sim = Awaited<ReturnType<typeof setup>>;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function nairobiToday() {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Empties the local demo tables and loads the residents for `seed`. */
export async function fresh(db: SupabaseClient, seed: number): Promise<Population> {
  const r = await db.rpc("demo_truncate");
  if (r.error) throw new Error(r.error.message);
  // Holds survive demo_truncate; the simulator's officer clears any left open (local only).
  const c = await db.from("konza_holds").update({
    cleared_at: new Date().toISOString(),
    cleared_by: "sim_officer",
  }).is("cleared_at", null);
  if (c.error) throw new Error(c.error.message);
  const pop = generate(seed, nairobiToday());
  await load(db, pop.rows);
  return pop;
}

export async function residents(db: SupabaseClient) {
  const rows: any[] = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await db.from("citizens").select("*").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return new Map(rows.map((r) => [r.id, r]));
}

let n = 0;
export const caller = (resident: any, session?: string, client = "sim") => ({
  client,
  requestId: crypto.randomUUID(),
  session: session ?? `sim:${crypto.randomUUID().slice(0, 8)}:${++n}`,
  resident,
});

export type Outcome =
  | { ok: true; value: any }
  | { ok: false; status: number; code: string; say: string; konza: boolean; message: string };

export async function attempt(fn: () => Promise<any>, K: Sim["KonzaError"]): Promise<Outcome> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof K) {
      return {
        ok: false,
        status: e.status,
        code: e.code,
        say: e.say ?? e.message,
        konza: true,
        message: e.message,
      };
    }
    return {
      ok: false,
      status: 500,
      code: "server_error",
      say: "",
      konza: false,
      message: String(e),
    };
  }
}

/** asks_first in batches: every item prepares, then (after the 4 s gap) commits with its
 * confirmation id. `op(confirmationId)` must make the same call both times. */
export async function twoStep(
  items: ((confirmationId: string | null) => Promise<any>)[],
  K: Sim["KonzaError"],
  concurrency = 10,
): Promise<Outcome[]> {
  const prepared = await pool(items.map((op) => () => attempt(() => op(null), K)), concurrency);
  await sleep(4_200);
  return await pool(
    items.map((op, i) => () => {
      const p = prepared[i];
      if (!p.ok || !p.value?.needs_confirmation) return Promise.resolve(p);
      return attempt(() => op(p.value.confirmation_id), K);
    }),
    concurrency,
  );
}

export async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

/** A query builder that fails like an unreachable table: every chain resolves to an error. */
export function failingTable(table: string): any {
  const result = {
    data: null,
    error: { message: `${table} unavailable (sim outage)`, code: "SIM" },
  };
  const p: any = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? (res: any) => res(result) : () => p),
    apply: () => p,
  });
  return p;
}

/** Cuts tables on the core's database client until the returned function is called. */
export function cutTables(coreDb: any, tables: string[]) {
  const from = coreDb.from.bind(coreDb);
  coreDb.from = (t: string) => (tables.includes(t) ? failingTable(t) : from(t));
  return () => {
    coreDb.from = from;
  };
}

/** Replaces functions on an object until the returned function is called. */
export function patch<T extends object>(obj: T, changes: Partial<T>) {
  const before: Partial<T> = {};
  for (const k of Object.keys(changes) as (keyof T)[]) before[k] = obj[k];
  Object.assign(obj, changes);
  return () => Object.assign(obj, before);
}

export async function writeResults(name: string, data: unknown) {
  const dir = new URL("../../docs/konza/sim/", import.meta.url);
  await Deno.mkdir(dir, { recursive: true });
  const file = new URL(`${name}.json`, dir);
  await Deno.writeTextFile(file, JSON.stringify(data, null, 2) + "\n");
  return file.pathname;
}

/** A seeded shuffle for a deterministic order. */
export function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
