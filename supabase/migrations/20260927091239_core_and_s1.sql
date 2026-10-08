-- Core tables shared by every scenario, plus Scenario 1 (Northfield Borough Council).
-- All data is fictional. The browser reads only audit_log and conversations (select via RLS);
-- everything else is service role only (edge function and scripts).

create table demo_agents (
  agent_id text primary key,
  scenario text not null,
  authority text not null,
  authority_name text not null,
  language text not null
);

create table citizens (
  id text primary key,
  full_name text not null,
  dob date not null,
  id_number text not null,
  phone text not null,
  preferred_language text,
  authority text not null
);

create table conversations (
  id text primary key, -- ElevenLabs conversation_id
  agent_id text,
  authority text not null,
  language text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_secs int,
  verified_at timestamptz,
  citizen_id text references citizens (id) on delete set null
);

create table verifications (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  citizen_id text not null references citizens (id) on delete cascade,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  conversation_id text,
  authority text,
  actor text not null check (actor in ('Call', 'Identity', 'Service', 'Rules', 'Payment', 'Follow-up', 'Escalation', 'Language')),
  action text not null,
  data_used text,
  result text not null default 'ok' check (result in ('ok', 'warn', 'error')),
  rule_ids text[] not null default '{}'
);
create index audit_log_conversation_ts on audit_log (conversation_id, ts);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  citizen_id text references citizens (id) on delete set null,
  template text not null,
  body text not null,
  twilio_sid text,
  status text not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, template)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  citizen_id text references citizens (id) on delete set null,
  permit_id text not null,
  amount numeric not null,
  currency text not null,
  reference text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'expired')),
  txn_code text,
  created_at timestamptz not null default now()
);

create table cases (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  type text not null,
  priority text not null check (priority in ('routine', 'urgent')),
  summary text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  unique (conversation_id, type)
);

-- Scenario 1

create table council_properties (
  id text primary key,
  address text not null,
  postcode text not null,
  house text not null,
  collection_day text not null
);

create table council_collections (
  id bigint generated always as identity primary key,
  property_id text not null references council_properties (id) on delete cascade,
  bin_type text not null check (bin_type in ('general', 'recycling', 'garden', 'food')),
  scheduled date not null,
  status text not null check (status in ('scheduled', 'completed', 'missed')),
  crew_code text,
  crew_note text
);

create table council_missed_reports (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  property_id text not null references council_properties (id) on delete cascade,
  bin_type text not null,
  missed_date date not null,
  return_date date not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, property_id, bin_type, missed_date)
);

create table council_tax_accounts (
  account_no text primary key,
  citizen_id text not null references citizens (id) on delete cascade,
  property_id text not null references council_properties (id) on delete cascade,
  band text not null,
  annual_charge_gbp numeric not null,
  instalments int not null,
  instalment_gbp numeric not null,
  next_due date not null,
  balance_gbp numeric not null
);

-- RLS: on everywhere; the browser may only read the panel tables.
do $$
declare t text;
begin
  foreach t in array array['demo_agents', 'citizens', 'conversations', 'verifications', 'audit_log',
    'messages', 'payments', 'cases', 'council_properties', 'council_collections',
    'council_missed_reports', 'council_tax_accounts']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy "panel reads audit_log" on audit_log for select to anon using (true);
create policy "panel reads conversations" on conversations for select to anon using (true);

alter publication supabase_realtime add table audit_log, conversations;

-- Reset: wipes every demo table except demo_agents. Called by scripts/demo.ts with the service role.
create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    council_missed_reports, council_tax_accounts, council_collections, council_properties,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
