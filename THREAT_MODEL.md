# Threat model

SIA (persona Savannah) is a voice assistant that answers residents' questions about public services and, with a clear yes, prepares and submits requests for them and for their children. This page lists what could go wrong, the control for each, where it is enforced, and the test that shows it works. Mapped to the OWASP Top 10 for LLM Applications (2025) plus the risks particular to acting for people.

## What we protect

- **Residents' records** (synthetic in this repository): identity, addresses, children and family links, applications, decisions, payments.
- **Decisions:** that every decision is made by a published rule or a human officer, with its reason and a review route, never by the model.
- **Money and irreversible steps:** payments, submissions, bookings, consents.
- **The audit trail** that lets an independent office check all of the above.
- **People outside the system:** nobody may be texted, called or charged without being on an allowlist.

## Trust boundaries

1. Caller and voice platform (ElevenLabs): speech in, model, voice out. Untrusted input.
2. Voice platform to the backend (`tools` edge function): a shared secret header; every call is checked against a conversation opened by the call-started webhook.
3. Backend to database: the service role, limited to the rights it uses on the audit tables.
4. Member systems (agencies) to the Konza API: their own client secret; officer actions need a separate officer credential.
5. The Audit Office (`audit` function): its own secret and its own database role (`mirror_vale`), which reads only the columns its checks need and writes only findings, holds and its own events.
6. The web app: panel pages need a signed-in panel user; public pages are static and read no audit table.

## OWASP LLM Top 10

| Risk | Threat here | Control | Enforced in | Shown by |
|---|---|---|---|---|
| LLM01 Prompt injection | A caller, a dictated letter or an uploaded document tells the assistant to skip a rule, pay, or reveal data | Caller text and documents are data; tool results never carry instructions from users; no tool decides anything; two-step tools need a later commit with the same arguments | backend, prompt | `deno task sim manipulation` (100% stored as data or refused); T1 manipulation tests |
| LLM02 Sensitive information disclosure | The assistant reads out a code, a child's full name, someone else's record | Identity by one-time code before any personal record; children by first name only; codes and references never read aloud; transcripts redacted before they leave the voice platform | backend, prompt, `audit/redact.ts` | `test:local` identity and delegation tests; `audit/redact_test.ts`; `tests/demo_test.ts` |
| LLM03 Supply chain | A dependency or downloaded tool is compromised | Pinned versions in `deno.lock` and `web/package-lock.json`; tools downloaded only from official releases with checksums checked | process | the release scan (kept private) |
| LLM04 Data and model poisoning | Synthetic data or rules corrupted to bias decisions | Rules are code with tests; the Audit Office recomputes decisions from its own copy of the rules and pauses a service on a mismatch | `audit/`, `konza_holds` | `deno task sim bulk` (each injected fault caught, 0 wrong grants after the hold) |
| LLM05 Improper output handling | Model output used as a fee, a date or an identifier | Fees, dates and eligibility come from the rules module; read-backs are built by the backend in English and Swahili; the model's numbers are never inputs | backend | `deno task test` read-back tests; C5 recomputation; C8 confirm-back check |
| LLM06 Excessive agency | The assistant approves, refuses or pays on its own | Three charter levels in the backend: acts alone, asks first (read-back and clear yes, identity in the last 5 minutes for money), never acts (no tool; officer credential only) | backend, database checks | `test:local` two-step and officer tests; `contract` |
| LLM07 System prompt leakage | A caller extracts the prompt to find weaknesses | No secrets, rule tables or credentials in prompts; service cards hold steps only | prompt | T1 "asks for the system prompt" |
| LLM08 Vector and embedding weaknesses | Not applicable: no retrieval store | | | |
| LLM09 Misinformation | The assistant states a rule or fact it made up | Facts only from tool results or service cards; the Audit Office grades a redacted sample of calls against the charter | prompt, `audit/sample.ts` | T1 advice tests; C9 findings |
| LLM10 Unbounded consumption | Someone runs up credits or texts | Signed URLs only, daily call limit and concurrency 1 on the agent; SMS and email allowlists and daily budgets; a credit budget per test phase that refuses runs | platform, backend, `scripts/_cost.ts` | `test:local` "a number outside ALLOWED_RECIPIENTS gets nothing"; call limits in `agents/konza/sia/agent.json`; the T1 runner refuses past the phase budget |

## Acting for people

| Threat | Control | Shown by |
|---|---|---|
| Acting for a child without consent | Only a recorded guardian can consent, per scope, until a date; withdrawal stops it at once; every on-behalf call is checked | `deno task sim delegation` (12 of 12 correct and audited) |
| Someone else's phone or a stolen identity | One-time code to the phone on record; an identity concern holds the session (no writes or money for the rest of the call) and opens a case | `test:local` identity concern test |
| A misheard amount or date | Read-back from the rules, a clear yes in the next turn, and C8 after the call | readback and C8 tests; T1 language tests |
| Exclusion | Payment by phone code or at a desk; paper at a desk; an officer route for every step | `deno task sim exclusion` (0 dead ends) |
| An outage leaves a false "done" | Every failure returns a fallback route; nothing is said to be done without a tool result | `deno task sim outage` (0 partial writes, 0 false done) |
| Impersonating a public body | Agency names checked against real ones; the independence label on every page; AI disclosure first | label checks; `docs/konza/labelling.md` |
| Voice cloning | Library or designed voices only; a real person's voice only with written consent | `docs/konza/voice.md` |

## Residual risks

1. Speech recognition errors cannot be removed, only caught by read-back and a yes.
2. A caller can try to argue the sampled grader into a pass; its findings are reports only, never holds.
3. The drift check (C6) alone misses a fault that grants everyone a school place; the recomputation check catches it when all checks run.
4. A member system holding the client secret can read a resident's status over the API, as for any read on behalf of a resident it names.
5. The checker reads the database after each decision, so a wrong rule can grant a few times before the hold opens (25 or fewer decisions in the simulation).

Report a problem through [`SECURITY.md`](SECURITY.md).

Independent open-source project. Not affiliated with the Konza Technopolis Development Authority or any government body.
