// What a public receipt link may show (K6, MED-311). The link has no sign-in, only a random id, so
// it shows the decision, its reason and an allowlist of the inputs per agency (never ids, tax
// numbers or school ids), and it expires 60 days after the decision (the review window is 30).

export const RECEIPT_DAYS = 60;

/** Inputs a resident may see on their receipt, per agency, with the label shown. */
export const SHOWN: Record<string, Record<string, string>> = {
  sps: {
    has_passport: "has a passport",
    expires: "passport expires",
    pages: "pages",
    fee_kes: "fee (KES)",
  },
  srr: {
    document: "document",
    via: "presented",
    document_check: "document check",
  },
  sca: {
    month: "month",
    contribution_kes: "contribution (KES)",
    document: "document",
    via: "presented",
    cover_from: "cover from",
    document_check: "document check",
  },
  sco: { name_check: "name check", fee_kes: "fee (KES)" },
  siln: { zone: "zone" },
};

/** The inputs to show, in allowlist order, without empty values. */
export function shownInputs(
  agency: string,
  inputs: Record<string, unknown> | null,
) {
  const allowed = SHOWN[agency] ?? {};
  return Object.entries(allowed)
    .filter(([k]) => inputs?.[k] !== null && inputs?.[k] !== undefined)
    .map(([k, label]) => [label, String(inputs![k])] as const);
}

/** True once the receipt is more than RECEIPT_DAYS old. */
export const expired = (decidedAt: string, now = new Date()) =>
  now.getTime() - new Date(decidedAt).getTime() > RECEIPT_DAYS * 86_400_000;
