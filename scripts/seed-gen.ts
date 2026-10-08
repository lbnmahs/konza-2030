// deno task seed:gen [--dry-run] [--offline] [--count N]
// Mock data generator (P15 D11): extra fictional citizens per country, from a schema, with the
// operator's own Claude API key (ANTHROPIC_API_KEY in .env). Output goes to
// scripts/seed/fixtures/generated.json (committed) and is loaded by scripts/seed/common.ts.
//
// - --dry-run counts input tokens with the API and prints a cost estimate; nothing is generated.
// - --offline (or no key) uses the deterministic generator below instead of Claude.
// - The request is cached by content hash: an unchanged schema, prompt, model and count reuse
//   the fixture without calling the API.
// - Validators reject anything that is not clearly fictional: ID formats per country, dates of
//   birth in range, no phone numbers, emails or postcodes, no real organisation names, no
//   duplicates of the hand-written seed.

import Anthropic from "npm:@anthropic-ai/sdk@^0.70.0";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("scripts/seed/fixtures/generated.json", ROOT);
const MODEL = "claude-opus-5-5";
const PRICE_IN = 4 / 1e6; // $ per input token (Claude Opus 5.5)
const PRICE_OUT = 20 / 1e6; // $ per output token

const args = new Set(Deno.args);
const countArg = Deno.args[Deno.args.indexOf("--count") + 1];
const COUNT = Deno.args.includes("--count") ? Math.max(1, Math.min(10, Number(countArg))) : 4;

const COUNTRIES = {
  KE: {
    authority: "usajili_njema",
    lang: "sw",
    id: "^[23]\\d{7}$",
    idHint: "8 digits starting 2 or 3",
  },
} as const;
type CountryKey = keyof typeof COUNTRIES;

// Real bodies the fiction must never name (spec: fictional authorities only).
const REAL_ORGS =
  /\b(NHS|HMRC|DVLA|GOV\.UK|Home Office|Huduma|eCitizen|KRA|NTSA|SHA|NHIF|TAMM|ICP|GDRFA|Emirates ID Authority|Auswärtiges Amt|Bundesamt|TLScontact|VFS|Fintiba|Expatrio|Mediclinic|Al Noor)\b/i;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["people"],
  properties: {
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["full_name", "dob", "id_number", "situation"],
        properties: {
          full_name: {
            type: "string",
            description: "A fictional, ordinary name typical for the country",
          },
          dob: { type: "string", description: "YYYY-MM-DD, born 1950 to 2006" },
          id_number: { type: "string", description: "Fictional ID number in the given format" },
          situation: {
            type: "string",
            description:
              "One short sentence on why this person might call the services line (no organisation names)",
          },
        },
      },
    },
  },
};

type Person = { full_name: string; dob: string; id_number: string; situation: string };

function prompt(country: CountryKey) {
  const c = COUNTRIES[country];
  return `Generate ${COUNT} fictional people for a public services demo set in ${
    { KE: "Nairobi, Kenya" }[country]
  }. Everyone must be clearly fictional: ordinary names, no public figures. ID number format: ${c.idHint}. Do not reuse any of these names: ${
    handNames.join(", ")
  }. Do not include phone numbers, emails, postcodes, street addresses or the names of any real organisation.`;
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}

function validate(country: CountryKey, people: Person[], seen: Set<string>): string[] {
  const errors: string[] = [];
  const re = new RegExp(COUNTRIES[country].id);
  for (const p of people) {
    const all = `${p.full_name} ${p.situation}`;
    if (!re.test(p.id_number)) errors.push(`${country}: bad ID format ${p.id_number}`);
    if (!/^(19[5-9]\d|200[0-6])-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(p.dob)) {
      errors.push(`${country}: bad date of birth ${p.dob}`);
    }
    if (/\+?\d[\d\s-]{8,}\d/.test(p.situation) || /@/.test(all)) {
      errors.push(`${country}: contact details in ${p.full_name}`);
    }
    if (/\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/.test(p.situation)) {
      errors.push(`${country}: postcode in ${p.full_name}`);
    }
    if (REAL_ORGS.test(all)) errors.push(`${country}: real organisation named for ${p.full_name}`);
    if (seen.has(p.id_number)) errors.push(`${country}: duplicate ID ${p.id_number}`);
    seen.add(p.id_number);
    if (seenNames.has(p.full_name.toLowerCase())) {
      errors.push(`${country}: duplicate name ${p.full_name}`);
    }
    seenNames.add(p.full_name.toLowerCase());
  }
  return errors;
}

