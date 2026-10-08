// Two-step writes (P13), shared by the country agent gate and the Konza API core (K2): the first
// call stores a confirmation and changes nothing; a later call with the same arguments and the
// confirmation_id commits, at least 4 s after the prepare, within 3 minutes, once.

import { db, must } from "./db.ts";
import { sha256, str } from "./util.ts";

export const CONFIRM_TTL_MS = 3 * 60_000;
/** A commit must come in a later request, at least this long after the prepare. */
export const CONFIRM_MIN_GAP_MS = 4_000;

export async function argsHash(op: string, args: Record<string, unknown>): Promise<string> {
  const { confirmation_id: _c, ...rest } = args;
  const sorted = Object.keys(rest).sort().map((k) => [
    k,
    rest[k] !== null && typeof rest[k] === "object" ? JSON.stringify(rest[k]) : str(rest[k]),
  ]);
  return await sha256(`${op}:${JSON.stringify(sorted)}`);
}

export type Prepared = { confirmation_id: string; expires_at: string };

/** Returns a prepared confirmation, or null when this call is a valid commit. Throws
 * `{ why }` through `refuse` when the commit is not valid. */
export async function twoStepCheck(
  session: string,
  op: string,
  args: Record<string, unknown>,
  refuse: (why: string) => Promise<never>,
): Promise<Prepared | null> {
  const hash = await argsHash(op, args);
  const id = str(args.confirmation_id);
  if (!id) {
    const expires_at = new Date(Date.now() + CONFIRM_TTL_MS).toISOString();
    const row = must(
      await db.from("confirmations").insert({
        conversation_id: session,
        tool: op,
        args_hash: hash,
        expires_at,
      }).select("id").single(),
    );
    return { confirmation_id: row.id, expires_at };
  }
  const c = must(
    await db.from("confirmations").select("*").eq("id", id).eq("conversation_id", session)
      .eq("tool", op).maybeSingle(),
  );
  if (!c) return await refuse("unknown confirmation");
  if (c.committed_at) return await refuse("already used");
  if (new Date(c.expires_at).getTime() < Date.now()) return await refuse("expired");
  if (Date.now() - new Date(c.created_at).getTime() < CONFIRM_MIN_GAP_MS) {
    return await refuse("committed in the same turn as the read-back");
  }
  if (c.args_hash !== hash) return await refuse("details changed since the read-back");
  const used = must(
    await db.from("confirmations").update({ committed_at: new Date().toISOString() })
      .eq("id", id).is("committed_at", null).select("id"),
  );
  if (!used.length) return await refuse("already used");
  return null;
}
