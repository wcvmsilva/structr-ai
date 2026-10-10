/** Closed local administrative candidate. No connection factory, Auth API, CLI or web import. */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { auditLogs } from "../drizzle/schema";
import { logAudit } from "../server/audit";

const ROLE = "calculator_pilot_operator_v1";
const IDS = Object.freeze({
  permission: "c8310000-0000-4000-8000-000000000001",
  role: "c8310000-0000-4000-8000-000000000002",
  edge: "c8310000-0000-4000-8000-000000000003",
});
const PREFIX = "financial.calculator.rbac.";
const RECEIPT_TABLE = "financial_calculator_rbac";
const DESCRIPTION = "Nominal Calculator homologation candidate; no other grant";
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(v => v !== "00000000-0000-0000-0000-000000000000");
const manifestSchema = z
  .object({
    version: z.literal("calculator-homologation-rbac-v1"),
    operationId: uuid,
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    expectedDatabase: z.literal("postgres"),
    expectedPrincipal: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    operator: z
      .object({
        subject: uuid,
        actorId: uuid,
        tenantId: uuid,
        originalRole: z.literal("user"),
      })
      .strict(),
    nominalRole: z.literal(ROLE),
    permissionMode: z.literal("create-absent"),
    ids: z
      .object({
        permission: z.literal(IDS.permission),
        role: z.literal(IDS.role),
        edge: z.literal(IDS.edge),
      })
      .strict(),
    window: z
      .object({ opensAt: z.iso.datetime(), closesAt: z.iso.datetime() })
      .strict(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const ids = [
      m.operationId,
      m.operator.subject,
      m.operator.actorId,
      m.operator.tenantId,
      ...Object.values(m.ids),
    ];
    const duration =
      Date.parse(m.window.closesAt) - Date.parse(m.window.opensAt);
    if (new Set(ids).size !== ids.length || duration <= 0 || duration > 7200000)
      ctx.addIssue({
        code: "custom",
        message:
          "Distinct identifiers and a window of at most two hours required",
      });
  });
export type CalculatorRbacManifest = z.infer<typeof manifestSchema>;
type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
type Row = Record<string, any>;
type State = {
  profile: Row;
  tenant: Row;
  permission: Row | null;
  role: Row | null;
  edge: Row | null;
};
type Phase = "apply" | "withdraw";
type Evidence = typeof auditLogs.$inferSelect;
type Mutation = {
  action: string;
  tableName: string;
  recordId: string;
  before: Row | null;
  after: Row | null;
  auditId: string;
};
type Receipt = {
  version: "calculator-rbac-receipt-v1";
  operationId: string;
  manifestHash: string;
  manifest: CalculatorRbacManifest;
  phase: Phase;
  administrativeActor: { currentUser: string; sessionUser: string };
  mutations: Mutation[];
  state: State;
};
class RbacError extends Error {}
function fail(code: string): never {
  throw new RbacError(`CALCULATOR_RBAC_${code}`);
}
function canonical(value: unknown): string {
  const sort = (v: any): any =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, sort(v[k])])
          )
        : v;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}
function same(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
export function parseCalculatorRbacManifest(
  value: unknown
): CalculatorRbacManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) fail("MANIFEST_INVALID");
  return result.data;
}
export function planCalculatorRbac(value: unknown) {
  const m = parseCalculatorRbacManifest(value);
  return {
    status: "planned" as string,
    operationId: m.operationId,
    manifestHash: createHash("sha256").update(canonical(m)).digest("hex"),
    hostedReady: false as const,
    sourceAttested: false as const,
    changes: [
      "permission.create",
      "role.create",
      "role_permission.create",
      "profile.role.assign",
    ],
    withdrawal: ["role_permission.delete", "profile.role.restore"],
  };
}

