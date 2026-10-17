import type { Metadata } from "next";
import Sia from "./Sia";

// The resident app, public (no panel sign-in). Dynamic, so every response gets its own CSP nonce
// (proxy.ts).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SIA", robots: { index: false } };

export default function SiaPage() {
  return <Sia />;
}
