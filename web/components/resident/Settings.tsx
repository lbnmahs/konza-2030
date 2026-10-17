"use client";

import { useId } from "react";
import type { Strings } from "@/lib/strings/en";
import s from "./resident.module.css";

// K8 settings. Per device only: nothing here is sent to the backend or
// stored with a case. S1 keeps the values in localStorage and wires them to the session.

import type { Prefs } from "./prefs";
export { DEFAULT_PREFS, type Prefs } from "./prefs";

function Choice<V extends string>(
  { legend, value, options, onChange }: {
    legend: string;
    value: V;
    options: { v: V; label: string }[];
    onChange: (v: V) => void;
  },
) {
  const name = useId();
  return (
    <fieldset className={s.segmented}>
      <legend>{legend}</legend>
      <div>
        {options.map((o) => (
          <label key={o.v}>
            <input type="radio" name={name} checked={value === o.v} onChange={() => onChange(o.v)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function SettingsView(
  { t, prefs, onChange, onEnd }: {
    t: Strings;
    prefs: Prefs;
    onChange: (p: Prefs) => void;
    onEnd?: () => void;
  },
) {
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => onChange({ ...prefs, [k]: v });
  const volumeId = useId();
  const captionsId = useId();
  return (
    <main className={s.column}>
      <h1 className={s.viewTitle}>{t.settings.title}</h1>
      <p className={s.hint}>{t.settings.device}</p>
      <div className={s.settings}>
        <Choice legend={t.settings.theme} value={prefs.theme} onChange={set("theme")}
          options={(["system", "light", "dark"] as const).map((v) => ({ v, label: t.settings.themes[v] }))} />
        <Choice legend={t.settings.motion} value={prefs.motion} onChange={set("motion")}
          options={(["system", "on"] as const).map((v) => ({ v, label: t.settings.motions[v] }))} />
        <div className={s.setting}>
          <label htmlFor={captionsId}>{t.settings.captions}</label>
          <input id={captionsId} type="checkbox" className={s.switch} role="switch"
            checked={prefs.captions} onChange={(e) => set("captions")(e.target.checked)} />
        </div>
        <div className={s.settingStack}>
          <label htmlFor={volumeId}>{t.settings.volume}</label>
          <input id={volumeId} type="range" min={0} max={100} step={10} value={prefs.volume}
            aria-valuetext={`${prefs.volume}%`} onChange={(e) => set("volume")(Number(e.target.value))} />
        </div>
        <section className={s.settingStack} aria-labelledby={`${volumeId}-privacy`}>
          <h2 id={`${volumeId}-privacy`} className={s.settingHead}>{t.settings.privacy}</h2>
          <p className={s.hint}>{t.settings.privacyText}</p>
        </section>
      </div>
      <button type="button" className={`${s.secondary} ${s.endSession}`} onClick={onEnd}>
        {t.settings.end}
      </button>
    </main>
  );
}
