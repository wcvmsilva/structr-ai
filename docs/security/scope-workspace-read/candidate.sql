-- SWR-1 local candidate; not journaled and not authorization to activate hosted.
-- Apply atomically after 0018 with IF-1 closed. No business/audit writes.
DO $preflight$
DECLARE api record; reachable record; obj record; expected record;
  allowed oid[]:=ARRAY[
    pg_catalog.to_regprocedure('public.structr_authenticated_session_v1()'),
    pg_catalog.to_regprocedure('public.structr_internal_approval_review_v1(jsonb)'),
    pg_catalog.to_regprocedure('public.structr_estimate_draft_read_v1(jsonb)'),
    pg_catalog.to_regprocedure('public.structr_internal_approval_record_v1(jsonb)')];
BEGIN
  IF pg_catalog.array_position(allowed,NULL) IS NOT NULL
    OR pg_catalog.to_regrole('structr_scope_workspace_read_owner_v1') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.structr_intake_create_v1(text)') IS NULL
    OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
      ('anon','authenticated','authenticator','structr_review_owner_v1','structr_estimate_read_owner_v1','structr_intake_create_owner_v1'))<>6 THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_BASELINE_PREFLIGHT' USING ERRCODE='42501'; END IF;
  -- GRANT/REVOKE below touches only this migrator's own grantor edge. Refuse an
  -- existing edge from that grantor; memberships granted by others are preserved.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='structr_review_owner_v1'::regrole
      AND member=current_user::regrole AND grantor=current_user::regrole) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_MIGRATOR_PREFLIGHT' USING ERRCODE='42501'; END IF;
  -- A new NOBYPASSRLS owner still inherits PUBLIC. Private namespace secrecy
  -- does not excuse ambient grants; NULL function ACL means PUBLIC EXECUTE.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      WHERE p.pronamespace='structr_private'::regnamespace AND acl.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) acl
      WHERE c.relnamespace='structr_private'::regnamespace AND c.relkind IN ('r','p','v','m','f','S') AND acl.grantee=0)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl
      WHERE c.relnamespace='structr_private'::regnamespace AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee=0) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_PRIVATE_ACL_PREFLIGHT' USING ERRCODE='42501'; END IF;
  FOR api IN SELECT oid,rolname FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator') LOOP
    FOR reachable IN SELECT r.* FROM pg_catalog.pg_roles r WHERE r.oid=api.oid
      OR pg_catalog.pg_has_role(api.oid,r.oid,'USAGE')
      OR (api.rolname<>'authenticator' AND pg_catalog.pg_has_role(api.oid,r.oid,'SET')) LOOP
      IF reachable.rolsuper OR reachable.rolbypassrls OR reachable.rolcreaterole OR reachable.rolcreatedb OR reachable.rolreplication
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles o WHERE o.rolname IN
          ('structr_review_owner_v1','structr_estimate_read_owner_v1','structr_intake_create_owner_v1') AND
          (pg_catalog.pg_has_role(reachable.oid,o.oid,'SET') OR pg_catalog.pg_has_role(reachable.oid,o.oid,'USAGE')))
        OR pg_catalog.has_schema_privilege(reachable.oid,'structr_private','USAGE,CREATE')
        OR pg_catalog.has_schema_privilege(reachable.oid,'public','CREATE')
        OR (api.rolname<>'authenticated' AND pg_catalog.has_schema_privilege(reachable.oid,'public','USAGE'))
        OR pg_catalog.has_function_privilege(reachable.oid,'structr_private.intake_create_v1(text)','EXECUTE') THEN
        RAISE EXCEPTION 'SCOPE_WORKSPACE_ROLE_PREFLIGHT' USING ERRCODE='42501'; END IF;
      FOR obj IN SELECT c.oid,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
        IF (obj.relkind='S' AND pg_catalog.has_sequence_privilege(reachable.oid,obj.oid,'SELECT,UPDATE,USAGE'))
          OR (obj.relkind<>'S' AND (pg_catalog.has_table_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR pg_catalog.has_any_column_privilege(reachable.oid,obj.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
          RAISE EXCEPTION 'SCOPE_WORKSPACE_RELATION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
      FOR obj IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' LOOP
        IF pg_catalog.has_function_privilege(reachable.oid,obj.oid,'EXECUTE')
          AND NOT (api.rolname='authenticated' AND obj.oid=ANY(allowed)) THEN
          RAISE EXCEPTION 'SCOPE_WORKSPACE_FUNCTION_PREFLIGHT' USING ERRCODE='42501'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid IN
      ('public.profiles'::regclass,'public.tenants'::regclass,'public.projects'::regclass,'public.project_members'::regclass,
       'public.roles'::regclass,'public.role_permissions'::regclass,'public.permissions'::regclass,'public.intake_forms'::regclass)
      AND (relrowsecurity OR relforcerowsecurity))
    OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='structr_private.authenticated_boundary_config'::regclass)
    OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid='structr_private.authenticated_boundary_config'::regclass)<>6
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='structr_private.authenticated_boundary_config'::regclass AND
      (NOT polpermissive OR polcmd NOT IN ('r','w') OR pg_catalog.pg_get_expr(polqual,polrelid) IS DISTINCT FROM 'true'
       OR (polcmd='w' AND pg_catalog.pg_get_expr(polwithcheck,polrelid) IS DISTINCT FROM 'false')
       OR (polcmd='r' AND polwithcheck IS NOT NULL)
       OR NOT (polroles=ARRAY['structr_review_owner_v1'::regrole::oid] OR polroles=ARRAY['structr_estimate_read_owner_v1'::regrole::oid]
         OR polroles=ARRAY['structr_intake_create_owner_v1'::regrole::oid])))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='structr_private.authenticated_boundary_config'::regclass
      GROUP BY polroles,polcmd HAVING count(*)<>1) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_RLS_PREFLIGHT' USING ERRCODE='42501'; END IF;
  FOR expected IN SELECT * FROM (VALUES
    ('public.profiles','uq_profiles_external_open_id',ARRAY['external_open_id']),
    ('public.roles','roles_name_unique',ARRAY['name']),
    ('public.permissions','uq_permissions_resource_action',ARRAY['resource','action']),
    ('public.role_permissions','uq_role_permissions_role_perm',ARRAY['role_id','permission_id'])
  ) requirements(relation,index_name,columns) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
      WHERE i.indrelid=expected.relation::regclass AND idx.relname=expected.index_name AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=pg_catalog.cardinality(expected.columns)
      AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ordinality)
        FROM pg_catalog.unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)=expected.columns) THEN
      RAISE EXCEPTION 'SCOPE_WORKSPACE_IDENTITY_PREFLIGHT' USING ERRCODE='42501'; END IF;
  END LOOP;
