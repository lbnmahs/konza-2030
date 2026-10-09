-- K0 cleanup (MED-247): drop the tables of the retired UK, UAE and Germany scenarios and the
-- UK-only draft sharing, and take away table grants the API roles never needed. Everything
-- dropped here is recoverable from tag v3-p15-checkpoint (migrations and seeds); the rows were
-- fictional demo data reseeded on every take.

drop table if exists
  council_tax_exemptions, pcn_challenges, pcns,
  council_missed_reports, council_tax_accounts, council_collections, council_properties,
  sight_registrations, blue_badge_drafts, benefit_drafts, life_event_plans, gp_registrations,
  biometric_bookings, biometric_slots, residency_documents, residency_applications,
  id_deliveries, newborn_cases, reminders, blocked_accounts,
  draft_views, draft_shares;

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
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;

-- Grants (finding S3). The web app reads with the service role on the server; the browser only
-- reads the four panel tables as a signed-in panel user (realtime). RLS stays on everywhere.
revoke all on all tables in schema public from anon, authenticated;
grant select on audit_log, conversations, payments, authorities to authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on function log_status() from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Panel policies read the JWT once per query, not once per row (advisor auth_rls_initplan).
alter policy "panel role reads audit_log" on audit_log
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'panel');
alter policy "panel role reads conversations" on conversations
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'panel');
alter policy "panel role reads payments" on payments
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'panel');
alter policy "panel role reads authorities" on authorities
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'panel');
