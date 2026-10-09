"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatMoney } from "@/lib/labels";
import {
  PAYMENT_TTL_MS,
  paymentSkin,
  type Authority,
  type Payment,
  type PaymentSkin,
  type PaymentStatus,
} from "@/lib/types";
import styles from "./pesa.module.css";

type View = "loading" | "waiting" | PaymentStatus;

// A resolved payment older than this is old news: show the waiting screen
// on a fresh load instead of a stale result from an earlier run.
const STALE_MS = 10 * 60_000;

const amountFmt = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 2,
});

// Mobile money keeps its "KES 3,500" look; cards read "AED 300.00" or "£35.00".
function formatAmount(p: Payment, skin: PaymentSkin): string {
  if (skin === "card") return formatMoney(p.amount, p.currency);
  return `${p.currency} ${amountFmt.format(Number(p.amount))}`;
}

// Fixed demo card. No network name or logo.
const DEMO_CARD = "Card \u2022\u2022\u2022\u2022 4417";

function isNewer(a: Payment, b: Payment | null) {
  return !b || Date.parse(a.created_at) >= Date.parse(b.created_at);
}

function viewFor(p: Payment | null, now: number | null, loaded: boolean): View {
  if (!p) return loaded ? "waiting" : "loading";
  const age = now === null ? 0 : now - Date.parse(p.created_at);
  if (p.status === "pending") {
    if (age < PAYMENT_TTL_MS) return "pending";
    return age > STALE_MS ? "waiting" : "expired";
  }
  if (age > STALE_MS) return "waiting";
  return p.status;
}

export default function PesaSimulator() {
  const [payment, setPayment] = useState<Payment | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skins, setSkins] = useState<Record<string, PaymentSkin>>({});

  // Realtime first, then the initial fetch of the newest payment.
  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (e) {
      queueMicrotask(() => setError((e as Error).message));
      return;
    }

    const onRow = (row: Payment) => {
      setPayment((prev) => {
        if (prev && prev.id === row.id) return row;
        return isNewer(row, prev) ? row : prev;
      });
    };

    const channel = supabase
      .channel("pesa-simulator")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "payments" },
        (payload) => onRow(payload.new as Payment),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "payments" },
        (payload) => onRow(payload.new as Payment),
      )
      .subscribe();

    // Which skin each authority uses. If this fails, paymentSkin() falls back.
    supabase
      .from("authorities")
      .select("id, payment_skin")
      .then(({ data }) => {
        if (!data) return;
        const next: Record<string, PaymentSkin> = {};
        for (const a of data as Pick<Authority, "id" | "payment_skin">[]) {
          next[a.id] = a.payment_skin;
        }
        setSkins(next);
      });

    supabase
      .from("payments")
      // Not code_hash, which the panel role cannot read (K6, MED-311).
      .select(
        "id, conversation_id, citizen_id, permit_id, amount, currency, reference, status, txn_code, created_at, authority, payee, description, case_ref",
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else if (data && data[0]) onRow(data[0] as Payment);
        setLoaded(true);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 1 s clock for the countdown and the expiry check.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const view = viewFor(payment, now, loaded);
  const skin = payment
    ? paymentSkin(payment.authority ? skins[payment.authority] : null, payment.currency)
    : "mobile_money";
  const card = skin === "card";

  const onResult = useCallback(
    (id: string, status: PaymentStatus, txn: string | null) => {
      setPayment((prev) =>
        prev && prev.id === id ? { ...prev, status, txn_code: txn } : prev,
      );
    },
    [],
  );

  return (
    <main className={styles.main}>
      <section
        className={styles.phone}
        aria-label={card ? "Card approval simulator" : "Pesa Simulator"}
      >
        <div className={styles.watermark} aria-hidden="true">
          SIMULATED
        </div>

        <header className={styles.top}>
          <span className={styles.brand}>
            {card ? "Card approval" : "Pesa Simulator"}
          </span>
          <span className={styles.badge}>SIMULATED</span>
        </header>

        <div className={styles.content} aria-live="polite">
          {error && <p className={styles.errorText}>Could not load: {error}</p>}

          {(view === "loading" || view === "waiting") && (
            <div className={styles.center}>
              <span className={styles.pulse} aria-hidden="true" />
              <h1 className={styles.title}>
                {view === "loading" ? "Connecting" : "No payment requests"}
              </h1>
              <p className={styles.muted}>
                Payment prompts from the call will appear here.
              </p>
            </div>
          )}

          {view === "pending" && payment && card && (
            <CardPrompt
              key={payment.id}
              payment={payment}
              secondsLeft={secondsLeft(payment, now)}
              onResult={onResult}
            />
          )}

          {view === "pending" && payment && !card && (
            <PinPrompt
              key={payment.id}
              payment={payment}
              secondsLeft={secondsLeft(payment, now)}
              onResult={onResult}
            />
          )}

          {view === "approved" && payment && (
            <div className={styles.center}>
              <span className={styles.iconOk} aria-hidden="true">
                &#10003;
              </span>
              <h1 className={styles.title}>Payment approved</h1>
              <p className={styles.amountBig}>{formatAmount(payment, skin)}</p>
              <p className={styles.muted}>to {payment.payee ?? "payee"}</p>
              <p className={styles.label}>
                {card ? "Approval code" : "Transaction code"}
              </p>
              <p className={styles.txn}>{payment.txn_code ?? "pending"}</p>
            </div>
          )}

          {view === "declined" && payment && (
            <div className={styles.center}>
              <span className={styles.iconWarn} aria-hidden="true">
                &#10005;
              </span>
              <h1 className={styles.title}>Payment cancelled</h1>
              <p className={styles.muted}>
                {formatAmount(payment, skin)} to {payment.payee ?? "payee"} was not
                paid.
              </p>
            </div>
          )}

          {view === "expired" && payment && (
            <div className={styles.center}>
              <span className={styles.iconMuted} aria-hidden="true">
                !
              </span>
              <h1 className={styles.title}>Request expired</h1>
              <p className={styles.muted}>
                {formatAmount(payment, skin)} to {payment.payee ?? "payee"} was not
                paid. Ask for a new request.
              </p>
            </div>
          )}
        </div>

        <footer className={styles.foot}>
          Not a real payment. No money moves.
        </footer>
      </section>
    </main>
  );
}

