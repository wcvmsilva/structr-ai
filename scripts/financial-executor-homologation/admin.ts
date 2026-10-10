/** Offline-reviewed administrative candidate. Caller owns/attests the DB connection.
 * No env, connection factory, Auth, RBAC bootstrap, SQL installer or runtime import.
 * Mutations require a separately confirmed target, source and protected manifest.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
type Row = Record<string, any>;
type Snapshot = { table: string; row: Row };
const receiptTable = "calculator_homologation";
const prefix = "financial.homologation.";
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
async function query(tx: Pick<Tx, "execute">, q: SQL): Promise<Row[]> {
  return (await tx.execute(q)) as unknown as Row[];
}
function tableRef(name: string) {
  if (!tables.has(name)) fail("EVIDENCE");
  const parts = name.includes(".") ? name.split(".") : ["public", name];
  return sql`${sql.identifier(parts[0])}.${sql.identifier(parts[1])}`;
}
async function principal(tx: Tx, m: CalculatorHomologationManifest) {
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
async function role(tx: Tx) {
  const [r] = await query(
    tx,
    sql`SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil::text,rolconfig FROM pg_roles WHERE rolname=${LOGIN_ROLE}`
  );
  if (!r) fail("ROLE_MISSING");
  return r;
}
async function boundary(tx: Tx) {
  const [version] = await query(
    tx,
    sql`SELECT current_setting('server_version_num') AS version`
  );
  if (version.version !== "170011") fail("VERSION");
  try {
    await tx.execute(
      sql.raw(
        await readFile(new URL("./preflight.sql", import.meta.url), "utf8")
      )
    );
  } catch {
    fail("PRIVILEGE_PREFLIGHT");
  }
  const unsafe = await query(
    tx,
    sql`SELECT r.rolname FROM pg_roles r WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') AND (r.rolsuper OR r.rolinherit OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolconfig IS NOT NULL OR (r.rolname<>${LOGIN_ROLE} AND r.rolcanlogin))`
  );
  const members = await query(
    tx,
    sql`SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1')`
  );
  if (unsafe.length || members.length) fail("ROLE_PREFLIGHT");
  const [roles] = await query(
    tx,
    sql`SELECT count(*)::int AS count FROM pg_roles WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1')`
  );
  if (roles.count !== 3) fail("ROLE_PREFLIGHT");
  const excess = await query(
    tx,
    sql`SELECT 'relation' AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND ((c.relkind='S' AND has_sequence_privilege(${LOGIN_ROLE},c.oid,'SELECT,UPDATE,USAGE')) OR (c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(${LOGIN_ROLE},c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(${LOGIN_ROLE},c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))) UNION ALL SELECT 'schema' FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_schema_privilege(${LOGIN_ROLE},n.oid,'CREATE') UNION ALL SELECT 'database' WHERE has_database_privilege(${LOGIN_ROLE},current_database(),'CREATE,TEMPORARY') UNION ALL SELECT 'function' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND has_function_privilege(${LOGIN_ROLE},p.oid,'EXECUTE') AND p.oid<>ALL(ARRAY['structr_financial.calculator_context_v1(jsonb)'::regprocedure::oid,'structr_financial.calculator_snapshot_v1(jsonb)'::regprocedure::oid,'structr_financial.calculator_create_v1(jsonb,jsonb)'::regprocedure::oid,'structr_financial.calculator_recover_v1(jsonb)'::regprocedure::oid])`
  );
  if (excess.length) fail("PRIVILEGE_PREFLIGHT");
  await tx.execute(sql.raw("SET LOCAL search_path=pg_catalog"));
  const catalog = await query(
    tx,
    sql.raw(await readFile(new URL("./catalog.sql", import.meta.url), "utf8"))
  );
  const observed = createHash("sha256")
    .update(catalog.map(r => `${r.identity}:${r.sha256}`).join("\n"))
    .digest("hex");
  if (catalog.length !== 1144 || observed !== CATALOG_SHA256)
    fail("CATALOG_PREFLIGHT");
  await tx.execute(sql.raw("SET LOCAL search_path=pg_catalog,public,pg_temp"));
  return observed;
}
async function operator(tx: Tx, m: CalculatorHomologationManifest) {
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
async function getRow(tx: Tx, table: string, id: string) {
  const rows = await query(
    tx,
    sql`SELECT to_jsonb(t.*) AS row FROM ${tableRef(table)} t WHERE id=${id}::uuid FOR SHARE`
  );
  if (rows.length > 1) fail("STATE_DRIFT");
  return rows[0]?.row ?? null;
}
async function binding(tx: Tx) {
  return getRow(tx, "structr_financial.principal_bindings", I.binding);
}
async function receipt(
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
async function checkedAudit(tx: Tx, params: Parameters<typeof logAudit>[0]) {
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
async function auditedInsert(
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
async function completed(
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
async function verifyPrepared(
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
async function locked<T>(
  db: PostgresJsDatabase,
  m: CalculatorHomologationManifest,
  fn: (tx: Tx, actor: Row) => Promise<T>
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(
        async tx => {
          await tx.execute(
            sql.raw(
              "SET LOCAL TimeZone='UTC'; SET LOCAL search_path=pg_catalog,public,pg_temp; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s'"
            )
          );
          await tx.execute(sql`SELECT pg_advisory_xact_lock(830003,1)`);
          const actor = await principal(tx, m);
          return fn(tx, actor);
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
export async function preflightCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorHomologationManifest(value);
  return locked(db, m, async tx => {
    await boundary(tx);
    await operator(tx, m);
    return {
      ...planCalculatorHomologation(m),
      status: "preflight_passed" as const,
    };
  });
}
export async function prepareCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorHomologationManifest(value);
  return locked(db, m, async (tx, actor) => {
    await boundary(tx);
    const b = await binding(tx);
    if (b && !b.is_active) fail("TERMINAL");
    const existing = await receipt(tx, m, "prepare");
    if (existing) {
      await verifyPrepared(tx, m);
      return {
        ...planCalculatorHomologation(m),
        status: "replayed" as const,
        receiptId: existing.id,
      };
    }
    if (b) fail("COLLISION");
    const login = await role(tx);
    if (login.rolcanlogin) fail("LOGIN_ALREADY_OPEN");
    if (
      (
        await query(
          tx,
          sql`SELECT pid FROM pg_stat_activity WHERE usename=${LOGIN_ROLE}`
        )
      ).length
    )
      fail("EXISTING_SESSIONS");
    const prerequisites = await operator(tx, m);
    const [clock] = await query(tx, sql`SELECT transaction_timestamp() AS at`);
    const at = new Date(clock.at).toISOString(),
      plan = fixturePlan(m, at, prerequisites.settings),
      rows: Snapshot[] = [];
    for (const e of plan.rows) rows.push(await auditedInsert(tx, m, actor, e));
    rows.push(
      await auditedInsert(tx, m, actor, {
        table: "structr_financial.principal_bindings",
        row: {
          id: I.binding,
          session_role: LOGIN_ROLE,
          subject: m.operator.subject,
          actor_id: m.operator.actorId,
          tenant_id: m.operator.tenantId,
          operations: OPERATIONS,
        },
      })
    );
    const [digest] = await query(
      tx,
      sql`SELECT encode(sha256(convert_to(${JSON.stringify(plan.manifest)}::jsonb::text,'UTF8')),'hex') AS hash`
    );
    const event = {
      contractVersion: "calculator-fixture-v1",
      bindingId: I.binding,
      tenantId: m.operator.tenantId,
      actorId: m.operator.actorId,
      fixtureId: I.fixture,
      projectId: I.project,
      intakeFormId: I.intake,
      clientId: I.client,
      manifestHash: digest.hash,
      manifest: plan.manifest,
    };
    // The frozen SQL contract requires this provenance projection attributed to O.
    // The separate row/operation audits record the true administrative session.
    const provenance = await checkedAudit(tx, {
      userId: m.operator.actorId,
      action: "financial.calculator.fixture.create",
      tableName: "calculator_fixtures",
      recordId: I.fixture,
      before: null,
      after: event,
    });
    rows.push(
      await auditedInsert(tx, m, actor, {
        table: "structr_financial.calculator_fixtures",
        row: {
          id: I.fixture,
          binding_id: I.binding,
          tenant_id: m.operator.tenantId,
          actor_id: m.operator.actorId,
          project_id: I.project,
          intake_form_id: I.intake,
          client_id: I.client,
          manifest: plan.manifest,
          manifest_hash: digest.hash,
          provenance_audit_id: provenance,
        },
      })
    );
    const id = await completed(tx, m, actor, "prepare", null, {
      at,
      rows,
      prerequisites,
      role: login,
    });
    await verifyPrepared(tx, m);
    return {
      ...planCalculatorHomologation(m),
      status: "prepared" as const,
      receiptId: id,
    };
  });
}
async function requireOpenWindow(tx: Tx, m: CalculatorHomologationManifest) {
  const [clock] = await query(tx, sql`SELECT clock_timestamp() AS now`);
  const observed = new Date(clock.now).getTime();
  if (
    !Number.isFinite(observed) ||
    observed < Date.parse(m.window.opensAt) ||
    observed >= Date.parse(m.window.closesAt)
  )
    fail("WINDOW");
}
export async function openCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorHomologationManifest(value);
  return locked(db, m, async (tx, actor) => {
    await boundary(tx);
    await verifyPrepared(tx, m);
    await requireOpenWindow(tx, m);
    const before = await role(tx),
      previous = await receipt(tx, m, "open");
    if (previous) {
      if (canonical(previous.new_values.state.role) !== canonical(before))
        fail("STATE_DRIFT");
      await requireOpenWindow(tx, m);
      return {
        ...planCalculatorHomologation(m),
        status: "replayed" as const,
        receiptId: previous.id,
      };
    }
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
    // A strict ISO date is the sole interpolated DDL literal. The role is fixed.
    await tx.execute(
      sql.raw(
        `ALTER ROLE structr_calculator_login_v1 LOGIN VALID UNTIL '${new Date(m.window.closesAt).toISOString()}'`
      )
    );
    const after = await role(tx);
    if (
      !after.rolcanlogin ||
      Date.parse(after.rolvaliduntil) !== Date.parse(m.window.closesAt)
    )
      fail("ROLE_TRANSITION");
    const receiptId = await completed(
      tx,
      m,
      actor,
      "open",
      { role: before },
      { role: after }
    );
    // Include time spent waiting on DDL/audit locks in the activation decision.
    // This is the final database read before the transaction can commit.
    await requireOpenWindow(tx, m);
    return {
      ...planCalculatorHomologation(m),
      status: "opened" as const,
      receiptId,
    };
  });
}
/** Close durably first. Session cleanup can be retried after a lost reply/failure.
 * VALID UNTIL limits password authentication only; it does not terminate sessions.
 * Withdrawal deliberately remains available after O/RBAC/catalog drift.
 */
