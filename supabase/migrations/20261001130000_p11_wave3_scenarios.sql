-- P11 Wave 3 scenarios: N1 (Northfield, registered blind), N2 (Wezesha Njema, disability tax
-- exemption), N3 (Al Noor text line, Kenyan baby). All data is fictional. Service role only.

-- N1
create table sight_registrations (
  id text primary key,
  citizen_id text not null references citizens (id) on delete cascade,
  category text not null check (category in ('severely_sight_impaired', 'sight_impaired')),
  registered_on date not null,
  certified_by text not null
);
create table blue_badge_drafts (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  route text not null,
  status text not null default 'DRAFT' check (status = 'DRAFT'),
  created_at timestamptz not null default now()
);

-- N2
create table disability_registrations (
  id text primary key,
  reg_no text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  registered_on date not null,
  area text not null,
  step_free_needed boolean not null default false,
  employer text,
  tax_exemption text not null default 'none'
);
create table tax_exemption_applications (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  status text not null default 'awaiting vetting' check (status in ('awaiting vetting', 'approved')),
  certificate_no text,
  start_date date,
  valid_until date,
  created_at timestamptz not null default now()
);
alter table registry_offices add column step_free boolean not null default true;

-- N3
create table newborn_cases (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  baby_dob date not null,
  created_at timestamptz not null default now()
);
create table reminders (
  id bigint generated always as identity primary key,
  conversation_id text not null,
  citizen_id text not null references citizens (id) on delete cascade,
  authority text not null,
  case_ref text not null,
  topic text not null,
  due_on date not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent')),
  sent_at timestamptz,
  unique (conversation_id, topic)
);

do $$
declare t text;
begin
  foreach t in array array['sight_registrations', 'blue_badge_drafts', 'disability_registrations',
    'tax_exemption_applications', 'newborn_cases', 'reminders']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    partner_referrals, partners, adjustments,
    sight_registrations, blue_badge_drafts, disability_registrations, tax_exemption_applications,
    newborn_cases, reminders,
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
