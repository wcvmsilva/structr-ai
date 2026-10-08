/** Offline renderer for a DISTINCT administrative SQL execution path.
 * This SQL does not invoke db.transaction or the TypeScript logAudit helper.
 * Review the exact artifact and independently bind the connector destination.
 */
import { createHash } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import { profiles, tenants } from "../drizzle/schema";
import {
  buildHomologIdentityState,
  parseHomologAccessManifest,
  planHomologAccess,
} from "./homolog-access-bootstrap";

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const executorId = "structr-homolog-identities-sql-v1";
type Table = typeof tenants | typeof profiles;
function entries(table: Table) {
  return Object.entries(getTableColumns(table));
}
function projection(table: Table, alias: string): string {
  return `jsonb_build_object(${entries(table)
    .flatMap(([key, column]) => [
      literal(key),
      ["createdAt", "updatedAt", "lastSignedIn", "activatedAt"].includes(key)
        ? `to_char(${alias}.${identifier(column.name)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
        : `${alias}.${identifier(column.name)}`,
    ])
    .join(",")})`;
}
function insertRow(table: Table, name: string): string {
  const columns = entries(table),
    physical = `jsonb_build_object(${columns.flatMap(([key, column]) => [literal(column.name), `row_value->${literal(key)}`]).join(",")})`;
  return `INSERT INTO public.${identifier(name)} (${columns.map(([, c]) => identifier(c.name)).join(",")})
    SELECT ${columns.map(([, c]) => `r.${identifier(c.name)}`).join(",")}
    FROM jsonb_populate_record(NULL::public.${identifier(name)},${physical}) r;`;
}

export function renderHomologAccessSql(value: unknown) {
  const manifest = parseHomologAccessManifest(value),
    plan = planHomologAccess(manifest);
  // Timestamp placeholders are replaced with the database's actual microsecond
  // clock inside the transaction; rendering time is never recorded as creation time.
  const rowPlan = buildHomologIdentityState(manifest, new Date(0));
  const tenantIds = Object.values(manifest.tenants).map(t => t.id);
  const profileIds = Object.values(manifest.profiles).map(p => p.id);
  const allIds = [
    manifest.operationId,
    ...tenantIds,
    ...Object.values(manifest.profiles).flatMap(p => [p.id, p.providerSubject]),
  ];
  const textArray = (values: string[]) =>
    `ARRAY[${values.map(literal).join(",")}]`;
  const predicate = `(a.action='homolog.identity.bootstrap.completed' AND a.record_id=operation_id) OR a.new_values->>'operationId'=operation_id::text`;
  const readEvidence = `
    PERFORM a.id FROM public.audit_logs a WHERE ${predicate} FOR SHARE;
    SELECT coalesce(jsonb_agg(jsonb_build_object('action',a.action,'tableName',a.table_name,'recordId',a.record_id,
      'userId',a.user_id,'oldValues',a.old_values,'newValues',a.new_values)),'[]'::jsonb)
      INTO evidence FROM public.audit_logs a WHERE ${predicate};`;
  const readState = `
    PERFORM t.id FROM public.tenants t WHERE t.id=ANY(tenant_ids) FOR SHARE;
    PERFORM p.id FROM public.profiles p WHERE p.id=ANY(profile_ids) FOR SHARE;
    SELECT jsonb_build_object(
      'tenants',(SELECT coalesce(jsonb_agg(${projection(tenants, "t")} ORDER BY t.id),'[]'::jsonb) FROM public.tenants t WHERE t.id=ANY(tenant_ids)),
      'profiles',(SELECT coalesce(jsonb_agg(${projection(profiles, "p")} ORDER BY p.id),'[]'::jsonb) FROM public.profiles p WHERE p.id=ANY(profile_ids))) INTO actual;`;
  const verifyEvidence = `
    SELECT count(*) INTO receipt_count FROM jsonb_array_elements(evidence) e
      WHERE e->>'action'='homolog.identity.bootstrap.completed' AND e->>'recordId'=operation_id::text AND e->>'tableName'='homolog_identity_bootstrap';
    SELECT e INTO receipt FROM jsonb_array_elements(evidence) e
      WHERE e->>'action'='homolog.identity.bootstrap.completed' AND e->>'recordId'=operation_id::text AND e->>'tableName'='homolog_identity_bootstrap' LIMIT 1;
    IF receipt_count<>1 OR jsonb_array_length(evidence)<>6
      OR receipt->'newValues'->>'version' IS DISTINCT FROM 'structr-homolog-identity-receipt-v1'
      OR receipt->'newValues'->>'operationId' IS DISTINCT FROM operation_id::text
      OR receipt->'newValues'->>'manifestHash' IS DISTINCT FROM manifest_hash
      OR receipt->'newValues'->'manifest' IS DISTINCT FROM manifest
      OR receipt->'userId' IS DISTINCT FROM 'null'::jsonb
      OR receipt->'newValues'->'administrativeActor'->>'kind' IS DISTINCT FROM 'database-principal'
      OR jsonb_typeof(receipt->'newValues'->'administrativeActor'->'currentUser') IS DISTINCT FROM 'string'
      OR jsonb_typeof(receipt->'newValues'->'administrativeActor'->'sessionUser') IS DISTINCT FROM 'string'
      OR coalesce(length(receipt->'newValues'->'administrativeActor'->>'currentUser'),0)=0
      OR coalesce(length(receipt->'newValues'->'administrativeActor'->>'sessionUser'),0)=0
      OR (receipt->'newValues'->'administrativeActor')-ARRAY['kind','currentUser','sessionUser'] IS DISTINCT FROM '{}'::jsonb
      OR receipt->'oldValues' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'HOMOLOG_OPERATION_CONFLICT';
    END IF;
    IF (receipt->'newValues' ? 'executorId') OR (receipt->'newValues' ? 'executorHash') THEN
      IF receipt->'newValues'->'executorId' IS DISTINCT FROM to_jsonb(${literal(executorId)}::text)
        OR receipt->'newValues'->'executorHash' IS DISTINCT FROM to_jsonb(expected_executor_hash) THEN
        RAISE EXCEPTION 'HOMOLOG_OPERATION_CONFLICT';
      END IF;
    ELSIF require_executor_metadata THEN
      RAISE EXCEPTION 'HOMOLOG_OPERATION_CONFLICT';
    END IF;
    IF jsonb_array_length(actual->'tenants')<>2 OR jsonb_array_length(actual->'profiles')<>3
      OR receipt->'newValues'->'state' IS DISTINCT FROM actual THEN RAISE EXCEPTION 'HOMOLOG_STATE_DRIFT'; END IF;
    FOR row_value IN SELECT jsonb_array_elements((actual->'tenants')||(actual->'profiles')) LOOP
      table_name := CASE WHEN row_value ? 'slug' THEN 'tenants' ELSE 'profiles' END;
      action_name := CASE WHEN table_name='tenants' THEN 'homolog.identity.tenant.create' ELSE 'homolog.identity.profile.create' END;
      SELECT count(*) INTO audit_count FROM jsonb_array_elements(evidence) e
        WHERE e->>'recordId'=row_value->>'id' AND e->>'tableName'=table_name AND e->>'action'=action_name
          AND e->'userId'='null'::jsonb AND e->'oldValues'='null'::jsonb
          AND e->'newValues'=jsonb_build_object('operationId',operation_id,'manifestHash',manifest_hash,'row',row_value);
      IF audit_count<>1 THEN RAISE EXCEPTION 'HOMOLOG_OPERATION_CONFLICT'; END IF;
    END LOOP;`;
  const body = `SET LOCAL search_path=pg_catalog;