async function readState(tx: Tx, m: CalculatorRbacManifest): Promise<State> {
  const people = await tx.execute<{ row: Row }>(
    sql`SELECT to_jsonb(p) AS row FROM public.profiles p WHERE id=${m.operator.actorId}::uuid OR external_open_id=${m.operator.subject} OR role=${ROLE} ORDER BY id FOR UPDATE`
  );
  const profile = people[0]?.row;
  if (
    people.length !== 1 ||
    profile.id !== m.operator.actorId ||
    profile.external_open_id !== m.operator.subject ||
    profile.tenant_id !== m.operator.tenantId ||
    profile.is_active !== true
  )
    fail("IDENTITY_MISMATCH");
  const tenants = await tx.execute<{ row: Row }>(
    sql`SELECT to_jsonb(t) AS row FROM public.tenants t WHERE id=${m.operator.tenantId}::uuid FOR SHARE`
  );
  if (tenants.length !== 1 || tenants[0].row.is_active !== true)
    fail("IDENTITY_MISMATCH");
  const roles = await tx.execute<{ row: Row }>(
    sql`SELECT to_jsonb(r) AS row FROM public.roles r WHERE id=${IDS.role}::uuid OR name=${ROLE} ORDER BY id FOR UPDATE`
  );
  const permissions = await tx.execute<{ row: Row }>(
    sql`SELECT to_jsonb(p) AS row FROM public.permissions p WHERE id=${IDS.permission}::uuid OR (resource='estimate' AND action='create') ORDER BY id FOR UPDATE`
  );
  const edges = await tx.execute<{ row: Row }>(
    sql`SELECT to_jsonb(e) AS row FROM public.role_permissions e WHERE id=${IDS.edge}::uuid OR role_id=${IDS.role}::uuid OR permission_id=${IDS.permission}::uuid ORDER BY id FOR UPDATE`
  );
  if (roles.length > 1 || permissions.length > 1 || edges.length > 1)
    fail("STATE_DRIFT");
  return {
    profile,
    tenant: tenants[0].row,
    role: roles[0]?.row ?? null,
    permission: permissions[0]?.row ?? null,
    edge: edges[0]?.row ?? null,
  };
}
async function evidence(
  tx: Tx,
  m: CalculatorRbacManifest
): Promise<Evidence[]> {
  return tx
    .select()
    .from(auditLogs)
    .where(
      sql`${auditLogs.recordId}=${m.operationId} OR ${auditLogs.newValues}->>'operationId'=${m.operationId}`
    )
    .orderBy(auditLogs.id);
}
function validDefinitions(state: State) {
  return (
    state.role?.id === IDS.role &&
    state.role.name === ROLE &&
    state.role.description === DESCRIPTION &&
    state.role.is_system === false &&
    state.permission?.id === IDS.permission &&
    state.permission.resource === "estimate" &&
    state.permission.action === "create" &&
    state.permission.description === DESCRIPTION
  );
}
function validEdge(row: Row | null) {
  return (
    row?.id === IDS.edge &&
    row.role_id === IDS.role &&
    row.permission_id === IDS.permission
  );
}
function validChange(
  before: Row | null,
  after: Row | null,
  m: CalculatorRbacManifest,
  phase: Phase
) {
  return (
    !!before &&
    !!after &&
    before.id === m.operator.actorId &&
    before.external_open_id === m.operator.subject &&
    before.tenant_id === m.operator.tenantId &&
    before.is_active === true &&
    before.role === (phase === "apply" ? "user" : ROLE) &&
    same(after, { ...before, role: phase === "apply" ? ROLE : "user" })
  );
}
function wrap(
  m: CalculatorRbacManifest,
  hash: string,
  phase: Phase,
  row: Row | null
) {
  return {
    version: "calculator-rbac-change-v1",
    operationId: m.operationId,
    manifestHash: hash,
    phase,
    row,
  };
}
function verifyPhase(
  rows: Evidence[],
  m: CalculatorRbacManifest,
  hash: string,
  phase: Phase
): Receipt {
  const completion = rows.filter(
      r => r.action === `${PREFIX}${phase}.completed`
    ),
    r = completion[0]?.newValues as Receipt | undefined;
  if (
    completion.length !== 1 ||
    !r ||
    completion[0].userId !== null ||
    completion[0].recordId !== m.operationId ||
    completion[0].tableName !== RECEIPT_TABLE ||
    completion[0].oldValues !== null ||
    !same(
      Object.keys(r).sort(),
      [
        "version",
        "operationId",
        "manifestHash",
        "manifest",
        "phase",
        "administrativeActor",
        "mutations",
        "state",
      ].sort()
    ) ||
    r.version !== "calculator-rbac-receipt-v1" ||
    r.operationId !== m.operationId ||
    r.manifestHash !== hash ||
    r.phase !== phase ||
    !same(r.manifest, m) ||
    !same(r.administrativeActor, {
      currentUser: m.expectedPrincipal,
      sessionUser: m.expectedPrincipal,
    }) ||
    !Array.isArray(r.mutations) ||
    !r.state ||
    !same(
      Object.keys(r.state).sort(),
      ["profile", "tenant", "permission", "role", "edge"].sort()
    ) ||
    !validDefinitions(r.state)
  )
    fail("OPERATION_CONFLICT");
  const required =
    phase === "apply"
      ? [
          ["permission.create", "permissions", IDS.permission],
          ["role.create", "roles", IDS.role],
          ["role_permission.create", "role_permissions", IDS.edge],
          ["profile.assign", "profiles", m.operator.actorId],
        ]
      : [
          ["role_permission.delete", "role_permissions", IDS.edge],
          ["profile.restore", "profiles", m.operator.actorId],
        ];
  if (r.mutations.length !== required.length) fail("OPERATION_CONFLICT");
  for (let i = 0; i < required.length; i++) {
    const [action, tableName, recordId] = required[i],
      change = r.mutations[i],
      audits = rows.filter(a => a.action === PREFIX + action);
    if (
      !change ||
      !same(
        Object.keys(change).sort(),
        ["action", "tableName", "recordId", "before", "after", "auditId"].sort()
      ) ||
      change.action !== PREFIX + action ||
      change.tableName !== tableName ||
      change.recordId !== recordId ||
      audits.length !== 1 ||
      audits[0].id !== change.auditId ||
      audits[0].userId !== null ||
      audits[0].tableName !== tableName ||
      audits[0].recordId !== recordId ||
      !same(audits[0].oldValues, change.before) ||
      !same(audits[0].newValues, wrap(m, hash, phase, change.after))
    )
      fail("OPERATION_CONFLICT");
  }
  const changes = r.mutations,
    state = r.state,
    last = changes[changes.length - 1];
  if (
    !validChange(last.before, last.after, m, phase) ||
    !same(last.after, state.profile) ||
    state.tenant?.id !== m.operator.tenantId ||
    state.tenant.is_active !== true
  )
    fail("OPERATION_CONFLICT");
  if (phase === "apply") {
    if (
      !validEdge(state.edge) ||
      changes.slice(0, 3).some(c => c.before !== null) ||
      !same(changes[0].after, state.permission) ||
      !same(changes[1].after, state.role) ||
      !same(changes[2].after, state.edge)
    )
      fail("OPERATION_CONFLICT");
  } else if (
    state.edge !== null ||
    !validEdge(changes[0].before) ||
    changes[0].after !== null
  )
    fail("OPERATION_CONFLICT");
  return r;
}
function verifyHistory(
  rows: Evidence[],
  m: CalculatorRbacManifest,
  hash: string
) {
  const applied = verifyPhase(rows, m, hash, "apply"),
    withdrawn = rows.some(r => r.action === `${PREFIX}withdraw.completed`)
      ? verifyPhase(rows, m, hash, "withdraw")
      : null;
  if (rows.length !== (withdrawn ? 8 : 5)) fail("OPERATION_CONFLICT");
  if (
    withdrawn &&
    (!same(withdrawn.state.role, applied.state.role) ||
      !same(withdrawn.state.permission, applied.state.permission) ||
      !same(withdrawn.mutations[0].before, applied.state.edge))
  )
    fail("OPERATION_CONFLICT");
  return { applied, withdrawn };
}
async function changeAudit(
  tx: Tx,
  m: CalculatorRbacManifest,
  hash: string,
  phase: Phase,
  action: string,
  tableName: string,
  recordId: string,
  before: Row | null,
  after: Row | null
): Promise<Mutation> {
  const mutation = {
    action: PREFIX + action,
    tableName,
    recordId,
    before,
    after,
  };
  const written = await logAudit(
    {
      userId: null,
      action: mutation.action,
      tableName,
      recordId,
      before,
      after: wrap(m, hash, phase, after),
    },
    tx
  );
  if (!written) fail("AUDIT_FAILED");
  return { ...mutation, auditId: written.id };
}
function errorState(error: unknown): string | undefined {
  let e = error;
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    if ("code" in e && typeof e.code === "string") return e.code;
    e = "cause" in e ? e.cause : null;
  }
  return undefined;
}
async function assertApplyWindow(tx: Tx, m: CalculatorRbacManifest) {
  const [clock] = await tx.execute<{ now: string }>(
    sql`SELECT clock_timestamp()::text AS now`
  );
  const at = Date.parse(clock.now);
  if (
    !Number.isFinite(at) ||
    at < Date.parse(m.window.opensAt) ||
    at >= Date.parse(m.window.closesAt)
  )
    fail("WINDOW_CLOSED");
}

