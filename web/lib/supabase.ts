import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Browser client with the signed-in panel user's session (kept in cookies by @supabase/ssr, so
// proxy.ts and server routes see the same session). RLS lets signed-in users read the panel
// tables; nothing is readable without signing in (P14). Created lazily so builds need no env.
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  client = createBrowserClient(url, key);
  return client;
}
