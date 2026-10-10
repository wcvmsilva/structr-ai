/** Bounded administrative fixture. No connection factory, Auth client, web route or apply CLI. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import {
  auditLogs,
  clients,
  estimateDrafts,
  intakeForms,
  profiles,
  projectMembers,
  projects,
  tenants,
} from "../drizzle/schema";
import { logAudit } from "../server/audit";
import {
  buildHomologIdentityState,
  parseHomologAccessManifest,
  planHomologAccess,
  type HomologAccessManifest,
} from "./homolog-access-bootstrap";
import { renderHomologAccessSql } from "./homolog-access-bootstrap-sql";

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== "00000000-0000-0000-0000-000000000000");
const manifestSchema = z
  .object({
    version: z.literal("structr-homolog-read-proof-v1"),
    projectRef: z.literal("wmspwegbqtzamkhxhusg"),
    operationId: uuid,
    withdrawalOperationId: uuid,
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    identity: z.unknown(),
    fixture: z
      .object({
        clientId: uuid,
        projectId: uuid,
        draftId: uuid,
        membershipId: uuid,
      })
      .strict(),
  })
  .strict();
export type HomologReadProofManifest = Omit<
  z.infer<typeof manifestSchema>,
  "identity"
> & { identity: HomologAccessManifest };
type Transaction = Parameters<
  Parameters<PostgresJsDatabase["transaction"]>[0]
>[0];
type Row = { id: string; [key: string]: unknown };
type State = Record<string, Row[]>;
type Operation = "create" | "withdraw";
const tables = {
  tenants,
  profiles,
  clients,
  projects,
  estimate_drafts: estimateDrafts,
  project_members: projectMembers,
};
type TableName = keyof typeof tables;
const identityNames: TableName[] = ["tenants", "profiles"];
const fixtureNames: TableName[] = [
  "clients",
  "projects",
  "estimate_drafts",
  "project_members",
];
const executorId = "structr-homolog-read-proof-drizzle-v1";
const actorSchema = z
  .object({
    kind: z.literal("database-principal"),
    currentUser: z.string().min(1),
    sessionUser: z.string().min(1),
  })
  .strict();
class ReadProofError extends Error {}
function fail(code: string): never {
  throw new ReadProofError(code);
}
function canonical(value: unknown): string {
  const order = (item: any): any =>
    Array.isArray(item)
      ? item.map(order)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map(key => [key, order(item[key])])
          )
        : item;
  return JSON.stringify(order(JSON.parse(JSON.stringify(value))));
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const ordered = (rows: Row[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id));
const microsecond = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value.replace(/(\.\d{3})\d{3}Z$/, "$1Z");

/** Subjects and source commits remain supplied references, never provider/deployment attestations. */
export function parseHomologReadProofManifest(
  value: unknown
): HomologReadProofManifest {
  try {
    const parsed = manifestSchema.parse(value),
      identity = parseHomologAccessManifest(parsed.identity);
    const ids = [
      parsed.operationId,
      parsed.withdrawalOperationId,
      identity.operationId,
      ...Object.values(parsed.fixture),
      ...Object.values(identity.tenants).map(t => t.id),
      ...Object.values(identity.profiles).flatMap(p => [
        p.id,
        p.providerSubject,
      ]),
    ];
    if (new Set(ids).size !== ids.length) fail("HOMOLOG_READ_MANIFEST_INVALID");
    return { ...parsed, identity };
  } catch {
    fail("HOMOLOG_READ_MANIFEST_INVALID");
  }
}
export function planHomologReadProof(value: unknown) {
  const m = parseHomologReadProofManifest(value);
  return {
    status: "planned" as string,
    operationId: m.operationId,
    withdrawalOperationId: m.withdrawalOperationId,
    manifestHash: digest(m),
    createRows: 4,
    createAudits: 5,
    withdrawRows: 5,
    withdrawAudits: 6,
    authVerified: false,
    databaseTargetVerified: false,
  };
}
const cycleSchema = z
  .object({
    version: z.literal("structr-homolog-identity-cycle-v1"),
    projectRef: z.literal("wmspwegbqtzamkhxhusg"),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    reactivationOperationId: uuid,
    withdrawalOperationId: uuid,
    priorReadProof: z.unknown(),
  })
  .strict();
export type HomologIdentityCycleManifest = Omit<
  z.infer<typeof cycleSchema>,
  "priorReadProof"
