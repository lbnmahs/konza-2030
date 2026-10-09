import type { Metadata } from "next";
import { SCENES } from "@/lib/demo";
import Replay from "./Replay";

export const metadata: Metadata = {
  title: "A family's week in Konza",
  description: "A family's week with the konza-2030 assistant",
};

// The public demo (K6, MED-310): a family's week from curated, redacted calls. Static, no live
// system behind it, no logs.
export default function DemoLanding() {
  return (
    <main style={{ maxWidth: 760, margin: "5vh auto", padding: 16, lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 24 }}>A family&apos;s week in Konza</h1>
      <p>
        Savannah (SIA) is the residents&apos; AI assistant on the phone, in English and Swahili.
        These are recorded test calls: two by the project&apos;s author, the rest with a simulated
        caller, with private values removed. Press Replay to watch a call with the steps the
        system takes behind it.
      </p>
      <ul>
        <li>Savannah says she is an AI at the start of every call.</li>
        <li>Fees, dates and decisions come from published rules or an officer, never from the AI.</li>
        <li>Nothing is paid, submitted or booked without a read-back and a clear yes.</li>
        <li>Every decision comes with its reason and a free review route.</li>
      </ul>
      <p>
        <a href="/transparency">How Savannah works and how it is checked</a>
      </p>
      {SCENES.map((s) => <Replay key={s.id} scene={s} />)}
    </main>
  );
}
