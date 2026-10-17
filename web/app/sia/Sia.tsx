"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import type { Taps } from "@/components/resident/Board";
import { ChatView, NewConversation } from "@/components/resident/ChatView";
import Composer from "@/components/resident/Composer";
import { DEFAULT_PREFS, type Prefs } from "@/components/resident/prefs";
import Shell, { ApplicationsView, FloatingOrb, type ServiceId, type View } from "@/components/resident/Shell";
import VoiceView, { type Caption, toneOf, type VoiceState } from "@/components/resident/VoiceView";
import s from "@/components/resident/resident.module.css";
import { type Dictation, startDictation } from "@/lib/session/dictation";
import { micAllowed, type Session, startSession } from "@/lib/session";
import { en as t } from "@/lib/strings/en";
import { announcement, apply, type Board, EMPTY, hide, logLines, markRefused, type StreamEvent } from "@/lib/ui/stream";
import { addLine, addPart } from "@/lib/lines";

// Cards appear only once a session runs, so they load on demand (the /sia first-load budget).
const ResidentBoard = dynamic(() => import("@/components/resident/Board"), { ssr: false });
// Settings are a separate view, opened rarely: also loaded on demand.
const SettingsView = dynamic(() => import("@/components/resident/Settings"), { ssr: false });

// K8 resident app (S1 MED-329, modes MED-342). The new conversation page offers three ways in:
// type (Text mode), the mic (Voice mode: speech becomes text in the box, Savannah
// replies in text) or the waveform (Live mode: a voice conversation with the orb). Text and Voice
// share one text-only session, so switching between them keeps the conversation; moving into Live
// asks first and starts a new one. Savannah never greets on the web: the resident starts, and the
// AI disclosure sits under the composer. Public: no sign-in.
//
// Cards (S2, MED-331): the backend's ui/v1 events, fetched after each tool result the SDK reports
// (nudge), every 5 s (an officer's decision triggers no tool) and with each tap's reply. A tap goes
// to /api/resident/act with the session's CSRF token; on success the agent gets a contextual update
// with ids only, calls the tool with that confirmation and hears the stored result.

const WORKING_AFTER_MS = 1500;
const EVENTS_POLL_MS = 5000;

// Settings stay on this device: localStorage when it works, memory for this visit when it does not
// (private mode, blocked storage). Read through useSyncExternalStore, so the server render and the
// first client render agree (defaults) and the stored values follow at once.
const PREFS_KEY = "sia.prefs";
const PREFS_EVENT = "sia-prefs";
let memoryPrefs = "{}";

function readPrefs(): string {
  try {
    return localStorage.getItem(PREFS_KEY) ?? memoryPrefs;
  } catch {
    return memoryPrefs;
  }
}

function writePrefs(p: Prefs) {
  memoryPrefs = JSON.stringify(p);
  try {
    localStorage.setItem(PREFS_KEY, memoryPrefs);
  } catch {
    // Kept in memory only.
  }
  window.dispatchEvent(new Event(PREFS_EVENT));
}

function onPrefs(change: () => void) {
  window.addEventListener(PREFS_EVENT, change);
  window.addEventListener("storage", change);
  return () => {
    window.removeEventListener(PREFS_EVENT, change);
    window.removeEventListener("storage", change);
  };
}

function parsePrefs(raw: string): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

