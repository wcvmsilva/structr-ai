/** Lab-only helpers. No environment is read and no database is opened at import. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { eq, is, sql as drizzleSql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { tenants, profiles, clients, projects, estimateDrafts, auditLogs, type InsertTenant, type InsertProfile, type InsertClient, type InsertProject, type InsertEstimateDraft } from "../../drizzle/schema";
import { round2, safeParseFloat } from "../../shared/utils/math";

export function schemaForLabDdl(schema: Record<string, unknown>): Record<string, unknown> {
  const seen = new Set<PgTable>();
  return Object.fromEntries(Object.entries(schema).filter(([, value]) => {
    if (!is(value, PgTable)) return true;
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  }));
}

const money = z.string().regex(/^\d+\.\d{2}$/);
const lineSchema = z.object({
  id: z.string().min(1), costGroupName: z.string().min(1), costItemName: z.string().min(1), description: z.string(),
  sourceCostCode: z.string().min(1), quantity: z.literal("1.00"), unit: z.literal("Lump Sum"),
  unitCost: money, extendedCost: money, unitPrice: money, extendedPrice: money, taxable: z.boolean(), costType: z.null(),
}).passthrough();
const selectionSchema = z.object({
  normalizedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  pilot: z.object({ initialOperatorCount: z.literal(1), initialOperator: z.string().min(1), approvedTotal: z.literal("1200.00"), approvedLineIds: z.array(z.string()).length(4) }).passthrough(),
  recordPlan: z.object({ estimateStatus: z.literal("draft"), approvedBy: z.null(), approvedAt: z.null(), lockedAt: z.null() }).passthrough(),
  customer: z.object({ name: z.string().min(1), phone: z.string().nullable(), address: z.string(), email: z.null(), taxRate: z.null() }).passthrough(),
  approvedPhase1: z.object({ name: z.string().min(1), lines: z.array(lineSchema).length(4), totals: z.object({ sourceExtendedCost: z.literal("900.00"), sourceExtendedPrice: z.literal("1200.00"), taxAmount: z.null() }).passthrough() }).passthrough(),
  originalCompleteProposal: z.object({ total: z.literal("6600.00") }).passthrough(),
  deferredPhase2: z.object({ originalProposalReferencePrice: z.literal("5400.00"), cost: z.null(), includedInApprovedPhase1: z.literal(false) }).passthrough(),
  phase1PaymentSchedule: z.null(), phase1Duration: z.null(),
}).passthrough();
export type LabSelection = z.infer<typeof selectionSchema>;

export function validateSelection(input: unknown): LabSelection {
  const selection = selectionSchema.parse(input);
  const lines = selection.approvedPhase1.lines;
  if (new Set(lines.map(line => line.id)).size !== 4 || !isDeepStrictEqual(lines.map(line => line.id), selection.pilot.approvedLineIds)) throw new Error("Source line identity mismatch");
  const expected = [["120.00", "160.00", true, "SYN-M01"], ["310.00", "440.00", false, "SYN-L02"], ["210.00", "240.00", true, "SYN-M01"], ["260.00", "360.00", false, "SYN-L02"]];
  lines.forEach((line, index) => {
    if (!isDeepStrictEqual([line.unitCost, line.unitPrice, line.taxable, line.sourceCostCode], expected[index]) || line.extendedCost !== line.unitCost || line.extendedPrice !== line.unitPrice) throw new Error("Source snapshot does not reconcile with the four authorized lines");
  });
  return selection;
}
export function hashSelection(selection: LabSelection): string { return createHash("sha256").update(JSON.stringify(selection)).digest("hex"); }
function labId(source: string, kind: string): string {
  const hex = createHash("sha256").update(`ed-pilot-lab:${source}:${kind}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function createFixtureRows(selection: LabSelection) {
  const ids = Object.fromEntries(["tenant", "profile", "client", "project", "draft"].map(kind => [kind, labId(selection.normalizedSha256, kind)]));
  const fingerprint = hashSelection(selection);
  const lines = selection.approvedPhase1.lines.map(line => ({
    sourceLineId: line.id, costGroupName: line.costGroupName, costItemName: line.costItemName, description: line.description,
    quantity: 1, unit: line.unit, unitCostSnapshot: line.unitCost, unitPriceSnapshot: line.unitPrice,
    lineTotalCost: line.extendedCost, lineTotalPrice: line.extendedPrice, costCode: line.sourceCostCode, taxable: line.taxable, costType: null, assemblyId: null,
    grossProfitPct: round2((safeParseFloat(line.unitPrice, "unitPrice") - safeParseFloat(line.unitCost, "unitCost")) / safeParseFloat(line.unitPrice, "unitPrice") * 100),
  }));
  const tenant = { id: ids.tenant, name: "Isolated pilot laboratory", slug: `lab-${ids.tenant}`, isActive: true, isDemo: true, onboardingStatus: "not_started", defaultChannel: null, settings: { labOnly: true } } satisfies InsertTenant;
  const profile = { id: ids.profile, tenantId: ids.tenant, externalOpenId: `ed-pilot-lab:${ids.profile}`, fullName: selection.pilot.initialOperator, email: null, role: "user", loginMethod: "legacy_lab_fixture", isActive: true } satisfies InsertProfile;
  const client = { id: ids.client, tenantId: ids.tenant, name: selection.customer.name, phone: selection.customer.phone, address: selection.customer.address, email: null, city: null, state: null, zip: null, commercialChannel: null, notes: "Wholly invented local fixture; not an imported or production record." } satisfies InsertClient;
  const project = { id: ids.project, tenantId: ids.tenant, clientId: ids.client, ownerUserId: ids.profile, name: selection.approvedPhase1.name, clientName: selection.customer.name, address: selection.customer.address, city: null, state: null, zip: null, projectType: "remodel", channel: null, commercialChannel: null, zone: null, region: null, geoRiskClass: null, status: "estimating", estimatedTotal: "1200.00", notes: "Lab fixture only. Wholly invented scope; remodel is a lab category, not a pricing assumption. Tax, terms and geographic policy remain unknown." } satisfies InsertProject;
  const draft = {
    id: ids.draft, tenantId: ids.tenant, projectId: ids.project, clientId: ids.client, createdBy: ids.profile,
    source: "lab_fixture", status: "draft", bundleName: selection.approvedPhase1.name,
    subtotalCost: "900.00", subtotalPrice: "1200.00", finalTotalPrice: "1200.00", grossProfit: "300.00", grossProfitPct: "25.00",
    lineItems: lines, assemblySelections: [], assemblyCount: 0, channel: null, commercialChannel: null, zone: null, region: null,
    approvedBy: null, approvedAt: null, lockedAt: null, profitShieldPassed: null, profitShieldMinPct: null,
    discountApplied: false, discountAmount: "0.00", version: 1,
    notes: "LAB FIXTURE — wholly invented phase-one selection; internal estimate remains draft. No construction authorization or customer export.",
    metadata: { labOnly: true, fixtureHash: fingerprint, sourceSelection: selection, sourceLineManifest: lines.map(line => ({ sourceLineId: line.sourceLineId, externalCostCode: line.costCode, costType: null, taxable: line.taxable })), unknowns: { taxRate: null, taxAmount: null, commercialChannel: null, geographicPolicy: null, phase1Terms: null } },
  } satisfies InsertEstimateDraft;
  return { tenant, profile, client, project, draft, lines, fingerprint };
}

export type OwnedLab = { directory: string; dataDirectory: string; socketDirectory: string; database: string; user: string; port: number };
export type PhysicalIdentity = { database: string; user: string; dataDirectory: string; socketDirectory: string; listenAddresses: string; serverAddress: string | null };
export type ClientTransport = { path: string | undefined; database: string; user: string; port: number };
function assertOwnedTransport(owned: OwnedLab, transport: ClientTransport): void {
  if (!/^\/private\/tmp\/ed-pilot-[^/]+$/.test(owned.directory) || owned.dataDirectory !== `${owned.directory}/data` || owned.socketDirectory !== `${owned.directory}/sock`) throw new Error("Owned lab directory identity mismatch");
  if (transport.path !== `${owned.socketDirectory}/.s.PGSQL.${owned.port}` || transport.database !== owned.database || transport.user !== owned.user || transport.port !== owned.port) throw new Error("Database transport is not the owned Unix socket");
}
export function assertOwnedConnection(owned: OwnedLab, transport: ClientTransport, actual: PhysicalIdentity): void {
  assertOwnedTransport(owned, transport);
  if (actual.database !== owned.database || actual.user !== owned.user || actual.dataDirectory !== owned.dataDirectory || actual.socketDirectory !== owned.socketDirectory || actual.listenAddresses !== "" || actual.serverAddress !== null) throw new Error("Physical database identity mismatch");
}
export function buildLabEnvironment(owned: OwnedLab, secret: string): Record<string, string> {
  if (secret.length < 32 || secret === "dev-secret-key") throw new Error("A fresh strong ephemeral secret is required");
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin", TMPDIR: owned.directory, LANG: "C", LC_ALL: "C", TZ: "UTC",
    NODE_ENV: "development", DOTENV_CONFIG_PATH: "/dev/null", CI: "1", NO_COLOR: "1",
    DATABASE_URL: `postgres:///${owned.database}`, PGHOST: owned.socketDirectory, PGPORT: String(owned.port), PGUSER: owned.user, PGPASSWORD: "lab-local-socket-only",
    AUTH_PROVIDER: "legacy", VITE_AUTH_PROVIDER: "legacy", VITE_APP_ID: "ed-pilot-local-lab", JWT_SECRET: secret,
    OAUTH_SERVER_URL: "http://127.0.0.1:1", OWNER_OPEN_ID: "unused-lab-owner", SESSION_COOKIE_SAMESITE: "strict", TENANT_STRICT: "1",
  };
}
export function sanitizeLabHtml(html: string): string {
  return html.replace(/<link\b[^>]*href=["']https?:\/\/[^>]*>/gi, "").replace(/<script\b[^>]*src=["'][^"']*(?:VITE_ANALYTICS|\/umami)[^>]*>[\s\S]*?<\/script>/gi, "");
}
export async function verifyOwnedDatabase(raw: Sql, owned: OwnedLab): Promise<PhysicalIdentity> {
  const transport = { path: raw.options.path, database: raw.options.database, user: raw.options.user, port: Number(raw.options.port[0]) };
  assertOwnedTransport(owned, transport);
  const rows = await raw<PhysicalIdentity[]>`SELECT current_database() AS database, current_user AS "user", current_setting('data_directory') AS "dataDirectory", current_setting('unix_socket_directories') AS "socketDirectory", current_setting('listen_addresses') AS "listenAddresses", inet_server_addr()::text AS "serverAddress"`;
  const actual = rows[0];
  if (!actual) throw new Error("No physical database identity returned");
  assertOwnedConnection(owned, transport, actual);
  return actual;
}

/** Fixture provisioning only, never mounted as a business endpoint. */
export async function provisionFixture(db: PostgresJsDatabase, raw: Sql, owned: OwnedLab, selection: LabSelection) {
  await verifyOwnedDatabase(raw, owned);
  const expected = createFixtureRows(selection);
  const result = await db.transaction(async tx => {
    await tx.execute(drizzleSql`SELECT pg_advisory_xact_lock(20260918, 1212)`);
    const [[tenant], [profile], [client], [project], [draft]] = await Promise.all([
      tx.select().from(tenants).where(eq(tenants.id, expected.tenant.id)), tx.select().from(profiles).where(eq(profiles.id, expected.profile.id)),
      tx.select().from(clients).where(eq(clients.id, expected.client.id)), tx.select().from(projects).where(eq(projects.id, expected.project.id)), tx.select().from(estimateDrafts).where(eq(estimateDrafts.id, expected.draft.id)),
    ]);
    const existing = [tenant, profile, client, project, draft];
    const records = [expected.tenant, expected.profile, expected.client, expected.project, expected.draft];
    if (existing.some(Boolean)) {
      if (!existing.every(Boolean)) throw new Error("Partial fixture identity found; refusing repair or duplication");
      existing.forEach((row, index) => {
        for (const [key, value] of Object.entries(records[index])) if (!row || !isDeepStrictEqual(Reflect.get(row, key), value)) throw new Error(`Existing fixture mismatch in record ${index}, field ${key}`);
      });
      return { created: false };
    }
    await tx.insert(tenants).values(expected.tenant);
    await tx.insert(profiles).values(expected.profile);
    await tx.insert(clients).values(expected.client);
    await tx.insert(projects).values(expected.project);
    await tx.insert(estimateDrafts).values(expected.draft);
    // All fixture records and their lab provenance commit or roll back together.
    await tx.insert(auditLogs).values(records.map((record, index) => ({ userId: expected.profile.id, action: "lab.fixture.insert", tableName: ["tenants", "profiles", "clients", "projects", "estimate_drafts"][index], recordId: record.id, oldValues: null, newValues: { labOnly: true, fixtureHash: expected.fingerprint } })));
    return { created: true };
  });
  // Also require observable success from the existing application audit API.
  // That API is not transaction-aware; do not claim otherwise.
  const { logAudit } = await import("../audit");
  const audit = await logAudit({ userId: expected.profile.id, action: result.created ? "lab.fixture.provisioned" : "lab.fixture.verified", tableName: "estimate_drafts", recordId: expected.draft.id, before: null, after: { labOnly: true, fixtureHash: expected.fingerprint } });
  if (!audit) throw new Error("Application audit was not persisted; lab verification failed");
  return { ...result, ...expected, auditId: audit.id };
}
