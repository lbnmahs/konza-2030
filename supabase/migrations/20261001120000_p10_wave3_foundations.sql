-- P10 Wave 3 foundations: partners with per-partner consent and field filtering, accessibility
-- adjustments. All data is fictional. Service role only.

-- Reference data, reseeded with the demo (partners serve one authority each).
create table partners (
  id text primary key,
  name text not null,
  sector text not null,
  country text not null check (country in ('GB', 'KE', 'AE')),
  authority text not null,
  offer text not null,
  allowed_fields text[] not null,
  send_when text not null default 'now' check (send_when in ('now', 'on_approval'))
);

create table partner_referrals (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  case_ref text,
  partner_id text not null references partners (id) on delete cascade,
  fields_sent jsonb not null default '{}', -- only allowed fields, personal values masked
  fields_stripped text[] not null default '{}',
  status text not null check (status in ('sent', 'scheduled', 'declined')),
  send_when text not null check (send_when in ('now', 'on_approval')),
  linked_ref text, -- the application whose approval releases a scheduled referral
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (conversation_id, partner_id)
);

create table adjustments (
  id bigint generated always as identity primary key,
  conversation_id text not null,
  citizen_id text references citizens (id) on delete cascade,
  adjustment text not null check (adjustment in ('sms_preferred', 'voice_otp', 'slower_speech',
    'extra_time', 'helper_present', 'easy_read', 'accessible_letters_audio',
    'accessible_letters_large_print', 'accessible_letters_braille')),
  created_at timestamptz not null default now(),
  unique (conversation_id, adjustment)
);

alter table partners enable row level security;
alter table partner_referrals enable row level security;
alter table adjustments enable row level security;

-- New panel actors.
alter table audit_log drop constraint audit_log_actor_check;
alter table audit_log add constraint audit_log_actor_check check (actor in (
  'Call', 'Identity', 'Service', 'Rules', 'Payment', 'Follow-up', 'Escalation', 'Language',
  'Upload', 'Partner', 'Accessibility'));

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    partner_referrals, partners, adjustments,
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
