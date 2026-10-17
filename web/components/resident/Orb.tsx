"use client";

import { useEffect, useRef, useState } from "react";
import type { OrbHandle } from "./orbGl";
import s from "./resident.module.css";

// K8 orb. Three tones carry meaning, always next to a state word, never alone:
// green = listening, speaking, done; gold = working or waiting for the resident; red = an error,
// a block or anything that needs attention. The CSS orb paints first and stays as the fallback
// (no WebGL, reduced motion, or before the WebGL layer has loaded). Decorative: aria-hidden.

export type Tone = "green" | "gold" | "red" | "quiet";

export const TONE: Record<Tone, string> = {
  green: "#2f9e6b",
  gold: "#c99a1e",
  red: "#cf4a3c",
  quiet: "#8d949c",
};

/** Probes for WebGL and releases the probe context at once (pages hold only about 16). */
function webgl() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ??
      document.createElement("canvas").getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

export default function Orb(
  { tone, level, reduceMotion, className }: {
    tone: Tone;
    /** Savannah's output level, 0 to 1 (the SDK's getOutputVolume in S1). */
    level?: () => number;
    /** The Settings choice; "system" follows prefers-reduced-motion. */
    reduceMotion?: "system" | "on";
    className?: string;
  },
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<OrbHandle | null>(null);
  const levelRef = useRef(level);
  const [live, setLive] = useState(false);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    const el = canvas.current;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const still = reduceMotion === "on" || media.matches;
    if (!el || still || !webgl()) return;
    let gone = false;
    const stop = () => {
      handle.current?.dispose();
      handle.current = null;
      setLive(false);
    };
    // Mount only while on screen, so off-screen orbs hold no WebGL context.
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return stop();
      if (handle.current) return;
      import("./orbGl").then(({ mountOrb }) => {
        if (gone || handle.current) return;
        handle.current = mountOrb(el, () => levelRef.current?.() ?? 0, stop);
        const base = getComputedStyle(el).getPropertyValue("--orb-base").trim();
        if (base) handle.current.setBase(base);
        setLive(true);
      }).catch(stop);
    });
    io.observe(el);
    return () => {
      gone = true;
      io.disconnect();
      stop();
    };
  }, [reduceMotion]);

  useEffect(() => {
    handle.current?.setColor(TONE[tone]);
  }, [tone, live]);

  return (
    <div
      className={`${s.orb} ${className ?? ""}`}
      data-tone={tone}
      data-live={live || undefined}
      style={{ "--tone": TONE[tone] } as React.CSSProperties}
      aria-hidden="true"
    >
      <canvas ref={canvas} className={s.orbCanvas} />
    </div>
  );
}
