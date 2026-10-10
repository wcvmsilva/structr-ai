-- ADR-003 closed SQL foundation. LOCAL REVIEW CANDIDATE ONLY.
-- No LOGIN/password, bindings, fixtures or operation activation. Apply atomically.
-- Unknown privilege/catalog drift is refused, never repaired by this installer.
SET LOCAL search_path=pg_catalog;
DO $preflight$
DECLARE observed text; item record; api record; reachable record;
  allowed oid[]:=ARRAY[to_regprocedure('public.structr_authenticated_session_v1()'),to_regprocedure('public.structr_internal_approval_review_v1(jsonb)'),to_regprocedure('public.structr_estimate_draft_read_v1(jsonb)'),to_regprocedure('public.structr_internal_approval_record_v1(jsonb)'),to_regprocedure('structr_private.authenticated_session_v1()'),to_regprocedure('structr_private.internal_approval_review_v1(jsonb)'),to_regprocedure('structr_private.estimate_draft_read_v1(jsonb)'),to_regprocedure('structr_private.internal_approval_record_v1(jsonb)')];
BEGIN
  IF current_setting('server_version_num')<>'170011' THEN RAISE EXCEPTION 'FINANCIAL_VERSION_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF to_regnamespace('structr_financial') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1')) THEN
    RAISE EXCEPTION 'FINANCIAL_ROLE_SCHEMA_PREFLIGHT' USING ERRCODE='42501'; END IF;
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
WITH objects AS (
SELECT 'relation:'||n.nspname||'.'||c.relname AS identity,
 jsonb_build_object('kind',c.relkind,'owner',CASE WHEN c.relowner=current_user::regrole THEN '$migrator' ELSE c.relowner::regrole::text END,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) x),
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(a.attacl) x),'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) AS definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private') AND c.relkind IN ('r','p','v','m','f','S')
UNION ALL SELECT 'constraint:'||n.nspname||'.'||c.relname||'.'||x.conname,
 jsonb_build_object('definition',pg_get_constraintdef(x.oid,true),'validated',x.convalidated,'deferred',x.condeferred,'deferrable',x.condeferrable)
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private')
UNION ALL SELECT 'index:'||n.nspname||'.'||c.relname,
 jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'immediate',i.indimmediate)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private')
UNION ALL SELECT 'trigger:'||n.nspname||'.'||c.relname||'.'||t.tgname,
 jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','structr_private')
UNION ALL SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,'privilege',x.privilege_type,'grantable',x.is_grantable) ORDER BY CASE WHEN x.grantee=0 THEN 'PUBLIC' WHEN x.grantee=current_user::regrole THEN '$migrator' ELSE x.grantee::regrole::text END,x.privilege_type,x.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x),'owner',CASE WHEN p.proowner=current_user::regrole THEN '$migrator' ELSE p.proowner::regrole::text END)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','structr_private')
UNION ALL SELECT 'policy:'||n.nspname||'.'||c.relname||'.'||p.polname,
 jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,'roles',(SELECT jsonb_agg(CASE WHEN o=0 THEN 'PUBLIC' ELSE o::regrole::text END ORDER BY o::regrole::text) FROM unnest(p.polroles) o), 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','structr_private')
)
SELECT encode(sha256(convert_to(string_agg(identity||':'||encode(sha256(convert_to(definition::text,'UTF8')),'hex'),E'\n' ORDER BY identity),'UTF8')),'hex') INTO observed FROM objects;
  IF observed IS DISTINCT FROM 'e3bc46000f32b644d88658829e353b79a63a2a29170e7587aabd1704df9c2f90' THEN RAISE EXCEPTION 'FINANCIAL_CATALOG_PREFLIGHT' USING ERRCODE='42501'; END IF;
END $preflight$;

CREATE ROLE structr_calculator_login_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE structr_calculator_read_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE structr_calculator_write_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA structr_financial;
REVOKE ALL ON SCHEMA structr_financial FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT USAGE ON SCHEMA structr_financial TO structr_calculator_login_v1,structr_calculator_read_owner_v1,structr_calculator_write_owner_v1;
GRANT USAGE ON SCHEMA public TO structr_calculator_read_owner_v1,structr_calculator_write_owner_v1;
DO $connect$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO structr_calculator_login_v1',current_database()); END $connect$;
CREATE UNIQUE INDEX uq_intake_financial_context ON public.intake_forms(tenant_id,project_id,id);
CREATE UNIQUE INDEX uq_draft_financial_context ON public.estimate_drafts(tenant_id,project_id,client_id,intake_form_id,created_by,id);

