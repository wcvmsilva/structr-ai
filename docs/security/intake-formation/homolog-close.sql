-- Operational companion, not part of migration 0018 or its frozen digest.
-- Execute in the SAME transaction after the exact nominal migration to install
-- closed; execute again to close an explicitly opened homologation proof window.
-- This revokes future admission. It does not undo committed formations.
GRANT structr_intake_create_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
DO $close_body$
DECLARE migrator name:=current_user;
BEGIN
  SET LOCAL ROLE structr_intake_create_owner_v1;
  REVOKE EXECUTE ON FUNCTION structr_private.intake_create_v1(text) FROM authenticated;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',migrator);
END;
$close_body$;
REVOKE structr_intake_create_owner_v1 FROM CURRENT_USER;
REVOKE EXECUTE ON FUNCTION public.structr_intake_create_v1(text) FROM authenticated;
DO $closed_postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles api CROSS JOIN pg_catalog.pg_roles reachable
      WHERE api.rolname IN ('anon','authenticated','authenticator')
        AND (reachable.oid=api.oid OR pg_catalog.pg_has_role(api.oid,reachable.oid,'USAGE')
          OR pg_catalog.pg_has_role(api.oid,reachable.oid,'SET'))
        AND (pg_catalog.has_function_privilege(reachable.oid,'public.structr_intake_create_v1(text)','EXECUTE')
          OR pg_catalog.has_function_privilege(reachable.oid,'structr_private.intake_create_v1(text)','EXECUTE')))
    OR (NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user)
      AND (pg_catalog.pg_has_role(current_user,'structr_intake_create_owner_v1','USAGE')
        OR pg_catalog.pg_has_role(current_user,'structr_intake_create_owner_v1','SET'))) THEN
    RAISE EXCEPTION 'HOMOLOG_INTAKE_CLOSE_REFUSED' USING ERRCODE='42501';
  END IF;
END;
$closed_postflight$;
NOTIFY pgrst, 'reload schema';
