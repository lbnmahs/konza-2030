-- Scenario 4 (Al Noor Residency Services): residency applications, documents, biometrics and
-- single-use upload links. All data is fictional. Service role only; /upload/[id] reads its
-- link through the web app's server route.

create table residency_applications (
  id text primary key,
  ref text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  type text not null,
  submitted date not null,
  stages jsonb not null default '[]'
);

create table residency_documents (
  id bigint generated always as identity primary key,
  application_id text not null references residency_applications (id) on delete cascade,
  type text not null,
  valid_until date not null,
  status text not null check (status in ('valid', 'flagged', 'replaced')),
  flag_rule text,
  flagged_on date
);

create table biometric_slots (
  id text primary key,
  centre text not null,
  area text not null,
  starts_at timestamp not null -- local UAE time
);

create table biometric_bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  application_id text not null references residency_applications (id) on delete cascade,
  slot_id text not null unique references biometric_slots (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (conversation_id, application_id)
);

create table upload_links (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  application_id text not null references residency_applications (id) on delete cascade,
  document_type text not null,
  expires_at timestamptz not null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, application_id, document_type)
);

alter table residency_applications enable row level security;
alter table residency_documents enable row level security;
alter table biometric_slots enable row level security;
alter table biometric_bookings enable row level security;
alter table upload_links enable row level security;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    council_missed_reports, council_tax_accounts, council_collections, council_properties,
    county_permits, county_markets,
    upload_links, biometric_bookings, biometric_slots, residency_documents, residency_applications,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
