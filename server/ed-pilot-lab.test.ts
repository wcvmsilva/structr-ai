import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { is } from "drizzle-orm";
import { getTableConfig, integer, pgTable, PgTable } from "drizzle-orm/pg-core";
import * as productionSchema from "../drizzle/schema";
import { isStrictTenantMode } from "./tenant-scope";
import { assertOwnedConnection, buildLabEnvironment, createFixtureRows, sanitizeLabHtml, schemaForLabDdl, validateSelection } from "./test-support/ed-pilot-lab";

// Read the same wholly invented selection used by the public lab launcher.
export function syntheticSelection() {
  return JSON.parse(readFileSync(new URL("../scripts/ed-pilot-lab/selection.synthetic.json", import.meta.url), "utf8"));
}

const owned = { directory: "/private/tmp/ed-pilot-test", dataDirectory: "/private/tmp/ed-pilot-test/data", socketDirectory: "/private/tmp/ed-pilot-test/sock", database: "postgres", user: "ed_pilot_lab", port: 5432 };
const connection = { database: "postgres", user: "ed_pilot_lab", dataDirectory: owned.dataDirectory, socketDirectory: owned.socketDirectory, listenAddresses: "", serverAddress: null };
const transport = { path: `${owned.socketDirectory}/.s.PGSQL.5432`, database: "postgres", user: "ed_pilot_lab", port: 5432 };

