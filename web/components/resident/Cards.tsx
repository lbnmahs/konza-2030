"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ClipboardCheck,
  Clock,
  CreditCard,
  FileText,
  IdCard,
  Landmark,
  Lock,
  type LucideIcon,
  Package,
  Scale,
  ShieldCheck,
  Smartphone,
  Sun,
  Sunset,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import type { CardStrings as Strings } from "@/lib/strings/cards";
import {
  type Confirm,
  type Form,
  type Identity,
  kes,
  type Lang,
  type PayMethod,
  type Payment,
  type Progress,
  type Quote,
  type Receipt,
  say,
  type Slots,
} from "@/lib/ui/types";
import s from "./resident.module.css";

// K8 cards (ui/v1), after the chosen patterns (large rounded card, a grouped list of
// label and value rows, big option rows with a tick, pill buttons, a round back button, a stepper
// with ticks, day chips, a code entered in six boxes). Patterns only: no seals, logos or names of
// any real body or brand. All text renders as text. Taps call the handlers given; nothing here
// decides anything. Ids and radio names come from useId.

type Common = { t: Strings; lang?: Lang };

function Card(
  { title, sub, children, foot, wide }: {
    title: string;
    sub?: ReactNode;
    children?: ReactNode;
    foot?: ReactNode;
    /** A full-width action at the foot (the pay and book buttons). */
    wide?: boolean;
  },
) {
  const id = useId();
  return (
    <section className={s.card} aria-labelledby={id}>
      <header className={s.cardHead}>
        <h2 id={id} className={s.cardTitle}>{title}</h2>
        {sub && <div className={s.cardSub}>{sub}</div>}
      </header>
      {children}
      {foot && <div className={wide ? s.cardFootWide : s.cardFoot}>{foot}</div>}
    </section>
  );
}

function Back({ t, onBack }: { t: Strings; onBack?: () => void }) {
  return (
    <button type="button" className={s.backButton} aria-label={t.card.back} title={t.card.back} onClick={onBack}>
      <ChevronLeft aria-hidden="true" strokeWidth={2} />
    </button>
  );
}

function Status({ tone, icon, children }: { tone: "ok" | "warn" | "error"; icon: ReactNode; children: ReactNode }) {
  return (
    <span className={`${s.status} ${s[tone]}`}>
      <span className={s.statusIcon} aria-hidden="true">{icon}</span>
      {children}
    </span>
  );
}

/** Seconds until an ISO time. Ticks only after mount (no server and client mismatch); offsetMs is
 * the server clock minus this device's, so a wrong device clock never opens Confirm early. */
function useLeft(iso: string | undefined, opts: { now?: number; offsetMs?: number } = {}) {
  const [tick, setTick] = useState<number | null>(opts.now ?? null);
  useEffect(() => {
    if (!iso || opts.now !== undefined) return;
    const update = () => setTick(Date.now() + (opts.offsetMs ?? 0));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [iso, opts.now, opts.offsetMs]);
  if (!iso || tick === null) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - tick) / 1000));
}

const timeLeft = (t: Strings, left: number | null) =>
  left === null ? null : (
    <span className={s.timer}>
      <Clock aria-hidden="true" strokeWidth={1.75} />
      {t.card.left(Math.floor(left / 60), left % 60)}
    </span>
  );

/** WCAG 2.2.1 (MED-332): a screen reader hears, once each, that a minute is left and that time is
 * up. The words change only at those two moments, so the status region speaks only then; Refresh,
 * Send again or Start again extends it. */
function TimeWarning({ t, left }: { t: Strings; left: number | null }) {
  const say = left === null ? "" : left === 0 ? t.card.timeUp : left <= 60 ? t.card.oneMinute : "";
  return <span role="status" className={s.srOnly}>{say}</span>;
}

