/** Administrative identity bootstrap. No connection factory, Auth API or runtime route. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { and, eq, getTableColumns, inArray, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { auditLogs, profiles, tenants } from "../drizzle/schema";
import { logAudit } from "../server/audit";

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== "00000000-0000-0000-0000-000000000000");
const tenantSchema = z
  .object({
    id: uuid,
    slug: z
      .string()
      .min(16)
      .max(63)
      .regex(/^homolog-access-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
const profileSchema = <T extends "A" | "B">(tenant: T) =>
  z
    .object({
      id: uuid,
      providerSubject: uuid,
      tenant: z.literal(tenant),
      role: z.literal("user"),
    })
    .strict();
const manifestSchema = z
  .object({
    version: z.literal("structr-homolog-identities-v1"),
    projectRef: z.literal("wmspwegbqtzamkhxhusg"),
    operationId: uuid,
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    tenants: z.object({ A: tenantSchema, B: tenantSchema }).strict(),
    profiles: z
      .object({
        A1: profileSchema("A"),
        A2: profileSchema("A"),
        B1: profileSchema("B"),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = [
      value.operationId,
      ...Object.values(value.tenants).map(t => t.id),
      ...Object.values(value.profiles).flatMap(p => [p.id, p.providerSubject]),
    ];
    if (
      new Set(ids).size !== ids.length ||
      value.tenants.A.slug === value.tenants.B.slug
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Identifiers and tenant slugs must be distinct",
      });
    }
  });
export type HomologAccessManifest = z.infer<typeof manifestSchema>;
type Transaction = Parameters<
  Parameters<PostgresJsDatabase["transaction"]>[0]
>[0];
type State = {
  tenants: Array<typeof tenants.$inferSelect>;
  profiles: Array<typeof profiles.$inferSelect>;
};
type SnapshotRow = { id: string; [key: string]: unknown };
type SnapshotState = { tenants: SnapshotRow[]; profiles: SnapshotRow[] };
type Result = ReturnType<typeof planHomologAccess> & {
  status: "created" | "replayed";
};
const completedAction = "homolog.identity.bootstrap.completed";
const receiptTable = "homolog_identity_bootstrap";
const administrativeActorSchema = z
  .object({
    kind: z.literal("database-principal"),
    currentUser: z.string().min(1),
    sessionUser: z.string().min(1),
  })
  .strict();

class BootstrapError extends Error {}
function fail(code: string): never {
  throw new BootstrapError(code);
}

/** A providerSubject and sourceCommit are operator-supplied references, not attestations. */
export function parseHomologAccessManifest(
  value: unknown
): HomologAccessManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) fail("HOMOLOG_MANIFEST_INVALID");
  return result.data;
}

