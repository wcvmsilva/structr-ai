-- ADR-002 minimum reads, V3.1 + F2 operational-audit addendum. Apply atomically.
-- 0015/0016 remain immutable. No Auth access, issuer activation, business DML or API raw grants.
DO $read_preflight$
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
    RAISE EXCEPTION 'ADR002_READ_EXECUTOR_PREFLIGHT' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon','authenticated','authenticator','structr_review_owner_v1')) <> 4
    OR pg_catalog.to_regnamespace('structr_private') IS NULL
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticator'
      AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'ADR002_READ_ROLE_PREFLIGHT' USING ERRCODE='42501';
  END IF;
  IF session_wrapper IS NULL OR review_wrapper IS NULL
    OR NOT pg_catalog.has_function_privilege('authenticated',session_wrapper,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated',review_wrapper,'EXECUTE') THEN
    RAISE EXCEPTION 'ADR002_READ_WRAPPER_PREFLIGHT' USING ERRCODE='42501';
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
        RAISE EXCEPTION 'ADR002_READ_ROLE_PREFLIGHT' USING ERRCODE='42501';
      END IF;
      -- Scan every relation/column/sequence currently in the exposed namespace,
      -- including unknown objects. Namespace lookup must not activate latent ACLs.
      FOR obj IN SELECT c.oid,c.relkind FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
        IF obj.relkind='S' THEN
          IF pg_catalog.has_sequence_privilege(reachable.oid,obj.oid,'SELECT,UPDATE,USAGE') THEN
            RAISE EXCEPTION 'ADR002_READ_SEQUENCE_PREFLIGHT' USING ERRCODE='42501';
          END IF;
        ELSIF pg_catalog.has_table_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'ADR002_READ_RELATION_PREFLIGHT' USING ERRCODE='42501';
        END IF;
      END LOOP;
      FOR obj IN SELECT p.oid FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP
        IF pg_catalog.has_function_privilege(reachable.oid,obj.oid,'EXECUTE')
          AND NOT (api.rolname='authenticated' AND obj.oid IN (session_wrapper,review_wrapper)) THEN
          RAISE EXCEPTION 'ADR002_READ_FUNCTION_PREFLIGHT' USING ERRCODE='42501';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF NOT pg_catalog.has_schema_privilege('authenticated','public','USAGE')
    OR pg_catalog.to_regrole('structr_estimate_read_owner_v1') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.structr_estimate_draft_read_v1(jsonb)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.structr_internal_approval_record_v1(jsonb)') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='structr_review_owner_v1'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication))
    OR pg_catalog.has_schema_privilege('structr_review_owner_v1','structr_private','CREATE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='structr_review_owner_v1'::regrole
      AND member=current_user::regrole AND grantor=current_user::regrole) THEN
    RAISE EXCEPTION 'ADR002_READ_BASELINE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  -- Existing owner-specific evidence policies must be intact, with no restrictive
  -- policy capable of hiding H1 or trust configuration from the new role.
  FOR obj IN SELECT c.oid,c.relrowsecurity FROM pg_catalog.pg_class c
    WHERE c.oid IN ('structr_private.authenticated_boundary_config'::regclass,'public.historical_estimate_imports'::regclass) LOOP
    IF NOT obj.relrowsecurity OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid=obj.oid)<>2
      OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid=obj.oid AND polcmd='r')<>1
      OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid=obj.oid AND polcmd='w')<>1
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=obj.oid AND
        (NOT polpermissive OR polroles<>ARRAY['structr_review_owner_v1'::regrole::oid]
         OR polcmd NOT IN ('r','w') OR pg_catalog.pg_get_expr(polqual,polrelid) IS DISTINCT FROM 'true'
         OR (polcmd='r' AND polwithcheck IS NOT NULL)
         OR (polcmd='w' AND pg_catalog.pg_get_expr(polwithcheck,polrelid) IS DISTINCT FROM 'false'))) THEN
      RAISE EXCEPTION 'ADR002_READ_RLS_PREFLIGHT' USING ERRCODE='42501'; END IF;
  END LOOP;
