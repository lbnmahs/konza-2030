# Impact assessment: SIA, the Konza resident assistant

Independent open-source project · not affiliated with any government body

K1 (MED-256) template, 5 Oct 2026; filled in K6 (MED-309), 8 Oct 2026. Follows the Data Protection Act 2019 s31(2) (a data protection impact assessment) and the pre-deployment risk and human rights assessment the AI Bill 2026 proposes for high-risk systems (public administration is high risk; the Bill is not law). This repository holds no real personal data; the assessment covers what a live deployment needs and tests that the system already behaves that way. The public summary is the transparency record (`docs/konza/transparency.md`).

Owner: Mahs. Reviewer: Mirror Vale Audit Office. Version 1, 8 Oct 2026; signed off by Mahs on 8 Oct 2026.

## 1. What the system does and why (s31(2)(a))

- **Purpose.** An AI assistant on the phone (Savannah, SIA) that answers residents' questions about public services and, with their clear yes, prepares and submits requests for themselves and, as a recorded parent, for their children. It never decides: a published rule or a human officer does, every decision carries a reason and a free review route, and an independent checker watches the decisions.
- **Services in scope:** arrival (address and child registration, SRR), passport renewal (SPS), health cover and dependants (SCA), business registration and trading permit (SCO), primary school place (SILN), review (Aminia Review Panel). Rules in `docs/konza/world.md`.
- **Who uses it:** residents, parents acting for children, officers (decisions, desk payments and documents, reviews, clearing holds), the Audit Office.
- **Channels and languages:** phone (one number) and browser calls, SMS to an allowlisted phone, web receipts; English and Swahili (Sheng out of scope since K5).
- **Data processed, per service:**

| Field | Purpose | Source | Sensitive (DPA s2) | Kept |
|---|---|---|---|---|
| Resident number, date of birth | identity check before personal records | caller, checked against the registry | no | registry (seed) |
| Phone number | one-time codes, DEMO texts | registry | no | registry; calling numbers only as hashes |
| One-time and payment codes | identity, approving a payment | generated | no | hashes only, 5 minutes, 3 tries |
| Passport number, expiry, pages | renewal window and fee (PP-01, PP-02) | registry | no | passports table |
| Address and zone | delivery (AD-01 to AD-06), school catchment (ED-03) | registry, desk document | no | addresses table |
| Children's names, dates of birth, guardian links | acting for a child, school age (ED-06), cover (SH-03) | registry, birth certificate at the desk | yes (children; family links) | guardianships; spoken by first name only |
| Delegation consents | acting for a child (DPA s33) | parent on the call | yes (family links) | until 12 months or age 18; withdrawal stops it at once |
| Documents (tenancy, employer letter, birth certificate) | evidence | handed in at Lango Square; an officer records type and result | birth certificate: yes | the record of type and result, not the paper |
| Biometrics appointment | passport (PP-03) | caller's choice | appointment only, no biometric data | appointments table |
| Business name, tax number | registration (BZ-01 to BZ-05) | caller, rules | no | applications and decisions |
| Payments | fees (PY-01, PY-02) | rules and the resident | no | payments, without card or account data |
| Call transcript | the call; C8 and C9 checks | ElevenLabs | may hold anything the caller says | 30 days at ElevenLabs; the repo keeps ids and counts only; no audio |

- **Automated decisions** (rule grants; each with a receipt, an SMS notice and the review route; DPA s35(3)): resident card and child registration with a checked document (AR-01 to AR-03), passport renewal grant (PP-02, PP-01), appointment and delivery bookings (PP-03, AD-03, AD-04), health contribution accepted (SH-01, SH-02) and dependant with a checked document (SH-03, SH-04), business name and permit (BZ-01, BZ-03, BZ-04), school place in zone with space (ED-01 to ED-06). **No adverse decision is automated**: refusals, other offers, documents that do not check out, names that suggest a government body (BZ-05), a full or out-of-zone school (ED-04) and every review go to an officer (database check: adverse outcomes only by an officer).
- **Processors and where data goes:** ElevenLabs (agent, voice, speech recognition, transcripts 30 days, no audio), Twilio (SMS to the allowlisted phone), Supabase (database and functions, London), Vercel (web pages; public pages read no audit table), Resend (calendar email to allowlisted addresses), Anthropic (redacted transcripts for sampled checks; not used for training by default; only counts kept). Each sees only what its row in `docs/konza/transparency.md` section 3 lists.

## 2. Necessity and proportionality (s31(2)(b))

- **Each field is needed** for a rule or an identity check named above. Not collected: card or bank numbers (payments are prompts approved by code, or at a desk), biometric data (only the appointment), audio, full names of children in speech, national ID numbers (only the Konza resident number verifies).
- **Why an assistant and not a form:** many residents phone rather than fill forms (feature phones, low literacy, poor signal; the exclusion simulation has 0 dead ends because every step has a desk or officer route). What stays manual on purpose: every adverse decision, every review, desk documents and desk payments, clearing a hold.
- **Retention:** transcripts 30 days (ElevenLabs), no audio; data reset before each test session; audit log, holds and findings append-only and kept for the life of the deployment (a real deployment would set a period in law; the AI Bill proposes 5 years for records); receipt links expire after 60 days; test calls are deleted when a phase closes unless cited, and then only the conversation id is kept.

## 3. Risks to residents (s31(2)(c))

