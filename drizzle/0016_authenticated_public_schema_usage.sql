-- Namespace lookup is separate from EXECUTE on the two ADR-002 public wrappers.
-- Apply atomically. No raw data access, CREATE, anon or private-schema grant.
-- 0015 remains immutable. Refuse unsafe drift; do not silently revoke it.
DO $namespace_usage$
DECLARE
  api record;
  reachable record;
  obj record;
  session_wrapper oid := pg_catalog.to_regprocedure('public.structr_authenticated_session_v1()');
  review_wrapper oid := pg_catalog.to_regprocedure('public.structr_internal_approval_review_v1(jsonb)');
BEGIN
  -- GRANT can emit only a warning for an unauthorized executor. Require real
  -- grant authority even on replay; no assumption of superuser status is needed.
  IF NOT pg_catalog.has_schema_privilege(current_user,'public','USAGE WITH GRANT OPTION') THEN
    RAISE EXCEPTION 'ADR002_NAMESPACE_EXECUTOR_PREFLIGHT' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon','authenticated','authenticator','structr_review_owner_v1')) <> 4
    OR pg_catalog.to_regnamespace('structr_private') IS NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticator'
      AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'ADR002_NAMESPACE_ROLE_PREFLIGHT' USING ERRCODE='42501';
  END IF;
  IF session_wrapper IS NULL OR review_wrapper IS NULL
    OR NOT pg_catalog.has_function_privilege('authenticated',session_wrapper,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',review_wrapper,'EXECUTE') THEN
    RAISE EXCEPTION 'ADR002_NAMESPACE_WRAPPER_PREFLIGHT' USING ERRCODE='42501';
  END IF;

  -- Effective privileges include inherited roles and roles API users can SET.
  -- authenticator's explicit SET into anon/authenticated is the PostgREST path;
  -- its own/inherited privileges must remain closed, as required by 0015.
  FOR api IN SELECT oid,rolname FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon','authenticated','authenticator') LOOP
    FOR reachable IN SELECT r.* FROM pg_catalog.pg_roles r WHERE r.oid=api.oid
      OR pg_catalog.pg_has_role(api.oid,r.oid,'USAGE')
      OR (api.rolname<>'authenticator' AND pg_catalog.pg_has_role(api.oid,r.oid,'SET')) LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole OR reachable.rolcreatedb
        OR reachable.rolreplication OR (api.rolname<>'authenticator' AND reachable.rolcanlogin)
        OR pg_catalog.pg_has_role(reachable.oid,'structr_review_owner_v1','SET')
        OR pg_catalog.pg_has_role(reachable.oid,'structr_review_owner_v1','USAGE')
        OR pg_catalog.has_schema_privilege(reachable.oid,'public','CREATE')
        OR pg_catalog.has_schema_privilege(reachable.oid,'structr_private','USAGE,CREATE')
        OR (api.rolname<>'authenticated' AND pg_catalog.has_schema_privilege(reachable.oid,'public','USAGE')) THEN
        RAISE EXCEPTION 'ADR002_NAMESPACE_ROLE_PREFLIGHT' USING ERRCODE='42501';
      END IF;
      -- Scan every relation/column/sequence currently in the exposed namespace,
      -- including unknown objects. Namespace lookup must not activate latent ACLs.
      FOR obj IN SELECT c.oid,c.relkind FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
        IF obj.relkind='S' THEN
          IF pg_catalog.has_sequence_privilege(reachable.oid,obj.oid,'SELECT,UPDATE,USAGE') THEN
            RAISE EXCEPTION 'ADR002_NAMESPACE_SEQUENCE_PREFLIGHT' USING ERRCODE='42501';
          END IF;
        ELSIF pg_catalog.has_table_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'ADR002_NAMESPACE_RELATION_PREFLIGHT' USING ERRCODE='42501';
        END IF;
      END LOOP;
      FOR obj IN SELECT p.oid FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP
        IF pg_catalog.has_function_privilege(reachable.oid,obj.oid,'EXECUTE')
          AND NOT (api.rolname='authenticated' AND obj.oid IN (session_wrapper,review_wrapper)) THEN
          RAISE EXCEPTION 'ADR002_NAMESPACE_FUNCTION_PREFLIGHT' USING ERRCODE='42501';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  GRANT USAGE ON SCHEMA public TO authenticated;
  IF NOT pg_catalog.has_schema_privilege('authenticated','public','USAGE') THEN
    RAISE EXCEPTION 'ADR002_NAMESPACE_GRANT_POSTFLIGHT' USING ERRCODE='42501';
  END IF;
END;
$namespace_usage$;
