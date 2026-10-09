import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { align, CRITICAL, editDistance, wer, words } from "./wer.ts";

Deno.test("K5 (MED-304): word error rate", () => {
  assertEquals(words("Ni bure, ndio?"), ["ni", "bure", "ndio"]);
  assertEquals(editDistance("shilingi elfu saba", "shilingi elfu saba").errors, 0);
  // One substitution (mia sita for mia tano) in 8 words.
  assertEquals(
    editDistance(
      "shilingi elfu saba mia tano na hamsini leo",
      "shilingi elfu saba mia sita na hamsini leo",
    ),
    { errors: 1, words: 8 },
  );
  // A deletion and an insertion.
  assertEquals(editDistance("a b c", "a c d").errors, 2);
  assertAlmostEquals(wer([{ ref: "a b", hyp: "a b" }, { ref: "c d e f", hyp: "c x e" }]), 2 / 6);
  assertEquals(wer([]), 0);
});

Deno.test("K5 (MED-304): the script-call phrases are the script, in order, and well formed", async () => {
  const { SCRIPT } = await import("../wer.ts");
  const { phrases } = JSON.parse(
    await Deno.readTextFile(new URL("./phrases.json", import.meta.url)),
  );
  assertEquals(phrases.map((p: any) => p.id), SCRIPT);
  for (const p of phrases) {
    assert(p.sw?.length > 10, p.id);
    assert(!("sheng" in p), `${p.id}: Sheng is out of K5`);
    // Fictional data only (labelling.md 6): QK- numbers, the Konza address format.
    assert(!/\b\d{8}\b|\+?254|07\d{8}/.test(p.en + p.sw), p.id);
  }
  assert(phrases.some((p: any) => CRITICAL.has(p.category)));
});

Deno.test("MED-304: phrases align to the best turns in order; chatter in between is skipped", () => {
  const refs = ["shilingi elfu saba", "tarehe kumi na mbili", "namba ya mkazi"];
  const turns = ["habari", "shilingi elfu saba", "ndio", "tarehe kumi na tatu", "namba ya mkazi"];
  assertEquals(align(refs, turns), ["shilingi elfu saba", "tarehe kumi na tatu", "namba ya mkazi"]);
  // A phrase never said is "" and costs all its words; order is kept.
  assertEquals(align(refs, ["shilingi elfu saba", "namba ya mkazi"]), [
    "shilingi elfu saba",
    "",
    "namba ya mkazi",
  ]);
  assertEquals(align(refs, []), ["", "", ""]);
});
