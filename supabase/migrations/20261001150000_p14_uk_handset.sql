-- P14: GP registration (UK country agent) and the panel's virtual handset (browser calls).
-- All data is fictional. Service role only (RLS on, no policies).

create table gp_registrations (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  citizen_id text not null references citizens (id) on delete cascade,
  authority text not null,
  type text not null check (type in ('permanent', 'temporary')),
  status text not null default 'registered' check (status in ('registered', 'cancelled')),
  student boolean not null default false,
  created_at timestamptz not null default now(),
  unique (conversation_id, citizen_id)
);
create trigger gp_registrations_log_status after insert or update on gp_registrations
  for each row execute function log_status();

-- How the conversation reached us: a phone call (call_started) or the panel's handset.
alter table conversations add column channel text not null default 'phone'
  check (channel in ('phone', 'browser'));

-- The panel asks for a one-time token before a browser call; the browser presents it with the
-- new conversation id, which registers the conversation so tools accept it.
create table handset_tokens (
  token_hash text primary key,
  agent_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  conversation_id text
);

-- Codes and texts for browser calls are shown on the panel's handset instead of being sent.
create table handset_inbox (
  id bigint generated always as identity primary key,
  conversation_id text not null,
  kind text not null check (kind in ('sms', 'voice')),
  body text not null,
  at timestamptz not null default now()
);
create index handset_inbox_conversation on handset_inbox (conversation_id, at);

do $$
declare t text;
begin
  foreach t in array array['gp_registrations', 'handset_tokens', 'handset_inbox']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    state_events, refunds, confirmations, session_flags, gp_registrations,
    handset_tokens, handset_inbox,
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

-- Panel data only for signed-in panel users (P14 security P1): the browser no longer reads
-- anything with the public key alone.
drop policy "panel reads audit_log" on audit_log;
drop policy "panel reads conversations" on conversations;
drop policy "pesa reads payments" on payments;
drop policy "panel reads authorities" on authorities;
create policy "panel users read audit_log" on audit_log for select to authenticated using (true);
create policy "panel users read conversations" on conversations for select to authenticated
  using (true);
create policy "panel users read payments" on payments for select to authenticated using (true);
create policy "panel users read authorities" on authorities for select to authenticated
  using (true);
