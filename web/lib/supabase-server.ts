import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only client with the service role key. Bypasses RLS, so it must
// never reach the browser: the "server-only" import fails the build if a
// client component pulls this module in.
let client: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
