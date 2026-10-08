# konza-2030-api

**Independent open-source project · not affiliated with any government body.**

`openapi.yaml` (OpenAPI 3.1, Apache-2.0) is a profile of Kenya's Government Interoperability Framework v3.0 (ICTA, "3rd Edition, ICTA GIF: 001:2025") for agencies that act for residents. It does not compete with GIF; it follows it and adds the pieces an assistant acting for people needs.

| From GIF v3.0 (page) | In the profile |
|---|---|
| RESTful APIs to OpenAPI 3.x, 3.1 (p40, p68) | OpenAPI 3.1 |
| OAuth2 and OIDC (p40) | `agencyOAuth` (client credentials between member systems), `residentOidc` (the resident signs in); the reference implementation uses shared secrets |
| TLS 1.3 (p40, p116) | Target server; the reference implementation runs on Supabase's TLS |
| X-Road style exchange, signed and logged requests (p52 to 53) | `X-Konza-Request-Id` on every request and an append-only `AuditEvent` per operation |
| Maisha Number for identity (p27) | The `QK-` resident number |
| Once-only principle (p14) | `GET /residents/me/address`: agencies read the registered address, never ask again |
| Appeals handler role (p102), delegation mechanisms (p156), no schemas | Added: `Decision`, `Appeal`, `DelegationConsent`, `X-Konza-On-Behalf-Of` |

**Added by the profile**

- `x-konza-charter` on every operation: `acts_alone`, `asks_first` (202 with a confirmation, then the same request with `confirmation_id`, 4 s to 3 minutes later), `never_acts` (officer credential only).
- `Decision`: the explain-why receipt (reason, rule ids, inputs used, `decided_by` rule or officer, never an assistant, and the review route). Rules may only grant; anything adverse waits for an officer.
- `Appeal` to the Aminia Review Panel (30 days to ask, free, answered in 10 working days).
- `DelegationConsent`: a recorded parent or guardian lets a delegate act for a child, by scope, until a date; withdrawal stops it at once.
- `Address` and `Delivery` for the city's addressing system.
- Generic paths: an agency is a manifest entry (`supabase/functions/_shared/konza/manifest.ts`), not new paths.

**Run the checks** (local stack): `deno task contract` validates the spec, calls every documented path and status code, and checks every response against its schema.
