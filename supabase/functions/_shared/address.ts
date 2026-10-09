// Address matching for spoken input. Phone speech recognition often mishears one postcode
// character (N as L, F as S), and callers say "flat 14" or "number 14" for "14".

export const normPostcode = (s: string) => s.replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** "flat number 14" -> "14", "No. 3a" -> "3A", "Rose Cottage" -> "ROSECOTTAGE". */
export function normHouse(s: string): string {
  const num = s.match(/\d+\s*[a-z]?\b/i);
  return num ? num[0].replace(/\s+/g, "").toUpperCase() : s.replace(/[^A-Za-z]/g, "").toUpperCase();
}

function oneCharApart(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff === 1;
}

export type PropertyRow = { postcode: string; house: string };

/** Exact match first; otherwise a single property with the same house and a postcode one
 * character away, which the agent must read back and confirm. */
export function matchProperty<T extends PropertyRow>(
  rows: T[],
  postcode: string,
  house: string,
): { property: T; exact: boolean } | null {
  const pc = normPostcode(postcode);
  const h = normHouse(house);
  const exact = rows.find((r) => normPostcode(r.postcode) === pc && normHouse(r.house) === h);
  if (exact) return { property: exact, exact: true };
  const near = rows.filter((r) =>
    normHouse(r.house) === h && oneCharApart(normPostcode(r.postcode), pc)
  );
  return near.length === 1 ? { property: near[0], exact: false } : null;
}
