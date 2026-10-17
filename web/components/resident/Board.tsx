"use client";

import { type CardStrings, enCards } from "@/lib/strings/cards";
import type { Strings } from "@/lib/strings/en";
import type { Board, StreamEvent } from "@/lib/ui/stream";
import { visible } from "@/lib/ui/stream";
import type { Confirm, Form, Identity, Lang, Payment, Progress, Quote, Receipt, Slots } from "@/lib/ui/types";
import {
  ConfirmCard,
  FormCard,
  IdentityCard,
  PaidCard,
  PaymentCard,
  ProgressCard,
  QuoteCard,
  ReceiptCard,
  SlotsCard,
} from "./Cards";

// K8 S2 (MED-331): the cards the backend's events ask for, in the conversation (Text and Voice) or
// beside the orb (Live). The progress rail, a code card still waiting, then the newest other card.
// A payment: choose a method, then the code or PIN, then paid; then the slots card (MED-332).

export type Taps = {
  confirm: (c: Confirm) => void;
  refresh: (c: Confirm) => void;
  decline: (key: string, c: Confirm) => void;
  code: (code: string) => void;
  form: (fields: Record<string, unknown>) => void;
  dismiss: (key: string) => void;
  payMethod: (p: Payment, methodId: string) => void;
  payCode: (code: string) => void;
  payPin: (pin: string) => void;
  slot: (date: string, window: string) => void;
  payAgain: () => void;
};

function One({ e, k, board, t, lang, taps }: {
  e: StreamEvent;
  k: string;
  board: Board;
  t: CardStrings;
  lang: Lang;
  taps: Taps;
}) {
  switch (e.kind) {
    case "progress":
      return <ProgressCard p={e.payload as Progress} t={t} lang={lang} />;
    case "quote":
      return <QuoteCard q={e.payload as Quote} t={t} lang={lang} />;
    case "identity":
      // A new code or a new form is a new card: no digits or answers carried over.
      return <IdentityCard key={`${(e.payload as Identity).step}:${(e.payload as Identity).expires_at ?? ""}`} i={e.payload as Identity} t={t} lang={lang} onCheck={taps.code} onContinue={() => taps.dismiss(k)} />;
    case "form":
      return <FormCard key={(e.payload as Form).service} f={e.payload as Form} t={t} lang={lang} onNext={taps.form} />;
    case "receipt":
      return <ReceiptCard r={e.payload as Receipt} t={t} lang={lang} />;
    case "slots":
      return <SlotsCard slots={e.payload as Slots} t={t} lang={lang} onBook={taps.slot} />;
    case "payment":
      return (e.payload as Payment).state === "approved"
        ? <PaidCard p={e.payload as Payment} t={t} lang={lang} />
        : (e.payload as Payment).state === "waiting"
        ? null
        : (
          <PaymentCard
            // Each step is a new card: no digits carried from the code box to the PIN box.
            key={`${(e.payload as Payment).payment_id}:${(e.payload as Payment).state}`}
            p={e.payload as Payment}
            t={t}
            lang={lang}
            offsetMs={board.offsetMs}
            onChoose={(m) => taps.payMethod(e.payload as Payment, m)}
            onCode={taps.payCode}
            onPin={taps.payPin}
            onAgain={taps.payAgain}
          />
        );
    case "confirm": {
      const c = e.payload as Confirm;
      return (
        <ConfirmCard
          // A new confirmation (Refresh) is a new card: its timers start again.
          key={c.confirmation_id}
          c={c}
          t={t}
          lang={lang}
          offsetMs={board.offsetMs}
          onConfirm={() => taps.confirm(c)}
          onRefresh={() => taps.refresh(c)}
          onDecline={() => taps.decline(k, c)}
        />
      );
    }
    default:
      return null;
  }
}

export default function ResidentBoard(
  { board, t: general, lang = "en", taps }: { board: Board; t: Strings; lang?: Lang; taps: Taps },
) {
  // The cards' own words arrive with this chunk (lib/strings/cards.ts).
  const t: CardStrings = { ...general, ...enCards };
  const { progress, pending, current } = visible(board);
  if (!progress && !current) return null;
  return (
    <>
      {progress && <One e={progress} k="progress" board={board} t={t} lang={lang} taps={taps} />}
      {pending.map(([k, e]) => <One key={k} e={e} k={k} board={board} t={t} lang={lang} taps={taps} />)}
      {current && <One e={current[1]} k={current[0]} board={board} t={t} lang={lang} taps={taps} />}
    </>
  );
}
