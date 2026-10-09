-- Scenario 3 (Pwani Njema County Government): markets, permits, and what /pesa needs.
-- All data is fictional.

create table county_markets (
  id text primary key,
  name text not null,
  ward text not null
);

create table county_permits (
  id text primary key,
  permit_no text not null unique,
  citizen_id text not null references citizens (id) on delete cascade,
  category text not null,
  market_id text not null references county_markets (id) on delete cascade,
  stall text not null,
  business_name text not null,
  expires date not null,
  status text not null default 'active',
  arrears_kes numeric not null default 0,
  verify_code text,
  renewed_payment_id uuid references payments (id) on delete set null
);

-- /pesa shows "<payee> requests KES <amount> for <description>" without reading other tables.
alter table payments
  add column authority text,
  add column payee text,
  add column description text;

alter table county_markets enable row level security;
alter table county_permits enable row level security;

-- /pesa reads payments live (no personal data: ids, amount, reference, status).
-- Approve and decline go through the web app's server route with the service role.
create policy "pesa reads payments" on payments for select to anon using (true);
alter publication supabase_realtime add table payments;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    council_missed_reports, council_tax_accounts, council_collections, council_properties,
    county_permits, county_markets,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