export async function withdrawCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorHomologationManifest(value);
  const closure = await locked(db, m, async (tx, actor) => {
    await verifyPrepared(tx, m, { allowTerminal: true, checkSources: false });
    const b = await binding(tx),
      before = await role(tx),
      previous = await receipt(tx, m, "withdraw");
    if (previous) {
      if (before.rolcanlogin || b?.is_active) fail("CLOSURE_DRIFT");
      return { receiptId: previous.id };
    }
    await tx.execute(sql.raw("ALTER ROLE structr_calculator_login_v1 NOLOGIN"));
    if (b?.is_active)
      await tx.execute(
        sql`UPDATE structr_financial.principal_bindings SET is_active=false,updated_at=clock_timestamp() WHERE id=${I.binding}::uuid`
      );
    const after = { binding: await binding(tx), role: await role(tx) };
    if (after.binding?.is_active || after.role.rolcanlogin)
      fail("CLOSURE_DRIFT");
    return {
      receiptId: await completed(
        tx,
        m,
        actor,
        "withdraw",
        { binding: b, role: before },
        after
      ),
    };
  });
  try {
    const attempt = await locked(db, m, async (tx, actor) => {
      // Re-read after obtaining the lock: a prior withdrawal may have completed
      // between this call's durable closure and session-cleanup phase.
      const sessions = await query(
        tx,
        sql`SELECT pid,backend_start::text AS "backendStart" FROM pg_stat_activity WHERE usename=${LOGIN_ROLE} AND pid<>pg_backend_pid() ORDER BY pid`
      );
      const pending = await query(
        tx,
        sql`SELECT a.id,a.user_id,a.table_name,a.old_values,a.new_values FROM public.audit_logs a WHERE a.action=${prefix + "withdraw.sessions.requested"} AND a.record_id=${m.operationId} AND NOT EXISTS(SELECT 1 FROM public.audit_logs done WHERE done.action=${prefix + "withdraw.sessions.completed"} AND done.record_id=${m.operationId} AND done.new_values->>'requestAuditId'=a.id::text) ORDER BY a.created_at FOR SHARE`
      );
      if (pending.length) {
        const p = pending[0];
        if (
          p.user_id !== null ||
          p.table_name !== receiptTable ||
          p.old_values !== null ||
          p.new_values.operationId !== m.operationId ||
          p.new_values.manifestHash !== hash(m) ||
          p.new_values.closureReceiptId !== closure.receiptId ||
          canonical(p.new_values.administrativeActor) !== canonical(actor) ||
          !Array.isArray(p.new_values.sessions) ||
          p.new_values.afterHash !== hash(p.new_values.sessions) ||
          p.new_values.sessions.some(
            (s: Row) =>
              !Number.isSafeInteger(s.pid) ||
              s.pid <= 0 ||
              typeof s.backendStart !== "string" ||
              !Number.isFinite(Date.parse(s.backendStart))
          )
        )
          fail("EVIDENCE");
        return { id: p.id, sessions: p.new_values.sessions as Row[] };
      }
      if (!sessions.length) return null;
      const id = await checkedAudit(tx, {
        userId: null,
        action: prefix + "withdraw.sessions.requested",
        tableName: receiptTable,
        recordId: m.operationId,
        before: null,
        after: {
          operationId: m.operationId,
          manifestHash: hash(m),
          administrativeActor: actor,
          sessions,
          closureReceiptId: closure.receiptId,
          afterHash: hash(sessions),
        },
      });
      return { id, sessions };
    });
    if (attempt) {
      for (const session of attempt.sessions)
        await query(
          db,
          sql`SELECT pg_terminate_backend(pid,1000) AS terminated FROM pg_stat_activity WHERE usename=${LOGIN_ROLE} AND pid=${session.pid} AND backend_start=${session.backendStart}::timestamptz AND pid<>pg_backend_pid()`
        );
    }
    const remaining = await query(
      db,
      sql`SELECT pid,backend_start::text AS "backendStart" FROM pg_stat_activity WHERE usename=${LOGIN_ROLE} ORDER BY pid`
    );
    if (attempt)
      await locked(db, m, async (tx, actor) => {
        const done = await query(
          tx,
          sql`SELECT to_jsonb(a.*) AS row FROM public.audit_logs a WHERE action=${prefix + "withdraw.sessions.completed"} AND record_id=${m.operationId} AND new_values->>'requestAuditId'=${attempt.id} FOR SHARE`
        );
        if (done.length > 1) fail("EVIDENCE");
        if (done.length) {
          const a = done[0].row,
            v = a.new_values;
          if (
            a.user_id !== null ||
            a.table_name !== receiptTable ||
            v.manifestHash !== hash(m) ||
            canonical(v.administrativeActor) !== canonical(actor) ||
            v.beforeHash !== hash(attempt.sessions) ||
            v.afterHash !== hash(v.remainingSessions) ||
            canonical(a.old_values) !==
              canonical({ sessions: attempt.sessions })
          )
            fail("EVIDENCE");
          return;
        }
        await checkedAudit(tx, {
          userId: null,
          action: prefix + "withdraw.sessions.completed",
          tableName: receiptTable,
          recordId: m.operationId,
          before: { sessions: attempt.sessions },
          after: {
            operationId: m.operationId,
            manifestHash: hash(m),
            administrativeActor: actor,
            requestAuditId: attempt.id,
            remainingSessions: remaining,
            beforeHash: hash(attempt.sessions),
            afterHash: hash(remaining),
          },
        });
      });
    return {
      ...planCalculatorHomologation(m),
      ...closure,
      status:
        remaining.length === 0
          ? ("withdrawn" as const)
          : ("cleanup_pending" as const),
      bindingTerminal: true,
      loginClosed: true,
      remainingSessions: remaining.length,
    };
  } catch {
    return {
      ...planCalculatorHomologation(m),
      ...closure,
      status: "cleanup_pending" as const,
      bindingTerminal: true,
      loginClosed: true,
      remainingSessions: null,
    };
  }
}
