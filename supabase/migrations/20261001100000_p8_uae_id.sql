-- P8 UAE: U3-AE lost Emirates ID (Al Noor Identity Services), with delivery or collection of
-- the new card instead of an office slot. All data is fictional. Service role only.

alter table id_cards add column address_on_file text;

create table id_deliveries (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null unique,
  application_id uuid not null references id_applications (id) on delete cascade,
  method text not null check (method in ('delivery', 'collection')),
  address text not null, -- the address read back to the caller; never written to the audit log
  deliver_by date not null,
  created_at timestamptz not null default now()
);
alter table id_deliveries enable row level security;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    council_missed_reports, council_tax_accounts, council_collections, council_properties,
    county_permits, county_markets,
    uploads, biometric_bookings, biometric_slots, residency_documents, residency_applications,
    life_event_plans, benefit_drafts, registry_bookings, registry_slots, registry_offices,
    id_deliveries, id_applications, id_losses, id_cards,
    health_cover_confirmations, health_dependants, health_contributions, health_members,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
