-- P9 United Kingdom (Northfield): E1 council tax student exemption and E3 parking fine
-- challenge. All data is fictional. Service role only.

-- E1: the rules assessment made on the call, then applied once every certificate is in.
create table council_tax_exemptions (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  account_no text not null references council_tax_accounts (account_no) on delete cascade,
  outcome text not null check (outcome in ('exempt', 'discount_25', 'none')),
  occupants jsonb not null, -- names the caller gave; never written to the audit log
  certificates_needed text[] not null default '{}',
  status text not null default 'assessed' check (status in ('assessed', 'applied')),
  new_annual_gbp numeric,
  new_balance_gbp numeric,
  created_at timestamptz not null default now(),
  unique (conversation_id, account_no)
);

-- E3
create table pcns (
  id text primary key,
  pcn_no text not null unique,
  vehicle_reg text not null,
  citizen_id text not null references citizens (id) on delete cascade,
  issued_on date not null,
  issued_time text not null,
  location text not null,
  amount_full_gbp numeric not null,
  status text not null default 'open' check (status in ('open', 'challenged', 'paid'))
);

create table pcn_challenges (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  pcn_id text not null references pcns (id) on delete cascade,
  ground text not null,
  statement text not null, -- caller's words; never written to the audit log
  upload_id uuid references uploads (id) on delete set null,
  reply_by date not null,
  status text not null default 'awaiting officer' check (status in ('awaiting officer')),
  created_at timestamptz not null default now(),
  unique (conversation_id, pcn_id)
);

alter table council_tax_exemptions enable row level security;
alter table pcns enable row level security;
alter table pcn_challenges enable row level security;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    council_tax_exemptions, pcn_challenges, pcns,
    council_missed_reports, council_tax_accounts, council_collections, council_properties,
    county_permits, county_markets,
    uploads, biometric_bookings, biometric_slots, residency_documents, residency_applications,
    life_event_plans, benefit_drafts, registry_bookings, registry_slots, registry_offices,
    id_deliveries, id_applications, id_losses, id_cards,
    health_cover_confirmations, health_dependants, health_contributions, health_members,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
