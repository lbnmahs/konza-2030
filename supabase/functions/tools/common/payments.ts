// Simulated payments for any case, in the authority's currency. Each authority registers a
// charge resolver: it finds the caller's case and returns the rules total. The LLM never sets
// the amount's meaning or the description; a mismatched amount is refused.
// /pesa approves or declines the row (mobile money PIN for KES, a card approval otherwise).

import { audit } from "../../_shared/audit.ts";
import { authority } from "../../_shared/authorities.ts";
import { type Agent, db, must, ToolError } from "../../_shared/db.ts";
import { type Citizen, codeHash, requireVerified, STEP_UP_MS } from "../../_shared/session.ts";
import { isResidentApp } from "../../_shared/outbound.ts";
import { sms } from "../../_shared/sms.ts";
import { paymentTwiml, voiceCall } from "../../_shared/voice.ts";
import { PHONE_CODE_TRIES, PHONE_CODE_TTL_MS } from "../../_shared/rules/konza/rules.ts";
import { sha256, str } from "../../_shared/util.ts";
import type { ReadBack } from "../../_shared/readback.ts";
import { paymentReadBack as readBackFor, screenPaymentReadBack } from "../../_shared/konza/readbacks.ts";
import type { Handler, ToolCtx } from "../index.ts";

const PAYMENT_TTL_MS = 90_000;
/** MED-332 (plan-k8 2.10): a payment on a screen. `screen` waits for the
 * resident's choice; `screen_card` waits for the code texted to the phone (read aloud or typed);
 * `screen_mobile` waits for the PIN typed on the card. Each lasts as a phone code does. */
const SCREEN = ["screen", "screen_card", "screen_mobile"];
const CODED = ["phone_code", ...SCREEN];

/** The mobile money PIN's hash (the seed's momoPinHash): the method id and the PIN. */
export const pinHash = (methodId: string, pin: string) => sha256(`momo:${methodId}:${pin}`);

const newCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
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
  const expired = CODED.includes(pay.method)
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
      if (pay.method === "screen") {
        return {
          status: "pending",
          next:
            "The payment card is on the screen. Ask the resident to choose card or mobile money there. Never ask for a PIN or card details aloud.",
        };
      }
      if (pay.method === "screen_mobile") {
        return {
          status: "pending",
          next:
            "The resident chose mobile money: ask them to type their PIN on the payment card. Never ask for the PIN aloud, and never repeat one they say.",
        };
      }
      if (pay.method === "phone_code" || pay.method === "screen_card") {
        return {
          status: "pending",
          next:
            "Ask the caller for the 6-digit code from the payment prompt, then call payment_confirm with it. If they do not want to pay, do nothing: it declines by itself.",
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
  // In the resident app the payment card asks for the method and its approval (MED-332).
  const screen = await isResidentApp(ctx.conversationId);
  return (screen ? screenPaymentReadBack : readBackFor)(charge.amount, charge.payee, charge.description);
}

/** A correct code or PIN: approved once (a second approval of the same fee is refused by the
 * paid-once index), unless the fee was paid meanwhile. */
async function approve(
  pay: any,
  conversationId: string,
  agent: Agent,
  how: "phone code" | "card" | "mobile money",
) {
  // Paid meanwhile (at a desk, or in another call): this prompt can no longer be approved.
  const resolver = RESOLVERS[agent.authority];
  if (resolver?.stillOwed && !(await resolver.stillOwed(pay.case_ref, Number(pay.amount)))) {
    must(
      await db.from("payments").update({ status: "expired" }).eq("id", pay.id).eq("status", "pending"),
    );
    return {
      payment_id: pay.id,
      status: "expired",
      next: "This fee is already paid (or changed), so nothing more was taken. Say so; offer the receipt.",
    };
  }
  const txn = `KZP${crypto.randomUUID().slice(0, 7).toUpperCase()}`;
  const done = must(
    await db.from("payments").update({ status: "approved", txn_code: txn }).eq("id", pay.id)
      .eq("status", "pending").select("*"),
  );
  if (!done.length) {
    return { payment_id: pay.id, ...statusReply(await latestPayment(conversationId), agent) };
  }
  // The other prompts for this reference can no longer be approved.
  must(
    await db.from("payments").update({ status: "expired" }).eq("case_ref", pay.case_ref)
      .eq("status", "pending"),
  );
  await audit(
    conversationId,
    agent.authority,
    "Payment",
    `Paid ${money(Number(pay.amount), pay.currency)} by ${how}`,
    { rule_ids: [how === "phone code" ? "PY-01" : "PY-03"] },
  );
  return { payment_id: pay.id, ...statusReply(done[0], agent) };
}

/** A wrong code or PIN: one statement (K6, MED-311), so two wrong tries at once both count; the
 * third declines. */
async function wrongTry(pay: any, conversationId: string, agent: Agent, what: "code" | "PIN") {
  const [counted] = must(
    await db.rpc("payment_wrong_code", { payment: pay.id, max_tries: PHONE_CODE_TRIES }),
  ) as { code_tries: number; status: string }[];
  // No longer pending (approved, expired or declined meanwhile): say what it is now.
  if (!counted) {
    return { payment_id: pay.id, ...statusReply(await latestPayment(conversationId), agent) };
  }
  const declined = counted.status === "declined";
  await audit(
    conversationId,
    agent.authority,
    "Payment",
    declined ? `Payment declined after 3 wrong ${what}s` : `Wrong payment ${what}`,
    { result: "warn", rule_ids: [pay.method === "phone_code" ? "PY-01" : "PY-03"] },
  );
  if (declined) {
    return {
      payment_id: pay.id,
      status: "declined",
      next:
        `Three wrong ${what}s: the payment is declined. Offer to start the payment again, or to pay at a desk (Lango Square or the Konza Passport Desk).`,
    };
  }
  return {
    payment_id: pay.id,
    status: "pending",
    [what === "PIN" ? "wrong_pin" : "wrong_code"]: true,
    tries_left: PHONE_CODE_TRIES - counted.code_tries,
    next: what === "PIN"
      ? "That PIN is not right. Ask the resident to type it again on the payment card."
      : "That code is not right. Ask the caller to read it again from the prompt.",
  };
}

/** MED-332: the resident chose how to pay on the payment card. A card texts a code to the phone on
 * file (read aloud or typed); mobile money waits for the PIN typed on the card. The method must be
 * the resident's own; only its type is logged. A method is chosen once per payment: a double tap
 * would text two codes, the second replacing the first, so the code the resident read out would be
 * refused. A later choice changes nothing and sends nothing (`already_chosen`). */
export async function chooseMethod(
  conversationId: string,
  agent: Agent,
  paymentId: string,
  methodId: string,
  /** A tap on the card, or the resident's spoken choice (plan-k8 2.12). */
  via: "screen" | "voice" = "screen",
) {
  const citizen = await requireVerified(conversationId, agent, "payment_confirm", STEP_UP_MS);
  const latest = await latestPayment(conversationId);
  if (!latest || latest.id !== paymentId || !SCREEN.includes(latest.method)) {
    throw new ToolError("no_payment", "There is no payment waiting on this screen.");
  }
  const pay = await freshStatus(latest, conversationId, agent);
  if (pay.status !== "pending") return { payment_id: pay.id, ...statusReply(pay, agent) };
  const chosen = (p: any) => ({
    payment_id: p.id,
    ...statusReply(p, agent),
    method: p.method === "screen_card" ? "card" : "mobile_money",
    already_chosen: true,
  });
  if (pay.method !== "screen") return chosen(pay);
  const m = must(
    await db.from("payment_methods").select("id, type").eq("id", methodId).eq("citizen_id", citizen.id)
      .maybeSingle(),
  );
  if (!m) throw new ToolError("unknown_method", "That payment method is not on this resident's record.");
  const expires = new Date(Date.now() + PHONE_CODE_TTL_MS).toISOString();
  // Only the row still waiting for a choice changes, so of two taps in the same instant one wins.
  const won = async (q: PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>) =>
    (must(await q) as { id: string }[]).length > 0;
  const lost = async () => chosen(must(await db.from("payments").select("*").eq("id", pay.id).single()));
  if (m.type === "card") {
    const code = newCode();
    const first = await won(
      db.from("payments").update({
        method: "screen_card",
        method_id: m.id,
        code_hash: await codeHash(pay.id, code),
        code_expires_at: expires,
        code_tries: 0,
      }).eq("id", pay.id).eq("status", "pending").eq("method", "screen").select("id"),
    );
    if (!first) return await lost();
    await sms(
      citizen.phone,
      `Konza card payment: ${money(Number(pay.amount), pay.currency)} to ${pay.payee}. Your code: ${code}. Type it on the payment card or tell Savannah. It lasts 5 minutes. To decline, do nothing.`,
      conversationId,
    );
  } else {
    const first = await won(
      db.from("payments").update({
        method: "screen_mobile",
        method_id: m.id,
        code_hash: null,
        code_expires_at: expires,
        code_tries: 0,
      }).eq("id", pay.id).eq("status", "pending").eq("method", "screen").select("id"),
    );
    if (!first) return await lost();
  }
  await audit(
    conversationId,
    agent.authority,
    "Payment",
    `${m.type === "card" ? "Card" : "Mobile money"} chosen ${via === "voice" ? "by voice" : "on screen"}${
      m.type === "card" ? "; code sent by SMS" : ""
    }`,
    { rule_ids: ["PY-03"] },
  );
  return {
    payment_id: pay.id,
    status: "pending",
    method: m.type,
    next: m.type === "card"
      ? "The resident chose their card: a 6-digit code is on its way by text. They read it to you (call payment_confirm with it) or type it on the card."
      : "The resident chose mobile money: they type their PIN on the payment card. Never ask for the PIN aloud.",
  };
}

/** MED-332: the mobile money PIN typed on the payment card, checked against the method's hash. The
 * PIN goes no further: not to the agent, a log or the audit. */
export async function payByPin(conversationId: string, agent: Agent, pin: string) {
  await requireVerified(conversationId, agent, "payment_confirm", STEP_UP_MS);
  const latest = await latestPayment(conversationId);
  if (!latest || latest.method !== "screen_mobile" || !latest.method_id) {
    throw new ToolError("no_payment", "There is no mobile money payment waiting on this screen.");
  }
  const pay = await freshStatus(latest, conversationId, agent);
  if (pay.status !== "pending") return { payment_id: pay.id, ...statusReply(pay, agent) };
  const m = must(
    await db.from("payment_methods").select("id, pin_hash").eq("id", pay.method_id).maybeSingle(),
  );
  if (m?.pin_hash && /^\d{4,6}$/.test(pin) && (await pinHash(m.id, pin)) === m.pin_hash) {
    return await approve(pay, conversationId, agent, "mobile money");
  }
  return await wrongTry(pay, conversationId, agent, "PIN");
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

    // MED-332: in the resident app the payment card offers card or mobile money first; nothing is
    // sent until the resident chooses (chooseMethod). Calls keep PY-01 below. Whatever `deliver`
    // says: deliver pesa would make a KE PIN simulator payment the app never shows, leaving the
    // resident no card to pay on.
    const resident = resolver.phoneCode && (await isResidentApp(conversationId));
    if (resident) {
      const pay = must(
        await db.from("payments").insert({
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
          method: "screen",
          code_expires_at: new Date(Date.now() + PHONE_CODE_TTL_MS).toISOString(),
        }).select("id").single(),
      );
      await audit(
        conversationId,
        agent.authority,
        "Payment",
        `Payment card shown: ${money(charge.amount, auth.currency)}`,
        { rule_ids: ["PY-03", ...charge.rule_ids] },
      );
      return {
        payment_id: pay.id,
        status: "pending",
        on_screen: true,
        ...charge.say,
        next:
          "The payment card is on the screen: the resident chooses debit or credit card, or mobile money, there. With a card, a code comes by text: they read it to you (then call payment_confirm with it) or type it on the card. With mobile money they type their PIN on the card. Never ask for a PIN or card details aloud. You hear what they chose.",
      };
    }

    // PY-01: a 6-digit code to the phone on file; only its hash is kept.
    const id = crypto.randomUUID();
    const code = resolver.phoneCode && str(args.deliver) !== "pesa" ? newCode() : null;
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
          `Konza payment: ${amountText} to ${charge.payee}, ref ${charge.reference}. To approve, tell Savannah this code: ${code}. It lasts 5 minutes. To decline, do nothing.`,
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
          "Tell the caller a payment prompt is on its way with a 6-digit code. Ask them to say or text you the code to approve; doing nothing declines. Then call payment_confirm with the code.",
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

  /** PY-01: the caller approves a phone-code payment by giving its code (3 tries, 5 minutes). On a
   * screen (MED-332) the same for a card's code, read aloud here or typed on the card. */
  payment_confirm: async ({ conversationId, agent, args }) => {
    await requireVerified(conversationId, agent, "payment_confirm");
    const latest = await latestPayment(conversationId);
    // A /pesa prompt (smartphone): confirming means waiting for the PIN, as payment_get_status.
    if (latest?.method === "pesa") {
      return await payments.payment_get_status({ conversationId, agent, args } as ToolCtx);
    }
    // Plan-k8 2.12: the method chosen by voice, for a resident who cannot use the screen or asks to
    // pay by voice. The same choice as a tap (once per payment); the card follows on the screen.
    const said = str(args.method);
    if (said && !str(args.code)) {
      if (!latest || !SCREEN.includes(latest.method)) {
        throw new ToolError(
          "no_payment",
          "There is no payment card waiting for a choice. Call payment_request first; in the resident app it shows the card.",
        );
      }
      if (said !== "card" && said !== "mobile_money") {
        throw new ToolError("bad_method", "method must be card or mobile_money.");
      }
      const own = must(
        await db.from("payment_methods").select("id").eq("citizen_id", latest.citizen_id).eq("type", said)
          .limit(1),
      ) as { id: string }[];
      if (!own.length) {
        throw new ToolError("unknown_method", "The resident has no such payment method on record. Offer the other one or a desk.");
      }
      return await chooseMethod(conversationId, agent, latest.id, own[0].id, "voice");
    }
    if (latest?.method === "screen" && latest.status === "pending") {
      throw new ToolError(
        "choose_method",
        "The resident has not chosen how to pay yet. They choose card or mobile money on the payment card, or tell you: then call payment_confirm with method card (a code is texted; they read it to you or type it on the card) or method mobile_money (they still type the PIN on the card).",
      );
    }
    // A PIN is typed on the card only: whatever was said is not used, and never repeated.
    if (latest?.method === "screen_mobile" && latest.status === "pending") {
      throw new ToolError(
        "pin_on_screen",
        "Mobile money is approved with the PIN typed on the payment card, never spoken. Do not repeat or use what the resident said; ask them to type the PIN on the card.",
      );
    }
    if (!latest || (latest.method !== "phone_code" && latest.method !== "screen_card")) {
      throw new ToolError(
        "no_payment",
        "There is no phone-code payment on this call. Call payment_request first.",
      );
    }
    const pay = await freshStatus(latest, conversationId, agent);
    if (pay.status !== "pending") return { payment_id: pay.id, ...statusReply(pay, agent) };
    const code = str(args.code).replace(/\D/g, "");
    if (code.length === 6 && (await codeHash(pay.id, code)) === pay.code_hash) {
      return await approve(pay, conversationId, agent, pay.method === "screen_card" ? "card" : "phone code");
    }
    return await wrongTry(pay, conversationId, agent, "code");
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
