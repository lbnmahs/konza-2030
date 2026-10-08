import { assert, assertEquals } from "jsr:@std/assert@1";
import { ASR_KEYWORDS, isYes, NO, YES } from "./lexicon.ts";

Deno.test("K5 (MED-303): a clear yes in English or Swahili, and what takes it back", () => {
  for (
    const t of [
      "Yes please.",
      "Ndio, endelea.",
      "Ndiyo",
      "sawa",
      "Naam",
      "That's right",
      "ok",
      "Eeh, endelea",
      "Ee",
    ]
  ) {
    assert(isYes(t), t);
  }
  for (
    const t of [
      "Hapana, subiri kwanza",
      "Yes, but wait",
      "Is it okay?",
      "Sawa?",
      "Bado",
      "Eh, tofauti",
      "Eeh, hapana",
      "That's not correct",
      "No that's wrong",
      "not okay",
      "Sio sawa",
      "Siyo kweli",
      "Isn't that too much? Okay",
      "Notably expensive",
      "ombi la malipo",
      "",
    ]
  ) assert(!isYes(t), t);
});

Deno.test("K5 (MED-303): lexicon shape: no word is both a yes and a no; keywords are unique", () => {
  const yes = new Set([...YES.en, ...YES.sw].map((w) => w.toLowerCase()));
  assertEquals([...NO.en, ...NO.sw].filter((w) => yes.has(w.toLowerCase())), []);
  assertEquals(new Set(ASR_KEYWORDS).size, ASR_KEYWORDS.length);
  assert(ASR_KEYWORDS.every((k) => k.trim() === k && k.length > 1));
  // Sheng is out of K5 (Mahs, 6 Oct): no Sheng-only words.
  assert(![...YES.sw, ...NO.sw].some((w) => ["poa", "fiti", "sawa sawa"].includes(w)));
});
