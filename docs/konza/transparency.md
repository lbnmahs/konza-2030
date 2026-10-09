# SIA transparency record

Independent open-source project · not affiliated with any government body

K6 (MED-308), 8 Oct 2026. Modelled on the two tiers of the UK's Algorithmic Transparency Recording Standard (a short public tier and a detailed tier); this record follows its shape only and is not endorsed by anyone. Tier 1 is published at `/transparency` from `web/lib/transparency.ts`, word for word (`tests/demo_test.ts` keeps them equal). Owner: Mahs. Review again after any change to the charter, a new service, a new processor or a new model.

## Tier 1: summary

**What it is.** Savannah (SIA, Savanah Information and Access) is an AI phone assistant for the residents of Konza. In English or Swahili it answers questions about public services, and with the resident's yes it prepares and submits requests: a passport renewal, an address registration, health cover, a small business, a school place. It can book appointments and send a payment prompt.

**Who is accountable.** Savanah Information and Access runs the assistant; each agency owns its own rules and decisions. The Aminia Review Panel hears reviews. The Mirror Vale Audit Office checks the system and is separate from it. An independent open-source project builds and runs it; it is not affiliated with any government body.

**What it never decides.** Savannah never approves or refuses anything. A published rule or a human officer decides, and anything adverse (a refusal, a smaller offer) is always an officer's decision. Fees, dates and eligibility come from the rules, never from the AI.

**How it acts for you.** It reads back what will happen, with the amounts and dates from the rules, and waits for a clear yes before anything is paid, submitted or booked. Your identity is checked with a one-time code first. It acts for a child only with a parent's recorded consent, and says at the start of every call that it is an AI.

**Your data.** No call audio is kept. Transcripts are kept for 30 days by the voice platform; the /demo page shows a few test calls with private values removed, and a sample of calls, likewise redacted, is graded by an AI model for the Audit Office. Codes are stored only as hashes. Texts go only to allowlisted phones, each with a marker.

**Review.** Every decision comes with its reason, the rule it used, and how to ask for review: within 30 days, free, answered within 10 working days by someone who did not make the decision. Ask Savannah or at Lango Square.

**How it is checked.** After every decision the Audit Office recomputes it from its own copy of the rules. If a rule looks wrong it pauses that service's automatic decisions until an officer has looked. It also samples calls against the assistant's charter, and the whole system is tested with 500 simulated residents, outages and manipulation attempts.

**Limits.** Speech recognition can mishear, which is why amounts and dates are read back. Sheng and other languages are not supported yet.

## Tier 2: detail

### 1. Scope and owner

- System: SIA, the Konza resident assistant (persona Savannah), ElevenLabs agent `KONZA`, one concierge node over service cards (`agents/konza/sia/`, `supabase/functions/_shared/hubs.ts`).
- Services: passport renewal (SPS), address and child registration (SRR), health cover and dependants (SCA), business registration and trading permit (SCO), primary school place (SILN); review (Aminia Review Panel). World and rules: `docs/konza/world.md`.
- Channels: phone (one number), browser calls (`/handset`), SMS to allowlisted phones. Languages: English and Swahili (Sheng out of scope since K5).
- Accountability: the charter (`docs/konza/charter.md`) sets three levels: acts alone, asks first, never acts. The backend enforces it; the prompt only explains it.

### 2. Models and what each does

| Part | Model | Role | Decides anything? |
|---|---|---|---|
| Conversation | `claude-sonnet-5` through ElevenLabs | Understands the caller, chooses tools, speaks the tools' results | No |
| Voice | ElevenLabs `eleven_v4_turbo`, voice Halima (a generated library voice, not a clone of a person) | Speech | No |
| Speech recognition | ElevenLabs agent ASR, with Swahili keywords | Hears the caller | No |
| Rules | none (code in `_shared/rules/` and the agencies) | Fees, dates, eligibility, grants under published rules | Yes, only grants under a published rule |
| Officer | a person (officer credential) | Refusals, offers, reviews, desk payments and documents | Yes |
| Audit Office, deterministic | none (`audit/checks.ts`) | Recomputes decisions; opens holds | No; it can pause automatic grants |
| Audit Office, sampled | `claude-opus-5-5` through Message Batches | Grades redacted calls against six charter lines (C9) | No; reports only |

