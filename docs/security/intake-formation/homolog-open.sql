-- Operational companion for the isolated homologation proof, not migration 0018.
-- Run transactionally only after the nominal installation, closed ACL readback,
-- reviewed preview and audited synthetic identity reactivation are verified.
-- This grants the authenticated RPC to ALL currently eligible homolog operators,
-- including the human operator. It is not a synthetic-account-only allowlist.
DO $open_preflight$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='structr_intake_create_owner_v1'
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles api CROSS JOIN pg_catalog.pg_roles reachable
      WHERE api.rolname IN ('anon','authenticated','authenticator')
        AND (reachable.oid=api.oid OR pg_catalog.pg_has_role(api.oid,reachable.oid,'USAGE')
          OR pg_catalog.pg_has_role(api.oid,reachable.oid,'SET'))
        AND (pg_catalog.has_function_privilege(reachable.oid,'public.structr_intake_create_v1(text)','EXECUTE')
          OR pg_catalog.has_function_privilege(reachable.oid,'structr_private.intake_create_v1(text)','EXECUTE'))) THEN
    RAISE EXCEPTION 'HOMOLOG_INTAKE_OPEN_REFUSED' USING ERRCODE='42501';
  END IF;
END;
$open_preflight$;
GRANT structr_intake_create_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
DO $open_body$
DECLARE migrator name:=current_user;
BEGIN
  SET LOCAL ROLE structr_intake_create_owner_v1;
  GRANT EXECUTE ON FUNCTION structr_private.intake_create_v1(text) TO authenticated;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',migrator);
END;
$open_body$;
REVOKE structr_intake_create_owner_v1 FROM CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.structr_intake_create_v1(text) TO authenticated;
DO $open_postflight$
BEGIN
  IF NOT pg_catalog.has_function_privilege('authenticated','public.structr_intake_create_v1(text)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated','structr_private.intake_create_v1(text)','EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator')
      AND (pg_catalog.pg_has_role(oid,'structr_intake_create_owner_v1','USAGE')
        OR pg_catalog.pg_has_role(oid,'structr_intake_create_owner_v1','SET')
        OR pg_catalog.has_schema_privilege(oid,'structr_private','USAGE,CREATE')))
    OR (NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user)
      AND (pg_catalog.pg_has_role(current_user,'structr_intake_create_owner_v1','USAGE')
        OR pg_catalog.pg_has_role(current_user,'structr_intake_create_owner_v1','SET'))) THEN
    RAISE EXCEPTION 'HOMOLOG_INTAKE_OPEN_REFUSED' USING ERRCODE='42501';
  END IF;
END;
$open_postflight$;
NOTIFY pgrst, 'reload schema';
