/** Offline-reviewed administrative candidate. Caller owns/attests the DB connection.
 * No env, connection factory, Auth, RBAC bootstrap, SQL installer or runtime import.
 * Mutations require a separately confirmed target, source and protected manifest.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logAudit } from "../../server/audit";
import {
  canonical,
  hash,
  fail,
  parseCalculatorHomologationManifest,
  planCalculatorHomologation,
  CATALOG_SHA256,
  LOGIN_ROLE,
  OPERATIONS,
  SYNTHETIC_IDS as I,
  type CalculatorHomologationManifest,
} from "./contract";
import { fixturePlan, type FixtureRow } from "./fixture";
import {
  assertCalculatorBoundary as boundary,
  withCalculatorOwnerMaintenance,
} from "./boundary";
export type Tx = Parameters<
  Parameters<PostgresJsDatabase["transaction"]>[0]
>[0];
export type Row = Record<string, any>;
export type Snapshot = { table: string; row: Row };
export const receiptTable = "calculator_homologation";
export const prefix = "financial.homologation.";
const tables = new Set([
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
  "structr_financial.principal_bindings",
  "structr_financial.calculator_fixtures",
]);
export async function query(tx: Pick<Tx, "execute">, q: SQL): Promise<Row[]> {
  return (await tx.execute(q)) as unknown as Row[];
}
export function tableRef(name: string) {
  if (!tables.has(name)) fail("EVIDENCE");
  const parts = name.includes(".") ? name.split(".") : ["public", name];
  return sql`${sql.identifier(parts[0])}.${sql.identifier(parts[1])}`;
}
export async function principal(tx: Tx, m: CalculatorHomologationManifest) {
  const [p] = await query(
    tx,
    sql`SELECT current_user AS "currentUser",session_user AS "sessionUser",current_database() AS database,current_setting('server_version_num') AS version,clock_timestamp() AS now`
  );
  if (
    p.currentUser !== m.expectedPrincipal ||
    p.sessionUser !== m.expectedPrincipal ||
    p.database !== m.expectedDatabase
  )
    fail("PRINCIPAL_MISMATCH");
  if (p.version !== "170011") fail("VERSION");
  return {
    kind: "database-principal",
    currentUser: p.currentUser as string,
    sessionUser: p.sessionUser as string,
  };
}
export async function role(tx: Tx) {
  const [r] = await query(
    tx,
    sql`SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil::text,rolconfig FROM pg_roles WHERE rolname=${LOGIN_ROLE}`
  );
  if (!r) fail("ROLE_MISSING");
  return r;
}
export async function operator(tx: Tx, m: CalculatorHomologationManifest) {
  const rows = await query(
    tx,
    sql`SELECT to_jsonb(p.*) AS profile,to_jsonb(t.*) AS tenant FROM public.profiles p JOIN public.tenants t ON t.id=p.tenant_id WHERE p.id=${m.operator.actorId}::uuid AND p.tenant_id=${m.operator.tenantId}::uuid AND p.external_open_id=${m.operator.subject} AND p.is_active AND t.is_active AND t.timezone='America/New_York' AND EXISTS(SELECT 1 FROM public.roles r JOIN public.role_permissions rp ON rp.role_id=r.id JOIN public.permissions perm ON perm.id=rp.permission_id WHERE r.name=p.role AND perm.resource='estimate' AND perm.action='create') FOR SHARE OF p,t`
  );
  if (rows.length !== 1) fail("OPERATOR");
  const settings = await query(
    tx,
    sql`SELECT to_jsonb(s.*) AS row FROM public.tenant_settings s WHERE s.tenant_id=${m.operator.tenantId}::uuid FOR SHARE`
  );
  if (
    settings.length !== 1 ||
    canonical(settings[0].row.profit_shield_overrides) !== "{}" ||
    canonical(settings[0].row.geo_floor_overrides) !== "{}" ||
    settings[0].row.timezone !== "America/New_York" ||
    settings[0].row.currency !== "USD"
  )
    fail("SETTINGS");
  return {
    profile: rows[0].profile,
    tenant: rows[0].tenant,
    settings: settings[0].row,
  };
}
export async function getRow(tx: Tx, table: string, id: string) {
  const rows = await query(
    tx,
    sql`SELECT to_jsonb(t.*) AS row FROM ${tableRef(table)} t WHERE id=${id}::uuid FOR SHARE`
  );
  if (rows.length > 1) fail("STATE_DRIFT");
  return rows[0]?.row ?? null;
}
export async function binding(tx: Tx) {
  return getRow(tx, "structr_financial.principal_bindings", I.binding);
}
export async function receipt(
  tx: Tx,
  m: CalculatorHomologationManifest,
  operation: string
) {
  const rows = await query(
    tx,
    sql`SELECT to_jsonb(a.*) AS row FROM public.audit_logs a WHERE action=${prefix + operation + ".completed"} AND record_id=${m.operationId} FOR SHARE`
  );
  if (rows.length > 1) fail("EVIDENCE");
  if (!rows.length) return null;
  const r = rows[0].row,
    v = r.new_values;
  if (
    r.user_id !== null ||
    r.table_name !== receiptTable ||
    v?.manifestHash !== hash(m) ||
    canonical(v.manifest) !== canonical(m) ||
    v.operationId !== m.operationId ||
    v.version !== "calculator-homologation-receipt-v1" ||
    v.catalogSha256 !== CATALOG_SHA256 ||
    v.beforeHash !== hash(r.old_values) ||
    v.afterHash !== hash(v.state) ||
    v.administrativeActor?.currentUser !== m.expectedPrincipal ||
    v.administrativeActor?.sessionUser !== m.expectedPrincipal
  )
    fail("EVIDENCE");
  return r;
}
export async function checkedAudit(
  tx: Tx,
  params: Parameters<typeof logAudit>[0]
) {
  const a = await logAudit(params, tx);
  if (!a) fail("AUDIT_MISSING");
  const [read] = await query(
    tx,
    sql`SELECT user_id,action,table_name,record_id,old_values,new_values FROM public.audit_logs WHERE id=${a.id}::uuid`
  );
  if (
    !read ||
    read.user_id !== (params.userId ?? null) ||
    read.action !== params.action ||
    read.table_name !== params.tableName ||
    read.record_id !== params.recordId ||
    canonical(read.old_values) !== canonical(params.before ?? null) ||
    canonical(read.new_values) !== canonical(params.after ?? null)
  )
    fail("AUDIT_MISMATCH");
  return a.id;
}
export async function auditedInsert(
  tx: Tx,
  m: CalculatorHomologationManifest,
  actor: Row,
  entry: FixtureRow
): Promise<Snapshot> {
  const { table, row } = entry;
  if (await getRow(tx, table, row.id)) fail("COLLISION");
  const ref = tableRef(table),
    columns = sql.join(
      Object.keys(row).map(k => sql.identifier(k)),
      sql.raw(",")
    );
  const result = await query(
    tx,
    sql`INSERT INTO ${ref} AS target (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::${ref},${JSON.stringify(row)}::jsonb) RETURNING to_jsonb(target.*) AS row`
  );
  if (result.length !== 1) fail("INSERT_MISSING");
  const after = result[0].row;
  for (const key of Object.keys(row))
    if (canonical(after[key]) !== canonical(row[key])) {
      if (
        key.endsWith("_at") &&
        Date.parse(after[key]) === Date.parse(String(row[key]))
      )
        continue;
      if (
        typeof row[key] === "string" &&
        typeof after[key] === "number" &&
        Number(row[key]) === after[key]
      )
        continue;
      fail("INSERT_MISMATCH");
    }
  await checkedAudit(tx, {
    userId: null,
    action: prefix + "prepare.row",
    tableName: table,
    recordId: row.id,
    before: null,
    after: {
      operationId: m.operationId,
      manifestHash: hash(m),
      administrativeActor: actor,
      row: after,
      afterHash: hash(after),
    },
  });
  return { table, row: after };
}
export async function completed(
  tx: Tx,
  m: CalculatorHomologationManifest,
  actor: Row,
  operation: string,
  before: unknown,
  state: unknown
) {
  return checkedAudit(tx, {
    userId: null,
    action: prefix + operation + ".completed",
    tableName: receiptTable,
    recordId: m.operationId,
    before,
    after: {
      version: "calculator-homologation-receipt-v1",
      operationId: m.operationId,
      manifestHash: hash(m),
      manifest: m,
      administrativeActor: actor,
      state,
      beforeHash: hash(before),
      afterHash: hash(state),
      catalogSha256: CATALOG_SHA256,
    },
  });
}
export async function verifyPrepared(
  tx: Tx,
  m: CalculatorHomologationManifest,
  { allowTerminal = false, checkSources = true } = {}
) {
  const b = await binding(tx);
  if (b && !b.is_active && !allowTerminal) fail("TERMINAL");
  const r = await receipt(tx, m, "prepare");
  if (!r) fail("NOT_PREPARED");
  const state = r.new_values.state;
  if (!Array.isArray(state.rows) || state.rows.length !== 20) fail("EVIDENCE");
  const expected = fixturePlan(
    m,
    state.at,
    state.prerequisites.settings
  ).rows.map(e => `${e.table}:${e.row.id}`);
  expected.push(
    `structr_financial.principal_bindings:${I.binding}`,
    `structr_financial.calculator_fixtures:${I.fixture}`
  );
  if (
    canonical(
      state.rows.map((e: Snapshot) => `${e.table}:${e.row.id}`).sort()
    ) !== canonical(expected.sort())
  )
    fail("EVIDENCE");
  const logs = await query(
    tx,
    sql`SELECT to_jsonb(a.*) AS row FROM public.audit_logs a WHERE action=${prefix + "prepare.row"} AND new_values->>'operationId'=${m.operationId} FOR SHARE`
  );
  if (logs.length !== 20) fail("EVIDENCE");
  for (const entry of state.rows as Snapshot[]) {
    const matches = logs
      .map(x => x.row)
      .filter(
        a => a.table_name === entry.table && a.record_id === entry.row.id
      );
    if (
      matches.length !== 1 ||
      matches[0].user_id !== null ||
      matches[0].old_values !== null ||
      canonical(matches[0].new_values) !==
        canonical({
          operationId: m.operationId,
          manifestHash: hash(m),
          administrativeActor: r.new_values.administrativeActor,
          row: entry.row,
          afterHash: hash(entry.row),
        })
    )
      fail("EVIDENCE");
    if (
      checkSources &&
      canonical(await getRow(tx, entry.table, entry.row.id)) !==
        canonical(entry.row)
    )
      fail("STATE_DRIFT");
  }
  if (
    !b ||
    b.actor_id !== m.operator.actorId ||
    b.tenant_id !== m.operator.tenantId ||
    b.subject !== m.operator.subject ||
    b.session_role !== LOGIN_ROLE ||
    canonical(b.operations) !== canonical(OPERATIONS)
  )
    fail("EVIDENCE");
  if (checkSources) {
    const fixture = state.rows.find(
      (e: Snapshot) => e.table === "structr_financial.calculator_fixtures"
    ).row;
    const [a] = await query(
      tx,
      sql`SELECT to_jsonb(a.*) AS row FROM public.audit_logs a WHERE id=${fixture.provenance_audit_id}::uuid FOR SHARE`
    );
    const expected = {
      contractVersion: "calculator-fixture-v1",
      bindingId: I.binding,
      tenantId: m.operator.tenantId,
      actorId: m.operator.actorId,
      fixtureId: I.fixture,
      projectId: I.project,
      intakeFormId: I.intake,
      clientId: I.client,
      manifestHash: fixture.manifest_hash,
      manifest: fixture.manifest,
    };
    if (
      !a ||
      a.row.user_id !== m.operator.actorId ||
      a.row.action !== "financial.calculator.fixture.create" ||
      a.row.table_name !== "calculator_fixtures" ||
      a.row.record_id !== I.fixture ||
      a.row.old_values !== null ||
      canonical(a.row.new_values) !== canonical(expected)
    )
      fail("PROVENANCE");
  }
  if (
    checkSources &&
    canonical(await operator(tx, m)) !== canonical(state.prerequisites)
  )
    fail("STATE_DRIFT");
  return r;
}
export async function locked<T>(
  db: PostgresJsDatabase,
  m: CalculatorHomologationManifest,
  fn: (tx: Tx, actor: Row) => Promise<T>
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
          await tx.execute(sql`SELECT pg_advisory_xact_lock(830003,1)`);
          const actor = await principal(tx, m);
          const result = await fn(tx, actor);
          remaining();
          return result;
        },
        { isolationLevel: "serializable" }
      );
    } catch (error) {
      let code: string | undefined;
      let current: unknown = error;
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
export async function requireOpenWindow(
  tx: Tx,
  m: CalculatorHomologationManifest
) {
  const [clock] = await query(tx, sql`SELECT clock_timestamp() AS now`);
  const observed = new Date(clock.now).getTime();
  if (
    !Number.isFinite(observed) ||
    observed < Date.parse(m.window.opensAt) ||
    observed >= Date.parse(m.window.closesAt)
  )
    fail("WINDOW");
}
