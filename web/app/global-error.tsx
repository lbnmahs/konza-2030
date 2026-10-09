"use client";

import IndependentTag from "@/components/IndependentTag";
import "./globals.css";

// Replaces the root layout when it fails, so it carries the independence label itself.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 420, margin: "10vh auto", padding: 16 }}>
          <p>Something went wrong.</p>
          <button type="button" onClick={() => reset()}>Try again</button>
        </main>
        <IndependentTag />
      </body>
    </html>
  );
}
