-- ADR-002: first authenticated, read-only review operation.
-- This local migration is a REVIEW CANDIDATE, not approval to apply hosted DDL.
-- Apply atomically only after the named-object preflight and physical proof.
-- No auth.* access, no global public-schema revocation, no business DML.
-- JWT policy: maximum original AND remaining lifetime 900 seconds. Auth logout
-- alone does not revoke an already issued token before exp. Provider TTL changes
-- and the audited insertion of issuer configuration are separate actions.

-- Fail closed on legacy API privileges. These are the 90 business tables and
-- 47 function names defined by migrations 0000--0014, not an extension sweep.
-- All overloads of an inventoried business name are checked. No privileges of
-- the legacy SQL application are changed by this migration.
DO $preflight$
DECLARE api record; reachable record; obj record;
  table_names text[] := ARRAY[
    'analytics_snapshots','assemblies','assembly_items','assembly_performance_metrics',
    'audit_log','audit_logs','boq_items','bundle_items','bundles','calibration_events',
    'calibration_reports','calibration_suggestions','channel_multipliers','clients',
    'cost_code_pricing_history','cost_codes','cost_types','crew_velocity','daily_logs',
    'deal_activities','deal_stage_history','deals','drawing_revision_snapshots',
    'estimate_drafts','estimate_internal_approval_revocations','estimate_internal_approval_snapshots',
    'estimate_internal_approvals','estimate_items','estimate_variance_events','estimates',
    'field_feedback_reports','field_task_events','field_tasks','finish_levels','geo_zones',
    'geographic_overrides','historical_estimate_import_lines','historical_estimate_imports',
    'historical_estimate_source_lines','historical_estimate_sources','intake_forms','jobtread_exports',
    'lead_activities','lead_proposals','leads','newcon_templates','parametric_models','permissions',
    'pipeline_partial_drafts','previsit_briefs','previsit_checklist_items','price_adjustments',
    'profiles','project_actuals','project_closeouts','project_cost_actuals','project_drawings',
    'project_files','project_members','projects','property_cache','proposal_access_log','proposals',
    'regional_modifiers','regional_risk_factors','remodel_templates','review_actions','rfi_candidates',
    'role_permissions','roles','roof_segments','scope_checklist_patterns','scope_completeness_scores',
    'scope_draft_items','scope_drafts','scope_override_log','scope_review_deltas','scope_review_snapshots',
    'scope_rules','scope_sources','security_exceptions','security_review_final','subcontractors',
    'system_alerts','system_issue_reports','system_settings','tenant_settings','tenants','units','workflow_runs'
  ];
  function_names text[] := ARRAY[
    'a1_export_authority_null_required_v1','a1_export_client_null_required_v1',
    'a1_export_csv_exclusive_code_v1','a1_export_exact_amount_minor_v1','a1_export_exact_two_decimal_v1',
    'a1_export_issue_class_rank_v1','a1_export_issue_order_valid_v1','a1_export_issue_reconciliation_state_v1',
    'a1_export_issue_status_class_v1','a1_export_issue_totals_class_v1','a1_export_issue_validation_state_v1',
    'historical_estimate_check_import_set','historical_estimate_check_source_set',
    'historical_estimate_reject_mutation','historical_estimate_valid_reconciliation',
    'internal_approval_channel_v1','internal_approval_check_final_v1','internal_approval_check_lineage_v1',
    'internal_approval_draft_matches_v1','internal_approval_evaluation_shape_v1',
    'internal_approval_historical_project_witness_v1','internal_approval_historical_recorded_lineage_v1',
    'internal_approval_legacy_number_v1','internal_approval_lookup_key_v1','internal_approval_matches_v1',
    'internal_approval_membership_parent_version_v1','internal_approval_policy_parent_version_v1',
    'internal_approval_pricing_channel_v1','internal_approval_reject_mutation_v1',
    'internal_approval_snapshot_shape_v1','internal_approval_trim_v1','internal_approval_valid_snapshot_v1',
    'internal_estimate_export_valid_manifest_v1','jobtread_export_a1_check_final_v1',
    'jobtread_export_a1_immutability_guard_v1','jobtread_export_a1_insert_guard_v1',
    'project_reopen_child_certify_v1','project_reopen_provenance_guard_v1','structr_guard_actual_immutable',
    'structr_guard_approved_estimate','structr_guard_audit_log_append_only',
    'structr_guard_calibration_event_actioned','structr_guard_closeout_closed','structr_guard_field_task_terminal',
    'structr_guard_mandatory_feature_flags','structr_guard_price_adjustment_transition','structr_touch_updated_at'
  ];
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator')) <> 3
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticator'
       AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='structr_review_owner_v1')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='structr_private') THEN
    RAISE EXCEPTION 'ADR002_ROLE_OR_SCHEMA_PREFLIGHT' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(table_names) AND c.relkind IN ('r','p')) <> 90
     OR (SELECT count(DISTINCT p.proname) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=ANY(function_names)) <> 47 THEN
    RAISE EXCEPTION 'ADR002_INVENTORY_PREFLIGHT' USING ERRCODE='42501';
  END IF;
  -- Contradiction evidence must be visible to the dedicated role. An existing
  -- restrictive policy or disabled RLS is drift, never something to bypass.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('historical_estimate_imports','estimate_internal_approval_snapshots','estimate_internal_approvals','estimate_internal_approval_revocations')
      AND (NOT c.relrowsecurity OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid))) THEN
    RAISE EXCEPTION 'ADR002_EVIDENCE_RLS_PREFLIGHT' USING ERRCODE='42501';
  END IF;
  FOR api IN SELECT oid,rolname FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator') LOOP
    FOR reachable IN SELECT r.* FROM pg_catalog.pg_roles r WHERE r.oid=api.oid
      OR pg_catalog.pg_has_role(api.oid,r.oid,'USAGE')
      OR (api.rolname<>'authenticator' AND pg_catalog.pg_has_role(api.oid,r.oid,'SET')) LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole OR reachable.rolcreatedb
         OR reachable.rolreplication OR (api.rolname<>'authenticator' AND reachable.rolcanlogin)
         OR pg_catalog.has_schema_privilege(reachable.oid,'public','CREATE') THEN
        RAISE EXCEPTION 'ADR002_API_ROLE_PREFLIGHT' USING ERRCODE='42501';
      END IF;
      FOR obj IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY(table_names) LOOP
        IF pg_catalog.has_table_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'ADR002_BUSINESS_TABLE_PREFLIGHT: %',obj.relname USING ERRCODE='42501';
        END IF;
      END LOOP;
      FOR obj IN SELECT p.oid,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=ANY(function_names) LOOP
        IF pg_catalog.has_function_privilege(reachable.oid,obj.oid,'EXECUTE') THEN
          RAISE EXCEPTION 'ADR002_BUSINESS_FUNCTION_PREFLIGHT: %',obj.proname USING ERRCODE='42501';
        END IF;
      END LOOP;
      -- Unknown API-visible objects are only inspected, never altered. There
      -- is deliberately no implicit extension exemption: adding one requires
      -- review of that exact signature. This blocks an unreviewed definer (or
      -- invoker capable of dynamic SQL), view, foreign table or sequence.
      FOR obj IN SELECT p.oid,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND NOT p.proname=ANY(function_names) LOOP
        IF pg_catalog.has_function_privilege(reachable.oid,obj.oid,'EXECUTE') THEN
          RAISE EXCEPTION 'ADR002_UNREVIEWED_FUNCTION_PREFLIGHT: %',obj.proname USING ERRCODE='42501';
        END IF;
      END LOOP;
      FOR obj IN SELECT c.oid,c.relname,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') AND NOT c.relname=ANY(table_names) LOOP
        IF obj.relkind='S' THEN
          IF pg_catalog.has_sequence_privilege(reachable.oid,obj.oid,'SELECT,UPDATE,USAGE') THEN
            RAISE EXCEPTION 'ADR002_UNREVIEWED_SEQUENCE_PREFLIGHT: %',obj.relname USING ERRCODE='42501'; END IF;
        ELSIF pg_catalog.has_table_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
          RAISE EXCEPTION 'ADR002_UNREVIEWED_RELATION_PREFLIGHT: %',obj.relname USING ERRCODE='42501';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$preflight$;
