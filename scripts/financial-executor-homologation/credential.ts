/** Local audited candidate; the caller separately attests its administrative handle.
 * No connection/env factory, provider write, generation or activation here. */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  readCalculatorCredentialArtifact,
  type CalculatorCredentialArtifactPlan,
} from "./credential-artifact";
import { canonical, hash, fail, LOGIN_ROLE } from "./contract";
import {
  locked,
  binding,
  role,
  query,
  verifyPrepared,
  requireOpenWindow,
  checkedAudit,
  type Tx,
} from "./admin-internal";
import { assertCalculatorBoundary } from "./boundary";
import {
  parseCalculatorCredentialManifest,
  credentialChain,
  credentialReference,
  credentialPrefix,
  credentialTable,
  type CalculatorCredentialManifest,
} from "./credential-receipt";
function safeError(error: unknown): Error {
  // Return a fresh error without driver SQL, params, detail, context or cause.
  let current = error,
    code: string | undefined;
  for (
    let depth = 0;
    depth < 4 && current && typeof current === "object";
    depth++
  ) {
    const e = current as { code?: string; cause?: unknown };
    if (e.code === "40001" || e.code === "40P01") code = e.code;
    current = e.cause;
  }
  const message =
    error instanceof Error &&
    /^CALCULATOR_HOMOLOGATION_[A-Z_]+$/.test(error.message)
      ? error.message
      : "CALCULATOR_HOMOLOGATION_CREDENTIAL_OPERATION_FAILED";
  return Object.assign(new Error(message), code ? { code } : {});
}
export function assertCalculatorCredentialLoggingProfile(
  p: Record<string, string | null>
) {
  const absentOr = (key: string, value: string) =>
    p[key] === null || p[key] === value;
  if (
    !["none", "ddl"].includes(p.statement ?? "") ||
    p.duration !== "off" ||
    p.minimum !== "-1" ||
    p.sampleMinimum !== "-1" ||
    p.errorParameters !== "0" ||
    !absentOr("audit", "none") ||
    !absentOr("auditRole", "") ||
    !absentOr("auditParameters", "off") ||
    !absentOr("statistics", "top") ||
    !absentOr("utility", "on") ||
    !absentOr("nested", "off") ||
    !(p.explain === null || ["-1", "10000", "10s"].includes(p.explain)) ||
    !absentOr("explainSample", "1")
  )
    fail("CREDENTIAL_LOGGING_PROFILE");
}
async function loggingProfile(tx: Tx) {
  const [p] = await query(
    tx,
    sql`SELECT current_setting('log_statement') AS statement,current_setting('pgaudit.log',true) AS audit,current_setting('pg_stat_statements.track',true) AS statistics,current_setting('pg_stat_statements.track_utility',true) AS utility,current_setting('auto_explain.log_nested_statements',true) AS nested,current_setting('auto_explain.log_min_duration',true) AS explain,current_setting('auto_explain.sample_rate',true) AS "explainSample",current_setting('log_duration') AS duration,current_setting('log_min_duration_statement') AS minimum,current_setting('log_min_duration_sample') AS "sampleMinimum",current_setting('log_parameter_max_length_on_error') AS "errorParameters",current_setting('pgaudit.role',true) AS "auditRole",current_setting('pgaudit.log_parameter',true) AS "auditParameters"`
  );
  assertCalculatorCredentialLoggingProfile(p);
}
const createProcedure =
  sql.raw(`CREATE PROCEDURE pg_temp.calculator_set_password_v1(verifier text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $credential$
BEGIN
  EXECUTE format('ALTER ROLE structr_calculator_login_v1 PASSWORD %L', verifier);
EXCEPTION
  WHEN serialization_failure OR deadlock_detected THEN RAISE EXCEPTION USING ERRCODE=SQLSTATE, MESSAGE='CALCULATOR_CREDENTIAL_RETRY';
  WHEN query_canceled OR assert_failure THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CALCULATOR_CREDENTIAL_ASSIGNMENT_FAILED';
  WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='CALCULATOR_CREDENTIAL_ASSIGNMENT_FAILED';
END $credential$`);
async function closedState(tx: Tx, m: CalculatorCredentialManifest) {
  if ((await binding(tx))?.is_active === false) fail("TERMINAL");
  await assertCalculatorBoundary(tx);
  await verifyPrepared(tx, m.fixture);
  await requireOpenWindow(tx, m.fixture);
  // Any opening of this fixed role is terminal for credential replacement, even
  // if a caller subsequently sets NOLOGIN. There is no rotation/resume increment.
  if (
    (
      await query(
        tx,
        sql`SELECT id FROM public.audit_logs WHERE action='financial.homologation.open.completed' FOR SHARE`
      )
    ).length
  )
    fail("CREDENTIAL_PREVIOUSLY_OPENED");
  const before = await role(tx);
  if (before.rolcanlogin) fail("LOGIN_ALREADY_OPEN");
  if (
    (
      await query(
        tx,
        sql`SELECT pid FROM pg_stat_activity WHERE usename=${LOGIN_ROLE}`
      )
    ).length
  )
    fail("EXISTING_SESSIONS");
  await loggingProfile(tx);
  return before;
}
async function assign(
  db: PostgresJsDatabase,
  value: unknown,
  plan: CalculatorCredentialArtifactPlan,
  replacing: boolean
) {
  const m = parseCalculatorCredentialManifest(value);
  if (canonical(m.metadata) !== canonical(plan.metadata))
    fail("CREDENTIAL_ARTIFACT_MISMATCH");
  let artifact;
  try {
    artifact = await readCalculatorCredentialArtifact(plan);
  } catch (error) {
    throw safeError(error);
  }
  // Bounded administrative retries happen inside this callback. Task1 deliberately
  // sanitizes callback exceptions, so return a safe error record and throw afterward.
  const outcome = await artifact.withSecret(async secret => {
    try {
      const result = await locked(db, m.fixture, async (tx, actor) => {
        try {
          const before = await closedState(tx, m),
            chain = await credentialChain(tx, m.fixture),
            previous = chain.at(-1);
          if (chain.some(r => r.record_id === m.metadata.operationId))
            fail("CREDENTIAL_ALREADY_OBSERVED");
          if (
            chain.some(
              r =>
                r.new_values.manifest.metadata.generationId ===
                m.metadata.generationId
            )
          )
            fail("CREDENTIAL_GENERATION_REUSED");
          const usedIds = new Set(
            chain.flatMap(r => [
              r.id,
              r.record_id,
              r.new_values.manifest.metadata.generationId,
            ])
          );
          if (
            usedIds.has(m.metadata.operationId) ||
            usedIds.has(m.metadata.generationId)
          )
            fail("CREDENTIAL_IDENTIFIERS_REUSED");
          if (replacing) {
            if (
              !previous ||
              !m.expectedPreviousReceiptId ||
              previous.id !== m.expectedPreviousReceiptId
            )
              fail("CREDENTIAL_STALE");
            const a = previous.new_values.manifest.metadata,
              { operationId: ao, generationId: ag, ...oldIdentity } = a,
              {
                operationId: bo,
                generationId: bg,
                ...newIdentity
              } = m.metadata;
            if (canonical(oldIdentity) !== canonical(newIdentity))
              fail("CREDENTIAL_DESTINATION_MISMATCH");
            if (canonical(previous.new_values.state.role) !== canonical(before))
              fail("STATE_DRIFT");
          } else if (previous || m.expectedPreviousReceiptId !== null)
            fail("CREDENTIAL_INITIAL_STATE");
          await tx.execute(createProcedure);
          await tx.execute(
            sql.raw(
              "REVOKE ALL ON PROCEDURE pg_temp.calculator_set_password_v1(text) FROM PUBLIC"
            )
          );
          await tx.execute(
            sql`CALL pg_temp.calculator_set_password_v1(${secret.verifier})`
          );
          await tx.execute(
            sql.raw("DROP PROCEDURE pg_temp.calculator_set_password_v1(text)")
          );
          const after = await role(tx);
          if (canonical(before) !== canonical(after)) fail("ROLE_TRANSITION");
          const snapshot = {
              role: before,
              credential: previous ? credentialReference(previous) : null,
            },
            state = { role: after, generationId: m.metadata.generationId };
          const id = await checkedAudit(tx, {
            userId: null,
            action:
              credentialPrefix +
              (replacing ? "replace" : "provision") +
              ".completed",
            tableName: credentialTable,
            recordId: m.metadata.operationId,
            before: snapshot,
            after: {
              version: "calculator-credential-receipt-v1",
              manifest: m,
              manifestHash: hash(m),
              administrativeActor: actor,
              state,
              beforeHash: hash(snapshot),
              afterHash: hash(state),
            },
          });
          const verified = await credentialChain(tx, m.fixture);
          if (verified.at(-1)?.id !== id) fail("CREDENTIAL_EVIDENCE");
          await requireOpenWindow(tx, m.fixture);
          return {
            status: "committed" as const,
            operationId: m.metadata.operationId,
            receiptId: id,
            generationId: m.metadata.generationId,
          };
        } catch (error) {
          throw safeError(error);
        }
      });
      return { ok: true as const, result };
    } catch (error) {
      return { ok: false as const, error: safeError(error) };
    }
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.result;
}
export async function provisionCalculatorCredential(
  db: PostgresJsDatabase,
  manifest: unknown,
  artifactPlan: CalculatorCredentialArtifactPlan
) {
  return assign(db, manifest, artifactPlan, false);
}
export async function replaceClosedCalculatorCredential(
  db: PostgresJsDatabase,
  manifest: unknown,
  artifactPlan: CalculatorCredentialArtifactPlan
) {
  return assign(db, manifest, artifactPlan, true);
}
/** An uncertain result never resends a verifier. not_observed is an observation,
 * not proof of rollback or authorization to recreate/discard the staged artifact. */
export async function recoverCalculatorCredential(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorCredentialManifest(value);
  try {
    return await locked(db, m.fixture, async tx => {
      const chain = await credentialChain(tx, m.fixture),
        found = chain.find(r => r.record_id === m.metadata.operationId);
      if (!found)
        return {
          status: "not_observed" as const,
          operationId: m.metadata.operationId,
          generationId: m.metadata.generationId,
        };
      if (canonical(found.new_values.manifest) !== canonical(m))
        fail("CREDENTIAL_EVIDENCE");
      return {
        status: "committed" as const,
        operationId: m.metadata.operationId,
        ...credentialReference(found),
      };
    });
  } catch (error) {
    throw safeError(error);
  }
}