CREATE TABLE structr_financial.principal_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_role text NOT NULL UNIQUE,
 subject uuid NOT NULL, actor_id uuid NOT NULL, tenant_id uuid NOT NULL,
 operations text[] NOT NULL, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 CONSTRAINT uq_financial_binding_context UNIQUE(id,tenant_id,actor_id),
 CONSTRAINT fk_financial_binding_actor FOREIGN KEY(tenant_id,actor_id) REFERENCES public.profiles(tenant_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_financial_binding_tenant FOREIGN KEY(tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT,
 CONSTRAINT ck_financial_binding_login CHECK(session_role='structr_calculator_login_v1'),
 CONSTRAINT ck_financial_binding_operations CHECK(operations=ARRAY['calculator.context','calculator.calculate','calculator.create','calculator.recover']::text[]),
 CONSTRAINT ck_financial_binding_live CHECK(deleted_at IS NULL AND isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at),
 CONSTRAINT ck_financial_binding_identity CHECK(NOT('00000000-0000-0000-0000-000000000000'::uuid=ANY(ARRAY[id,subject,actor_id,tenant_id])))
);
CREATE INDEX idx_financial_binding_actor ON structr_financial.principal_bindings(tenant_id,actor_id);
CREATE TABLE structr_financial.calculator_fixtures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),binding_id uuid NOT NULL,tenant_id uuid NOT NULL,actor_id uuid NOT NULL,
 project_id uuid NOT NULL,intake_form_id uuid NOT NULL,client_id uuid NOT NULL,
 manifest jsonb NOT NULL,manifest_hash text NOT NULL,provenance_audit_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 CONSTRAINT uq_financial_fixture_pair UNIQUE(binding_id,project_id,intake_form_id),
 CONSTRAINT uq_financial_fixture_context UNIQUE(id,binding_id,tenant_id,actor_id,project_id,intake_form_id,client_id),
 CONSTRAINT fk_financial_fixture_binding FOREIGN KEY(binding_id,tenant_id,actor_id) REFERENCES structr_financial.principal_bindings(id,tenant_id,actor_id) ON DELETE RESTRICT,
 CONSTRAINT fk_financial_fixture_project FOREIGN KEY(tenant_id,project_id,client_id) REFERENCES public.projects(tenant_id,id,client_id) ON DELETE RESTRICT,
 CONSTRAINT fk_financial_fixture_intake FOREIGN KEY(tenant_id,project_id,intake_form_id) REFERENCES public.intake_forms(tenant_id,project_id,id) ON DELETE RESTRICT,
 CONSTRAINT fk_financial_fixture_audit FOREIGN KEY(provenance_audit_id) REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
 CONSTRAINT ck_financial_fixture_manifest CHECK(jsonb_typeof(manifest)='object' AND manifest_hash~'^[0-9a-f]{64}$'),
 CONSTRAINT ck_financial_fixture_live CHECK(deleted_at IS NULL AND isfinite(created_at) AND updated_at=created_at)
);
CREATE INDEX idx_financial_fixture_project ON structr_financial.calculator_fixtures(tenant_id,project_id,intake_form_id);
CREATE TABLE structr_financial.calculator_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),binding_id uuid NOT NULL,fixture_id uuid NOT NULL,tenant_id uuid NOT NULL,actor_id uuid NOT NULL,
 project_id uuid NOT NULL,intake_form_id uuid NOT NULL,client_id uuid NOT NULL,draft_id uuid NOT NULL,
 operation text NOT NULL,request_id uuid NOT NULL,command jsonb NOT NULL,command_hash text NOT NULL,source_hash text NOT NULL,calculation_hash text NOT NULL,
 receipt jsonb NOT NULL,audit_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 CONSTRAINT uq_financial_request_identity UNIQUE(binding_id,operation,request_id),
 CONSTRAINT uq_financial_request_draft UNIQUE(draft_id),
 CONSTRAINT uq_financial_request_audit UNIQUE(audit_id),
 CONSTRAINT fk_financial_request_fixture FOREIGN KEY(fixture_id,binding_id,tenant_id,actor_id,project_id,intake_form_id,client_id) REFERENCES structr_financial.calculator_fixtures(id,binding_id,tenant_id,actor_id,project_id,intake_form_id,client_id) ON DELETE RESTRICT,
 CONSTRAINT fk_financial_request_draft FOREIGN KEY(tenant_id,project_id,client_id,intake_form_id,actor_id,draft_id) REFERENCES public.estimate_drafts(tenant_id,project_id,client_id,intake_form_id,created_by,id) ON DELETE RESTRICT,
 CONSTRAINT fk_financial_request_audit FOREIGN KEY(audit_id) REFERENCES public.audit_logs(id) ON DELETE RESTRICT,
 CONSTRAINT ck_financial_request_operation CHECK(operation='calculator.create'),
 CONSTRAINT ck_financial_request_payload CHECK(jsonb_typeof(command)='object' AND jsonb_typeof(receipt)='object'),
 CONSTRAINT ck_financial_request_hashes CHECK(command_hash~'^[0-9a-f]{64}$' AND source_hash~'^[0-9a-f]{64}$' AND calculation_hash~'^[0-9a-f]{64}$'),
 CONSTRAINT ck_financial_request_live CHECK(deleted_at IS NULL AND isfinite(created_at) AND updated_at=created_at)
);
CREATE INDEX idx_financial_request_pair ON structr_financial.calculator_requests(tenant_id,project_id,intake_form_id);

