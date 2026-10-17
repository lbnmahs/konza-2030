import type { ReactNode } from "react";
import s from "./resident.module.css";

// Loading states (after loading-ui.com's "text shimmer" and "infinity"). Rebuilt in
// the CSS module rather than copied: theirs needs the motion package and an inline <style>, which
// the /sia budget and its strict CSP do not allow. Both fall back to still text and a still loop
// when the resident asks for reduced motion.

/** A light sweeping across the text: something is on its way. */
export function Shimmer({ children }: { children: ReactNode }) {
  return <span className={s.shimmer}>{children}</span>;
}

/** An infinity loop drawn by a moving dash; decorative, so the text beside it says what it means. */
export function InfinityLoop({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`${s.infinity} ${className ?? ""}`}
    >
      <path
        d="M24.3 30C11.4 30 5 43.3 5 50s6.4 20 19.3 20c19.3 0 32.1-40 51.4-40C88.6 30 95 43.3 95 50s-6.4 20-19.3 20C56.4 70 43.6 30 24.3 30z"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The two together: Savannah is working, or a tap is waiting for the backend. */
export function Working({ label }: { label: string }) {
  return (
    <span className={s.loading}>
      <InfinityLoop />
      <Shimmer>{label}</Shimmer>
    </span>
  );
}

/** A line's words; a streamed reply shows each part as it arrived, fading in. */
export function LineText({ c }: { c: { text: string; parts?: string[] } }) {
  if (!c.parts?.length) return <>{c.text}</>;
  return (
    <>
      {c.parts.map((p, i) => (
        <span key={i} className={s.chunk}>
          {p}
        </span>
      ))}
    </>
  );
}