describe("isolated pilot fixture contract", () => {
  it("removes only table aliases while preserving table identity and unrelated exports", () => {
    const callback = () => "unchanged";
    const input = { profiles: productionSchema.profiles, users: productionSchema.users, projects: productionSchema.projects, first: callback, second: callback, count: 1, otherCount: 1 };
    const result = schemaForLabDdl(input);
    expect(Object.keys(result)).toEqual(["profiles", "projects", "first", "second", "count", "otherCount"]);
    expect(result.profiles).toBe(input.profiles);
    expect(result.projects).toBe(input.projects);
    expect(result.first).toBe(callback);
    expect(result.second).toBe(callback);
    expect(input.users).toBe(input.profiles);
    const foreignKey = getTableConfig(productionSchema.projectMembers).foreignKeys.find(key => key.reference().foreignTable === result.profiles);
    expect(foreignKey?.reference().foreignColumns[0]).toBe(productionSchema.profiles.id);
  });
  it("does not hide conflicting distinct table definitions with the same physical name", () => {
    const first = pgTable("collision", { id: integer("id") });
    const second = pgTable("collision", { id: integer("id") });
    expect(Object.values(schemaForLabDdl({ first, second }))).toEqual([first, second]);
  });
  it("generates the real private schema snapshot with each table and profile index once", async () => {
    const prepared = schemaForLabDdl(productionSchema);
    const { generateDrizzleJson } = await import("drizzle-kit/api");
    const snapshot = generateDrizzleJson(prepared);
    const uniqueTables = new Set(Object.values(productionSchema).filter(value => is(value, PgTable)));
    expect(Object.keys(snapshot.tables)).toHaveLength(uniqueTables.size);
    expect(Object.keys(snapshot.tables["public.profiles"].indexes).sort()).toEqual(["idx_profiles_email", "idx_profiles_tenant", "uq_profiles_external_open_id", "uq_profiles_tenant_identity"]);
    expect(snapshot.tables["public.project_members"].foreignKeys).toEqual(expect.objectContaining({ project_members_user_id_profiles_id_fk: expect.objectContaining({ tableTo: "profiles", columnsTo: ["id"] }) }));
  });
  it("reconciles the public synthetic selection without treating deferred scope as approved", () => {
    const selection = validateSelection(syntheticSelection());
    expect(selection.pilot.approvedTotal).toBe("1200.00");
    expect(selection.approvedPhase1.lines.reduce((sum, line) => sum + Number(line.extendedCost), 0)).toBe(900);
    expect(selection.approvedPhase1.lines.reduce((sum, line) => sum + Number(line.extendedPrice), 0)).toBe(1200);
    expect(Number(selection.originalCompleteProposal.total) - Number(selection.deferredPhase2.originalProposalReferencePrice)).toBe(1200);
    expect(selection.deferredPhase2.includedInApprovedPhase1).toBe(false);
    expect(createFixtureRows(selection).draft.metadata.sourceSelection).toEqual(selection);
  });
  it("accepts the selected four lines and preserves unknown business decisions", () => {
    expect(() => validateSelection(syntheticSelection())).not.toThrow();
    const selection = validateSelection(syntheticSelection());
    expect(selection.customer.taxRate).toBeNull();
    expect(selection.approvedPhase1.lines.map(line => line.costType)).toEqual([null, null, null, null]);
  });
  it.each(["unitPrice", "extendedPrice", "extendedCost"])("rejects inconsistent %s without accepting rounded corrections", field => {
    const selection = syntheticSelection();
    Object.assign(selection.approvedPhase1.lines[0], { [field]: "161.00" });
    expect(() => validateSelection(selection)).toThrow(/reconcile|snapshot/i);
  });
  it("rejects duplicated source identities even when names legitimately repeat", () => {
    const selection = syntheticSelection();
    selection.approvedPhase1.lines[1].id = "sample-1";
    expect(() => validateSelection(selection)).toThrow(/identity/i);
  });
  it.each([
    { change: { customer: { taxRate: "0.07" } }, path: ["customer", "taxRate"] },
    { change: { recordPlan: { estimateStatus: "approved" } }, path: ["recordPlan", "estimateStatus"] },
    { change: { pilot: { initialOperatorCount: 2 } }, path: ["pilot", "initialOperatorCount"] },
    { change: { deferredPhase2: { includedInApprovedPhase1: true } }, path: ["deferredPhase2", "includedInApprovedPhase1"] },
  ])("rejects the specific unauthorized boundary: $path", ({ change, path }) => {
    const selection = syntheticSelection();
    for (const [key, value] of Object.entries(change)) Object.assign(Reflect.get(selection, key), value);
    let failure: unknown;
    try { validateSelection(selection); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ZodError);
    expect(failure).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path })]) });
  });
  it("constructs exact prices, display totals, flags, codes and source IDs without internal approval", () => {
    const rows = createFixtureRows(validateSelection(syntheticSelection()));
    expect(rows.draft).toMatchObject({ status: "draft", subtotalCost: "900.00", finalTotalPrice: "1200.00", grossProfit: "300.00", grossProfitPct: "25.00", approvedBy: null, approvedAt: null, lockedAt: null, channel: null, commercialChannel: null, zone: null });
    expect(rows.lines.map(line => line.lineTotalPrice)).toEqual(["160.00", "440.00", "240.00", "360.00"]);
    expect(rows.lines.map(line => line.taxable)).toEqual([true, false, true, false]);
    expect(rows.lines.map(line => line.costCode)).toEqual(["SYN-M01", "SYN-L02", "SYN-M01", "SYN-L02"]);
    expect(rows.lines.map(line => line.sourceLineId)).toEqual(["sample-1", "sample-2", "sample-3", "sample-4"]);
    expect(rows.client.tenantId).toBe(rows.tenant.id);
    expect(rows.project.ownerUserId).toBe(rows.profile.id);
    expect(rows.draft.projectId).toBe(rows.project.id);
  });
  it("reuses deterministic identities for the same immutable selection", () => {
    expect(createFixtureRows(validateSelection(syntheticSelection()))).toEqual(createFixtureRows(validateSelection(syntheticSelection())));
  });
  it("isolates server env, dotenv, Vite settings and dangerous inherited Node options", () => {
    const env = buildLabEnvironment(owned, "test-secret-".repeat(6));
    expect(env).toMatchObject({ DATABASE_URL: "postgres:///postgres", PGHOST: owned.socketDirectory, PGUSER: "ed_pilot_lab", AUTH_PROVIDER: "legacy", VITE_AUTH_PROVIDER: "legacy", DOTENV_CONFIG_PATH: "/dev/null" });
    expect(Object.keys(env).some(key => /FORGE|SUPABASE|ANALYTICS|NODE_OPTIONS|PROXY|PGSERVICE|PGPASSFILE/.test(key))).toBe(false);
    expect(env.JWT_SECRET).not.toBe("dev-secret-key");
    expect(env).not.toHaveProperty("HOME");
  });
  it("enables strict tenancy through the actual application's environment parser", () => {
    const env = buildLabEnvironment(owned, "test-secret-".repeat(6));
    expect(isStrictTenantMode(env)).toBe(true);
  });
  it("rejects an unsafe or missing ephemeral session secret", () => {
    expect(() => buildLabEnvironment(owned, "dev-secret-key")).toThrow(/secret/i);
    expect(() => buildLabEnvironment(owned, "")).toThrow(/secret/i);
  });
  it("accepts only the explicitly owned physical database and Unix transport", () => {
    expect(() => assertOwnedConnection(owned, transport, connection)).not.toThrow();
  });
  it.each([
    { dataDirectory: "/other/database" }, { socketDirectory: "/other/socket" }, { database: "customer_db" }, { user: "production" }, { listenAddresses: "localhost" }, { serverAddress: "127.0.0.1" },
  ])("rejects a physical identity mismatch before any write: %j", change => {
    expect(() => assertOwnedConnection(owned, transport, { ...connection, ...change })).toThrow(/identity/i);
  });
  it("rejects a URL-query socket imitation when client transport is TCP", () => {
    expect(() => assertOwnedConnection(owned, { ...transport, path: undefined }, connection)).toThrow(/transport/i);
  });
  it("removes external fonts and analytics only from lab-served HTML", () => {
    const source = '<html><head><link rel="preconnect" href="https://fonts.example"><link href="https://fonts.example/style"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script><script defer src="%VITE_ANALYTICS_ENDPOINT%/umami" data-website-id="%VITE_ANALYTICS_WEBSITE_ID%"></script></body></html>';
    const html = sanitizeLabHtml(source);
    expect(html).not.toMatch(/fonts\.example|ANALYTICS|umami/);
    expect(html).toContain('src="/src/main.tsx"');
    expect(source).toContain("fonts.example");
  });
});
