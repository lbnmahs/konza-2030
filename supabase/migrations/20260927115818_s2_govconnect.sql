-- Scenario 2 (GovConnect, "I just had a baby"): register office, slots, bookings, Child Benefit
-- drafts, and the plan the rules built on the call (the checklist SMS is composed from it).
-- All data is fictional. Service role only.

create table registry_offices (
  id text primary key,
  name text not null,
  address text not null,
  covers_postcodes text[] not null
);

create table registry_slots (
  id text primary key,
  office_id text not null references registry_offices (id) on delete cascade,
  starts_at timestamp not null -- local UK time
);

create table registry_bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null unique,
  office_id text not null references registry_offices (id) on delete cascade,
  slot_id text not null unique references registry_slots (id) on delete cascade,
  attendees text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- There is deliberately no submitted status: the caller submits the claim themselves.
create table benefit_drafts (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  baby_first_name text,
  baby_dob date not null,
  status text not null default 'DRAFT' check (status = 'DRAFT'),
  created_at timestamptz not null default now()
);

create table life_event_plans (
  conversation_id text primary key,
  facts jsonb not null,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

alter table registry_offices enable row level security;
alter table registry_slots enable row level security;
alter table registry_bookings enable row level security;
alter table benefit_drafts enable row level security;
alter table life_event_plans enable row level security;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    council_missed_reports, council_tax_accounts, council_collections, council_properties,
    county_permits, county_markets,
    upload_links, biometric_bookings, biometric_slots, residency_documents, residency_applications,
    life_event_plans, benefit_drafts, registry_bookings, registry_slots, registry_offices,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
