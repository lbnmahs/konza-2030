"use client";

import { ArrowUp, AudioLines, Mic, MicOff, PhoneOff, Plus, Square } from "lucide-react";
import type { FormEvent } from "react";
import type { Strings } from "@/lib/strings/en";
import s from "./resident.module.css";

// K8 composer (MED-342). A pill with add files, the message box and send;
// beside it either the mode buttons (mic for Voice mode, waveform for Live) or, in a live call,
// mute and end. Typing works in every mode. The AI disclosure sits underneath, always.

export type ComposerMode = "text" | "voice" | "live";

export default function Composer(
  { t, mode, value, onChange, onSend, dictating = false, onDictate, onLive, muted = false, onMute, onEnd }: {
    t: Strings;
    mode: ComposerMode;
    value: string;
    onChange: (v: string) => void;
    onSend: (text: string) => void;
    /** Voice mode: the microphone is turning speech into text in the box. */
    dictating?: boolean;
    onDictate?: () => void;
    onLive?: () => void;
    muted?: boolean;
    onMute?: () => void;
    onEnd?: () => void;
  },
) {
  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = value.trim();
    if (text) onSend(text);
  };
  const live = mode === "live";
  return (
    <div className={s.composerWrap}>
      <form className={s.composerRow} onSubmit={send}>
        <div className={s.composer} data-dictating={dictating || undefined}>
          {/* Uploads arrive with MED-296; the button shows where they will be. */}
          <button
            type="button"
            className={`${s.roundButton} ${s.ghostButton}`}
            aria-disabled="true"
            aria-label={t.composer.files}
            title={t.composer.files}
          >
            <Plus aria-hidden="true" strokeWidth={1.9} />
          </button>
          <input
            className={s.composerInput}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={dictating ? t.composer.listening : t.composer.placeholder}
            aria-label={t.composer.label}
            enterKeyHint="send"
            autoComplete="off"
          />
          {value.trim() && (
            <button type="submit" className={`${s.roundButton} ${s.sendButton}`} aria-label={t.composer.send} title={t.composer.send}>
              <ArrowUp aria-hidden="true" strokeWidth={2} />
            </button>
          )}
        </div>
        {live
          ? (
            <>
              <button
                type="button"
                className={s.modeButton}
                aria-pressed={muted}
                aria-label={muted ? t.composer.unmute : t.composer.mute}
                title={muted ? t.composer.unmute : t.composer.mute}
                onClick={onMute}
              >
                {muted ? <MicOff aria-hidden="true" strokeWidth={1.75} /> : <Mic aria-hidden="true" strokeWidth={1.75} />}
              </button>
              <button
                type="button"
                className={`${s.modeButton} ${s.endButton}`}
                aria-label={t.composer.end}
                title={t.composer.end}
                onClick={onEnd}
              >
                <PhoneOff aria-hidden="true" strokeWidth={1.75} />
              </button>
            </>
          )
          : (
            <>
              <button
                type="button"
                className={s.modeButton}
                aria-pressed={dictating}
                aria-label={dictating ? t.composer.stopDictate : t.composer.dictate}
                title={dictating ? t.composer.stopDictate : t.composer.dictate}
                onClick={onDictate}
              >
                {dictating ? <Square aria-hidden="true" strokeWidth={1.9} /> : <Mic aria-hidden="true" strokeWidth={1.75} />}
              </button>
              <button
                type="button"
                className={`${s.modeButton} ${s.liveButton}`}
                aria-label={t.composer.live}
                title={t.composer.live}
                onClick={onLive}
              >
                <AudioLines aria-hidden="true" strokeWidth={1.9} />
              </button>
            </>
          )}
      </form>
      <p className={s.disclosure}>{t.disclosure}</p>
    </div>
  );
}
