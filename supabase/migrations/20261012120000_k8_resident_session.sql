-- K8 S1 (MED-329): the resident session for /sia. A browser session starts exactly like the
-- handset (one-time token, 20 a day); when the browser binds its conversation, the server also
-- issues a session cookie. Only the cookie's SHA-256 is stored here, with a 45 minute expiry, so
-- each cookie maps to exactly one conversation. /api/resident/* resolves the conversation from the
-- cookie only, never from a parameter. handset_tokens is already in demo_truncate() and has no
-- grants for anon or authenticated (K6), so the new columns are server-only too.

alter table handset_tokens
  add column session_hash text unique,
  add column session_expires_at timestamptz;

alter table handset_tokens
  add constraint handset_tokens_session_pair
  check ((session_hash is null) = (session_expires_at is null));
