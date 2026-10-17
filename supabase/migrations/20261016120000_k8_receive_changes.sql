-- K8 (MED-332, plan-k8 2.11; world.md AD-07): the resident may change home delivery or collection
-- while nothing is paid on the application. Decisions are append-only and stay as they are; each
-- change is its own row, the newest is the choice in force, and the charge and delivery_book read
-- it. Append-only like audit_log. No grants for anon or authenticated; the checker (mirror_vale)
-- reads ids, sessions and times only (C3, C7).

create table konza_receive_changes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references konza_applications (id) on delete cascade,
  from_receive text not null check (from_receive in ('home', 'collect')),
  to_receive text not null check (to_receive in ('home', 'collect')),
  delivery_kes integer not null check (delivery_kes in (0, 200)),
  rule_ids text[] not null default '{}',
  session text,
  created_at timestamptz not null default now(),
  constraint konza_receive_changes_differ check (from_receive <> to_receive)
);
create index konza_receive_changes_app on konza_receive_changes (application_id, created_at desc);
revoke all on konza_receive_changes from anon, authenticated;
revoke update, delete, truncate on konza_receive_changes from service_role;
grant select (id, application_id, session, created_at) on konza_receive_changes to mirror_vale;

create or replace function demo_truncate() returns void
language sql security definer set search_path = public as $$
  truncate audit_log, messages, payments, cases, verifications, conversations,
    state_events, refunds, confirmations, session_flags,
    handset_tokens, handset_inbox, ui_events,
    passport_applications, passports, calendar_items,
    partner_referrals, partners, adjustments,
    disability_registrations, tax_exemption_applications,
    county_permits, county_markets,
    uploads, registry_bookings, registry_slots, registry_offices,
    id_applications, id_losses, id_cards,
    health_cover_confirmations, health_dependants, health_contributions, health_members,
    konza_audit_events, deliveries, konza_receive_changes, konza_appeals, konza_decisions,
    konza_applications,
    delegation_consents, guardianships, addresses, schools, desk_documents, konza_appointments,
    payment_methods,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
