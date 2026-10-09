-- P7 Kenya: U3-KE lost national ID (Usajili Njema) and K1 health cover (Tiba Njema Cover
-- Authority). All data is fictional. Service role only.

-- National ID cards (also used by the UAE identity scenario in P8).
create table id_cards (
  id text primary key,
  card_no text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  authority text not null,
  status text not null default 'active' check (status in ('active', 'blocked', 'replaced')),
  blocked_at timestamptz
);

-- A confirmed loss declaration; blocking the card happens in the same request (ID-01).
create table id_losses (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  card_id text not null references id_cards (id) on delete cascade,
  kind text not null check (kind in ('lost', 'stolen')),
  lost_on date not null,
  location_description text not null, -- caller's words, never written to the audit log
  created_at timestamptz not null default now(),
  unique (conversation_id, card_id)
);

create table id_applications (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  loss_id uuid not null references id_losses (id) on delete cascade,
  citizen_id text not null references citizens (id) on delete cascade,
  authority text not null,
  fee numeric not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, loss_id)
);

-- Register offices serve more than one authority and service now.
alter table registry_offices
  add column authority text not null default 'govconnect',
  add column service text not null default 'birth_registration',
  add column area text,
  alter column covers_postcodes set default '{}';
alter table registry_bookings add column case_ref text;

-- Health cover
create table health_members (
  id text primary key,
  member_no text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  scheme text not null check (scheme in ('informal', 'salaried'))
);

create table health_contributions (
  id bigint generated always as identity primary key,
  member_id text not null references health_members (id) on delete cascade,
  month text not null, -- YYYY-MM
  amount numeric not null,
  payment_id uuid references payments (id) on delete set null,
  paid_on date not null,
  unique (member_id, month)
);

create table health_dependants (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  member_id text not null references health_members (id) on delete cascade,
  dependant_name text not null,
  dependant_dob date not null,
  relationship text not null,
  upload_id uuid references uploads (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  decision_by date not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, member_id, dependant_name)
);

create table health_cover_confirmations (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null unique,
  member_id text not null references health_members (id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['id_cards', 'id_losses', 'id_applications', 'health_members',
    'health_contributions', 'health_dependants', 'health_cover_confirmations']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    council_missed_reports, council_tax_accounts, council_collections, council_properties,
    county_permits, county_markets,
    uploads, biometric_bookings, biometric_slots, residency_documents, residency_applications,
    life_event_plans, benefit_drafts, registry_bookings, registry_slots, registry_offices,
    id_applications, id_losses, id_cards,
    health_cover_confirmations, health_dependants, health_contributions, health_members,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
