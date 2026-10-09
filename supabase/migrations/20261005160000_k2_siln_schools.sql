-- K2 gate (MED-266): data for the Savanahlands Institute of Learning and Nurturing, the second
-- agency behind the Konza API profile.

create table schools (
  id text primary key,
  name text not null,
  zone int not null check (zone between 1 and 9),
  capacity int not null check (capacity >= 0),
  places_taken int not null default 0 check (places_taken >= 0)
);

alter table schools enable row level security;

-- Take one place, only while there is room (no overbooking under concurrent grants).
create function take_school_place(school text) returns boolean
language sql set search_path = public as $$
  with t as (
    update schools set places_taken = places_taken + 1
    where id = school and places_taken < capacity returning id
  )
  select exists (select 1 from t);
$$;
revoke execute on function take_school_place(text) from public, anon, authenticated;
grant execute on function take_school_place(text) to service_role;

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
