-- K6 close (security review Low): SIA's backend keeps only the rights it uses on the audit tables.
-- Row and truncate triggers already refuse changes; grants no longer rely on them. demo_truncate
-- is security definer and keeps emptying the audit log for a demo reset.

-- Findings: the Audit Office writes them; SIA's backend may only read them.
revoke all on konza_findings from service_role;
grant select on konza_findings to service_role;

-- Holds: the Audit Office opens them; SIA's backend reads them and an officer clears them.
revoke all on konza_holds from service_role;
grant select, update on konza_holds to service_role;

-- The audit log: SIA's backend appends and reads, nothing else.
revoke all on konza_audit_events from service_role;
grant select, insert on konza_audit_events to service_role;
