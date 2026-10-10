-- Read-only closure checks from approved 0020; no revokes, grants, repairs or provisioning.
DO $preflight$
DECLARE item record; api record; reachable record;
  allowed oid[]:=ARRAY[to_regprocedure('public.structr_authenticated_session_v1()'),to_regprocedure('public.structr_internal_approval_review_v1(jsonb)'),to_regprocedure('public.structr_estimate_draft_read_v1(jsonb)'),to_regprocedure('public.structr_internal_approval_record_v1(jsonb)'),to_regprocedure('structr_private.authenticated_session_v1()'),to_regprocedure('structr_private.internal_approval_review_v1(jsonb)'),to_regprocedure('structr_private.estimate_draft_read_v1(jsonb)'),to_regprocedure('structr_private.internal_approval_record_v1(jsonb)')];
BEGIN
  IF EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) x WHERE x LIKE 'pgrst.db_schemas=%' AND x LIKE '%structr_financial%') OR coalesce(current_setting('pgrst.db_schemas',true),'') LIKE '%structr_financial%' THEN
    RAISE EXCEPTION 'FINANCIAL_DATA_API_SCHEMA_PREFLIGHT' USING ERRCODE='42501'; END IF;
  -- A future login inherits PUBLIC, regardless of NOINHERIT. No schema/table,
  -- column, primitive, sequence or default grant is silently revoked here.
  IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.grantee=0 AND a.privilege_type='CREATE')
    OR EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type IN ('CREATE','TEMPORARY')) THEN
    RAISE EXCEPTION 'FINANCIAL_SCHEMA_CREATION_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND a.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_attribute c JOIN pg_class t ON t.oid=c.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL aclexplode(c.attacl) a
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.attnum>0 AND NOT c.attisdropped AND a.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.grantee=0) THEN
    RAISE EXCEPTION 'FINANCIAL_PUBLIC_PRIVILEGE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee<>d.defaclrole) THEN
    RAISE EXCEPTION 'FINANCIAL_DEFAULT_ACL_PREFLIGHT' USING ERRCODE='42501'; END IF;
  FOR api IN SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator') LOOP
    FOR reachable IN SELECT r.* FROM pg_roles r WHERE r.oid=api.oid OR pg_has_role(api.oid,r.oid,'USAGE') OR (api.rolname<>'authenticator' AND pg_has_role(api.oid,r.oid,'SET')) LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole OR reachable.rolcreatedb OR reachable.rolreplication OR (api.rolname<>'authenticator' AND reachable.rolcanlogin) OR has_database_privilege(reachable.oid,current_database(),'CREATE,TEMPORARY') THEN
        RAISE EXCEPTION 'FINANCIAL_API_ROLE_PREFLIGHT' USING ERRCODE='42501'; END IF;
      FOR item IN SELECT n.oid FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' LOOP
        IF has_schema_privilege(reachable.oid,item.oid,'CREATE') THEN RAISE EXCEPTION 'FINANCIAL_API_SCHEMA_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
      FOR item IN SELECT c.oid,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') LOOP
        IF (item.relkind='S' AND has_sequence_privilege(reachable.oid,item.oid,'SELECT,UPDATE,USAGE')) OR (item.relkind<>'S' AND (has_table_privilege(reachable.oid,item.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(reachable.oid,item.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
          RAISE EXCEPTION 'FINANCIAL_API_RELATION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
      FOR item IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' LOOP
        IF has_function_privilege(reachable.oid,item.oid,'EXECUTE') AND NOT(api.rolname='authenticated' AND item.oid=ANY(allowed)) THEN
          RAISE EXCEPTION 'FINANCIAL_API_FUNCTION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $preflight$;
