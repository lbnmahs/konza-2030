"use client";

import type { ReactNode } from "react";
import type { Caption } from "@/lib/lines";
import type { Strings } from "@/lib/strings/en";
import { LineText, Shimmer } from "./Loading";
import Orb, { type Tone } from "./Orb";
import s from "./resident.module.css";

// K8 Live mode view, inside the Shell (progressive disclosure). The orb is large in the
// middle; on a narrow screen a card arrives below the captions and the orb shrinks into the status
// line; when the main area is wide (at least 980 px) the card opens in a panel beside the
// conversation and the orb stays medium on the left. The state word always says what the colour
// means. Text and Voice modes use ChatView instead (no orb, MED-342).

export type { Caption };
export type VoiceState = "connecting" | "listening" | "speaking" | "working" | "waiting" | "attention" | "ended";

export const toneOf = (state: VoiceState): Tone =>
  state === "listening" || state === "speaking"
    ? "green"
    : state === "working" || state === "waiting" || state === "connecting"
    ? "gold"
    : state === "attention"
    ? "red"
    : "quiet";

export default function VoiceView(
  { t, state, captions, card, announce, level, reduceMotion, notice, composer }: {
    t: Strings;
    state: VoiceState;
    captions: Caption[];
    card?: ReactNode;
    /** One short line for the status region when a card appears. */
    announce?: string;
    level?: () => number;
    reduceMotion?: "system" | "on";
    /** One line for fallbacks and texts (connection lost, a code text). */
    notice?: string;
    composer: ReactNode;
  },
) {
  return (
    <main className={s.column} data-split={card ? true : undefined}>
      <div className={s.convo}>
        <div className={card ? s.stageDocked : s.stage}>
          <Orb tone={toneOf(state)} level={level} reduceMotion={reduceMotion} className={card ? s.orbSmall : s.orbLarge} />
          <p className={s.stateWord}>
            {state === "connecting" || state === "working" ? <Shimmer>{t.state[state]}</Shimmer> : t.state[state]}
          </p>
        </div>
        <ol className={s.captions} aria-label={t.captions.label}>
          {captions.slice(-3).map((c, i) => (
            <li key={i} data-role={c.role}>
              {c.role !== "note" && <span className={s.who}>{c.role === "user" ? t.captions.you : t.captions.agent}: </span>}
              <LineText c={c} />
            </li>
          ))}
        </ol>
      </div>
      {card && <div className={s.cardSlot}>{card}</div>}
      <p role="status" className={s.srOnly}>{announce}</p>
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {composer}
    </main>
  );
}