--> statement-breakpoint
CREATE ROLE structr_review_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA structr_private;
REVOKE ALL ON SCHEMA structr_private FROM PUBLIC,anon,authenticated,authenticator;
GRANT USAGE ON SCHEMA public,structr_private TO structr_review_owner_v1;

CREATE TABLE structr_private.authenticated_boundary_config (
  id boolean PRIMARY KEY DEFAULT true,
  issuer text NOT NULL,
  audience text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT authenticated_boundary_singleton CHECK (id IS TRUE),
  CONSTRAINT authenticated_boundary_issuer CHECK (issuer ~ '^https://[^[:space:]]+/auth/v1$'),
  CONSTRAINT authenticated_boundary_audience CHECK (audience='authenticated')
);
ALTER TABLE structr_private.authenticated_boundary_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE structr_private.authenticated_boundary_config FROM PUBLIC,anon,authenticated,authenticator;
-- Empty deliberately. Issuer enablement is a separate audited bootstrap.

-- Column grants are exactly the review projection and protected ACL evidence.
-- UPDATE(id) is required by PostgreSQL for SELECT FOR SHARE/UPDATE. There is no
-- executable mutation in these routines and API roles receive none of it.
GRANT SELECT(id,issuer,audience,deleted_at),UPDATE(id) ON structr_private.authenticated_boundary_config TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,external_open_id,email,login_method,full_name,company_name,role,is_active,last_signed_in,created_at,updated_at),UPDATE(id) ON public.profiles TO structr_review_owner_v1;
GRANT SELECT(id,is_active),UPDATE(id) ON public.tenants TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,client_id,owner_user_id,deleted_at,commercial_channel,channel,geo_risk_class,address,city,state,zip,county,latitude,longitude,geocoded_at,geocode_confidence,geocode_source,geocoded_address,zone,zone_modifier_snapshot),UPDATE(id) ON public.projects TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,is_active,deleted_at),UPDATE(id) ON public.clients TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,version,created_at,pricing_schema_version,source,estimate_id,intake_form_id,bundle_id,supersedes_id,change_order_of,bundle_name,notes,subtotal_price,discount_applied,discount_amount,final_total_price,subtotal_cost,line_items,assembly_selections,pricing_snapshot,draft_data,commercial_channel,channel,zone,finish_level,region,trade,coastal_modifier,scope_draft_id,assembly_count,status,superseded_by,approved_at,approved_by,locked_at),UPDATE(id) ON public.estimate_drafts TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,project_id,user_id,project_role,permissions,is_active),UPDATE(id) ON public.project_members TO structr_review_owner_v1;
GRANT SELECT(id,name),UPDATE(id) ON public.roles TO structr_review_owner_v1;
GRANT SELECT(id,role_id,permission_id),UPDATE(id) ON public.role_permissions TO structr_review_owner_v1;
GRANT SELECT(id,resource,action),UPDATE(id) ON public.permissions TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,updated_at,profit_shield_overrides,geo_floor_overrides),UPDATE(id) ON public.tenant_settings TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,is_active,zone_name,name,coastal_exposure_level,cost_multiplier,labor_modifier,material_modifier,logistics_modifier,contingency_pct,min_profit_shield_pct),UPDATE(id) ON public.geo_zones TO structr_review_owner_v1;
GRANT SELECT(id,project_id,tenant_id),UPDATE(id) ON public.scope_drafts TO structr_review_owner_v1;
GRANT SELECT(id,estimate_draft_id),UPDATE(id) ON public.historical_estimate_imports TO structr_review_owner_v1;
GRANT SELECT(id,project_id,tenant_id),UPDATE(id) ON public.estimates TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id),UPDATE(id) ON public.bundles TO structr_review_owner_v1;
GRANT SELECT(id,project_id,tenant_id,form_data),UPDATE(id) ON public.intake_forms TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,draft_version,contract_version,content_hash,currency_code,currency_basis,subtotal_price_minor,discount_minor,final_price_minor,estimated_cost_minor,policy_version,policy_hash,snapshot_payload,policy_evaluation,captured_by),UPDATE(id) ON public.estimate_internal_approval_snapshots TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,snapshot_id,request_id,request_hash,approved_by,approved_at,reason,contract_version),UPDATE(id) ON public.estimate_internal_approvals TO structr_review_owner_v1;
GRANT SELECT(id,tenant_id,project_id,client_id,estimate_draft_id,created_at,updated_at,deleted_at,approval_id,request_id,request_hash,revoked_by,revoked_at,reason,contract_version),UPDATE(id) ON public.estimate_internal_approval_revocations TO structr_review_owner_v1;

