// After every stored Konza decision, ask the separate audit function to check (K3, MED-286).
// Fire and forget: a checker that is down never blocks a resident; the failure is logged in the
// append-only audit log. The core only sees a hook; this file only sends an HTTP request.

import { db } from "../../_shared/db.ts";
import { onDecisionStored } from "../../_shared/konza/core.ts";

export function notifyChecker(requestId: string): Promise<void> {
  const secret = Deno.env.get("AUDIT_SECRET");
  if (!secret) return Promise.resolve(); // no checker configured (KE-only deployments)
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  // The secret only ever goes to the project's own host (MED-296): an override must stay there.
  const override = Deno.env.get("AUDIT_URL");
  const url = override && URL.canParse(override) && URL.canParse(base) &&
      new URL(override).hostname === new URL(base).hostname
    ? override
    : `${base}/functions/v1/audit`;
  return fetch(url, {
    method: "POST",
    headers: { "x-audit-secret": secret, "content-type": "application/json" },
    body: JSON.stringify({ request_id: requestId }),
    signal: AbortSignal.timeout(10_000),
  }).then(async (r) => {
    await r.body?.cancel();
    if (!r.ok) throw new Error(`status ${r.status}`);
  }).catch(async (e) => {
    console.error(JSON.stringify({ konza_checker_unreachable: String(e).slice(0, 300) }));
    await db.from("konza_audit_events").insert({
      request_id: requestId,
      client: "tools",
      operation: "notifyChecker",
      charter: "acts_alone",
      outcome: "refused:unreachable",
      reason: String(e).slice(0, 300),
    });
  });
}

onDecisionStored((requestId) => {
  const p = notifyChecker(requestId);
  // Keep the function alive until the call ends, without making the resident wait.
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
    ?.waitUntil(p);
});
