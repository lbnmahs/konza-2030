-- K6 (MED-306): the Mirror Vale Audit Office gets its own database role. It reads the columns the
-- checker needs and writes only findings, holds and its own audit events; SIA's backend (the
-- service role) can no longer open a hold, only clear one through an officer (core.clearHold).
-- The role is created without a login: on the live project Mahs runs
--   alter role mirror_vale with login password '...';
-- in the SQL editor and stores the connection string as the audit function's AUDIT_DB_URL.
-- Locally the tests and the simulator set a local-only password as the local superuser.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mirror_vale') then
    create role mirror_vale nologin noinherit;
  end if;
end $$;
grant usage on schema public to mirror_vale;

-- Every finding the checker raises, one row each. No personal data and no text: ref is a decision,
-- application or delivery id. Append-only, never truncated (demo_truncate leaves it alone).
create table konza_findings (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  at timestamptz not null default now(),
  "check" text not null check ("check" ~ '^C[0-9]{1,2}$'),
  code text not null check (length(code) <= 60),
  severity text not null check (severity in ('hold', 'report', 'info')),
  agency text check (length(agency) <= 40),
  service text check (length(service) <= 60),
  rule_ids text[] not null default '{}',
  ref text check (length(ref) <= 80)
);
create index konza_findings_at on konza_findings (at);
create trigger konza_findings_append_only before update or delete on konza_findings
  for each row execute function deny_change();
create function konza_findings_no_truncate() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'findings are never deleted';
end $$;
create trigger konza_findings_no_truncate before truncate on konza_findings
  for each statement execute function konza_findings_no_truncate();
revoke execute on function konza_findings_no_truncate() from public, anon, authenticated;
alter table konza_findings enable row level security;
revoke all on konza_findings from anon, authenticated;

-- Reads: only the columns audit/snapshot.ts selects (no code hashes, full names or addresses;
-- application fields, decision inputs and reasons can hold a business name or a child's first name).
grant select (id, ref, agency, service, applicant_citizen_id, subject_citizen_id, consent_id,
  fields, session, created_at) on konza_applications to mirror_vale;
grant select (id, application_id, outcome, decided_by, rule_ids, reason_en, inputs, decided_at,
  created_at) on konza_decisions to mirror_vale;
grant select (id, grantor_citizen_id, delegate, subject_citizen_id, scopes, expires_at,
  withdrawn_at, session, created_at) on delegation_consents to mirror_vale;
grant select (id, item_ref, deliver_on, fee_kes, session, created_at) on deliveries to mirror_vale;
grant select (id, case_ref, amount, status, method, created_at) on payments to mirror_vale;
grant select (id, application_id, created_at) on konza_appointments to mirror_vale;
grant select (id, decision_id, session, created_at) on konza_appeals to mirror_vale;
grant select (id, conversation_id, tool, created_at, committed_at) on confirmations to mirror_vale;
grant select (session, operation, outcome, agency, at) on konza_audit_events to mirror_vale;
grant select (id, dob) on citizens to mirror_vale;
grant select (citizen_id, expires) on passports to mirror_vale;
grant select (citizen_id, zone) on addresses to mirror_vale;
grant select (guardian_citizen_id, child_citizen_id) on guardianships to mirror_vale;
grant select (id, zone, capacity) on schools to mirror_vale;
grant select (id, agency, service, rule_id, opened_at, cleared_at) on konza_holds to mirror_vale;
grant select (id, run_id, at, "check", code, severity, agency, service, rule_ids, ref)
  on konza_findings to mirror_vale;

do $$
declare t text;
begin
  foreach t in array array['konza_applications', 'konza_decisions', 'delegation_consents',
    'deliveries', 'payments', 'konza_appointments', 'konza_appeals', 'confirmations',
    'konza_audit_events', 'citizens', 'passports', 'addresses', 'guardianships', 'schools',
    'konza_holds', 'konza_findings']
  loop
    execute format('create policy mirror_vale_read on %I for select to mirror_vale using (true)', t);
  end loop;
end $$;

-- Writes: findings, holds it opens, and its own audit events. Nothing else.
grant insert (run_id, "check", code, severity, agency, service, rule_ids, ref)
  on konza_findings to mirror_vale;
create policy mirror_vale_write on konza_findings for insert to mirror_vale with check (true);
grant insert (agency, service, rule_id, finding, opened_by) on konza_holds to mirror_vale;
create policy mirror_vale_open on konza_holds for insert to mirror_vale
  with check (opened_by = 'mirror_vale' and cleared_at is null);
grant insert (request_id, client, agency, operation, charter, outcome, reason)
  on konza_audit_events to mirror_vale;
create policy mirror_vale_events on konza_audit_events for insert to mirror_vale
  with check (client = 'mirror_vale');
grant usage on sequence konza_audit_events_id_seq, konza_findings_id_seq to mirror_vale;

-- Only the Audit Office opens holds now; the service role keeps reading and clearing them.
revoke insert on konza_holds from service_role;
-- Findings are the Audit Office's alone: SIA's backend may read them, never write them.
revoke insert, update, delete, truncate on konza_findings from service_role;
