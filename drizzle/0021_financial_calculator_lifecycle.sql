-- ADR-003 Calculator lifecycle candidate. No credentials, bindings or fixture rows.
-- The principal remains NOLOGIN. Private routines authorize session_user in every call.
SET LOCAL search_path=pg_catalog;
DO $closure$
DECLARE item record; api record; reachable record;
  allowed oid[]:=ARRAY[to_regprocedure('public.structr_authenticated_session_v1()'),to_regprocedure('public.structr_internal_approval_review_v1(jsonb)'),to_regprocedure('public.structr_estimate_draft_read_v1(jsonb)'),to_regprocedure('public.structr_internal_approval_record_v1(jsonb)'),to_regprocedure('structr_private.authenticated_session_v1()'),to_regprocedure('structr_private.internal_approval_review_v1(jsonb)'),to_regprocedure('structr_private.estimate_draft_read_v1(jsonb)'),to_regprocedure('structr_private.internal_approval_record_v1(jsonb)')];
BEGIN
 IF current_setting('server_version_num')<>'170011' OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)<>3 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1')) THEN RAISE EXCEPTION 'FINANCIAL_LIFECYCLE_ROLE_PREFLIGHT' USING ERRCODE='42501';END IF;
  IF array_position(allowed,NULL) IS NOT NULL OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('structr_review_owner_v1','structr_estimate_read_owner_v1','structr_intake_create_owner_v1','structr_scope_workspace_read_owner_v1') AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)<>4 THEN
    RAISE EXCEPTION 'FINANCIAL_EXISTING_OWNER_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_db_role_setting s,unnest(s.setconfig) x WHERE x LIKE 'pgrst.db_schemas=%' AND x LIKE '%structr_financial%') OR coalesce(current_setting('pgrst.db_schemas',true),'') LIKE '%structr_financial%' THEN
    RAISE EXCEPTION 'FINANCIAL_DATA_API_SCHEMA_PREFLIGHT' USING ERRCODE='42501'; END IF;
  -- A future login inherits PUBLIC, regardless of NOINHERIT. No schema/table,
  -- column, primitive, sequence or default grant is silently revoked here.
  IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND a.grantee=0 AND a.privilege_type='CREATE')
    OR EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type IN ('CREATE','TEMPORARY')) THEN
    RAISE EXCEPTION 'FINANCIAL_SCHEMA_CREATION_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') AND a.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_attribute c JOIN pg_class t ON t.oid=c.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace CROSS JOIN LATERAL aclexplode(c.attacl) a
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.attnum>0 AND NOT c.attisdropped AND a.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND a.grantee=0) THEN
    RAISE EXCEPTION 'FINANCIAL_PUBLIC_PRIVILEGE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE a.grantee<>d.defaclrole) THEN
    RAISE EXCEPTION 'FINANCIAL_DEFAULT_ACL_PREFLIGHT' USING ERRCODE='42501'; END IF;
  FOR api IN SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','authenticator') LOOP
    FOR reachable IN SELECT r.* FROM pg_roles r WHERE r.oid=api.oid OR pg_has_role(api.oid,r.oid,'USAGE') OR (api.rolname<>'authenticator' AND pg_has_role(api.oid,r.oid,'SET')) LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole OR reachable.rolcreatedb OR reachable.rolreplication OR (api.rolname<>'authenticator' AND reachable.rolcanlogin) OR has_database_privilege(reachable.oid,current_database(),'CREATE,TEMPORARY') THEN
        RAISE EXCEPTION 'FINANCIAL_API_ROLE_PREFLIGHT' USING ERRCODE='42501'; END IF;
      FOR item IN SELECT n.oid FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' LOOP
        IF has_schema_privilege(reachable.oid,item.oid,'CREATE') THEN RAISE EXCEPTION 'FINANCIAL_API_SCHEMA_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
      FOR item IN SELECT c.oid,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') LOOP
        IF (item.relkind='S' AND has_sequence_privilege(reachable.oid,item.oid,'SELECT,UPDATE,USAGE')) OR (item.relkind<>'S' AND (has_table_privilege(reachable.oid,item.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(reachable.oid,item.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
          RAISE EXCEPTION 'FINANCIAL_API_RELATION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
      FOR item IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' LOOP
        IF has_function_privilege(reachable.oid,item.oid,'EXECUTE') AND NOT(api.rolname='authenticated' AND item.oid=ANY(allowed)) THEN
          RAISE EXCEPTION 'FINANCIAL_API_FUNCTION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  -- SET CONSTRAINTS is schema/name scoped; duplicate names could flush other
  -- guards. Relation OID/trigger linkage, definitions and enabled state are pinned.
  IF (SELECT count(*) FROM pg_constraint c WHERE c.connamespace='public'::regnamespace AND c.conname='a1_draft_final')<>1 OR NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_trigger t ON t.tgconstraint=c.oid WHERE c.conname='a1_draft_final' AND c.conrelid='public.estimate_drafts'::regclass AND t.tgrelid=c.conrelid AND t.tgfoid='public.internal_approval_check_final_v1()'::regprocedure AND t.tgenabled='O' AND c.condeferrable AND c.condeferred) THEN
    RAISE EXCEPTION 'FINANCIAL_CONSTRAINT_PREFLIGHT' USING ERRCODE='42501'; END IF;
  FOR reachable IN SELECT * FROM pg_roles WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') LOOP
    IF has_database_privilege(reachable.oid,current_database(),'CREATE,TEMPORARY') THEN RAISE EXCEPTION 'FINANCIAL_LIFECYCLE_ROLE_PREFLIGHT' USING ERRCODE='42501';END IF;
    FOR item IN SELECT oid,nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' LOOP
      IF has_schema_privilege(reachable.oid,item.oid,'CREATE') OR (has_schema_privilege(reachable.oid,item.oid,'USAGE') AND NOT(item.nspname='structr_financial' OR (item.nspname='public' AND reachable.rolname<>'structr_calculator_login_v1'))) THEN RAISE EXCEPTION 'FINANCIAL_LIFECYCLE_ROLE_PREFLIGHT' USING ERRCODE='42501';END IF;
    END LOOP;
    FOR item IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema','public','structr_private','structr_financial') LOOP
      IF has_function_privilege(reachable.oid,item.oid,'EXECUTE') THEN RAISE EXCEPTION 'FINANCIAL_LIFECYCLE_ROLE_PREFLIGHT' USING ERRCODE='42501';END IF;
    END LOOP;
    FOR item IN SELECT c.oid,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema','public','structr_private','structr_financial') AND c.relkind IN ('r','p','v','m','f','S') LOOP
      IF (item.relkind='S' AND has_sequence_privilege(reachable.oid,item.oid,'SELECT,UPDATE,USAGE')) OR (item.relkind<>'S' AND (has_table_privilege(reachable.oid,item.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(reachable.oid,item.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN RAISE EXCEPTION 'FINANCIAL_LIFECYCLE_ROLE_PREFLIGHT' USING ERRCODE='42501';END IF;
    END LOOP;
  END LOOP;
END $closure$;
DO $preflight$ DECLARE observed text; BEGIN
WITH objects AS (
SELECT 'relation:'||n.nspname||'.'||c.relname AS identity,
 jsonb_build_object('kind',c.relkind,'owner',CASE WHEN c.relowner=current_user::regrole THEN '$migrator' ELSE c.relowner::regrole::text END,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) x),
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(a.attacl) x),'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) AS definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private','structr_financial') AND c.relkind IN ('r','p','v','m','f','S')
UNION ALL SELECT 'constraint:'||n.nspname||'.'||c.relname||'.'||x.conname,
 jsonb_build_object('definition',pg_get_constraintdef(x.oid,true),'validated',x.convalidated,'deferred',x.condeferred,'deferrable',x.condeferrable)
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private','structr_financial')
UNION ALL SELECT 'index:'||n.nspname||'.'||c.relname,
 jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'immediate',i.indimmediate)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private','structr_financial')
UNION ALL SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,
 jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','structr_private','structr_financial')
UNION ALL SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x),'owner',CASE WHEN p.proowner=current_user::regrole THEN '$migrator' ELSE p.proowner::regrole::text END)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','structr_private','structr_financial')
UNION ALL SELECT 'policy:'||n.nspname||'.'||c.relname||'.'||p.polname,
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN o=0 THEN 'PUBLIC' ELSE o::regrole::text END ORDER BY o::regrole::text) FROM unnest(p.polroles) o), 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private','structr_financial')
)
SELECT encode(sha256(convert_to(string_agg(identity||':'||encode(sha256(convert_to(definition::text,'UTF8')),'hex'),E'\n' ORDER BY identity),'UTF8')),'hex') INTO observed FROM objects;
IF observed IS DISTINCT FROM 'c60684d9487ed6838012f744c75b108e5252e33aeccf21f65731c0efc757b30f' THEN RAISE EXCEPTION 'FINANCIAL_LIFECYCLE_CATALOG_PREFLIGHT' USING ERRCODE='42501'; END IF;
END $preflight$;