function secondsLeft(p: Payment, now: number | null): number | null {
  if (now === null) return null;
  return Math.max(
    0,
    Math.ceil((Date.parse(p.created_at) + PAYMENT_TTL_MS - now) / 1000),
  );
}

type PromptProps = {
  payment: Payment;
  secondsLeft: number | null;
  onResult: (id: string, status: PaymentStatus, txn: string | null) => void;
};

function PinPrompt({ payment, secondsLeft, onResult }: PromptProps) {
  // The PIN lives only in this component's memory and in the request body.
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const press = useCallback(
    (d: string) => setPin((p) => (p.length < 4 ? p + d : p)),
    [],
  );
  const del = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  const send = useCallback(
    async (action: "approve" | "decline") => {
      if (busy) return;
      if (action === "approve" && pin.length !== 4) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/pesa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "approve"
              ? { payment_id: payment.id, action, pin }
              : { payment_id: payment.id, action },
          ),
        });
        const data = (await res.json().catch(() => ({}))) as {
          status?: PaymentStatus;
          txn_code?: string | null;
          error?: string;
        };
        setPin("");
        if (data.status) {
          onResult(payment.id, data.status, data.txn_code ?? null);
        } else {
          setError(data.error ?? "Something went wrong. Try again.");
          setBusy(false);
        }
      } catch {
        setPin("");
        setError("Network error. Try again.");
        setBusy(false);
      }
    },
    [busy, pin, payment.id, onResult],
  );

  // Laptop use: digits, Backspace, Enter and Escape work from the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") del();
      else if (e.key === "Enter") send("approve");
      else if (e.key === "Escape") send("decline");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, del, send]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className={styles.prompt}>
      <p className={styles.countdown}>
        {secondsLeft === null ? "" : `Expires in ${secondsLeft}s`}
      </p>
      <p className={styles.message}>
        <strong>{payment.payee ?? "Payee"}</strong> requests{" "}
        <strong className={styles.amount}>
          {formatAmount(payment, "mobile_money")}
        </strong>{" "}
        for{" "}
        {payment.description ?? payment.reference ?? "a payment"}. Enter PIN.
      </p>

      <div
        className={styles.dots}
        role="img"
        aria-label={`${pin.length} of 4 PIN digits entered`}
      >
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={i < pin.length ? styles.dotOn : styles.dot} />
        ))}
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.keypad}>
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className={styles.key}
            onClick={() => press(k)}
            disabled={busy}
          >
            {k}
          </button>
        ))}
        <span aria-hidden="true" />
        <button
          type="button"
          className={styles.key}
          onClick={() => press("0")}
          disabled={busy}
        >
          0
        </button>
        <button
          type="button"
          className={styles.keyDel}
          onClick={del}
          disabled={busy || pin.length === 0}
          aria-label="Delete"
        >
          &#9003;
        </button>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancel}
          onClick={() => send("decline")}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.ok}
          onClick={() => send("approve")}
          disabled={busy || pin.length !== 4}
        >
          {busy ? "Sending" : "OK"}
        </button>
      </div>
    </div>
  );
}

// Generic card approval: same row, same route, no PIN.
function CardPrompt({ payment, secondsLeft, onResult }: PromptProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (action: "approve" | "decline") => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/pesa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payment_id: payment.id, action }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          status?: PaymentStatus;
          txn_code?: string | null;
          error?: string;
        };
        if (data.status) {
          onResult(payment.id, data.status, data.txn_code ?? null);
        } else {
          setError(data.error ?? "Something went wrong. Try again.");
          setBusy(false);
        }
      } catch {
        setError("Network error. Try again.");
        setBusy(false);
      }
    },
    [busy, payment.id, onResult],
  );

  // Laptop use: Enter approves, Escape declines.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") send("approve");
      else if (e.key === "Escape") send("decline");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  return (
    <div className={styles.prompt}>
      <p className={styles.countdown}>
        {secondsLeft === null ? "" : `Expires in ${secondsLeft}s`}
      </p>

      <div className={styles.cardSheet}>
        <p className={styles.label}>Approve payment</p>
        <p className={styles.cardPayee}>{payment.payee ?? "Payee"}</p>
        <p className={styles.cardAmount}>{formatAmount(payment, "card")}</p>
        <p className={styles.muted}>
          {payment.description ?? payment.reference ?? "Payment"}
        </p>
        <div className={styles.cardRow}>
          <span className={styles.cardChip} aria-hidden="true" />
          <span>{DEMO_CARD}</span>
        </div>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.cancel}
          onClick={() => send("decline")}
          disabled={busy}
        >
          Decline
        </button>
        <button
          type="button"
          className={styles.ok}
          onClick={() => send("approve")}
          disabled={busy}
        >
          {busy ? "Sending" : "Approve"}
        </button>
      </div>
    </div>
  );
}
