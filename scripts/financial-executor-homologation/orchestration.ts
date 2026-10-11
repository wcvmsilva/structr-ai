/** Injected-handle coordination. Each step has its own durable SERIALIZABLE commit.
 * No aggregate atomicity, automatic scheduler, credential factory, or hosted entry. */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  applyCalculatorRbac,
  withdrawCalculatorRbac,
} from "../financial-executor-homologation-rbac";
import {
  prepareCalculatorHomologation,
  openCalculatorHomologation,
  deactivateCalculatorHomologation,
  withdrawCalculatorHomologation,
} from "./admin";
import {
  canonical,
  fail,
  hash,
  LOGIN_ROLE,
  SYNTHETIC_IDS as I,
} from "./contract";
import {
  parseCalculatorCoordinationManifest,
  type CalculatorCoordinationManifest,
} from "./orchestration-contract";
type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
type AdministrativeIdentity = {
  current: string;
  session: string;
  database: string;
};
/** All evidence reads have real PostgreSQL limits as well as one retry budget. */
async function evidenceTransaction<T>(
  db: PostgresJsDatabase,
  m: CalculatorCoordinationManifest,
  read: (tx: Tx, actor: AdministrativeIdentity) => Promise<T>
) {
  const deadline = performance.now() + 30_000;
  const remaining = () => {
    const ms = Math.floor(deadline - performance.now());
    if (ms < 1) fail("DEADLINE");
    return ms;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    remaining();
    try {
      return await db.transaction(
        async tx => {
          await tx.execute(
            sql`SELECT set_config('transaction_timeout',${String(remaining())},true)`
          );
          await tx.execute(
            sql.raw(
              "SET LOCAL TimeZone='UTC'; SET LOCAL search_path=pg_catalog,public,pg_temp; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s'"
            )
          );
          const [actor] = await tx.execute<AdministrativeIdentity>(
            sql`SELECT current_user::text AS current,session_user::text AS session,current_database() AS database`
          );
          if (
            actor.current !== m.fixture.expectedPrincipal ||
            actor.session !== m.fixture.expectedPrincipal ||
            actor.database !== m.fixture.expectedDatabase
          )
            fail("PRINCIPAL_MISMATCH");
          const result = await read(tx, actor);
          remaining();
          return result;
        },
        { isolationLevel: "serializable", accessMode: "read write" }
      );
    } catch (error) {
      let current: unknown = error,
        code: string | undefined;
      for (
        let depth = 0;
        depth < 4 && current && typeof current === "object";
        depth++
      ) {
        const e = current as { code?: string; cause?: unknown };
        code ??= e.code;
        current = e.cause;
      }
      if (attempt === 2 || !["40001", "40P01"].includes(code ?? ""))
        throw error;
    }
  }
  return fail("RETRY_EXHAUSTED");
}
/** Read actual committed receipts, never trust caller-supplied receipt IDs. Subordinate
 * operations separately verify full per-row audit histories and state before mutation. */
async function receipts(
  db: PostgresJsDatabase,
  m: CalculatorCoordinationManifest
) {
  return evidenceTransaction(db, m, async (tx, actor) => {
    const rows = await tx.execute(
      sql`SELECT id,user_id,action,table_name,record_id,new_values,old_values FROM public.audit_logs WHERE (action='financial.homologation.prepare.completed' AND record_id=${m.fixture.operationId}) OR (action='financial.calculator.rbac.apply.completed' AND record_id=${m.rbac.operationId}) FOR SHARE`
    );
    const result: { fixture: string | null; rbac: string | null } = {
      fixture: null,
      rbac: null,
    };
    for (const row of rows) {
      const isFixture =
          row.action === "financial.homologation.prepare.completed",
        key = isFixture ? "fixture" : "rbac",
        manifest = isFixture ? m.fixture : m.rbac,
        v = row.new_values as Record<string, any>;
      if (
        result[key] ||
        row.user_id !== null ||
        row.table_name !==
          (isFixture
            ? "calculator_homologation"
            : "financial_calculator_rbac") ||
        !v ||
        canonical(v.manifest) !== canonical(manifest) ||
        v.manifestHash !== hash(manifest) ||
        v.operationId !== manifest.operationId ||
        v.administrativeActor?.currentUser !== actor.current ||
        v.administrativeActor?.sessionUser !== actor.session ||
        v.version !==
          (isFixture
            ? "calculator-homologation-receipt-v1"
            : "calculator-rbac-receipt-v1") ||
        (isFixture
          ? v.beforeHash !== hash(row.old_values) ||
            v.afterHash !== hash(v.state)
          : v.phase !== "apply")
      )
        fail("EVIDENCE");
      result[key] = String(row.id);
    }
    return result;
  });
}
/** Missing completion evidence is not proof that preparation never committed.
 * Only restore an RBAC-only partial preparation after checking the actual footprint.
 * Repeat after restoration, so a preparation racing the first observation cannot
 * turn missing evidence into a false completed-withdrawal receipt. */
