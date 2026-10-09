import { randomInt } from "node:crypto";
import { panelUser, unauthorized } from "@/lib/auth";
import { getServiceSupabase } from "@/lib/supabase-server";
import {
  PAYMENT_TTL_MS,
  paymentSkin,
  type Payment,
  type PaymentSkin,
} from "@/lib/types";

// Write path for the payment simulator (mobile money PIN prompt or card
// approval, chosen by the authority's payment_skin). The PIN is only checked
// for shape (4 digits) and then dropped: it is never logged, stored or echoed.
// Card approvals need no PIN. Amounts and currencies come from the row.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE = /^\d{4}$/;
const TXN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789";

function txnCode(): string {
  let out = "SIM";
  for (let i = 0; i < 7; i++) out += TXN_ALPHABET[randomInt(TXN_ALPHABET.length)];
  return out;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

type Body = { payment_id?: unknown; action?: unknown; pin?: unknown };

export async function POST(request: Request) {
  if (!(await panelUser())) return unauthorized();
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const paymentId = body.payment_id;
  const action = body.action;
  if (typeof paymentId !== "string" || !UUID_RE.test(paymentId)) {
    return json({ error: "payment_id must be a uuid" }, 400);
  }
  if (action !== "approve" && action !== "decline") {
    return json({ error: 'action must be "approve" or "decline"' }, 400);
  }
  // Check the PIN's shape, then drop it before doing anything else. Whether
  // a PIN is required depends on the skin, known once the payment is loaded.
  const pinOk = typeof body.pin === "string" && PIN_RE.test(body.pin);
  delete body.pin;

  let supabase;
  try {
    supabase = getServiceSupabase();
  } catch {
    return json({ error: "Server is not configured" }, 500);
  }

  const { data: payment, error: loadErr } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle<Payment>();
  if (loadErr) return json({ error: "Could not load payment" }, 500);
  if (!payment) return json({ error: "Payment not found" }, 404);

  let authoritySkin: PaymentSkin | null = null;
  if (payment.authority) {
    const { data: auth } = await supabase
      .from("authorities")
      .select("payment_skin")
      .eq("id", payment.authority)
      .maybeSingle<{ payment_skin: PaymentSkin }>();
    authoritySkin = auth?.payment_skin ?? null;
  }
  const skin = paymentSkin(authoritySkin, payment.currency);
  if (action === "approve" && skin === "mobile_money" && !pinOk) {
    return json({ error: "PIN must be 4 digits" }, 400);
  }
  const card = skin === "card";

  if (payment.status !== "pending") {
    return json(
      { status: payment.status, txn_code: payment.txn_code },
      409,
    );
  }

  const audit = (actionText: string, result: "ok" | "warn") =>
    supabase.from("audit_log").insert({
      conversation_id: payment.conversation_id,
      authority: payment.authority,
      actor: "Payment",
      action: actionText,
      result,
      rule_ids: [],
      data_used: null,
    });

  // Conditional update: only succeeds if the row is still pending, so a
  // double tap or a race with another writer cannot change it twice.
  const transition = async (patch: Partial<Payment>) => {
    const { data, error } = await supabase
      .from("payments")
      .update(patch)
      .eq("id", paymentId)
      .eq("status", "pending")
      .select("status, txn_code");
    if (error) return { error: true as const };
    return { error: false as const, updated: data && data.length > 0 };
  };

  const latestStatus = async () => {
    const { data } = await supabase
      .from("payments")
      .select("status, txn_code")
      .eq("id", paymentId)
      .maybeSingle<Pick<Payment, "status" | "txn_code">>();
    return data ?? { status: payment.status, txn_code: payment.txn_code };
  };

  if (Date.now() - Date.parse(payment.created_at) > PAYMENT_TTL_MS) {
    const res = await transition({ status: "expired" });
    if (res.error) return json({ error: "Could not update payment" }, 500);
    if (res.updated) await audit("Payment request expired", "warn");
    const current = res.updated
      ? { status: "expired", txn_code: null }
      : await latestStatus();
    return json(current, 409);
  }

  if (action === "approve") {
    const code = txnCode();
    const res = await transition({ status: "approved", txn_code: code });
    if (res.error) return json({ error: "Could not update payment" }, 500);
    if (!res.updated) return json(await latestStatus(), 409);
    await audit(`${card ? "Card approved" : "Approved"} on phone · ${code}`, "ok");
    return json({ status: "approved", txn_code: code });
  }

  const res = await transition({ status: "declined" });
  if (res.error) return json({ error: "Could not update payment" }, 500);
  if (!res.updated) return json(await latestStatus(), 409);
  await audit(`${card ? "Card declined" : "Declined"} on phone`, "warn");
  return json({ status: "declined", txn_code: null });
}
