"use client";

import { useEffect, useState } from "react";
import type { Scene } from "@/lib/demo";
import { INDEPENDENT_TAG_SW } from "@/lib/labels";

// Shows the whole conversation, or replays it turn by turn with the system steps.
export default function Replay({ scene }: { scene: Scene }) {
  const [shown, setShown] = useState(scene.turns.length);
  const [playing, setPlaying] = useState(false);

  // Playing until the last turn is shown; the effect only schedules the next turn.
  const active = playing && shown < scene.turns.length;
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setShown((n) => n + 1), 1400);
    return () => clearTimeout(t);
  }, [active, shown]);

  return (
    <section
      lang={scene.language}
      style={{ borderTop: "1px solid #444", marginTop: 24, paddingTop: 12 }}
    >
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>{scene.title}</h2>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Savannah, SIA ({scene.language === "sw" ? "Swahili" : "English"}); {scene.source}.
      </p>
      {scene.language === "sw" && <p style={{ fontSize: 13, opacity: 0.8 }}>{INDEPENDENT_TAG_SW}</p>}
      <button
        onClick={() => {
          setShown(0);
          setPlaying(true);
        }}
        disabled={active}
      >
        Replay
      </button>
      <ol aria-live="polite" style={{ paddingLeft: 18, overflowWrap: "anywhere" }}>
        {scene.turns.slice(0, shown).map((t, i) => (
          <li key={i} style={t.who === "system" ? { opacity: 0.75, fontStyle: "italic" } : {}}>
            <strong>
              {t.who === "agent" ? "Savannah (AI)" : t.who === "caller" ? "Caller" : "System"}
            </strong>: {t.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
