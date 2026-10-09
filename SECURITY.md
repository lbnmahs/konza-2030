# Security policy

The residents, agencies and records in this repository are synthetic; it holds no real person's data.

## Reporting a vulnerability

Please report privately through GitHub's **Report a vulnerability** button on this repository's Security tab (private vulnerability reporting). Do not open a public issue for a security problem, and do not test against a hosted instance with real personal data or in a way that sends texts or places calls to anyone.

Include what you found, how to reproduce it against a local stack (`supabase start`, see the README), and its impact. You will get an answer within 10 working days.

## In scope

- The backend gates in `supabase/functions/tools/` and the Konza core in `supabase/functions/_shared/konza/`: identity, consent and delegation, the two-step (asks first) tools, payments by phone code, capability and session holds.
- The database migrations in `supabase/migrations/`: row level security, grants, the append-only audit log, the Audit Office's own role.
- The Mirror Vale Audit Office checker in `audit/` and the redaction in `audit/redact.ts`.
- The web app in `web/`: sign-in for the panel, the public pages, the receipt and upload links.
- Prompt injection, data leakage or excessive agency in the assistant's prompts and tools (`agents/`).

## Out of scope

- Findings that need a leaked secret from someone's own deployment.
- Denial of service against a hosted instance, and anything that spends someone else's credits.
- Third-party platforms (ElevenLabs, Twilio, Supabase, Vercel, Anthropic) themselves.

## Design notes

The threat model, with each control and the test that shows it works, is in [`THREAT_MODEL.md`](THREAT_MODEL.md). Acceptable use is in [`ACCEPTABLE_USE.md`](ACCEPTABLE_USE.md).

Independent open-source project. Not affiliated with the Konza Technopolis Development Authority or any government body.
