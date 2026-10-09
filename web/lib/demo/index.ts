// The family's week (K6, MED-310): scenes curated by `deno task demo:curate` from one real test
// call each or the newest passing T1 run (a simulated caller), redacted by audit/redact.ts and
// read by Mahs before publishing. System lines name the rule or step the backend applied; nothing
// from the Audit Office appears here.

import arrival from "./arrival.json";
import business from "./business.json";
import health from "./health.json";
import passportEn from "./passport-en.json";
import passportSw from "./passport-sw.json";
import school from "./school.json";

export type Line = { who: "agent" | "caller" | "system"; text: string };
export type Scene = {
  id: string;
  title: string;
  language: string;
  source: string;
  turns: Line[];
};

export const SCENES = [passportEn, passportSw, arrival, health, business, school] as Scene[];
