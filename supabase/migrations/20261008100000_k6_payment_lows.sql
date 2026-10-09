-- K6 (MED-311, the MED-296 lows): the panel reads payments without the phone-code hash, and a
-- wrong phone code is counted in one statement, so two wrong codes at once count twice.

revoke select on payments from authenticated;
grant select (id, conversation_id, citizen_id, permit_id, amount, currency, reference, status,
  txn_code, created_at, authority, payee, description, case_ref, method, code_tries,
  code_expires_at, desk, recorded_by) on payments to authenticated;

-- One wrong code on a pending payment: adds a try and declines it at the limit. Returns the new
-- count and status, or nothing when the payment is no longer pending.
create function payment_wrong_code(payment uuid, max_tries int)
returns table (code_tries int, status text)
language sql set search_path = public as $$
  update payments p
  set code_tries = p.code_tries + 1,
      status = case when p.code_tries + 1 >= max_tries then 'declined' else p.status end
  where p.id = payment and p.status = 'pending'
  returning p.code_tries, p.status;
$$;
revoke execute on function payment_wrong_code(uuid, int) from public, anon, authenticated;
grant execute on function payment_wrong_code(uuid, int) to service_role;
