-- K3 (MED-286): an application and its decision are stored in one transaction, and a grant
-- re-reads the open holds of its service in that same transaction (MED-280 follow-up), so a
-- hold opened while a submit is in flight still applies. Called by the Konza core with the
-- service role only.

create function konza_store_decision(p_app jsonb, p_dec jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  a konza_applications;
  d konza_decisions;
  outcome text := p_dec->>'outcome';
  holds uuid[];
begin
  if outcome = 'granted' then
    select array_agg(h.id) into holds from (
      select id from konza_holds
      where agency = p_app->>'agency' and service = p_app->>'service' and cleared_at is null
      for share
    ) h;
    if holds is not null then
      outcome := 'pending_officer';
    end if;
  end if;

  insert into konza_applications (
    ref, agency, service, applicant_citizen_id, subject_citizen_id, consent_id, fields, status,
    session
  ) values (
    p_app->>'ref', p_app->>'agency', p_app->>'service', p_app->>'applicant_citizen_id',
    p_app->>'subject_citizen_id', nullif(p_app->>'consent_id', '')::uuid, p_app->'fields',
    case when outcome = 'granted' then 'decided' else 'submitted' end, p_app->>'session'
  ) returning * into a;

  insert into konza_decisions (
    application_id, outcome, decided_by, rule_ids, reason_en, reason_sw, inputs, next_en,
    decided_at
  ) values (
    a.id,
    outcome,
    case when outcome = 'granted' then 'rule' end,
    array(select jsonb_array_elements_text(p_dec->'rule_ids')),
    case when holds is null then p_dec->>'reason_en'
      else 'The rules would grant this, but they are on hold for an officer check, so an officer will decide.'
    end,
    case when holds is null then p_dec->>'reason_sw' end,
    case when holds is null then p_dec->'inputs'
      else (p_dec->'inputs') || jsonb_build_object('held_by', to_jsonb(holds))
    end,
    case when holds is null then p_dec->>'next_en' end,
    case when outcome = 'granted' then now() end
  ) returning * into d;

  return jsonb_build_object('application', to_jsonb(a), 'decision', to_jsonb(d));
end $$;
revoke execute on function konza_store_decision(jsonb, jsonb) from public, anon, authenticated;
grant execute on function konza_store_decision(jsonb, jsonb) to service_role;
