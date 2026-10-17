-- K8 S2 (MED-330, plan-k8 2.2, 2.4, 2.5): screen events and taps.
--
-- ui_events: what the resident app shows, emitted by the backend only (never the model), one
-- sequence per conversation, append-only. No grants for anon or authenticated: the app reads them
-- through the server with the resident-session cookie. Wiped by demo_truncate with every take.

create table ui_events (
  id bigint generated always as identity primary key,
  conversation_id text not null,
  seq integer not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);
revoke all on ui_events from anon, authenticated;
revoke update, delete, truncate on ui_events from service_role;

-- The next event in a conversation, numbered under a per-conversation lock (two tools finishing
-- together never share a seq). Returns the stored event's seq and time.
create or replace function ui_event_append(p_conversation_id text, p_kind text, p_payload jsonb)
returns table (seq integer, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('ui_events:' || p_conversation_id));
  return query
  insert into ui_events (conversation_id, seq, kind, payload)
  values (
    p_conversation_id,
    coalesce((select max(e.seq) from ui_events e where e.conversation_id = p_conversation_id), 0) + 1,
    p_kind,
    p_payload
  )
  returning ui_events.seq, ui_events.created_at;
end;
$$;
revoke execute on function ui_event_append(text, text, jsonb) from public, anon, authenticated;

-- Confirmations shown on a screen: the tool and the arguments a tap commits (never re-typed by
-- the browser), the hash of exactly what was shown, which channel said yes first, and the stored
-- result a later commit of the same confirmation gets back instead of a refusal.
alter table confirmations
  add column ui_tool text,
  add column args jsonb,
  add column shown_hash text,
  add column committed_via text check (committed_via in ('voice', 'screen')),
  add column result jsonb;

-- The resident session's CSRF token (hash only), issued at bind, required on every tap.
alter table handset_tokens add column csrf_hash text;

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
    citizens restart identity cascade;
$$;
revoke execute on function demo_truncate() from public, anon, authenticated;
