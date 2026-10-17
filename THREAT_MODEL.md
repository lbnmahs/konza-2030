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
6. The web app: panel pages (including `/handset`) need a signed-in panel user; public pages (`/demo`, `/transparency`, `/developers`) are static and read no audit table. `/developers` is built from checked copies of the public spec (`web/lib/spec`) and runs under the strict CSP.
7. The resident app (`/sia`, K8): public since 17 Oct 2026 (Mahs), with no sign-in; anyone can start a session, so the daily limits (20 browser sessions, SIA's daily call limit, the SMS budget) cap what a stranger can spend, and codes and texts still go only to allowlisted phones. After the browser binds its conversation it holds a resident-session cookie (`__Host-`, HttpOnly, Secure, SameSite=Strict, 45 minutes) whose SHA-256 maps to that one conversation. `/api/resident/*` resolves the conversation from the cookie only, accepts state changes only from its own origin, and runs under a strict CSP (per-request nonce, scripts and audio worklets from this origin only, never framed).
8. Screen events and taps (K8 S2): only the backend writes `ui_events` (append-only, one sequence per conversation, no grants for `anon` or `authenticated`); the app reads them through `/api/resident/events` for the cookie's conversation. A tap goes to `/api/resident/act` (the session cookie, same origin, the session's CSRF token issued at bind and stored as a hash), then to the tools function's `/ui/act` with its own server-only secret (`UI_ACT_SECRET`, never `TOOL_SECRET`). For a confirm or Refresh the browser sends only the action, the confirmation id and the hash of the card it shows, and the tool and arguments come from the stored confirmation; other taps send what their card asks for (form fields, a code, a PIN, a method, a day), which go to the same handlers as the agent's calls.

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
| One resident session reading or acting on another | The conversation comes from the session cookie only, never from a parameter; one cookie per bound conversation, stored as a hash; End and the 45 minute expiry close it; same-origin check on every state change | `test:local` resident session tests (A never reads B, one session per bind, ended and expired resolve to nothing, no anon access); `tests/resident_session_test.ts` |
| A tap commits something other than what was shown, or twice | A confirm tap commits the stored arguments only when its `shown_hash` (SHA-256 of the JCS form of the confirmation id, tool, arguments hash and the English and Swahili read-back with its items) matches the card recorded at emit; a mismatch is refused (409) and audited; the 4 s minimum, 3 minute expiry and single use apply as for a spoken yes; whichever yes comes first wins and a later commit gets the stored result, so nothing happens twice; Refresh prepares again with a new id and hash | `test:local` K8 S2 tap tests (wrong hash, tap within 4 s, double tap, tap then agent and the reverse, A cannot act on B, Refresh, no browser access to `ui_events`) |
| A model or a stale screen commits different arguments | A confirmation shown on a screen always commits the arguments stored when its card was shown, by tap or by voice; the identity card's code and the form card's fields go to the same handlers as the agent's calls and never reach the model (it gets ids only); C10 compares each screen commit's arguments hash with the shown card's and reports any difference | `test:local` MED-331 tests (form then a spoken yes with other arguments commits what the card showed; shown, tap and commit rows with matching hashes); `audit/checks_test.ts` C10 |
| A forged or cross-site tap | Same-origin check and the session's CSRF token on `/api/resident/act`; the act secret stays on the server | `tests/resident_session_test.ts` (CSRF, tap parsing); `test:local` CSRF hash per session |
| An outage on a tap shows "done" | The act route reports done only from a 2xx JSON reply of the tools function; a network failure, timeout, 5xx or non-JSON reply becomes "Nothing has changed" and the card stays | `tests/resident_session_test.ts` outage test |
| A fee paid twice, or a double tap on Pay (K8, MED-332) | One approved payment per reference: a method is chosen once per payment, by a tap or by voice (a conditional update on the row still waiting, so of two choices one wins and only one code is texted); a code or PIN approves only while the amount is still the open charge; the app sends one tap at a time | `test:local` MED-332 tests (double tap texts one code, paid once; deliver pesa still shows the card); AD-07 test (paid once after a change) |
| A PIN or card detail exposed | Methods are seeded and masked, never typed; the mobile money PIN is typed on the card, checked against a hash and never reaches the model, the transcript, an event or a log; a PIN said aloud is refused (`pin_on_screen`); the resident app never uses the KE PIN simulator (`deliver` is ignored there) | `test:local` "the PIN is not stored or logged"; `tests/resident_session_test.ts` (no resident route reaches `/api/pesa`) |
| Changing what was decided, or what is charged, after the fact (AD-07) | Decisions are append-only; home or collect changes only while nothing is paid on the reference, as its own row (append-only, no browser grants), asked first with the new total from the rules; a payment waiting on the old amount is closed; after a payment it goes to an officer as a case; C3 and C7 cover the change rows | `test:local` AD-07 tests (charge moves, old card closed, paid once, refused after payment, decision unedited) |
| A child named or an id typed from the screen (MED-333) | Fields that hold an id are choices the backend fills from records: the resident's own children (guardianships), own businesses, the schools, a desk record by type; the child's number goes from the card to the backend, which prepares the consent itself, so the model never has to say or type it (the consent result, as for a spoken consent, names the resident numbers); consent and the child's application show the consent card | `test:local` MED-333 tests; `catalog_test.ts` (no id field is typed) |
| Script injected into the resident app | Strict CSP with a per-request nonce on `/sia` and `/api/resident/*`; the voice SDK's worklets self-hosted, so no `blob:`, `data:` or CDN script source; all text rendered as text (no `dangerouslySetInnerHTML`, lint rule) | `web/proxy.ts`; worklet loading checked under the policy (MED-329); `npm --prefix web run test:a11y` injection fixture (markup in a caption and a card shown as text) |
| Impersonating a public body | Agency names checked against real ones; the independence label on every page; AI disclosure first | label checks; `docs/konza/labelling.md` |
| Voice cloning | Library or designed voices only; a real person's voice only with written consent | `docs/konza/voice.md` |

## Residual risks

1. Speech recognition errors cannot be removed, only caught by read-back and a yes.
2. A caller can try to argue the sampled grader into a pass; its findings are reports only, never holds.
3. The drift check (C6) alone misses a fault that grants everyone a school place; the recomputation check catches it when all checks run.
4. A member system holding the client secret can read a resident's status over the API, as for any read on behalf of a resident it names.
5. The checker reads the database after each decision, so a wrong rule can grant a few times before the hold opens (25 or fewer decisions in the simulation).
6. Savannah's words are checked only by the prompt and the sampled grader (C9). In K8 sessions she once offered a change no tool made and quoted a total no tool gave, and once tried to commit a booking before reading it back; nothing happened without a tool result (the two-step guard refused the early commit), and the prompt now forbids both, but a spoken claim itself cannot be blocked.

Report a problem through [`SECURITY.md`](SECURITY.md).

Independent open-source project. Not affiliated with the Konza Technopolis Development Authority or any government body.
