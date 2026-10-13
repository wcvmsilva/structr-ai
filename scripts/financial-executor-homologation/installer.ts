/** Audited closed installation only. No connection, credentials, deployment or retry.
 * The caller independently verifies the executable source commit and reviewed pins.
 * SQL artifacts are fixed and byte-verified here; a missing receipt never proves rollback.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { logAudit } from "../../server/audit";
import approvedTemp from "../../docs/security/financial-executor/database-temp-containment-plan.json";
import { canonical } from "./contract";
import { assertCalculatorBoundary } from "./boundary";

const foundationSha256 =
  "a74b4d933bafe92c23ddaf3d5aee3487ce0e2197b03d10ae434280a268294d54";
const lifecycleSha256 =
  "87a09f22a4e433a75f2f01973b3ee903a0a1f9dd7ef0f0706860c5b8fe988c61";
const baselineHash =
  "45bf03ac2fac16724469de89f6a6d26effcf8919972406f99f6196fb2f2a9774";
const installedHash =
  "75332da1e1b8d1492d1a99c702de39ddc8950c57f0c85c5726d11bed7d5acb2c";
const uuid = z.uuid().refine(v => v === v.toLowerCase());
const schema = z
  .object({
    version: z.literal("calculator-install-v1"),
    operationId: uuid.refine(v => v[14] === "4"),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    sourcePinsSha256: z.literal(
      "8eb116952a6ffe5d8e08df6c790ec89bd23f30d6c7be307e31c2f40d8d3d5669"
    ),
    expectedDatabase: z.literal("postgres"),
    expectedPrincipal: z.literal("postgres"),
    tempContainmentAuditId: uuid,
    artifacts: z
      .object({
        foundationSha256: z.literal(foundationSha256),
        lifecycleSha256: z.literal(lifecycleSha256),
      })
      .strict(),
  })
  .strict()
  .refine(m => m.operationId !== m.tempContainmentAuditId);
export type CalculatorInstallManifest = z.infer<typeof schema>;
function fail(code: string): never {
  throw new Error(`CALCULATOR_INSTALL_${code}`);
}
export function parseCalculatorInstallManifest(
  value: unknown
): CalculatorInstallManifest {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail("MANIFEST_INVALID");
  return parsed.data;
}
type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
type Row = Record<string, any>;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const action = "financial.homologation.install.completed";
const table = "calculator_installation";
async function query(tx: Tx, statement: SQL): Promise<Row[]> {
  return (await tx.execute(statement)) as unknown as Row[];
}
async function identity(tx: Tx) {
  const [r] = await query(
    tx,
    sql`SELECT current_user AS "currentUser",session_user AS "sessionUser",current_database() AS database,current_setting('server_version_num') AS version,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser`
  );
  if (
    !r ||
    r.currentUser !== "postgres" ||
    r.sessionUser !== "postgres" ||
    r.database !== "postgres" ||
    r.version !== "170011" ||
    r.superuser !== false
  )
    fail("PRINCIPAL");
  return {
    currentUser: r.currentUser,
    sessionUser: r.sessionUser,
    database: r.database,
    version: r.version,
  };
}
async function sources(includeMigrations: boolean) {
  const catalog = await readFile(
    new URL("./catalog.sql", import.meta.url),
    "utf8"
  );
  const managed = await readFile(
    new URL("./managed-catalog.sql", import.meta.url),
    "utf8"
  );
  const collector = await readFile(
    new URL("./compatibility-inspect.sql", import.meta.url),
    "utf8"
  );
  const foundation = includeMigrations
    ? await readFile(
        new URL(
          "../../drizzle/0020_closed_financial_calculator_boundary.sql",
          import.meta.url
        ),
        "utf8"
      )
    : "";
  const lifecycle = includeMigrations
    ? await readFile(
        new URL(
          "../../drizzle/0021_financial_calculator_lifecycle.sql",
          import.meta.url
        ),
        "utf8"
      )
    : "";
  if (
    includeMigrations &&
    (digest(foundation) !== foundationSha256 ||
      digest(lifecycle) !== lifecycleSha256)
  )
    fail("SOURCE_DRIFT");
  return { catalog, managed, collector, foundation, lifecycle };
}
type Sources = Awaited<ReturnType<typeof sources>>;
function tempProjection(surface: Row[]) {
  return surface
    .filter(
      r =>
        r.identity === "database:postgres" ||
        /^(role|membership|effective-database):/.test(r.identity)
    )
    .map(r => {
      const definition = structuredClone(r.definition);
      if (r.identity === "database:postgres") {
        definition.acl?.sort();
        definition.effectiveAcl?.sort();
      }
      return { identity: r.identity, definition };
    })
    .sort((a, b) =>
      Buffer.compare(Buffer.from(a.identity), Buffer.from(b.identity))
    );
}
async function validateTempReceipt(tx: Tx, m: CalculatorInstallManifest) {
  const [r] = await query(
    tx,
    sql`SELECT to_jsonb(a.*) AS row FROM public.audit_logs a WHERE id=${m.tempContainmentAuditId}::uuid`
  );
  const a = r?.row;
  const expectedBefore = {
    snapshot: approvedTemp.before,
    sha256: digest(canonical(approvedTemp.before)),
  };
  const expectedAfter = {
    snapshot: approvedTemp.after,
    sha256: digest(canonical(approvedTemp.after)),
    sourceSha256: approvedTemp.sourceSha256,
    administrativeActor: {
      current_user: "postgres",
      session_user: "postgres",
      database: "postgres",
      version: "170011",
    },
  };
  if (
    !a ||
    a.user_id !== null ||
    a.action !== "financial.homologation.database-temp-contained" ||
    a.table_name !== "pg_database" ||
    !uuid.safeParse(a.record_id).success ||
    a.record_id === m.operationId ||
    !same(a.old_values, expectedBefore) ||
    !same(a.new_values, expectedAfter) ||
    a.ip_address !== null ||
    a.user_agent !== null
  )
    fail("TEMP_RECEIPT");
}
async function snapshot(tx: Tx, source: Sources) {
  const catalog = await query(tx, sql.raw(source.catalog));
  catalog.sort((a, b) =>
    Buffer.compare(Buffer.from(a.identity), Buffer.from(b.identity))
  );
  const [managed] = await query(tx, sql.raw(source.managed));
  const [state] = await query(
    tx,
    sql`SELECT to_regnamespace('structr_financial') IS NOT NULL AS "schemaExists",(SELECT datacl::text[] FROM pg_database WHERE datname=current_database()) AS "databaseAcl",EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type='TEMPORARY') AS "publicTemp"`
  );
  const roles = await query(
    tx,
    sql`SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil::text,rolconfig FROM pg_roles WHERE rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') ORDER BY rolname`
  );
  const memberships = await query(
    tx,
    sql`SELECT r.rolname,m.member::regrole::text AS member,m.grantor::regrole::text AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') ORDER BY r.rolname,m.member::regrole::text,m.grantor::regrole::text`
  );
  return {
    applicationCount: catalog.length,
    applicationHash: digest(
      catalog.map(r => `${r.identity}:${r.sha256}`).join("\n")
    ),
    managedHash: managed?.encode as string,
    schemaExists: state.schemaExists as boolean,
    databaseAcl: (state.databaseAcl as string[]).sort(),
    publicTemp: state.publicTemp as boolean,
    roles,
    memberships,
  };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
const roleNames = [
  "structr_calculator_login_v1",
  "structr_calculator_read_owner_v1",
  "structr_calculator_write_owner_v1",
] as const;
const managedProfiles = [
  "8622932ca244518fc2d29f50c952e7856d49ba9f556fda12a1b5e5813aad8b46",
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "bebf2a74fa50d8f3faa54cb45175f167c39f2c8e06a16c233fab1cd8d177f704",
] as const;
const snapshotSchema = z
  .object({
    applicationCount: z.number().int().nonnegative(),
    applicationHash: z.string().regex(/^[0-9a-f]{64}$/),
    managedHash: z.enum(managedProfiles),
    schemaExists: z.boolean(),
    databaseAcl: z.array(z.string()),
    publicTemp: z.boolean(),
    roles: z.array(
      z
        .object({
          rolname: z.enum(roleNames),
          rolcanlogin: z.boolean(),
          rolsuper: z.boolean(),
          rolinherit: z.boolean(),
          rolcreaterole: z.boolean(),
          rolcreatedb: z.boolean(),
          rolreplication: z.boolean(),
          rolbypassrls: z.boolean(),
          rolconnlimit: z.number().int(),
          rolvaliduntil: z.string().nullable(),
          rolconfig: z.array(z.string()).nullable(),
        })
        .strict()
    ),
    memberships: z.array(
      z
        .object({
          rolname: z.enum(roleNames),
          member: z.string(),
          grantor: z.string(),
          admin_option: z.boolean(),
          inherit_option: z.boolean(),
          set_option: z.boolean(),
        })
        .strict()
    ),
  })
  .strict();
async function requireManagedProfile(tx: Tx, hash: string) {
  if (hash === managedProfiles[0]) return;
  if (!managedProfiles.slice(1).includes(hash as (typeof managedProfiles)[1]))
    fail("RECEIPT_INVALID");
  // Exact owned-laboratory condition already imposed by frozen 0020/0021; no flag/GUC bypass.
  const [r] = await query(
    tx,
    sql`SELECT inet_server_addr() IS NULL AND current_setting('listen_addresses')='' AND current_setting('unix_socket_directories') ~ '^/(private/)?tmp/structr-app-principal-pg-[A-Za-z0-9]+/socket$' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_principal_runner' AND rolsuper) AS owned`
  );
  if (r?.owned !== true) fail("RECEIPT_INVALID");
}
function requireBefore(before: Snapshot) {
  if (
    !snapshotSchema.safeParse(before).success ||
    before.applicationCount !== 1011 ||
    before.applicationHash !== baselineHash ||
    before.schemaExists ||
    before.roles.length ||
    before.memberships.length ||
    before.publicTemp
  )
    fail("BASELINE");
}
function requireAfter(after: Snapshot, before: Snapshot) {
  if (
    !snapshotSchema.safeParse(after).success ||
    !same(
      after.roles.map(r => r.rolname),
      roleNames
    ) ||
    !same(
      after.memberships.map(r => r.rolname),
      roleNames
    ) ||
    after.applicationCount !== 1108 ||
    after.applicationHash !== installedHash ||
    !after.schemaExists ||
    after.publicTemp ||
    after.managedHash !== before.managedHash ||
    !same(
      after.databaseAcl,
      [...before.databaseAcl, "structr_calculator_login_v1=c/postgres"].sort()
    ) ||
    after.roles.length !== 3 ||
    after.memberships.length !== 3
  )
    fail("CLOSED_STATE");
  for (const r of after.roles)
    if (
      r.rolcanlogin ||
      r.rolsuper ||
      r.rolinherit ||
      r.rolcreaterole ||
      r.rolcreatedb ||
      r.rolreplication ||
      r.rolbypassrls ||
      r.rolconfig !== null ||
      r.rolvaliduntil !== null ||
      r.rolconnlimit !== -1
    )
      fail("CLOSED_STATE");
  for (const e of after.memberships)
    if (
      e.member !== "postgres" ||
      !e.admin_option ||
      e.inherit_option ||
      e.set_option ||
      e.grantor === "postgres"
    )
      fail("CLOSED_STATE");
}
async function operationRows(tx: Tx, m: CalculatorInstallManifest) {
  return query(
    tx,
    sql`SELECT to_jsonb(a.*) AS row FROM public.audit_logs a WHERE a.record_id=${m.operationId}::uuid OR a.new_values->'manifest'->>'operationId'=${m.operationId} ORDER BY a.id`
  );
}
function validateReceipt(row: Row, m: CalculatorInstallManifest) {
  const a = row?.row;
  try {
    const v = a.new_values;
    if (
      a.action !== action ||
      a.table_name !== table ||
      a.record_id !== m.operationId ||
      a.user_id !== null ||
      a.ip_address !== null ||
      a.user_agent !== null ||
      !uuid.safeParse(a.id).success ||
      !same(v.manifest, m) ||
      v.version !== "calculator-install-receipt-v1" ||
      v.manifestHash !== digest(canonical(m)) ||
      !same(v.administrativeActor, {
        currentUser: "postgres",
        sessionUser: "postgres",
        database: "postgres",
        version: "170011",
      }) ||
      !same(
        Object.keys(v).sort(),
        [
          "version",
          "manifest",
          "manifestHash",
          "administrativeActor",
          "snapshot",
        ].sort()
      )
    )
      fail("RECEIPT_INVALID");
    requireBefore(a.old_values);
    requireAfter(v.snapshot, a.old_values);
    return {
      status: "committed" as const,
      receiptId: a.id as string,
      operationId: m.operationId,
    };
  } catch {
    fail("RECEIPT_INVALID");
  }
}
export async function installCalculatorBoundary(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorInstallManifest(value),
    source = await sources(true);
  return db.transaction(
    async tx => {
      await tx.execute(
        sql.raw(
          "SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'; SET LOCAL search_path=pg_catalog"
        )
      );
      await tx.execute(sql`SELECT pg_advisory_xact_lock(173721,20261011)`);
      const actor = await identity(tx);
      if ((await operationRows(tx, m)).length) fail("ALREADY_OBSERVED");
      await validateTempReceipt(tx, m);
      const [observed] = await query(
        tx,
        sql.raw(source.collector.slice(source.collector.indexOf(";") + 1))
      );
      if (
        !same(tempProjection(observed.observation.surface), approvedTemp.after)
      )
        fail("TEMP_STATE_DRIFT");
      const before = await snapshot(tx, source);
      requireBefore(before);
      await requireManagedProfile(tx, before.managedHash);
      // Both fixed SQLs perform their exact catalog/privilege preflight and postflight.
      // No catch-and-retry: an uncertain COMMIT requires a new read-only recovery call.
      await tx.execute(sql.raw(source.foundation));
      await tx.execute(sql.raw(source.lifecycle));
      await assertCalculatorBoundary(tx);
      await tx.execute(sql.raw("SET LOCAL search_path=pg_catalog"));
      const after = await snapshot(tx, source);
      requireAfter(after, before);
      const event = {
        version: "calculator-install-receipt-v1",
        manifest: m,
        manifestHash: digest(canonical(m)),
        administrativeActor: actor,
        snapshot: after,
      };
      await tx.execute(
        sql.raw("SET LOCAL search_path=pg_catalog,public,pg_temp")
      );
      const audit = await logAudit(
        {
          userId: null,
          action,
          tableName: table,
          recordId: m.operationId,
          before,
          after: event,
        },
        tx
      );
      if (!audit) fail("AUDIT_MISSING");
      const rows = await operationRows(tx, m);
      if (
        rows.length !== 1 ||
        rows[0].row.id !== audit.id ||
        !same(rows[0].row.old_values, before) ||
        !same(rows[0].row.new_values, event)
      )
        fail("AUDIT_INVALID");
      const receipt = validateReceipt(rows[0], m);
      // Catch side effects of audit triggers, including role/ACL/catalog changes.
      await assertCalculatorBoundary(tx);
      await tx.execute(sql.raw("SET LOCAL search_path=pg_catalog"));
      if (!same(await snapshot(tx, source), after)) fail("AUDIT_INVALID");
      return receipt;
    },
    { isolationLevel: "serializable", accessMode: "read write" }
  );
}
export async function recoverCalculatorBoundaryInstall(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorInstallManifest(value),
    source = await sources(false);
  return db.transaction(
    async tx => {
      await tx.execute(
        sql.raw(
          "SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'; SET LOCAL search_path=pg_catalog"
        )
      );
      await identity(tx);
      const rows = await operationRows(tx, m);
      if (!rows.length)
        return { status: "not_observed" as const, operationId: m.operationId };
      if (rows.length !== 1) fail("RECEIPT_INVALID");
      await validateTempReceipt(tx, m);
      const receipt = validateReceipt(rows[0], m);
      await requireManagedProfile(tx, rows[0].row.old_values.managedHash);
      const current = await snapshot(tx, source);
      return {
        ...receipt,
        currentMatchesInstalledSnapshot: same(
          current,
          rows[0].row.new_values.snapshot
        ),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" }
  );
}
