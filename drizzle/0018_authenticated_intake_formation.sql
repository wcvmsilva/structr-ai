-- LOCAL CANDIDATE ONLY. Not a journaled migration or approval to enable a writer.
-- F2/F5 literal reconciliation is pending. Execute only in an owned disposable
-- laboratory transaction until this exact candidate receives separate approval.
DO $preflight$
DECLARE api record; reachable record; obj record; expected record;
  allowed oid[]:=ARRAY[
    pg_catalog.to_regprocedure('public.structr_authenticated_session_v1()'),
    pg_catalog.to_regprocedure('public.structr_internal_approval_review_v1(jsonb)'),
    pg_catalog.to_regprocedure('public.structr_estimate_draft_read_v1(jsonb)'),
    pg_catalog.to_regprocedure('public.structr_internal_approval_record_v1(jsonb)')];
BEGIN
  IF NOT pg_catalog.has_schema_privilege(current_user,'public','USAGE WITH GRANT OPTION')
    OR pg_catalog.array_position(allowed,NULL) IS NOT NULL
    OR pg_catalog.to_regrole('structr_intake_create_owner_v1') IS NOT NULL
    OR pg_catalog.to_regnamespace('structr_private') IS NULL THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_BASELINE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
      ('anon','authenticated','authenticator','structr_review_owner_v1','structr_estimate_read_owner_v1'))<>5 THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_ROLE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  FOR api IN SELECT oid,rolname FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator') LOOP
    FOR reachable IN SELECT r.* FROM pg_catalog.pg_roles r WHERE r.oid=api.oid
      OR pg_catalog.pg_has_role(api.oid,r.oid,'USAGE')
      OR (api.rolname<>'authenticator' AND pg_catalog.pg_has_role(api.oid,r.oid,'SET')) LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole OR reachable.rolcreatedb OR reachable.rolreplication
        OR pg_catalog.pg_has_role(reachable.oid,'structr_review_owner_v1','SET')
        OR pg_catalog.pg_has_role(reachable.oid,'structr_review_owner_v1','USAGE')
        OR pg_catalog.pg_has_role(reachable.oid,'structr_estimate_read_owner_v1','SET')
        OR pg_catalog.pg_has_role(reachable.oid,'structr_estimate_read_owner_v1','USAGE')
        OR pg_catalog.has_schema_privilege(reachable.oid,'structr_private','USAGE,CREATE')
        OR pg_catalog.has_schema_privilege(reachable.oid,'public','CREATE')
        OR (api.rolname<>'authenticated' AND pg_catalog.has_schema_privilege(reachable.oid,'public','USAGE')) THEN
        RAISE EXCEPTION 'INTAKE_FORMATION_ROLE_PREFLIGHT' USING ERRCODE='42501'; END IF;
      FOR obj IN SELECT c.oid,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
        IF (obj.relkind='S' AND pg_catalog.has_sequence_privilege(reachable.oid,obj.oid,'SELECT,UPDATE,USAGE'))
          OR (obj.relkind<>'S' AND (pg_catalog.has_table_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR pg_catalog.has_any_column_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
          RAISE EXCEPTION 'INTAKE_FORMATION_RELATION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
      FOR obj IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP
        IF pg_catalog.has_function_privilege(reachable.oid,obj.oid,'EXECUTE')
          AND NOT (api.rolname='authenticated' AND obj.oid=ANY(allowed)) THEN
          RAISE EXCEPTION 'INTAKE_FORMATION_FUNCTION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  -- This candidate supports the inspected contained baseline. Unknown RLS cannot
  -- be silently hidden by a definer, especially during global-key collision checks.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid IN
      ('public.profiles'::regclass,'public.tenants'::regclass,'public.roles'::regclass,
       'public.role_permissions'::regclass,'public.permissions'::regclass,'public.clients'::regclass,
       'public.projects'::regclass,'public.intake_forms'::regclass,'public.audit_logs'::regclass)
      AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_RLS_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='structr_private.authenticated_boundary_config'::regclass)
    OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid='structr_private.authenticated_boundary_config'::regclass)<>4
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='structr_private.authenticated_boundary_config'::regclass AND
      (NOT polpermissive OR polcmd NOT IN ('r','w') OR pg_catalog.pg_get_expr(polqual,polrelid) IS DISTINCT FROM 'true'
       OR (polcmd='w' AND pg_catalog.pg_get_expr(polwithcheck,polrelid) IS DISTINCT FROM 'false')
       OR (polcmd='r' AND polwithcheck IS NOT NULL)
       OR NOT (polroles=ARRAY['structr_review_owner_v1'::regrole::oid] OR polroles=ARRAY['structr_estimate_read_owner_v1'::regrole::oid]))) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_RLS_PREFLIGHT' USING ERRCODE='42501'; END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('public.intake_forms','intake_forms_pkey',ARRAY['id']),
    ('public.profiles','uq_profiles_external_open_id',ARRAY['external_open_id']),
    ('public.roles','roles_name_unique',ARRAY['name']),
    ('public.permissions','uq_permissions_resource_action',ARRAY['resource','action']),
    ('public.role_permissions','uq_role_permissions_role_perm',ARRAY['role_id','permission_id'])
  ) AS requirements(relation,index_name,columns) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
      WHERE i.indrelid=expected.relation::regclass AND idx.relname=expected.index_name AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=pg_catalog.cardinality(expected.columns)
      AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality)
        FROM pg_catalog.unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=expected.columns) THEN
      RAISE EXCEPTION 'INTAKE_FORMATION_IDENTITY_PREFLIGHT' USING ERRCODE='42501'; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.intake_forms'::regclass
      AND conname='intake_forms_pkey' AND contype='p' AND NOT condeferrable AND NOT condeferred AND convalidated)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.projects'::regclass
      AND tgname='trg_reopen_provenance_insert' AND tgenabled='O'
      AND tgfoid='public.project_reopen_provenance_guard_v1()'::regprocedure AND tgtype=7) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_PROVENANCE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND tgdeferrable AND tgrelid IN
      ('public.clients'::regclass,'public.projects'::regclass,'public.intake_forms'::regclass,'public.audit_logs'::regclass)) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_DEFERRED_PREFLIGHT' USING ERRCODE='42501'; END IF;
  -- Audit is a complete Drizzle row projection. A new defaulted column must not
  -- silently escape both the immutable intention and the authorized readback.
  FOR expected IN SELECT * FROM (VALUES
    ('public.clients','id,tenant_id,name,email,phone,company,address,city,state,zip,notes,is_active,deleted_at,created_at,updated_at,client_type,commercial_channel,source_channel,email_normalized,phone_normalized,origin_lead_id'),
    ('public.projects','id,tenant_id,name,client_id,owner_user_id,client_name,client_email,address,city,state,zip,project_type,channel,status,lead_id,jobtread_id,estimated_total,actual_total,variance_pct,start_date,end_date,notes,county,zone,region,finish_level,pricing_schema_version,zone_modifier_snapshot,geocode_confidence,geocode_source,geocoded_address,geocoded_at,client_type,commercial_channel,source_channel,address_normalized,latitude,longitude,geo_warnings,geo_risk_class,updated_by,variance_threshold_pct,committed_cost_cents,approved_budget_cents,change_order_budget_cents,field_started_at,field_completed_at,closed_at,provenance_state,calibrated_at,scope_completeness_score,realized_gross_profit_pct,deleted_at,created_at,updated_at'),
    ('public.intake_forms','id,tenant_id,lead_id,project_id,status,form_data,created_at,updated_at'),
    ('public.audit_logs','id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at')
  ) requirements(relation,columns) LOOP
    IF (SELECT pg_catalog.array_agg(attname::text ORDER BY attname) FROM pg_catalog.pg_attribute
      WHERE attrelid=expected.relation::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM
      (SELECT pg_catalog.array_agg(column_name ORDER BY column_name)
       FROM pg_catalog.unnest(pg_catalog.string_to_array(expected.columns,',')) column_name) THEN
      RAISE EXCEPTION 'INTAKE_FORMATION_SHAPE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  END LOOP;
END;
$preflight$;

CREATE ROLE structr_intake_create_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,structr_private TO structr_intake_create_owner_v1;
GRANT SELECT(id,issuer,audience,deleted_at),UPDATE(id) ON structr_private.authenticated_boundary_config TO structr_intake_create_owner_v1;
GRANT SELECT(id,tenant_id,external_open_id,role,is_active),UPDATE(id) ON public.profiles TO structr_intake_create_owner_v1;
GRANT SELECT(id,is_active),UPDATE(id) ON public.tenants TO structr_intake_create_owner_v1;
GRANT SELECT(id,name),UPDATE(id) ON public.roles TO structr_intake_create_owner_v1;
GRANT SELECT(id,role_id,permission_id),UPDATE(id) ON public.role_permissions TO structr_intake_create_owner_v1;
GRANT SELECT(id,resource,action),UPDATE(id) ON public.permissions TO structr_intake_create_owner_v1;
GRANT INSERT(tenant_id,name,email,phone,address,city,state,zip),
  SELECT(id,tenant_id,name,email,phone,company,address,city,state,zip,notes,is_active,deleted_at,created_at,updated_at,client_type,commercial_channel,source_channel,email_normalized,phone_normalized,origin_lead_id)
  ON public.clients TO structr_intake_create_owner_v1;
GRANT INSERT(tenant_id,owner_user_id,client_id,client_name,client_email,name,project_type,status,channel,address,city,county,state,zip),
  SELECT(id,tenant_id,name,client_id,owner_user_id,client_name,client_email,address,city,state,zip,project_type,channel,status,lead_id,jobtread_id,estimated_total,actual_total,variance_pct,start_date,end_date,notes,county,zone,region,finish_level,pricing_schema_version,zone_modifier_snapshot,geocode_confidence,geocode_source,geocoded_address,geocoded_at,client_type,commercial_channel,source_channel,address_normalized,latitude,longitude,geo_warnings,geo_risk_class,updated_by,variance_threshold_pct,committed_cost_cents,approved_budget_cents,change_order_budget_cents,field_started_at,field_completed_at,closed_at,provenance_state,calibrated_at,scope_completeness_score,realized_gross_profit_pct,deleted_at,created_at,updated_at)
  ON public.projects TO structr_intake_create_owner_v1;
GRANT INSERT(id,tenant_id,lead_id,project_id,status,form_data),SELECT(id,tenant_id,lead_id,project_id,status,form_data,created_at,updated_at),UPDATE(id)
  ON public.intake_forms TO structr_intake_create_owner_v1;
GRANT INSERT(user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent),
  SELECT(id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at)
  ON public.audit_logs TO structr_intake_create_owner_v1;
CREATE POLICY intake_formation_config_select ON structr_private.authenticated_boundary_config FOR SELECT TO structr_intake_create_owner_v1 USING(true);
CREATE POLICY intake_formation_config_lock ON structr_private.authenticated_boundary_config FOR UPDATE TO structr_intake_create_owner_v1 USING(true) WITH CHECK(false);

GRANT structr_review_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
DO $helper_grants$
DECLARE migrator name:=current_user;
BEGIN
  SET LOCAL ROLE structr_review_owner_v1;
  GRANT EXECUTE ON FUNCTION structr_private.review_claims_v1(),structr_private.review_uuid_v1(text),
    structr_private.review_permissions_v1(text),structr_private.review_projection_v1(jsonb,text[],text[]) TO structr_intake_create_owner_v1;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',migrator);
END;
$helper_grants$;
REVOKE structr_review_owner_v1 FROM CURRENT_USER;

-- Zod4 string lengths use UTF-16 code units; PostgreSQL char_length does not.
CREATE FUNCTION structr_private.intake_string_v1(value jsonb,maximum integer,trimmed boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog
RETURN pg_catalog.jsonb_typeof(value)='string'
  AND COALESCE((SELECT sum(CASE WHEN pg_catalog.ascii(c)>65535 THEN 2 ELSE 1 END)
    FROM pg_catalog.regexp_split_to_table(value#>>'{}','') c),0)<=maximum
  AND (NOT trimmed OR ((value#>>'{}')<>'' AND (value#>>'{}')=pg_catalog.regexp_replace(value#>>'{}',
    U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+|[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$','','g')));

CREATE FUNCTION structr_private.intake_preimage_v1(preimage text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE c jsonb; p jsonb; customer jsonb; item record;
BEGIN
  IF preimage IS NULL OR pg_catalog.octet_length(preimage)>65536 OR NOT (preimage IS JSON OBJECT WITH UNIQUE KEYS) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  BEGIN c:=preimage::jsonb;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END;
  FOR item IN WITH RECURSIVE nodes(value,depth) AS (
    SELECT c,1 UNION ALL
    SELECT child.value,nodes.depth+1 FROM nodes CROSS JOIN LATERAL (
      SELECT value FROM pg_catalog.jsonb_each(CASE WHEN pg_catalog.jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)
      UNION ALL SELECT value FROM pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END)
    ) child WHERE nodes.depth<=16
  ) SELECT value,depth FROM nodes LOOP
    IF item.depth>16 AND pg_catalog.jsonb_typeof(item.value) IN ('object','array') THEN
      RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
    -- JSONB numeric accepts magnitudes whose IEEE-754 response parse is infinite.
    -- Validate that boundary without rewriting preimage bytes or rounding values.
    -- Values below one cannot overflow; do not turn allowed underflow into error.
    IF pg_catalog.jsonb_typeof(item.value)='number' AND pg_catalog.abs((item.value#>>'{}')::numeric)>=1 THEN
      BEGIN PERFORM (item.value#>>'{}')::double precision;
      EXCEPTION WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END;
    END IF;
  END LOOP;
  IF c-ARRAY['requestId','newProject','projectId','leadId','clientId','channel','serviceType','area','finishLevel','condition','notes','rawPayload','tenantId','userId']<>'{}'
    OR NOT c ?& ARRAY['requestId','newProject','serviceType','rawPayload','tenantId','userId']
    OR pg_catalog.jsonb_typeof(c->'requestId') IS DISTINCT FROM 'string'
    OR (c->>'requestId') COLLATE "C" !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
    OR pg_catalog.jsonb_typeof(c->'tenantId') IS DISTINCT FROM 'string' OR structr_private.review_uuid_v1(c->>'tenantId') IS DISTINCT FROM true
    OR pg_catalog.jsonb_typeof(c->'userId') IS DISTINCT FROM 'string' OR structr_private.review_uuid_v1(c->>'userId') IS DISTINCT FROM true
    OR pg_catalog.jsonb_typeof(c->'rawPayload') IS DISTINCT FROM 'object'
    OR (c ? 'projectId' AND c->'projectId'<>'null') OR (c ? 'clientId' AND c->'clientId'<>'null') OR (c ? 'leadId' AND c->'leadId'<>'null')
    OR structr_private.intake_string_v1(c->'serviceType',128,false) IS DISTINCT FROM true
    OR pg_catalog.regexp_replace(c->>'serviceType',U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]','','g')=''
    OR (c ? 'channel' AND c->'channel' NOT IN ('"direct"','"insurance"','"commercial"'))
    OR (c ? 'finishLevel' AND c->'finishLevel' NOT IN ('"standard"','"premium"','"luxury"')) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  FOR item IN SELECT * FROM (VALUES ('area',255),('condition',255),('notes',65536)) fields(key,maximum) LOOP
    IF c ? item.key AND c->item.key<>'null' AND structr_private.intake_string_v1(c->item.key,item.maximum,false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  END LOOP;
  p:=c->'newProject'; customer:=p->'client';
  IF pg_catalog.jsonb_typeof(p) IS DISTINCT FROM 'object'
    OR p-ARRAY['name','projectType','client','address','city','county','state','zip']<>'{}'
    OR NOT p ?& ARRAY['name','projectType','client','address']
    OR structr_private.intake_string_v1(p->'name',255,true) IS DISTINCT FROM true
    OR structr_private.intake_string_v1(p->'address',1000,true) IS DISTINCT FROM true
    OR p->'projectType' NOT IN ('"remodel"','"repair"','"new_construction"','"addition"','"insurance_restoration"','"commercial_buildout"','"exterior"')
    OR pg_catalog.jsonb_typeof(customer) IS DISTINCT FROM 'object' OR customer-ARRAY['firstName','lastName','email','phone']<>'{}'
    OR NOT customer ?& ARRAY['firstName','lastName']
    OR structr_private.intake_string_v1(customer->'firstName',128,true) IS DISTINCT FROM true
    OR structr_private.intake_string_v1(customer->'lastName',128,true) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  FOR item IN SELECT * FROM (VALUES ('city',128),('county',128),('state',2),('zip',10)) fields(key,maximum) LOOP
    IF p ? item.key AND structr_private.intake_string_v1(p->item.key,item.maximum,false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  END LOOP;
  IF (customer ? 'phone' AND structr_private.intake_string_v1(customer->'phone',64,false) IS DISTINCT FROM true)
    OR (customer ? 'email' AND (structr_private.intake_string_v1(customer->'email',320,false) IS DISTINCT FROM true
      OR (customer->>'email') COLLATE "C" !~ '^(?!\.)(?!.*\.\.)([A-Za-z0-9_''+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$')) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  RETURN c;
END;
$$;

CREATE FUNCTION structr_private.intake_create_v1(preimage text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE claims jsonb; command jsonb; p jsonb; customer jsonb; actor record; tenant record; slugs text[];
  request_id uuid; fingerprint text; full_name text; c record; project record; form record; audit record; evidence record;
  client_json jsonb; project_json jsonb; intake_json jsonb; expected jsonb; form_data jsonb;
  audit_ids uuid[]:='{}'; audit_rows jsonb:='[]'; found_count integer:=0;
  error_schema text; error_table text; error_constraint text; error_state text; error_message text;
BEGIN
  claims:=structr_private.review_claims_v1();
  command:=structr_private.intake_preimage_v1(preimage);
  SELECT id,tenant_id,external_open_id,role,is_active INTO actor FROM public.profiles WHERE external_open_id=claims->>'sub' FOR SHARE;
  IF NOT FOUND OR actor.is_active IS DISTINCT FROM true OR actor.tenant_id IS NULL
    OR actor.id='00000000-0000-0000-0000-000000000000'::uuid OR actor.tenant_id='00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT id,is_active INTO tenant FROM public.tenants WHERE id=actor.tenant_id FOR SHARE;
  IF NOT FOUND OR tenant.is_active IS DISTINCT FROM true OR command->>'tenantId' IS DISTINCT FROM actor.tenant_id::text
    OR command->>'userId' IS DISTINCT FROM actor.id::text THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF actor.role IS DISTINCT FROM 'admin' THEN
    slugs:=structr_private.review_permissions_v1(actor.role);
    IF NOT ('client:write'=ANY(slugs)) AND EXISTS(SELECT 1 FROM pg_catalog.unnest(slugs) slug WHERE slug LIKE 'client:%') THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  END IF;
  request_id:=(command->>'requestId')::uuid;
  fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(preimage,'UTF8')),'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(command->>'tenantId'),pg_catalog.hashtext(command->>'requestId'));
  PERFORM structr_private.review_claims_v1();
  SELECT id,tenant_id,lead_id,project_id,status,form_data,created_at,updated_at INTO form
    FROM public.intake_forms WHERE id=request_id AND tenant_id=actor.tenant_id FOR SHARE;
  IF FOUND THEN
    IF form.form_data->>'creationFingerprint' IS DISTINCT FROM fingerprint THEN
      RAISE EXCEPTION 'INTAKE_FORMATION_CONFLICT' USING ERRCODE='P0001'; END IF;
    PERFORM structr_private.review_claims_v1();
    RETURN pg_catalog.jsonb_build_object('version','structr-authenticated-intake-create-v1',
      'context',pg_catalog.jsonb_build_object('actorId',actor.id,'tenantId',actor.tenant_id),
      'intake',structr_private.review_projection_v1(pg_catalog.to_jsonb(form),ARRAY['created_at','updated_at'],ARRAY[]::text[]));
  END IF;
  -- Existence only. Never project another tenant's row into the response.
  IF EXISTS(SELECT 1 FROM public.intake_forms WHERE id=request_id) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_CONFLICT' USING ERRCODE='P0001'; END IF;
  p:=command->'newProject'; customer:=p->'client'; full_name:=(customer->>'firstName')||' '||(customer->>'lastName');
  PERFORM structr_private.review_claims_v1();
  INSERT INTO public.clients(tenant_id,name,email,phone,address,city,state,zip)
    VALUES(actor.tenant_id,full_name,customer->>'email',customer->>'phone',p->>'address',p->>'city',p->>'state',p->>'zip')
    RETURNING id,tenant_id,name,email,phone,company,address,city,state,zip,notes,is_active,deleted_at,created_at,updated_at,client_type,commercial_channel,source_channel,email_normalized,phone_normalized,origin_lead_id INTO c;
  expected:=pg_catalog.jsonb_build_object('tenant_id',actor.tenant_id,'name',full_name,'email',customer->>'email','phone',customer->>'phone',
    'address',p->>'address','city',p->>'city','state',p->>'state','zip',p->>'zip','is_active',true,
    'company',NULL,'notes',NULL,'deleted_at',NULL,'client_type',NULL,'commercial_channel',NULL,'source_channel',NULL,'email_normalized',NULL,'phone_normalized',NULL,'origin_lead_id',NULL);
  IF NOT FOUND OR c.id IS NULL OR pg_catalog.to_jsonb(c)-ARRAY['id','created_at','updated_at'] IS DISTINCT FROM expected
    OR c.created_at IS DISTINCT FROM pg_catalog.transaction_timestamp() OR c.updated_at IS DISTINCT FROM c.created_at THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  client_json:=structr_private.review_projection_v1(pg_catalog.to_jsonb(c),ARRAY['created_at','updated_at','deleted_at'],ARRAY[]::text[]);
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent)
    VALUES(actor.id,'client.create','clients',c.id,NULL,client_json,NULL,NULL)
    RETURNING id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at INTO audit;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  audit_ids:=pg_catalog.array_append(audit_ids,audit.id); audit_rows:=audit_rows||pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(audit));

  INSERT INTO public.projects(tenant_id,owner_user_id,client_id,client_name,client_email,name,project_type,status,channel,address,city,county,state,zip)
    VALUES(actor.tenant_id,actor.id,c.id,full_name,customer->>'email',p->>'name',p->>'projectType','intake',COALESCE(command->>'channel','direct'),p->>'address',p->>'city',p->>'county',p->>'state',p->>'zip')
    RETURNING id,tenant_id,name,client_id,owner_user_id,client_name,client_email,address,city,state,zip,project_type,channel,status,lead_id,jobtread_id,estimated_total,actual_total,variance_pct,start_date,end_date,notes,county,zone,region,finish_level,pricing_schema_version,zone_modifier_snapshot,geocode_confidence,geocode_source,geocoded_address,geocoded_at,client_type,commercial_channel,source_channel,address_normalized,latitude,longitude,geo_warnings,geo_risk_class,updated_by,variance_threshold_pct,committed_cost_cents,approved_budget_cents,change_order_budget_cents,field_started_at,field_completed_at,closed_at,provenance_state,calibrated_at,scope_completeness_score,realized_gross_profit_pct,deleted_at,created_at,updated_at INTO project;
  expected:=pg_catalog.jsonb_build_object('tenant_id',actor.tenant_id,'owner_user_id',actor.id,'client_id',c.id,'client_name',full_name,
    'client_email',customer->>'email','name',p->>'name','project_type',p->>'projectType','status','intake','channel',COALESCE(command->>'channel','direct'),
    'address',p->>'address','city',p->>'city','county',p->>'county','state',p->>'state','zip',p->>'zip',
    'provenance_state','formation_only','variance_threshold_pct',10,'committed_cost_cents',0,'change_order_budget_cents',0);
  IF NOT FOUND OR project.id IS NULL OR project.created_at IS DISTINCT FROM pg_catalog.transaction_timestamp()
    OR project.updated_at IS DISTINCT FROM project.created_at
    OR pg_catalog.jsonb_strip_nulls(pg_catalog.to_jsonb(project)-ARRAY['id','created_at','updated_at']) IS DISTINCT FROM pg_catalog.jsonb_strip_nulls(expected) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  project_json:=structr_private.review_projection_v1(pg_catalog.to_jsonb(project),
    ARRAY['created_at','updated_at','deleted_at','geocoded_at','field_started_at','field_completed_at','closed_at','calibrated_at'],
    ARRAY['estimated_total','actual_total','variance_pct','latitude','longitude','variance_threshold_pct','scope_completeness_score','realized_gross_profit_pct']);
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent)
    VALUES(actor.id,'project.create','projects',project.id,NULL,project_json,NULL,NULL)
    RETURNING id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at INTO audit;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  audit_ids:=pg_catalog.array_append(audit_ids,audit.id); audit_rows:=audit_rows||pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(audit));
  form_data:=pg_catalog.jsonb_build_object('channel',COALESCE(command->>'channel','direct'),'serviceType',command->>'serviceType',
    'area',command->>'area','finishLevel',COALESCE(command->>'finishLevel','standard'),'condition',command->>'condition',
    'notes',command->>'notes','rawPayload',command->'rawPayload','clientId',c.id,'creationFingerprint',fingerprint);
  BEGIN
    INSERT INTO public.intake_forms(id,tenant_id,lead_id,project_id,status,form_data)
      VALUES(request_id,actor.tenant_id,NULL,project.id,'draft',form_data)
      RETURNING id,tenant_id,lead_id,project_id,status,form_data,created_at,updated_at INTO form;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS error_schema=SCHEMA_NAME,error_table=TABLE_NAME,error_constraint=CONSTRAINT_NAME;
    -- Only this exact INSERT's global request PK can be the stale-snapshot race.
    -- Re-raise aborts the entire RPC; the transport retries its whole transaction.
    IF error_schema='public' AND error_table='intake_forms' AND error_constraint='intake_forms_pkey' THEN
      RAISE EXCEPTION 'INTAKE_FORMATION_SERIALIZATION_RETRY' USING ERRCODE='40001'; END IF;
    RAISE;
  END;
  IF NOT FOUND OR form.id IS DISTINCT FROM request_id OR form.tenant_id IS DISTINCT FROM actor.tenant_id
    OR form.project_id IS DISTINCT FROM project.id OR form.lead_id IS NOT NULL OR form.status IS DISTINCT FROM 'draft'
    OR form.form_data IS DISTINCT FROM form_data OR form.created_at IS DISTINCT FROM pg_catalog.transaction_timestamp()
    OR form.updated_at IS DISTINCT FROM form.created_at THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  intake_json:=structr_private.review_projection_v1(pg_catalog.to_jsonb(form),ARRAY['created_at','updated_at'],ARRAY[]::text[]);
  INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent)
    VALUES(actor.id,'intake.create','intake_forms',form.id,NULL,intake_json,NULL,NULL)
    RETURNING id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at INTO audit;
  IF NOT FOUND THEN RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  audit_ids:=pg_catalog.array_append(audit_ids,audit.id); audit_rows:=audit_rows||pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(audit));

  -- Also flush a deferred trigger introduced by later authorized DDL. There is
  -- no business DML after this barrier; the readback observes its effective rows.
  SET CONSTRAINTS ALL IMMEDIATE;
  -- Read every just-created snapshot back after all audit triggers have run.
  SELECT id,tenant_id,name,email,phone,company,address,city,state,zip,notes,is_active,deleted_at,created_at,updated_at,client_type,commercial_channel,source_channel,email_normalized,phone_normalized,origin_lead_id INTO evidence FROM public.clients WHERE id=c.id;
  IF NOT FOUND OR pg_catalog.to_jsonb(evidence) IS DISTINCT FROM pg_catalog.to_jsonb(c) THEN RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,name,client_id,owner_user_id,client_name,client_email,address,city,state,zip,project_type,channel,status,lead_id,jobtread_id,estimated_total,actual_total,variance_pct,start_date,end_date,notes,county,zone,region,finish_level,pricing_schema_version,zone_modifier_snapshot,geocode_confidence,geocode_source,geocoded_address,geocoded_at,client_type,commercial_channel,source_channel,address_normalized,latitude,longitude,geo_warnings,geo_risk_class,updated_by,variance_threshold_pct,committed_cost_cents,approved_budget_cents,change_order_budget_cents,field_started_at,field_completed_at,closed_at,provenance_state,calibrated_at,scope_completeness_score,realized_gross_profit_pct,deleted_at,created_at,updated_at INTO evidence FROM public.projects WHERE id=project.id;
  IF NOT FOUND OR pg_catalog.to_jsonb(evidence) IS DISTINCT FROM pg_catalog.to_jsonb(project) THEN RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,lead_id,project_id,status,form_data,created_at,updated_at INTO evidence FROM public.intake_forms WHERE id=form.id;
  IF NOT FOUND OR pg_catalog.to_jsonb(evidence) IS DISTINCT FROM pg_catalog.to_jsonb(form) THEN RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  FOR evidence IN SELECT id,user_id,action,table_name,record_id,old_values,new_values,ip_address,user_agent,created_at FROM public.audit_logs WHERE id=ANY(audit_ids) LOOP
    found_count:=found_count+1;
    IF NOT (audit_rows @> pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(evidence)))
      OR evidence.user_id IS DISTINCT FROM actor.id OR evidence.old_values IS NOT NULL
      OR evidence.ip_address IS NOT NULL OR evidence.user_agent IS NOT NULL OR evidence.created_at IS DISTINCT FROM pg_catalog.transaction_timestamp()
      OR ((evidence.id=audit_ids[1] AND evidence.action='client.create' AND evidence.table_name='clients' AND evidence.record_id=c.id AND evidence.new_values=client_json)
        OR (evidence.id=audit_ids[2] AND evidence.action='project.create' AND evidence.table_name='projects' AND evidence.record_id=project.id AND evidence.new_values=project_json)
        OR (evidence.id=audit_ids[3] AND evidence.action='intake.create' AND evidence.table_name='intake_forms' AND evidence.record_id=form.id AND evidence.new_values=intake_json)) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  END LOOP;
  IF found_count<>3 THEN RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
  PERFORM structr_private.review_claims_v1();
  RETURN pg_catalog.jsonb_build_object('version','structr-authenticated-intake-create-v1',
    'context',pg_catalog.jsonb_build_object('actorId',actor.id,'tenantId',actor.tenant_id),'intake',intake_json);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
  IF error_state IN ('40001','40P01') THEN RAISE EXCEPTION 'INTAKE_FORMATION_TRANSACTION_RETRY' USING ERRCODE=error_state;
  ELSIF error_state='42501' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  ELSIF error_state='P0001' AND error_message IN ('INTAKE_FORMATION_INPUT_INVALID','INTAKE_FORMATION_CONFLICT','INTAKE_FORMATION_INTEGRITY_VIOLATION') THEN
    RAISE EXCEPTION '%',error_message USING ERRCODE='P0001';
  ELSE RAISE EXCEPTION 'INTAKE_FORMATION_INTEGRITY_VIOLATION' USING ERRCODE='P0001'; END IF;
END;
$$;

CREATE FUNCTION public.structr_intake_create_v1(preimage text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET default_transaction_isolation='serializable'
BEGIN ATOMIC SELECT structr_private.intake_create_v1(preimage); END;
REVOKE ALL ON FUNCTION public.structr_intake_create_v1(text),structr_private.intake_create_v1(text),
  structr_private.intake_preimage_v1(text),structr_private.intake_string_v1(jsonb,integer,boolean) FROM PUBLIC,anon,authenticated,authenticator;
GRANT EXECUTE ON FUNCTION public.structr_intake_create_v1(text),structr_private.intake_create_v1(text) TO authenticated;
GRANT structr_intake_create_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
GRANT CREATE ON SCHEMA structr_private TO structr_intake_create_owner_v1;
ALTER FUNCTION structr_private.intake_create_v1(text) OWNER TO structr_intake_create_owner_v1;
ALTER FUNCTION structr_private.intake_preimage_v1(text) OWNER TO structr_intake_create_owner_v1;
ALTER FUNCTION structr_private.intake_string_v1(jsonb,integer,boolean) OWNER TO structr_intake_create_owner_v1;
REVOKE CREATE ON SCHEMA structr_private FROM structr_intake_create_owner_v1;
REVOKE structr_intake_create_owner_v1 FROM CURRENT_USER;
DO $postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator') AND
      (pg_catalog.pg_has_role(oid,'structr_intake_create_owner_v1','SET') OR pg_catalog.pg_has_role(oid,'structr_intake_create_owner_v1','USAGE')
       OR pg_catalog.has_schema_privilege(oid,'structr_private','USAGE,CREATE')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner='structr_intake_create_owner_v1'::regrole)
    OR pg_catalog.has_schema_privilege('structr_intake_create_owner_v1','public','CREATE')
    OR pg_catalog.has_schema_privilege('structr_intake_create_owner_v1','structr_private','CREATE')
    OR (NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AND
      (pg_catalog.pg_has_role(current_user,'structr_intake_create_owner_v1','SET')
       OR pg_catalog.pg_has_role(current_user,'structr_intake_create_owner_v1','USAGE'))) THEN
    RAISE EXCEPTION 'INTAKE_FORMATION_POSTFLIGHT' USING ERRCODE='42501'; END IF;
END;
$postflight$;
