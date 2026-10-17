// K8 S2 (MED-331, plan-k8 2.2 and 2.4): the resident app's screen state, from the backend's ui/v1
// events. Pure and without imports, so the Deno tests check it (tests/ui_test.ts); the payload
// types are in ./types.ts.
//
// Events arrive by nudge and fetch (the SDK's tool response, a 5 s poll, the act route's reply), so
// the same event can arrive twice and out of order: a board keeps the highest seq it has applied
// and ignores anything at or below it. A later event for the same card replaces the earlier one
// (Refresh's new confirmation replaces the old card for that tool; a done state replaces the open
// card). Only the backend changes what a card says; the app may only hide a card or mark a tap the
// backend refused.

export type StreamEvent = { v: "ui/v1"; seq: number; kind: string; at: string; payload: unknown };

export type Board = {
  /** Highest seq applied; fetch with after=seq. */
  seq: number;
  /** Server clock minus this device's, from the newest event (countdowns use it). */
  offsetMs: number;
  cards: Record<string, StreamEvent>;
};

export const EMPTY: Board = { seq: 0, offsetMs: 0, cards: {} };

const field = (p: unknown, k: string) =>
  p && typeof p === "object" ? String((p as Record<string, unknown>)[k] ?? "") : "";

/** The slot an event fills. One progress rail, one identity card, one form, one quote and one
 * slot picker at a time; one confirm per tool; payments and receipts by their ids. */
export function cardKey(e: StreamEvent): string {
  switch (e.kind) {
    case "confirm":
      return `confirm:${field(e.payload, "tool")}`;
    case "payment":
      return `payment:${field(e.payload, "payment_id")}`;
    case "receipt":
      return `receipt:${field(e.payload, "decision_id")}`;
    default:
      return e.kind;
  }
}

/** Applies new events in seq order; repeats and stale events change nothing. */
export function apply(board: Board, events: StreamEvent[], receivedAt = Date.now()): Board {
  const fresh = events.filter((e) => e.v === "ui/v1" && e.seq > board.seq).sort((a, b) => a.seq - b.seq);
  if (!fresh.length) return board;
  const cards = { ...board.cards };
  for (const e of fresh) cards[cardKey(e)] = e;
  const newest = fresh[fresh.length - 1];
  const at = Date.parse(newest.at);
  return {
    seq: newest.seq,
    // The event was stored before it arrived, so this errs towards a later clock: never early.
    offsetMs: Number.isFinite(at) ? Math.min(at - receivedAt, 0) : board.offsetMs,
    cards,
  };
}

/** A tap the backend refused (card_changed): the card shows Not done and offers Refresh. */
export function markRefused(board: Board, confirmationId: string): Board {
  const entry = Object.entries(board.cards).find(([, e]) =>
    e.kind === "confirm" && field(e.payload, "confirmation_id") === confirmationId
  );
  if (!entry) return board;
  const [key, e] = entry;
  return {
    ...board,
    cards: { ...board.cards, [key]: { ...e, payload: { ...(e.payload as object), state: "refused" } } },
  };
}

/** Not now: the card goes away on this screen; the backend's confirmation simply expires. */
export function hide(board: Board, key: string): Board {
  if (!(key in board.cards)) return board;
  return { ...board, cards: Object.fromEntries(Object.entries(board.cards).filter(([k]) => k !== key)) };
}

/** One short line for the status region: the newest shown card's kind, in the given words. */
export function announcement(board: Board, words: Record<string, string>): string {
  const { current, progress } = visible(board);
  const newest = current?.[1] ?? progress;
  if (!newest) return "";
  // A card's state can change what it is: an approved payment is a receipt for the fee (MED-331).
  return words[`${newest.kind}.${field(newest.payload, "state")}`] ?? words[newest.kind] ?? "";
}

/** What the screen shows: the progress rail, cards still waiting for the resident, then the newest
 * other card. A waiting card stays until it is used, dismissed or expired: a code card waiting for
 * its code (a fee card must not hide it) and a payment waiting for a choice, code or PIN (nor a
 * fresh identity check), oldest first. */
export function visible(
  board: Board,
  now = Date.now(),
): { progress?: StreamEvent; pending: [string, StreamEvent][]; current?: [string, StreamEvent] } {
  const { progress, ...rest } = board.cards;
  const current = Object.entries(rest).sort(([, a], [, b]) => b.seq - a.seq)[0];
  const open = (e: StreamEvent) => {
    const expires = Date.parse(field(e.payload, "expires_at"));
    return !Number.isFinite(expires) || expires > now + board.offsetMs;
  };
  const waits = (e: StreamEvent) =>
    (e.kind === "identity" && field(e.payload, "step") === "code") ||
    (e.kind === "payment" && ["choose", "code", "pin"].includes(field(e.payload, "state")));
  const pending = Object.entries(rest)
    .filter(([k, e]) => k !== current?.[0] && waits(e) && open(e))
    .sort(([, a], [, b]) => a.seq - b.seq);
  return { progress, pending, current };
}

/** MED-332 (card replacement and the log line): the words a finished card leaves in the
 * conversation once a newer card takes its place, so the thread keeps what was done. */
export type LogWords = {
  confirmed: (title: string) => string;
  paid: (amountKes: number, reference: string) => string;
  decision: (outcome: string, ref: string) => string;
  verified: string;
};

const en = (v: unknown) =>
  v && typeof v === "object" ? String((v as Record<string, unknown>).en ?? "") : String(v ?? "");

function logLine(e: StreamEvent, w: LogWords): string | null {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (e.kind === "confirm" && p.state === "done") return w.confirmed(en(p.title));
  if (e.kind === "payment" && p.state === "approved") return w.paid(Number(p.amount_kes), String(p.reference ?? ""));
  if (e.kind === "receipt") return w.decision(String(p.outcome ?? ""), String(p.ref ?? ""));
  if (e.kind === "identity" && p.step === "verified") return w.verified;
  return null;
}

/** Finished cards no longer on screen and not yet logged ("key:seq" in `logged`), oldest first. */
export function logLines(board: Board, logged: ReadonlySet<string>, w: LogWords): { id: string; text: string }[] {
  const { progress, pending, current } = visible(board);
  const shown = new Set([progress, ...pending.map(([, e]) => e), current?.[1]]);
  return Object.entries(board.cards)
    .filter(([, e]) => !shown.has(e))
    .sort(([, a], [, b]) => a.seq - b.seq)
    .flatMap(([k, e]) => {
      const id = `${k}:${e.seq}`;
      const text = logged.has(id) ? null : logLine(e, w);
      return text ? [{ id, text }] : [];
    });
}
