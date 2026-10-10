-- Operational companion: run in the installation transaction, and after proof.
-- Admission control only; never changes a business row or prior IF-1 grants.
DO $membership_preflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='structr_scope_workspace_read_owner_v1'::regrole
      AND member=current_user::regrole AND grantor=current_user::regrole) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_CLOSE_REFUSED' USING ERRCODE='42501'; END IF;
END;
$membership_preflight$;
GRANT structr_scope_workspace_read_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
DO $close_body$
DECLARE migrator name:=current_user;
BEGIN
  SET LOCAL ROLE structr_scope_workspace_read_owner_v1;
  REVOKE EXECUTE ON FUNCTION structr_private.scope_workspace_read_v1(jsonb) FROM authenticated;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',migrator);
END;
$close_body$;
REVOKE structr_scope_workspace_read_owner_v1 FROM CURRENT_USER;
REVOKE EXECUTE ON FUNCTION public.structr_scope_workspace_read_v1(jsonb) FROM authenticated;
DO $closed_postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles api CROSS JOIN pg_catalog.pg_roles reachable
    WHERE api.rolname IN ('anon','authenticated','authenticator')
      AND (reachable.oid=api.oid OR pg_catalog.pg_has_role(api.oid,reachable.oid,'USAGE') OR pg_catalog.pg_has_role(api.oid,reachable.oid,'SET'))
      AND (pg_catalog.has_function_privilege(reachable.oid,'public.structr_scope_workspace_read_v1(jsonb)','EXECUTE')
        OR pg_catalog.has_function_privilege(reachable.oid,'structr_private.scope_workspace_read_v1(jsonb)','EXECUTE')))
    OR (NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AND
      (pg_catalog.pg_has_role(current_user,'structr_scope_workspace_read_owner_v1','USAGE') OR pg_catalog.pg_has_role(current_user,'structr_scope_workspace_read_owner_v1','SET'))) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_CLOSE_REFUSED' USING ERRCODE='42501'; END IF;
END;
$closed_postflight$;
NOTIFY pgrst, 'reload schema';
