// K5 (MED-304): word error rate of a transcript against the phrase that was spoken. Pure; used by
// `deno task wer` on Mahs's Swahili script call.

/** Lower case, punctuation off, numbers kept, one space between words. */
export const words = (s: string) =>
  s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** Word-level edit distance (substitutions, deletions, insertions) and the reference length. */
export function editDistance(ref: string, hyp: string): { errors: number; words: number } {
  const r = words(ref);
  const h = words(hyp);
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return { errors: prev[h.length], words: r.length };
}

/** Word error rate over many pairs: total errors over total reference words (not a mean of rates). */
export function wer(pairs: { ref: string; hyp: string }[]): number {
  let errors = 0, n = 0;
  for (const p of pairs) {
    const d = editDistance(p.ref, p.hyp);
    errors += d.errors;
    n += d.words;
  }
  return n ? errors / n : 0;
}

/** Categories where one wrong word changes what the resident pays, when, or where. */
export const CRITICAL = new Set(["amount", "date", "resident_number", "address", "readback"]);
