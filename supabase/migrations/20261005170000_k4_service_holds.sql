-- K4 (MED-272): the circuit breaker. When the Mirror Vale Audit Office's checker flags a rule,
-- it opens a hold on (agency, service, rule id); while any hold on a service is open, the core
-- turns every rule grant of that service into pending_officer. An officer clears the hold. Holds are never deleted, and
-- an open hold changes only once, when it is cleared. RLS on, no grants to anon or authenticated.

create table konza_holds (
  id uuid primary key default gen_random_uuid(),
  agency text not null,
  service text not null,
  -- A rule id, or * for the whole service (a flagged rule with a malformed id).
  rule_id text not null check (rule_id ~ '^([A-Z]{2}-[0-9]{2}|\*)$'),
  finding text not null check (length(finding) <= 200),
  opened_by text not null check (length(opened_by) <= 40),
  opened_at timestamptz not null default now(),
  cleared_by text check (length(cleared_by) <= 40),
  cleared_at timestamptz,
  check ((cleared_at is null) = (cleared_by is null))
);
-- One open hold per rule at a time.
create unique index konza_holds_open on konza_holds (agency, service, rule_id)
  where cleared_at is null;

create function konza_hold_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'holds are never deleted';
  end if;
  if old.cleared_at is not null then
    raise exception 'hold % is already cleared', old.id;
  end if;
  if new.cleared_at is null or new.id <> old.id or new.agency <> old.agency
    or new.service <> old.service
    or new.rule_id <> old.rule_id or new.finding <> old.finding
    or new.opened_by <> old.opened_by or new.opened_at <> old.opened_at then
    raise exception 'an open hold can only be cleared';
  end if;
  return new;
end $$;
create trigger konza_holds_guard before update or delete on konza_holds
  for each row execute function konza_hold_guard();
-- TRUNCATE skips row triggers, so it is refused separately; demo_truncate leaves holds alone.
create function konza_hold_no_truncate() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'holds are never deleted';
end $$;
create trigger konza_holds_no_truncate before truncate on konza_holds
  for each statement execute function konza_hold_no_truncate();
revoke execute on function konza_hold_guard(), konza_hold_no_truncate()
  from public, anon, authenticated;
-- Until the Audit Office has its own database role (K6), only server code with the service role
-- can write holds: the checker opens them, an officer clears them (core.clearHold).

-- Undo a place taken by a grant whose decision could not be stored (MED-280).
create function release_school_place(school text) returns boolean
language sql set search_path = public as $$
  with t as (
    update schools set places_taken = places_taken - 1
    where id = school and places_taken > 0 returning id
  )
  select exists (select 1 from t);
$$;
revoke execute on function release_school_place(text) from public, anon, authenticated;
grant execute on function release_school_place(text) to service_role;

alter table konza_holds enable row level security;

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
    delegation_consents, guardianships, addresses, schools,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
