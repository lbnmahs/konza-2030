# Changelog: konza-2030-api

**Independent open-source project · not affiliated with any government body.**

Two things are versioned here, each with [semantic versioning](https://semver.org):

- **The API profile** (`openapi.yaml`, `info.version`). A new optional field or a new operation is a minor version; removing or renaming a field, path or status, or tightening a rule a client relies on, is a major version.
- **The UI catalog** (`ui/catalog.schema.json`, `ui/v1`). The backend shows a resident only the cards named here. A new kind is a minor change inside `ui/v1`: clients ignore kinds they do not know. Payloads are closed (no unknown fields), so a new optional field is also minor but ships together in the schema, the backend and the web app. Removing a kind or field, or changing what one means, starts `ui/v2`. `ui/examples.json` holds one valid event per kind.

## Unreleased

### UI catalog `ui/v1` (added)

- Kinds: `progress`, `quote`, `identity`, `form`, `confirm` (with a `consent` variant for acting for a child), `slots`, `payment`, `receipt`.
- `confirm.shown_hash` binds a tap to exactly what was shown; `confirm.earliest_at` carries the 4 s rule of the asks-first flow; `confirm.items[].value` carries the exact amount or date next to its spoken form.
- `receipt` follows the charter: a refusal or another offer is only ever an officer's, a pending decision has no decider, and a rule decision names its rules.
- `payment` never carries a PIN: fees are approved with a one-time code on the resident's phone, or at a desk.
- `receipt.decided_by` is `rule`, `officer` or `pending`, never an assistant.
- `progress` shows only what the core has recorded: `done` is recorded, `current` is recorded as waiting (a decision with an officer), `todo` is nothing yet; optional `updated` gives the time and source of the newest recorded step (Mahs, 12 Oct).
- `receipt.ref` (the application's reference) and `payment.reference` (the transaction reference once approved), both optional, so what SIA says is on the screen is there (Mahs, 12 Oct).
- `payment` (MED-332, Mahs, 13 Oct): new states `choose`, `code` and `pin`, with `methods` (the resident's own, masked), `method_id` and `attempts_left`; `channel` is no longer required. A card is approved with a code texted to the phone, mobile money with the PIN typed on the card; the card never carries either. Nothing is charged.
- Not yet in the catalog: `upload` (uploads are not accepted as evidence yet), `address`, `timeline`, `handoff`.

### API profile (unchanged at 0.1.0)

- Service application fields carry labels for the screen: `title` and `x-konza-title-sw`, and for choices `x-konza-enum-en` and `x-konza-enum-sw` in enum order. Annotations only; validation is unchanged.

## 0.1.0

First public profile: `Decision`, `Appeal`, `AuditEvent`, `DelegationConsent`, `Address`, `Delivery`, and `x-konza-charter` on every operation.