DO $homolog_identity_bootstrap$
DECLARE
  manifest jsonb := ${literal(JSON.stringify(manifest))}::jsonb;
  manifest_hash text := ${literal(plan.manifestHash)};
  -- Capture the trusted generated envelope before any INSERT or trigger runs.
  -- A trigger must not replace the expected value by changing a custom setting.
  expected_executor_hash text := current_setting('structr.homolog_executor_hash',true);
  require_executor_metadata boolean := false;
  operation_id uuid := ${literal(manifest.operationId)};
  tenant_ids uuid[] := ${textArray(tenantIds)}::uuid[];
  profile_ids uuid[] := ${textArray(profileIds)}::uuid[];
  all_ids uuid[] := ${textArray(allIds)}::uuid[];
  expected jsonb := ${literal(JSON.stringify(rowPlan))}::jsonb;
  actual jsonb; evidence jsonb; receipt jsonb; row_value jsonb;
  receipt_count integer; audit_count integer; table_name text; action_name text;
  at_text text; status text; error_message text;
BEGIN
  IF current_setting('transaction_isolation')<>'serializable' OR current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'HOMOLOG_BOOTSTRAP_FAILED';
  END IF;
  IF (expected_executor_hash ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'HOMOLOG_BOOTSTRAP_FAILED';
  END IF;
  PERFORM pg_advisory_xact_lock(731014,hashtext(operation_id::text));
  ${readEvidence}
  IF jsonb_array_length(evidence)>0 THEN
    ${readState}
    ${verifyEvidence}
    status := 'replayed';
  ELSE
    require_executor_metadata := true;
    IF EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=ANY(all_ids) OR t.slug=ANY(${textArray(Object.values(manifest.tenants).map(t => t.slug))}))
      OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=ANY(all_ids) OR p.external_open_id=ANY(all_ids::text[])) THEN
      RAISE EXCEPTION 'HOMOLOG_IDENTITY_COLLISION';
    END IF;
    at_text := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    SELECT jsonb_build_object('tenants',(SELECT jsonb_agg(e||jsonb_build_object('createdAt',at_text,'updatedAt',at_text) ORDER BY e->>'id') FROM jsonb_array_elements(expected->'tenants') e),
      'profiles',(SELECT jsonb_agg(e||jsonb_build_object('createdAt',at_text,'updatedAt',at_text) ORDER BY e->>'id') FROM jsonb_array_elements(expected->'profiles') e)) INTO expected;
    FOR row_value IN SELECT jsonb_array_elements(expected->'tenants') LOOP
      ${insertRow(tenants, "tenants")}
      INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values)
      VALUES(NULL,'homolog.identity.tenant.create','tenants',(row_value->>'id')::uuid,NULL,
        jsonb_build_object('operationId',operation_id,'manifestHash',manifest_hash,'row',row_value));
    END LOOP;
    FOR row_value IN SELECT jsonb_array_elements(expected->'profiles') LOOP
      ${insertRow(profiles, "profiles")}
      INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values)
      VALUES(NULL,'homolog.identity.profile.create','profiles',(row_value->>'id')::uuid,NULL,
        jsonb_build_object('operationId',operation_id,'manifestHash',manifest_hash,'row',row_value));
    END LOOP;
    ${readState}
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'HOMOLOG_STATE_DRIFT'; END IF;
    INSERT INTO public.audit_logs(user_id,action,table_name,record_id,old_values,new_values)
    VALUES(NULL,'homolog.identity.bootstrap.completed','homolog_identity_bootstrap',operation_id,NULL,
      jsonb_build_object('version','structr-homolog-identity-receipt-v1','operationId',operation_id,'manifestHash',manifest_hash,
        'manifest',manifest,'state',actual,'administrativeActor',jsonb_build_object('kind','database-principal','currentUser',current_user,'sessionUser',session_user),
        'executorId',${literal(executorId)},'executorHash',expected_executor_hash));
    ${readEvidence}
    ${readState}
    ${verifyEvidence}
    status := 'created';
  END IF;
  -- The summary outside the DO block also reports the captured trusted value,
  -- not a setting a trigger may have changed while the receipt was inserted.
  PERFORM set_config('structr.homolog_executor_hash',expected_executor_hash,true);
  PERFORM set_config('structr.homolog_bootstrap_status',status,true);
