-- Operational companion; open only after independent review and closed readback.
-- Eligible existing operators are included; this is not a synthetic-only gate.
DO $open_preflight$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='structr_scope_workspace_read_owner_v1'
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='structr_scope_workspace_read_owner_v1'::regrole
      AND member=current_user::regrole AND grantor=current_user::regrole)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles api CROSS JOIN pg_catalog.pg_roles reachable
      WHERE api.rolname IN ('anon','authenticated','authenticator')
        AND (reachable.oid=api.oid OR pg_catalog.pg_has_role(api.oid,reachable.oid,'USAGE') OR pg_catalog.pg_has_role(api.oid,reachable.oid,'SET'))
        AND (pg_catalog.has_function_privilege(reachable.oid,'public.structr_scope_workspace_read_v1(jsonb)','EXECUTE')
          OR pg_catalog.has_function_privilege(reachable.oid,'structr_private.scope_workspace_read_v1(jsonb)','EXECUTE'))) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_OPEN_REFUSED' USING ERRCODE='42501'; END IF;
END;
$open_preflight$;
GRANT structr_scope_workspace_read_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
DO $open_body$
DECLARE migrator name:=current_user;
BEGIN
  SET LOCAL ROLE structr_scope_workspace_read_owner_v1;
  GRANT EXECUTE ON FUNCTION structr_private.scope_workspace_read_v1(jsonb) TO authenticated;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',migrator);
END;
$open_body$;
REVOKE structr_scope_workspace_read_owner_v1 FROM CURRENT_USER;
GRANT EXECUTE ON FUNCTION public.structr_scope_workspace_read_v1(jsonb) TO authenticated;
DO $open_postflight$
BEGIN
  IF NOT pg_catalog.has_function_privilege('authenticated','public.structr_scope_workspace_read_v1(jsonb)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated','structr_private.scope_workspace_read_v1(jsonb)','EXECUTE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator') AND
      (pg_catalog.pg_has_role(oid,'structr_scope_workspace_read_owner_v1','USAGE') OR pg_catalog.pg_has_role(oid,'structr_scope_workspace_read_owner_v1','SET')
        OR pg_catalog.has_schema_privilege(oid,'structr_private','USAGE,CREATE')))
    OR (NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AND
      (pg_catalog.pg_has_role(current_user,'structr_scope_workspace_read_owner_v1','USAGE') OR pg_catalog.pg_has_role(current_user,'structr_scope_workspace_read_owner_v1','SET'))) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_OPEN_REFUSED' USING ERRCODE='42501'; END IF;
END;
$open_postflight$;
NOTIFY pgrst, 'reload schema';
