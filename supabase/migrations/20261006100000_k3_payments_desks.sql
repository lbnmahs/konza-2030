-- K3 (MED-282, MED-294; world.md PY-01, PY-02, DK-01, DK-02): paying with a phone code or at a
-- desk, paper documents recorded at Lango Square, and collection at a desk without an address.

-- PY-01 and PY-02: how a payment was made; a phone-code payment keeps only the code's hash.
alter table payments
  add column method text not null default 'pesa' check (method in ('pesa', 'phone_code', 'desk')),
  add column code_hash text,
  add column code_tries int not null default 0 check (code_tries between 0 and 3),
  add column code_expires_at timestamptz,
  add column desk text,
  add column recorded_by text check (length(recorded_by) <= 40),
  add constraint payments_phone_code check (method <> 'phone_code' or code_hash is not null),
  add constraint payments_desk check (
    (method = 'desk') = (desk is not null and recorded_by is not null)
  );

-- MED-296: a Konza fee is paid once. One approved payment per reference for the Konza agencies
-- (the KE agent's legacy payments are left as they were).
create unique index payments_konza_paid_once on payments (case_ref)
  where status = 'approved' and authority in ('sps', 'siln', 'srr', 'sca', 'sco');

-- DK-01: an officer records a paper document handed in at a desk; nothing is scanned or kept.
create table desk_documents (
  id uuid primary key default gen_random_uuid(),
  citizen_id text not null references citizens (id) on delete cascade,
  presented_by text not null references citizens (id) on delete cascade,
  doc_type text not null
    check (doc_type in ('tenancy', 'employer_letter', 'birth_certificate', 'immunisation_card')),
  result text not null check (result in ('accepted', 'rejected')),
  desk text not null check (desk in ('lango_square', 'konza_passport_desk')),
  officer text not null check (length(officer) <= 40),
  created_at timestamptz not null default now()
);
create index desk_documents_citizen on desk_documents (citizen_id);
alter table desk_documents enable row level security;

-- DK-02: collection at a desk needs no address; home delivery still does (AD-02).
alter table deliveries
  add column method text not null default 'home' check (method in ('home', 'collect')),
  add column desk text check (desk in ('lango_square', 'konza_passport_desk')),
  alter column address_id drop not null,
  add constraint deliveries_method check (
    (method = 'home' and address_id is not null and desk is null)
    or (method = 'collect' and desk is not null)
  );

-- PP-03 (MED-284): an in-person appointment a granted application needs (biometrics at the Konza
-- Passport Desk), booked by the holder after the fee is paid.
create table konza_appointments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references konza_applications (id) on delete cascade,
  citizen_id text not null references citizens (id) on delete cascade,
  kind text not null check (kind in ('biometrics')),
  desk text not null check (desk in ('lango_square', 'konza_passport_desk')),
  on_date date not null,
  "window" text not null check ("window" in ('morning', 'afternoon')),
  session text,
  created_at timestamptz not null default now(),
  unique (application_id, kind)
);
alter table konza_appointments enable row level security;

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
    delegation_consents, guardianships, addresses, schools, desk_documents, konza_appointments,
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
