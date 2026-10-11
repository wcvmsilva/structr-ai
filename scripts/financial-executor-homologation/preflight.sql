-- Read-only closure checks from approved 0020; no revokes, grants, repairs or provisioning.
DO $preflight$
DECLARE managed_hash text; managed_verified boolean; item record; api record; reachable record;
  allowed oid[]:=ARRAY[to_regprocedure('public.structr_authenticated_session_v1()'),to_regprocedure('public.structr_internal_approval_review_v1(jsonb)'),to_regprocedure('public.structr_estimate_draft_read_v1(jsonb)'),to_regprocedure('public.structr_internal_approval_record_v1(jsonb)'),to_regprocedure('structr_private.authenticated_session_v1()'),to_regprocedure('structr_private.internal_approval_review_v1(jsonb)'),to_regprocedure('structr_private.estimate_draft_read_v1(jsonb)'),to_regprocedure('structr_private.internal_approval_record_v1(jsonb)')];
BEGIN
 WITH surface AS (
 SELECT 'schema:'||n.nspname AS identity,jsonb_build_object('owner',n.nspowner::regrole::text,'acl',n.nspacl,'effectiveAcl',coalesce(n.nspacl,acldefault('n',n.nspowner))) AS definition FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 UNION ALL SELECT 'database:'||d.datname,jsonb_build_object('owner',d.datdba::regrole::text,'acl',d.datacl,'effectiveAcl',coalesce(d.datacl,acldefault('d',d.datdba))) FROM pg_database d WHERE d.datname=current_database()
 UNION ALL SELECT 'default:'||d.defaclrole::regrole::text||':'||CASE WHEN d.defaclnamespace=0 THEN '*' ELSE d.defaclnamespace::regnamespace::text END||':'||d.defaclobjtype::text,jsonb_build_object('acl',d.defaclacl) FROM pg_default_acl d
 UNION ALL SELECT 'relation:'||n.nspname||'.'||c.relname,jsonb_build_object('kind',c.relkind,'owner',c.relowner::regrole::text,'acl',c.relacl,'effectiveAcl',coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner)),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
 UNION ALL SELECT 'routine:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_object('owner',p.proowner::regrole::text,'language',l.lanname,'securityDefiner',p.prosecdef,'config',p.proconfig,'acl',p.proacl,'effectiveAcl',coalesce(p.proacl,acldefault('f',p.proowner)),'definition',pg_get_functiondef(p.oid),'definitionHash',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'staticDependencies',(SELECT coalesce(jsonb_agg(pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) ORDER BY pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid)),'[]'::jsonb) FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid),'requiresBodyReview',l.lanname IN ('sql','plpgsql')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND p.prokind IN ('f','p','w')
 UNION ALL SELECT 'view:'||n.nspname||'.'||c.relname,jsonb_build_object('definition',pg_get_viewdef(c.oid,true),'options',c.reloptions) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('v','m')
 UNION ALL SELECT 'rule:'||n.nspname||'.'||c.relname||'.'||rw.rulename,jsonb_build_object('definition',pg_get_ruledef(rw.oid,true),'enabled',rw.ev_enabled) FROM pg_rewrite rw JOIN pg_class c ON c.oid=rw.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 UNION ALL SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 UNION ALL SELECT 'event-trigger:'||e.evtname,jsonb_build_object('event',e.evtevent,'tags',e.evttags,'enabled',e.evtenabled,'owner',e.evtowner::regrole::text,'function',e.evtfoid::regprocedure::text) FROM pg_event_trigger e
 UNION ALL SELECT 'extension:'||e.extname,jsonb_build_object('version',e.extversion,'namespace',e.extnamespace::regnamespace::text,'owner',e.extowner::regrole::text,'relocatable',e.extrelocatable,'members',(SELECT jsonb_agg(pg_describe_object(d.classid,d.objid,d.objsubid) ORDER BY pg_describe_object(d.classid,d.objid,d.objsubid)) FROM pg_depend d WHERE d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid AND d.deptype='e')) FROM pg_extension e
) SELECT encode(sha256(convert_to(coalesce(string_agg(identity||':'||encode(sha256(convert_to(definition::text,'UTF8')),'hex'),E'\n' ORDER BY identity COLLATE "C"),''),'UTF8')),'hex') INTO managed_hash FROM surface WHERE (identity LIKE 'event-trigger:%'
 OR (identity LIKE 'extension:%' AND definition->>'namespace' NOT IN ('public','structr_private','structr_financial','pg_catalog'))
 OR identity LIKE 'default:%'
 OR (identity LIKE 'schema:%' AND split_part(identity,':',2) NOT IN ('public','structr_private','structr_financial'))
 OR (split_part(identity,':',1) IN ('routine','relation','view','rule','trigger') AND split_part(split_part(identity,':',2),'.',1) NOT IN ('public','structr_private','structr_financial')));
 -- Provider surface is exact. Laboratory alternatives require the owned socket-only
 -- initdb harness shape; no caller GUC/marker can enable another profile remotely.
 managed_verified := managed_hash='8622932ca244518fc2d29f50c952e7856d49ba9f556fda12a1b5e5813aad8b46' OR
 (managed_hash IN ('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','bebf2a74fa50d8f3faa54cb45175f167c39f2c8e06a16c233fab1cd8d177f704')
 AND inet_server_addr() IS NULL AND current_setting('listen_addresses')=''
 AND current_setting('unix_socket_directories') ~ '^/(private/)?tmp/structr-app-principal-pg-[A-Za-z0-9]+/socket$'
 AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_principal_runner' AND rolsuper));
IF NOT EXISTS(SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto' AND e.extversion='1.3' AND n.nspname IN ('public','extensions')) OR
 (SELECT count(*) FROM pg_extension e JOIN pg_depend d ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid AND d.classid='pg_proc'::regclass AND d.deptype='e' WHERE e.extname='pgcrypto')<>36 OR
 (SELECT encode(sha256(convert_to(string_agg('function:public.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||encode(sha256(convert_to(replace(pg_get_functiondef(p.oid),'CREATE OR REPLACE FUNCTION '||n.nspname||'.','CREATE OR REPLACE FUNCTION public.'),'UTF8')),'hex'),E'\n' ORDER BY p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' COLLATE "C"),'UTF8')),'hex') FROM pg_extension e JOIN pg_depend d ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid AND d.classid='pg_proc'::regclass AND d.deptype='e' JOIN pg_proc p ON p.oid=d.objid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE e.extname='pgcrypto' AND p.pronamespace=e.extnamespace) IS DISTINCT FROM '3c39af3826e7b2ba35c551685184638c9e9e82a0e4210cc34abeb7f9a0e7fb56' THEN RAISE EXCEPTION 'FINANCIAL_PGCRYPTO_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) x WHERE x LIKE 'pgrst.db_schemas=%' AND x LIKE '%structr_financial%') OR coalesce(current_setting('pgrst.db_schemas',true),'') LIKE '%structr_financial%' THEN
    RAISE EXCEPTION 'FINANCIAL_DATA_API_SCHEMA_PREFLIGHT' USING ERRCODE='42501'; END IF;
  -- A future login inherits PUBLIC, regardless of NOINHERIT. No schema/table,
  -- column, primitive, sequence or default grant is silently revoked here.
  IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.grantee=0 AND a.privilege_type='CREATE')
    OR EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type IN ('CREATE','TEMPORARY')) THEN
    RAISE EXCEPTION 'FINANCIAL_SCHEMA_CREATION_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND a.grantee=0 AND NOT(managed_verified AND n.nspname NOT IN ('public','structr_private','structr_financial')))
    OR EXISTS(SELECT 1 FROM pg_attribute c JOIN pg_class t ON t.oid=c.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL aclexplode(c.attacl) a
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.attnum>0 AND NOT c.attisdropped AND a.grantee=0 AND NOT(managed_verified AND n.nspname NOT IN ('public','structr_private','structr_financial')))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND a.grantee=0 AND NOT(managed_verified AND n.nspname NOT IN ('public','structr_private','structr_financial'))) THEN
    RAISE EXCEPTION 'FINANCIAL_PUBLIC_PRIVILEGE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee<>d.defaclrole AND NOT(managed_verified AND ((d.defaclnamespace<>0 AND d.defaclnamespace::regnamespace::text NOT IN ('public','structr_private','structr_financial')) OR (d.defaclrole<>current_user::regrole AND d.defaclrole::regrole::text NOT IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1'))))) THEN
    RAISE EXCEPTION 'FINANCIAL_DEFAULT_ACL_PREFLIGHT' USING ERRCODE='42501'; END IF;
  FOR api IN SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator') LOOP
    FOR reachable IN SELECT r.* FROM pg_roles r WHERE r.oid=api.oid OR pg_has_role(api.oid,r.oid,'USAGE') OR (api.rolname<>'authenticator' AND pg_has_role(api.oid,r.oid,'SET')) LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole OR reachable.rolcreatedb OR reachable.rolreplication OR (api.rolname<>'authenticator' AND reachable.rolcanlogin) OR has_database_privilege(reachable.oid,current_database(),'CREATE') THEN
        RAISE EXCEPTION 'FINANCIAL_API_ROLE_PREFLIGHT' USING ERRCODE='42501'; END IF;
      FOR item IN SELECT n.oid FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' LOOP
        IF has_schema_privilege(reachable.oid,item.oid,'CREATE') THEN RAISE EXCEPTION 'FINANCIAL_API_SCHEMA_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
      FOR item IN SELECT c.oid,c.relkind,c.relnamespace,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND NOT(managed_verified AND n.nspname NOT IN ('public','structr_private','structr_financial')) LOOP
        IF (item.relkind='S' AND has_sequence_privilege(reachable.oid,item.oid,'SELECT,UPDATE,USAGE')) OR (item.relkind<>'S' AND (has_table_privilege(reachable.oid,item.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(reachable.oid,item.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
          RAISE EXCEPTION 'FINANCIAL_API_RELATION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
      FOR item IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND NOT(managed_verified AND n.nspname NOT IN ('public','structr_private','structr_financial')) LOOP
        IF has_function_privilege(reachable.oid,item.oid,'EXECUTE') AND NOT(api.rolname='authenticated' AND item.oid=ANY(allowed)) THEN
          RAISE EXCEPTION 'FINANCIAL_API_FUNCTION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
IF NOT managed_verified THEN RAISE EXCEPTION 'FINANCIAL_MANAGED_CATALOG_PREFLIGHT' USING ERRCODE='42501'; END IF;
END $preflight$;
