import type { Metadata, Viewport } from "next";
import IndependentTag from "@/components/IndependentTag";
import "./globals.css";

export const metadata: Metadata = {
  title: "konza-2030",
  description: "konza-2030: a personal government assistant for every resident",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        {children}
        <IndependentTag />
      </body>
    </html>
  );
}
