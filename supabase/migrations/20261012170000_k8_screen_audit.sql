-- K8 S2 (MED-331, plan-k8 2.5.4 and 2.5.5): the checker's C10 compares each screen commit's
-- arguments hash with the hash recorded when its card was shown. Those rows carry the confirmation
-- id in request_id and the hash in request_hash, so the Audit Office may read those two columns
-- too (it still reads no free text, and still only konza_audit_events, never the core's tables).
grant select (request_id, request_hash) on konza_audit_events to mirror_vale;
