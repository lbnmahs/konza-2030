-- K0 review fix (MED-247): EXECUTE on new functions is a global default for PUBLIC, which a
-- per-schema statement cannot revoke. New functions are not callable through /rpc unless a
-- migration grants it.
alter default privileges revoke execute on functions from public;