function canonical(value: unknown): string {
  const sort = (item: any): any =>
    Array.isArray(item)
      ? item.map(sort)
      : item !== null && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map(key => [key, sort(item[key])])
          )
        : item;
  // Normalize database Dates to their complete ISO representation before sorting.
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}
function hash(manifest: HomologAccessManifest): string {
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}
export function planHomologAccess(value: unknown) {
  const manifest = parseHomologAccessManifest(value);
  return {
    status: "planned" as string,
    operationId: manifest.operationId,
    manifestHash: hash(manifest),
    tenants: 2,
    profiles: 3,
    authVerified: false,
    databaseTargetVerified: false,
  };
}
function ordered<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}
/** Shared row plan for the separately tested Drizzle and administrative SQL executors. */
export function buildHomologIdentityState(
  manifest: HomologAccessManifest,
  at: Date
): State {
  return {
    tenants: ordered(
      Object.entries(manifest.tenants).map(([label, t]) => ({
        id: t.id,
        name: `Synthetic homolog tenant ${label}`,
        slug: t.slug,
        legalName: null,
        region: "charleston_sc",
        timezone: "America/New_York",
        defaultChannel: "direct",
        settings: {},
        isActive: true,
        onboardingStatus: "not_started",
        isDemo: true,
        activatedAt: null,
        createdAt: at,
        updatedAt: at,
      }))
    ),
    profiles: ordered(
      Object.entries(manifest.profiles).map(([label, p]) => ({
        id: p.id,
        tenantId: manifest.tenants[p.tenant].id,
        externalOpenId: p.providerSubject,
        email: null,
        loginMethod: null,
        fullName: `Synthetic homolog operator ${label}`,
        companyName: null,
        role: p.role,
        isActive: true,
        lastSignedIn: null,
        createdAt: at,
        updatedAt: at,
      }))
    ),
  };
}
function snapshotRow(row: SnapshotRow): SnapshotRow {
  const result = { ...row };
  for (const [key, value] of Object.entries(result))
    if (value instanceof Date) {
      result[key] = value.toISOString().replace(/(\.\d{3})Z$/, "$1000Z");
    }
  return result;
}
function snapshotState(state: State): SnapshotState {
  return {
    tenants: state.tenants.map(snapshotRow),
    profiles: state.profiles.map(snapshotRow),
  };
}
async function readState(
  tx: Transaction,
  manifest: HomologAccessManifest
): Promise<SnapshotState> {
  // Date objects truncate PostgreSQL microseconds. Read exact UTC text so an
  // administrative replay cannot silently accept a submillisecond row change.
  return {
    tenants: ordered(
      await tx
        .select({
          ...getTableColumns(tenants),
          createdAt: sql<string>`to_char(${tenants.createdAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          updatedAt: sql<string>`to_char(${tenants.updatedAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          activatedAt: sql<
            string | null
          >`to_char(${tenants.activatedAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(tenants)
        .where(
          inArray(
            tenants.id,
            Object.values(manifest.tenants).map(t => t.id)
          )
        )
        .for("share")
    ),
    profiles: ordered(
      await tx
        .select({
          ...getTableColumns(profiles),
          createdAt: sql<string>`to_char(${profiles.createdAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          updatedAt: sql<string>`to_char(${profiles.updatedAt} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          lastSignedIn: sql<
            string | null
          >`to_char(${profiles.lastSignedIn} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(profiles)
        .where(
          inArray(
            profiles.id,
            Object.values(manifest.profiles).map(p => p.id)
          )
        )
        .for("share")
    ),
  };
}
function mutations(state: SnapshotState) {
  return [
    ...state.tenants.map(row => ({
      action: "homolog.identity.tenant.create",
      tableName: "tenants",
      row,
    })),
    ...state.profiles.map(row => ({
      action: "homolog.identity.profile.create",
      tableName: "profiles",
      row,
    })),
  ];
}
function mutationAfter(
  operationId: string,
  manifestHash: string,
  row: unknown
) {
  return { operationId, manifestHash, row };
}
async function readEvidence(tx: Transaction, operationId: string) {
  return tx
    .select()
    .from(auditLogs)
    .where(
      or(
        and(
          eq(auditLogs.action, completedAction),
          eq(auditLogs.recordId, operationId)
        ),
        sql`${auditLogs.newValues}->>'operationId' = ${operationId}`
      )
    )
    .for("share");
}
function verifyEvidence(
  evidence: Array<typeof auditLogs.$inferSelect>,
  manifest: HomologAccessManifest,
  manifestHash: string,
  current: SnapshotState
) {
  const receipts = evidence.filter(
    e =>
      e.action === completedAction &&
      e.recordId === manifest.operationId &&
      e.tableName === receiptTable
  );
  const receipt = receipts[0]?.newValues as Record<string, unknown> | null;
  if (
    receipts.length !== 1 ||
    evidence.length !== 6 ||
    !receipt ||
    receipt.version !== "structr-homolog-identity-receipt-v1" ||
    receipt.operationId !== manifest.operationId ||
    receipt.manifestHash !== manifestHash ||
    !receipt.manifest ||
    canonical(receipt.manifest) !== canonical(manifest) ||
    !receipt.state ||
    !administrativeActorSchema.safeParse(receipt.administrativeActor).success ||
    receipts[0].userId !== null ||
    receipts[0].oldValues !== null
  )
    fail("HOMOLOG_OPERATION_CONFLICT");
  if (
    current.tenants.length !== 2 ||
    current.profiles.length !== 3 ||
    canonical(current) !== canonical(receipt.state)
  )
    fail("HOMOLOG_STATE_DRIFT");
  for (const mutation of mutations(current)) {
    const logs = evidence.filter(
      e =>
        e.action === mutation.action &&
        e.tableName === mutation.tableName &&
        e.recordId === mutation.row.id
    );
    if (
      logs.length !== 1 ||
      logs[0].userId !== null ||
      logs[0].oldValues !== null ||
      canonical(logs[0].newValues) !==
        canonical(
          mutationAfter(manifest.operationId, manifestHash, mutation.row)
        )
    )
      fail("HOMOLOG_OPERATION_CONFLICT");
  }
}

/**
 * The caller owns the administrative connection and MUST independently bind it
 * to the intended environment. A manifest projectRef cannot authenticate a DB handle.
 * No connection or credential is read from process.env by this helper.
 */
export async function bootstrapHomologAccess(
  db: PostgresJsDatabase,
  value: unknown
): Promise<Result> {
  const manifest = parseHomologAccessManifest(value),
    plan = planHomologAccess(manifest);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(
        async tx => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(731014,hashtext(${manifest.operationId}))`
          );
          const evidence = await readEvidence(tx, manifest.operationId);
          if (evidence.length) {
            const current = await readState(tx, manifest);
            verifyEvidence(evidence, manifest, plan.manifestHash, current);
            return { ...plan, status: "replayed" as const };
          }
          const ids = [
            manifest.operationId,
            ...Object.values(manifest.tenants).map(t => t.id),
            ...Object.values(manifest.profiles).flatMap(p => [
              p.id,
              p.providerSubject,
            ]),
          ];
          const collisions = await tx
            .select({ id: tenants.id })
            .from(tenants)
            .where(
              or(
                inArray(tenants.id, ids),
                inArray(
                  tenants.slug,
                  Object.values(manifest.tenants).map(t => t.slug)
                )
              )
            );
          const profileCollisions = await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(
              or(
                inArray(profiles.id, ids),
                inArray(profiles.externalOpenId, ids)
              )
            );
          if (collisions.length || profileCollisions.length)
            fail("HOMOLOG_IDENTITY_COLLISION");
          const expected = buildHomologIdentityState(manifest, new Date());
          const [principal] = await tx.execute(
            sql`SELECT current_user AS "currentUser",session_user AS "sessionUser"`
          );
          const administrativeActor = administrativeActorSchema.parse({
            kind: "database-principal",
            ...principal,
          });
          // The preflight establishes before=null for each new row. No upsert/rebind exists.
          for (const row of expected.tenants) {
            await tx.insert(tenants).values(row);
            await logAudit(
              {
                userId: null,
                action: "homolog.identity.tenant.create",
                tableName: "tenants",
                recordId: row.id,
                before: null,
                after: mutationAfter(
                  manifest.operationId,
                  plan.manifestHash,
                  snapshotRow(row)
                ),
              },
              tx
            );
          }
          for (const row of expected.profiles) {
            await tx.insert(profiles).values(row);
            await logAudit(
              {
                userId: null,
                action: "homolog.identity.profile.create",
                tableName: "profiles",
                recordId: row.id,
                before: null,
                after: mutationAfter(
                  manifest.operationId,
                  plan.manifestHash,
                  snapshotRow(row)
                ),
              },
              tx
            );
          }
          const actual = await readState(tx, manifest);
          if (canonical(actual) !== canonical(snapshotState(expected)))
            fail("HOMOLOG_STATE_DRIFT");
          await logAudit(
            {
              userId: null,
              action: completedAction,
              tableName: receiptTable,
              recordId: manifest.operationId,
              before: null,
              after: {
                version: "structr-homolog-identity-receipt-v1",
                operationId: manifest.operationId,
                manifestHash: plan.manifestHash,
                manifest,
                state: actual,
                administrativeActor,
              },
            },
            tx
          );
          verifyEvidence(
            await readEvidence(tx, manifest.operationId),
            manifest,
            plan.manifestHash,
            await readState(tx, manifest)
          );
          return { ...plan, status: "created" as const };
        },
        { isolationLevel: "serializable" }
      );
    } catch (error) {
      if (error instanceof BootstrapError) throw error;
      let cause: unknown = error,
        state: unknown;
      for (
        let depth = 0;
        depth < 4 && cause && typeof cause === "object";
        depth++
      ) {
        state = (cause as { code?: unknown }).code;
        if (state === "40001" || state === "40P01") break;
        cause = (cause as { cause?: unknown }).cause;
      }
      if ((state === "40001" || state === "40P01") && attempt < 2) continue;
      // Administrative consumers never receive SQL/driver values or connection details.
      fail("HOMOLOG_BOOTSTRAP_FAILED");
    }
  }
  fail("HOMOLOG_BOOTSTRAP_FAILED");
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 2 || !["validate", "plan", "sql"].includes(args[0]))
    fail("HOMOLOG_CLI_USAGE");
  let raw: string;
  try {
    const file = await open(args[1], constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 65_536)
        fail("HOMOLOG_MANIFEST_UNREADABLE");
      const buffer = Buffer.alloc(65_537);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 65_536) fail("HOMOLOG_MANIFEST_UNREADABLE");
      raw = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
  } catch {
    fail("HOMOLOG_MANIFEST_UNREADABLE");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("HOMOLOG_MANIFEST_INVALID");
  }
  if (args[0] === "sql") {
    const { renderHomologAccessSql } = await import(
      "./homolog-access-bootstrap-sql"
    );
    process.stdout.write(renderHomologAccessSql(value).sql);
    return;
  }
  const result = planHomologAccess(value);
  process.stdout.write(
    `${JSON.stringify({ ...result, status: args[0] === "validate" ? "valid" : "planned" })}\n`
  );
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(
      `${error instanceof BootstrapError ? error.message : "HOMOLOG_BOOTSTRAP_FAILED"}\n`
    );
    process.exitCode = 2;
  });
}