CREATE FUNCTION structr_financial.uuid_v1(value text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND value<>'00000000-0000-0000-0000-000000000000'
$$;
CREATE FUNCTION structr_financial.utc_v1(value timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
-- Exact TS canonical JSON for the command grammar: ASCII keys, UUID/operation/hash
-- strings, booleans/null and safe integer quantities; array order is significant.
CREATE FUNCTION structr_financial.canonical_v1(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result text; kind text:=jsonb_typeof(value);
BEGIN
 IF kind='object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||structr_financial.canonical_v1(v),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) AS e(key,v);RETURN result;
 ELSIF kind='array' THEN SELECT '['||coalesce(string_agg(structr_financial.canonical_v1(v),',' ORDER BY n),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS e(v,n);RETURN result;
 ELSIF kind='number' THEN IF value::text !~ '^-?(0|[1-9][0-9]*)$' OR abs((value::text)::numeric)>9007199254740991 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
 ELSIF kind IS NULL THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
 RETURN value::text;
END $$;
CREATE FUNCTION structr_financial.validate_command_v1(command jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE operation text; item jsonb; seen uuid[]:='{}'; id uuid; expected text[];
BEGIN
 IF jsonb_typeof(command) IS DISTINCT FROM 'object' OR octet_length(command::text)>16384 OR command->>'contractVersion' IS DISTINCT FROM 'calculator-v1' OR structr_financial.uuid_v1(command->>'projectId') IS DISTINCT FROM true OR structr_financial.uuid_v1(command->>'intakeFormId') IS DISTINCT FROM true THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
 operation:=command->>'operation'; expected:=ARRAY['contractVersion','operation','projectId','intakeFormId'];
 IF operation IN ('calculator.calculate','calculator.create') THEN
  expected:=expected||ARRAY['assemblies'];
  IF jsonb_typeof(command->'assemblies') IS DISTINCT FROM 'array' OR jsonb_array_length(command->'assemblies') NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(command->'assemblies') LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['assemblyId','quantity']<>'{}' OR structr_financial.uuid_v1(item->>'assemblyId') IS DISTINCT FROM true OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' OR (item->>'quantity')!~'^[1-9][0-9]{0,2}$' THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
   IF (item->>'quantity')::integer>100 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
   id:=(item->>'assemblyId')::uuid;IF id=ANY(seen) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;seen:=array_append(seen,id);
  END LOOP;
 END IF;
 IF operation IN ('calculator.create','calculator.recover') THEN
  expected:=expected||ARRAY['requestId']; IF structr_financial.uuid_v1(command->>'requestId') IS DISTINCT FROM true THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
 END IF;
 IF operation='calculator.create' THEN
  expected:=expected||ARRAY['expectedSourceHash','expectedCalculationHash'];IF jsonb_typeof(command->'expectedSourceHash') IS DISTINCT FROM 'string' OR jsonb_typeof(command->'expectedCalculationHash') IS DISTINCT FROM 'string' OR ((command->>'expectedSourceHash')~'^[0-9a-f]{64}$') IS DISTINCT FROM true OR ((command->>'expectedCalculationHash')~'^[0-9a-f]{64}$') IS DISTINCT FROM true THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
 END IF;
 IF operation IS NULL OR operation NOT IN ('calculator.context','calculator.calculate','calculator.create','calculator.recover') OR command-expected<>'{}' OR NOT command ?& expected THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
END $$;

CREATE FUNCTION structr_financial.authorize_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE initial_binding structr_financial.principal_bindings;b structr_financial.principal_bindings; f structr_financial.calculator_fixtures; a record;t record;p record;i record;c record;member record;role_row record;edge record;permission record;aud public.audit_logs;
 member_count integer:=0;member_active boolean:=false;member_write boolean:=false;rbac_permissions text[]:='{}';permission_ids uuid[]:='{}';value jsonb;event jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' OR current_setting('transaction_read_only')<>'off' THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_TRANSACTION_INVALID' USING ERRCODE='42501';END IF;
 PERFORM structr_financial.validate_command_v1(command);
 IF session_user<>'structr_calculator_login_v1' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') AND (rolsuper OR rolinherit OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR (rolname<>'structr_calculator_login_v1' AND rolcanlogin))) OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1')) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.profiles'::regclass,'public.tenants'::regclass,'public.projects'::regclass,'public.project_members'::regclass,'public.roles'::regclass,'public.role_permissions'::regclass,'public.permissions'::regclass,'public.intake_forms'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH' USING ERRCODE='42501';END IF;
 PERFORM structr_financial.evidence_boundary_v1();
 -- Resolve the fixed identity without a row lock, then follow the common A1 project-first order.
 SELECT * INTO b FROM structr_financial.principal_bindings WHERE session_role=session_user;
 IF NOT FOUND OR NOT b.is_active OR b.deleted_at IS NOT NULL OR NOT (command->>'operation'=ANY(b.operations)) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 initial_binding:=b;
 SELECT id,tenant_id,client_id,owner_user_id,deleted_at,name,commercial_channel,channel,geo_risk_class,address,city,state,zip,county,latitude,longitude,geocoded_at,geocode_confidence,geocode_source,geocoded_address,zone,zone_modifier_snapshot,updated_at INTO p FROM public.projects WHERE id=(command->>'projectId')::uuid FOR UPDATE;
 IF NOT FOUND OR p.tenant_id IS DISTINCT FROM b.tenant_id OR p.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT id,tenant_id,project_id,status,form_data,created_at,updated_at INTO i FROM public.intake_forms WHERE id=(command->>'intakeFormId')::uuid FOR SHARE;
 IF NOT FOUND OR i.tenant_id IS DISTINCT FROM b.tenant_id OR i.project_id IS DISTINCT FROM p.id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT id,tenant_id,external_open_id,role,is_active INTO a FROM public.profiles WHERE id=b.actor_id FOR SHARE;
 IF NOT FOUND OR a.is_active IS DISTINCT FROM true OR a.tenant_id IS DISTINCT FROM b.tenant_id OR a.external_open_id IS DISTINCT FROM b.subject::text THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT id,is_active,timezone INTO t FROM public.tenants WHERE id=b.tenant_id FOR SHARE;
 IF NOT FOUND OR t.is_active IS DISTINCT FROM true OR t.timezone IS DISTINCT FROM 'America/New_York' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT id,tenant_id,is_active,deleted_at,updated_at INTO c FROM public.clients WHERE id=p.client_id FOR SHARE;
 IF NOT FOUND OR c.tenant_id IS DISTINCT FROM b.tenant_id OR c.is_active IS DISTINCT FROM true OR c.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 FOR member IN SELECT id,tenant_id,project_role,permissions,is_active FROM public.project_members WHERE project_id=p.id AND user_id=b.actor_id ORDER BY id FOR SHARE LOOP
  member_count:=member_count+1;
  IF member_count>1 OR member.tenant_id IS DISTINCT FROM b.tenant_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
  IF member.permissions IS NOT NULL AND member.permissions<>'null'::jsonb THEN
   IF jsonb_typeof(member.permissions)<>'array' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
   FOR value IN SELECT * FROM jsonb_array_elements(member.permissions) LOOP IF value NOT IN ('"read"','"write"','"approve"','"delete"') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;END LOOP;
  END IF;
  member_active:=member.is_active IS TRUE;member_write:=member.project_role IN ('owner','manager','estimator','field') OR coalesce(member.permissions?'write',false);
 END LOOP;
 SELECT id,name INTO role_row FROM public.roles WHERE name=a.role FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 FOR edge IN SELECT id,permission_id FROM public.role_permissions WHERE role_id=role_row.id ORDER BY id FOR SHARE LOOP permission_ids:=array_append(permission_ids,edge.permission_id);END LOOP;
 FOR permission IN SELECT id,resource,action FROM public.permissions WHERE id=ANY(permission_ids) ORDER BY id FOR SHARE LOOP rbac_permissions:=array_append(rbac_permissions,permission.resource||':'||permission.action);END LOOP;
 IF NOT ('estimate:create'=ANY(rbac_permissions)) OR NOT(a.role='admin' OR p.owner_user_id=b.actor_id OR (member_active AND member_write) OR (NOT member_active AND 'project:write'=ANY(rbac_permissions))) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM structr_financial.principal_bindings WHERE id=initial_binding.id FOR SHARE;
 IF NOT FOUND OR to_jsonb(b) IS DISTINCT FROM to_jsonb(initial_binding) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 SELECT * INTO f FROM structr_financial.calculator_fixtures WHERE binding_id=b.id AND project_id=p.id AND intake_form_id=i.id FOR SHARE;
 IF NOT FOUND OR f.tenant_id<>b.tenant_id OR f.actor_id<>b.actor_id OR f.client_id<>c.id OR f.deleted_at IS NOT NULL OR encode(sha256(convert_to(f.manifest::text,'UTF8')),'hex')<>f.manifest_hash THEN RAISE EXCEPTION 'CALCULATOR_MANIFEST_INVALID' USING ERRCODE='P0001';END IF;
 SELECT * INTO aud FROM public.audit_logs WHERE id=f.provenance_audit_id;
 event:=jsonb_build_object('contractVersion','calculator-fixture-v1','bindingId',b.id,'tenantId',b.tenant_id,'actorId',b.actor_id,'fixtureId',f.id,'projectId',p.id,'intakeFormId',i.id,'clientId',c.id,'manifestHash',f.manifest_hash,'manifest',f.manifest);
 IF aud.id IS NULL OR aud.user_id IS DISTINCT FROM b.actor_id OR aud.action IS DISTINCT FROM 'financial.calculator.fixture.create' OR aud.table_name IS DISTINCT FROM 'calculator_fixtures' OR aud.record_id IS DISTINCT FROM f.id OR aud.old_values IS NOT NULL OR aud.new_values IS DISTINCT FROM event THEN RAISE EXCEPTION 'CALCULATOR_MANIFEST_INVALID' USING ERRCODE='P0001';END IF;
 IF EXISTS(SELECT 1 FROM public.historical_estimate_imports h JOIN public.estimate_drafts d ON d.id=h.estimate_draft_id WHERE d.project_id=p.id) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('envelope',jsonb_build_object('contractVersion','calculator-v1','binding',jsonb_build_object('id',b.id,'sessionRole',b.session_role,'subject',b.subject,'actorId',b.actor_id,'tenantId',b.tenant_id,'operations',to_jsonb(b.operations)),'transaction',jsonb_build_object('backendPid',pg_backend_pid(),'transactionId',txid_current()::text),'projectId',p.id,'intakeFormId',i.id,'clientId',c.id),'project',to_jsonb(p),'intake',to_jsonb(i),'client',to_jsonb(c),'fixture',to_jsonb(f));
END $$;
CREATE FUNCTION structr_financial.ids_v1(value jsonb,maximum integer) RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; ids uuid[]:='{}'; id uuid;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value) NOT BETWEEN 1 AND maximum THEN RAISE EXCEPTION 'CALCULATOR_MANIFEST_INVALID' USING ERRCODE='P0001';END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
  IF jsonb_typeof(item)<>'string' OR structr_financial.uuid_v1(item#>>'{}') IS DISTINCT FROM true THEN RAISE EXCEPTION 'CALCULATOR_MANIFEST_INVALID' USING ERRCODE='P0001';END IF;
  id:=(item#>>'{}')::uuid;IF id=ANY(ids) THEN RAISE EXCEPTION 'CALCULATOR_MANIFEST_INVALID' USING ERRCODE='P0001';END IF;ids:=array_append(ids,id);
 END LOOP;RETURN ids;
END $$;
CREATE FUNCTION structr_financial.snapshot_v1(authority jsonb,command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE f jsonb:=authority->'fixture';m jsonb:=f->'manifest';p jsonb:=authority->'project';i jsonb:=authority->'intake';c jsonb:=authority->'client';b jsonb:=authority->'envelope'->'binding';at timestamptz:=date_trunc('milliseconds',transaction_timestamp());day date:=(transaction_timestamp() AT TIME ZONE 'America/New_York')::date;
 assembly_ids uuid[];code_ids uuid[];type_ids uuid[];unit_ids uuid[];assembly record;component record;cost_code_row record;kind record;unit record;price record;settings record;zone record;
 assembly_rows jsonb:='[]';code_rows jsonb:='[]';type_rows jsonb:='[]';unit_rows jsonb:='[]';price_rows jsonb:='[]';components jsonb;classification jsonb;policy jsonb;z jsonb;ge jsonb;geojson jsonb;channel_override text;geo_override text;floor numeric;seen integer;total_lines integer:=0;sel jsonb;found_count integer;v jsonb;
BEGIN
 IF m->>'contractVersion' IS DISTINCT FROM 'calculator-fixture-v1' OR m->>'sharedSourceClassification' IS DISTINCT FROM 'fixture_shared_types_units' OR m->>'dimensionSource' IS DISTINCT FROM 'fixture_explicit_unit_dimensions'
 OR m->'context' IS DISTINCT FROM '{"channel":"direct","finishLevel":"standard","region":"charleston_sc","currency":"USD","dimensions":{"wasteFactor":1,"coastalModifier":1,"channelCostMultiplier":1,"channelPriceMultiplier":1,"finishMultiplier":1,"regionalCostModifier":1,"regionalLaborModifier":1,"regionalMaterialModifier":1}}'::jsonb THEN RAISE EXCEPTION 'CALCULATOR_CONTEXT_UNSUPPORTED' USING ERRCODE='P0001';END IF;
 assembly_ids:=structr_financial.ids_v1(m->'assemblyIds',25);code_ids:=structr_financial.ids_v1(m->'costCodeIds',1000);type_ids:=structr_financial.ids_v1(m->'costTypeIds',1000);unit_ids:=structr_financial.ids_v1(m->'unitIds',1000);
 IF command?'assemblies' THEN FOR sel IN SELECT * FROM jsonb_array_elements(command->'assemblies') LOOP IF NOT((sel->>'assemblyId')::uuid=ANY(assembly_ids)) THEN RAISE EXCEPTION 'CALCULATOR_MANIFEST_INVALID' USING ERRCODE='P0001';END IF;END LOOP;END IF;
 -- Complete audited geo fixture is checked against current physical protected rows.
 -- formation_only or a changed/unproven geocode never acquires financial readiness.
 z:=p->'zone_modifier_snapshot';ge:=z->'reviewEvidence';policy:=m->'policyContext';geojson:=policy->'projectGeo';
 IF z IS DISTINCT FROM m->'zoneSnapshot' OR jsonb_typeof(z) IS DISTINCT FROM 'object' OR jsonb_typeof(ge) IS DISTINCT FROM 'object' OR ge->>'version' IS DISTINCT FROM 'project-geocode-review-v1'
 OR ge->>'projectId' IS DISTINCT FROM p->>'id' OR ge->>'tenantId' IS DISTINCT FROM b->>'tenantId'
 OR ge->'inputAddress' IS DISTINCT FROM jsonb_build_object('address',p->'address','city',p->'city','state',p->'state','zipCode',p->'zip','county',p->'county')
 OR ge->'geocode'->>'source' IS DISTINCT FROM 'google_maps' OR ge->'geocode'->'success' IS DISTINCT FROM 'true'::jsonb OR ge->'geocode'->'withinServiceRadius' IS DISTINCT FROM 'true'::jsonb
 OR ge->'geocode'->>'confidence' NOT IN ('high','medium') OR ge->'zoneDetection'->>'method' NOT IN ('coordinates','zip') OR ge->'zoneDetection'->>'confidence' NOT IN ('high','medium')
 OR p->>'geocode_confidence' IS DISTINCT FROM ge->'geocode'->>'confidence' OR p->>'geocode_source' IS DISTINCT FROM ge->'geocode'->>'source' OR p->>'geocoded_address' IS DISTINCT FROM ge->'geocode'->>'formattedAddress'
 OR structr_financial.utc_v1((p->>'geocoded_at')::timestamptz) IS DISTINCT FROM ge->>'geocodedAt'
 OR p->'latitude' IS DISTINCT FROM ge->'geocode'->'latitude' OR p->'longitude' IS DISTINCT FROM ge->'geocode'->'longitude'
 OR p->>'zone' IS DISTINCT FROM z->>'zoneName' OR p->>'geo_risk_class' IS DISTINCT FROM 'coastal' OR p->>'channel' IS DISTINCT FROM 'direct'
 OR (p->>'commercial_channel' IS NOT NULL AND p->>'commercial_channel'<>'premium') OR ge->'zoneDetection'->>'zoneId' IS DISTINCT FROM z->>'zoneId'
 OR structr_financial.uuid_v1(z->>'zoneId') IS DISTINCT FROM true THEN RAISE EXCEPTION 'CALCULATOR_POLICY_INVALID' USING ERRCODE='P0001';END IF;
 SELECT id,tenant_id,is_active,zone_name,name,coastal_exposure_level,cost_multiplier,labor_modifier,material_modifier,logistics_modifier,contingency_pct,min_profit_shield_pct INTO zone FROM public.geo_zones WHERE id=(z->>'zoneId')::uuid FOR SHARE;
 IF NOT FOUND OR zone.tenant_id::text IS DISTINCT FROM b->>'tenantId' OR zone.is_active IS DISTINCT FROM true OR zone.zone_name IS DISTINCT FROM z->>'zoneName' OR zone.coastal_exposure_level IS DISTINCT FROM 'moderate' OR zone.cost_multiplier IS DISTINCT FROM 1
 OR to_jsonb(zone.labor_modifier) IS DISTINCT FROM z->'laborModifier' OR to_jsonb(zone.material_modifier) IS DISTINCT FROM z->'materialModifier' OR to_jsonb(zone.logistics_modifier) IS DISTINCT FROM z->'logisticsModifier' OR to_jsonb(zone.contingency_pct) IS DISTINCT FROM z->'contingencyPct' OR to_jsonb(zone.min_profit_shield_pct) IS DISTINCT FROM z->'minProfitShieldPct'
 OR geojson->>'zoneId' IS DISTINCT FROM zone.id::text OR geojson->>'zoneTenantId' IS DISTINCT FROM zone.tenant_id::text OR geojson->>'zone' IS DISTINCT FROM zone.zone_name
 OR geojson->>'geocodedAt' IS DISTINCT FROM ge->>'geocodedAt' OR geojson->>'zoneSnapshotCapturedAt' IS DISTINCT FROM z->>'capturedAt' OR geojson->>'geocodeConfidence' IS DISTINCT FROM ge->'geocode'->>'confidence'
 OR geojson->>'geocodeSource' IS DISTINCT FROM 'google_maps' OR geojson->>'costMultiplier' IS DISTINCT FROM trim_scale(zone.cost_multiplier)::text OR geojson->>'zoneMinFloorPct' IS DISTINCT FROM trim_scale(zone.min_profit_shield_pct)::text
 OR policy->>'commercialChannel' IS DISTINCT FROM 'premium' OR policy->>'geoRiskClass' IS DISTINCT FROM 'coastal' THEN RAISE EXCEPTION 'CALCULATOR_POLICY_INVALID' USING ERRCODE='P0001';END IF;
 SELECT id,tenant_id,updated_at,profit_shield_overrides,geo_floor_overrides INTO settings FROM public.tenant_settings WHERE tenant_id=(b->>'tenantId')::uuid FOR SHARE;
 IF NOT FOUND OR jsonb_typeof(settings.profit_shield_overrides) IS DISTINCT FROM 'object' OR jsonb_typeof(settings.geo_floor_overrides) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CALCULATOR_POLICY_INVALID' USING ERRCODE='P0001';END IF;
 IF settings.profit_shield_overrides?'premium' THEN channel_override:=settings.profit_shield_overrides->>'premium';IF channel_override IS NULL OR channel_override!~'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION 'CALCULATOR_POLICY_INVALID' USING ERRCODE='P0001';END IF;channel_override:=trim_scale(channel_override::numeric)::text;END IF;
 IF settings.geo_floor_overrides?'coastal' THEN geo_override:=settings.geo_floor_overrides->>'coastal';IF geo_override IS NULL OR geo_override!~'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION 'CALCULATOR_POLICY_INVALID' USING ERRCODE='P0001';END IF;geo_override:=trim_scale(geo_override::numeric)::text;END IF;
 IF channel_override::numeric>100 OR geo_override::numeric>100 OR (policy->'floors'->>'channelBasePct')!~'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$' OR (policy->'floors'->>'geoBasePct')!~'^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$' THEN RAISE EXCEPTION 'CALCULATOR_POLICY_INVALID' USING ERRCODE='P0001';END IF;
 floor:=greatest((policy->'floors'->>'channelBasePct')::numeric,(policy->'floors'->>'geoBasePct')::numeric,channel_override::numeric,geo_override::numeric);
 IF floor IS NULL OR floor>100 OR floor<zone.min_profit_shield_pct THEN RAISE EXCEPTION 'CALCULATOR_POLICY_INVALID' USING ERRCODE='P0001';END IF;
 policy:=jsonb_set(policy,'{tenantSettings}',jsonb_build_object('settingsId',settings.id,'settingsUpdatedAt',structr_financial.utc_v1(settings.updated_at),'channelOverridePct',channel_override,'geoOverridePct',geo_override));
 policy:=jsonb_set(policy,'{floors,effectiveFloorPct}',to_jsonb(trim_scale(floor)::text));
 -- Lock parents before children; UPDATE locks conflict with new FK children so a
 -- concurrent BOM/price insertion cannot evade the acquired source snapshot.
 seen:=0;
 FOR cost_code_row IN SELECT id,tenant_id,code,name,default_cost_type_id,default_unit_id,is_active,updated_at FROM public.cost_codes WHERE id=ANY(code_ids) ORDER BY id FOR UPDATE LOOP
  seen:=seen+1;IF cost_code_row.tenant_id::text IS DISTINCT FROM b->>'tenantId' THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_TENANT_MISMATCH' USING ERRCODE='P0001';END IF;
  IF cost_code_row.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INACTIVE' USING ERRCODE='P0001';END IF;
  IF NOT(cost_code_row.default_cost_type_id=ANY(type_ids)) OR NOT(cost_code_row.default_unit_id=ANY(unit_ids)) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INCOMPATIBLE' USING ERRCODE='P0001';END IF;
  code_rows:=code_rows||jsonb_build_array(jsonb_build_object('id',cost_code_row.id,'tenantId',cost_code_row.tenant_id,'code',cost_code_row.code,'name',cost_code_row.name,'defaultCostTypeId',cost_code_row.default_cost_type_id,'defaultUnitId',cost_code_row.default_unit_id,'isActive',cost_code_row.is_active,'revision',md5(to_jsonb(cost_code_row)::text)));
 END LOOP;
 IF seen<>cardinality(code_ids) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_MISSING' USING ERRCODE='P0001';END IF;
 seen:=0;
 FOR kind IN SELECT id,name,is_active,updated_at FROM public.cost_types WHERE id=ANY(type_ids) ORDER BY id FOR SHARE LOOP
  seen:=seen+1;classification:=m->'costTypeClassifications'->kind.id::text;
  IF kind.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INACTIVE' USING ERRCODE='P0001';END IF;
  IF classification->>'name' IS DISTINCT FROM kind.name OR classification->>'componentType' IS NULL OR classification->>'componentType' NOT IN ('material','labor','subcontract','equipment','permit','admin') THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INCOMPATIBLE' USING ERRCODE='P0001';END IF;
  type_rows:=type_rows||jsonb_build_array(jsonb_build_object('id',kind.id,'componentType',classification->>'componentType','isActive',kind.is_active,'revision',md5(to_jsonb(kind)::text)));
 END LOOP;
 IF seen<>cardinality(type_ids) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_MISSING' USING ERRCODE='P0001';END IF;
 seen:=0;
 FOR unit IN SELECT id,abbreviation,is_active,updated_at FROM public.units WHERE id=ANY(unit_ids) ORDER BY id FOR SHARE LOOP
  seen:=seen+1;IF unit.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INACTIVE' USING ERRCODE='P0001';END IF;
  unit_rows:=unit_rows||jsonb_build_array(jsonb_build_object('id',unit.id,'abbreviation',unit.abbreviation,'isActive',unit.is_active,'revision',md5(to_jsonb(unit)::text)));
 END LOOP;
 IF seen<>cardinality(unit_ids) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_MISSING' USING ERRCODE='P0001';END IF;
 seen:=0;
 FOR price IN SELECT id,cost_code_id,unit_id,unit_cost,unit_price,source,effective_date,expiration_date,is_active,created_at,updated_by FROM public.cost_code_pricing_history WHERE cost_code_id=ANY(code_ids) ORDER BY id FOR SHARE LOOP
  seen:=seen+1;IF seen>5000 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_CAPACITY' USING ERRCODE='P0001';END IF;
  IF price.unit_cost<0 OR price.unit_cost>1000000000 OR price.unit_price<=0 OR price.unit_price>1000000000 OR price.unit_cost IS NULL OR price.unit_price IS NULL THEN RAISE EXCEPTION 'CALCULATOR_NUMBER_INVALID' USING ERRCODE='P0001';END IF;
  IF price.effective_date IS NULL OR NOT isfinite(price.effective_date) OR (price.expiration_date IS NOT NULL AND (NOT isfinite(price.expiration_date) OR price.expiration_date<=price.effective_date)) THEN RAISE EXCEPTION 'CALCULATOR_PRICE_NOT_EFFECTIVE' USING ERRCODE='P0001';END IF;
  price_rows:=price_rows||jsonb_build_array(jsonb_build_object('id',price.id,'costCodeId',price.cost_code_id,'unitId',price.unit_id,'unitCost',price.unit_cost::text,'unitPrice',price.unit_price::text,'source',price.source,'effectiveDate',price.effective_date::text,'expirationDate',price.expiration_date::text,'isActive',price.is_active,'revision',md5(to_jsonb(price)::text)));
 END LOOP;
 seen:=0;
 FOR assembly IN SELECT id,tenant_id,name,category,default_unit_id,base_unit_qty,waste_factor,region,code,trade,finish_level,coastal_modifier,is_active,updated_at FROM public.assemblies WHERE id=ANY(assembly_ids) ORDER BY id FOR UPDATE LOOP
  seen:=seen+1;
  IF assembly.tenant_id::text IS DISTINCT FROM b->>'tenantId' THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_TENANT_MISMATCH' USING ERRCODE='P0001';END IF;
  IF assembly.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INACTIVE' USING ERRCODE='P0001';END IF;
  IF assembly.base_unit_qty IS DISTINCT FROM 1 OR assembly.waste_factor IS DISTINCT FROM 0 OR assembly.coastal_modifier IS DISTINCT FROM 1 OR assembly.region IS DISTINCT FROM 'charleston_sc' OR assembly.finish_level IS DISTINCT FROM 'standard' OR NOT(assembly.default_unit_id=ANY(unit_ids)) THEN RAISE EXCEPTION 'CALCULATOR_CONTEXT_UNSUPPORTED' USING ERRCODE='P0001';END IF;
  components:='[]';
  FOR component IN SELECT id,assembly_id,cost_code_id,cost_type_id,unit_id,description,default_qty_per_unit,waste_factor,component_type,unit_cost_override,is_optional,sort_order,updated_at FROM public.assembly_items WHERE assembly_id=assembly.id ORDER BY sort_order,id FOR SHARE LOOP
   total_lines:=total_lines+1;IF total_lines>1000 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_CAPACITY' USING ERRCODE='P0001';END IF;
   IF component.unit_cost_override IS NOT NULL THEN RAISE EXCEPTION 'CALCULATOR_OVERRIDE_UNSUPPORTED' USING ERRCODE='P0001';END IF;
   IF component.is_optional IS DISTINCT FROM false OR component.waste_factor IS DISTINCT FROM 0 OR component.default_qty_per_unit IS NULL OR component.default_qty_per_unit<=0 OR component.default_qty_per_unit>1000000 OR component.default_qty_per_unit<>round(component.default_qty_per_unit,6) OR NOT(component.cost_code_id=ANY(code_ids)) OR NOT(component.cost_type_id=ANY(type_ids)) OR NOT(component.unit_id=ANY(unit_ids)) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INCOMPATIBLE' USING ERRCODE='P0001';END IF;
   SELECT * INTO v FROM jsonb_array_elements(code_rows) j WHERE j->>'id'=component.cost_code_id::text;
   IF v->>'defaultCostTypeId' IS DISTINCT FROM component.cost_type_id::text OR v->>'defaultUnitId' IS DISTINCT FROM component.unit_id::text OR m->'costTypeClassifications'->component.cost_type_id::text->>'componentType' IS DISTINCT FROM component.component_type THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INCOMPATIBLE' USING ERRCODE='P0001';END IF;
   SELECT count(*) INTO found_count FROM jsonb_array_elements(price_rows) j WHERE j->>'costCodeId'=component.cost_code_id::text;
   IF found_count=0 THEN RAISE EXCEPTION 'CALCULATOR_PRICE_MISSING' USING ERRCODE='P0001';END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(price_rows) j WHERE j->>'costCodeId'=component.cost_code_id::text AND j->>'unitId'=component.unit_id::text) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INCOMPATIBLE' USING ERRCODE='P0001';END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(price_rows) j WHERE j->>'costCodeId'=component.cost_code_id::text AND j->>'unitId'=component.unit_id::text AND j->'isActive'='true'::jsonb) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INACTIVE' USING ERRCODE='P0001';END IF;
   SELECT count(*) INTO found_count FROM jsonb_array_elements(price_rows) j WHERE j->>'costCodeId'=component.cost_code_id::text AND j->>'unitId'=component.unit_id::text AND j->'isActive'='true'::jsonb AND (j->>'effectiveDate')::date<=day AND ((j->>'expirationDate') IS NULL OR (j->>'expirationDate')::date>day);
   IF found_count=0 THEN RAISE EXCEPTION 'CALCULATOR_PRICE_NOT_EFFECTIVE' USING ERRCODE='P0001';ELSIF found_count>1 THEN RAISE EXCEPTION 'CALCULATOR_PRICE_AMBIGUOUS' USING ERRCODE='P0001';END IF;
   components:=components||jsonb_build_array(jsonb_build_object('id',component.id,'assemblyId',component.assembly_id,'costCodeId',component.cost_code_id,'costTypeId',component.cost_type_id,'unitId',component.unit_id,'description',component.description,'quantity',trim_scale(component.default_qty_per_unit)::text,'wasteFactor','1','componentType',component.component_type,'unitCostOverride',NULL,'isOptional',false,'sortOrder',component.sort_order,'revision',md5(to_jsonb(component)::text)));
  END LOOP;
  IF jsonb_array_length(components)=0 THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_MISSING' USING ERRCODE='P0001';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(components) j GROUP BY j->>'sortOrder' HAVING count(*)>1) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_INCOMPATIBLE' USING ERRCODE='P0001';END IF;
  assembly_rows:=assembly_rows||jsonb_build_array(jsonb_build_object('id',assembly.id,'tenantId',assembly.tenant_id,'name',assembly.name,'code',assembly.code,'category',assembly.category,'trade',assembly.trade,'isActive',assembly.is_active,'revision',md5(to_jsonb(assembly)::text),'defaultUnitId',assembly.default_unit_id,'baseUnitQty','1','wasteFactor','1','coastalModifier','1','region',assembly.region,'finishLevel',assembly.finish_level,'components',components));
 END LOOP;
 IF seen<>cardinality(assembly_ids) THEN RAISE EXCEPTION 'CALCULATOR_SOURCE_MISSING' USING ERRCODE='P0001';END IF;
 RETURN jsonb_build_object('contractVersion','calculator-v1','engineVersion','calculator-canonical-engines-v1','authority',jsonb_build_object('bindingId',b->'id','actorId',b->'actorId','tenantId',b->'tenantId'),
 'project',jsonb_build_object('id',p->'id','tenantId',p->'tenant_id','clientId',p->'client_id','isActive',true,'revision',md5(p::text)),
 'intake',jsonb_build_object('id',i->'id','tenantId',i->'tenant_id','projectId',i->'project_id','isActive',true,'revision',md5(i::text)),
 'client',jsonb_build_object('id',c->'id','tenantId',c->'tenant_id','isActive',true,'revision',md5(c::text)),
 'capturedAt',structr_financial.utc_v1(at),'evaluationDate',day::text,'timeZone','America/New_York',
 'manifest',jsonb_build_object('id',f->'id','revision',f->'manifest_hash','auditId',f->'provenance_audit_id','isActive',true,'assemblyIds',m->'assemblyIds','costCodeIds',m->'costCodeIds','costTypeIds',m->'costTypeIds','unitIds',m->'unitIds','sharedSourceClassification',m->'sharedSourceClassification','dimensionSource',m->'dimensionSource'),
 'context',m->'context','policyContext',policy,'assemblies',assembly_rows,'costCodes',code_rows,'costTypes',type_rows,'units',unit_rows,'prices',price_rows);
END $$;
CREATE OR REPLACE FUNCTION structr_financial.calculator_context_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE authority jsonb;snapshot jsonb;options jsonb;
BEGIN
 authority:=structr_financial.authorize_v1(command);
 IF command->>'operation'<>'calculator.context' THEN RETURN authority->'envelope';END IF;
 snapshot:=structr_financial.snapshot_v1(authority,command);
 SELECT jsonb_agg(jsonb_build_object('assemblyId',a->'id','name',a->'name','unit',u->'abbreviation') ORDER BY n) INTO options FROM jsonb_array_elements(snapshot->'assemblies') WITH ORDINALITY ar(a,n) CROSS JOIN jsonb_array_elements(snapshot->'units') ur(u) WHERE u->>'id'=a->>'defaultUnitId';
 RETURN authority->'envelope'||jsonb_build_object('options',options);
END $$;
CREATE OR REPLACE FUNCTION structr_financial.calculator_snapshot_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE authority jsonb;
BEGIN
 IF command->>'operation' NOT IN ('calculator.calculate','calculator.create') OR command->>'operation' IS NULL THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
 authority:=structr_financial.authorize_v1(command);RETURN authority->'envelope'||jsonb_build_object('snapshot',structr_financial.snapshot_v1(authority,command));
END $$;

-- Private helpers are invoker routines; only the two non-login routine owners may execute.
GRANT CREATE ON SCHEMA structr_financial TO structr_calculator_read_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.uuid_v1(text) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.uuid_v1(text) OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.uuid_v1(text) TO structr_calculator_write_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.utc_v1(timestamptz) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.utc_v1(timestamptz) OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.utc_v1(timestamptz) TO structr_calculator_write_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.canonical_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.canonical_v1(jsonb) OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.canonical_v1(jsonb) TO structr_calculator_write_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.validate_command_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.validate_command_v1(jsonb) OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.validate_command_v1(jsonb) TO structr_calculator_write_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.authorize_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.authorize_v1(jsonb) OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.authorize_v1(jsonb) TO structr_calculator_write_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.ids_v1(jsonb,integer) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.ids_v1(jsonb,integer) OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.ids_v1(jsonb,integer) TO structr_calculator_write_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.snapshot_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.snapshot_v1(jsonb,jsonb) OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.snapshot_v1(jsonb,jsonb) TO structr_calculator_write_owner_v1;
REVOKE CREATE ON SCHEMA structr_financial FROM structr_calculator_read_owner_v1;

-- Every evidence query must see all physical rows. Never accept a filtered empty
-- snapshot/approval/revocation result as absence. No table ownership or BYPASSRLS.
CREATE FUNCTION structr_financial.evidence_boundary_v1() RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE relation oid;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.audit_logs'::regclass,'public.estimate_drafts'::regclass) AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='a1_draft_final')<>1 OR NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_trigger t ON t.tgconstraint=c.oid WHERE c.conname='a1_draft_final' AND c.conrelid='public.estimate_drafts'::regclass AND t.tgrelid=c.conrelid AND t.tgfoid='public.internal_approval_check_final_v1()'::regprocedure AND t.tgenabled='O' AND c.condeferrable AND c.condeferred) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH' USING ERRCODE='42501';END IF;
 FOR relation IN SELECT unnest(ARRAY['public.estimate_internal_approval_snapshots'::regclass,'public.estimate_internal_approvals'::regclass,'public.estimate_internal_approval_revocations'::regclass,'structr_financial.calculator_requests'::regclass,'public.historical_estimate_imports'::regclass]::oid[]) LOOP
  IF NOT row_security_active(relation) OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped AND (relation<>'public.historical_estimate_imports'::regclass OR attname IN ('id','estimate_draft_id')) AND NOT has_column_privilege(current_user,relation,attnum,'SELECT')) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH' USING ERRCODE='42501';END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=relation AND polcmd='r' AND polpermissive AND current_user::regrole=ANY(polroles) AND pg_get_expr(polqual,polrelid)='true') OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=relation AND polcmd='w' AND polpermissive AND current_user::regrole=ANY(polroles) AND pg_get_expr(polqual,polrelid)='true') OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=relation AND polcmd IN ('r','w','*') AND NOT polpermissive AND (0=ANY(polroles) OR current_user::regrole=ANY(polroles))) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH' USING ERRCODE='42501';END IF;
 END LOOP;
END $$;
CREATE FUNCTION structr_financial.recover_v1(authority jsonb,command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE b jsonb:=authority->'envelope'->'binding';f jsonb:=authority->'fixture';r structr_financial.calculator_requests;d public.estimate_drafts;a public.audit_logs;receipt jsonb;event jsonb;meta jsonb;original jsonb;
BEGIN
 PERFORM structr_financial.evidence_boundary_v1();
 SELECT * INTO r FROM structr_financial.calculator_requests WHERE binding_id=(b->>'id')::uuid AND operation='calculator.create' AND request_id=(recover_v1.command->>'requestId')::uuid FOR SHARE;
 IF NOT FOUND THEN RETURN authority->'envelope'||jsonb_build_object('receipt',NULL,'currentDraft',NULL);END IF;
 IF r.fixture_id::text IS DISTINCT FROM f->>'id' OR r.tenant_id::text IS DISTINCT FROM b->>'tenantId' OR r.actor_id::text IS DISTINCT FROM b->>'actorId' OR r.project_id::text IS DISTINCT FROM command->>'projectId' OR r.intake_form_id::text IS DISTINCT FROM command->>'intakeFormId' OR r.client_id::text IS DISTINCT FROM authority->'envelope'->>'clientId' OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_REQUEST_CONFLICT' USING ERRCODE='P0001';END IF;
 IF command->>'operation'='calculator.create' AND (r.command IS DISTINCT FROM command OR r.command_hash IS DISTINCT FROM encode(sha256(convert_to(structr_financial.canonical_v1(command),'UTF8')),'hex')) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_REQUEST_CONFLICT' USING ERRCODE='P0001';END IF;
 PERFORM structr_financial.validate_command_v1(r.command);
 IF r.command->>'operation' IS DISTINCT FROM 'calculator.create' OR r.command->>'requestId' IS DISTINCT FROM r.request_id::text OR r.command->>'projectId' IS DISTINCT FROM r.project_id::text OR r.command->>'intakeFormId' IS DISTINCT FROM r.intake_form_id::text OR r.command_hash IS DISTINCT FROM encode(sha256(convert_to(structr_financial.canonical_v1(r.command),'UTF8')),'hex') OR r.source_hash IS DISTINCT FROM r.command->>'expectedSourceHash' OR r.calculation_hash IS DISTINCT FROM r.command->>'expectedCalculationHash' THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 SELECT * INTO d FROM public.estimate_drafts WHERE id=r.draft_id FOR UPDATE;
 IF NOT FOUND OR d.tenant_id<>r.tenant_id OR d.project_id<>r.project_id OR d.intake_form_id IS DISTINCT FROM r.intake_form_id OR d.client_id IS DISTINCT FROM r.client_id OR d.created_by IS DISTINCT FROM r.actor_id OR d.source IS DISTINCT FROM 'assembly_calculator' THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 SELECT * INTO a FROM public.audit_logs WHERE id=r.audit_id;
 receipt:=r.receipt;original:=receipt->'draft';
 meta:=jsonb_build_object('contractVersion','calculator-v1','bindingId',r.binding_id,'tenantId',r.tenant_id,'actorId',r.actor_id,'operation','calculator.create','requestId',r.request_id,'commandHash',r.command_hash,'sourceHash',r.source_hash,'calculationHash',r.calculation_hash,'projectId',r.project_id,'intakeFormId',r.intake_form_id,'clientId',r.client_id);
 event:=meta||jsonb_build_object('draft',original);
 IF a.id IS NULL OR a.user_id IS DISTINCT FROM r.actor_id OR a.action IS DISTINCT FROM 'estimate_draft.create' OR a.table_name IS DISTINCT FROM 'estimate_drafts' OR a.record_id IS DISTINCT FROM r.draft_id OR a.old_values IS NOT NULL OR a.new_values IS DISTINCT FROM event OR a.ip_address IS NOT NULL OR a.user_agent IS NOT NULL OR a.created_at IS DISTINCT FROM r.created_at
 OR receipt IS DISTINCT FROM (meta||jsonb_build_object('draftId',r.draft_id,'createdAt',structr_financial.utc_v1(r.created_at),'before',NULL,'draft',original,'audit',to_jsonb(a)))
 OR original IS DISTINCT FROM to_jsonb(jsonb_populate_record(NULL::public.estimate_drafts,original))
 OR original->>'id' IS DISTINCT FROM r.draft_id::text OR original->>'tenant_id' IS DISTINCT FROM r.tenant_id::text OR original->>'project_id' IS DISTINCT FROM r.project_id::text OR original->>'intake_form_id' IS DISTINCT FROM r.intake_form_id::text OR original->>'client_id' IS DISTINCT FROM r.client_id::text OR original->>'created_by' IS DISTINCT FROM r.actor_id::text OR original->>'source' IS DISTINCT FROM 'assembly_calculator' OR original->>'status' IS DISTINCT FROM 'draft'
 OR (original->>'created_at')::timestamptz IS DISTINCT FROM r.created_at OR (original->>'updated_at')::timestamptz IS DISTINCT FROM r.created_at OR (SELECT count(*) FROM public.audit_logs WHERE record_id=r.draft_id AND action='estimate_draft.create' AND table_name='estimate_drafts')<>1 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 RETURN authority->'envelope'||jsonb_build_object('receipt',receipt,'currentDraft',to_jsonb(d));
END $$;
CREATE OR REPLACE FUNCTION structr_financial.calculator_recover_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE authority jsonb;
BEGIN
 IF command->>'operation' IS NULL OR command->>'operation' NOT IN ('calculator.create','calculator.recover') THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
 authority:=structr_financial.authorize_v1(command);RETURN structr_financial.recover_v1(authority,command);
END $$;
CREATE OR REPLACE FUNCTION structr_financial.calculator_create_v1(command jsonb,result jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE authority jsonb;snapshot jsonb;recovered jsonb;b jsonb;f jsonb;calc jsonb:=result->'calculation';legacy jsonb:=calc->'draft';source_hash text;calculation_hash text;command_hash text;calculation_command jsonb;hash_financials jsonb;at timestamptz:=date_trunc('milliseconds',transaction_timestamp());target uuid:=gen_random_uuid();audit_target uuid:=gen_random_uuid();request_target uuid:=gen_random_uuid();expected public.estimate_drafts;observed public.estimate_drafts;aud public.audit_logs;expected_audit public.audit_logs;meta jsonb;receipt jsonb;source_policy jsonb;rowcount integer;
BEGIN
 IF command->>'operation' IS DISTINCT FROM 'calculator.create' THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_INPUT_INVALID' USING ERRCODE='P0001';END IF;
 authority:=structr_financial.authorize_v1(command);recovered:=structr_financial.recover_v1(authority,command);
 IF recovered->'receipt'<>'null'::jsonb THEN RETURN recovered;END IF;
 b:=authority->'envelope'->'binding';f:=authority->'fixture';snapshot:=structr_financial.snapshot_v1(authority,command);source_policy:=snapshot->'policyContext';
 command_hash:=encode(sha256(convert_to(structr_financial.canonical_v1(command),'UTF8')),'hex');
 source_hash:=encode(sha256(convert_to(structr_financial.canonical_v1(jsonb_build_object('version','calculator-source-v1','sources',snapshot-'capturedAt')),'UTF8')),'hex');
 IF jsonb_typeof(result) IS DISTINCT FROM 'object' OR result-ARRAY['calculation','commandHash']<>'{}' OR result->>'commandHash' IS DISTINCT FROM command_hash OR jsonb_typeof(calc) IS DISTINCT FROM 'object' OR calc->>'contractVersion' IS DISTINCT FROM 'calculator-v1' OR calc->>'projectId' IS DISTINCT FROM command->>'projectId' OR calc->>'intakeFormId' IS DISTINCT FROM command->>'intakeFormId' OR calc->'selections' IS DISTINCT FROM command->'assemblies' OR calc->'context' IS DISTINCT FROM snapshot->'context' OR calc->>'sourceHash' IS DISTINCT FROM source_hash OR command->>'expectedSourceHash' IS DISTINCT FROM source_hash THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_CONFIRMATION_STALE' USING ERRCODE='P0001';END IF;
 calculation_command:=(command-ARRAY['requestId','expectedSourceHash','expectedCalculationHash'])||jsonb_build_object('operation','calculator.calculate');
 hash_financials:=jsonb_set(calc->'financials','{grossProfitPct}',to_jsonb(calc->'financials'->>'grossProfitPct'));
 calculation_hash:=encode(sha256(convert_to(structr_financial.canonical_v1(jsonb_build_object('version','calculator-calculation-v1','sourceHash',source_hash,'command',calculation_command,'financials',hash_financials,'lines',calc->'lines')),'UTF8')),'hex');
 IF calc->>'calculationHash' IS DISTINCT FROM calculation_hash OR command->>'expectedCalculationHash' IS DISTINCT FROM calculation_hash OR jsonb_typeof(calc->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(calc->'lines') NOT BETWEEN 1 AND 1000 OR jsonb_typeof(legacy) IS DISTINCT FROM 'object'
 OR calc->'provenance' IS DISTINCT FROM jsonb_build_object('engineVersion','calculator-canonical-engines-v1','evaluationDate',snapshot->'evaluationDate','timeZone',snapshot->'timeZone','fixtureId',f->'id','fixtureRevision',f->'manifest_hash','fixtureAuditId',f->'provenance_audit_id')
 OR legacy->'notes' IS DISTINCT FROM 'null'::jsonb OR legacy->>'channel' IS DISTINCT FROM 'direct' OR legacy->>'region' IS DISTINCT FROM 'charleston_sc' OR legacy->>'finishLevel' IS DISTINCT FROM 'standard' OR legacy->>'source' IS DISTINCT FROM 'assembly_calculator' THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 expected:=jsonb_populate_record(NULL::public.estimate_drafts,jsonb_build_object('id',target,'tenant_id',b->'tenantId','project_id',command->'projectId','client_id',authority->'envelope'->'clientId','intake_form_id',command->'intakeFormId','created_by',b->'actorId','status','draft','source','assembly_calculator','version',1,'bundle_name',legacy->'bundleName','channel','direct','region','charleston_sc','finish_level','standard','discount_applied',false,'subtotal_cost',legacy->'subtotalCost','subtotal_price',legacy->'subtotalPrice','gross_profit',legacy->'grossProfit','gross_profit_pct',legacy->'grossProfitPct','final_total_price',legacy->'finalTotalPrice','assembly_count',legacy->'assemblyCount','profit_shield_passed',legacy->'profitShieldPassed','profit_shield_min_pct',legacy->'profitShieldMinPct','line_items',legacy->'lineItems','assembly_selections',legacy->'assemblySelections','metadata',legacy->'metadata','warnings_json',calc->'warnings','commercial_channel','premium','profit_shield_floor_pct',source_policy->'floors'->'effectiveFloorPct','pricing_snapshot',jsonb_build_object('calculatorContractVersion','calculator-v1','sourceHash',source_hash,'calculationHash',calculation_hash,'policyContext',source_policy,'provenance',calc->'provenance','lines',calc->'lines'),'created_at',at,'updated_at',at));
 -- Explicitly defer only this nominal constraint, write, then flush under the
 -- non-login owner before any return. This also works after an earlier IMMEDIATE.
 SET CONSTRAINTS public.a1_draft_final DEFERRED;
 INSERT INTO public.estimate_drafts(id,tenant_id,project_id,client_id,intake_form_id,created_by,status,source,version,bundle_name,channel,region,finish_level,discount_applied,subtotal_cost,subtotal_price,gross_profit,gross_profit_pct,final_total_price,assembly_count,profit_shield_passed,profit_shield_min_pct,line_items,assembly_selections,metadata,warnings_json,commercial_channel,profit_shield_floor_pct,pricing_snapshot,created_at,updated_at)
 VALUES(expected.id,expected.tenant_id,expected.project_id,expected.client_id,expected.intake_form_id,expected.created_by,expected.status,expected.source,expected.version,expected.bundle_name,expected.channel,expected.region,expected.finish_level,expected.discount_applied,expected.subtotal_cost,expected.subtotal_price,expected.gross_profit,expected.gross_profit_pct,expected.final_total_price,expected.assembly_count,expected.profit_shield_passed,expected.profit_shield_min_pct,expected.line_items,expected.assembly_selections,expected.metadata,expected.warnings_json,expected.commercial_channel,expected.profit_shield_floor_pct,expected.pricing_snapshot,at,at);
 GET DIAGNOSTICS rowcount=ROW_COUNT;IF rowcount<>1 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 SET CONSTRAINTS public.a1_draft_final IMMEDIATE;
 SELECT * INTO observed FROM public.estimate_drafts WHERE id=target FOR UPDATE;
 IF NOT FOUND OR to_jsonb(observed) IS DISTINCT FROM to_jsonb(expected) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 meta:=jsonb_build_object('contractVersion','calculator-v1','bindingId',b->'id','tenantId',b->'tenantId','actorId',b->'actorId','operation','calculator.create','requestId',command->'requestId','commandHash',command_hash,'sourceHash',source_hash,'calculationHash',calculation_hash,'projectId',command->'projectId','intakeFormId',command->'intakeFormId','clientId',authority->'envelope'->'clientId');
 expected_audit:=jsonb_populate_record(NULL::public.audit_logs,jsonb_build_object('id',audit_target,'user_id',b->'actorId','action','estimate_draft.create','table_name','estimate_drafts','record_id',target,'old_values',NULL,'new_values',meta||jsonb_build_object('draft',to_jsonb(observed)),'ip_address',NULL,'user_agent',NULL,'created_at',at));
 INSERT INTO public.audit_logs(id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at) VALUES(expected_audit.id,expected_audit.user_id,expected_audit.action,expected_audit.table_name,expected_audit.record_id,expected_audit.old_values,expected_audit.new_values,expected_audit.ip_address,expected_audit.user_agent,at);
 GET DIAGNOSTICS rowcount=ROW_COUNT;IF rowcount<>1 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 SELECT * INTO aud FROM public.audit_logs WHERE id=audit_target;
 IF NOT FOUND OR to_jsonb(aud) IS DISTINCT FROM to_jsonb(expected_audit) OR (SELECT count(*) FROM public.audit_logs WHERE action='estimate_draft.create' AND table_name='estimate_drafts' AND record_id=target)<>1 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 receipt:=meta||jsonb_build_object('draftId',target,'createdAt',structr_financial.utc_v1(at),'before',NULL,'draft',to_jsonb(observed),'audit',to_jsonb(aud));
 INSERT INTO structr_financial.calculator_requests(id,binding_id,fixture_id,tenant_id,actor_id,project_id,intake_form_id,client_id,draft_id,operation,request_id,command,command_hash,source_hash,calculation_hash,receipt,audit_id,created_at,updated_at)
 VALUES(request_target,(b->>'id')::uuid,(f->>'id')::uuid,(b->>'tenantId')::uuid,(b->>'actorId')::uuid,(command->>'projectId')::uuid,(command->>'intakeFormId')::uuid,(authority->'envelope'->>'clientId')::uuid,target,'calculator.create',(command->>'requestId')::uuid,command,command_hash,source_hash,calculation_hash,receipt,audit_target,at,at);
 GET DIAGNOSTICS rowcount=ROW_COUNT;IF rowcount<>1 THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 recovered:=structr_financial.recover_v1(authority,command);
 IF recovered->'receipt' IS DISTINCT FROM receipt OR recovered->'currentDraft' IS DISTINCT FROM to_jsonb(observed) THEN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_RECEIPT_INVALID' USING ERRCODE='P0001';END IF;
 RETURN recovered;
END $$;
GRANT CREATE ON SCHEMA structr_financial TO structr_calculator_read_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.evidence_boundary_v1() FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.evidence_boundary_v1() OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.evidence_boundary_v1() TO structr_calculator_write_owner_v1;
REVOKE ALL ON FUNCTION structr_financial.recover_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION structr_financial.recover_v1(jsonb,jsonb) OWNER TO structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.recover_v1(jsonb,jsonb) TO structr_calculator_write_owner_v1;
REVOKE CREATE ON SCHEMA structr_financial FROM structr_calculator_read_owner_v1;

-- Freeze the exact resulting definitions and effective object ACLs atomically.
DO $postflight$ DECLARE observed text; BEGIN
WITH objects AS (
SELECT 'relation:'||n.nspname||'.'||c.relname AS identity,
 jsonb_build_object('kind',c.relkind,'owner',CASE WHEN c.relowner=current_user::regrole THEN '$migrator' ELSE c.relowner::regrole::text END,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) x),
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(a.attacl) x),'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) AS definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private','structr_financial') AND c.relkind IN ('r','p','v','m','f','S')
UNION ALL SELECT 'constraint:'||n.nspname||'.'||c.relname||'.'||x.conname,
 jsonb_build_object('definition',pg_get_constraintdef(x.oid,true),'validated',x.convalidated,'deferred',x.condeferred,'deferrable',x.condeferrable)
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private','structr_financial')
UNION ALL SELECT 'index:'||n.nspname||'.'||c.relname,
 jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'immediate',i.indimmediate)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private','structr_financial')
UNION ALL SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,
 jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','structr_private','structr_financial')
UNION ALL SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x),'owner',CASE WHEN p.proowner=current_user::regrole THEN '$migrator' ELSE p.proowner::regrole::text END)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','structr_private','structr_financial')
UNION ALL SELECT 'policy:'||n.nspname||'.'||c.relname||'.'||p.polname,
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN o=0 THEN 'PUBLIC' ELSE o::regrole::text END ORDER BY o::regrole::text) FROM unnest(p.polroles) o), 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private','structr_financial')
)
SELECT encode(sha256(convert_to(string_agg(identity||':'||encode(sha256(convert_to(definition::text,'UTF8')),'hex'),E'\n' ORDER BY identity),'UTF8')),'hex') INTO observed FROM objects;
IF observed IS DISTINCT FROM 'e2523193143830601ddb537d70a224567aa755241f0673fe00cb2d6ddefa79d1' THEN RAISE EXCEPTION 'FINANCIAL_LIFECYCLE_POSTFLIGHT' USING ERRCODE='42501';END IF;
END $postflight$;
