-- K2 (MED-264): Konza API profile core. Resident numbers and addresses, delegated consent,
-- applications with decisions (never decided by the assistant), appeals, deliveries,
-- append-only audit events. RLS on, no grants to anon or authenticated (default privileges).

alter table citizens add column resident_number text unique
  check (resident_number ~ '^QK-[0-9]{4}-[0-9]{4}$');

create table addresses (
  id uuid primary key default gen_random_uuid(),
  citizen_id text not null unique references citizens (id) on delete cascade,
  zone int not null check (zone between 1 and 9),
  block text not null check (block ~ '^[A-Z][0-9]{2}$'),
  plot int not null check (plot between 1 and 999),
  unit int not null check (unit between 1 and 99),
  check_code text not null check (check_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  verified_at timestamptz
);

-- Who is a child's parent or guardian (AR-03, registered with evidence by the residents registry).
create table guardianships (
  guardian_citizen_id text not null references citizens (id) on delete cascade,
  child_citizen_id text not null references citizens (id) on delete cascade,
  evidence text not null,
  primary key (guardian_citizen_id, child_citizen_id),
  check (guardian_citizen_id <> child_citizen_id)
);

create table delegation_consents (
  id uuid primary key default gen_random_uuid(),
  grantor_citizen_id text not null references citizens (id) on delete cascade,
  delegate text not null,
  subject_citizen_id text not null references citizens (id) on delete cascade,
  scopes text[] not null check (cardinality(scopes) > 0),
  evidence text,
  expires_at timestamptz not null,
  withdrawn_at timestamptz,
  session text,
  created_at timestamptz not null default now(),
  check (grantor_citizen_id <> subject_citizen_id)
);
create index delegation_consents_subject on delegation_consents (subject_citizen_id);

create table konza_applications (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  agency text not null,
  service text not null,
  applicant_citizen_id text not null references citizens (id) on delete cascade,
  subject_citizen_id text not null references citizens (id) on delete cascade,
  consent_id uuid references delegation_consents (id),
  fields jsonb not null,
  status text not null default 'submitted' check (status in ('submitted', 'decided')),
  session text,
  created_at timestamptz not null default now(),
  check (consent_id is not null or applicant_citizen_id = subject_citizen_id)
);
create index konza_applications_subject on konza_applications (subject_citizen_id);

-- decided_by is a rule or an officer, never the assistant; adverse outcomes only by an officer.
create table konza_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references konza_applications (id) on delete cascade,
  outcome text not null
    check (outcome in ('granted', 'pending_officer', 'refused', 'offered_alternative')),
  decided_by text check (decided_by in ('rule', 'officer')),
  rule_ids text[] not null default '{}',
  reason_en text not null,
  reason_sw text,
  inputs jsonb not null default '{}',
  next_en text,
  officer text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((outcome = 'pending_officer') = (decided_by is null)),
  check (outcome not in ('refused', 'offered_alternative') or decided_by = 'officer'),
  check ((decided_by = 'officer') = (officer is not null))
);

-- A decided decision never changes; a pending one may only be decided once, by an officer.
create function konza_decision_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'decisions are never deleted';
  end if;
  if old.decided_by is not null then
    raise exception 'decision % is already decided', old.id;
  end if;
  if new.decided_by is distinct from 'officer' then
    raise exception 'a pending decision can only be decided by an officer';
  end if;
  if new.application_id <> old.application_id or new.inputs is distinct from old.inputs
    or new.rule_ids is distinct from old.rule_ids or new.created_at <> old.created_at then
    raise exception 'an officer decides the outcome and reason only';
  end if;
  return new;
end $$;
create trigger konza_decisions_guard before update or delete on konza_decisions
  for each row execute function konza_decision_guard();

create table konza_appeals (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references konza_decisions (id) on delete cascade,
  citizen_id text not null references citizens (id) on delete cascade,
  grounds text not null check (length(grounds) <= 1000),
  status text not null default 'received' check (status in ('received', 'upheld', 'changed')),
  answer_by date not null,
  session text,
  created_at timestamptz not null default now()
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  citizen_id text not null references citizens (id) on delete cascade,
  address_id uuid not null references addresses (id),
  item_kind text not null check (item_kind in ('passport', 'resident_card', 'certificate')),
  item_ref text not null,
  deliver_on date not null,
  "window" text not null check ("window" in ('morning', 'afternoon')),
  fee_kes int not null,
  status text not null default 'booked' check (status in ('booked', 'delivered', 'cancelled')),
  handover_code_hash text not null,
  session text,
  created_at timestamptz not null default now(),
  unique (item_kind, item_ref)
);

create table konza_audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  request_id text not null,
  client text not null,
  session text,
  resident text,
  on_behalf_of text,
  agency text,
  operation text not null,
  charter text not null check (charter in ('acts_alone', 'asks_first', 'never_acts')),
  outcome text not null,
  reason text,
  request_hash text
);
create index konza_audit_events_at on konza_audit_events (at);

-- Append-only logs (charter section 4.7): no UPDATE or DELETE, for any role. The demo reset
-- (demo_truncate) still empties them, since TRUNCATE does not fire row triggers.
create function deny_change() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function deny_change();
create trigger konza_audit_events_append_only before update or delete on konza_audit_events
  for each row execute function deny_change();

do $$
declare t text;
begin
  foreach t in array array['addresses', 'guardianships', 'delegation_consents', 'konza_applications',
    'konza_decisions', 'konza_appeals', 'deliveries', 'konza_audit_events']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create trigger konza_applications_log_status after insert or update on konza_applications
  for each row execute function log_status();
create trigger deliveries_log_status after insert or update on deliveries
  for each row execute function log_status();

revoke execute on function konza_decision_guard(), deny_change() from public, anon, authenticated;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    state_events, refunds, confirmations, session_flags,
    handset_tokens, handset_inbox,
    passport_applications, passports, calendar_items,
    partner_referrals, partners, adjustments,
    disability_registrations, tax_exemption_applications,
    county_permits, county_markets,
    uploads, registry_bookings, registry_slots, registry_offices,
    id_applications, id_losses, id_cards,
    health_cover_confirmations, health_dependants, health_contributions, health_members,
    konza_audit_events, deliveries, konza_appeals, konza_decisions, konza_applications,
    delegation_consents, guardianships, addresses,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