const STEP_ICON: Record<string, LucideIcon> = {
  identity: IdCard,
  consent: ShieldCheck,
  details: FileText,
  confirm: ClipboardCheck,
  pay: CreditCard,
  book: CalendarDays,
  deliver: Package,
  decision: Scale,
};

/** The service rail: done steps carry a tick (green, like the orb's success), the current step its
 * icon. Horizontal in the conversation; vertical in the wide side panel (CSS only). */
const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })
    .format(new Date(iso));

export function ProgressCard({ p, t, lang = "en" }: Common & { p: Progress }) {
  return (
    <Card
      title={say(p.title, lang)}
      sub={p.updated && t.card.updated(clock(p.updated.at), say(p.updated.source, lang))}
    >
      <ol className={s.stepper}>
        {p.steps.map((st) => {
          const Icon = STEP_ICON[st.id] ?? FileText;
          return (
            <li key={st.id} data-state={st.state}>
              <span className={s.stepDot} aria-hidden="true">
                {st.state === "done" ? <Check strokeWidth={2.5} /> : <Icon strokeWidth={1.9} />}
              </span>
              <span className={s.stepLabel}>
                {t.steps[st.id]}
                <span className={s.srOnly}>, {t.stepState[st.state]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** One input carries the code (paste, autofill and screen readers see one field); six boxes are
 * drawn from its value. */
function CodeBoxes({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className={s.codeBoxes}>
      <input
        id={id}
        className={s.codeInput}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className={s.codeBox}
          data-filled={i < value.length || undefined}
          data-next={i === Math.min(value.length, 5) || undefined}
          aria-hidden="true"
        >
          {value[i] ?? ""}
        </span>
      ))}
    </div>
  );
}

export function IdentityCard(
  { i, t, now, onCheck, onResend, onContinue }: Common & {
    i: Identity;
    now?: number;
    onCheck?: (code: string) => void;
    onResend?: () => void;
    onContinue?: () => void;
  },
) {
  const id = useId();
  const [code, setCode] = useState("");
  const left = useLeft(i.expires_at, { now });
  if (i.step === "verified") {
    return (
      <section className={`${s.card} ${s.verified}`} aria-label={t.identity.verified}>
        <span className={s.verifiedBadge} aria-hidden="true"><Check strokeWidth={2.5} /></span>
        <h2 className={s.cardTitle}>{t.identity.verified}</h2>
        <p className={s.cardSub}>{t.identity.verifiedText}</p>
        <button type="button" className={s.primaryWide} onClick={onContinue}>{t.identity.continue}</button>
      </section>
    );
  }
  if (i.step === "details") return <Card title={t.identity.title} sub={t.identity.details} />;
  return (
    <Card
      title={t.identity.sent(i.channel ?? "sms")}
      sub={t.identity.code(i.channel ?? "sms")}
      wide
      foot={
        <>
          <button
            type="button"
            className={s.primaryWide}
            aria-disabled={code.length < 6}
            onClick={() => code.length === 6 && onCheck?.(code)}
          >
            {t.identity.check}
          </button>
          <p className={s.footNote}>
            {t.identity.noCode}{" "}
            <button type="button" className={s.textButton} onClick={onResend}>{t.identity.sendAgain}</button>
          </p>
        </>
      }
    >
      <label htmlFor={id} className={s.srOnly}>{t.identity.field}</label>
      <CodeBoxes id={id} value={code} onChange={setCode} />
      <p className={s.meta}>
        {timeLeft(t, left)}
        <TimeWarning t={t} left={left} />
        {i.attempts_left !== undefined && <span>{t.identity.attempts(i.attempts_left)}</span>}
      </p>
    </Card>
  );
}

function OptionRow(
  { name, checked, onPick, multiple, children }: {
    name: string;
    checked: boolean;
    onPick: () => void;
    multiple?: boolean;
    children: ReactNode;
  },
) {
  return (
    <label className={s.option}>
      <input type={multiple ? "checkbox" : "radio"} name={name} checked={checked} onChange={onPick} />
      <span className={s.optionText}>{children}</span>
      <span className={s.optionTick} aria-hidden="true">{checked && <Check strokeWidth={2.25} />}</span>
    </label>
  );
}

export function FormCard(
  { f, t, lang = "en", onBack, onNext }: Common & {
    f: Form;
    onBack?: () => void;
    onNext?: (values: Record<string, unknown>) => void;
  },
) {
  const base = useId();
  const [values, setValues] = useState<Record<string, unknown>>(
    Object.fromEntries(f.fields.filter((x) => x.value !== undefined).map((x) => [x.name, x.value])),
  );
  const set = (k: string, v: unknown) => setValues({ ...values, [k]: v });
  return (
    <Card
      title={say(f.title, lang)}
      foot={
        <>
          <Back t={t} onBack={onBack} />
          <button type="button" className={s.primary} onClick={() => onNext?.(values)}>{t.card.next}</button>
        </>
      }
    >
      {f.fields.map((field) => {
        const name = `${base}-${field.name}`;
        const label = say(field.label, lang) + (field.required ? "" : ` (${t.card.optional.toLowerCase()})`);
        if (field.options) {
          return (
            <fieldset key={field.name} className={s.options}>
              <legend>{label}</legend>
              {field.options.map((o) => (
                <OptionRow
                  key={String(o.value)}
                  name={name}
                  multiple={field.multiple}
                  checked={values[field.name] === o.value}
                  onPick={() => set(field.name, o.value)}
                >
                  {say(o.label, lang)}
                </OptionRow>
              ))}
            </fieldset>
          );
        }
        if (field.type === "boolean") {
          // A tick box is optional by nature, so no "(optional)"; set apart from the choice above
          // so it never reads as one more option.
          return (
            <div key={field.name} className={`${s.options} ${s.tick}`}>
              <OptionRow
                name={name}
                multiple
                checked={values[field.name] === true}
                onPick={() => set(field.name, values[field.name] !== true)}
              >
                {say(field.label, lang)}
              </OptionRow>
            </div>
          );
        }
        return (
          <div key={field.name} className={s.field}>
            <label htmlFor={name}>{label}</label>
            <input
              id={name}
              inputMode={field.type === "integer" ? "numeric" : undefined}
              value={String(values[field.name] ?? "")}
              onChange={(e) => set(field.name, e.target.value)}
            />
          </div>
        );
      })}
    </Card>
  );
}

export function QuoteCard({ q, t, lang = "en" }: Common & { q: Quote }) {
  return (
    <Card title={say(q.title, lang)}>
      <dl className={s.group}>
        {q.rows.map((r) => (
          <div className={s.row} key={say(r.label, "en")}>
            <dt>{say(r.label, lang)}</dt>
            <dd>{kes(r.amount_kes)}</dd>
          </div>
        ))}
      </dl>
      <p className={s.meta}>
        <span>{t.card.rule} <span className={s.nowrap}>{q.rule_ids.join(", ")}</span></span>
      </p>
    </Card>
  );
}

export function ConfirmCard(
  { c, t, lang = "en", now, offsetMs, onConfirm, onDecline, onRefresh }: Common & {
    c: Confirm;
    /** Fixed clock for previews; live cards tick. */
    now?: number;
    offsetMs?: number;
    onConfirm?: () => void;
    onDecline?: () => void;
    onRefresh?: () => void;
  },
) {
  const left = useLeft(c.expires_at, { now, offsetMs });
  const wait = useLeft(c.earliest_at, { now, offsetMs });
  const ready = wait === 0;
  const expired = c.state === "expired" || (c.state === "open" && left === 0);
  const again = (word: string, tone: "warn" | "error", icon: ReactNode) => (
    <>
      <Status tone={tone} icon={icon}>{word}</Status>
      <button type="button" className={s.secondary} onClick={onRefresh}>{t.card.refresh}</button>
    </>
  );
  return (
    <Card
      title={say(c.title, lang)}
      foot={c.state === "done"
        ? <Status tone="ok" icon={<Check />}>{t.card.done}</Status>
        : c.state === "refused"
        ? again(t.card.notDone, "error", <X />)
        : expired
        ? again(t.card.expired, "warn", <Clock />)
        : (
          <>
            {timeLeft(t, left)}
            <TimeWarning t={t} left={left} />
            <span className={s.footActions}>
              <button type="button" className={s.secondary} onClick={onDecline}>{t.card.notNow}</button>
              {/* aria-disabled, not disabled: it stays in the tab order during the 4 s wait. */}
              <button
                type="button"
                className={s.primary}
                aria-disabled={!ready}
                onClick={() => ready && onConfirm?.()}
              >
                {t.card.confirm}
              </button>
            </span>
          </>
        )}
    >
      <div className={s.group}>
        <p className={s.readback}>{say(c.readback, lang)}</p>
      </div>
      {c.variant === "consent" && (
        <p className={s.footNote}>
          <ShieldCheck aria-hidden="true" strokeWidth={1.75} /> {t.card.consentNote}
        </p>
      )}
    </Card>
  );
}

const dayParts = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone: "UTC" }).format(d);
  return { weekday: f({ weekday: "short" }), day: f({ day: "numeric", month: "short" }) };
};

/** Days as a row of chips (scrolls sideways when there are many), then the time windows as tiles. */
export function SlotsCard(
  { slots, t, lang = "en", onBook }: Common & {
    slots: Slots;
    onBook?: (date: string, window: string) => void;
  },
) {
  const id = useId();
  const [day, setDay] = useState(slots.selected?.date ?? slots.days[0]?.date);
  const [win, setWin] = useState<string>(slots.selected?.window ?? slots.windows[0]?.id);
  return (
    <Card
      title={say(slots.title, lang)}
      sub={say(slots.place, lang)}
      wide
      foot={
        <button type="button" className={s.primaryWide} onClick={() => onBook?.(day, win)}>{t.card.book}</button>
      }
    >
      <fieldset className={s.picker}>
        <legend>{t.card.day}</legend>
        <div className={s.dayRow}>
          {slots.days.map((d) => {
            const p = dayParts(d.date);
            return (
              <label key={d.date} className={s.dayChip}>
                <input
                  type="radio"
                  name={`${id}-day`}
                  value={d.date}
                  checked={day === d.date}
                  onChange={() => setDay(d.date)}
                  aria-label={say(d.label, lang)}
                />
                <span aria-hidden="true">{p.weekday}</span>
                <strong aria-hidden="true">{p.day}</strong>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className={s.picker}>
        <legend>{t.card.time}</legend>
        <div className={s.windowRow}>
          {slots.windows.map((w) => {
            const Icon = w.id === "morning" ? Sun : Sunset;
            return (
              <label key={w.id} className={s.windowTile}>
                <input
                  type="radio"
                  name={`${id}-window`}
                  value={w.id}
                  checked={win === w.id}
                  onChange={() => setWin(w.id)}
                />
                <Icon aria-hidden="true" strokeWidth={1.75} />
                <span>{say(w.label, lang)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </Card>
  );
}

const methodLabel = (t: Strings, m: Pick<PayMethod, "type">) => (m.type === "card" ? t.pay.card : t.pay.mobile);
const MethodIcon = ({ m }: { m: Pick<PayMethod, "type"> }) =>
  m.type === "card"
    ? <CreditCard aria-hidden="true" strokeWidth={1.75} />
    : <Smartphone aria-hidden="true" strokeWidth={1.75} />;

/** The simulated payment (MED-332, plan-k8 2.10). Choose a masked method the resident
 * already holds and tick the statement; a card then gets a code texted to the phone (typed here or
 * read to Savannah), mobile money the resident's PIN typed here. The PIN and the code go to the
 * backend only; nothing is charged. Paid shows as PaidCard. */
export function PaymentCard(
  { p, t, lang = "en", now, offsetMs, onChoose, onCode, onPin, onAgain }: Common & {
    p: Payment;
    now?: number;
    offsetMs?: number;
    onChoose?: (methodId: string) => void;
    onCode?: (code: string) => void;
    onPin?: (pin: string) => void;
    /** The window closed: Savannah starts the payment again (WCAG 2.2.1, MED-332). */
    onAgain?: () => void;
  },
) {
  const id = useId();
  const methods = p.methods ?? [];
  const [method, setMethod] = useState(p.method_id ?? methods[0]?.method_id ?? "");
  const [sure, setSure] = useState(false);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const left = useLeft(p.expires_at, { now, offsetMs });
  const amount = kes(p.amount_kes);
  const chosen = methods.find((m) => m.method_id === (p.method_id ?? method));
  // Closed by the backend, or by the clock before the backend has said so: never "Approve" at 0:00.
  const closed = p.state === "expired" || ((p.state === "choose" || p.state === "code" || p.state === "pin") && left === 0);
  const done = p.state === "declined"
    ? <Status tone="error" icon={<X />}>{t.pay.declined}</Status>
    : closed
    ? (
      <>
        <Status tone="warn" icon={<Clock />}>{t.pay.expired}</Status>
        <button type="button" className={s.secondary} onClick={onAgain}>{t.pay.again}</button>
      </>
    )
    : null;
  const ready = p.state === "choose" ? sure && !!method : p.state === "code" ? code.length === 6 : pin.length >= 4;
  const act = () => {
    if (!ready) return;
    if (p.state === "choose") onChoose?.(method);
    else if (p.state === "code") onCode?.(code);
    else if (p.state === "pin") onPin?.(pin);
  };
  return (
    <Card
      title={p.state === "code" ? t.pay.codeTitle : p.state === "pin" ? t.pay.pinTitle : t.pay.title}
      sub={p.state === "code" ? t.pay.codeSub : p.state === "pin" ? t.pay.pinSub : undefined}
      wide
      foot={done ?? (
        <>
          <button type="button" className={s.primaryWide} aria-disabled={!ready} onClick={act}>
            {p.state === "choose" ? t.pay.pay(amount) : t.pay.approve}
          </button>
          <p className={s.footNote}>
            <Lock aria-hidden="true" strokeWidth={1.75} /> {t.pay.simulated}
          </p>
        </>
      )}
    >
      <div className={s.payItem}>
        <span className={s.payIcon} aria-hidden="true"><FileText strokeWidth={1.75} /></span>
        <span className={s.payText}>
          <strong>{say(p.label, lang)}</strong>
        </span>
        <strong className={s.payAmount}>{amount}</strong>
      </div>
      {p.state === "choose" && methods.length > 0 && (
        <fieldset className={s.options}>
          <legend>{t.pay.method}</legend>
          {methods.map((m) => (
            <OptionRow
              key={m.method_id}
              name={`${id}-method`}
              checked={method === m.method_id}
              onPick={() => setMethod(m.method_id)}
            >
              <span className={s.methodLine}>
                <MethodIcon m={m} />
                {methodLabel(t, m)} <span className={s.nowrap}>{m.masked}</span>
              </span>
            </OptionRow>
          ))}
        </fieldset>
      )}
      {p.state !== "choose" && chosen && (
        <div className={s.payItem}>
          <span className={s.payIcon}><MethodIcon m={chosen} /></span>
          <span className={s.payText}>
            <span>{t.pay.method}</span>
            <strong>{methodLabel(t, chosen)} <span className={s.nowrap}>{chosen.masked}</span></strong>
          </span>
        </div>
      )}
      {p.state === "choose" && (
        <label className={s.affirm}>
          <span>{t.pay.affirm}</span>
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        </label>
      )}
      {p.state === "code" && (
        <>
          <label htmlFor={`${id}-code`} className={s.srOnly}>{t.pay.codeField}</label>
          <CodeBoxes id={`${id}-code`} value={code} onChange={setCode} />
        </>
      )}
      {p.state === "pin" && (
        <div className={s.field}>
          <label htmlFor={`${id}-pin`}>{t.pay.pinField}</label>
          <input
            id={`${id}-pin`}
            className={s.pinInput}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{4,6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === "Enter") act();
            }}
          />
        </div>
      )}
      <p className={s.meta}>
        {!done && timeLeft(t, left)}
        {p.state !== "declined" && p.state !== "expired" && <TimeWarning t={t} left={left} />}
        {(p.state === "code" || p.state === "pin") && p.attempts_left !== undefined && (
          <span>{t.pay.attempts(p.attempts_left)}</span>
        )}
        <span className={s.desk}>
          <Landmark aria-hidden="true" strokeWidth={1.75} />
          {say(p.desk, lang)}
        </span>
      </p>
    </Card>
  );
}

/** A rules date (YYYY-MM-DD) in words, for reading; the date itself comes from the backend. */
const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso}T00:00:00Z`));

/** A fee approved with the phone code (PY-01): the amount and the transaction reference that
 * SIA says is on the screen (MED-331). Other payment states wait for the on-screen payment (2.10). */
export function PaidCard({ p, t, lang = "en" }: Common & { p: Payment }) {
  return (
    <Card title={t.pay.received} sub={<Status tone="ok" icon={<Check />}>{t.pay.paid}</Status>}>
      <dl className={s.group}>
        <div className={s.row}>
          <dt>{say(p.label, lang)}</dt>
          <dd>{kes(p.amount_kes)}</dd>
        </div>
        {p.reference && (
          <div className={s.row}>
            <dt>{t.pay.reference}</dt>
            <dd className={s.nowrap}>{p.reference}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

export function ReceiptCard({ r, t, lang = "en" }: Common & { r: Receipt }) {
  const who = r.decided_by === "rule"
    ? <>{t.card.rulePublished} (<span className={s.nowrap}>{r.rule_ids.join(", ")}</span>)</>
    : r.decided_by === "officer"
    ? t.card.officer
    : t.card.pending;
  const tone = r.outcome === "granted" ? "ok" : r.outcome === "refused" ? "error" : "warn";
  const icon = r.outcome === "granted" ? <Check /> : r.outcome === "refused" ? <X /> : <Clock />;
  return (
    <Card
      title={t.card.decision}
      sub={<Status tone={tone} icon={icon}>{t.outcome[r.outcome]}</Status>}
      // A new tab: leaving /sia would end the voice session.
      foot={r.link && (
        <a className={s.secondary} href={r.link} target="_blank" rel="noopener noreferrer">
          {t.card.open}
          <span className={s.srOnly}> {t.card.newTab}</span>
        </a>
      )}
    >
      <dl className={s.group}>
        {r.ref && (
          <div className={s.stackRow}>
            <dt>{t.pay.reference}</dt>
            <dd className={s.nowrap}>{r.ref}</dd>
          </div>
        )}
        <div className={s.stackRow}>
          <dt>{t.card.decidedBy}</dt>
          <dd>{who}</dd>
        </div>
        <div className={s.stackRow}>
          <dt>{t.card.why}</dt>
          <dd>{say(r.reason, lang)}</dd>
        </div>
        {r.next && (
          <div className={s.stackRow}>
            <dt>{t.card.nextStep}</dt>
            <dd>{say(r.next, lang)}</dd>
          </div>
        )}
        <div className={s.stackRow}>
          <dt>{t.card.review}</dt>
          <dd>{t.card.reviewLine(longDate(r.review.ask_by))}</dd>
        </div>
      </dl>
    </Card>
  );
}
