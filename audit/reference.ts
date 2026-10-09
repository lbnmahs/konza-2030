// The Mirror Vale Audit Office's own copy of the published rules (K4, MED-272), transcribed from
// docs/konza/world.md section 4 and docs/konza/charter.md. It never imports the core's rules
// modules: a recomputation that reused them would agree with a wrong rule.

export const REFERENCE = {
  /** PP-01 */
  passportFeesKes: { 34: 7550, 50: 9550, 66: 12050 } as Record<number, number>,
  /** PP-02: renewal opens within 12 months of expiry, after expiry, or when full or damaged. */
  renewalOpensMonths: 12,
  /** ED-06 */
  primaryAges: [5, 13] as const,
  /** AD-03, AD-04 */
  deliveryFeeKes: 200,
  deliveryWithinDays: 5,
  /** SH-02 */
  shMinContributionKes: 300,
  /** BZ-01, BZ-02, BZ-04 */
  businessFeesKes: { business_name: 950, company: 10500 } as Record<string, number>,
  tradingPermitKes: 5000,
  /** BZ-05: names suggesting a government body go to an officer. */
  reservedName: /\b(konza|government|authority|technopolis)\b/i,
  /** DK-02: collection at a desk is free (AD-04). */
  collectionFeeKes: 0,
  /** PY-01: a phone-code prompt lasts 5 minutes and allows 3 tries. */
  phoneCodeMinutes: 5,
  phoneCodeTries: 3,
  /** PY-02, DK-01, DK-02: the desks, and which deliverables each hands over. */
  desks: {
    lango_square: { address: "Z1 B01 P001 U01", collects: ["resident_card", "certificate"] },
    konza_passport_desk: { collects: ["passport"] },
  } as Record<string, { address?: string; collects: string[] }>,
  /** Charter 3.1: 12 months or the 18th birthday, whichever is first. */
  consentDefaultDays: 365,
  /** Charter 1: the two-step window. */
  confirmMinGapMs: 4_000,
  confirmTtlMs: 180_000,
  /** Scope a delegate needs, by service; a service missing here is for the resident only. */
  consentScopes: {
    "siln/primary_place": "school_application",
    "srr/child_registration": "registration",
    "sca/dependant": "health_cover",
  } as Record<string, string>,
  ruleIds: new Set([
    "AR-01",
    "AR-02",
    "AR-03",
    "AR-04",
    "PP-01",
    "PP-02",
    "PP-03",
    "PP-04",
    "PP-05",
    "ED-01",
    "ED-02",
    "ED-03",
    "ED-04",
    "ED-05",
    "ED-06",
    "AD-01",
    "AD-02",
    "AD-03",
    "AD-04",
    "AD-05",
    "AD-06",
    "RV-01",
    "RV-02",
    "RV-03",
    "SH-01",
    "SH-02",
    "SH-03",
    "SH-04",
    "BZ-01",
    "BZ-02",
    "BZ-03",
    "BZ-04",
    "BZ-05",
    "PY-01",
    "PY-02",
    "DK-01",
    "DK-02",
  ]),
};

/** Konza runs on Nairobi time (UTC+3, no daylight saving). */
export const nairobiDay = (ts: string) =>
  new Date(Date.parse(ts) + 3 * 3_600_000).toISOString().slice(0, 10);

export function plusMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function ageOn(dob: string, day: string): number {
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = day.split("-").map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}
