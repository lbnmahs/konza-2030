"use client";

import { type ReactNode, useEffect, useRef } from "react";
import type { Strings } from "@/lib/strings/en";
import type { Caption } from "./VoiceView";
import { LineText, Working } from "./Loading";
import s from "./resident.module.css";

// K8 (MED-342): the new conversation page (no orb: an intro line, suggestions,
// the composer) and the Text and Voice mode conversation (the whole exchange as text, newest at the
// bottom, cards in line). Savannah does not greet on the web; the resident starts.

export function NewConversation(
  { t, composer, notice, onSuggest }: {
    t: Strings;
    composer: ReactNode;
    notice?: string;
    onSuggest: (text: string) => void;
  },
) {
  return (
    <main className={`${s.column} ${s.home}`}>
      <div className={s.homeBody}>
        <h1 className={s.homeTitle}>{t.home.title}</h1>
        <ul className={s.suggestions} aria-label={t.home.label}>
          {t.home.suggestions.map(({ emoji, text }) => (
            <li key={text}>
              {/* The emoji is decoration: hidden from screen readers and never part of the prompt. */}
              <button type="button" onClick={() => onSuggest(text)}>
                <span className={s.suggestionEmoji} aria-hidden="true">{emoji}</span>
                {text}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {composer}
    </main>
  );
}

export function ChatView(
  { t, lines, working, card, announce, notice, composer }: {
    t: Strings;
    lines: Caption[];
    /** Savannah has not answered within 1.5 s. */
    working?: boolean;
    card?: ReactNode;
    announce?: string;
    notice?: string;
    composer: ReactNode;
  },
) {
  // MED-331: the newest line or card scrolls into view (a new card changes the announcement).
  const end = useRef<HTMLDivElement>(null);
  // A block body: scrollIntoView returns a Promise in current Chrome, and an effect's return value
  // is its cleanup, so returning it would crash the page on the next change.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, working, announce]);
  return (
    <main className={`${s.column} ${s.chat}`}>
      <ol className={s.thread} aria-label={t.captions.label} aria-live="polite">
        {lines.map((c, i) => (
          <li key={i} data-role={c.role}>
            {c.role !== "note" && <span className={s.who}>{c.role === "user" ? t.captions.you : t.captions.agent}: </span>}
            <LineText c={c} />
          </li>
        ))}
        {working && (
          <li className={s.working} data-role="agent">
            <Working label={t.state.working} />
          </li>
        )}
      </ol>
      {card && <div className={s.cardSlot}>{card}</div>}
      <div ref={end} aria-hidden="true" />
      <p role="status" className={s.srOnly}>{announce}</p>
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {composer}
    </main>
  );
}