END;
$preflight$;

CREATE ROLE structr_scope_workspace_read_owner_v1 NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,structr_private TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,issuer,audience,deleted_at),UPDATE(id) ON structr_private.authenticated_boundary_config TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,tenant_id,external_open_id,role,is_active),UPDATE(id) ON public.profiles TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,is_active),UPDATE(id) ON public.tenants TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,tenant_id,owner_user_id,deleted_at,name,project_type,channel,status,address,city,state,zip,county,zone),UPDATE(id) ON public.projects TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,tenant_id,project_id,user_id,project_role,permissions,is_active),UPDATE(id) ON public.project_members TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,name),UPDATE(id) ON public.roles TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,role_id,permission_id),UPDATE(id) ON public.role_permissions TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,resource,action),UPDATE(id) ON public.permissions TO structr_scope_workspace_read_owner_v1;
GRANT SELECT(id,tenant_id,project_id,status,form_data,created_at,updated_at),UPDATE(id) ON public.intake_forms TO structr_scope_workspace_read_owner_v1;
CREATE POLICY scope_workspace_config_select ON structr_private.authenticated_boundary_config FOR SELECT TO structr_scope_workspace_read_owner_v1 USING(true);
CREATE POLICY scope_workspace_config_lock ON structr_private.authenticated_boundary_config FOR UPDATE TO structr_scope_workspace_read_owner_v1 USING(true) WITH CHECK(false);
GRANT structr_review_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
DO $helper_grants$
DECLARE migrator name:=current_user;
BEGIN
  SET LOCAL ROLE structr_review_owner_v1;
  GRANT EXECUTE ON FUNCTION structr_private.review_claims_v1(),structr_private.review_uuid_v1(text),structr_private.review_permissions_v1(text)
    TO structr_scope_workspace_read_owner_v1;
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',migrator);
END;
$helper_grants$;
REVOKE structr_review_owner_v1 FROM CURRENT_USER;

