-- P15: Kenyan passport on NJIA, the Germany agent (BZL), calendar links, draft sharing and the
-- email log. All data is fictional. Service role only (RLS on, no policies).

-- Germany joins the countries; the visa fee is quoted in euros.
alter table authorities drop constraint authorities_country_check;
alter table authorities add constraint authorities_country_check
  check (country in ('GB', 'KE', 'AE', 'DE'));
alter table authorities drop constraint authorities_currency_check;
alter table authorities add constraint authorities_currency_check
  check (currency in ('GBP', 'KES', 'AED', 'EUR'));

-- A country agent call can hold several bookings (one per case), e.g. a GP appointment and
-- visa biometrics; single-scenario agents had one booking per call.
alter table registry_bookings drop constraint registry_bookings_conversation_id_key;
alter table registry_bookings add constraint registry_bookings_conversation_case_key
  unique (conversation_id, case_ref);

-- Passports (Njema Passport Service, fictional).
create table passports (
  id text primary key,
  citizen_id text not null references citizens (id) on delete cascade,
  number text not null unique,
  pages int not null,
  expires date not null,
  status text not null default 'active' check (status in ('active', 'replaced', 'cancelled'))
);

create table passport_applications (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  conversation_id text not null,
  citizen_id text not null references citizens (id) on delete cascade,
  passport_id text references passports (id) on delete set null,
  authority text not null,
  pages int not null,
  fee numeric not null,
  desk_area text not null check (desk_area in ('Nairobi', 'London', 'Berlin')),
  status text not null default 'submitted' check (status in ('submitted', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (conversation_id, citizen_id)
);

-- Blocked accounts for the German study visa (Hainbuche Bank, fictional).
create table blocked_accounts (
  id text primary key,
  citizen_id text not null references citizens (id) on delete cascade,
  bank text not null,
  balance_eur numeric not null,
  monthly_release_eur numeric not null,
  opened_on date not null,
  status text not null check (status in ('pending_deposit', 'funded'))
);

-- Calendar links: one per booking, opened from the SMS at /c/<id> (ICS, Google, Outlook).
create table calendar_items (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  authority text not null,
  ref text not null,
  title text not null,
  local_start text not null, -- YYYY-MM-DDTHH:MM in the timezone below
  timezone text not null,
  duration_min int not null default 30,
  location text not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, ref)
);

-- Draft sharing: a link alone grants nothing; the recipient signs in with an email code.
create table draft_shares (
  id uuid primary key default gen_random_uuid(),
  draft_kind text not null check (draft_kind in ('child_benefit', 'blue_badge')),
  draft_ref text not null,
  email text not null,
  role text not null default 'viewer' check (role in ('viewer')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index draft_shares_email on draft_shares (email);

create table draft_views (
  id bigint generated always as identity primary key,
  draft_ref text not null,
  viewer_email_hash text not null,
  shared boolean not null,
  at timestamptz not null default now()
);

-- Every email sent (no address in clear), for the daily and per-recipient caps. Not wiped by
-- demo resets.
create table email_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  to_hash text not null,
  kind text not null,
  ref text,
  dry_run boolean not null default false
);
create index email_log_at on email_log (at);

do $$
declare t text;
begin
  foreach t in array array['passports', 'passport_applications', 'blocked_accounts',
    'calendar_items', 'draft_shares', 'draft_views', 'email_log']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create trigger passports_log_status after insert or update on passports
  for each row execute function log_status();
create trigger passport_applications_log_status after insert or update on passport_applications
  for each row execute function log_status();

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    state_events, refunds, confirmations, session_flags, gp_registrations,
    handset_tokens, handset_inbox,
    passport_applications, passports, blocked_accounts, calendar_items, draft_shares,
    draft_views,
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

-- Panel tables only for panel users (role in app_metadata, set by the web app at sign-in):
-- people a draft was shared with also sign in, and must see nothing but their draft.
drop policy "panel users read audit_log" on audit_log;
drop policy "panel users read conversations" on conversations;
drop policy "panel users read payments" on payments;
drop policy "panel users read authorities" on authorities;
create policy "panel role reads audit_log" on audit_log for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'panel');
create policy "panel role reads conversations" on conversations for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'panel');
create policy "panel role reads payments" on payments for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'panel');
create policy "panel role reads authorities" on authorities for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'panel');
