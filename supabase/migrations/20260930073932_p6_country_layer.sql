-- P6 country layer: authorities (country, language, currency, time zone, payment skin),
-- payments linked to any case, and one uploads table for every scenario (replaces
-- upload_links). All data is fictional.

-- Reference data, upserted by scripts/demo.ts on every reset (not truncated).
create table authorities (
  id text primary key,
  country text not null check (country in ('GB', 'KE', 'AE')),
  name text not null,
  default_language text not null,
  languages text[] not null,
  currency text not null check (currency in ('GBP', 'KES', 'AED')),
  timezone text not null,
  payment_skin text not null check (payment_skin in ('mobile_money', 'card'))
);
alter table authorities enable row level security;
-- The panel and /pesa read the authority's name, country, time zone and skin.
create policy "panel reads authorities" on authorities for select to anon using (true);

-- Payments: any case can be paid, not only a permit. /pesa already reads amount, currency,
-- payee and description from the row.
alter table payments
  add column case_ref text,
  alter column permit_id drop not null;

-- Uploads: one row per requested document. Files are never stored; checks are simulated.
create table uploads (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  authority text not null,
  case_ref text not null,
  purpose text not null,
  label text not null, -- what /upload asks for, in English
  subject text not null default '', -- e.g. which student a certificate is for
  status text not null default 'waiting' check (status in ('waiting', 'received', 'expired')),
  checks jsonb not null default '[]',
  expires_at timestamptz not null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, case_ref, purpose, subject)
);
alter table uploads enable row level security;
drop table upload_links;

-- New panel actor for upload rows.
alter table audit_log drop constraint audit_log_actor_check;
alter table audit_log add constraint audit_log_actor_check check (actor in (
  'Call', 'Identity', 'Service', 'Rules', 'Payment', 'Follow-up', 'Escalation', 'Language',
  'Upload'));

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    council_missed_reports, council_tax_accounts, council_collections, council_properties,
    county_permits, county_markets,
    uploads, biometric_bookings, biometric_slots, residency_documents, residency_applications,
    life_event_plans, benefit_drafts, registry_bookings, registry_slots, registry_offices,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