CREATE POLICY adr002_config_select ON structr_private.authenticated_boundary_config FOR SELECT TO structr_review_owner_v1 USING(true);
CREATE POLICY adr002_config_lock ON structr_private.authenticated_boundary_config FOR UPDATE TO structr_review_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY adr002_h1_select ON public.historical_estimate_imports FOR SELECT TO structr_review_owner_v1 USING(true);
CREATE POLICY adr002_h1_lock ON public.historical_estimate_imports FOR UPDATE TO structr_review_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY adr002_snapshot_select ON public.estimate_internal_approval_snapshots FOR SELECT TO structr_review_owner_v1 USING(true);
CREATE POLICY adr002_snapshot_lock ON public.estimate_internal_approval_snapshots FOR UPDATE TO structr_review_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY adr002_approval_select ON public.estimate_internal_approvals FOR SELECT TO structr_review_owner_v1 USING(true);
CREATE POLICY adr002_approval_lock ON public.estimate_internal_approvals FOR UPDATE TO structr_review_owner_v1 USING(true) WITH CHECK(false);
CREATE POLICY adr002_revocation_select ON public.estimate_internal_approval_revocations FOR SELECT TO structr_review_owner_v1 USING(true);
CREATE POLICY adr002_revocation_lock ON public.estimate_internal_approval_revocations FOR UPDATE TO structr_review_owner_v1 USING(true) WITH CHECK(false);

