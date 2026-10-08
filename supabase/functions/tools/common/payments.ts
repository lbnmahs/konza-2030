// Simulated payments for any case, in the authority's currency. Each authority registers a
// charge resolver: it finds the caller's case and returns the rules total. The LLM never sets
// the amount's meaning or the description; a mismatched amount is refused.
// /pesa approves or declines the row (mobile money PIN for KES, a card approval otherwise).

import { audit } from "../../_shared/audit.ts";
import { authority } from "../../_shared/authorities.ts";
import { type Agent, db, must, ToolError } from "../../_shared/db.ts";
import { type Citizen, codeHash, requireVerified } from "../../_shared/session.ts";
import { sms } from "../../_shared/sms.ts";
import { paymentTwiml, voiceCall } from "../../_shared/voice.ts";
import { PHONE_CODE_TRIES, PHONE_CODE_TTL_MS } from "../../_shared/rules/konza/rules.ts";
import { str } from "../../_shared/util.ts";
import type { ReadBack } from "../../_shared/readback.ts";
import { paymentReadBack as readBackFor } from "../../_shared/konza/readbacks.ts";
import type { Handler, ToolCtx } from "../index.ts";

const PAYMENT_TTL_MS = 90_000;
// Short enough that the caller rarely waits in silence (the tool is not interruptible).
const LONG_POLL_MS = 8_000;

