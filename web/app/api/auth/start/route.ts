import { createClient } from "@supabase/supabase-js";
import { panelEmails } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase-server";

// Sends a sign-in code to an allowed panel address. The reply is the same for any address, so it
// does not reveal who may sign in. Supabase Auth sends the email (Resend as SMTP). The role
// "panel" in app_metadata lets the user read the panel tables (RLS).

export async function POST(request: Request) {
  const { email } = (await request.json().catch(() => null)) ?? {};
  const address = String(email ?? "").trim().toLowerCase();
  const admin = getServiceSupabase();
  const panel = panelEmails().includes(address);
  if (panel) {
    const role = "panel";
    const { data: created, error } = await admin.auth.admin.createUser({
      email: address,
      email_confirm: true,
      app_metadata: { role },
    });
    if (error && !/already/i.test(error.message)) console.error("auth createUser failed");
    if (!created?.user) {
      // Existing user: make sure the role matches today's allowlist.
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
      const u = list?.users.find((x) => x.email?.toLowerCase() === address);
      if (u && u.app_metadata?.role !== role) {
        await admin.auth.admin.updateUserById(u.id, { app_metadata: { ...u.app_metadata, role } });
      }
    }
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const sent = await anon.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false },
    });
    if (sent.error) console.error("auth signInWithOtp failed");
  }
  return Response.json({ sent: true }, { headers: { "Cache-Control": "no-store" } });
}
