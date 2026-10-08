-- P13 foundations: country agents (hubs), state history, refunds, two-step confirmations,
-- held sessions, an SMS log for the daily budget, and the cost ledger. All data is fictional.
-- Service role only (RLS on, no policies).

-- A hub agent (one per country) serves several authorities; the capability picked in the call
-- decides which authority handles each tool.
alter table demo_agents
  add column country text,
  add column hub text;

alter table conversations
  add column capability text,
  add column caller_hash text,
  add column started_by_webhook boolean not null default false;

alter table audit_log drop constraint audit_log_actor_check;
alter table audit_log add constraint audit_log_actor_check check (actor in (
  'Call', 'Identity', 'Service', 'Rules', 'Payment', 'Follow-up', 'Escalation', 'Language',
  'Upload', 'Partner', 'Accessibility', 'Refund'));

-- Append-only history of every status change. Rows are written by triggers (source 'db') or
-- by the backend with a reason and rule id. A later row may supersede an earlier one.
create table state_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  citizen_id text,
  conversation_id text,
  entity_type text not null,
  entity_id text not null,
  from_status text,
  to_status text not null,
  actor text not null default 'system',
  source text not null default 'db',
  reason text,
  rule_id text,
  supersedes bigint references state_events (id) on delete set null
);
create index state_events_citizen_at on state_events (citizen_id, at);
create index state_events_entity on state_events (entity_type, entity_id, at);
revoke update, delete on state_events from service_role, authenticated, anon;

create table refunds (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  citizen_id text references citizens (id) on delete set null,
  payment_id uuid not null references payments (id) on delete cascade,
  authority text not null,
  amount numeric not null,
  currency text not null,
  reason text not null,
  status text not null check (status in ('requested', 'approved', 'declined', 'routed', 'processed')),
  rule_id text not null,
  case_id uuid references cases (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- Two-step writes: a first call returns a confirmation id, a later call commits with it.
create table confirmations (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  tool text not null,
  args_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  committed_at timestamptz
);
create index confirmations_conversation on confirmations (conversation_id, tool);

-- After an identity concern the backend refuses writes and money tools for the rest of the call.
create table session_flags (
  conversation_id text primary key,
  reason text not null,
  case_id uuid references cases (id) on delete set null,
  at timestamptz not null default now()
);

-- Every SMS and code call sent, for the daily budget (no message text, last 3 digits only).
-- Not wiped by demo resets, so a reset does not refill the budget.
create table sms_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  channel text not null check (channel in ('sms', 'voice')),
  to_last3 text not null,
  dry_run boolean not null default false
);
create index sms_log_at on sms_log (at);

-- ElevenLabs spend per conversation or test run (deno task cost). Survives demo resets.
create table cost_ledger (
  id text primary key,
  agent_key text,
  kind text not null check (kind in ('call', 'test', 'browser')),
  phase text not null,
  at timestamptz not null,
  seconds int,
  credits int not null,
  llm_usd numeric,
  platform_usd numeric
);

do $$
declare t text;
begin
  foreach t in array array['state_events', 'refunds', 'confirmations', 'session_flags', 'sms_log',
    'cost_ledger']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Status history from the tables that carry a citizen and a status (or are created once).
-- Refunds are written by the backend with their reason and rule id instead.
create or replace function log_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  status text := coalesce(n ->> 'status', 'created');
begin
  if tg_op = 'UPDATE' and (o ->> 'status') is not distinct from (n ->> 'status') then
    return new;
  end if;
  insert into state_events (citizen_id, conversation_id, entity_type, entity_id, from_status,
    to_status)
  values (n ->> 'citizen_id', n ->> 'conversation_id', tg_table_name,
    coalesce(n ->> 'ref', n ->> 'permit_no', n ->> 'card_no', n ->> 'id'),
    o ->> 'status', status);
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['payments', 'id_cards', 'county_permits', 'id_applications',
    'tax_exemption_applications']
  loop
    execute format('create trigger %I after insert or update on %I for each row execute function log_status()',
      t || '_log_status', t);
  end loop;
end $$;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    state_events, refunds, confirmations, session_flags,
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