-- SQL-only trigger parity: Drizzle represents these tables/checks/FKs/policies;
-- mutation rejection must remain in SQL because Drizzle has no trigger DSL.
CREATE FUNCTION structr_financial.immutable_evidence_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FINANCIAL_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION structr_financial.immutable_evidence_v1() FROM PUBLIC;
CREATE FUNCTION structr_financial.binding_identity_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.actor_id AND tenant_id=NEW.tenant_id AND external_open_id=NEW.subject::text) THEN RAISE EXCEPTION 'FINANCIAL_BINDING_SUBJECT_MISMATCH' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.is_active AND NOT NEW.is_active AND (to_jsonb(OLD)-ARRAY['is_active','updated_at'])=(to_jsonb(NEW)-ARRAY['is_active','updated_at']) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'FINANCIAL_BINDING_IMMUTABLE' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION structr_financial.binding_identity_v1() FROM PUBLIC;
CREATE TRIGGER financial_binding_identity BEFORE INSERT OR UPDATE OR DELETE ON structr_financial.principal_bindings FOR EACH ROW EXECUTE FUNCTION structr_financial.binding_identity_v1();
CREATE TRIGGER financial_binding_no_truncate BEFORE TRUNCATE ON structr_financial.principal_bindings FOR EACH STATEMENT EXECUTE FUNCTION structr_financial.immutable_evidence_v1();
CREATE TRIGGER financial_fixture_immutable BEFORE UPDATE OR DELETE ON structr_financial.calculator_fixtures FOR EACH ROW EXECUTE FUNCTION structr_financial.immutable_evidence_v1();
CREATE TRIGGER financial_fixture_no_truncate BEFORE TRUNCATE ON structr_financial.calculator_fixtures FOR EACH STATEMENT EXECUTE FUNCTION structr_financial.immutable_evidence_v1();
CREATE TRIGGER financial_request_immutable BEFORE UPDATE OR DELETE ON structr_financial.calculator_requests FOR EACH ROW EXECUTE FUNCTION structr_financial.immutable_evidence_v1();
CREATE TRIGGER financial_request_no_truncate BEFORE TRUNCATE ON structr_financial.calculator_requests FOR EACH STATEMENT EXECUTE FUNCTION structr_financial.immutable_evidence_v1();
GRANT SELECT(id,tenant_id,external_open_id,role,is_active),UPDATE(id) ON public.profiles TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,external_open_id,role,is_active),UPDATE(id) ON public.profiles TO structr_calculator_write_owner_v1;
GRANT SELECT(id,is_active,timezone),UPDATE(id) ON public.tenants TO structr_calculator_read_owner_v1;
GRANT SELECT(id,is_active,timezone),UPDATE(id) ON public.tenants TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,client_id,owner_user_id,deleted_at,name,commercial_channel,channel,geo_risk_class,address,city,state,zip,county,latitude,longitude,geocoded_at,geocode_confidence,geocode_source,geocoded_address,zone,zone_modifier_snapshot,updated_at),UPDATE(id) ON public.projects TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,client_id,owner_user_id,deleted_at,name,commercial_channel,channel,geo_risk_class,address,city,state,zip,county,latitude,longitude,geocoded_at,geocode_confidence,geocode_source,geocoded_address,zone,zone_modifier_snapshot,updated_at),UPDATE(id) ON public.projects TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,project_id,user_id,project_role,permissions,is_active),UPDATE(id) ON public.project_members TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,project_id,user_id,project_role,permissions,is_active),UPDATE(id) ON public.project_members TO structr_calculator_write_owner_v1;
GRANT SELECT(id,name),UPDATE(id) ON public.roles TO structr_calculator_read_owner_v1;
GRANT SELECT(id,name),UPDATE(id) ON public.roles TO structr_calculator_write_owner_v1;
GRANT SELECT(id,role_id,permission_id),UPDATE(id) ON public.role_permissions TO structr_calculator_read_owner_v1;
GRANT SELECT(id,role_id,permission_id),UPDATE(id) ON public.role_permissions TO structr_calculator_write_owner_v1;
GRANT SELECT(id,resource,action),UPDATE(id) ON public.permissions TO structr_calculator_read_owner_v1;
GRANT SELECT(id,resource,action),UPDATE(id) ON public.permissions TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,project_id,status,form_data,created_at,updated_at),UPDATE(id) ON public.intake_forms TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,project_id,status,form_data,created_at,updated_at),UPDATE(id) ON public.intake_forms TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,is_active,deleted_at,updated_at),UPDATE(id) ON public.clients TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,is_active,deleted_at,updated_at),UPDATE(id) ON public.clients TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,updated_at,profit_shield_overrides,geo_floor_overrides),UPDATE(id) ON public.tenant_settings TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,updated_at,profit_shield_overrides,geo_floor_overrides),UPDATE(id) ON public.tenant_settings TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,is_active,zone_name,name,coastal_exposure_level,cost_multiplier,labor_modifier,material_modifier,logistics_modifier,contingency_pct,min_profit_shield_pct),UPDATE(id) ON public.geo_zones TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,is_active,zone_name,name,coastal_exposure_level,cost_multiplier,labor_modifier,material_modifier,logistics_modifier,contingency_pct,min_profit_shield_pct),UPDATE(id) ON public.geo_zones TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,name,category,default_unit_id,base_unit_qty,waste_factor,region,code,trade,finish_level,coastal_modifier,is_active,updated_at),UPDATE(id) ON public.assemblies TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,name,category,default_unit_id,base_unit_qty,waste_factor,region,code,trade,finish_level,coastal_modifier,is_active,updated_at),UPDATE(id) ON public.assemblies TO structr_calculator_write_owner_v1;
GRANT SELECT(id,assembly_id,cost_code_id,cost_type_id,unit_id,description,default_qty_per_unit,waste_factor,component_type,unit_cost_override,is_optional,sort_order,updated_at),UPDATE(id) ON public.assembly_items TO structr_calculator_read_owner_v1;
GRANT SELECT(id,assembly_id,cost_code_id,cost_type_id,unit_id,description,default_qty_per_unit,waste_factor,component_type,unit_cost_override,is_optional,sort_order,updated_at),UPDATE(id) ON public.assembly_items TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,code,name,default_cost_type_id,default_unit_id,is_active,updated_at),UPDATE(id) ON public.cost_codes TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,code,name,default_cost_type_id,default_unit_id,is_active,updated_at),UPDATE(id) ON public.cost_codes TO structr_calculator_write_owner_v1;
GRANT SELECT(id,cost_code_id,unit_id,unit_cost,unit_price,source,effective_date,expiration_date,is_active,created_at,updated_by),UPDATE(id) ON public.cost_code_pricing_history TO structr_calculator_read_owner_v1;
GRANT SELECT(id,cost_code_id,unit_id,unit_cost,unit_price,source,effective_date,expiration_date,is_active,created_at,updated_by),UPDATE(id) ON public.cost_code_pricing_history TO structr_calculator_write_owner_v1;
GRANT SELECT(id,name,is_active,updated_at),UPDATE(id) ON public.cost_types TO structr_calculator_read_owner_v1;
GRANT SELECT(id,name,is_active,updated_at),UPDATE(id) ON public.cost_types TO structr_calculator_write_owner_v1;
GRANT SELECT(id,abbreviation,is_active,updated_at),UPDATE(id) ON public.units TO structr_calculator_read_owner_v1;
GRANT SELECT(id,abbreviation,is_active,updated_at),UPDATE(id) ON public.units TO structr_calculator_write_owner_v1;
GRANT SELECT(id,estimate_draft_id),UPDATE(id) ON public.historical_estimate_imports TO structr_calculator_read_owner_v1;
GRANT SELECT(id,estimate_draft_id),UPDATE(id) ON public.historical_estimate_imports TO structr_calculator_write_owner_v1;
GRANT SELECT(id,estimate_id,project_id,status,source,draft_data,bundle_name,zone,finish_level,trade,pricing_schema_version,channel,region,created_by,coastal_modifier,subtotal_price,subtotal_cost,final_total_price,discount_applied,discount_amount,gross_profit,gross_profit_pct,profit_shield_passed,profit_shield_min_pct,assembly_selections,line_items,intake_form_id,warnings_json,scope_draft_id,notes,metadata,bundle_id,client_id,assembly_count,approved_by,approved_at,rejected_by,rejected_at,rejection_reason,created_at,updated_at,tenant_id,version,superseded_by,supersedes_id,locked_at,change_order_of,change_order_reason,commercial_channel,profit_shield_floor_pct,profit_shield_evaluation,pricing_snapshot,a1_version_request_id,a1_version_request_hash),UPDATE(id) ON public.estimate_drafts TO structr_calculator_read_owner_v1;
GRANT SELECT(id,estimate_id,project_id,status,source,draft_data,bundle_name,zone,finish_level,trade,pricing_schema_version,channel,region,created_by,coastal_modifier,subtotal_price,subtotal_cost,final_total_price,discount_applied,discount_amount,gross_profit,gross_profit_pct,profit_shield_passed,profit_shield_min_pct,assembly_selections,line_items,intake_form_id,warnings_json,scope_draft_id,notes,metadata,bundle_id,client_id,assembly_count,approved_by,approved_at,rejected_by,rejected_at,rejection_reason,created_at,updated_at,tenant_id,version,superseded_by,supersedes_id,locked_at,change_order_of,change_order_reason,commercial_channel,profit_shield_floor_pct,profit_shield_evaluation,pricing_snapshot,a1_version_request_id,a1_version_request_hash),UPDATE(id) ON public.estimate_drafts TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,draft_version,created_at,updated_at,deleted_at,contract_version,content_hash,currency_code,currency_basis,subtotal_price_minor,discount_minor,final_price_minor,estimated_cost_minor,policy_version,policy_hash,snapshot_payload,policy_evaluation,captured_by),UPDATE(id) ON public.estimate_internal_approval_snapshots TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,draft_version,created_at,updated_at,deleted_at,contract_version,content_hash,currency_code,currency_basis,subtotal_price_minor,discount_minor,final_price_minor,estimated_cost_minor,policy_version,policy_hash,snapshot_payload,policy_evaluation,captured_by),UPDATE(id) ON public.estimate_internal_approval_snapshots TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,snapshot_id,request_id,request_hash,approved_by,approved_at,reason,contract_version),UPDATE(id) ON public.estimate_internal_approvals TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,snapshot_id,request_id,request_hash,approved_by,approved_at,reason,contract_version),UPDATE(id) ON public.estimate_internal_approvals TO structr_calculator_write_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,approval_id,request_id,request_hash,revoked_by,revoked_at,reason,contract_version),UPDATE(id) ON public.estimate_internal_approval_revocations TO structr_calculator_read_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,approval_id,request_id,request_hash,revoked_by,revoked_at,reason,contract_version),UPDATE(id) ON public.estimate_internal_approval_revocations TO structr_calculator_write_owner_v1;
GRANT SELECT(id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at) ON public.audit_logs TO structr_calculator_read_owner_v1;
GRANT SELECT(id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at) ON public.audit_logs TO structr_calculator_write_owner_v1;
GRANT INSERT(id,tenant_id,project_id,client_id,intake_form_id,created_by,version,source,status,draft_data,bundle_name,zone,finish_level,trade,pricing_schema_version,channel,region,coastal_modifier,subtotal_price,subtotal_cost,final_total_price,discount_applied,discount_amount,gross_profit,gross_profit_pct,profit_shield_passed,profit_shield_min_pct,assembly_selections,line_items,warnings_json,metadata,assembly_count,commercial_channel,profit_shield_floor_pct,pricing_snapshot,created_at,updated_at) ON public.estimate_drafts TO structr_calculator_write_owner_v1;
GRANT INSERT(id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at) ON public.audit_logs TO structr_calculator_write_owner_v1;
ALTER TABLE structr_financial.principal_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON structr_financial.principal_bindings FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT SELECT(id,session_role,subject,actor_id,tenant_id,operations,is_active,created_at,updated_at,deleted_at),UPDATE(id) ON structr_financial.principal_bindings TO structr_calculator_read_owner_v1;
CREATE POLICY financial_principal_bindings_read_select ON structr_financial.principal_bindings FOR SELECT TO structr_calculator_read_owner_v1 USING(true);
CREATE POLICY financial_principal_bindings_read_update ON structr_financial.principal_bindings FOR UPDATE TO structr_calculator_read_owner_v1 USING(true) WITH CHECK(false);
GRANT SELECT(id,session_role,subject,actor_id,tenant_id,operations,is_active,created_at,updated_at,deleted_at),UPDATE(id) ON structr_financial.principal_bindings TO structr_calculator_write_owner_v1;
CREATE POLICY financial_principal_bindings_write_select ON structr_financial.principal_bindings FOR SELECT TO structr_calculator_write_owner_v1 USING(true);
CREATE POLICY financial_principal_bindings_write_update ON structr_financial.principal_bindings FOR UPDATE TO structr_calculator_write_owner_v1 USING(true) WITH CHECK(false);
ALTER TABLE structr_financial.calculator_fixtures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON structr_financial.calculator_fixtures FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT SELECT(id,binding_id,tenant_id,actor_id,project_id,intake_form_id,client_id,manifest,manifest_hash,provenance_audit_id,created_at,updated_at,deleted_at),UPDATE(id) ON structr_financial.calculator_fixtures TO structr_calculator_read_owner_v1;
CREATE POLICY financial_calculator_fixtures_read_select ON structr_financial.calculator_fixtures FOR SELECT TO structr_calculator_read_owner_v1 USING(true);
CREATE POLICY financial_calculator_fixtures_read_update ON structr_financial.calculator_fixtures FOR UPDATE TO structr_calculator_read_owner_v1 USING(true) WITH CHECK(false);
GRANT SELECT(id,binding_id,tenant_id,actor_id,project_id,intake_form_id,client_id,manifest,manifest_hash,provenance_audit_id,created_at,updated_at,deleted_at),UPDATE(id) ON structr_financial.calculator_fixtures TO structr_calculator_write_owner_v1;
CREATE POLICY financial_calculator_fixtures_write_select ON structr_financial.calculator_fixtures FOR SELECT TO structr_calculator_write_owner_v1 USING(true);
CREATE POLICY financial_calculator_fixtures_write_update ON structr_financial.calculator_fixtures FOR UPDATE TO structr_calculator_write_owner_v1 USING(true) WITH CHECK(false);
ALTER TABLE structr_financial.calculator_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON structr_financial.calculator_requests FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT SELECT(id,binding_id,fixture_id,tenant_id,actor_id,project_id,intake_form_id,client_id,draft_id,operation,request_id,command,command_hash,source_hash,calculation_hash,receipt,audit_id,created_at,updated_at,deleted_at),UPDATE(id) ON structr_financial.calculator_requests TO structr_calculator_read_owner_v1;
CREATE POLICY financial_calculator_requests_read_select ON structr_financial.calculator_requests FOR SELECT TO structr_calculator_read_owner_v1 USING(true);
CREATE POLICY financial_calculator_requests_read_update ON structr_financial.calculator_requests FOR UPDATE TO structr_calculator_read_owner_v1 USING(true) WITH CHECK(false);
GRANT SELECT(id,binding_id,fixture_id,tenant_id,actor_id,project_id,intake_form_id,client_id,draft_id,operation,request_id,command,command_hash,source_hash,calculation_hash,receipt,audit_id,created_at,updated_at,deleted_at),UPDATE(id) ON structr_financial.calculator_requests TO structr_calculator_write_owner_v1;
CREATE POLICY financial_calculator_requests_write_select ON structr_financial.calculator_requests FOR SELECT TO structr_calculator_write_owner_v1 USING(true);
CREATE POLICY financial_calculator_requests_write_update ON structr_financial.calculator_requests FOR UPDATE TO structr_calculator_write_owner_v1 USING(true) WITH CHECK(false);
GRANT INSERT(id,binding_id,fixture_id,tenant_id,actor_id,project_id,intake_form_id,client_id,draft_id,operation,request_id,command,command_hash,source_hash,calculation_hash,receipt,audit_id,created_at,updated_at,deleted_at) ON structr_financial.calculator_requests TO structr_calculator_write_owner_v1;
CREATE POLICY financial_request_insert ON structr_financial.calculator_requests FOR INSERT TO structr_calculator_write_owner_v1 WITH CHECK(true);
CREATE POLICY financial_historical_read_select ON public.historical_estimate_imports FOR SELECT TO structr_calculator_read_owner_v1 USING(true);
CREATE POLICY financial_historical_read_update ON public.historical_estimate_imports FOR UPDATE TO structr_calculator_read_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY financial_historical_write_select ON public.historical_estimate_imports FOR SELECT TO structr_calculator_write_owner_v1 USING(true);
CREATE POLICY financial_historical_write_update ON public.historical_estimate_imports FOR UPDATE TO structr_calculator_write_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY financial_snapshots_read_select ON public.estimate_internal_approval_snapshots FOR SELECT TO structr_calculator_read_owner_v1 USING(true);
CREATE POLICY financial_snapshots_read_update ON public.estimate_internal_approval_snapshots FOR UPDATE TO structr_calculator_read_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY financial_snapshots_write_select ON public.estimate_internal_approval_snapshots FOR SELECT TO structr_calculator_write_owner_v1 USING(true);
CREATE POLICY financial_snapshots_write_update ON public.estimate_internal_approval_snapshots FOR UPDATE TO structr_calculator_write_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY financial_approvals_read_select ON public.estimate_internal_approvals FOR SELECT TO structr_calculator_read_owner_v1 USING(true);
CREATE POLICY financial_approvals_read_update ON public.estimate_internal_approvals FOR UPDATE TO structr_calculator_read_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY financial_approvals_write_select ON public.estimate_internal_approvals FOR SELECT TO structr_calculator_write_owner_v1 USING(true);
CREATE POLICY financial_approvals_write_update ON public.estimate_internal_approvals FOR UPDATE TO structr_calculator_write_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY financial_revocations_read_select ON public.estimate_internal_approval_revocations FOR SELECT TO structr_calculator_read_owner_v1 USING(true);
CREATE POLICY financial_revocations_read_update ON public.estimate_internal_approval_revocations FOR UPDATE TO structr_calculator_read_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY financial_revocations_write_select ON public.estimate_internal_approval_revocations FOR SELECT TO structr_calculator_write_owner_v1 USING(true);
CREATE POLICY financial_revocations_write_update ON public.estimate_internal_approval_revocations FOR UPDATE TO structr_calculator_write_owner_v1 USING(true) WITH CHECK(false);
GRANT EXECUTE ON FUNCTION public.internal_approval_check_lineage_v1(uuid) TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION public.internal_approval_draft_matches_v1(public.estimate_drafts,jsonb,boolean) TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION public.internal_approval_matches_v1(jsonb,jsonb) TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION public.internal_approval_valid_snapshot_v1(jsonb,jsonb) TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION public.internal_approval_channel_v1(text) TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION public.internal_approval_pricing_channel_v1(text) TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION public.internal_approval_trim_v1(text) TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION public.internal_approval_lookup_key_v1(text) TO structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION public.internal_approval_legacy_number_v1(jsonb,integer) TO structr_calculator_write_owner_v1;
CREATE FUNCTION structr_financial.calculator_context_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_CLOSED' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION structr_financial.calculator_context_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT CREATE ON SCHEMA structr_financial TO structr_calculator_read_owner_v1;
ALTER FUNCTION structr_financial.calculator_context_v1(jsonb) OWNER TO structr_calculator_read_owner_v1;
REVOKE CREATE ON SCHEMA structr_financial FROM structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.calculator_context_v1(jsonb) TO structr_calculator_login_v1;
CREATE FUNCTION structr_financial.calculator_snapshot_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_CLOSED' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION structr_financial.calculator_snapshot_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT CREATE ON SCHEMA structr_financial TO structr_calculator_read_owner_v1;
ALTER FUNCTION structr_financial.calculator_snapshot_v1(jsonb) OWNER TO structr_calculator_read_owner_v1;
REVOKE CREATE ON SCHEMA structr_financial FROM structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.calculator_snapshot_v1(jsonb) TO structr_calculator_login_v1;
CREATE FUNCTION structr_financial.calculator_create_v1(command jsonb,result jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_CLOSED' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION structr_financial.calculator_create_v1(jsonb,jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT CREATE ON SCHEMA structr_financial TO structr_calculator_write_owner_v1;
ALTER FUNCTION structr_financial.calculator_create_v1(jsonb,jsonb) OWNER TO structr_calculator_write_owner_v1;
REVOKE CREATE ON SCHEMA structr_financial FROM structr_calculator_write_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.calculator_create_v1(jsonb,jsonb) TO structr_calculator_login_v1;
CREATE FUNCTION structr_financial.calculator_recover_v1(command jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'FINANCIAL_EXECUTOR_CLOSED' USING ERRCODE='42501'; END $$;
REVOKE ALL ON FUNCTION structr_financial.calculator_recover_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT CREATE ON SCHEMA structr_financial TO structr_calculator_read_owner_v1;
ALTER FUNCTION structr_financial.calculator_recover_v1(jsonb) OWNER TO structr_calculator_read_owner_v1;
REVOKE CREATE ON SCHEMA structr_financial FROM structr_calculator_read_owner_v1;
GRANT EXECUTE ON FUNCTION structr_financial.calculator_recover_v1(jsonb) TO structr_calculator_login_v1;
DO $closed_postflight$
DECLARE role_oid oid; obj record;
BEGIN
 IF (SELECT count(*) FROM pg_authid WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolpassword IS NULL)<>3
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member OR r.oid=m.roleid WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1'))
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1')) THEN RAISE EXCEPTION 'FINANCIAL_ROLE_POSTFLIGHT' USING ERRCODE='42501'; END IF;
 role_oid:='structr_calculator_login_v1'::regrole;
 FOR obj IN SELECT c.oid,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S') LOOP
 IF (obj.relkind='S' AND has_sequence_privilege(role_oid,obj.oid,'SELECT,UPDATE,USAGE')) OR(obj.relkind<>'S' AND(has_table_privilege(role_oid,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(role_oid,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN RAISE EXCEPTION 'FINANCIAL_RAW_POSTFLIGHT' USING ERRCODE='42501'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM structr_financial.principal_bindings) OR EXISTS(SELECT 1 FROM structr_financial.calculator_fixtures) OR EXISTS(SELECT 1 FROM structr_financial.calculator_requests) THEN RAISE EXCEPTION 'FINANCIAL_PROVISIONING_POSTFLIGHT' USING ERRCODE='42501'; END IF;
END $closed_postflight$;
