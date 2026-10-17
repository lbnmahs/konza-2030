// Tier 1 of SIA's transparency record (K6, MED-308): the short public tier, shown at /transparency
// and copied word for word in docs/konza/transparency.md (tests/demo_test.ts keeps them equal).
// Tier 2, the detailed tier, is in that file only.

export const TIER1: { heading: string; text: string }[] = [
  {
    heading: "What it is",
    text:
      "Savannah (SIA, Savanah Information and Access) is an AI assistant for the residents of Konza, by phone and, in a test app, with a screen. In English or Swahili it answers questions about public services, and with the resident's yes it prepares and submits requests: a passport renewal, an address registration, health cover, a small business, a school place. It can book appointments and take a fee: a code sent to the phone, or a simulated card or mobile money payment on the screen. No real money moves.",
  },
  {
    heading: "Who is accountable",
    text:
      "Savanah Information and Access runs the assistant; each agency owns its own rules and decisions. The Aminia Review Panel hears reviews. The Mirror Vale Audit Office checks the system and is separate from it. An independent open-source project builds and runs it; it is not affiliated with any government body.",
  },
  {
    heading: "What it never decides",
    text:
      "Savannah never approves or refuses anything. A published rule or a human officer decides, and anything adverse (a refusal, a smaller offer) is always an officer's decision. Fees, dates and eligibility come from the rules, never from the AI.",
  },
  {
    heading: "How it acts for you",
    text:
      "It reads back what will happen, with the amounts and dates from the rules, and waits for a clear yes before anything is paid, submitted or booked. Your identity is checked with a one-time code first. It acts for a child only with a parent's recorded consent. It says it is an AI at the start of every call; in the app the screen says so.",
  },
  {
    heading: "Your data",
    text:
      "No call audio is kept. Transcripts are kept for 30 days by the voice platform; the /demo page shows a few test calls with private values removed, and a sample of calls, likewise redacted, is graded by an AI model for the Audit Office. Codes and the demo mobile money PIN are stored only as hashes, except that the panel's test handset keeps the texts it shows. Texts go only to allowlisted phones and name their fictional sender.",
  },
  {
    heading: "Review",
    text:
      "Every decision comes with its reason, the rule it used, and how to ask for review: within 30 days, free, answered within 10 working days by someone who did not make the decision. Ask Savannah or at Lango Square.",
  },
  {
    heading: "How it is checked",
    text:
      "After every decision the Audit Office recomputes it from its own copy of the rules. If a rule looks wrong it pauses that service's automatic decisions until an officer has looked. It also samples calls against the assistant's charter, and the whole system is tested with 500 simulated residents, outages and manipulation attempts.",
  },
  {
    heading: "Limits",
    text:
      "Speech recognition can mishear, which is why amounts and dates are read back. Only English and Swahili are supported.",
  },
];