> & { priorReadProof: HomologReadProofManifest };
export function parseHomologIdentityCycleManifest(
  value: unknown
): HomologIdentityCycleManifest {
  try {
    const parsed = cycleSchema.parse(value),
      prior = parseHomologReadProofManifest(parsed.priorReadProof);
    const ids = [
      parsed.reactivationOperationId,
      parsed.withdrawalOperationId,
      prior.operationId,
      prior.withdrawalOperationId,
      prior.identity.operationId,
      ...Object.values(prior.fixture),
      ...Object.values(prior.identity.tenants).map(t => t.id),
      ...Object.values(prior.identity.profiles).flatMap(p => [
        p.id,
        p.providerSubject,
      ]),
    ];
    if (new Set(ids).size !== ids.length)
      fail("HOMOLOG_CYCLE_MANIFEST_INVALID");
    return { ...parsed, priorReadProof: prior };
  } catch {
    fail("HOMOLOG_CYCLE_MANIFEST_INVALID");
  }
}
export function planHomologIdentityCycle(value: unknown) {
  const m = parseHomologIdentityCycleManifest(value);
  return {
    status: "planned" as string,
    reactivationOperationId: m.reactivationOperationId,
    withdrawalOperationId: m.withdrawalOperationId,
    manifestHash: digest(m),
    reactivateRows: 5,
    reactivateAudits: 6,
    withdrawRows: 5,
    withdrawAudits: 6,
    authVerified: false,
    databaseTargetVerified: false,
  };
}
function identityIds(m: HomologReadProofManifest): Record<string, string[]> {
  return {
    tenants: Object.values(m.identity.tenants).map(t => t.id),
    profiles: Object.values(m.identity.profiles).map(p => p.id),
  };
}
function fixtureIds(m: HomologReadProofManifest): Record<string, string[]> {
  return {
    clients: [m.fixture.clientId],
    projects: [m.fixture.projectId],
    estimate_drafts: [m.fixture.draftId],
    project_members: [m.fixture.membershipId],
  };
}
function projection(
  table: (typeof tables)[TableName] | typeof auditLogs | typeof intakeForms
): SQL {
  const pieces = Object.entries(getTableColumns(table)).flatMap(
    ([key, column]) => [
      sql`${key}::text`,
      column.columnType === "PgTimestamp"
        ? sql`to_char(${sql.identifier(column.name)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
        : sql`${sql.identifier(column.name)}`,
    ]
  );
  // PostgreSQL limits a function call to 100 arguments; projects and drafts have
  // more than 50 columns. Concatenate bounded objects without dropping columns.
  const chunks: SQL[] = [];
  for (let start = 0; start < pieces.length; start += 80)
    chunks.push(
      sql`jsonb_build_object(${sql.join(pieces.slice(start, start + 80), sql`,`)})`
    );
  return sql`(${sql.join(chunks, sql` || `)})`;
}
async function readState(
  tx: Transaction,
  ids: Record<string, string[]>
): Promise<State> {
  const result: State = {};
  for (const [name, values] of Object.entries(ids)) {
    const table = tables[name as TableName];
    const rows =
      await tx.execute(sql`SELECT ${projection(table)} AS row FROM ${table}
      WHERE id IN (${sql.join(
        values.map(v => sql`${v}::uuid`),
        sql`,`
      )}) ORDER BY id FOR SHARE`);
    result[name] = rows.map(row => row.row as Row);
  }
  return result;
}
async function evidence(tx: Transaction, operationId: string): Promise<Row[]> {
  const rows =
    await tx.execute(sql`SELECT ${projection(auditLogs)} AS row FROM ${auditLogs}
    WHERE record_id=${operationId}::uuid OR new_values->>'operationId'=${operationId} ORDER BY id FOR SHARE`);
  return rows.map(row => row.row as Row);
}
function auditShape(row: Row) {
  return {
    userId: row.userId,
    action: row.action,
    tableName: row.tableName,
    recordId: row.recordId,
    oldValues: row.oldValues,
    newValues: row.newValues,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}
function expectedAudit(
  action: string,
  tableName: string,
  recordId: string,
  before: unknown,
  after: unknown
) {
  return {
    userId: null,
    action,
    tableName,
    recordId,
    oldValues: before,
    newValues: after,
    ipAddress: null,
    userAgent: null,
  };
}
function verifyAudits(
  actual: Row[],
  expected: ReturnType<typeof expectedAudit>[],
  code: string,
  metadata?: { at: string; ids: Record<string, string> }
) {
  const order = (rows: ReturnType<typeof expectedAudit>[]) =>
    rows.sort((a, b) =>
      `${a.action}/${a.recordId}`.localeCompare(`${b.action}/${b.recordId}`)
    );
  if (
    actual.length !== expected.length ||
    !same(
      order(actual.map(auditShape) as ReturnType<typeof expectedAudit>[]),
      order([...expected])
    )
  )
    fail(code);
  auditMetadata(actual, code);
  if (
    metadata &&
    actual.some(
      row =>
        row.createdAt !== metadata.at ||
        (Object.hasOwn(metadata.ids, String(row.recordId)) &&
          row.id !== metadata.ids[String(row.recordId)])
    )
  )
    fail(code);
}
function auditMetadata(rows: Row[], code: string) {
  if (
    rows.some(
      row => !uuid.safeParse(row.id).success || !microsecond(row.createdAt)
    )
  )
    fail(code);
  return rows
    .map(row => ({
      id: row.id,
      createdAt: row.createdAt as string,
      action: row.action,
      recordId: row.recordId,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
type AuditMetadata = ReturnType<typeof auditMetadata>;
function rowAfter(operationId: string, manifestHash: string, row: Row) {
  return { operationId, manifestHash, row };
}
function singleReceipt(
  logs: Row[],
  operationId: string,
  action: string,
  tableName: string,
  code: string
): Record<string, any> {
  const receipts = logs.filter(
    r =>
      r.recordId === operationId &&
      r.action === action &&
      r.tableName === tableName
  );
  const value = receipts[0]?.newValues;
  if (
    receipts.length !== 1 ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    fail(code);
  return value as Record<string, any>;
}
function historicalIdentityState(
  m: HomologReadProofManifest,
  value: unknown
): State {
  const state = value as State | undefined,
    at = state?.tenants?.[0]?.createdAt;
  if (!microsecond(at)) fail("HOMOLOG_READ_IDENTITY_CONFLICT");
  const built = buildHomologIdentityState(m.identity, new Date(0));
  const expected: State = Object.fromEntries(
    Object.entries(built).map(([name, rows]) => [
      name,
      ordered(
        rows.map(row => ({ ...row, createdAt: at, updatedAt: at }) as Row)
      ),
    ])
  );
  if (!same(state, expected)) fail("HOMOLOG_READ_IDENTITY_CONFLICT");
  return expected;
}
/** Reuses the bootstrap's exact row plan and SQL metadata verifier without ever invoking its writer. */
async function verifyIdentity(
  tx: Transaction,
  m: HomologReadProofManifest
): Promise<State> {
  const logs = await evidence(tx, m.identity.operationId),
    code = "HOMOLOG_READ_IDENTITY_CONFLICT";
  const metadata = auditMetadata(logs, code);
  // The old bootstrap did not persist an independently signed audit clock. Its
  // six DEFAULT now() audits must nevertheless share one exact transaction time.
  // Capture this baseline in the new fixture receipt; never rewrite the bootstrap.
  if (new Set(metadata.map(row => row.createdAt)).size !== 1) fail(code);
  const r = singleReceipt(
    logs,
    m.identity.operationId,
    "homolog.identity.bootstrap.completed",
    "homolog_identity_bootstrap",
    code
  );
  const state = historicalIdentityState(m, r.state),
    manifestHash = planHomologAccess(m.identity).manifestHash;
  const actor = actorSchema.safeParse(r.administrativeActor);
  if (!actor.success) fail(code);
  const expected: Record<string, unknown> = {
    version: "structr-homolog-identity-receipt-v1",
    operationId: m.identity.operationId,
    manifestHash,
    manifest: m.identity,
    state,
    administrativeActor: actor.data,
  };
  if (Object.hasOwn(r, "executorId") || Object.hasOwn(r, "executorHash")) {
    const rendered = renderHomologAccessSql(m.identity);
    expected.executorId = rendered.executorId;
    expected.executorHash = rendered.executorHash;
  }
  if (!same(r, expected)) fail(code);
  const audits = identityNames.flatMap(name =>
    state[name].map(row =>
      expectedAudit(
        name === "tenants"
          ? "homolog.identity.tenant.create"
          : "homolog.identity.profile.create",
        name,
        row.id,
        null,
        rowAfter(m.identity.operationId, manifestHash, row)
      )
    )
  );
  audits.push(
    expectedAudit(
      "homolog.identity.bootstrap.completed",
      "homolog_identity_bootstrap",
      m.identity.operationId,
      null,
      expected
    )
  );
  verifyAudits(logs, audits, code);
  return state;
}
function businessState(m: HomologReadProofManifest, at: string): State {
  const blank = (
    name: TableName,
    id: string,
    values: Record<string, unknown>
  ): Row => ({
    ...Object.fromEntries(
      Object.keys(getTableColumns(tables[name])).map(key => [key, null])
    ),
    id,
    tenantId: m.identity.tenants.A.id,
    createdAt: at,
    updatedAt: at,
    ...values,
  });
  const marker = `SYN 0017 ${m.operationId}`;
  return {
    clients: [
      blank("clients", m.fixture.clientId, {
        name: `${marker} client`,
        isActive: true,
      }),
    ],
    projects: [
      blank("projects", m.fixture.projectId, {
        name: `${marker} project`,
        clientId: m.fixture.clientId,
        ownerUserId: m.identity.profiles.A1.id,
        projectType: "repair",
        status: "estimate",
        committedCostCents: 0,
        changeOrderBudgetCents: 0,
        provenanceState: "formation_only",
      }),
    ],
    estimate_drafts: [
      blank("estimate_drafts", m.fixture.draftId, {
        projectId: m.fixture.projectId,
        clientId: m.fixture.clientId,
        bundleName: `${marker} draft`,
        notes: "Administrative read-only access fixture",
        metadata: {
          fixture: "administrative-read-proof",
          operationId: m.operationId,
        },
        status: "draft",
        version: 1,
        discountApplied: false,
        lineItems: [],
        assemblySelections: [],
      }),
    ],
    project_members: [
      blank("project_members", m.fixture.membershipId, {
        projectId: m.fixture.projectId,
        userId: m.identity.profiles.A2.id,
        projectRole: "viewer",
        permissions: [],
        isActive: true,
      }),
    ],
  };
}
function withdrawnState(before: State, at: string): State {
  return Object.fromEntries(
    identityNames.map(name => [
      name,
      before[name].map(row => ({ ...row, isActive: false, updatedAt: at })),
    ])
  );
}
async function principal(tx: Transaction) {
  const [row] =
    await tx.execute(sql`SELECT current_user AS "currentUser",session_user AS "sessionUser",
    current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly`);
  if (row.isolation !== "serializable" || row.readonly !== "off")
    fail("HOMOLOG_READ_FAILED");
  const actor = actorSchema.safeParse({
    kind: "database-principal",
    currentUser: row.currentUser,
    sessionUser: row.sessionUser,
  });
  if (!actor.success) fail("HOMOLOG_READ_FAILED");
  // A role with table grants but filtered RLS visibility is not an administrative
  // executor. Fail closed rather than mistaking invisible rows for nonexistence.
  const [visibility] = await tx.execute(sql`SELECT bool_and(
    has_table_privilege(current_user,c.oid,'SELECT') AND
    (r.rolsuper OR r.rolbypassrls OR (pg_has_role(current_user,c.relowner,'USAGE') AND NOT c.relforcerowsecurity))) AS allowed
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
    WHERE n.nspname='public' AND c.relname IN ('tenants','profiles','clients','projects','estimate_drafts','project_members','audit_logs')
      AND r.rolname=current_user`);
  if (visibility.allowed !== true) fail("HOMOLOG_READ_FAILED");
  return actor.data;
}
async function clock(tx: Transaction): Promise<string> {
  const [row] = await tx.execute(
    sql`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`
  );
  if (!microsecond(row.at)) fail("HOMOLOG_READ_FAILED");
  return row.at;
}
async function assertPopulation(
  tx: Transaction,
  m: HomologReadProofManifest,
  hasFixture: boolean
) {
  const tenantIds = Object.values(m.identity.tenants).map(t => t.id);
  for (const name of ["profiles", ...fixtureNames] as TableName[]) {
    const [row] =
      await tx.execute(sql`SELECT count(*)::int AS count FROM ${tables[name]}
      WHERE tenant_id IN (${sql.join(
        tenantIds.map(id => sql`${id}::uuid`),
        sql`,`
      )})`);
    if (row.count !== (name === "profiles" ? 3 : hasFixture ? 1 : 0))
      fail("HOMOLOG_READ_STATE_DRIFT");
  }
}
async function assertNoCollision(tx: Transaction, m: HomologReadProofManifest) {
  const ids = [
    m.operationId,
    m.withdrawalOperationId,
    ...Object.values(m.fixture),
  ];
  const list = sql.join(
    ids.map(id => sql`${id}::uuid`),
    sql`,`
  );
  for (const table of Object.values(tables)) {
    const rows = await tx.execute(
      sql`SELECT id FROM ${table} WHERE id IN (${list}) LIMIT 1`
    );
    if (rows.length) fail("HOMOLOG_READ_COLLISION");
  }
  const rows = await tx.execute(sql`SELECT id FROM ${profiles}
    WHERE external_open_id IN (${sql.join(
      ids.map(id => sql`${id}`),
      sql`,`
    )}) LIMIT 1`);
  if (rows.length) fail("HOMOLOG_READ_COLLISION");
}
const completed = (op: Operation) => `homolog.read-proof.${op}.completed`;
const receiptTable = "homolog_read_proof";
const opId = (m: HomologReadProofManifest, op: Operation) =>
  op === "create" ? m.operationId : m.withdrawalOperationId;
function receipt(
  m: HomologReadProofManifest,
  op: Operation,
  before: State,
  state: State,
  at: string,
  administrativeActor: z.infer<typeof actorSchema>,
  identityAuditMetadata: AuditMetadata,
  rowAuditIds: Record<string, string>
) {
  return {
    version: "structr-homolog-read-proof-receipt-v1",
    operationId: opId(m, op),
    manifestHash: digest(m),
    manifest: m,
    operation: op,
    identityState: before,
    identityAuditMetadata,
    rowAuditIds: { ...rowAuditIds },
    state,
    at,
    administrativeActor,
    executorId,
  };
}
function expectedEvidence(
  m: HomologReadProofManifest,
  op: Operation,
  before: State,
  state: State,
  r: unknown
) {
  const operationId = opId(m, op),
    hash = digest(m);
  const result = (op === "create" ? fixtureNames : identityNames).flatMap(
    name =>
      state[name].map(row =>
        expectedAudit(
          `homolog.read-proof.${name}.${op}`,
          name,
          row.id,
          op === "create" ? null : before[name].find(old => old.id === row.id),
          rowAfter(operationId, hash, row)
        )
      )
  );
  result.push(expectedAudit(completed(op), receiptTable, operationId, null, r));
  return result;
}
async function verifyOperationEvidence(
  tx: Transaction,
  m: HomologReadProofManifest,
  op: Operation,
  identity: State,
  identityAuditMetadata: AuditMetadata
): Promise<State> {
  const logs = await evidence(tx, opId(m, op)),
    code = "HOMOLOG_READ_OPERATION_CONFLICT";
  const r = singleReceipt(logs, opId(m, op), completed(op), receiptTable, code),
    actor = actorSchema.safeParse(r.administrativeActor);
  if (!actor.success || !microsecond(r.at)) fail(code);
  const state =
    op === "create" ? businessState(m, r.at) : withdrawnState(identity, r.at);
  const rowIds = Object.values(state)
    .flatMap(rows => rows.map(row => row.id))
    .sort();
  const ids = z.record(uuid, uuid).safeParse(r.rowAuditIds);
  if (
    !ids.success ||
    !same(Object.keys(ids.data).sort(), rowIds) ||
    new Set(Object.values(ids.data)).size !== rowIds.length
  )
    fail(code);
  const expected = receipt(
    m,
    op,
    identity,
    state,
    r.at,
    actor.data,
    identityAuditMetadata,
    ids.data
  );
  if (!same(r, expected)) fail(code);
  verifyAudits(logs, expectedEvidence(m, op, identity, state, expected), code, {
    at: r.at,
    ids: ids.data,
  });
  return state;
}
async function verifyOperation(
  tx: Transaction,
  m: HomologReadProofManifest,
  op: Operation,
  identity: State,
  identityAuditMetadata: AuditMetadata
): Promise<State> {
  const state = await verifyOperationEvidence(
    tx,
    m,
    op,
    identity,
    identityAuditMetadata
  );
  const current = await readState(
    tx,
    op === "create" ? fixtureIds(m) : identityIds(m)
  );
  if (!same(current, state)) fail("HOMOLOG_READ_STATE_DRIFT");
  return state;
}
async function insertBusiness(tx: Transaction, name: TableName, row: Row) {
  const table = tables[name];
  const columns = Object.entries(getTableColumns(table)).filter(
    ([key]) => key !== "provenanceState"
  );
  const physical = Object.fromEntries(
    columns.map(([key, column]) => [column.name, row[key]])
  );
  const names = sql.join(
    columns.map(([, column]) => sql.identifier(column.name)),
    sql`,`
  );
  // Typed whole-row coercion retains timestamps at full PostgreSQL precision.
  // provenance_state is deliberately absent from INSERT: the real trigger owns it.
  await tx.execute(sql`INSERT INTO ${table} (${names}) SELECT ${names}
    FROM jsonb_populate_record(NULL::${table},${JSON.stringify(physical)}::jsonb)`);
}
async function insertAudit(
  tx: Transaction,
  expected: ReturnType<typeof expectedAudit>
) {
  const inserted = await logAudit(
    {
      userId: null,
      action: expected.action,
      tableName: expected.tableName,
      recordId: expected.recordId,
      before: expected.oldValues,
      after: expected.newValues,
    },
    tx
  );
  if (!inserted || !uuid.safeParse(inserted.id).success)
    fail("HOMOLOG_READ_OPERATION_CONFLICT");
  return inserted.id;
}
async function execute(
  db: PostgresJsDatabase,
  value: unknown,
  operation: Operation
) {
  const m = parseHomologReadProofManifest(value),
    plan = planHomologReadProof(m);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(
        async tx => {
          const actor = await principal(tx);
          // Serialize against the original identity bootstrap and all fixtures using
          // that identity set. Both operations acquire these locks in this order.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(731014,hashtext(${m.identity.operationId}))`
          );
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(731018,hashtext(${m.operationId}))`
          );
          const originalIdentity = await verifyIdentity(tx, m);
          const identityAuditMetadata = auditMetadata(
            await evidence(tx, m.identity.operationId),
            "HOMOLOG_READ_IDENTITY_CONFLICT"
          );
          const existingWithdrawal = await evidence(
            tx,
            m.withdrawalOperationId
          );
          if (operation === "create" && existingWithdrawal.length)
            fail("HOMOLOG_READ_WITHDRAWN");
          if (operation === "withdraw" && existingWithdrawal.length) {
            await verifyOperation(
              tx,
              m,
              "create",
              originalIdentity,
              identityAuditMetadata
            );
            await verifyOperation(
              tx,
              m,
              "withdraw",
              originalIdentity,
              identityAuditMetadata
            );
            await assertPopulation(tx, m, true);
            return { ...plan, status: "replayed" };
          }
          if (!same(await readState(tx, identityIds(m)), originalIdentity))
            fail("HOMOLOG_READ_IDENTITY_CONFLICT");
          if (
            operation === "create" &&
            (await evidence(tx, m.operationId)).length
          ) {
            await verifyOperation(
              tx,
              m,
              "create",
              originalIdentity,
              identityAuditMetadata
            );
            await assertPopulation(tx, m, true);
            return { ...plan, status: "replayed" };
          }
          if (operation === "create") {
            await assertNoCollision(tx, m);
            await assertPopulation(tx, m, false);
          } else {
            await verifyOperation(
              tx,
              m,
              "create",
              originalIdentity,
              identityAuditMetadata
            );
            await assertPopulation(tx, m, true);
          }
          const at = await clock(tx),
            state =
              operation === "create"
                ? businessState(m, at)
                : withdrawnState(originalIdentity, at);
          const rowAuditIds: Record<string, string> = {};
          let desiredReceipt = receipt(
            m,
            operation,
            originalIdentity,
            state,
            at,
            actor,
            identityAuditMetadata,
            rowAuditIds
          );
          const audits = expectedEvidence(
            m,
            operation,
            originalIdentity,
            state,
            desiredReceipt
          );
          for (const name of operation === "create"
            ? fixtureNames
            : identityNames) {
            for (const row of state[name]) {
              if (operation === "create") await insertBusiness(tx, name, row);
              else
                await tx.execute(
                  sql`UPDATE ${tables[name]} SET is_active=false,updated_at=${at}::timestamptz WHERE id=${row.id}::uuid`
                );
              const expected = audits.find(
                a => a.tableName === name && a.recordId === row.id
              )!;
              rowAuditIds[row.id] = await insertAudit(tx, expected);
            }
          }
          if (
            !same(
              await readState(
                tx,
                operation === "create" ? fixtureIds(m) : identityIds(m)
              ),
              state
            )
          )
            fail("HOMOLOG_READ_STATE_DRIFT");
          desiredReceipt = receipt(
            m,
            operation,
            originalIdentity,
            state,
            at,
            actor,
            identityAuditMetadata,
            rowAuditIds
          );
          audits[audits.length - 1] = expectedAudit(
            completed(operation),
            receiptTable,
            opId(m, operation),
            null,
            desiredReceipt
          );
          const receiptId = await insertAudit(tx, audits[audits.length - 1]);
          // A deferred constraint trigger is still part of this transaction. Run
          // every pending constraint before readback, and keep them immediate for
          // the remainder so no deferred mutation can follow our final checks.
          await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
          // Final checks happen after every write, including the receipt and its triggers.
          // Compare with the principal, clock and expected rows captured before any
          // mutation. Reconstructing only from the persisted receipt would let a
          // trigger replace those expectations with its own well-formed values.
          verifyAudits(
            await evidence(tx, opId(m, operation)),
            audits,
            "HOMOLOG_READ_OPERATION_CONFLICT",
            { at, ids: { ...rowAuditIds, [opId(m, operation)]: receiptId } }
          );
          if (
            !same(
              await readState(
                tx,
                operation === "create" ? fixtureIds(m) : identityIds(m)
              ),
              state
            )
          )
            fail("HOMOLOG_READ_STATE_DRIFT");
          await verifyOperation(
            tx,
            m,
            operation,
            originalIdentity,
            identityAuditMetadata
          );
          await verifyIdentity(tx, m);
          if (
            !same(
              auditMetadata(
                await evidence(tx, m.identity.operationId),
                "HOMOLOG_READ_IDENTITY_CONFLICT"
              ),
              identityAuditMetadata
            )
          )
            fail("HOMOLOG_READ_IDENTITY_CONFLICT");
          if (operation === "create") {
            if (!same(await readState(tx, identityIds(m)), originalIdentity))
              fail("HOMOLOG_READ_IDENTITY_CONFLICT");
          } else
            await verifyOperation(
              tx,
              m,
              "create",
              originalIdentity,
              identityAuditMetadata
            );
          await assertPopulation(tx, m, true);
          return {
            ...plan,
            status: operation === "create" ? "created" : "withdrawn",
          };
        },
        { isolationLevel: "serializable" }
      );
    } catch (error) {
      if (error instanceof ReadProofError) throw error;
      let cause: unknown = error,
        retry = false;
      for (
        let depth = 0;
        depth < 5 && cause && typeof cause === "object";
        depth++
      ) {
        if (
          ["40001", "40P01"].includes(
            String((cause as { code?: unknown }).code)
          )
        ) {
          retry = true;
          break;
        }
        cause = (cause as { cause?: unknown }).cause;
      }
      if (retry && attempt < 2) continue;
      fail("HOMOLOG_READ_FAILED");
    }
  }
  fail("HOMOLOG_READ_FAILED");
}
/** An independently verified administrative handle is required; projectRef cannot authenticate it. */
export function provisionHomologReadProof(
  db: PostgresJsDatabase,
  value: unknown
) {
  return execute(db, value, "create");
}
/** Preserves business rows, mappings and every receipt; deactivates exactly the original synthetic identity set. */
export function withdrawHomologReadProof(
  db: PostgresJsDatabase,
  value: unknown
) {
  return execute(db, value, "withdraw");
}

type CycleOperation = "reactivate" | "withdraw";
const cycleAction = (op: CycleOperation) =>
  `homolog.identity-cycle.${op}.completed`;
const cycleId = (m: HomologIdentityCycleManifest, op: CycleOperation) =>
  op === "reactivate" ? m.reactivationOperationId : m.withdrawalOperationId;
function cycleState(before: State, op: CycleOperation, at: string): State {
  return Object.fromEntries(
    identityNames.map(name => [
      name,
      before[name].map(row => ({
        ...row,
        isActive: op === "reactivate",
        updatedAt: at,
      })),
    ])
  );
}
async function cycleHistory(tx: Transaction, prior: HomologReadProofManifest) {
  const identity = await verifyIdentity(tx, prior);
  const bootstrap = await evidence(tx, prior.identity.operationId);
  const metadata = auditMetadata(bootstrap, "HOMOLOG_READ_IDENTITY_CONFLICT");
  // Creation still verifies its four current business rows. The old withdrawal
  // is historical evidence here: the new cycle deliberately changes those identities.
  await verifyOperation(tx, prior, "create", identity, metadata);
  const state = await verifyOperationEvidence(
    tx,
    prior,
    "withdraw",
    identity,
    metadata
  );
  const rows = [
    ...bootstrap,
    ...(await evidence(tx, prior.operationId)),
    ...(await evidence(tx, prior.withdrawalOperationId)),
  ];
  return { state, hash: digest(ordered(rows)) };
}
async function cyclePopulation(
  tx: Transaction,
  prior: HomologReadProofManifest
) {
  const rows = await tx.execute(
    sql`SELECT id FROM ${profiles} WHERE tenant_id IN (${sql.join(
      Object.values(prior.identity.tenants).map(t => sql`${t.id}::uuid`),
      sql`,`
    )}) ORDER BY id FOR SHARE`
  );
  if (
    !same(
      rows.map(r => r.id),
      Object.values(prior.identity.profiles)
        .map(p => p.id)
        .sort()
    )
  )
    fail("HOMOLOG_CYCLE_STATE_DRIFT");
}
function cycleReceipt(
  m: HomologIdentityCycleManifest,
  op: CycleOperation,
  before: State,
  state: State,
  at: string,
  actor: z.infer<typeof actorSchema>,
  priorEvidenceHash: string,
  rowAuditIds: Record<string, string>
) {
  return {
    version: "structr-homolog-identity-cycle-receipt-v1",
    operationId: cycleId(m, op),
    manifestHash: digest(m),
    manifest: m,
    operation: op,
    before,
    state,
    at,
    administrativeActor: actor,
    priorEvidenceHash,
    rowAuditIds: { ...rowAuditIds },
    executorId: "structr-homolog-identity-cycle-drizzle-v1",
  };
}
function cycleAudits(
  m: HomologIdentityCycleManifest,
  op: CycleOperation,
  before: State,
  state: State,
  receipt: unknown
) {
  const result = identityNames.flatMap(name =>
    state[name].map(row =>
      expectedAudit(
        `homolog.identity-cycle.${name}.${op}`,
        name,
        row.id,
        before[name].find(old => old.id === row.id),
        rowAfter(cycleId(m, op), digest(m), row)
      )
    )
  );
  result.push(
    expectedAudit(
      cycleAction(op),
      "homolog_identity_cycle",
      cycleId(m, op),
      null,
      receipt
    )
  );
  return result;
}
async function verifyCycleEvidence(
  tx: Transaction,
  m: HomologIdentityCycleManifest,
  op: CycleOperation,
  before: State,
  priorEvidenceHash: string
) {
  const code = "HOMOLOG_CYCLE_OPERATION_CONFLICT",
    logs = await evidence(tx, cycleId(m, op));
  const r = singleReceipt(
    logs,
    cycleId(m, op),
    cycleAction(op),
    "homolog_identity_cycle",
    code
  );
  const actor = actorSchema.safeParse(r.administrativeActor),
    ids = z.record(uuid, uuid).safeParse(r.rowAuditIds);
  const rowIds = Object.values(before)
    .flatMap(rows => rows.map(row => row.id))
    .sort();
  if (
    !actor.success ||
    !microsecond(r.at) ||
    !ids.success ||
    !same(Object.keys(ids.data).sort(), rowIds) ||
    new Set(Object.values(ids.data)).size !== 5
  )
    fail(code);
  const state = cycleState(before, op, r.at);
  const expected = cycleReceipt(
    m,
    op,
    before,
    state,
    r.at,
    actor.data,
    priorEvidenceHash,
    ids.data
  );
  if (!same(r, expected)) fail(code);
  verifyAudits(logs, cycleAudits(m, op, before, state, expected), code, {
    at: r.at,
    ids: ids.data,
  });
  return state;
}
async function executeCycle(
  db: PostgresJsDatabase,
  value: unknown,
  operation: CycleOperation
) {
  const m = parseHomologIdentityCycleManifest(value),
    plan = planHomologIdentityCycle(m),
    prior = m.priorReadProof;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(
        async tx => {
          const actor = await principal(tx);
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(731014,hashtext(${prior.identity.operationId}))`
          );
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(731018,hashtext(${prior.operationId}))`
          );
          const history = await cycleHistory(tx, prior);
          await cyclePopulation(tx, prior);
          const current = () => readState(tx, identityIds(prior));
          const assertCurrent = async (state: State) => {
            if (!same(await current(), state))
              fail("HOMOLOG_CYCLE_STATE_DRIFT");
          };
          const activationLogs = await evidence(tx, m.reactivationOperationId);
          const withdrawalLogs = await evidence(tx, m.withdrawalOperationId);
          if (operation === "reactivate" && withdrawalLogs.length)
            fail("HOMOLOG_CYCLE_WITHDRAWN");
          let before = history.state,
            priorEvidenceHash = history.hash;
          if (activationLogs.length) {
            const active = await verifyCycleEvidence(
              tx,
              m,
              "reactivate",
              history.state,
              history.hash
            );
            if (operation === "reactivate") {
              await assertCurrent(active);
              return { ...plan, status: "replayed" };
            }
            before = active;
            priorEvidenceHash = digest({
              history: history.hash,
              reactivation: activationLogs,
            });
            if (withdrawalLogs.length) {
              const withdrawn = await verifyCycleEvidence(
                tx,
                m,
                "withdraw",
                before,
                priorEvidenceHash
              );
              await assertCurrent(withdrawn);
              return { ...plan, status: "replayed" };
            }
          } else {
            if (operation === "withdraw" || withdrawalLogs.length)
              fail("HOMOLOG_CYCLE_OPERATION_CONFLICT");
            // Only the first reactivation requires the original bounded population.
            // Later withdrawal removes authority, preserving legitimate IF-1 additions.
            await assertPopulation(tx, prior, true);
          }
          await assertCurrent(before);
          const at = await clock(tx),
            state = cycleState(before, operation, at),
            rowAuditIds: Record<string, string> = {};
          const expected = cycleAudits(m, operation, before, state, null);
          for (const name of identityNames) {
            for (const row of state[name]) {
              await tx.execute(
                sql`UPDATE ${tables[name]} SET is_active=${operation === "reactivate"},updated_at=${at}::timestamptz WHERE id=${row.id}::uuid`
              );
              rowAuditIds[row.id] = await insertAudit(
                tx,
                expected.find(
                  a => a.tableName === name && a.recordId === row.id
                )!
              );
            }
          }
          const receipt = cycleReceipt(
            m,
            operation,
            before,
            state,
            at,
            actor,
            priorEvidenceHash,
            rowAuditIds
          );
          expected[expected.length - 1] = expectedAudit(
            cycleAction(operation),
            "homolog_identity_cycle",
            cycleId(m, operation),
            null,
            receipt
          );
          const receiptId = await insertAudit(
            tx,
            expected[expected.length - 1]
          );
          await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
          verifyAudits(
            await evidence(tx, cycleId(m, operation)),
            expected,
            "HOMOLOG_CYCLE_OPERATION_CONFLICT",
            { at, ids: { ...rowAuditIds, [cycleId(m, operation)]: receiptId } }
          );
          await assertCurrent(state);
          if ((await cycleHistory(tx, prior)).hash !== history.hash)
            fail("HOMOLOG_CYCLE_OPERATION_CONFLICT");
          if (
            operation === "withdraw" &&
            !same(await evidence(tx, m.reactivationOperationId), activationLogs)
          )
            fail("HOMOLOG_CYCLE_OPERATION_CONFLICT");
          await cyclePopulation(tx, prior);
          await verifyCycleEvidence(
            tx,
            m,
            operation,
            before,
            priorEvidenceHash
          );
          return {
            ...plan,
            status: operation === "reactivate" ? "reactivated" : "withdrawn",
          };
        },
        { isolationLevel: "serializable" }
      );
    } catch (error) {
      if (error instanceof ReadProofError) throw error;
      let cause: unknown = error,
        retry = false;
      for (
        let depth = 0;
        depth < 5 && cause && typeof cause === "object";
        depth++
      ) {
        if (
          ["40001", "40P01"].includes(
            String((cause as { code?: unknown }).code)
          )
        ) {
          retry = true;
          break;
        }
        cause = (cause as { cause?: unknown }).cause;
      }
      if (retry && attempt < 2) continue;
      fail("HOMOLOG_CYCLE_FAILED");
    }
  }
  fail("HOMOLOG_CYCLE_FAILED");
}
/** One nominal transition from the exact completed read-proof withdrawal, never a bootstrap repair. */
export function reactivateHomologReadProofIdentities(
  db: PostgresJsDatabase,
  value: unknown
) {
  return executeCycle(db, value, "reactivate");
}
/** Withdraws only the five reactivated identities; legitimate business additions remain untouched. */
export function withdrawHomologReadProofIdentities(
  db: PostgresJsDatabase,
  value: unknown
) {
  return executeCycle(db, value, "withdraw");
}

const evidenceDigest = z.string().regex(/^[0-9a-f]{64}$/);
const continuationSchema = z
  .object({
    version: z.literal("structr-homolog-identity-continuation-v1"),
    projectRef: z.literal("wmspwegbqtzamkhxhusg"),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    reactivationOperationId: uuid,
    withdrawalOperationId: uuid,
    priorReadProof: z.unknown(),
    predecessor: z
      .object({
        manifest: z.unknown(),
        manifestHash: evidenceDigest,
        reactivationReceiptHash: evidenceDigest,
        withdrawalReceiptHash: evidenceDigest,
        withdrawnStateHash: evidenceDigest,
      })
      .strict(),
    auditHistory: z
      .object({
        count: z.number().int().min(35).max(10000),
        hash: evidenceDigest,
      })
      .strict(),
    formations: z
      .array(
        z
          .object({
            clientId: uuid,
            projectId: uuid,
            intakeFormId: uuid,
            clientHash: evidenceDigest,
            projectHash: evidenceDigest,
            intakeHash: evidenceDigest,
            audits: z
              .array(z.object({ id: uuid, hash: evidenceDigest }).strict())
              .length(3),
          })
          .strict()
      )
      .length(2),
  })
  .strict();
export type HomologIdentityContinuationManifest = Omit<
  z.infer<typeof continuationSchema>,
  "priorReadProof" | "predecessor"
> & {
  priorReadProof: HomologReadProofManifest;
  predecessor: Omit<
    z.infer<typeof continuationSchema>["predecessor"],
    "manifest"
  > & { manifest: HomologIdentityCycleManifest };
};
/** Exactly one closed v1 predecessor, never recursive or an inferred latest audit. */
export function parseHomologIdentityContinuationManifest(
  value: unknown
): HomologIdentityContinuationManifest {
  try {
    const m = continuationSchema.parse(value),
      prior = parseHomologReadProofManifest(m.priorReadProof),
      previous = parseHomologIdentityCycleManifest(m.predecessor.manifest);
    if (
      !same(previous.priorReadProof, prior) ||
      digest(previous) !== m.predecessor.manifestHash
    )
      fail("HOMOLOG_CONTINUATION_MANIFEST_INVALID");
    const ids = [
      m.reactivationOperationId,
      m.withdrawalOperationId,
      previous.reactivationOperationId,
      previous.withdrawalOperationId,
      prior.operationId,
      prior.withdrawalOperationId,
      prior.identity.operationId,
      ...Object.values(prior.fixture),
      ...Object.values(prior.identity.tenants).map(t => t.id),
      ...Object.values(prior.identity.profiles).flatMap(p => [
        p.id,
        p.providerSubject,
      ]),
      ...m.formations.flatMap(f => [
        f.clientId,
        f.projectId,
        f.intakeFormId,
        ...f.audits.map(a => a.id),
      ]),
    ];
    if (new Set(ids).size !== ids.length)
      fail("HOMOLOG_CONTINUATION_MANIFEST_INVALID");
    return {
      ...m,
      priorReadProof: prior,
      predecessor: { ...m.predecessor, manifest: previous },
    };
  } catch {
    fail("HOMOLOG_CONTINUATION_MANIFEST_INVALID");
  }
}
export function planHomologIdentityContinuation(value: unknown) {
  const m = parseHomologIdentityContinuationManifest(value);
  return {
    status: "planned" as string,
    reactivationOperationId: m.reactivationOperationId,
    withdrawalOperationId: m.withdrawalOperationId,
    manifestHash: digest(m),
    reactivateRows: 5,
    reactivateAudits: 6,
    withdrawRows: 5,
    withdrawAudits: 6,
    authVerified: false,
    databaseTargetVerified: false,
  };
}
const continuationId = (
  m: HomologIdentityContinuationManifest,
  op: CycleOperation
) =>
  op === "reactivate" ? m.reactivationOperationId : m.withdrawalOperationId;
const continuationAction = (op: CycleOperation) =>
  `homolog.identity-continuation.${op}.completed`;
function continuationReceipt(
  m: HomologIdentityContinuationManifest,
  op: CycleOperation,
  before: State,
  state: State,
  at: string,
  actor: z.infer<typeof actorSchema>,
  priorEvidenceHash: string,
  rowAuditIds: Record<string, string>
) {
  return {
    version: "structr-homolog-identity-continuation-receipt-v1",
    operationId: continuationId(m, op),
    manifestHash: digest(m),
    manifest: m,
    operation: op,
    before,
    state,
    at,
    administrativeActor: actor,
    priorEvidenceHash,
    rowAuditIds: { ...rowAuditIds },
    executorId: "structr-homolog-identity-continuation-drizzle-v1",
  };
}
function continuationAudits(
  m: HomologIdentityContinuationManifest,
  op: CycleOperation,
  before: State,
  state: State,
  receipt: unknown
) {
  const result = identityNames.flatMap(name =>
    state[name].map(row =>
      expectedAudit(
        `homolog.identity-continuation.${name}.${op}`,
        name,
        row.id,
        before[name].find(old => old.id === row.id),
        rowAfter(continuationId(m, op), digest(m), row)
      )
    )
  );
  result.push(
    expectedAudit(
      continuationAction(op),
      "homolog_identity_continuation",
      continuationId(m, op),
      null,
      receipt
    )
  );
  return result;
}
/** Pure full-receipt verification for an independent observer; performs no reads or writes. */
export function verifyHomologIdentityContinuationEvidence(
  logs: Row[],
  value: unknown,
  op: CycleOperation,
  before: State,
  priorEvidenceHash: string
): State {
  const m = parseHomologIdentityContinuationManifest(value),
    code = "HOMOLOG_CONTINUATION_OPERATION_CONFLICT";
  const r = singleReceipt(
    logs,
    continuationId(m, op),
    continuationAction(op),
    "homolog_identity_continuation",
    code
  );
  const actor = actorSchema.safeParse(r.administrativeActor),
    ids = z.record(uuid, uuid).safeParse(r.rowAuditIds);
  const rowIds = Object.values(before)
    .flatMap(rows => rows.map(r => r.id))
    .sort();
  if (
    !actor.success ||
    !microsecond(r.at) ||
    !ids.success ||
    !same(Object.keys(ids.data).sort(), rowIds) ||
    new Set(Object.values(ids.data)).size !== 5
  )
    fail(code);
  const state = cycleState(before, op, r.at),
    expected = continuationReceipt(
      m,
      op,
      before,
      state,
      r.at,
      actor.data,
      priorEvidenceHash,
      ids.data
    );
  if (!same(r, expected)) fail(code);
  verifyAudits(logs, continuationAudits(m, op, before, state, expected), code, {
    at: r.at,
    ids: ids.data,
  });
  return state;
}
async function continuationPredecessor(
  tx: Transaction,
  m: HomologIdentityContinuationManifest
) {
  const original = await cycleHistory(tx, m.priorReadProof),
    previous = m.predecessor.manifest;
  const active = await verifyCycleEvidence(
    tx,
    previous,
    "reactivate",
    original.state,
    original.hash
  );
  const activation = await evidence(tx, previous.reactivationOperationId);
  const state = await verifyCycleEvidence(
    tx,
    previous,
    "withdraw",
    active,
    digest({ history: original.hash, reactivation: activation })
  );
  const withdrawal = await evidence(tx, previous.withdrawalOperationId);
  if (
    digest(
      singleReceipt(
        activation,
        previous.reactivationOperationId,
        cycleAction("reactivate"),
        "homolog_identity_cycle",
        "HOMOLOG_CONTINUATION_OPERATION_CONFLICT"
      )
    ) !== m.predecessor.reactivationReceiptHash ||
    digest(
      singleReceipt(
        withdrawal,
        previous.withdrawalOperationId,
        cycleAction("withdraw"),
        "homolog_identity_cycle",
        "HOMOLOG_CONTINUATION_OPERATION_CONFLICT"
      )
    ) !== m.predecessor.withdrawalReceiptHash ||
    digest(state) !== m.predecessor.withdrawnStateHash
  )
    fail("HOMOLOG_CONTINUATION_OPERATION_CONFLICT");
  return state;
}
const formationTables = { clients, projects, intake_forms: intakeForms };
const formationNumbers = new Set([
  "estimated_total",
  "actual_total",
  "variance_pct",
  "latitude",
  "longitude",
  "variance_threshold_pct",
  "scope_completeness_score",
  "realized_gross_profit_pct",
]);
/** Matches the IF-1 wire representation without trusting its SQL projection helper. */
function formationProjection(
  table: typeof clients | typeof projects | typeof intakeForms
): SQL {
  const pieces = Object.entries(getTableColumns(table)).flatMap(([key, c]) => [
    sql`${key}::text`,
    c.columnType === "PgTimestamp"
      ? sql`to_char(${sql.identifier(c.name)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
      : formationNumbers.has(c.name)
        ? sql`${sql.identifier(c.name)}::text`
        : sql`${sql.identifier(c.name)}`,
  ]);
  const chunks: SQL[] = [];
  for (let i = 0; i < pieces.length; i += 80)
    chunks.push(
      sql`jsonb_build_object(${sql.join(pieces.slice(i, i + 80), sql`,`)})`
    );
  return sql`(${sql.join(chunks, sql` || `)})`;
}
async function continuationPreservation(
  tx: Transaction,
  m: HomologIdentityContinuationManifest
) {
  const code = "HOMOLOG_CONTINUATION_STATE_DRIFT",
    prior = m.priorReadProof,
    tenantIds = Object.values(prior.identity.tenants).map(t => t.id);
  await cyclePopulation(tx, prior);
  const expectedIds = {
    ...fixtureIds(prior),
    clients: [prior.fixture.clientId, ...m.formations.map(f => f.clientId)],
    projects: [prior.fixture.projectId, ...m.formations.map(f => f.projectId)],
    intake_forms: m.formations.map(f => f.intakeFormId),
  };
  for (const [name, ids] of Object.entries(expectedIds)) {
    const table = { ...tables, intake_forms: intakeForms }[
      name as keyof typeof tables | "intake_forms"
    ];
    const rows = await tx.execute(
      sql`SELECT id FROM ${table} WHERE tenant_id IN (${sql.join(
        tenantIds.map(id => sql`${id}::uuid`),
        sql`,`
      )}) ORDER BY id FOR SHARE`
    );
    if (
      !same(
        rows.map(r => r.id),
        [...ids].sort()
      )
    )
      fail(code);
  }
  const auditRows = (
    await tx.execute(
      sql`SELECT ${projection(auditLogs)} AS row FROM ${auditLogs} ORDER BY id FOR SHARE`
    )
  ).map(r => r.row as Row);
  const currentIds = [m.reactivationOperationId, m.withdrawalOperationId];
  const history = auditRows.filter(
    r =>
      !currentIds.includes(String(r.recordId)) &&
      !currentIds.includes(String((r.newValues as any)?.operationId))
  );
  if (
    history.length !== m.auditHistory.count ||
    digest(history) !== m.auditHistory.hash
  )
    fail(code);
  for (const f of m.formations) {
    const rows: Record<string, Row> = {};
    for (const [name, id, hash, action] of [
      ["clients", f.clientId, f.clientHash, "client.create"],
      ["projects", f.projectId, f.projectHash, "project.create"],
      ["intake_forms", f.intakeFormId, f.intakeHash, "intake.create"],
    ] as const) {
      const table = formationTables[name];
      const found = await tx.execute(
        sql`SELECT ${projection(table)} AS row,${formationProjection(table)} AS wire FROM ${table} WHERE id=${id}::uuid FOR SHARE`
      );
      if (found.length !== 1 || digest(found[0].row) !== hash) fail(code);
      const row = found[0].row as Row;
      rows[name] = row;
      if (
        row.tenantId !== prior.identity.tenants.A.id ||
        !microsecond(row.createdAt) ||
        row.updatedAt !== row.createdAt
      )
        fail(code);
      const logs = auditRows.filter(a => a.recordId === id);
      if (logs.length !== 1) fail(code);
      const a = logs[0],
        pin = f.audits.find(pin => pin.id === a.id);
      if (
        !pin ||
        digest(a) !== pin.hash ||
        a.userId !== prior.identity.profiles.A1.id ||
        a.action !== action ||
        a.tableName !== name ||
        a.oldValues !== null ||
        a.ipAddress !== null ||
        a.userAgent !== null ||
        !microsecond(a.createdAt) ||
        a.createdAt !== row.createdAt ||
        !same(a.newValues, found[0].wire)
      )
        fail(code);
    }
    if (
      rows.clients.createdAt !== rows.projects.createdAt ||
      rows.clients.createdAt !== rows.intake_forms.createdAt ||
      rows.projects.clientId !== f.clientId ||
      rows.projects.ownerUserId !== prior.identity.profiles.A1.id ||
      rows.projects.status !== "intake" ||
      rows.projects.provenanceState !== "formation_only" ||
      rows.projects.deletedAt !== null ||
      rows.clients.deletedAt !== null ||
      rows.clients.isActive !== true ||
      rows.intake_forms.projectId !== f.projectId ||
      rows.intake_forms.leadId !== null ||
      rows.intake_forms.status !== "draft" ||
      (rows.intake_forms.formData as any)?.clientId !== f.clientId ||
      !evidenceDigest.safeParse(
        (rows.intake_forms.formData as any)?.creationFingerprint
      ).success
    )
      fail(code);
  }
}
async function continuationProtectedRows(
  tx: Transaction,
  m: HomologIdentityContinuationManifest
) {
  const ids = identityIds(m.priorReadProof),
    result: unknown[] = [];
  for (const name of identityNames)
    result.push(
      (
        await tx.execute(
          sql`SELECT ${projection(tables[name])} AS row FROM ${tables[name]} WHERE id NOT IN (${sql.join(
            ids[name].map(id => sql`${id}::uuid`),
            sql`,`
          )}) ORDER BY id FOR SHARE`
        )
      ).map(r => r.row)
    );
  result.push(
    await tx.execute(
      sql`SELECT to_jsonb(c) AS row FROM structr_private.authenticated_boundary_config c ORDER BY id FOR SHARE`
    )
  );
  return digest(result);
}
async function executeContinuation(
  db: PostgresJsDatabase,
  value: unknown,
  operation: CycleOperation
) {
  const m = parseHomologIdentityContinuationManifest(value),
    plan = planHomologIdentityContinuation(m),
    prior = m.priorReadProof;
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      return await db.transaction(
        async tx => {
          const actor = await principal(tx);
          const [visibility] = await tx.execute(
            sql`SELECT count(*)=2 AND bool_and(has_table_privilege(current_user,c.oid,'SELECT') AND (r.rolsuper OR r.rolbypassrls OR (pg_has_role(current_user,c.relowner,'USAGE') AND NOT c.relforcerowsecurity))) AS allowed
              FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
              WHERE ((n.nspname='public' AND c.relname='intake_forms') OR (n.nspname='structr_private' AND c.relname='authenticated_boundary_config')) AND r.rolname=current_user`
          );
          if (visibility.allowed !== true) fail("HOMOLOG_CONTINUATION_FAILED");
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(731014,hashtext(${prior.identity.operationId}))`
          );
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(731018,hashtext(${prior.operationId}))`
          );
          const initial = await continuationPredecessor(tx, m);
          await continuationPreservation(tx, m);
          const preserved = await continuationProtectedRows(tx, m);
          const activation = await evidence(tx, m.reactivationOperationId),
            withdrawal = await evidence(tx, m.withdrawalOperationId);
          if (operation === "reactivate" && withdrawal.length)
            fail("HOMOLOG_CONTINUATION_WITHDRAWN");
          const assertCurrent = async (state: State) => {
            if (!same(await readState(tx, identityIds(prior)), state))
              fail("HOMOLOG_CONTINUATION_STATE_DRIFT");
          };
          let before = initial,
            priorEvidenceHash = m.auditHistory.hash;
          if (activation.length) {
            const active = verifyHomologIdentityContinuationEvidence(
              activation,
              m,
              "reactivate",
              initial,
              priorEvidenceHash
            );
            if (operation === "reactivate") {
              await assertCurrent(active);
              return { ...plan, status: "replayed" };
            }
            before = active;
            priorEvidenceHash = digest({
              history: m.auditHistory.hash,
              reactivation: activation,
            });
            if (withdrawal.length) {
              await assertCurrent(
                verifyHomologIdentityContinuationEvidence(
                  withdrawal,
                  m,
                  "withdraw",
                  before,
                  priorEvidenceHash
                )
              );
              return { ...plan, status: "replayed" };
            }
          } else if (operation === "withdraw" || withdrawal.length)
            fail("HOMOLOG_CONTINUATION_OPERATION_CONFLICT");
          await assertCurrent(before);
          const at = await clock(tx),
            state = cycleState(before, operation, at),
            rowAuditIds: Record<string, string> = {};
          const expected = continuationAudits(
            m,
            operation,
            before,
            state,
            null
          );
          for (const name of identityNames)
            for (const row of state[name]) {
              await tx.execute(
                sql`UPDATE ${tables[name]} SET is_active=${operation === "reactivate"},updated_at=${at}::timestamptz WHERE id=${row.id}::uuid`
              );
              rowAuditIds[row.id] = await insertAudit(
                tx,
                expected.find(
                  a => a.tableName === name && a.recordId === row.id
                )!
              );
            }
          const receipt = continuationReceipt(
            m,
            operation,
            before,
            state,
            at,
            actor,
            priorEvidenceHash,
            rowAuditIds
          );
          expected[expected.length - 1] = expectedAudit(
            continuationAction(operation),
            "homolog_identity_continuation",
            continuationId(m, operation),
            null,
            receipt
          );
          const receiptId = await insertAudit(
            tx,
            expected[expected.length - 1]
          );
          await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
          const actual = await evidence(tx, continuationId(m, operation));
          verifyAudits(
            actual,
            expected,
            "HOMOLOG_CONTINUATION_OPERATION_CONFLICT",
            {
              at,
              ids: {
                ...rowAuditIds,
                [continuationId(m, operation)]: receiptId,
              },
            }
          );
          verifyHomologIdentityContinuationEvidence(
            actual,
            m,
            operation,
            before,
            priorEvidenceHash
          );
          await assertCurrent(state);
          await continuationPredecessor(tx, m);
          await continuationPreservation(tx, m);
          if (
            operation === "reactivate" &&
            !same(await evidence(tx, m.withdrawalOperationId), withdrawal)
          )
            fail("HOMOLOG_CONTINUATION_STATE_DRIFT");
          if (
            (await continuationProtectedRows(tx, m)) !== preserved ||
            !same(
              await evidence(tx, m.reactivationOperationId),
              operation === "reactivate" ? actual : activation
            )
          )
            fail("HOMOLOG_CONTINUATION_STATE_DRIFT");
          return {
            ...plan,
            status: operation === "reactivate" ? "reactivated" : "withdrawn",
          };
        },
        { isolationLevel: "serializable" }
      );
    } catch (error) {
      if (error instanceof ReadProofError) throw error;
      let cause: unknown = error,
        retry = false;
      for (
        let depth = 0;
        depth < 5 && cause && typeof cause === "object";
        depth++
      ) {
        if (
          ["40001", "40P01"].includes(
            String((cause as { code?: unknown }).code)
          )
        ) {
          retry = true;
          break;
        }
        cause = (cause as { cause?: unknown }).cause;
      }
      if (retry && attempt < 2) continue;
      fail("HOMOLOG_CONTINUATION_FAILED");
    }
  fail("HOMOLOG_CONTINUATION_FAILED");
}
export function reactivateHomologIdentityContinuation(
  db: PostgresJsDatabase,
  value: unknown
) {
  return executeContinuation(db, value, "reactivate");
}
export function withdrawHomologIdentityContinuation(
  db: PostgresJsDatabase,
  value: unknown
) {
  return executeContinuation(db, value, "withdraw");
}

async function main(args: string[]) {
  if (args.length !== 2 || !["plan", "validate"].includes(args[0]))
    fail("HOMOLOG_READ_CLI_USAGE");
  let text: string;
  try {
    const file = await open(args[1], constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 65_536)
        fail("HOMOLOG_READ_MANIFEST_UNREADABLE");
      const buffer = Buffer.alloc(65_537),
        { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 65_536) fail("HOMOLOG_READ_MANIFEST_UNREADABLE");
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
  } catch {
    fail("HOMOLOG_READ_MANIFEST_UNREADABLE");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail("HOMOLOG_READ_MANIFEST_INVALID");
  }
  process.stdout.write(
    `${JSON.stringify({ ...planHomologReadProof(value), status: args[0] === "plan" ? "planned" : "valid" })}\n`
  );
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(
      `${error instanceof ReadProofError ? error.message : "HOMOLOG_READ_FAILED"}\n`
    );
    process.exitCode = 2;
  });
}