async function hasFinancialFootprint(
  db: PostgresJsDatabase,
  m: CalculatorCoordinationManifest
) {
  return evidenceTransaction(db, m, async tx => {
    const [state] = await tx.execute(sql`SELECT
      EXISTS(SELECT 1 FROM public.audit_logs WHERE (action LIKE 'financial.homologation.%' AND (record_id=${m.fixture.operationId} OR new_values->>'operationId'=${m.fixture.operationId})) OR (action='financial.calculator.fixture.create' AND record_id=${I.fixture})) AS audits,
      EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${LOGIN_ROLE}) AS role_exists,
      EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${LOGIN_ROLE} AND rolcanlogin) AS login,
      EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=${LOGIN_ROLE}) AS sessions,
      to_regnamespace('structr_financial') IS NOT NULL AS schema_exists,
      to_regclass('structr_financial.principal_bindings') IS NOT NULL AND to_regclass('structr_financial.calculator_fixtures') IS NOT NULL AND to_regclass('structr_financial.calculator_requests') IS NOT NULL AS relations`);
    if (state.audits || state.login || state.sessions) return true;
    if (!state.relations && (state.schema_exists || state.role_exists))
      return true;
    if (state.relations) {
      const [financial] = await tx.execute(
        sql`SELECT EXISTS(SELECT 1 FROM structr_financial.principal_bindings WHERE id=${I.binding}::uuid OR session_role=${LOGIN_ROLE}) OR EXISTS(SELECT 1 FROM structr_financial.calculator_fixtures WHERE id=${I.fixture}::uuid OR binding_id=${I.binding}::uuid) OR EXISTS(SELECT 1 FROM structr_financial.calculator_requests WHERE binding_id=${I.binding}::uuid) AS present`
      );
      if (financial.present) return true;
    }
    const ids = Object.values(I);
    for (const table of [
      "clients",
      "geo_zones",
      "projects",
      "intake_forms",
      "cost_types",
      "units",
      "cost_codes",
      "cost_code_pricing_history",
      "assemblies",
      "assembly_items",
    ]) {
      const [rows] = await tx.execute(
        sql`SELECT EXISTS(SELECT 1 FROM public.${sql.identifier(table)} WHERE id IN (${sql.join(
          ids.map(id => sql`${id}::uuid`),
          sql`, `
        )})) AS present`
      );
      if (rows.present) return true;
    }
    return false;
  });
}
async function requirePrepared(
  db: PostgresJsDatabase,
  m: CalculatorCoordinationManifest
) {
  const r = await receipts(db, m);
  if (!r.fixture || !r.rbac) fail("NOT_PREPARED");
  return r as { fixture: string; rbac: string };
}
export async function withdrawCalculatorPilot(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorCoordinationManifest(value),
    r = await receipts(db, m);
  if (!r.rbac) fail("NOT_PREPARED");
  if (!r.fixture && (await hasFinancialFootprint(db, m))) {
    return {
      status: "cleanup_pending" as const,
      receipts: r,
      financial: null,
      rbacRestored: false,
      hostedReady: false as const,
    };
  }
  // Financial authority must be durably gone before attempting nominal profile CAS.
  const financial = r.fixture
    ? await withdrawCalculatorHomologation(db, m.fixture)
    : null;
  let rbacRestored = false;
  try {
    await withdrawCalculatorRbac(db, m.rbac);
    rbacRestored = true;
  } catch {
    /* Drift/audit failure: retain financial closure; require reviewed cleanup. */
  }
  const noUnprovenFinancialWork =
    !!financial || !(await hasFinancialFootprint(db, m));
  return {
    status:
      rbacRestored &&
      noUnprovenFinancialWork &&
      (!financial || financial.status === "withdrawn")
        ? ("withdrawn" as const)
        : ("cleanup_pending" as const),
    receipts: r,
    financial,
    rbacRestored,
    hostedReady: false as const,
  };
}
async function compensate(
  db: PostgresJsDatabase,
  m: CalculatorCoordinationManifest
) {
  try {
    const cleanup = await withdrawCalculatorPilot(db, m);
    return {
      ...cleanup,
      status:
        cleanup.status === "withdrawn"
          ? ("compensated" as const)
          : ("cleanup_pending" as const),
    };
  } catch {
    return {
      status: "cleanup_pending" as const,
      rbacRestored: false,
      financial: null,
      receipts: { fixture: null, rbac: null },
      hostedReady: false as const,
    };
  }
}
export async function prepareCalculatorPilot(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorCoordinationManifest(value);
  try {
    await applyCalculatorRbac(db, m.rbac);
    await prepareCalculatorHomologation(db, m.fixture);
    return {
      status: "prepared" as const,
      receipts: await requirePrepared(db, m),
      hostedReady: false as const,
    };
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("_TERMINAL"))
      throw error;
    // An uncertain commit is never resubmitted: reconcile committed evidence first.
    const observed = await receipts(db, m);
    if (!observed.rbac) throw error;
    return compensate(db, m);
  }
}
export async function openCalculatorPilot(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorCoordinationManifest(value);
  await requirePrepared(db, m);
  // Replay validates complete RBAC history/current authority; neither replay widens grants.
  try {
    await applyCalculatorRbac(db, m.rbac);
    const opened = await openCalculatorHomologation(db, m.fixture);
    return {
      status: "opened" as const,
      receipts: await requirePrepared(db, m),
      openReceiptId: opened.receiptId,
      hostedReady: false as const,
    };
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("_TERMINAL"))
      throw error;
    return compensate(db, m);
  }
}
export async function deactivateCalculatorPilot(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorCoordinationManifest(value);
  const r = await requirePrepared(db, m);
  return {
    ...(await deactivateCalculatorHomologation(db, m.fixture)),
    receipts: r,
  };
}
