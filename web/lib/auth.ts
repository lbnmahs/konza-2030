import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Panel sign-in (P14): Supabase Auth email codes, only for addresses in PANEL_EMAILS. Users are
// created by the server for allowed addresses; public sign-up stays off.

export function panelEmails(): string[] {
  return (process.env.PANEL_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function serverSupabase() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // Called from a server component: proxy.ts refreshes the cookies instead.
          }
        },
      },
    },
  );
}

/** The signed-in panel user, checked with Supabase Auth (not just the cookie), or null. */
export async function panelUser() {
  const { data } = await (await serverSupabase()).auth.getUser();
  const email = data.user?.email?.toLowerCase();
  return email && panelEmails().includes(email) ? data.user : null;
}

export const unauthorized = () =>
  Response.json({ error: "sign_in_required" }, {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