EXCEPTION WHEN serialization_failure OR deadlock_detected THEN
  RAISE EXCEPTION 'HOMOLOG_BOOTSTRAP_RETRY_REQUIRED' USING ERRCODE=SQLSTATE;
WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS error_message=MESSAGE_TEXT;
  IF error_message IN ('HOMOLOG_OPERATION_CONFLICT','HOMOLOG_IDENTITY_COLLISION','HOMOLOG_STATE_DRIFT') THEN
    RAISE EXCEPTION '%',error_message;
  END IF;
  RAISE EXCEPTION 'HOMOLOG_BOOTSTRAP_FAILED';
END;
$homolog_identity_bootstrap$;
SELECT jsonb_build_object('status',current_setting('structr.homolog_bootstrap_status'),
  'operationId',${literal(manifest.operationId)},'manifestHash',${literal(plan.manifestHash)},'tenants',2,'profiles',3,
  'authVerified',false,'databaseTargetVerified',false,'executorId',${literal(executorId)},
  'executorHash',current_setting('structr.homolog_executor_hash')) AS bootstrap_result;
`;
  const executorHash = createHash("sha256").update(body).digest("hex");
  const rendered = `-- Administrative identity bootstrap; review this exact artifact before any remote execution.
-- Source commit and provider subjects are supplied references, not Auth or deployment attestations.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT set_config('structr.homolog_executor_hash',${literal(executorHash)},true);
${body}COMMIT;
`;
  return {
    sql: rendered,
    body,
    executorId,
    executorHash,
    manifestHash: plan.manifestHash,
  };
}
