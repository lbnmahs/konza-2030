// Per-partner field filtering. The LLM names the fields it wants to share; only fields on the
// partner's allowed list leave the system, with values taken from our records (never from the
// LLM). Everything else is stripped and logged.

export function filterFields(
  requested: string[],
  allowed: string[],
  available: Record<string, string>,
) {
  const wanted = [...new Set(requested.map((f) => f.trim()).filter(Boolean))];
  const sent: Record<string, string> = {};
  const stripped: string[] = [];
  const unavailable: string[] = [];
  for (const f of wanted) {
    if (!allowed.includes(f)) stripped.push(f);
    else if (available[f] === undefined || available[f] === "") unavailable.push(f);
    else sent[f] = available[f];
  }
  return { sent, stripped, unavailable };
}

/** "+447700900123" -> "••• 123": partners and their inbox page never see a full number. */
export const maskPhone = (p: string) => `••• ${p.replace(/\D/g, "").slice(-3)}`;
