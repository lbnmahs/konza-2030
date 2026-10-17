-- K8 S4 (MED-332, plan-k8 2.10 revised 13 Oct; world.md PY-03): on a screen a fee is paid with a
-- method the demo resident already holds, a debit or credit card or mobile money. Nothing is
-- charged. A card is approved with a code texted to the phone; mobile money with the resident's
-- PIN, typed on the payment card. Masked details only, never a card number, expiry or CVV; the
-- fictional demo PIN is kept only as a hash. Seeded per demo resident, wiped by demo_truncate.

create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  citizen_id text not null references citizens (id) on delete cascade,
  type text not null check (type in ('card', 'mobile_money')),
  -- "•••• 4242" or "07•• ••• 512": what the card shows, nothing more.
  masked text not null check (masked ~ '^[0-9• ]{4,16}$'),
  pin_hash text,
  constraint payment_methods_pin check ((type = 'mobile_money') = (pin_hash is not null))
);
create index payment_methods_citizen on payment_methods (citizen_id);
revoke all on payment_methods from anon, authenticated;

-- screen: waiting for the resident's choice; screen_card: a code was texted (code_hash set);
-- screen_mobile: waiting for the PIN. The method row is kept, never its masked number in logs.
alter table payments drop constraint payments_method_check;
alter table payments
  add constraint payments_method_check
    check (method in ('pesa', 'phone_code', 'desk', 'screen', 'screen_card', 'screen_mobile')),
  add column method_id uuid references payment_methods (id) on delete set null,
  add constraint payments_screen_card check (method <> 'screen_card' or code_hash is not null);

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
    konza_audit_events, deliveries, konza_appeals, konza_decisions, konza_applications,
    delegation_consents, guardianships, addresses, schools, desk_documents, konza_appointments,
    payment_methods,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