GRANT EXECUTE ON FUNCTION public.internal_approval_draft_matches_v1(public.estimate_drafts,jsonb,boolean),
  public.internal_approval_trim_v1(text),public.internal_approval_legacy_number_v1(jsonb,integer),
  public.internal_approval_pricing_channel_v1(text),public.internal_approval_channel_v1(text),
  public.internal_approval_lookup_key_v1(text) TO structr_review_owner_v1;
--> statement-breakpoint
-- Helpers are invoker routines, reachable only by the private owner. Formatting
-- is shallow: embedded persisted JSON is never rewritten, repriced or rounded.
CREATE FUNCTION structr_private.review_projection_v1(value jsonb,dates text[],numbers text[]) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE item record; pieces text[]; key text; i integer; v jsonb; result jsonb:='{}';
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  FOR item IN SELECT * FROM pg_catalog.jsonb_each(review_projection_v1.value) LOOP
    pieces:=pg_catalog.string_to_array(item.key,'_'); key:=pieces[1];
    FOR i IN 2..pg_catalog.cardinality(pieces) LOOP key:=key||pg_catalog.initcap(pieces[i]); END LOOP;
    v:=item.value;
    IF v<>'null'::jsonb AND item.key=ANY(dates) THEN
      v:=pg_catalog.to_jsonb(pg_catalog.to_char((v#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    ELSIF v<>'null'::jsonb AND item.key=ANY(numbers) THEN v:=pg_catalog.to_jsonb(v#>>'{}'); END IF;
    result:=result||pg_catalog.jsonb_build_object(key,v);
  END LOOP;
  RETURN result;
END; $$;

CREATE FUNCTION structr_private.review_uuid_v1(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
RETURN value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND value<>'00000000-0000-0000-0000-000000000000';

CREATE FUNCTION structr_private.review_claims_v1() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE claims jsonb; config record; now_epoch numeric; issued numeric; expires numeric;
BEGIN
  IF session_user<>'authenticator' OR pg_catalog.current_setting('role',true) IS DISTINCT FROM 'authenticated'
    OR pg_catalog.current_setting('request.method',true) IS DISTINCT FROM 'POST'
    OR pg_catalog.current_setting('transaction_isolation')<>'serializable'
    OR pg_catalog.current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  BEGIN claims:=pg_catalog.current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END;
  SELECT id,issuer,audience,deleted_at INTO config FROM structr_private.authenticated_boundary_config WHERE id IS TRUE FOR SHARE;
  IF NOT FOUND OR config.deleted_at IS NOT NULL OR pg_catalog.jsonb_typeof(claims) IS DISTINCT FROM 'object'
    OR claims->>'iss' IS DISTINCT FROM config.issuer OR claims->>'role' IS DISTINCT FROM 'authenticated'
    OR claims->'is_anonymous' IS DISTINCT FROM 'false'::jsonb
    OR pg_catalog.jsonb_typeof(claims->'sub') IS DISTINCT FROM 'string'
    OR structr_private.review_uuid_v1(claims->>'sub') IS DISTINCT FROM true
    OR pg_catalog.jsonb_typeof(claims->'session_id') IS DISTINCT FROM 'string'
    OR structr_private.review_uuid_v1(claims->>'session_id') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF pg_catalog.jsonb_typeof(claims->'aud')='string' THEN
    IF claims->>'aud' IS DISTINCT FROM config.audience THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  ELSIF pg_catalog.jsonb_typeof(claims->'aud')='array' THEN
    IF NOT (claims->'aud' ? config.audience) OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(claims->'aud') a WHERE pg_catalog.jsonb_typeof(a)<>'string') THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  ELSE RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF pg_catalog.jsonb_typeof(claims->'iat') IS DISTINCT FROM 'number' OR pg_catalog.jsonb_typeof(claims->'exp') IS DISTINCT FROM 'number'
    OR (claims->>'iat') !~ '^[0-9]{1,16}$' OR (claims->>'exp') !~ '^[0-9]{1,16}$' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  issued:=(claims->>'iat')::numeric; expires:=(claims->>'exp')::numeric;
  now_epoch:=extract(epoch FROM pg_catalog.clock_timestamp());
  IF issued>9007199254740991 OR expires>9007199254740991 OR expires<=issued OR expires-issued>900
    OR expires<=now_epoch OR expires>now_epoch+900 OR issued>now_epoch+30 THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF claims ? 'nbf' THEN
    IF pg_catalog.jsonb_typeof(claims->'nbf') IS DISTINCT FROM 'number' OR (claims->>'nbf') !~ '^[0-9]{1,16}$' THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF (claims->>'nbf')::numeric>now_epoch THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN claims;
END; $$;

CREATE FUNCTION structr_private.review_permissions_v1(profile_role text) RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
<<review_permissions_v1>>
DECLARE role_id uuid; permission_ids uuid[]:='{}'; result text[]:='{}'; r record;
BEGIN
  SELECT id INTO role_id FROM public.roles WHERE name=profile_role FOR SHARE;
  IF NOT FOUND THEN RETURN result; END IF;
  FOR r IN SELECT id,permission_id FROM public.role_permissions WHERE role_permissions.role_id=review_permissions_v1.role_id ORDER BY id FOR SHARE LOOP
    permission_ids:=pg_catalog.array_append(permission_ids,r.permission_id);
  END LOOP;
  FOR r IN SELECT id,resource,action FROM public.permissions WHERE id=ANY(permission_ids) ORDER BY id FOR SHARE LOOP
    IF NOT (r.resource||':'||r.action=ANY(result)) THEN result:=pg_catalog.array_append(result,r.resource||':'||r.action); END IF;
  END LOOP;
  RETURN result;
END; $$;

CREATE FUNCTION structr_private.authenticated_session_v1() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb; p record; t record; slugs text[]; result jsonb;
BEGIN
  claims:=structr_private.review_claims_v1();
  SELECT id,tenant_id,external_open_id,email,login_method,full_name,company_name,role,is_active,last_signed_in,created_at,updated_at
    INTO p FROM public.profiles WHERE external_open_id=claims->>'sub' FOR SHARE;
  IF NOT FOUND OR p.is_active IS DISTINCT FROM true OR p.tenant_id IS NULL
    OR p.tenant_id='00000000-0000-0000-0000-000000000000'::uuid OR p.id='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT id,is_active INTO t FROM public.tenants WHERE id=p.tenant_id FOR SHARE;
  IF NOT FOUND OR t.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  slugs:=structr_private.review_permissions_v1(p.role);
  result:=pg_catalog.jsonb_build_object('version','structr-authenticated-session-v1',
    'profile',structr_private.review_projection_v1(pg_catalog.to_jsonb(p),ARRAY['last_signed_in','created_at','updated_at'],ARRAY[]::text[]),
    'tenantId',t.id,'permissions',pg_catalog.jsonb_build_object('slugs',slugs,'isPlatformAdmin',coalesce(p.role='admin',false)));
  PERFORM structr_private.review_claims_v1();
  RETURN result;
END; $$;

CREATE FUNCTION structr_private.internal_approval_review_v1(command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
<<internal_approval_review_v1>>
DECLARE claims jsonb; actor record; tenant record; project record; draft record; client record; membership record;
  locator uuid; actor_id uuid; tenant_id uuid; draft_id uuid; permission_slugs text[];
  settings_json jsonb:=NULL; zone_json jsonb:=NULL; scope_json jsonb:=NULL; row_json jsonb;
  snapshots jsonb:='[]'; approvals jsonb:='[]'; revocations jsonb:='[]'; authors jsonb:='[]';
  evidence record; author record; author_ids uuid[]:='{}'; source_matches boolean:=NULL;
  stack uuid[]; exits boolean[]; stack_top integer; current_id uuid; exiting boolean; colors jsonb:='{}';
  seen uuid[]:='{}'; ancestor record; parent_id uuid; history record; ref record; k text; zone_id text;
  result jsonb; physical_draft jsonb;
BEGIN
  claims:=structr_private.review_claims_v1();
  IF pg_catalog.jsonb_typeof(command) IS DISTINCT FROM 'object'
    OR command-ARRAY['id','confirmedCurrencyCode']<>'{}'::jsonb OR NOT command ?& ARRAY['id','confirmedCurrencyCode']
    OR pg_catalog.jsonb_typeof(command->'id') IS DISTINCT FROM 'string'
    OR structr_private.review_uuid_v1(command->>'id') IS DISTINCT FROM true
    OR command->'confirmedCurrencyCode' IS DISTINCT FROM '"USD"'::jsonb THEN
    RAISE EXCEPTION 'INTERNAL_APPROVAL_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  draft_id:=(command->>'id')::uuid;
  -- Locator only: protected identity is reloaded with SHARE after project -> draft.
  SELECT id,tenant_id INTO actor FROM public.profiles WHERE external_open_id=claims->>'sub' AND is_active IS TRUE;
  IF NOT FOUND OR actor.tenant_id IS NULL
    OR actor.id='00000000-0000-0000-0000-000000000000'::uuid
    OR actor.tenant_id='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  actor_id:=actor.id; tenant_id:=actor.tenant_id;
  SELECT project_id INTO locator FROM public.estimate_drafts WHERE id=draft_id AND estimate_drafts.tenant_id=internal_approval_review_v1.tenant_id;
  IF NOT FOUND OR locator IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,client_id,owner_user_id,deleted_at,commercial_channel,channel,geo_risk_class,address,city,state,zip,county,latitude,longitude,geocoded_at,geocode_confidence,geocode_source,geocoded_address,zone,zone_modifier_snapshot
    INTO project FROM public.projects WHERE id=locator AND projects.tenant_id=internal_approval_review_v1.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,project_id,client_id,version,created_at,pricing_schema_version,source,estimate_id,intake_form_id,bundle_id,supersedes_id,change_order_of,bundle_name,notes,subtotal_price,discount_applied,discount_amount,final_total_price,subtotal_cost,line_items,assembly_selections,pricing_snapshot,draft_data,commercial_channel,channel,zone,finish_level,region,trade,coastal_modifier,scope_draft_id,assembly_count,status,superseded_by,approved_at,approved_by,locked_at
    INTO draft FROM public.estimate_drafts WHERE id=draft_id AND estimate_drafts.tenant_id=internal_approval_review_v1.tenant_id FOR UPDATE;
  IF NOT FOUND OR draft.project_id IS DISTINCT FROM project.id OR draft.client_id IS NULL OR draft.client_id IS DISTINCT FROM project.client_id THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0001'; END IF;
  SELECT id,is_active INTO tenant FROM public.tenants WHERE id=tenant_id FOR SHARE;
  IF NOT FOUND OR tenant.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,external_open_id,role,is_active INTO actor FROM public.profiles WHERE id=actor_id FOR SHARE;
  IF NOT FOUND OR actor.tenant_id IS DISTINCT FROM tenant_id OR actor.is_active IS DISTINCT FROM true OR actor.external_open_id IS DISTINCT FROM claims->>'sub' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,is_active,deleted_at INTO client FROM public.clients WHERE id=draft.client_id FOR SHARE;
  IF NOT FOUND OR client.tenant_id IS DISTINCT FROM tenant_id OR client.is_active IS DISTINCT FROM true OR client.deleted_at IS NOT NULL OR project.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
  IF actor.role IS DISTINCT FROM 'admin' AND project.owner_user_id IS DISTINCT FROM actor_id THEN
    SELECT id,tenant_id,project_role,permissions,is_active INTO membership FROM public.project_members WHERE project_id=project.id AND user_id=actor_id FOR SHARE;
    IF FOUND AND membership.tenant_id IS DISTINCT FROM tenant_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
    IF FOUND AND membership.is_active IS TRUE THEN
      IF (membership.project_role IN ('owner','manager','estimator') OR (pg_catalog.jsonb_typeof(membership.permissions)='array' AND membership.permissions @> '["approve"]'::jsonb)) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
    ELSE
      permission_slugs:=structr_private.review_permissions_v1(actor.role);
      IF NOT ('project:approve'=ANY(permission_slugs)) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='P0001'; END IF;
    END IF;
  END IF;

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

  -- Present policy/geo/scope and origin references are eligibility inputs only
  -- for an undecided draft. An existing A1 record is validated against its
  -- frozen evidence in Node before ALREADY_DECIDED, as in the legacy helper.
  IF snapshots='[]'::jsonb AND approvals='[]'::jsonb AND revocations='[]'::jsonb THEN
    IF draft.status IN ('internally_approved','internal_approval_revoked') THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
    IF draft.status<>'draft' OR draft.superseded_by IS NOT NULL OR draft.approved_at IS NOT NULL OR draft.approved_by IS NOT NULL OR draft.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'INTERNAL_APPROVAL_ALREADY_DECIDED' USING ERRCODE='P0001'; END IF;
  FOR ref IN SELECT id,tenant_id,updated_at,profit_shield_overrides,geo_floor_overrides FROM public.tenant_settings
    WHERE tenant_settings.tenant_id=internal_approval_review_v1.tenant_id ORDER BY id FOR SHARE LOOP
    IF settings_json IS NULL THEN settings_json:=structr_private.review_projection_v1(pg_catalog.to_jsonb(ref),ARRAY['updated_at'],ARRAY[]::text[]); END IF;
  END LOOP;
  zone_id:=project.zone_modifier_snapshot->>'zoneId';
  IF structr_private.review_uuid_v1(zone_id) IS TRUE THEN
    SELECT id,tenant_id,is_active,zone_name,name,coastal_exposure_level,cost_multiplier,labor_modifier,material_modifier,logistics_modifier,contingency_pct,min_profit_shield_pct INTO ref FROM public.geo_zones WHERE id=zone_id::uuid FOR SHARE;
    IF FOUND THEN
      IF ref.tenant_id IS DISTINCT FROM tenant_id THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
      zone_json:=structr_private.review_projection_v1(pg_catalog.to_jsonb(ref),ARRAY[]::text[],ARRAY['cost_multiplier','labor_modifier','material_modifier','logistics_modifier','contingency_pct','min_profit_shield_pct']);
    END IF;
  END IF;
  IF draft.scope_draft_id IS NOT NULL THEN
    SELECT id,project_id,tenant_id INTO ref FROM public.scope_drafts WHERE id=draft.scope_draft_id FOR SHARE;
    IF FOUND THEN
      IF ref.tenant_id IS DISTINCT FROM tenant_id OR ref.project_id IS DISTINCT FROM project.id THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_INTEGRITY_ERROR' USING ERRCODE='P0001'; END IF;
      scope_json:=structr_private.review_projection_v1(pg_catalog.to_jsonb(ref),ARRAY[]::text[],ARRAY[]::text[]);
    END IF;
  END IF;

    IF draft.estimate_id IS NOT NULL THEN
      IF structr_private.review_uuid_v1(draft.estimate_id::text) IS DISTINCT FROM true THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
      SELECT id,tenant_id,project_id INTO ref FROM public.estimates WHERE id=draft.estimate_id FOR SHARE;
      IF NOT FOUND OR ref.tenant_id IS DISTINCT FROM tenant_id OR ref.project_id IS DISTINCT FROM project.id THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
    END IF;
    IF draft.bundle_id IS NOT NULL THEN
      IF structr_private.review_uuid_v1(draft.bundle_id::text) IS DISTINCT FROM true THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
      SELECT id,tenant_id INTO ref FROM public.bundles WHERE id=draft.bundle_id FOR SHARE;
      IF NOT FOUND OR ref.tenant_id IS DISTINCT FROM tenant_id THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
    END IF;
    IF draft.intake_form_id IS NOT NULL THEN
      IF structr_private.review_uuid_v1(draft.intake_form_id::text) IS DISTINCT FROM true THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
      SELECT id,tenant_id,project_id,form_data INTO ref FROM public.intake_forms WHERE id=draft.intake_form_id FOR SHARE;
      IF NOT FOUND OR ref.tenant_id IS DISTINCT FROM tenant_id OR ref.project_id IS DISTINCT FROM project.id THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
      IF ref.form_data IS NOT NULL AND ref.form_data<>'null'::jsonb THEN
        IF pg_catalog.jsonb_typeof(ref.form_data)<>'object' THEN RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
        FOREACH k IN ARRAY ARRAY['projectId','clientId'] LOOP
          IF ref.form_data ? k AND ref.form_data->k<>'null'::jsonb AND
            (pg_catalog.jsonb_typeof(ref.form_data->k)<>'string' OR structr_private.review_uuid_v1(ref.form_data->>k) IS DISTINCT FROM true
              OR ref.form_data->>k IS DISTINCT FROM CASE k WHEN 'projectId' THEN project.id::text ELSE client.id::text END) THEN
            RAISE EXCEPTION 'INTERNAL_APPROVAL_CONTENT_UNRESOLVED' USING ERRCODE='P0001'; END IF;
        END LOOP;
      END IF;
    END IF;
  END IF;
  result:=pg_catalog.jsonb_build_object('version','structr-authenticated-review-v1',
    'context',pg_catalog.jsonb_build_object('actorId',actor_id,'tenantId',tenant_id),
    'rows',pg_catalog.jsonb_build_object(
      'draft',structr_private.review_projection_v1(pg_catalog.to_jsonb(draft),ARRAY['created_at','approved_at','locked_at'],ARRAY['subtotal_price','discount_amount','final_total_price','subtotal_cost','coastal_modifier']),
      'project',structr_private.review_projection_v1(pg_catalog.to_jsonb(project)-'owner_user_id',ARRAY['deleted_at','geocoded_at'],ARRAY['latitude','longitude']),
      'client',structr_private.review_projection_v1(pg_catalog.to_jsonb(client),ARRAY['deleted_at'],ARRAY[]::text[]),
      'tenant',pg_catalog.jsonb_build_object('id',tenant.id,'isActive',tenant.is_active),
      'profile',pg_catalog.jsonb_build_object('id',actor.id,'tenantId',actor.tenant_id,'isActive',actor.is_active),
      'zone',zone_json,'settings',settings_json,'scopeDraft',scope_json),
    'approvalEvidence',pg_catalog.jsonb_build_object('snapshots',snapshots,'approvals',approvals,'revocations',revocations,'authors',authors,'sourceMatches',source_matches));
  PERFORM structr_private.review_claims_v1();
  RETURN result;
END; $$;
--> statement-breakpoint
-- Bound SQL bodies retain the private function reference without granting
-- schema lookup. This transitive EXECUTE pattern MUST pass the physical wrapper
-- and private-direct-call tests before any hosted application is considered.
CREATE FUNCTION public.structr_authenticated_session_v1() RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET default_transaction_isolation='serializable'
BEGIN ATOMIC SELECT structr_private.authenticated_session_v1(); END;
CREATE FUNCTION public.structr_internal_approval_review_v1(command jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET default_transaction_isolation='serializable'
BEGIN ATOMIC SELECT structr_private.internal_approval_review_v1(command); END;

REVOKE ALL ON FUNCTION public.structr_authenticated_session_v1(),public.structr_internal_approval_review_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION structr_private.review_projection_v1(jsonb,text[],text[]),structr_private.review_uuid_v1(text),
  structr_private.review_claims_v1(),structr_private.review_permissions_v1(text),
  structr_private.authenticated_session_v1(),structr_private.internal_approval_review_v1(jsonb) FROM PUBLIC,anon,authenticated,authenticator;

-- Grant while the migration principal still owns these functions. After the
-- transfer and temporary-role cleanup it deliberately cannot grant as owner.
-- The transaction publishes only the final, contained state.
GRANT EXECUTE ON FUNCTION public.structr_authenticated_session_v1(),public.structr_internal_approval_review_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION structr_private.authenticated_session_v1(),structr_private.internal_approval_review_v1(jsonb) TO authenticated;

-- Function ownership requires temporary CREATE/membership during transfer. Both
-- are withdrawn before transaction completion. No table changes owner.
GRANT structr_review_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
GRANT CREATE ON SCHEMA structr_private TO structr_review_owner_v1;
ALTER FUNCTION structr_private.review_projection_v1(jsonb,text[],text[]) OWNER TO structr_review_owner_v1;
ALTER FUNCTION structr_private.review_uuid_v1(text) OWNER TO structr_review_owner_v1;
ALTER FUNCTION structr_private.review_claims_v1() OWNER TO structr_review_owner_v1;
ALTER FUNCTION structr_private.review_permissions_v1(text) OWNER TO structr_review_owner_v1;
ALTER FUNCTION structr_private.authenticated_session_v1() OWNER TO structr_review_owner_v1;
ALTER FUNCTION structr_private.internal_approval_review_v1(jsonb) OWNER TO structr_review_owner_v1;
REVOKE CREATE ON SCHEMA structr_private FROM structr_review_owner_v1;
REVOKE structr_review_owner_v1 FROM CURRENT_USER;

DO $postflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator')
    AND (pg_catalog.pg_has_role(r.oid,'structr_review_owner_v1','SET')
      OR pg_catalog.pg_has_role(r.oid,'structr_review_owner_v1','USAGE')
      OR pg_catalog.has_schema_privilege(r.oid,'structr_private','USAGE,CREATE')))
    OR pg_catalog.has_schema_privilege('structr_review_owner_v1','public','CREATE')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relowner='structr_review_owner_v1'::regrole)
    OR EXISTS (SELECT 1 FROM structr_private.authenticated_boundary_config) THEN
    RAISE EXCEPTION 'ADR002_PRIVATE_BOUNDARY_POSTFLIGHT' USING ERRCODE='42501'; END IF;
END;
$postflight$;