END;
$read_preflight$;
--> statement-breakpoint
CREATE ROLE structr_estimate_read_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,structr_private TO structr_estimate_read_owner_v1;
GRANT SELECT(id,issuer,audience,deleted_at),UPDATE(id) ON structr_private.authenticated_boundary_config TO structr_estimate_read_owner_v1;
GRANT SELECT(id,tenant_id,external_open_id,email,login_method,full_name,company_name,role,is_active,last_signed_in,created_at,updated_at),UPDATE(id) ON public.profiles TO structr_estimate_read_owner_v1;
GRANT SELECT(id,is_active),UPDATE(id) ON public.tenants TO structr_estimate_read_owner_v1;
GRANT SELECT(id,tenant_id,client_id,owner_user_id,deleted_at,commercial_channel,channel,geo_risk_class,address,city,state,zip,county,latitude,longitude,geocoded_at,geocode_confidence,geocode_source,geocoded_address,zone,zone_modifier_snapshot) ON public.projects TO structr_estimate_read_owner_v1;
GRANT SELECT(id,tenant_id,project_id,user_id,project_role,permissions,is_active) ON public.project_members TO structr_estimate_read_owner_v1;
GRANT SELECT(id,name) ON public.roles TO structr_estimate_read_owner_v1;
GRANT SELECT(id,role_id,permission_id) ON public.role_permissions TO structr_estimate_read_owner_v1;
GRANT SELECT(id,resource,action) ON public.permissions TO structr_estimate_read_owner_v1;
GRANT SELECT(id,estimate_draft_id),UPDATE(id) ON public.historical_estimate_imports TO structr_estimate_read_owner_v1;
GRANT SELECT(id,tenant_id,estimate_id,project_id,status,source,draft_data,bundle_name,zone,finish_level,trade,pricing_schema_version,channel,region,created_by,coastal_modifier,subtotal_price,subtotal_cost,final_total_price,discount_applied,discount_amount,gross_profit,gross_profit_pct,profit_shield_passed,profit_shield_min_pct,assembly_selections,line_items,intake_form_id,warnings_json,scope_draft_id,notes,metadata,bundle_id,client_id,assembly_count,approved_by,approved_at,rejected_by,rejected_at,rejection_reason,created_at,updated_at,version,superseded_by,supersedes_id,locked_at,change_order_of,change_order_reason,commercial_channel,profit_shield_floor_pct,profit_shield_evaluation,pricing_snapshot,a1_version_request_id,a1_version_request_hash) ON public.estimate_drafts TO structr_estimate_read_owner_v1;
GRANT INSERT(user_id,action,table_name,record_id,old_values,new_values,created_at) ON public.audit_logs TO structr_estimate_read_owner_v1;
CREATE POLICY adr002_config_select_read_v1 ON structr_private.authenticated_boundary_config FOR SELECT TO structr_estimate_read_owner_v1 USING(true);
CREATE POLICY adr002_config_lock_read_v1 ON structr_private.authenticated_boundary_config FOR UPDATE TO structr_estimate_read_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY adr002_h1_select_read_v1 ON public.historical_estimate_imports FOR SELECT TO structr_estimate_read_owner_v1 USING(true);
CREATE POLICY adr002_h1_lock_read_v1 ON public.historical_estimate_imports FOR UPDATE TO structr_estimate_read_owner_v1 USING(true) WITH CHECK(false);
-- Grant through the real helper owner. The migrator's own temporary membership
-- is removed later; any separate PostgreSQL creator ADMIN grant stays intact.
GRANT structr_review_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
DO $helper_grants$
DECLARE migrator name:=current_user;
BEGIN
  SET LOCAL ROLE structr_review_owner_v1;
  GRANT EXECUTE ON FUNCTION structr_private.review_claims_v1(),structr_private.review_uuid_v1(text) TO structr_estimate_read_owner_v1;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',migrator);
