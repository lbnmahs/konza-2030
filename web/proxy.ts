import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// P14 security: every page and API needs a signed-in panel user, except the sign-in flow and
// the caller's own links from the SMS (/upload/<id>, /c/<id>, /r/<id>; random, unguessable ids). This is the optimistic check; pages and routes check the
// user again on the server (lib/auth.ts).

const OPEN = [
  /^\/signin$/,
  /^\/api\/auth\//,
  /^\/upload\/[^/]+$/,
  /^\/api\/upload\/[^/]+$/,
  // P15: add-to-calendar pages from the SMS (random ids, like upload links).
  /^\/c\/[^/]+(\/ics)?$/,
  // K3: explain-why receipts from the receipt SMS (random decision ids, like calendar links).
  /^\/r\/[^/]+$/,
  // The public demo (K6: the family's week) and the transparency record's public tier; static,
  // no live system behind them.
  /^\/demo$/,
  /^\/transparency$/,
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (OPEN.some((re) => re.test(path))) return response;
  if (data.user?.app_metadata?.role === "panel") return response;
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "sign_in_required" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