export const money = (n: number, currency: string) =>
  `${currency} ${Number(n).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

export type Charge = {
  case_ref: string;
  amount: number;
  payee: string;
  description: string;
  reference: string;
  rule_ids: string[];
  permit_id?: string;
  /** Extra fields for the agent, e.g. the amount in words. */
  say?: Record<string, unknown>;
};

type ChargeResolver = {
  /** Throws a ToolError when the rules do not allow payment now. */
  resolve: (ctx: ToolCtx, citizen: Citizen) => Promise<Charge>;
  /** What the agent does after approval. */
  nextOnApproved: string;
  /** The rules tool to call again after an amount mismatch. */
  rulesTool: string;
  /** PY-01: approve with a code sent to the phone (SMS or code call) instead of /pesa. */
  phoneCode?: boolean;
  /** MED-296: is this amount still owed on this reference? Checked again at approval. */
  stillOwed?: (caseRef: string, amount: number) => Promise<boolean>;
};

const RESOLVERS: Record<string, ChargeResolver> = {};

export function registerCharge(authorityId: string, r: ChargeResolver) {
  RESOLVERS[authorityId] = r;
}

/** Pending older than 90 s reads as expired; persist it once and audit it. */
export async function freshStatus(pay: any, conversationId: string, agent: Agent) {
  const expired = pay.method === "phone_code"
    ? Date.now() > new Date(pay.code_expires_at).getTime()
    : Date.now() - new Date(pay.created_at).getTime() > PAYMENT_TTL_MS;
  if (pay.status === "pending" && expired) {
    const updated = must(
      await db.from("payments").update({ status: "expired" }).eq("id", pay.id)
        .eq("status", "pending").select("id"),
    );
    if (updated.length) {
      await audit(conversationId, agent.authority, "Payment", "Payment request expired", {
        result: "warn",
      });
    }
    return { ...pay, status: "expired" };
  }
  return pay;
}

/** The payment this call is really about: the newest one on this conversation (optionally for
 * one permit). The LLM's payment_id is not trusted, because a tool call interrupted by the
 * caller can create a payment whose id the LLM never sees. */
export async function latestPayment(conversationId: string, permitId?: string) {
  let q = db.from("payments").select("*").eq("conversation_id", conversationId);
  if (permitId) q = q.eq("permit_id", permitId);
  const rows = must(await q.order("created_at", { ascending: false }).limit(1));
  return rows[0] ?? null;
}

export function statusReply(pay: any, agent: Agent) {
  const card = authority(agent.authority).payment_skin === "card";
  switch (pay.status) {
    case "approved":
      return {
        status: "approved",
        txn_code: pay.txn_code,
        amount: Number(pay.amount),
        currency: pay.currency,
        ...(pay.currency === "KES" ? { amount_kes: Number(pay.amount) } : {}),
        next: RESOLVERS[agent.authority]?.nextOnApproved ??
          "Tell the caller the payment went through.",
      };
    case "declined":
      return {
        status: "declined",
        next: `The caller ${
          card ? "declined the card approval" : "cancelled on the phone"
        }. Ask if they want to try again; if yes, call payment_request again.`,
      };
    case "expired":
      return {
        status: "expired",
        next:
          "The request timed out. Ask if they want a new request; if yes, call payment_request again.",
      };
    default:
      if (pay.method === "phone_code") {
        return {
          status: "pending",
          next:
            "Ask the caller for the 6-digit code from the DEMO payment prompt, then call payment_confirm with it. If they do not want to pay, do nothing: it declines by itself.",
        };
      }
      return {
        status: "pending",
        next: card
          ? "Still waiting. Tell the caller you are still waiting for them to approve the card payment, then call payment_get_status again."
          : "Still waiting. Tell the caller you are still waiting for the PIN, then call payment_get_status again.",
      };
  }
}

/** K5 (MED-301): the read-back for a payment prompt, from the same resolver the commit uses, so
 * the amount and payee said before the yes are the rules total. Null where none applies. */
export async function paymentReadBack(ctx: ToolCtx): Promise<ReadBack | null> {
  const resolver = RESOLVERS[ctx.agent.authority];
  if (!resolver?.phoneCode || authority(ctx.agent.authority).currency !== "KES") return null;
  const citizen = await requireVerified(ctx.conversationId, ctx.agent, "payment_request");
  const charge = await resolver.resolve(ctx, citizen);
  return readBackFor(charge.amount, charge.payee, charge.description);
}

export const payments: Record<string, Handler> = {
  payment_request: async (ctx) => {
    const { conversationId, agent, args } = ctx;
    const citizen = await requireVerified(conversationId, agent, "payment_request");
    const resolver = RESOLVERS[agent.authority];
    if (!resolver) throw new ToolError("no_payments", "This service takes no payments.");
    const auth = authority(agent.authority);
    const charge = await resolver.resolve(ctx, citizen);

    const amount = Number(args.amount ?? args.amount_kes);
    const currency = String(args.currency ?? auth.currency).toUpperCase();
    if (amount !== charge.amount || currency !== auth.currency) {
      await audit(
        conversationId,
        agent.authority,
        "Payment",
        `Refused: amount ${amount} ${currency} is not the rules total`,
        { result: "warn", rule_ids: charge.rule_ids },
      );
      throw new ToolError(
        "amount_mismatch",
        `The amount must be exactly the rules total of ${charge.amount}. Call ${resolver.rulesTool} again.`,
      );
    }

    // An LLM retry returns the request already waiting instead of sending a second one.
    const open = must(
      await db.from("payments").select("*").eq("conversation_id", conversationId)
        .eq("case_ref", charge.case_ref).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(1),
    );
    if (open.length) {
      const cur = await freshStatus(open[0], conversationId, agent);
      if (cur.status === "pending") {
        return { payment_id: cur.id, status: "pending", already_requested: true };
      }
    }

    // PY-01: a 6-digit code to the phone on file; only its hash is kept.
    const id = crypto.randomUUID();
    const code = resolver.phoneCode && str(args.deliver) !== "pesa"
      ? String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")
      : null;
    const pay = must(
      await db.from("payments").insert({
        id,
        conversation_id: conversationId,
        citizen_id: citizen.id,
        case_ref: charge.case_ref,
        permit_id: charge.permit_id ?? null,
        amount: charge.amount,
        currency: auth.currency,
        reference: charge.reference,
        authority: agent.authority,
        payee: charge.payee,
        description: charge.description,
        ...(code
          ? {
            method: "phone_code",
            code_hash: await codeHash(id, code),
            code_expires_at: new Date(Date.now() + PHONE_CODE_TTL_MS).toISOString(),
          }
          : {}),
      }).select("id").single(),
    );
    if (code) {
      const amountText = money(charge.amount, auth.currency);
      if (str(args.deliver) === "call") {
        await voiceCall(
          citizen.phone,
          paymentTwiml(charge.payee, amountText, code),
          conversationId,
        );
      } else {
        await sms(
          citizen.phone,
          `DEMO Konza payment: ${amountText} to ${charge.payee}, ref ${charge.reference}. To approve, tell Savannah this code: ${code}. It lasts 5 minutes. To decline, do nothing.`,
          conversationId,
        );
      }
      await audit(
        conversationId,
        agent.authority,
        "Payment",
        `Payment prompt ${amountText} sent by ${
          str(args.deliver) === "call" ? "code call" : "SMS"
        }`,
        {
          rule_ids: ["PY-01", ...charge.rule_ids],
        },
      );
      return {
        payment_id: pay.id,
        status: "pending",
        ...charge.say,
        next:
          "Tell the caller a DEMO payment prompt is on its way with a 6-digit code. Ask them to say or text you the code to approve; doing nothing declines. Then call payment_confirm with the code.",
      };
    }
    const card = auth.payment_skin === "card";
    await audit(
      conversationId,
      agent.authority,
      "Payment",
      card
        ? `Card approval requested: ${money(charge.amount, auth.currency)}`
        : `Request ${money(charge.amount, auth.currency)} sent to phone`,
    );
    return {
      payment_id: pay.id,
      status: "pending",
      ...charge.say,
      next: card
        ? "Tell the caller to approve the card payment on the payment screen and tell you when done. Then call payment_get_status."
        : "Tell the caller to enter their PIN on the payment prompt and tell you when done. Then call payment_get_status.",
    };
  },

  /** PY-01: the caller approves a phone-code payment by giving its code (3 tries, 5 minutes). */
  payment_confirm: async ({ conversationId, agent, args }) => {
    await requireVerified(conversationId, agent, "payment_confirm");
    const latest = await latestPayment(conversationId);
    // A /pesa prompt (smartphone): confirming means waiting for the PIN, as payment_get_status.
    if (latest?.method === "pesa") {
      return await payments.payment_get_status({ conversationId, agent, args } as ToolCtx);
    }
    if (!latest || latest.method !== "phone_code") {
      throw new ToolError(
        "no_payment",
        "There is no phone-code payment on this call. Call payment_request first.",
      );
    }
    const pay = await freshStatus(latest, conversationId, agent);
    if (pay.status !== "pending") return { payment_id: pay.id, ...statusReply(pay, agent) };
    const code = str(args.code).replace(/\D/g, "");
    if (code.length === 6 && (await codeHash(pay.id, code)) === pay.code_hash) {
      // Paid meanwhile (at a desk, or in another call): this prompt can no longer be approved.
      const resolver = RESOLVERS[agent.authority];
      if (resolver?.stillOwed && !(await resolver.stillOwed(pay.case_ref, Number(pay.amount)))) {
        must(
          await db.from("payments").update({ status: "expired" }).eq("id", pay.id).eq(
            "status",
            "pending",
          ),
        );
        return {
          payment_id: pay.id,
          status: "expired",
          next:
            "This fee is already paid (or changed), so nothing more was taken. Say so; offer the receipt.",
        };
      }
      const txn = `KZP${crypto.randomUUID().slice(0, 7).toUpperCase()}`;
      const done = must(
        await db.from("payments").update({ status: "approved", txn_code: txn }).eq("id", pay.id)
          .eq("status", "pending").select("*"),
      );
      // The other prompts for this reference can no longer be approved.
      if (done.length) {
        must(
          await db.from("payments").update({ status: "expired" }).eq("case_ref", pay.case_ref)
            .eq("status", "pending"),
        );
      }
      if (!done.length) {
        return { payment_id: pay.id, ...statusReply(await latestPayment(conversationId), agent) };
      }
      await audit(
        conversationId,
        agent.authority,
        "Payment",
        `Paid ${money(Number(pay.amount), pay.currency)} by phone code`,
        {
          rule_ids: ["PY-01"],
        },
      );
      return { payment_id: pay.id, ...statusReply(done[0], agent) };
    }
    // One statement (K6, MED-311): two wrong codes at once both count.
    const [counted] = must(
      await db.rpc("payment_wrong_code", { payment: pay.id, max_tries: PHONE_CODE_TRIES }),
    ) as { code_tries: number; status: string }[];
    // No longer pending (approved, expired or declined meanwhile): say what it is now.
    if (!counted) {
      return { payment_id: pay.id, ...statusReply(await latestPayment(conversationId), agent) };
    }
    const tries = counted.code_tries;
    const declined = counted.status === "declined";
    await audit(
      conversationId,
      agent.authority,
      "Payment",
      declined ? "Payment declined after 3 wrong codes" : "Wrong payment code",
      {
        result: "warn",
        rule_ids: ["PY-01"],
      },
    );
    if (declined) {
      return {
        payment_id: pay.id,
        status: "declined",
        next:
          "Three wrong codes: the payment is declined. Offer to send a new prompt, or to pay at a desk (Lango Square or the Konza Passport Desk).",
      };
    }
    return {
      payment_id: pay.id,
      status: "pending",
      wrong_code: true,
      tries_left: PHONE_CODE_TRIES - tries,
      next: "That code is not right. Ask the caller to read it again from the DEMO prompt.",
    };
  },

  payment_get_status: async ({ conversationId, agent }) => {
    await requireVerified(conversationId, agent, "payment_get_status");
    const deadline = Date.now() + LONG_POLL_MS;
    while (true) {
      const pay = await latestPayment(conversationId);
      if (!pay) throw new ToolError("no_payment", "No payment request on this call yet.");
      const cur = await freshStatus(pay, conversationId, agent);
      if (cur.status !== "pending" || Date.now() >= deadline) {
        return { payment_id: cur.id, ...statusReply(cur, agent) };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
};