CREATE FUNCTION structr_private.scope_workspace_read_v1(command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE claims jsonb; actor record; tenant record; project record; member record; intake record; value jsonb; result jsonb;
  member_count integer:=0; member_active boolean:=false; member_read boolean:=false; slugs text[]; field text;
  error_state text; error_message text;
BEGIN
  -- Later RLS cannot silently turn a contradiction or protected row into absence.
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid IN
      ('public.profiles'::regclass,'public.tenants'::regclass,'public.projects'::regclass,'public.project_members'::regclass,
       'public.roles'::regclass,'public.role_permissions'::regclass,'public.permissions'::regclass,'public.intake_forms'::regclass)
      AND (relrowsecurity OR relforcerowsecurity)) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
  claims:=structr_private.review_claims_v1();
  IF pg_catalog.jsonb_typeof(command) IS DISTINCT FROM 'object' OR command-ARRAY['projectId','intakeFormId']<>'{}'
    OR NOT command ?& ARRAY['projectId','intakeFormId']
    OR pg_catalog.jsonb_typeof(command->'projectId') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(command->'intakeFormId') IS DISTINCT FROM 'string'
    OR structr_private.review_uuid_v1(command->>'projectId') IS DISTINCT FROM true
    OR structr_private.review_uuid_v1(command->>'intakeFormId') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_INPUT_INVALID' USING ERRCODE='P0001'; END IF;
  SELECT id,tenant_id,role,is_active INTO actor FROM public.profiles WHERE external_open_id=claims->>'sub' FOR SHARE;
  IF NOT FOUND OR actor.is_active IS DISTINCT FROM true
    OR structr_private.review_uuid_v1(actor.id::text) IS DISTINCT FROM true
    OR structr_private.review_uuid_v1(actor.tenant_id::text) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT id,is_active INTO tenant FROM public.tenants WHERE id=actor.tenant_id FOR SHARE;
  IF NOT FOUND OR tenant.is_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT id,tenant_id,owner_user_id,deleted_at,name,project_type,channel,status,address,city,state,zip,county,zone
    INTO project FROM public.projects WHERE id=(command->>'projectId')::uuid FOR SHARE;
  IF NOT FOUND OR project.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF project.tenant_id IS DISTINCT FROM actor.tenant_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  FOR member IN SELECT id,tenant_id,project_role,permissions,is_active FROM public.project_members
      WHERE project_id=project.id AND user_id=actor.id ORDER BY id FOR SHARE LOOP
    member_count:=member_count+1;
    IF member_count>1 THEN RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
    IF member.tenant_id IS DISTINCT FROM actor.tenant_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF member.permissions IS NOT NULL AND member.permissions<>'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(member.permissions)<>'array' THEN
        RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
      FOR value IN SELECT * FROM pg_catalog.jsonb_array_elements(member.permissions) LOOP
        IF pg_catalog.jsonb_typeof(value)<>'string' OR value NOT IN ('"read"','"write"','"approve"','"delete"') THEN
          RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
      END LOOP;
    END IF;
    member_active:=member.is_active IS TRUE;
    member_read:=member.project_role IN ('owner','manager','estimator','field','viewer') OR COALESCE(member.permissions ? 'read',false);
  END LOOP;
  IF actor.role IS DISTINCT FROM 'admin' AND project.owner_user_id IS DISTINCT FROM actor.id THEN
    IF member_active THEN
      IF member_read IS DISTINCT FROM true THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    ELSE
      slugs:=structr_private.review_permissions_v1(actor.role);
      IF NOT ('project:read'=ANY(slugs)) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    END IF;
  END IF;
  SELECT id,tenant_id,project_id,status,form_data,created_at,updated_at INTO intake FROM public.intake_forms
    WHERE id=(command->>'intakeFormId')::uuid FOR SHARE;
  IF NOT FOUND OR intake.project_id IS DISTINCT FROM project.id THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF intake.tenant_id IS DISTINCT FROM actor.tenant_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF pg_catalog.jsonb_typeof(intake.form_data) IS DISTINCT FROM 'object'
    OR intake.form_data ?| ARRAY['id','tenantId','projectId','userId','status','createdAt','updatedAt']
    OR NOT pg_catalog.isfinite(intake.created_at) OR NOT pg_catalog.isfinite(intake.updated_at)
    OR intake.created_at IS NULL OR intake.updated_at IS NULL
    OR intake.created_at<'0001-01-01 00:00:00+00'::timestamptz OR intake.updated_at<'0001-01-01 00:00:00+00'::timestamptz
    OR intake.created_at>='10000-01-01 00:00:00+00'::timestamptz OR intake.updated_at>='10000-01-01 00:00:00+00'::timestamptz
    OR project.name IS NULL OR project.project_type IS NULL OR project.status IS NULL OR intake.status IS NULL THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
  FOREACH field IN ARRAY ARRAY['serviceType','area','finishLevel','condition','channel','notes'] LOOP
    value:=intake.form_data->field;
    IF value IS NOT NULL AND value<>'null'::jsonb AND pg_catalog.jsonb_typeof(value)<>'string' THEN
      RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
  END LOOP;
  result:=pg_catalog.jsonb_build_object('version','structr-authenticated-scope-workspace-read-v1',
    'context',pg_catalog.jsonb_build_object('actorId',actor.id,'tenantId',actor.tenant_id),
    'project',pg_catalog.jsonb_build_object('id',project.id,'tenantId',project.tenant_id,'name',project.name,'projectType',project.project_type,
      'channel',project.channel,'status',project.status,'address',project.address,'city',project.city,'state',project.state,
      'zipCode',project.zip,'county',project.county,'zone',project.zone),
    'intake',pg_catalog.jsonb_build_object('id',intake.id,'tenantId',intake.tenant_id,'projectId',intake.project_id,'status',intake.status,
      'serviceType',intake.form_data->>'serviceType','area',intake.form_data->>'area','finishLevel',intake.form_data->>'finishLevel',
      'condition',intake.form_data->>'condition','channel',intake.form_data->>'channel','notes',intake.form_data->>'notes',
      'createdAt',pg_catalog.to_char(intake.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt',pg_catalog.to_char(intake.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'scopes',pg_catalog.jsonb_build_object('state','notLoaded'),'catalog',pg_catalog.jsonb_build_object('state','notLoaded'));
  FOR value IN SELECT e.value FROM pg_catalog.jsonb_each(result->'project') e
    UNION ALL SELECT e.value FROM pg_catalog.jsonb_each(result->'intake') e LOOP
    IF pg_catalog.jsonb_typeof(value)='string' AND pg_catalog.octet_length(value#>>'{}')>65536 THEN
      RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
  END LOOP;
  IF pg_catalog.octet_length(result::text)>1048576
    OR (result->'intake'->>'createdAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR (result->'intake'->>'updatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
  PERFORM structr_private.review_claims_v1();
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS error_state=RETURNED_SQLSTATE,error_message=MESSAGE_TEXT;
  IF error_state IN ('40001','40P01') THEN RAISE EXCEPTION 'SCOPE_WORKSPACE_TRANSACTION_RETRY' USING ERRCODE=error_state;
  ELSIF error_state='42501' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
  ELSIF error_state='P0002' AND error_message='NOT_FOUND' THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002';
  ELSIF error_state='P0001' AND error_message IN ('SCOPE_WORKSPACE_INPUT_INVALID','SCOPE_WORKSPACE_METADATA_INVALID') THEN
    RAISE EXCEPTION '%',error_message USING ERRCODE='P0001';
  ELSE RAISE EXCEPTION 'SCOPE_WORKSPACE_METADATA_INVALID' USING ERRCODE='P0001'; END IF;
END;
$$;

CREATE FUNCTION public.structr_scope_workspace_read_v1(command jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog SET default_transaction_isolation='serializable'
BEGIN ATOMIC SELECT structr_private.scope_workspace_read_v1(command); END;
REVOKE ALL ON FUNCTION public.structr_scope_workspace_read_v1(jsonb),structr_private.scope_workspace_read_v1(jsonb)
  FROM PUBLIC,anon,authenticated,authenticator;
GRANT EXECUTE ON FUNCTION public.structr_scope_workspace_read_v1(jsonb),structr_private.scope_workspace_read_v1(jsonb) TO authenticated;
GRANT structr_scope_workspace_read_owner_v1 TO CURRENT_USER WITH INHERIT FALSE,SET TRUE;
GRANT CREATE ON SCHEMA structr_private TO structr_scope_workspace_read_owner_v1;
ALTER FUNCTION structr_private.scope_workspace_read_v1(jsonb) OWNER TO structr_scope_workspace_read_owner_v1;
REVOKE CREATE ON SCHEMA structr_private FROM structr_scope_workspace_read_owner_v1;
REVOKE structr_scope_workspace_read_owner_v1 FROM CURRENT_USER;
DO $postflight$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','authenticator') AND
      (pg_catalog.pg_has_role(oid,'structr_scope_workspace_read_owner_v1','SET') OR pg_catalog.pg_has_role(oid,'structr_scope_workspace_read_owner_v1','USAGE')
       OR pg_catalog.has_schema_privilege(oid,'structr_private','USAGE,CREATE')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE relowner='structr_scope_workspace_read_owner_v1'::regrole)
    OR pg_catalog.has_schema_privilege('structr_scope_workspace_read_owner_v1','public','CREATE')
    OR pg_catalog.has_schema_privilege('structr_scope_workspace_read_owner_v1','structr_private','CREATE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.pronamespace='structr_private'::regnamespace
      AND pg_catalog.has_function_privilege('structr_scope_workspace_read_owner_v1',p.oid,'EXECUTE')
      AND p.oid NOT IN ('structr_private.review_claims_v1()'::regprocedure,'structr_private.review_uuid_v1(text)'::regprocedure,
        'structr_private.review_permissions_v1(text)'::regprocedure,'structr_private.scope_workspace_read_v1(jsonb)'::regprocedure))
    OR (NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) AND
      (pg_catalog.pg_has_role(current_user,'structr_scope_workspace_read_owner_v1','SET')
       OR pg_catalog.pg_has_role(current_user,'structr_scope_workspace_read_owner_v1','USAGE'))) THEN
    RAISE EXCEPTION 'SCOPE_WORKSPACE_POSTFLIGHT' USING ERRCODE='42501'; END IF;
END;
$postflight$;
