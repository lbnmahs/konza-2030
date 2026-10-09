// One copy of the transcript redaction rules (K6, MED-307 and MED-310), used wherever a transcript
// leaves ElevenLabs: `deno task calls show`, the Audit Office's sampled checks, and the curated
// demo. Removes one-time codes, references, transaction codes, resident numbers and phone digits;
// keeps what a charter check needs (what was said, which tools ran, rule outputs: amounts, dates,
// read-backs, reasons). `leftovers` finds anything that still looks like a code, and callers refuse
// to send or publish a transcript that has any.

type Turn = {
  role?: string;
  message?: string | null;
  time_in_call_secs?: number;
  tool_calls?: { tool_name?: string; params_as_json?: string }[];
  tool_results?: { tool_name?: string; result_value?: string; is_error?: boolean }[];
};

export type RedactedTurn = {
  i: number;
  at: number;
  role: "agent" | "user";
  text?: string;
  calls?: { tool: string; args: unknown }[];
  results?: { tool: string; value: unknown; error?: boolean }[];
};

const DIGIT_WORDS =
  "zero|oh|one|two|three|four|five|six|seven|eight|nine|sifuri|moja|mbili|tatu|nne|tano|sita|saba|nane|tisa";
const NUMBER_WORDS = new RegExp(`\\b(${DIGIT_WORDS})\\b`, "gi");
/** Four or more digit words in a row: a code, reference or phone number read aloud. */
const SPOKEN_RUN = new RegExp(`\\b(${DIGIT_WORDS})([\\s,.-]+(${DIGIT_WORDS})){3,}\\b`, "gi");

/** A turn inside a code window with four or more digits or digit words is a code read aloud. */
export const looksLikeCode = (text: string) =>
  (text.match(/\d/g)?.length ?? 0) + (text.match(NUMBER_WORDS)?.length ?? 0) >= 4;

/** References and transaction codes (SPS-61D7396E, KZP055A010, QK20410039, QK-2041-0039): a short
 * prefix, then at least 6 characters with a digit. Rule ids such as PP-02 are too short to match. */
const REF = /\b[A-Z]{2,4}-?(?=[0-9A-Z-]{6,})(?=[0-9A-Z-]*\d)[0-9A-Z]+(?:-[0-9A-Z]+)*\b/g;
/** Six or more digits, with or without spaces or dashes (codes, phone numbers); never a date or
 * the fraction of a decimal (latency metadata). */
const DIGITS = /(?<![\d.-])\d(?:[ -]?\d){5,}(?![\d-])/g;
/** Dates, months and timestamps (2026-10-12, 2026-10, 2026-10-12T09:00:00Z). */
const ISO_DATE = /\b\d{4}-\d{2}(?:-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?)?\b/g;

/** Ids: UUIDs, and any desk evidence id however much of it survives ("desk:6b5f...e1"). */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const DESK_ID = /\bdesk:\S+/gi;
/** Six single digits read with commas ("4, 8, 2, 9, 1, 3"). */
const COMMA_DIGITS = /\b\d(?:,\s*\d){5,}\b/g;
/** Day, month and year written with slashes or dots (12/04/1987, 12.4.1987). */
const DMY = /\b\d{1,2}[/.]\d{1,2}[/.](?:19|20)\d{2}\b/g;

/** Runs fn over text with ISO dates and times set aside, so they are never taken for codes. */
function sparingDates(text: string, fn: (t: string) => string): string {
  const dates: string[] = [];
  const out = fn(text.replace(ISO_DATE, (d) => `@@DATE${dates.push(d) - 1}@@`));
  return out.replace(/@@DATE(\d+)@@/g, (_, n) => dates[Number(n)]);
}

/** A date of birth said aloud ("date of birth ni 12 April 1987", "kuzaliwa 1987-04-12"). */
const BIRTH =
  /(date of birth|born on|born|birthday|kuzaliwa)([^.?!]{0,30}?)(\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+,?\s+(19|20)\d{2}|[A-Za-z]+\s+\d{1,2}(st|nd|rd|th)?,?\s+(19|20)\d{2}|\d{1,2}[/.]\d{1,2}[/.](19|20)\d{2}|(19|20)\d{2}-\d{2}-\d{2})/gi;

/** Free text: references, resident numbers, long digit runs, phone endings, spoken codes, dates
 * of birth. */