const post = (path: string, body?: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

type Phase = "new" | "connecting" | "active" | "ended";
type Kind = "text" | "live";

export default function Sia() {
  const [phase, setPhase] = useState<Phase>("new");
  const [kind, setKind] = useState<Kind>("text");
  const [speaking, setSpeaking] = useState(false);
  const [working, setWorking] = useState(false);
  // A tap waiting for the backend (often 1 to 3 s): the loading line shows.
  const [tapping, setTapping] = useState(false);
  const [lines, setLines] = useState<Caption[]>([]);
  const [draft, setDraft] = useState("");
  const [dictating, setDictating] = useState(false);
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState("");
  // A tap the backend did not carry out; it clears when the resident next sends something or a
  // later tap succeeds, so it never lingers over a later step.
  const [tapNotice, setTapNotice] = useState("");
  const [view, setView] = useState<View>("talk");
  const [service, setService] = useState<ServiceId | undefined>();
  const rawPrefs = useSyncExternalStore(onPrefs, readPrefs, () => "{}");
  const prefs = useMemo(() => parsePrefs(rawPrefs), [rawPrefs]);
  const session = useRef<Session | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const typed = useRef<string[]>([]);
  const workingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenText = useRef(0);
  const confirm = useRef<HTMLDialogElement>(null);
  const [board, setBoardState] = useState<Board>(EMPTY);
  const boardRef = useRef<Board>(EMPTY);
  const csrf = useRef("");
  // Finished cards already summarised in the conversation ("key:seq").
  const logged = useRef(new Set<string>());
  const inFlight = useRef(false);
  // MED-333: a child's form waiting for the parent's consent; sent again once consent is given.
  const pendingForm = useRef<Record<string, unknown> | null>(null);
  const setBoard = (next: (b: Board) => Board) => {
    boardRef.current = next(boardRef.current);
    setBoardState(boardRef.current);
    // MED-332: a finished card replaced by a newer one leaves one line, so the thread keeps it.
    const notes = logLines(boardRef.current, logged.current, t.log);
    if (!notes.length) return;
    for (const n of notes) logged.current.add(n.id);
    setLines((l) => [...l, ...notes.map((n) => ({ role: "note" as const, text: n.text }))]);
  };

  useEffect(() => {
    session.current?.setVolume(prefs.volume / 100);
  }, [prefs.volume]);
  useEffect(() => () => void session.current?.end(), []);

  const stopWorking = () => {
    if (workingTimer.current) clearTimeout(workingTimer.current);
    workingTimer.current = null;
    setWorking(false);
  };
  const startWorking = () => {
    stopWorking();
    workingTimer.current = setTimeout(() => setWorking(true), WORKING_AFTER_MS);
  };

  // Texts for this conversation reach the phone; in a local dry run they wait in handset_inbox and
  // the newest shows here as a notice.
  useEffect(() => {
    if (phase !== "active") return;
    const poll = setInterval(async () => {
      const r = await fetch("/api/resident/inbox", { cache: "no-store" });
      if (!r.ok) return;
      const { messages } = await r.json() as { messages: { id: number; body: string }[] };
      const latest = messages.at(-1);
      if (latest && latest.id !== seenText.current) {
        seenText.current = latest.id;
        setNotice(`${t.session.text}: ${latest.body}`);
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [phase]);

  // New events after the last one this screen has (the route reads the cookie's conversation).
  const fetchEvents = useCallback(async () => {
    const r = await fetch(`/api/resident/events?after=${boardRef.current.seq}`, { cache: "no-store" })
      .catch(() => null);
    if (!r?.ok) return;
    const { events } = await r.json() as { events: StreamEvent[] };
    setBoard((b) => apply(b, events));
  }, []);

  useEffect(() => {
    if (phase !== "active") return;
    const poll = setInterval(() => void fetchEvents(), EVENTS_POLL_MS);
    return () => clearInterval(poll);
  }, [phase, fetchEvents]);

  const say = (text: string) => {
    setTapNotice("");
    typed.current.push(text);
    session.current?.sendText(text);
    setLines((l) => [...l, { role: "user", text }]);
    setDraft("");
    startWorking();
  };

  /** One tap on a card. Done only when the backend says so; otherwise the card stays and a short
   * notice says nothing changed. */
  type ActReply = {
    error?: string;
    events?: StreamEvent[];
    needs_confirmation?: boolean;
    confirmation_id?: string;
    verified?: boolean;
    attempts_left?: number;
    // MED-332: a payment tap's outcome.
    status?: string;
    wrong_code?: boolean;
    wrong_pin?: boolean;
    tries_left?: number;
    already_chosen?: boolean;
    consent_for_form?: boolean;
  };
  const act = async (tap: Record<string, unknown>): Promise<ActReply | null> => {
    // One tap at a time: a double tap on Pay would reach the backend twice and text two codes.
    // A tap while one is in flight is dropped.
    if (inFlight.current) return null;
    inFlight.current = true;
    try {
      return await postTap(tap);
    } finally {
      inFlight.current = false;
    }
  };

  const postTap = async (tap: Record<string, unknown>): Promise<ActReply | null> => {
    setTapping(true);
    const r = await fetch("/api/resident/act", {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf.current },
      body: JSON.stringify({ ...tap, after: boardRef.current.seq }),
    }).catch(() => null);
    const body = await r?.json().catch(() => null) as ActReply | null;
    setTapping(false);
    if (body?.events) setBoard((b) => apply(b, body.events!));
    if (!r?.ok || !body || body.error) {
      if (body?.error === "card_changed" && typeof tap.confirmation_id === "string") {
        setBoard((b) => markRefused(b, tap.confirmation_id as string));
        setTapNotice(t.session.cardChanged);
      } else if (body?.error === "step_up") {
        // A payment tap more than 5 minutes after the identity check: a fresh code first.
        setTapNotice(t.session.stepUp);
        session.current?.context("The resident's tap needs a fresh identity check (step_up): send a new code with identity_start_otp, then they can try the tap again.");
      } else if (body?.error === "not_verified") {
        // A form sent before the identity check. The form stays; Savannah hears it with no form
        // value and starts the check at once.
        session.current?.context("The resident sent the form on screen before being verified, so nothing was submitted. Verify them now (resident number and date of birth, then identity_start_otp); the form stays on the screen to send again after.");
        say(t.session.verifyLine);
        setTapNotice(t.session.verifyFirst);
      } else if (body?.error === "wrong_code") {
        setTapNotice(t.session.wrongCode(body.attempts_left ?? 0));
      } else if (body?.error === "application_open" && boardRef.current.cards["confirm:application_submit"]) {
        // The voice read-back's confirm card is already here, and its yes created the application
        // while the form was being sent: the form is simply done, nothing to say.
        setBoard((b) => hide(b, "form"));
      } else if (body?.error === "application_open") {
        // One at a time (MED-331): say why, and let Savannah know without any form value.
        session.current?.context("Resident tried to submit the form on screen, but an application for this service is already in progress.");
        // The form goes, so it cannot be sent again; a line Savannah answers at once, then the
        // notice (say() clears notices).
        setBoard((b) => hide(b, "form"));
        say(t.session.openLine);
        setTapNotice(t.session.applicationOpen);
      } else setTapNotice(t.session.notDone);
      return null;
    }
    setTapNotice("");
    return body;
  };


  const stopDictation = useCallback(async () => {
    const d = dictation.current;
    dictation.current = null;
    setDictating(false);
    await d?.stop();
  }, []);

  const beginDictation = useCallback(async () => {
    if (dictation.current) return;
    const before = draft.trim();
    setDictating(true);
    try {
      dictation.current = await startDictation({
        onText: (text) => setDraft(before ? `${before} ${text}` : text),
        onEnd: () => {
          dictation.current = null;
          setDictating(false);
        },
        onError: () => {
          dictation.current = null;
          setDictating(false);
          setNotice(t.session.micBlocked);
        },
      });
    } catch {
      setDictating(false);
      setNotice(t.session.micBlocked);
    }
  }, [draft]);

  /** Ends the current session quietly (switching modes, New conversation, leaving). */
  const close = useCallback(async () => {
    await stopDictation();
    const current = session.current;
    session.current = null;
    stopWorking();
    if (current) {
      await current.end();
      await post("/api/resident/end");
    }
  }, [stopDictation]);

  /** The outcome of a code or PIN typed on the payment card. */
  const paid = (r: ActReply | null) => {
    if (!r) return;
    if (r.status === "approved") {
      session.current?.context("Resident approved the payment on screen.");
      say(t.session.paidLine);
    } else if (r.status === "declined") {
      session.current?.context("The payment on screen was declined after three wrong tries.");
      setTapNotice(t.session.payDeclined);
    } else if (r.wrong_pin) setTapNotice(t.session.wrongPin(r.tries_left ?? 0));
    else if (r.wrong_code) setTapNotice(t.session.wrongCode(r.tries_left ?? 0));
  };

  // After a tap the agent gets ids and outcomes only, never a code or a form value.
  const taps: Taps = {
    confirm: async (c) => {
      const ok = await act({ action: "confirm", confirmation_id: c.confirmation_id, shown_hash: c.shown_hash });
      if (!ok) return;
      session.current?.context(`Resident confirmed ${c.tool} on screen, confirmation ${c.confirmation_id}.`);
      // The consent a child's form was waiting for: the form goes again by itself (MED-333), and
      // its own line follows.
      const waiting = pendingForm.current;
      if (c.tool === "consent_record" && waiting) {
        pendingForm.current = null;
        await taps.form(waiting);
        return;
      }
      // A contextual update starts no agent turn, so Savannah would stay silent until the resident
      // spoke: a visible line from the resident starts it.
      say(t.session.confirmedLine);
    },
    refresh: (c) => void act({ action: "refresh", confirmation_id: c.confirmation_id }),
    decline: (key, c) => {
      setBoard((b) => hide(b, key));
      session.current?.context(`Resident chose not now for ${c.tool} on screen, confirmation ${c.confirmation_id}.`);
    },
    dismiss: (key) => setBoard((b) => hide(b, key)),
    // MED-332: the payment card. Savannah hears the method type and the outcome, never a code or PIN.
    payMethod: async (p, methodId) => {
      const ok = await act({ action: "pay_method", payment_id: p.payment_id, method_id: methodId });
      // Chosen before (a retried tap): the backend sent nothing new, so Savannah hears nothing new.
      if (!ok || ok.status !== "pending" || ok.already_chosen) return;
      const card = p.methods?.find((m) => m.method_id === methodId)?.type === "card";
      session.current?.context(
        card
          ? `Resident chose a card on the payment card, payment ${p.payment_id}. A 6-digit code was texted to them: they type it on the card on the screen or read it to you (then payment_confirm).`
          : `Resident chose mobile money on the payment card, payment ${p.payment_id}. They type their PIN on the card on the screen, not on their phone; never ask for it aloud and do not call payment_confirm for it.`,
      );
      say(card ? t.session.payCardLine : t.session.payMobileLine);
    },
    // MED-332: a day picked on the slots card prepares the booking; its confirm card follows.
    slot: async (date, window) => {
      const ok = await act({ action: "slot_pick", date, window });
      if (!ok?.needs_confirmation || !ok.confirmation_id) return;
      session.current?.context(
        `Resident picked ${date}, ${window}, on the slots card. The confirm card for appointment_book, confirmation ${ok.confirmation_id}, is showing.`,
      );
      say(t.session.slotLine);
    },
    // The payment window closed (WCAG 2.2.1): Savannah starts it again with a fresh card.
    payAgain: () => {
      session.current?.context("The payment window on screen closed before it was approved.");
      say(t.session.payAgainLine);
    },
    payCode: async (code) => paid(await act({ action: "pay_code", code })),
    payPin: async (pin) => paid(await act({ action: "pay_pin", pin })),
    code: async (code) => {
      const ok = await act({ action: "identity_code", code });
      if (!ok?.verified) return;
      session.current?.context("Resident entered the code on screen and is verified.");
      // As after a confirm tap: without a line Savannah stays silent.
      say(t.session.codeLine);
    },
    form: async (fields) => {
      const ok = await act({ action: "form_submit", fields });
      if (ok?.consent_for_form && ok.needs_confirmation && ok.confirmation_id) {
        // A child's form: the parent's consent card comes first; no form value goes to Savannah.
        pendingForm.current = fields;
        session.current?.context(
          `Resident filled in the form on screen for a child; the parent's consent is needed first. The consent card for consent_record, confirmation ${ok.confirmation_id}, is showing. After the consent the form is sent again by itself.`,
        );
        say(t.session.consentLine);
        return;
      }
      if (ok?.needs_confirmation && ok.confirmation_id) {
        session.current?.context(
          `Resident filled in the form on screen. The confirm card for application_submit, confirmation ${ok.confirmation_id}, is showing.`,
        );
        // As after a confirm tap: a visible line so Savannah reads back and asks at once (MED-331).
        say(t.session.formLine);
      }
    },
  };

  /** Why a session could not start, in the resident's words. */
  const whyFailed = (message: string) =>
    /daily call limit/i.test(message)
      ? t.session.limit
      : /quota_exceeded|run out of credits/i.test(message)
      ? t.session.noCredits
      : t.session.failed;

  const begin = useCallback(async (want: Kind, opts: { first?: string; dictate?: boolean } = {}) => {
    if (phase === "connecting") return;
    await close();
    setPhase("connecting");
    setNotice("");
    setTapNotice("");
    // The resident's own words and the right view first, then the loading state.
    setKind(want);
    setLines(opts.first ? [{ role: "user", text: opts.first }] : []);
    if (opts.first) typed.current.push(opts.first);
    setMuted(false);
    logged.current.clear();
    setBoard(() => EMPTY);
    csrf.current = "";
    const start = await post("/api/resident/start");
    if (!start.ok) {
      const { error } = await start.json().catch(() => ({ error: "" }));
      setNotice(error === "daily_limit" ? t.session.limit : t.session.failed);
      setPhase("new");
      return;
    }
    const { signedUrl, token, language } = await start.json();
    let as: Kind = want;
    if (as === "live" && !(await micAllowed())) {
      as = "text";
      setNotice(t.session.micBlocked);
    }
    setKind(as);
    try {
      session.current = await startSession({ signedUrl, language, textOnly: as === "text" }, {
        onConnect: async (conversationId) => {
          const bind = await post("/api/resident/bind", { token, conversationId });
          if (!bind.ok) setNotice(t.session.failed);
          else csrf.current = (await bind.json().catch(() => ({}))).csrf ?? "";
          setPhase("active");
          // Extras first, each on its own: none of them may stop the first message or dictation.
          try {
            session.current?.setVolume(prefs.volume / 100);
            // In long voice sessions Savannah slides back to phone habits ("the reference is in your
            // SMS"): say it once, plainly, at the start.
            session.current?.context(
              "This is the Konza resident app, not a phone call: the resident sees cards on a screen (has_screen is true). References are on the screen; fees are paid on the payment card (card or mobile money) or at a desk.",
            );
            if (service) session.current?.context(`The resident chose ${t.nav[service]} in the menu.`);
          } catch {
            // Volume and context are nice to have.
          }
          // Already on screen (above): sent now, with the loading state until the reply streams.
          if (opts.first) {
            session.current?.sendText(opts.first);
            setWorking(true);
          }
          if (opts.dictate && bind.ok) void beginDictation();
        },
        onLine: (line) => {
          if (line.role === "user") {
            // A typed message comes back from the SDK too; it is already on screen.
            const i = typed.current.indexOf(line.text);
            if (i >= 0) {
              typed.current.splice(i, 1);
              return;
            }
            // Live shows Working only while a tool runs (onToolStart); text waits for the reply.
            if (as !== "live") startWorking();
          } else stopWorking();
          setLines((l) => addLine(l, line));
        },
        onPart: (part) => {
          // Words arriving end the loading state; an empty start before a tool call does not.
          if (part.type === "delta" && part.text) stopWorking();
          setLines((l) => addPart(l, part));
        },
        onToolStart: () => {
          if (workingTimer.current) clearTimeout(workingTimer.current);
          setWorking(true);
        },
        onToolResult: () => void fetchEvents(),
        onMode: (m) => {
          setSpeaking(m === "speaking");
          if (m === "speaking") stopWorking();
        },
        onEnd: (byUser) => {
          session.current = null;
          void stopDictation();
          stopWorking();
          setPhase("ended");
          setMuted(false);
          setNotice(byUser ? t.session.ended : t.session.lost);
        },
        // ElevenLabs refuses a session past the agent's daily call limit, or when the account has no
        // credits left: say which.
        onError: (message) => setNotice(whyFailed(message)),
      });
    } catch (e) {
      session.current = null;
      setPhase("new");
      setNotice(whyFailed(String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, prefs.volume, service, close, beginDictation, stopDictation, fetchEvents]);

  const reset = useCallback(async () => {
    await close();
    setPhase("new");
    setLines([]);
    setDraft("");
    setNotice("");
    setTapNotice("");
    setService(undefined);
    setView("talk");
    logged.current.clear();
    setBoard(() => EMPTY);
  }, [close]);

  const active = phase === "active" || phase === "connecting";
  const send = (text: string) => {
    if (dictating) void stopDictation();
    if (phase === "active" && session.current) say(text);
    else void begin("text", { first: text });
  };
  const toggleDictation = () => {
    if (dictating) void stopDictation();
    else if (phase === "active" && kind === "text") void beginDictation();
    else void begin("text", { dictate: true });
  };
  const goLive = () => {
    if (phase === "active" && kind === "text" && lines.length) confirm.current?.showModal();
    else void begin("live");
  };
  const endLive = async () => {
    await session.current?.end();
    session.current = null;
    await post("/api/resident/end");
  };

  const pick = (id: ServiceId) => {
    setService(id);
    setView("talk");
    session.current?.context(`The resident chose ${t.nav[id]} in the menu.`);
  };

  const liveState: VoiceState = phase === "connecting"
    ? "connecting"
    : phase === "ended"
    ? "ended"
    : working || tapping
    ? "working"
    : speaking
    ? "speaking"
    : "listening";
  const inLive = kind === "live" && active;

  const composer = (
    <Composer
      t={t}
      mode={inLive ? "live" : "text"}
      value={draft}
      onChange={setDraft}
      onSend={send}
      dictating={dictating}
      onDictate={toggleDictation}
      onLive={goLive}
      muted={muted}
      onMute={() => {
        session.current?.setMuted(!muted);
        setMuted(!muted);
      }}
      onEnd={endLive}
    />
  );

  const cards = <ResidentBoard board={board} t={t} taps={taps} />;
  const hasCards = Object.keys(board.cards).length > 0;
  const announce = announcement(board, t.announce);

  const shownTheme = prefs.theme === "system" ? undefined : prefs.theme;
  return (
    <Shell
      t={t}
      theme={shownTheme}
      view={view}
      service={service}
      topic={view === "talk" && service ? t.nav[service] : undefined}
      onView={(v) => (v === "talk" ? void reset() : setView(v))}
      onService={pick}
      floating={view !== "talk" && inLive && (
        <FloatingOrb t={t} tone={toneOf(liveState)} onClick={() => setView("talk")} />
      )}
    >
      {view === "talk" && phase === "new" && (
        <NewConversation t={t} composer={composer} notice={tapNotice || notice} onSuggest={(text) => send(text)} />
      )}
      {view === "talk" && phase !== "new" && inLive && (
        <VoiceView
          t={t}
          state={liveState}
          captions={prefs.captions ? lines : []}
          notice={tapNotice || notice}
          level={() => session.current?.level() ?? 0}
          reduceMotion={prefs.motion}
          card={hasCards ? cards : undefined}
          announce={announce}
          composer={composer}
        />
      )}
      {view === "talk" && phase !== "new" && !inLive && (
        <ChatView
          t={t}
          lines={lines}
          working={working || tapping || phase === "connecting"}
          card={hasCards ? cards : undefined}
          announce={announce}
          notice={tapNotice || notice}
          composer={composer}
        />
      )}
      {view === "applications" && <ApplicationsView t={t} />}
      {view === "settings" && <SettingsView t={t} prefs={prefs} onChange={writePrefs} onEnd={reset} />}
      <dialog ref={confirm} className={s.confirmDialog} aria-label={t.composer.live}>
        <p>{t.session.toLive}</p>
        <div className={s.confirmActions}>
          <button type="button" className={s.secondary} onClick={() => confirm.current?.close()}>
            {t.session.cancel}
          </button>
          <button
            type="button"
            className={s.primary}
            onClick={() => {
              confirm.current?.close();
              void begin("live");
            }}
          >
            {t.session.toLiveYes}
          </button>
        </div>
      </dialog>
    </Shell>
  );
}
