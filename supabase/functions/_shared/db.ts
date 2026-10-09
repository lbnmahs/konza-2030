import { createClient } from "npm:@supabase/supabase-js@2";

// Service role client. Only ever used server side.
export const db = createClient<any>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export type Agent = {
  agent_id: string;
  scenario: string;
  authority: string;
  authority_name: string;
  language: string;
  /** Country agents only: the hub key in _shared/hubs.ts. */
  hub?: string | null;
  country?: string | null;
};

export { ToolError } from "./errors.ts";

/** Throws on a database error, returns data otherwise. Lists are never null on success;
 * maybeSingle() can still return null, and callers check for that. */
export function must(
  r: { data: any; error: { message: string; code?: string } | null },
): any {
  // The Postgres code travels with the error (K3: 22xxx and 23xxx become 4xx in the Konza core).
  if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
  return r.data;
}