export function redactText(text: string): string {
  return sparingDates(
    text.replace(BIRTH, "$1$2[date of birth]").replace(DESK_ID, "desk:[id]").replace(UUID, "[id]")
      .replace(DMY, "[date]"),
    (t) =>
      t
        // A resident or tax number, even half said aloud ("QK-T-mbili-mbili...").
        .replace(/\bQK(?:-[A-Z])?[-\s]?[\w-]*/g, "[ref]")
        .replace(REF, "[ref]")
        .replace(DIGITS, "[number]")
        .replace(COMMA_DIGITS, "[number]")
        // "ending in 878", "inayoishia na nane saba nane".
        .replace(
          new RegExp(
            `\\b(ending in|ends in|inayoishia na|inaishia na)\\s+((\\d[\\s,]*){1,4}|((${DIGIT_WORDS})[\\s,]*){1,4})`,
            "gi",
          ),
          "$1 [digits]",
        )
        .replace(SPOKEN_RUN, "[number]")
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
  );
}

/** Keys that identify a person, a record or a secret: dropped from tool arguments and results.
 * Everything else is kept (rule outputs, decisions, read-backs, statuses) with its text redacted,
 * so a check can see what the backend actually said. Was an allowlist until 8 Oct, which hid
 * results such as create_case's {case_created: true} from the sampled checks. */
const DROP = new Set([
  "id",
  "ref",
  "case_id",
  "application_id",
  "decision_id",
  "payment_id",
  "verification_id",
  "confirmation_id",
  "consent_id",
  "item_ref",
  "code",
  "code_hash",
  "txn_code",
  "tax_number",
  "references",
  "phone",
  "phone_last3",
  "first_name",
  "full_name",
  "name",
  "id_number",
  "resident_number",
  "date_of_birth",
  "dob",
  "address",
  "written",
  "email",
  "grantor",
  "subject",
  "delegate",
  "subject_citizen_id",
  "applicant_citizen_id",
  "citizen_id",
  "conversation_id",
  "evidence",
  "evidence_id",
  "partner_id",
  "permit_no",
  "payment_ref",
  "location_description",
  "lost_on",
]);
/** Also any key that names, dates a birth or identifies a record (dependant_name, child_dob). */
const DROP_SUFFIX = /(_name|_dob|_id|_number|_ref)$/;

function keep(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[...]";
  if (typeof v === "string") {
    // JSON inside a string (fields_json, inputs_json) is redacted like any other object.
    const t = v.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      const inner = parse(t);
      if (typeof inner === "object" && inner !== null) return keep(inner, depth + 1);
    }
    return redactText(v);
  }
  if (Array.isArray(v)) return v.map((x) => keep(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (!DROP.has(k) && !DROP_SUFFIX.test(k)) out[k] = keep(x, depth + 1);
    }
    return out;
  }
  return v;
}

const parse = (s: string | undefined) => {
  try {
    return JSON.parse(s ?? "");
  } catch {
    return s ?? "";
  }
};

/** A whole transcript, redacted. Tool arguments named "code" are never kept (not in KEEP). */
export function redactTranscript(transcript: Turn[]): RedactedTurn[] {
  let codeWindow = false;
  return (transcript ?? []).map((t, i) => {
    const out: RedactedTurn = {
      i,
      at: Math.round(t.time_in_call_secs ?? 0),
      role: t.role === "agent" ? "agent" : "user",
    };
    if (t.message) {
      out.text = codeWindow && looksLikeCode(t.message)
        ? "[code read aloud, redacted]"
        : redactText(t.message);
    }
    if (t.tool_calls?.length) {
      out.calls = t.tool_calls.map((c) => {
        if (["identity_start_otp", "payment_request"].includes(String(c.tool_name))) {
          codeWindow = true;
        }
        return { tool: String(c.tool_name), args: keep(parse(c.params_as_json)) };
      });
    }
    if (t.tool_results?.length) {
      out.results = t.tool_results.map((r) => {
        const value = String(r.result_value ?? "");
        if (
          (r.tool_name === "identity_check_otp" && value.includes('"verified":true')) ||
          (r.tool_name === "payment_confirm" &&
            /"status":"(approved|declined|expired)"/.test(value))
        ) codeWindow = false;
        return {
          tool: String(r.tool_name),
          value: keep(parse(value)),
          ...(r.is_error ? { error: true } : {}),
        };
      });
    }
    return out;
  });
}

/** Anything left that still looks like a code, reference or phone number: callers refuse to send
 * or publish a transcript while this is not empty. Years (4 digits) and amounts are allowed. */
export function leftovers(turns: RedactedTurn[]): string[] {
  const text = JSON.stringify(turns).replace(ISO_DATE, "");
  return [
    ...(text.match(UUID) ?? []),
    ...(text.match(/desk:(?!\[id\])\S+/gi) ?? []),
    ...(text.match(DMY) ?? []),
    ...(text.match(COMMA_DIGITS) ?? []),
    ...(text.match(DIGITS) ?? []),
    ...(text.match(REF) ?? []),
    ...(text.match(SPOKEN_RUN) ?? []),
  ];
}
