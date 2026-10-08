// Speech layer (P13 D3): references, transaction codes and confirmation codes are texted, not
// read aloud. For country agents every tool result that carries one gets `say`: the last four
// characters and the full value in groups of three, spelled for the call's language, plus the
// rule. The values themselves stay in the result (tools may need them), so the prompt only has
// to follow `say.rule`.

const REF_KEYS =
  /^(txn_code|verify_code|code|ref|reference|loss_ref|application_ref|booking_ref|case_ref|confirmation_code|refund_ref|permit_no)$/;

const SW_DIGITS = [
  "sifuri",
  "moja",
  "mbili",
  "tatu",
  "nne",
  "tano",
  "sita",
  "saba",
  "nane",
  "tisa",
];
const EN_DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** One character as it should be said: digits as words, letters as capitals, dashes dropped. */
function spell(ch: string, lang: string): string {
  if (/\d/.test(ch)) return (lang === "sw" ? SW_DIGITS : EN_DIGITS)[Number(ch)];
  return ch.toUpperCase();
}

/** "SIMLZNA5HT" -> "S I M, L Z N, A tano H, T" (groups of three, a pause between groups). */
export function spokenGroups(value: string, lang: string, size = 3): string {
  const clean = value.replace(/[^0-9A-Za-z]/g, "");
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += size) {
    groups.push([...clean.slice(i, i + size)].map((c) => spell(c, lang)).join(" "));
  }
  return groups.join(", ");
}

export function spokenLast4(value: string, lang: string): string {
  return spokenGroups(value.replace(/[^0-9A-Za-z]/g, "").slice(-4), lang, 4);
}

const RULE: Record<string, string> = {
  sw:
    "Usisome kumbukumbu hizi bila kuombwa. Sema kwamba zimetumwa kwa SMS. Mpigaji akiuliza, sema 'inayoishia' na last4. Akiomba yote, soma full polepole.",
  en:
    "Do not read these references unless asked. Say they are in the text message. If asked, say 'ending' and last4. If asked for all of it, read full slowly.",
};

/** Adds `say` to a tool result (and to nested objects) for every reference it carries. */
export function withSpeech(result: unknown, lang: string): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const refs: Record<string, { last4: string; full: string }> = {};
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    if (REF_KEYS.test(k) && typeof v === "string" && /[0-9A-Za-z]{4,}/.test(v)) {
      refs[k] = { last4: spokenLast4(v, lang), full: spokenGroups(v, lang) };
    }
  }
  if (!Object.keys(refs).length) return result;
  return { ...result, say: { references: refs, rule: RULE[lang] ?? RULE.en } };
}
