import type { Metadata } from "next";
import { TIER1 } from "@/lib/transparency";

export const metadata: Metadata = {
  title: "How Savannah works",
  description: "How the konza-2030 assistant works and how it is checked",
};

// Tier 1 of SIA's transparency record (K6, MED-308): static, reads no table. Tier 2 is in
// docs/konza/transparency.md.
export default function Transparency() {
  return (
    <main style={{ maxWidth: 680, margin: "5vh auto", padding: 16, lineHeight: 1.55 }}>
      <h1 style={{ fontSize: 24 }}>How Savannah works and how it is checked</h1>
      <p style={{ opacity: 0.8 }}>
        The public summary of the assistant&apos;s transparency record, in two tiers after the UK&apos;s
        Algorithmic Transparency Recording Standard (followed in shape only). Updated 8 October 2026.
      </p>
      {TIER1.map((t) => (
        <section key={t.heading}>
          <h2 style={{ fontSize: 17, marginBottom: 4 }}>{t.heading}</h2>
          <p style={{ marginTop: 0 }}>{t.text}</p>
        </section>
      ))}
      <p>
        <a href="/demo">See a family&apos;s week with Savannah</a>
      </p>
    </main>
  );
}
