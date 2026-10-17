"use client";

import {
  Briefcase,
  Building2,
  Compass,
  FileText,
  HeartPulse,
  IdCard,
  type LucideIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plane,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { fontVars } from "@/lib/fonts";
import type { Strings } from "@/lib/strings/en";
import Orb, { type Tone } from "./Orb";
import s from "./resident.module.css";

// K8 resident shell: a sidebar like the common assistant apps. Wide (the app, not
// the window, at least 760 px): a 264 px sidebar that collapses to a 64 px icon rail. Narrow: the
// same list in a drawer (a modal <dialog>, so focus stays inside and Escape closes it) behind a
// menu button. A service opens Savannah on that service; it never opens a form of its own. The
// label sits at the foot of the main column.

export type View = "talk" | "applications" | "settings";
export const SERVICES = ["explore", "travel", "health", "business", "identity", "city"] as const;
export type ServiceId = (typeof SERVICES)[number];

const ICON: Record<ServiceId | "applications" | "settings", LucideIcon> = {
  explore: Compass,
  travel: Plane,
  health: HeartPulse,
  business: Briefcase,
  identity: IdCard,
  city: Building2,
  applications: FileText,
  settings: Settings,
};

type Nav = {
  t: Strings;
  view: View;
  service?: ServiceId;
  onView?: (v: View) => void;
  onService?: (id: ServiceId) => void;
};

function Item(
  { icon: Icon, label, current, rail, onClick }: {
    icon: LucideIcon;
    label: string;
    current?: boolean;
    rail?: boolean;
    onClick?: () => void;
  },
) {
  return (
    <li>
      <button
        type="button"
        className={s.navItem}
        aria-current={current ? "page" : undefined}
        aria-label={rail ? label : undefined}
        title={rail ? label : undefined}
        onClick={onClick}
      >
        <Icon className={s.navIcon} aria-hidden="true" strokeWidth={1.75} />
        {!rail && <span>{label}</span>}
      </button>
    </li>
  );
}

function SidebarBody(
  { t, view, service, onView, onService, rail, head, after }: Nav & {
    rail?: boolean;
    head: ReactNode;
    after?: () => void;
  },
) {
  const go = (fn: () => void) => () => {
    fn();
    after?.();
  };
  return (
    <>
      <div className={s.sideHead}>
        {!rail && <span className={s.brand}>SIA</span>}
        {head}
      </div>
      <ul className={s.navList}>
        <Item icon={Plus} label={t.nav.fresh} rail={rail} onClick={go(() => onView?.("talk"))} />
      </ul>
      <p className={rail ? s.srOnly : s.navHead}>{t.nav.servicesHead}</p>
      <ul className={s.navList}>
        {SERVICES.map((id) => (
          <Item
            key={id}
            icon={ICON[id]}
            label={t.nav[id]}
            rail={rail}
            current={view === "talk" && service === id}
            onClick={go(() => onService?.(id))}
          />
        ))}
      </ul>
      <ul className={s.navList}>
        <Item
          icon={ICON.applications}
          label={t.nav.applications}
          rail={rail}
          current={view === "applications"}
          onClick={go(() => onView?.("applications"))}
        />
      </ul>
      <ul className={`${s.navList} ${s.navFoot}`}>
        <Item
          icon={ICON.settings}
          label={t.nav.settings}
          rail={rail}
          current={view === "settings"}
          onClick={go(() => onView?.("settings"))}
        />
      </ul>
    </>
  );
}

export default function Shell(
  { theme, topic, floating, children, ...nav }: Nav & {
    theme?: "light" | "dark";
    /** The chosen service, shown as a chip at the top of the conversation. */
    topic?: string;
    /** The small orb that floats while the resident browses applications or settings. */
    floating?: ReactNode;
    children: ReactNode;
  },
) {
  const { t } = nav;
  const [rail, setRail] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = drawer.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Opening applications or settings moves focus to the view's
  // heading, so it is announced and Tab continues inside it (the view may still be loading, so
  // wait briefly for its new heading). The conversation keeps focus where Sia puts it.
  const shown = useRef(nav.view);
  useEffect(() => {
    if (shown.current === nav.view) return;
    shown.current = nav.view;
    if (nav.view === "talk") return;
    const before = document.querySelector("[data-resident] main h1");
    let tries = 0;
    const id = setInterval(() => {
      const h = document.querySelector<HTMLElement>("[data-resident] main h1");
      if ((h && h !== before) || ++tries > 40) {
        clearInterval(id);
        if (h) focusHeading(h);
      }
    }, 50);
    return () => clearInterval(id);
  }, [nav.view]);

  return (
    <div className={`${s.app} ${fontVars}`} data-resident data-theme={theme} lang="en">
      <a
        href="#content"
        className={s.skip}
        onClick={(e) => {
          e.preventDefault();
          const h = document.querySelector<HTMLElement>("[data-resident] main h1") ??
            document.querySelector<HTMLElement>("[data-resident] main");
          if (h) focusHeading(h);
        }}
      >
        {t.nav.skip}
      </a>
      <div className={s.shell} data-rail={rail || undefined}>
        <nav className={s.sidebar} aria-label={t.nav.label}>
          <SidebarBody
            {...nav}
            rail={rail}
            head={
              <button
                type="button"
                className={s.iconButton}
                aria-label={rail ? t.nav.expand : t.nav.collapse}
                aria-expanded={!rail}
                title={rail ? t.nav.expand : t.nav.collapse}
                onClick={() => setRail(!rail)}
              >
                {rail
                  ? <PanelLeftOpen aria-hidden="true" strokeWidth={1.75} />
                  : <PanelLeftClose aria-hidden="true" strokeWidth={1.75} />}
              </button>
            }
          />
        </nav>
        <dialog
          ref={drawer}
          className={s.drawer}
          aria-label={t.nav.label}
          onClose={() => setOpen(false)}
          onClick={(e) => e.target === drawer.current && setOpen(false)}
        >
          <nav className={s.drawerBody} aria-label={t.nav.label}>
            <SidebarBody
              {...nav}
              after={() => setOpen(false)}
              head={
                <button
                  type="button"
                  className={s.iconButton}
                  aria-label={t.nav.close}
                  onClick={() => setOpen(false)}
                >
                  <X aria-hidden="true" strokeWidth={1.75} />
                </button>
              }
            />
          </nav>
        </dialog>
        <div className={s.main}>
          <header className={s.topbar}>
            <button
              type="button"
              className={`${s.iconButton} ${s.menuButton}`}
              aria-label={t.nav.open}
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu aria-hidden="true" strokeWidth={1.75} />
            </button>
            {topic && <span className={s.chip}>{topic}</span>}
          </header>
          {children}
          {/* In the conversation the composer's line carries the label. */}
          {nav.view !== "talk" && <footer className={s.footer}>{t.label}</footer>}
        </div>
        {floating}
      </div>
    </div>
  );
}

/** Focus a heading or region that is not focusable by itself (no tab stop is added). */
function focusHeading(el: HTMLElement) {
  if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
  el.focus();
}

/** Verified residents only (MED-331 fills it with progress cards from the core's states). */
export function ApplicationsView({ t }: { t: Strings }) {
  return (
    <main className={s.column}>
      <h1 className={s.viewTitle}>{t.applications.title}</h1>
      <p className={s.empty}>{t.applications.empty}</p>
      <p className={s.hint}>{t.applications.verified}</p>
    </main>
  );
}

/** While the resident browses applications or settings, the orb contracts into this button. */
export function FloatingOrb({ t, tone, onClick }: { t: Strings; tone: Tone; onClick?: () => void }) {
  return (
    <button type="button" className={s.floatOrb} aria-label={t.nav.back} title={t.nav.back} onClick={onClick}>
      <Orb tone={tone} className={s.orbSmall} />
    </button>
  );
}
