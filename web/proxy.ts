import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Every page and API needs a signed-in panel user, except what OPEN lists: the sign-in flow, the
// caller's own links from the SMS (random, unguessable ids), the public pages and the resident app.
// This is the optimistic check; panel pages and routes check the user again on the server
// (lib/auth.ts).

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
  /^\/developers$/,
  // The resident app is public. Its API still needs the resident-session cookie
  // after bind, the CSRF token and a same-origin request (lib/resident.ts); the daily session
  // limits cap what strangers can spend.
  /^\/sia$/,
  /^\/api\/resident\//,
  // Design previews from fixtures, local development only (the pages 404 in production).
  ...(process.env.NODE_ENV === "production" ? [] : [/^\/dev\//]),
];

// K8 S1 (plan 2.5): a strict CSP with a per-request nonce on the resident app, its API and the
// API page. Next adds the nonce to its own scripts when it sees it in the request's CSP header.
// Scripts only from this origin (the voice worklets are self-hosted); the voice connection to
// ElevenLabs; inline style attributes (the orb's tone) allowed; never framed.
const STRICT = [/^\/sia(\/|$)/, /^\/api\/resident\//, /^\/developers(\/|$)/];
const dev = process.env.NODE_ENV !== "production";

function csp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' https://api.elevenlabs.io wss://api.elevenlabs.io https://*.elevenlabs.io wss://*.elevenlabs.io${
      dev ? " ws://localhost:* ws://127.0.0.1:*" : ""
    }`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const headers = new Headers(request.headers);
  const policy = STRICT.some((re) => re.test(path))
    ? csp(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))))
    : null;
  if (policy) headers.set("content-security-policy", policy);
  const next = () => {
    const r = NextResponse.next({ request: { headers } });
    if (policy) r.headers.set("content-security-policy", policy);
    return r;
  };

  let response = next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          headers.set("cookie", request.cookies.toString());
          response = next();
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );
  const { data } = await supabase.auth.getUser();
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

// /vendor/ holds the voice SDK's public worklet files (scripts/vendor-worklets.mjs), served like
// Next's own static chunks.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|vendor/).*)"],
};