Likelihood and severity are for a real deployment with the safeguards in section 4 in place.

| Risk | Who is affected | Likelihood | Severity | Evidence from tests |
|---|---|---|---|---|
| Wrong advice acted on | any resident | low | medium | facts only from tools (charter 5.2; C9 samples); T1 "advice" tests in `tests/t1/konza.json` |
| One wrong rule applied to many people | many residents at once | low | high | bulk simulation: each injected fault flagged at 25 or fewer decisions out, 0 wrong grants after the hold (`docs/konza/sim/bulk-seed1.json`); C6 alone misses F2 (known limit) |
| A child's data disclosed or misused | children (sensitive) | low | high | consent checked on every on-behalf call (C4; delegation simulation 12 of 12); first names only (readback tests) |
| Biometric or voice data misused | residents; the author's own voice | low | medium | no biometric data held; no audio kept; library voice only (`docs/konza/voice.md`) |
| Marital status and family links exposed (sensitive, s2) | parents, children | low | medium | guardianships read only by the backend; the Audit Office's role cannot read names; receipts show an allowlist of inputs |
| Acting for someone without consent | children, other adults | low | high | consent required per scope and withdrawable (`test:local`, delegation simulation); adults for adults not offered |
| A misheard name, amount or date | Swahili speakers, mixed-language callers | medium | medium | read-back from the rules word for word and a clear yes (C8; Mahs's Swahili take, plan-k5 section 10); amounts never taken from speech |
| Exclusion (feature phones, low literacy, poor signal) | residents without smartphones | medium | medium | phone-code payments and desk routes; exclusion simulation 0 dead ends |
| Outage leaves people stuck | anyone mid-request | medium | medium | outage simulation: 100% answered or routed, 0 partial writes, 0 false "done" |
| Manipulation through uploads or speech | all | medium | medium | dictated text stored as data or refused (manipulation simulation 100%); T1 manipulation tests; no tool decides |
| Mistaken for an official service | the public | low | medium | label on every surface, DEMO in every SMS, AI disclosure in the first message, look-alike review (`docs/konza/labelling.md`) |

## 4. Safeguards (s31(2)(d))

| Risk | Control | Enforced in | Test that shows it |
|---|---|---|---|
| Wrong advice | fees, dates and eligibility only from tools; service cards; no prediction | backend (rules) and prompt | `deno task test` rules; T1; C9 |
| Bulk harm | Audit Office recomputes every decision; holds pause rule grants until an officer clears them | `audit/`, `konza_holds`, `konza_store_decision` | `sim bulk`; `test:local` holds tests |
| Separation of duties | the Audit Office's own database role; SIA's backend cannot open holds or write findings | database grants (K6) | `test:local` K6 role tests |
| Child data, consent | `DelegationConsent` per scope, expiry, withdrawal; first names only | backend (core), database | `test:local`; `sim delegation`; readback tests |
| Irreversible steps | two-step tools (prepare, read-back, clear yes, later commit with the same arguments); identity in the last 5 minutes for money | backend (`tools/index.ts`) | `test:local`; C3; C8 |
| Misheard values | read-back built from the rules in English and Swahili; C8 after the call | backend; `audit/` | readback tests; Mahs's Swahili take |
| Exclusion | phone-code payment; desk payment and documents; officer cases | backend; process | `sim exclusion` |
| Outage | fallback route on any failure, never a false "done"; refuse when the audit log is down | backend | `sim outage` |
| Manipulation | caller text and documents are data; never in `next`; no deciding tool | backend; prompt | `sim manipulation`; T1 manipulation tests |
| Disclosure and look-alikes | AI line first; label; DEMO texts; designed names only | prompt, web, SMS sender | label check; `tests/demo_test.ts`; `sms.ts` refuses texts without DEMO |
| Data leaving the system | one redaction module for any transcript that leaves ElevenLabs; leftovers block the send | `audit/redact.ts` | `audit/redact_test.ts`; `tests/demo_test.ts` |
| Public links | receipts: allowlisted inputs, 60-day expiry; public pages read no audit table | web | `tests/receipt_test.ts`; `tests/demo_test.ts` |

## 5. Residual risk and sign-off

- **Residual risk: medium.** The controls are enforced in code and tested, but speech recognition errors, manipulation through conversation and exclusion cannot be removed entirely, and the checker's drift test (C6) needs history it does not have live yet. Each is mitigated by read-back and a yes, by having no deciding tool, by desk and officer routes, and by the recomputation checks (C1 to C5, C7 to C9) running after every decision.
- **If residual risk were high**, a real deployment would consult the Data Commissioner first (s31(3)). At medium, a real deployment should still consult before launch, because the system processes children's data and family links.
- **Human rights check.** Equality and non-discrimination: the same rules for every resident; desk routes for those without smartphones; two languages, more needed. Children's best interests: only a recorded parent acts, by scope, withdrawable, first names only. Access to remedy: every decision has a free review by a person within 30 days, answered within 10 working days with reasons. Privacy: least data per step, no audio, short transcript retention, hashes for codes, redaction before anything leaves the system.
- **Sign-off:** owner Mahs, 8 Oct 2026; Audit Office: the checks in section 4 pass on 8 Oct 2026 (suites and simulations in `docs/konza/transparency.md` section 6). Review again after any change to the charter, a new service, a new processor or a new model.
