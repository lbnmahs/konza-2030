// K5 (MED-303): English and Swahili words SIA listens for. One source for the agent's ASR keywords
// (push-agents) and for the confirm-back check (C8, MED-302), which needs to know a yes from a no.
// Draft by Claude, 6 Oct 2026, for Mahs to confirm. Sheng is out of K5 (Mahs, 6 Oct).

/** A clear yes after a read-back. Matched as whole words or phrases, case-insensitive. */
export const YES = {
  en: [
    "yes",
    "yeah",
    "yep",
    "correct",
    "that's right",
    "go ahead",
    "okay",
    "ok",
    "sure",
    "confirm",
  ],
  // "eeh" and "ee" are a common Kenyan yes (Mahs, 8 Oct); "eh" alone is also a hesitation, so it
  // is left out.
  sw: [
    "ndio",
    "ndiyo",
    "naam",
    "sawa",
    "sawasawa",
    "endelea",
    "nakubali",
    "kweli",
    "haya",
    "eeh",
    "ee",
  ],
};

/** Anything that undoes a yes in the same turn ("yes, but wait"). */
export const NO = {
  // "not", "wrong", "sio" and "siyo" turn a yes word back into a no ("that's not correct", "sio
  // sawa"); a miss reported on "yes, not a problem" is the safe side of that trade.
  en: [
    "no",
    "nope",
    "nah",
    "not",
    "isn't",
    "wrong",
    "incorrect",
    "wait",
    "stop",
    "cancel",
    "don't",
    "hold on",
  ],
  // "la" (no) is left out: it is also the common particle "of" ("ombi la malipo").
  sw: [
    "hapana",
    "subiri",
    "ngoja",
    "acha",
    "sitaki",
    "bado",
    "si sawa",
    "sio",
    "siyo",
    "usiendelee",
  ],
};

/** Words the speech recogniser should expect (merged into agent.json asr_keywords). */
export const ASR_KEYWORDS = [
  "biometriki",
  "pasipoti",
  "kitambulisho",
  "bima",
  "mchango",
  "mtegemezi",
  "shule",
  "ridhaa",
  "miadi",
  "mapitio",
  "kibali",
  "shilingi",
  "namba ya mkazi",
  "Savanahlands",
  "Aminia",
];

const words = (list: string[]) =>
  new RegExp(
    `(^|[^\\p{L}'])(${list.map((w) => w.replace(/'/g, "'?")).join("|")})(?=$|[^\\p{L}'])`,
    "iu",
  );
const YES_RE = words([...YES.en, ...YES.sw]);
const NO_RE = words([...NO.en, ...NO.sw]);

/** A caller turn is a yes when it holds a yes word, no word that takes it back, and is not a
 * question ("is it okay?"). */
export const isYes = (turn: string) =>
  YES_RE.test(turn) && !NO_RE.test(turn) && !/\?\s*$/.test(turn);