END;
$helper_grants$;
--> statement-breakpoint
CREATE FUNCTION structr_private.estimate_draft_read_v1(command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb; actor record; tenant record; draft record; project record; membership record;
  draft_id uuid; history_id uuid; allowed boolean; projected jsonb:='{}'; item record; key text; pieces text[]; i integer; v jsonb; result jsonb;
BEGIN
  claims:=structr_private.review_claims_v1();
  IF pg_catalog.jsonb_typeof(command) IS DISTINCT FROM 'object' OR command-ARRAY['id']<>'{}'::jsonb
    OR NOT command ? 'id' OR pg_catalog.jsonb_typeof(command->'id') IS DISTINCT FROM 'string'
    -- General getById keeps its existing Zod UUID contract: mixed case, NIL and
    -- lowercase MAX are valid inputs. The uuid cast normalizes only this path.
    OR (command->>'id') !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' THEN
    RAISE EXCEPTION 'INTERNAL_APPROVAL_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  draft_id:=(command->>'id')::uuid;
  -- Normative V3.1 identity order: config -> profile -> tenant SHARE precedes
  -- business reads. General project/draft/membership/RBAC reads take no locks.
  SELECT id,tenant_id,external_open_id,role,is_active INTO actor FROM public.profiles WHERE external_open_id=claims->>'sub' FOR SHARE;
  IF NOT FOUND OR actor.is_active IS DISTINCT FROM true OR actor.tenant_id IS NULL
    OR actor.id='00000000-0000-0000-0000-000000000000'::uuid OR actor.tenant_id='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT id,is_active INTO tenant FROM public.tenants WHERE id=actor.tenant_id FOR SHARE;
  IF NOT FOUND OR tenant.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT id,tenant_id,estimate_id,project_id,status,source,draft_data,bundle_name,zone,finish_level,trade,pricing_schema_version,channel,region,created_by,coastal_modifier,subtotal_price,subtotal_cost,final_total_price,discount_applied,discount_amount,gross_profit,gross_profit_pct,profit_shield_passed,profit_shield_min_pct,assembly_selections,line_items,intake_form_id,warnings_json,scope_draft_id,notes,metadata,bundle_id,client_id,assembly_count,approved_by,approved_at,rejected_by,rejected_at,rejection_reason,created_at,updated_at,version,superseded_by,supersedes_id,locked_at,change_order_of,change_order_reason,commercial_channel,profit_shield_floor_pct,profit_shield_evaluation,pricing_snapshot,a1_version_request_id,a1_version_request_hash INTO draft FROM public.estimate_drafts WHERE id=draft_id;
  IF NOT FOUND OR draft.project_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,owner_user_id INTO project FROM public.projects WHERE id=draft.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF project.tenant_id IS DISTINCT FROM actor.tenant_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
  -- Preserve the existing pool access semantics: authorization is on project,
  -- not draft.tenant_id or deleted_at; nullable active membership is accepted.
  IF actor.role IS DISTINCT FROM 'admin' AND project.owner_user_id IS DISTINCT FROM actor.id THEN
    SELECT project_role,permissions,is_active INTO membership FROM public.project_members
      WHERE project_id=project.id AND user_id=actor.id LIMIT 1;
    IF FOUND AND membership.is_active IS DISTINCT FROM false THEN
      allowed:=(membership.project_role IN ('owner','manager','estimator','field','viewer')
        OR (pg_catalog.jsonb_typeof(membership.permissions)='array' AND membership.permissions @> '["read"]'::jsonb));
    ELSE
      SELECT EXISTS(SELECT 1 FROM public.roles r JOIN public.role_permissions rp ON rp.role_id=r.id
        JOIN public.permissions p ON p.id=rp.permission_id
        WHERE r.name=actor.role AND p.resource='project' AND p.action='read') INTO allowed;
    END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
  END IF;
  SELECT id INTO history_id FROM public.historical_estimate_imports WHERE estimate_draft_id=draft.id LIMIT 1;
  -- Shallow wire formatting is inline: this owner has no projection/helper grant.
  FOR item IN SELECT * FROM pg_catalog.jsonb_each(pg_catalog.to_jsonb(draft)) LOOP
    pieces:=pg_catalog.string_to_array(item.key,'_'); key:=pieces[1];
    FOR i IN 2..pg_catalog.cardinality(pieces) LOOP key:=key||pg_catalog.initcap(pieces[i]); END LOOP;
    v:=item.value;
    IF v<>'null'::jsonb AND item.key=ANY(ARRAY['approved_at','rejected_at','created_at','updated_at','locked_at']) THEN
      v:=pg_catalog.to_jsonb(pg_catalog.to_char((v#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    ELSIF v<>'null'::jsonb AND item.key=ANY(ARRAY['coastal_modifier','subtotal_price','subtotal_cost','final_total_price','discount_amount','gross_profit','gross_profit_pct','profit_shield_min_pct','profit_shield_floor_pct']) THEN
      v:=pg_catalog.to_jsonb(v#>>'{}');
    END IF;
    projected:=projected||pg_catalog.jsonb_build_object(key,v);
  END LOOP;
  -- F2 addendum: only this operational best-effort insert is exception-contained.
  BEGIN
    INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values,created_at)
      VALUES(actor.id,'estimate_viewed','estimate_drafts',draft.id,NULL,
        pg_catalog.jsonb_build_object('bundleName',draft.bundle_name,'status',draft.status,'source',draft.source,'pricingSchemaVersion',draft.pricing_schema_version),pg_catalog.now());
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM structr_private.review_claims_v1();
  result:=pg_catalog.jsonb_build_object('version','structr-authenticated-estimate-read-v1',
    'context',pg_catalog.jsonb_build_object('actorId',actor.id,'tenantId',actor.tenant_id),
    'draft',projected,'historicalImportId',history_id);
  RETURN result;
END; $$;
--> statement-breakpoint
CREATE FUNCTION structr_private.internal_approval_record_v1(command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
<<internal_approval_record_v1>>
DECLARE claims jsonb; actor record; tenant record; project record; draft record; client record; membership record;
  locator uuid; actor_id uuid; tenant_id uuid; draft_id uuid; permission_slugs text[];
  snapshots jsonb:='[]'; approvals jsonb:='[]'; revocations jsonb:='[]'; authors jsonb:='[]';
  evidence record; author record; author_ids uuid[]:='{}'; source_matches boolean:=NULL;
  stack uuid[]; exits boolean[]; stack_top integer; current_id uuid; exiting boolean; colors jsonb:='{}';
  seen uuid[]:='{}'; ancestor record; parent_id uuid; history record;
  result jsonb; physical_draft jsonb;
BEGIN
  claims:=structr_private.review_claims_v1();
  IF pg_catalog.jsonb_typeof(command) IS DISTINCT FROM 'object'
    OR command-ARRAY['id']<>'{}'::jsonb OR NOT command ? 'id'
    OR pg_catalog.jsonb_typeof(command->'id') IS DISTINCT FROM 'string'
    OR structr_private.review_uuid_v1(command->>'id') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INTERNAL_APPROVAL_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  draft_id:=(command->>'id')::uuid;
  -- V3.1 identity locks precede business: config -> profile -> tenant SHARE,
  -- then project -> draft UPDATE, client/membership/evidence SHARE.
  SELECT id,tenant_id,external_open_id,role,is_active INTO actor FROM public.profiles WHERE external_open_id=claims->>'sub' FOR SHARE;
  IF NOT FOUND OR actor.is_active IS DISTINCT FROM true OR actor.tenant_id IS NULL
    OR actor.id='00000000-0000-0000-0000-000000000000'::uuid OR actor.tenant_id='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  actor_id:=actor.id; tenant_id:=actor.tenant_id;
  SELECT id,is_active INTO tenant FROM public.tenants WHERE id=tenant_id FOR SHARE;
  IF NOT FOUND OR tenant.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT project_id INTO locator FROM public.estimate_drafts WHERE id=draft_id AND estimate_drafts.tenant_id=internal_approval_record_v1.tenant_id;
  IF NOT FOUND OR locator IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,client_id,owner_user_id,deleted_at,commercial_channel,channel,geo_risk_class,address,city,state,zip,county,latitude,longitude,geocoded_at,geocode_confidence,geocode_source,geocoded_address,zone,zone_modifier_snapshot
    INTO project FROM public.projects WHERE id=locator AND projects.tenant_id=internal_approval_record_v1.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,project_id,client_id,version,created_at,pricing_schema_version,source,estimate_id,intake_form_id,bundle_id,supersedes_id,change_order_of,bundle_name,notes,subtotal_price,discount_applied,discount_amount,final_total_price,subtotal_cost,line_items,assembly_selections,pricing_snapshot,draft_data,commercial_channel,channel,zone,finish_level,region,trade,coastal_modifier,scope_draft_id,assembly_count,status,superseded_by,approved_at,approved_by,locked_at
    INTO draft FROM public.estimate_drafts WHERE id=draft_id AND estimate_drafts.tenant_id=internal_approval_record_v1.tenant_id FOR UPDATE;
  IF NOT FOUND OR draft.project_id IS DISTINCT FROM project.id OR draft.client_id IS NULL OR draft.client_id IS DISTINCT FROM project.client_id THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,is_active,deleted_at INTO client FROM public.clients WHERE id=draft.client_id FOR SHARE;
  IF NOT FOUND OR client.tenant_id IS DISTINCT FROM tenant_id OR project.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF actor.role IS DISTINCT FROM 'admin' AND project.owner_user_id IS DISTINCT FROM actor_id THEN
    SELECT id,tenant_id,project_role,permissions,is_active INTO membership FROM public.project_members WHERE project_id=project.id AND user_id=actor_id FOR SHARE;
    IF FOUND AND membership.tenant_id IS DISTINCT FROM tenant_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
    IF FOUND AND membership.is_active IS TRUE THEN
      IF (membership.project_role IN ('owner','manager','estimator','field','viewer') OR (pg_catalog.jsonb_typeof(membership.permissions)='array' AND membership.permissions @> '["read"]'::jsonb)) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
    ELSE
      permission_slugs:=structr_private.review_permissions_v1(actor.role);
      IF NOT ('project:read'=ANY(permission_slugs)) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
    END IF;
  END IF;

  -- Evidence is found by global draft ID. Check context before returning any
  -- raw payload; Node will validate hashes, normalization, command and state.
  FOR evidence IN SELECT id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,draft_version,contract_version,content_hash,currency_code,currency_basis,subtotal_price_minor,discount_minor,final_price_minor,estimated_cost_minor,policy_version,policy_hash,snapshot_payload,policy_evaluation,captured_by
    FROM public.estimate_internal_approval_snapshots WHERE estimate_draft_id=draft_id ORDER BY created_at,id FOR SHARE LOOP
    IF evidence.tenant_id IS DISTINCT FROM tenant_id OR evidence.project_id IS DISTINCT FROM project.id OR evidence.client_id IS DISTINCT FROM client.id
      OR evidence.snapshot_payload->'identity'->>'tenantId' IS DISTINCT FROM tenant_id::text
      OR evidence.snapshot_payload->'identity'->>'projectId' IS DISTINCT FROM project.id::text
      OR evidence.snapshot_payload->'identity'->>'clientId' IS DISTINCT FROM client.id::text
      OR evidence.snapshot_payload->'identity'->>'estimateDraftId' IS DISTINCT FROM draft_id::text
      OR evidence.snapshot_payload->'commercialContext'->'policyContext'->'projectGeo'->>'zoneTenantId' IS DISTINCT FROM tenant_id::text THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
    snapshots:=snapshots||pg_catalog.jsonb_build_array(structr_private.review_projection_v1(pg_catalog.to_jsonb(evidence),ARRAY['created_at','updated_at','deleted_at'],ARRAY['subtotal_price_minor','discount_minor','final_price_minor','estimated_cost_minor']));
    author_ids:=pg_catalog.array_append(author_ids,evidence.captured_by);
    -- All 28 fields read by the frozen normalizer are in the exact projection.
    -- Null unused composite columns are never returned as fabricated DTO fields.
    physical_draft:=pg_catalog.to_jsonb(draft);
    BEGIN source_matches:=public.internal_approval_draft_matches_v1(pg_catalog.jsonb_populate_record(NULL::public.estimate_drafts,physical_draft),evidence.snapshot_payload,false);
    EXCEPTION WHEN data_exception OR check_violation THEN source_matches:=false; END;
  END LOOP;
  FOR evidence IN SELECT id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,snapshot_id,request_id,request_hash,approved_by,approved_at,reason,contract_version
    FROM public.estimate_internal_approvals WHERE estimate_draft_id=draft_id ORDER BY created_at,id FOR SHARE LOOP
    IF evidence.tenant_id IS DISTINCT FROM tenant_id OR evidence.project_id IS DISTINCT FROM project.id OR evidence.client_id IS DISTINCT FROM client.id THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
    approvals:=approvals||pg_catalog.jsonb_build_array(structr_private.review_projection_v1(pg_catalog.to_jsonb(evidence),ARRAY['created_at','updated_at','deleted_at','approved_at'],ARRAY[]::text[]));
    author_ids:=pg_catalog.array_append(author_ids,evidence.approved_by);
  END LOOP;
  FOR evidence IN SELECT id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,approval_id,request_id,request_hash,revoked_by,revoked_at,reason,contract_version
    FROM public.estimate_internal_approval_revocations WHERE estimate_draft_id=draft_id ORDER BY created_at,id FOR SHARE LOOP
    IF evidence.tenant_id IS DISTINCT FROM tenant_id OR evidence.project_id IS DISTINCT FROM project.id OR evidence.client_id IS DISTINCT FROM client.id THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
    revocations:=revocations||pg_catalog.jsonb_build_array(structr_private.review_projection_v1(pg_catalog.to_jsonb(evidence),ARRAY['created_at','updated_at','deleted_at','revoked_at'],ARRAY[]::text[]));
    author_ids:=pg_catalog.array_append(author_ids,evidence.revoked_by);
  END LOOP;
  FOR author IN SELECT id,tenant_id FROM public.profiles WHERE id=ANY(author_ids) ORDER BY id FOR SHARE LOOP
    IF author.tenant_id IS DISTINCT FROM tenant_id THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
    authors:=authors||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',author.id,'tenantId',author.tenant_id));
  END LOOP;
  IF pg_catalog.jsonb_array_length(authors)<>(SELECT count(DISTINCT x) FROM pg_catalog.unnest(author_ids) x)
    OR pg_catalog.jsonb_array_length(snapshots)>1 OR pg_catalog.jsonb_array_length(approvals)>1 OR pg_catalog.jsonb_array_length(revocations)>1 THEN
    RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;

  IF snapshots='[]'::jsonb AND approvals='[]'::jsonb AND revocations='[]'::jsonb THEN
    IF draft.status IN ('internally_approved','internal_approval_revoked') THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
  ELSE
    IF pg_catalog.jsonb_array_length(snapshots)<>1 OR pg_catalog.jsonb_array_length(approvals)<>1 THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
    -- A record without evidence returns none, even for historical/legacy input.
    -- Lineage authority is required only when validating persisted A1 evidence.
  -- Iterative DFS preserves both derivation edges, detects cycles, deduplicates
  -- DAG nodes and caps distinct nodes at 1000 without recursive stack growth.
  stack:=ARRAY[draft_id]; exits:=ARRAY[false];
  WHILE pg_catalog.cardinality(stack)>0 LOOP
    stack_top:=pg_catalog.cardinality(stack); current_id:=stack[stack_top]; exiting:=exits[stack_top];
    stack:=stack[1:stack_top-1]; exits:=exits[1:stack_top-1];
    IF exiting THEN colors:=colors||pg_catalog.jsonb_build_object(current_id::text,'black'); CONTINUE; END IF;
    IF colors->>current_id::text='gray' THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
    IF colors->>current_id::text='black' THEN CONTINUE; END IF;
    IF pg_catalog.cardinality(seen)>=1000 THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
    SELECT id,tenant_id,project_id,client_id,source,supersedes_id,change_order_of INTO ancestor FROM public.estimate_drafts WHERE id=current_id;
    IF NOT FOUND OR ancestor.tenant_id IS DISTINCT FROM tenant_id OR ancestor.project_id IS DISTINCT FROM project.id OR ancestor.client_id IS DISTINCT FROM client.id THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
    IF ancestor.source='historical_import' THEN RAISE EXCEPTION 'HISTORICAL_AUTHORITY_NOT_AVAILABLE' USING ERRCODE='P0001'; END IF;
    IF ancestor.source IS NULL OR ancestor.source NOT IN ('assembly_calculator','scope_draft','version','change_order')
      OR (ancestor.source='version' AND ancestor.supersedes_id IS NULL) OR (ancestor.source='change_order' AND ancestor.change_order_of IS NULL) THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
    seen:=pg_catalog.array_append(seen,current_id); colors:=colors||pg_catalog.jsonb_build_object(current_id::text,'gray');
    stack:=pg_catalog.array_append(stack,current_id); exits:=pg_catalog.array_append(exits,true);
    FOREACH parent_id IN ARRAY ARRAY[ancestor.change_order_of,ancestor.supersedes_id] LOOP
      IF parent_id IS NOT NULL THEN stack:=pg_catalog.array_append(stack,parent_id); exits:=pg_catalog.array_append(exits,false); END IF;
    END LOOP;
  END LOOP;
  -- Deliberately no tenant filter: contradictory H1 evidence must cause denial.
  FOR history IN SELECT id FROM public.historical_estimate_imports WHERE estimate_draft_id=ANY(seen) ORDER BY id FOR SHARE LOOP
    RAISE EXCEPTION 'HISTORICAL_AUTHORITY_NOT_AVAILABLE' USING ERRCODE='P0001';
  END LOOP;
  FOR ancestor IN SELECT id,tenant_id,project_id,client_id FROM public.estimate_drafts WHERE id=ANY(seen) AND id<>draft_id ORDER BY id FOR SHARE LOOP
    IF ancestor.tenant_id IS DISTINCT FROM tenant_id OR ancestor.project_id IS DISTINCT FROM project.id OR ancestor.client_id IS DISTINCT FROM client.id THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
  END LOOP;

  END IF;
  PERFORM structr_private.review_claims_v1();
  result:=pg_catalog.jsonb_build_object('version','structr-authenticated-approval-record-v1',
    'context',pg_catalog.jsonb_build_object('actorId',actor_id,'tenantId',tenant_id),
    'rows',pg_catalog.jsonb_build_object(
      'draft',structr_private.review_projection_v1(pg_catalog.to_jsonb(draft),ARRAY['created_at','approved_at','locked_at'],ARRAY['subtotal_price','discount_amount','final_total_price','subtotal_cost','coastal_modifier']),
      'project',structr_private.review_projection_v1(pg_catalog.to_jsonb(project)-'owner_user_id',ARRAY['deleted_at','geocoded_at'],ARRAY['latitude','longitude']),
      'client',structr_private.review_projection_v1(pg_catalog.to_jsonb(client),ARRAY['deleted_at'],ARRAY[]::text[]),
      'tenant',pg_catalog.jsonb_build_object('id',tenant.id,'isActive',tenant.is_active),
      'profile',pg_catalog.jsonb_build_object('id',actor.id,'tenantId',actor.tenant_id,'isActive',actor.is_active)),
    'approvalEvidence',pg_catalog.jsonb_build_object('snapshots',snapshots,'approvals',approvals,'revocations',revocations,'authors',authors,'sourceMatches',source_matches));
  RETURN result;
END; $$;
--> statement-breakpoint
CREATE FUNCTION public.structr_estimate_draft_read_v1(command jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET default_transaction_isolation='serializable'
BEGIN ATOMIC SELECT structr_private.estimate_draft_read_v1(command); END;
CREATE FUNCTION public.structr_internal_approval_record_v1(command jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET default_transaction_isolation='serializable'
BEGIN ATOMIC SELECT structr_private.internal_approval_record_v1(command); END;
REVOKE ALL ON FUNCTION public.structr_estimate_draft_read_v1(jsonb),public.structr_internal_approval_record_v1(jsonb),
  structr_private.estimate_draft_read_v1(jsonb),structr_private.internal_approval_record_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator;
GRANT EXECUTE ON FUNCTION public.structr_estimate_draft_read_v1(jsonb),public.structr_internal_approval_record_v1(jsonb),
  structr_private.estimate_draft_read_v1(jsonb),structr_private.internal_approval_record_v1(jsonb) TO authenticated;
GRANT structr_estimate_read_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
GRANT CREATE ON SCHEMA structr_private TO structr_estimate_read_owner_v1,structr_review_owner_v1;
ALTER FUNCTION structr_private.estimate_draft_read_v1(jsonb) OWNER TO structr_estimate_read_owner_v1;
ALTER FUNCTION structr_private.internal_approval_record_v1(jsonb) OWNER TO structr_review_owner_v1;
REVOKE CREATE ON SCHEMA structr_private FROM structr_estimate_read_owner_v1,structr_review_owner_v1;
REVOKE structr_estimate_read_owner_v1,structr_review_owner_v1 FROM CURRENT_USER;
DO $read_postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator') AND
    (pg_catalog.pg_has_role(oid,'structr_estimate_read_owner_v1','SET') OR pg_catalog.pg_has_role(oid,'structr_estimate_read_owner_v1','USAGE')
      OR pg_catalog.has_schema_privilege(oid,'structr_private','USAGE,CREATE')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner IN ('structr_estimate_read_owner_v1'::regrole,'structr_review_owner_v1'::regrole))
    OR pg_catalog.has_schema_privilege('structr_estimate_read_owner_v1','public','CREATE')
    OR pg_catalog.has_schema_privilege('structr_estimate_read_owner_v1','structr_private','CREATE')
    OR pg_catalog.has_schema_privilege('structr_review_owner_v1','structr_private','CREATE') THEN
    RAISE EXCEPTION 'ADR002_READ_PRIVATE_POSTFLIGHT' USING ERRCODE='42501'; END IF;
END;
$read_postflight$;
