import { Diplomata_SC, Instrument_Serif, Montserrat } from "next/font/google";

// K8 resident app type: Instrument Serif for headings, Montserrat for everything
// else, Diplomata SC for the SIA wordmark only. next/font downloads the files at build time and
// serves them from our own origin, so the page makes no request to Google and the CSP needs no font
// host. Latin only; Montserrat in the app's two weights.
export const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-serif",
});

export const sans = Montserrat({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-sans",
});

export const logo = Diplomata_SC({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-logo",
});

export const fontVars = `${serif.variable} ${sans.variable} ${logo.variable}`;