/** Deterministic fallback: same output for the same country and count, no API. */
function offline(country: CountryKey): Person[] {
  const names: Record<CountryKey, string[]> = {
    KE: [
      "Wanjiru Kamau",
      "Otieno Ouma",
      "Achieng Atieno",
      "Kiprotich Rono",
      "Muthoni Njeri",
      "Baraka Mwangi",
      "Zawadi Chebet",
      "Juma Wekesa",
      "Akinyi Odhiambo",
      "Kibet Langat",
    ],
  };
  return names[country].slice(0, COUNT).map((full_name, i) => {
    const year = 1960 + ((i * 7 + full_name.length) % 46);
    const dob = `${year}-${String((i % 12) + 1).padStart(2, "0")}-${
      String(((i * 5) % 27) + 1).padStart(2, "0")
    }`;
    const n = String(1000000 + ((i + 1) * 7919 * (full_name.charCodeAt(0) + 3)) % 9000000);
    const id_number = `${2 + (i % 2)}${n}`;
    return { full_name, dob, id_number, situation: "Calls about an everyday service." };
  });
}

const cache = await Deno.readTextFile(OUT).then(JSON.parse).catch(() => ({
  requests: {},
  people: {},
}));
const handWritten = await Deno.readTextFile(new URL("scripts/seed/ke.ts", ROOT));
const seen = new Set<string>([...handWritten.matchAll(/id_number: "([^"]+)"/g)].map((m) => m[1]));
const handNames = [...handWritten.matchAll(/full_name: "([^"]+)"/g)].map((m) => m[1]);
const seenNames = new Set<string>(handNames.map((n) => n.toLowerCase()));

const useApi = !args.has("--offline") && !!Deno.env.get("ANTHROPIC_API_KEY");
const client = useApi ? new Anthropic() : null;
let estimate = 0;
const out: Record<string, Person[]> = {};

for (const country of Object.keys(COUNTRIES) as CountryKey[]) {
  const request = {
    model: MODEL,
    max_tokens: 4000,
    output_config: {
      effort: "low" as const,
      format: { type: "json_schema" as const, schema: SCHEMA },
    },
    messages: [{ role: "user" as const, content: prompt(country) }],
  };
  const hash = await sha256(JSON.stringify({ request, mode: useApi ? "api" : "offline" }));

  if (args.has("--dry-run")) {
    if (!client) {
      console.log(`${country}: offline generator, no cost`);
      continue;
    }
    const { input_tokens } = await client.messages.countTokens({
      model: MODEL,
      messages: request.messages,
    });
    const cost = input_tokens * PRICE_IN + COUNT * 120 * PRICE_OUT; // about 120 output tokens a person
    estimate += cache.requests[country] === hash ? 0 : cost;
    console.log(
      `${country}: ${input_tokens} input tokens, about ${COUNT * 120} output tokens, $${
        cost.toFixed(4)
      }${cache.requests[country] === hash ? " (cached, $0)" : ""}`,
    );
    continue;
  }

  if (
    cache.requests[country] === hash && cache.people[country] &&
    !validate(country, cache.people[country], seen).length
  ) {
    out[country] = cache.people[country];
    console.log(`${country}: cached (${out[country].length} people)`);
    continue;
  }

  let people: Person[];
  if (client) {
    // Claude Opus 5.5 with the default server-side fallback, so a safety decline is retried on
    // the recommended model instead of failing the run.
    const response = await client.beta.messages.create({
      ...request,
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: "default" fallbacks may be newer than this SDK's types
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") throw new Error(`${country}: request was declined`);
    if (response.stop_reason === "max_tokens") throw new Error(`${country}: output was cut off`);
    const text = response.content.flatMap((b: any) => (b.type === "text" ? [b.text] : [])).join("");
    people = JSON.parse(text).people;
  } else {
    people = offline(country);
  }

  const errors = validate(country, people, seen);
  if (errors.length) {
    console.error(errors.join("\n"));
    Deno.exit(1);
  }
  cache.requests[country] = hash;
  cache.people[country] = people;
  out[country] = people;
  console.log(`${country}: ${people.length} people generated (${client ? "Claude" : "offline"})`);
}

if (args.has("--dry-run")) {
  console.log(`Estimated total: $${estimate.toFixed(4)} (model ${MODEL}, effort low)`);
} else {
  await Deno.mkdir(new URL("scripts/seed/fixtures/", ROOT), { recursive: true });
  await Deno.writeTextFile(OUT, JSON.stringify(cache, null, 2) + "\n");
  console.log(`Wrote scripts/seed/fixtures/generated.json`);
}

export { COUNTRIES };
