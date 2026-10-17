import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import Preview from "./Preview";

// K8 S0 (MED-326): the five design screens against fixture events, for Mahs to choose the look.
// Dev only: 404 in production builds, and opened in proxy.ts only outside production.
export const metadata: Metadata = { title: "Resident app screens", robots: { index: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <Preview />
    </Suspense>
  );
}