### 3. Data and processors

| Store or processor | What it sees | Kept |
|---|---|---|
| ElevenLabs (agent, voice, ASR) | the call; transcripts | no audio (`record_voice: false`); transcripts 30 days |
| Supabase (London) | residents (synthetic seed), applications, decisions, consents, payments, audit log, findings | data reset before each test session; audit log, holds and findings append-only |
| Twilio | SMS to allowlisted phones (a marker in every text) | Twilio logs |
| Vercel | the panel (signed-in) and public pages; public pages read no audit table | none beyond logs |
| Resend | calendar email to allowlisted addresses only | Resend logs |
| Anthropic | redacted transcripts for sampled checks (K6) | not used for training by default; only counts are kept in the repo |

Personal data minimised: children are named by first name only; one-time and payment codes are stored as hashes; receipt links show an allowlist of inputs and expire after 60 days; the Audit Office's role reads only the columns its checks need (no names, no code hashes).

### 4. Human oversight

- Adverse outcomes are only ever an officer's (database check: `decided_by` is a rule or an officer; adverse only by an officer).
- The circuit breaker: a hold finding (C2, C5, C6) pauses rule grants of that service; they wait for an officer until an officer clears the hold. Grants already made are listed for an officer, never reversed automatically.
- Every caller can ask for a case for an officer, and every decision carries the review route (RV-01 to RV-03).
- The Audit Office has its own database role (`mirror_vale`, K6): it reads logs and writes only findings, its own holds and its own audit events. SIA's backend cannot open a hold or write a finding.

### 5. Checks

| Check | What it looks at | On a miss |
|---|---|---|
| C1 | every decision has a reason, rule ids and a review route | report |
| C2 | no adverse outcome by rule | hold |
| C3 | every asks-first commit follows a prepare on the same session and arguments, at least 4 s later | report |
| C4 | every action for someone else had a valid, in-scope consent at that moment | report |
| C5 | amounts and dates equal the Audit Office's own recomputation | hold |
| C6 | grant rate per rule stays in its band (needs history) | hold |
| C7 | every application, decision and delivery has its audit event | report |
| C8 | each asks-first commit followed a spoken read-back of its amounts and dates and a clear yes (from the post-call transcript; no text kept) | report |
| C9 | sampled calls against six charter lines (disclosure, facts from tools, read-back and yes, no prediction, human route, never a person) | report |

### 6. Evidence

- Suites on the local stack (8 Oct, K6): `deno task test` 94, `test:local` 51, `contract` 2.
- Simulation, 500 synthetic residents, seed 1 (`docs/konza/sim/`): outages 100% answered or routed with no partial writes and no false "done"; delegation 12 of 12 correct and audited; manipulation 100% stored as data or refused; exclusion 0 dead ends; bulk harm: every injected fault caught with all checks within the targets.
- T1 simulations: `tests/t1/konza.json` (31) and `tests/t1/k3.json` (17); runs and suites in the K5 design notes (kept private) sections 6 to 9 and the K6 design notes (kept private).
- Real calls by the author: passport renewal in English and Swahili (conversation ids in the K5 design notes (kept private) section 10; redacted excerpts in `web/lib/demo/`).

### 7. Known limits

1. The drift check (C6) alone does not flag a catchment fault that grants everyone a school place (simulation F2); the recomputation check (C5) catches it when all checks run, which is how they run live.
2. Live, C6 has no history yet, so it does not run; C1 to C5 and C7 to C9 do.
3. C8 reads the transcript after the call, so a missed read-back is a finding for an officer, never a refused commit; the two-step tools still require a prepare, a later commit and the same arguments.
4. Speech recognition can mishear names and numbers; amounts and dates are therefore read back from the rules, never taken from what the caller said.
5. Every resident, agency and payment in this repository is synthetic; a live deployment needs the authority, legal basis and impact assessment that requires.

### 8. Impact assessment

`docs/konza/impact-assessment.md` (DPA s31 and the AI Bill's proposed assessment), filled in K6.