async function execute(db: PostgresJsDatabase, value: unknown, phase: Phase) {
  const m = parseCalculatorRbacManifest(value),
    plan = planCalculatorRbac(m);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(
        async tx => {
          await tx.execute(
            sql`SET LOCAL search_path=pg_catalog,public,pg_temp`
          );
          const [meta] = await tx.execute<{
            currentUser: string;
            sessionUser: string;
            database: string;
            isolation: string;
            readOnly: string;
            version: number;
          }>(
            sql`SELECT current_user::text AS "currentUser",session_user::text AS "sessionUser",current_database() AS database,current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS "readOnly",current_setting('server_version_num')::int AS version`
          );
          if (
            !meta ||
            meta.currentUser !== m.expectedPrincipal ||
            meta.sessionUser !== m.expectedPrincipal ||
            meta.database !== m.expectedDatabase ||
            meta.isolation !== "serializable" ||
            meta.readOnly !== "off" ||
            meta.version !== 170011
          )
            fail("TARGET_MISMATCH");
          await tx.execute(sql`SET LOCAL TIME ZONE 'UTC'`);
          await tx.execute(sql`SET LOCAL lock_timeout='3s'`);
          await tx.execute(sql`SET LOCAL statement_timeout='10s'`);
          await tx.execute(sql`SET LOCAL transaction_timeout='30s'`);
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(831010,hashtext(${ROLE}))`
          );
          const before = await readState(tx, m),
            rows = await evidence(tx, m),
            history = rows.length
              ? verifyHistory(rows, m, plan.manifestHash)
              : null;
          if (history?.withdrawn) {
            if (phase === "apply") fail("TERMINAL");
            if (!same(before, history.withdrawn.state)) fail("STATE_DRIFT");
            return { ...plan, status: "replayed", phase };
          }
          if (phase === "apply") {
            await assertApplyWindow(tx, m);
            if (history) {
              if (!same(before, history.applied.state)) fail("STATE_DRIFT");
              return { ...plan, status: "replayed", phase };
            }
            if (before.profile.role !== "user") fail("PROFILE_CAS");
            if (before.role || before.permission || before.edge)
              fail("COLLISION");
          } else if (!history) fail("OPERATION_MISSING");
          else if (
            before.profile.role !== ROLE ||
            !same(before.role, history.applied.state.role) ||
            !same(before.permission, history.applied.state.permission) ||
            !same(before.edge, history.applied.state.edge)
          )
            fail("STATE_DRIFT");
          const mutations: Mutation[] = [];
          if (phase === "apply") {
            await tx.execute(
              sql`INSERT INTO public.permissions(id,resource,action,description) VALUES(${IDS.permission}::uuid,'estimate','create',${DESCRIPTION})`
            );
            let next = await readState(tx, m);
            if (
              next.permission?.id !== IDS.permission ||
              next.permission.resource !== "estimate" ||
              next.permission.action !== "create" ||
              next.permission.description !== DESCRIPTION
            )
              fail("STATE_DRIFT");
            mutations.push(
              await changeAudit(
                tx,
                m,
                plan.manifestHash,
                phase,
                "permission.create",
                "permissions",
                IDS.permission,
                null,
                next.permission
              )
            );
            await tx.execute(
              sql`INSERT INTO public.roles(id,name,description,is_system) VALUES(${IDS.role}::uuid,${ROLE},${DESCRIPTION},false)`
            );
            next = await readState(tx, m);
            if (!validDefinitions(next)) fail("STATE_DRIFT");
            mutations.push(
              await changeAudit(
                tx,
                m,
                plan.manifestHash,
                phase,
                "role.create",
                "roles",
                IDS.role,
                null,
                next.role
              )
            );
            await tx.execute(
              sql`INSERT INTO public.role_permissions(id,role_id,permission_id) VALUES(${IDS.edge}::uuid,${IDS.role}::uuid,${IDS.permission}::uuid)`
            );
            next = await readState(tx, m);
            if (!validEdge(next.edge)) fail("STATE_DRIFT");
            mutations.push(
              await changeAudit(
                tx,
                m,
                plan.manifestHash,
                phase,
                "role_permission.create",
                "role_permissions",
                IDS.edge,
                null,
                next.edge
              )
            );
          } else {
            const deleted = await tx.execute(
              sql`DELETE FROM public.role_permissions WHERE id=${IDS.edge}::uuid AND role_id=${IDS.role}::uuid AND permission_id=${IDS.permission}::uuid RETURNING id`
            );
            if (deleted.length !== 1 || (await readState(tx, m)).edge !== null)
              fail("STATE_DRIFT");
            mutations.push(
              await changeAudit(
                tx,
                m,
                plan.manifestHash,
                phase,
                "role_permission.delete",
                "role_permissions",
                IDS.edge,
                before.edge,
                null
              )
            );
          }
          const from = phase === "apply" ? "user" : ROLE,
            to = phase === "apply" ? ROLE : "user";
          const updated = await tx.execute(
            sql`UPDATE public.profiles SET role=${to} WHERE id=${m.operator.actorId}::uuid AND external_open_id=${m.operator.subject} AND tenant_id=${m.operator.tenantId}::uuid AND is_active IS TRUE AND role=${from} RETURNING id`
          );
          if (updated.length !== 1) fail("PROFILE_CAS");
          const after = await readState(tx, m);
          if (
            !validChange(before.profile, after.profile, m, phase) ||
            !same(before.tenant, after.tenant) ||
            !validDefinitions(after) ||
            (phase === "apply" ? !validEdge(after.edge) : after.edge !== null)
          )
            fail("STATE_DRIFT");
          mutations.push(
            await changeAudit(
              tx,
              m,
              plan.manifestHash,
              phase,
              phase === "apply" ? "profile.assign" : "profile.restore",
              "profiles",
              m.operator.actorId,
              before.profile,
              after.profile
            )
          );
          const receipt: Receipt = {
            version: "calculator-rbac-receipt-v1",
            operationId: m.operationId,
            manifestHash: plan.manifestHash,
            manifest: m,
            phase,
            administrativeActor: {
              currentUser: meta.currentUser,
              sessionUser: meta.sessionUser,
            },
            mutations,
            state: after,
          };
          await logAudit(
            {
              userId: null,
              action: `${PREFIX}${phase}.completed`,
              tableName: RECEIPT_TABLE,
              recordId: m.operationId,
              before: null,
              after: receipt,
            },
            tx
          );
          await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
          const verified = verifyHistory(
            await evidence(tx, m),
            m,
            plan.manifestHash
          );
          if (
            !same(
              await readState(tx, m),
              phase === "apply"
                ? verified.applied.state
                : verified.withdrawn?.state
            )
          )
            fail("STATE_DRIFT");
          if (phase === "apply") await assertApplyWindow(tx, m);
          return {
            ...plan,
            status: phase === "apply" ? "applied" : "withdrawn",
            phase,
          };
        },
        { isolationLevel: "serializable", accessMode: "read write" }
      );
    } catch (error) {
      if (error instanceof RbacError) throw error;
      if (["40001", "40P01"].includes(errorState(error) ?? "") && attempt < 2)
        continue;
      fail("FAILED");
    }
  }
  return fail("FAILED");
}
export async function applyCalculatorRbac(
  db: PostgresJsDatabase,
  value: unknown
) {
  return execute(db, value, "apply");
}
export async function withdrawCalculatorRbac(
  db: PostgresJsDatabase,
  value: unknown
) {
  return execute(db, value, "withdraw");
}
