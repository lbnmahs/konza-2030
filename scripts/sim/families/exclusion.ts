// Exclusion family (K4, MED-275; the K4 design notes (kept private) section 3). Structural: for each resident
// profile and each step of the first week (docs/konza/world.md section 6), can the step be done
// alone, with help (a named desk, or an officer path that exists in code), or not at all?
// What a step needs comes from the routes and tools as built (or, for scenes not built yet, from
// world.md). How well the agent serves each profile is the conversational half (after 14 Oct).

import { generate } from "../residents.ts";
import { nairobiToday, type Sim } from "../harness.ts";

/** voice: a phone call to the assistant; sms: a text conversation; web: the browser app
 * (/handset and pages); upload: an /upload link; pesa: the /pesa PIN page; code: a one-time code
 * by SMS or by a code call; address: a registered address. */
type Need = "voice" | "sms" | "web" | "upload" | "pesa" | "code" | "address";

type Step = {
  scene: string;
  step: string;
  built: boolean;
  /** Ways to do it alone: any one set of needs. */
  alone: Need[][];
  /** Help that exists: a named desk (world.md) or an officer path in code. */
  help?: string;
};

const TALK: Need[][] = [["voice"], ["sms"], ["web"]];
const TALK_ID: Need[][] = [["voice", "code"], ["sms", "code"], ["web", "code"]];
/** PY-01 (K3): a payment prompt with a code by SMS or code call, told back by voice or text; or
 * the /pesa screen on a smartphone. */
const PAY: Need[][] = [["voice", "code"], ["sms", "code"], ["pesa"]];
const DELIVER: Need[][] = [["voice", "address"], ["sms", "address"], ["web", "address"]];
const DESK_PAY = "desk payment at Lango Square or the Konza Passport Desk (PY-02)";
const DESK_DOC = "paper documents at Lango Square, recorded by an officer (DK-01)";
const DESK_COLLECT = "collection at Lango Square, no address needed (DK-02)";

const STEPS: Step[] = [
  { scene: "Mon arrival", step: "what is needed", built: true, alone: TALK },
  { scene: "Mon arrival", step: "register adults", built: true, alone: TALK_ID },
  {
    scene: "Mon arrival",
    step: "tenancy or employer letter (AR-02)",
    built: true,
    alone: [], /* SIA has no upload tools yet (K3): Lango Square only */
    help: DESK_DOC,
  },
  { scene: "Mon arrival", step: "register children, consent", built: true, alone: TALK_ID },
  {
    scene: "Mon arrival",
    step: "resident cards delivered or collected",
    built: true,
    alone: DELIVER,
    help: DESK_COLLECT,
  },
  { scene: "Tue passport", step: "quote fees", built: true, alone: TALK },
  {
    scene: "Tue passport",
    step: "check renewal",
    built: true,
    alone: TALK_ID,
    help: "officer (no passport on record)",
  },
  {
    scene: "Tue passport",
    step: "apply",
    built: true,
    alone: TALK_ID,
    help: "officer (pending_officer)",
  },
  { scene: "Tue passport", step: "pay the fee", built: true, alone: PAY, help: DESK_PAY },
  {
    scene: "Tue passport",
    step: "biometrics",
    built: true,
    alone: [],
    help: "Konza Passport Desk (in person for everyone, PP-03)",
  },
  {
    scene: "Tue passport",
    step: "delivery or collection",
    built: true,
    alone: [["voice", "code", "address"], ["sms", "code", "address"], ["web", "code", "address"]],
    help: "Konza Passport Desk (collection, AD-06, DK-02)",
  },
  { scene: "Wed health", step: "check cover", built: true, alone: TALK_ID },
  { scene: "Wed health", step: "pay contribution", built: true, alone: PAY, help: DESK_PAY },
  {
    scene: "Wed health",
    step: "add children with documents (SH-03)",
    built: true,
    alone: [], /* SIA has no upload tools yet (K3): Lango Square only */
    help: DESK_DOC,
  },
  { scene: "Thu business", step: "check a name", built: true, alone: TALK },
  {
    scene: "Thu business",
    step: "register and pay",
    built: true,
    alone: PAY,
    help: `${DESK_PAY}; officer (name refusals, BZ-05)`,
  },
  { scene: "Thu business", step: "trading permit", built: true, alone: PAY, help: DESK_PAY },
  {
    scene: "Thu business",
    step: "certificate delivered or collected",
    built: true,
    alone: DELIVER,
    help: DESK_COLLECT,
  },
  { scene: "Fri school", step: "schools by catchment", built: true, alone: TALK },
  {
    scene: "Fri school",
    step: "consent and apply for a child",
    built: true,
    alone: TALK_ID,
    help: "officer (full or out of zone, ED-04)",
  },
  {
    scene: "Fri school",
    step: "birth certificate and immunisation card (ED-02)",
    built: true,
    alone: [], /* SIA has no upload tools yet (K3): Lango Square only */
    help: DESK_DOC,
  },
];

/** What each profile can use. Low literacy: voice-led channels only; poor signal: text only. */
const PROFILES: Record<string, Need[]> = {
  smartphone: ["voice", "sms", "web", "upload", "pesa", "code", "address"],
  feature_phone: ["voice", "sms", "code", "address"],
  sms_only: ["sms", "code", "address"],
  low_literacy: ["voice", "web", "upload", "code", "address"],
  poor_signal: ["sms", "code", "address"],
  no_address: ["voice", "sms", "web", "upload", "pesa", "code"],
};

export function exclusion(_sim: Sim | null, seed: number) {
  const pop = generate(seed, nairobiToday());
  const adults = pop.residents.filter((r) => r.adult);
  const affected: Record<string, number> = {
    smartphone: adults.filter((r) => r.profile.device === "smartphone").length,
    feature_phone: adults.filter((r) => r.profile.device === "feature_phone").length,
    sms_only:
      adults.filter((r) => r.profile.device === "feature_phone" && r.profile.signal === "poor")
        .length,
    low_literacy: adults.filter((r) => r.profile.literacy === "low").length,
    poor_signal: adults.filter((r) => r.profile.signal === "poor").length,
    no_address: adults.filter((r) => !r.profile.has_address).length,
  };

  const profiles: Record<string, unknown> = {};
  let deadEnds = 0;
  let deadEndsBuilt = 0;
  for (const [name, has] of Object.entries(PROFILES)) {
    const rows = STEPS.map((s) => {
      const alone = s.alone.some((need) => need.every((n) => has.includes(n)));
      return { ...s, result: alone ? "alone" : s.help ? "help" : "dead_end" };
    });
    const count = (r: string, built?: boolean) =>
      rows.filter((x) => x.result === r && (built === undefined || x.built === built)).length;
    deadEnds += count("dead_end");
    deadEndsBuilt += count("dead_end", true);
    profiles[name] = {
      adults_in_population: affected[name],
      steps: rows.length,
      alone: count("alone"),
      with_help: count("help"),
      dead_ends: count("dead_end"),
      alone_share_built: `${count("alone", true)}/${rows.filter((x) => x.built).length}`,
      dead_end_steps: rows.filter((x) => x.result === "dead_end").map((x) =>
        `${x.scene}: ${x.step}${x.built ? "" : " (not built)"}`
      ),
    };
  }
  return {
    family: "exclusion",
    seed,
    targets:
      "0 dead ends (a desk or an officer path counts as a route); shares of steps done alone are a baseline",
    pass: deadEnds === 0,
    dead_ends: deadEnds,
    dead_ends_in_built_steps: deadEndsBuilt,
    profiles,
  };
}
