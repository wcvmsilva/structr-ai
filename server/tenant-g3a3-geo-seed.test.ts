/**
 * G3a-3: execute the actual operational entry and actual geo-db implementation.
 * Only external/runtime boundaries are replaced. The stateful SQL double applies
 * exactly the predicates production emits; an absent tenant predicate stays absent.
 * Its permissive legacy path intentionally accepts old schema-incompatible writes,
 * so baseline security failures cannot be mistaken for missing-column failures.
 * PostgreSQL/schema/loader evidence belongs to the separate opt-in integration proof.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const boundary = vi.hoisted(() => ({ driver: null as any }));
vi.mock("dotenv", () => ({ default: { config: () => {
  boundary.driver.events.push("dotenv"); return { parsed: {} };
} } }));
vi.mock("postgres", () => ({ default: () => boundary.driver.openClient() }));
vi.mock("./db", () => ({
  getDb: async () => boundary.driver.getDb(),
  getRawClient: () => boundary.driver.client,
}));
vi.mock("./audit", () => ({ logAudit: async (params: unknown) => boundary.driver.audit(params) }));
vi.mock("tsx/esm/api", () => ({ register: (options: unknown) => boundary.driver.register(options) }));

const TENANT_A = "a3000000-0000-4000-8000-00000000000a";
const TENANT_B = "a3000000-0000-4000-8000-00000000000b";
const UNKNOWN_TENANT = "a3000000-0000-4000-8000-00000000000c";
const entryPath = fileURLToPath(new URL("../scripts/seed-geo-zones.mjs", import.meta.url));
const tsconfigPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
type Row = Record<string, any>;
type Statement = { operation: string; table: string; sql?: string; params?: unknown[]; depth: number; lock?: string };

// Independent, hand-checked expected persisted values. Never derived from seed source
// or CHARLESTON_ZONES (whose descriptions and coastal ZIP multiplicity differ).
const EXPECTED = [
  { name: "Barrier Island Premium", zoneName: "Barrier Island Premium", county: "Charleston",
    zipCodes: ["29455", "29439", "29482", "29451", "29438"], centerLat: 32.6083, centerLng: -79.9581,
    radiusMiles: "12", coastalExposureLevel: "extreme", logisticsComplexity: "extreme",
    laborModifier: "1.25", logisticsModifier: "1.4", materialModifier: "1.3", contingencyPct: "5", minProfitShieldPct: "50",
    description: "Barrier Island Premium — Charleston County. Coastal: extreme, Logistics: extreme. Includes Kiawah, Seabrook, Folly Beach, Isle of Palms, Sullivan's Island.", isActive: true },
  { name: "Charleston Coastal", zoneName: "Charleston Coastal", county: "Charleston",
    zipCodes: ["29412", "29422", "29492", "29464", "29403"], centerLat: 32.7546, centerLng: -79.9748,
    radiusMiles: "15", coastalExposureLevel: "high", logisticsComplexity: "complex",
    laborModifier: "1.15", logisticsModifier: "1.2", materialModifier: "1.15", contingencyPct: "3", minProfitShieldPct: "42",
    description: "Charleston Coastal — Charleston County. Coastal: high, Logistics: complex. Includes James Island, Mt. Pleasant, West Ashley coastal areas.", isActive: true },
  { name: "Charleston Metro", zoneName: "Charleston Metro", county: "Charleston",
    zipCodes: ["29407", "29414", "29418", "29405", "29406", "29409", "29401", "29403", "29464", "29466"],
    centerLat: 32.7765, centerLng: -79.9311, radiusMiles: "20", coastalExposureLevel: "moderate", logisticsComplexity: "standard",
    laborModifier: "1.05", logisticsModifier: "1", materialModifier: "1.05", contingencyPct: "0", minProfitShieldPct: "35",
    description: "Charleston Metro — Charleston County. Coastal: moderate, Logistics: standard. Default zone for Charleston area projects.", isActive: true },
  { name: "Summerville / Goose Creek", zoneName: "Summerville / Goose Creek", county: "Berkeley / Dorchester",
    zipCodes: ["29483", "29485", "29486", "29445", "29456", "29461", "29470", "29472"], centerLat: 33.0185, centerLng: -80.1756,
    radiusMiles: "18", coastalExposureLevel: "none", logisticsComplexity: "standard",
    laborModifier: "1", logisticsModifier: "0.95", materialModifier: "1", contingencyPct: "0", minProfitShieldPct: "32",
    description: "Summerville / Goose Creek — Berkeley/Dorchester County. Coastal: none, Logistics: standard. Inland suburban zone.", isActive: true },
  { name: "Outer Lowcountry", zoneName: "Outer Lowcountry", county: "Colleton / Dorchester",
    zipCodes: ["29488", "29474", "29477", "29479", "29481", "29440", "29426", "29431"], centerLat: 32.8954, centerLng: -80.3421,
    radiusMiles: "30", coastalExposureLevel: "low", logisticsComplexity: "moderate",
    laborModifier: "1.05", logisticsModifier: "1.05", materialModifier: "1", contingencyPct: "2", minProfitShieldPct: "35",
    description: "Outer Lowcountry — Colleton/Dorchester County. Coastal: low, Logistics: moderate. Rural and semi-rural areas.", isActive: true },
];
const clone = <T>(value: T): T => structuredClone(value);
const camel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function completeRow(data: Row, tenantId: string | null, id: string): Row {
  return { id, name: null, zoneName: null, tenantId, description: null, boundaryGeojson: null,
    costMultiplier: "1.0", county: null, zipCodes: null, centerLat: null, centerLng: null,
    radiusMiles: null, coastalExposureLevel: null, laborModifier: null, materialModifier: null,
    logisticsModifier: null, logisticsComplexity: null, contingencyPct: null, minProfitShieldPct: null,
    isActive: true, validatedFloorPct: null, validatedAt: null, validationSampleCount: 0,
    createdAt: new Date("2026-09-15T12:00:00Z"), updatedAt: new Date("2026-09-15T12:00:00Z"), ...clone(data) };
}

/** Tiny SQL expression interpreter, including OR/IS NULL to expose transitional leaks. */
function matches(row: Row, expression: string | undefined, params: unknown[]): boolean {
  if (!expression) return true;
  const tokens = expression.match(/"[^"]+"(?:\."[^"]+")?|\$\d+|\(|\)|=|\b(?:and|or|is|null|true|false)\b/gi) ?? [];
  const residue = expression.replace(/"[^"]+"(?:\."[^"]+")?|\$\d+|\(|\)|=|\b(?:and|or|is|null|true|false)\b|\s/gi, "");
  if (residue) throw new Error(`Harness cannot interpret SQL predicate: ${expression}`);
  let position = 0;
  const take = () => tokens[position++];
  const primary = (): boolean => {
    if (tokens[position] === "(") { take(); const answer = disjunction(); if (take() !== ")") throw new Error("Unbalanced SQL"); return answer; }
    const column = take();
    if (/^(true|false)$/i.test(column)) return column.toLowerCase() === "true";
    const key = camel(column.split(".").at(-1)!.replaceAll('"', ""));
    const operator = take()?.toLowerCase();
    if (operator === "is" && take()?.toLowerCase() === "null") return row[key] == null;
    if (operator !== "=") throw new Error(`Harness cannot interpret operator ${operator}`);
    const placeholder = take();
    if (!/^\$\d+$/.test(placeholder)) throw new Error(`Harness cannot interpret value ${placeholder}`);
    // SQL NULL equality is never true, matching the WHERE result relevant here.
    return row[key] != null && row[key] === params[Number(placeholder.slice(1)) - 1];
  };
  const conjunction = (): boolean => { let answer = primary(); while (tokens[position]?.toLowerCase() === "and") { take(); const right = primary(); answer = answer && right; } return answer; };
  const disjunction = (): boolean => { let answer = conjunction(); while (tokens[position]?.toLowerCase() === "or") { take(); const right = conjunction(); answer = answer || right; } return answer; };
  const answer = disjunction();
  if (position !== tokens.length) throw new Error(`Harness left SQL tokens: ${expression}`);
  return answer;
}

function makeDriver() {
  const d = {
    zones: [] as Row[], staged: null as Row[] | null, prices: [] as Row[],
    tenants: [{ id: TENANT_A }, { id: TENANT_B }] as Row[],
    statements: [] as Statement[], events: [] as string[], audits: [] as Row[],
    auditPersistence: [] as Row[], auditMode: "success" as "success" | "null" | "throw",
    client: null as any, clientsCreated: 0, endCalls: 0, unregisterCalls: 0, getDbCalls: 0,
    transactions: 0, depth: 0, maxDepth: 0, insertAttempts: 0, readbacks: 0,
    failInsert: 0, failReadback: 0, foreignReadback: 0, wrongTenantLookup: false,
    dbUnavailable: false, failImport: "" as "" | "db" | "geo", failEnd: false, failUnregister: false,
    registerOptions: [] as any[], imports: [] as string[],
    openClient() {
      this.clientsCreated++; this.events.push("client:open");
      const sql: any = async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.reduce((result, part, i) => result + part + (i < values.length ? `$${i + 1}` : ""), "");
        const normalized = text.replace(/\s+/g, " ").trim();
        const table = /(?:FROM|INTO)\s+([a-z_]+)/i.exec(normalized)?.[1];
        if (!table) throw new Error(`Unsupported legacy SQL: ${text}`);
        const operation = /^SELECT/i.test(normalized) ? "select" : "insert";
        this.statements.push({ operation, table, sql: normalized, params: values, depth: this.depth });
        this.events.push(`${operation}:${table}`);
        if (operation === "select") {
          const rows = table === "geo_zones" ? this.zones : this.prices;
          const key = /WHERE\s+([a-z_]+)\s*=/i.exec(normalized)?.[1];
          return rows.filter(row => !key || row[camel(key)] === values[0]).map(row => ({ id: row.id }));
        }
        const columns = /\(([^)]+)\)\s*VALUES/i.exec(normalized)?.[1].split(",").map(v => v.trim());
        if (!columns) throw new Error(`Unsupported legacy INSERT: ${text}`);
        const data = Object.fromEntries(columns.map((column, i) => [camel(column), values[i]]));
        if (table === "geo_zones") {
          this.insertAttempts++;
          if (this.failInsert === this.insertAttempts) throw new Error("Injected geo insert failure");
          this.zones.push(completeRow(data, null, `raw-${this.insertAttempts}`));
        } else this.prices.push({ id: `price-${this.prices.length + 1}`, ...data });
        return [];
      };
      sql.end = async () => { this.endCalls++; this.events.push("client:end"); if (this.failEnd) throw new Error("Injected close failure"); };
      this.client = sql; return sql;
    },
    getDb() {
      this.getDbCalls++;
      if (this.dbUnavailable) return null;
      if (!this.client) this.openClient();
      return handle;
    },
    async audit(params: Row) {
      this.events.push("audit"); this.audits.push(clone(params));
      if (this.depth) throw new Error("Audit attempted before business commit");
      if (this.auditMode === "throw") throw new Error("Injected audit failure after commit");
      if (this.auditMode === "null") return null;
      const row = { id: `audit-${this.audits.length}`, ...clone(params) };
      this.auditPersistence.push(row); return row;
    },
    register(options: unknown) {
      this.events.push("register"); this.registerOptions.push(options);
      const unregister: any = async () => {
        this.unregisterCalls++; this.events.push("unregister");
        if (this.failUnregister) throw new Error("Injected unregister failure");
      };
      unregister.unregister = unregister;
      unregister.import = async (specifier: string) => {
        this.imports.push(specifier);
        if (/geo-db(?:\.ts)?$/.test(specifier)) {
          if (this.failImport === "geo") throw new Error("Injected geo module import failure");
          return import("./geo-db");
        }
        if (/\bdb(?:\.ts)?$/.test(specifier)) {
          if (this.failImport === "db") throw new Error("Injected db module import failure");
          return { getDb: async () => this.getDb(), getRawClient: () => this.client };
        }
        throw new Error(`Unexpected scoped import: ${specifier}`);
      };
      return unregister;
    },
  };
  const makeChain = (operation: "select" | "insert", initialTable?: unknown, projection?: Row) => {
    let table = initialTable ? getTableName(initialTable as any) : "";
    let condition: SQL | undefined; let values: Row = {}; let limit = Infinity; let lock: string | undefined;
    let returning: Row | undefined;
    const chain: any = {
      from(value: unknown) { table = getTableName(value as any); return chain; },
      where(value: SQL) { condition = value; return chain; },
      values(value: Row) { values = clone(value); return chain; },
      limit(value: number) { limit = value; return chain; },
      for(value: string) { lock = value; return chain; },
      returning(value?: Row) { returning = value; return chain; },
      then(resolve: (value: Row[]) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          const query = condition ? new PgDialect().sqlToQuery(condition) : { sql: "", params: [] };
          d.statements.push({ operation, table, sql: query.sql, params: query.params, depth: d.depth, lock });
          d.events.push(`${operation}:${table}`);
          if (operation === "select") {
            const isReadback = table === "geo_zones" && /"geo_zones"\."id"\s*=/.test(query.sql);
            if (isReadback) {
              d.readbacks++;
              if (d.failReadback === d.readbacks) return [];
              if (d.foreignReadback === d.readbacks) return [completeRow(EXPECTED[0], TENANT_B, "foreign-readback")];
            }
            if (table === "tenants" && d.wrongTenantLookup) return [{ id: TENANT_B }];
            const rows = table === "tenants" ? d.tenants : (d.staged ?? d.zones);
            return rows.filter(row => matches(row, query.sql, query.params)).slice(0, limit)
              .map(row => projection ? Object.fromEntries(Object.keys(projection).map(key => [key, row[key]])) : clone(row));
          }
          if (table !== "geo_zones") throw new Error(`Unexpected Drizzle write to ${table}`);
          d.insertAttempts++;
          if (d.failInsert === d.insertAttempts) throw new Error("Injected geo insert failure");
          const row = completeRow(values, values.tenantId ?? null, `new-${d.insertAttempts}`);
          (d.staged ?? d.zones).push(row);
          return [returning ? Object.fromEntries(Object.keys(returning).map(key => [key, row[key]])) : clone(row)];
        }).then(resolve, reject);
      },
    };
    return chain;
  };
  const handle: any = {
    select: (projection?: Row) => makeChain("select", undefined, projection),
    insert: (table: unknown) => makeChain("insert", table),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      d.transactions++; d.depth++; d.maxDepth = Math.max(d.maxDepth, d.depth);
      if (d.depth > 1) throw new Error("Unexpected nested transaction");
      d.events.push("begin"); d.staged = clone(d.zones);
      try { const value = await callback(handle); d.zones = d.staged; d.events.push("commit"); return value; }
      catch (error) { d.events.push("rollback"); throw error; }
      finally { d.staged = null; d.depth--; }
    },
  };
  return d;
}

let driver: ReturnType<typeof makeDriver>;
let messages: string[];
let oldArgv: string[];
let oldExitCode: typeof process.exitCode;
beforeEach(() => {
  vi.resetModules(); driver = makeDriver(); boundary.driver = driver; messages = [];
  oldArgv = process.argv; oldExitCode = process.exitCode; process.exitCode = undefined;
  vi.stubEnv("DATABASE_URL", "postgres://unused.invalid/never-connected");
  vi.stubEnv("SEED_TENANT_ID", TENANT_A);
  vi.stubEnv("DEV_TENANT_ID", TENANT_B);
  for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...args) => {
    messages.push(args.map(value => value instanceof Error ? value.message : String(value)).join(" "));
  });
});
afterEach(() => {
  process.argv = oldArgv; process.exitCode = oldExitCode;
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});
async function invokeEntry(importOnly = false, invokedPath = entryPath) {
  vi.resetModules(); process.exitCode = undefined;
  process.argv = [oldArgv[0], importOnly ? "/private/tmp/not-the-geo-seed.mjs" : invokedPath];
  let error: unknown;
  try { await import("../scripts/seed-geo-zones.mjs"); } catch (caught) { error = caught; }
  return { error, exitCode: process.exitCode, output: messages.join("\n") };
}
function succeeded(result: Awaited<ReturnType<typeof invokeEntry>>) {
  expect(result.error).toBeUndefined(); expect(result.exitCode ?? 0).toBe(0);
}
function failed(result: Awaited<ReturnType<typeof invokeEntry>>, message?: RegExp) {
  expect(Boolean(result.error) || Number(result.exitCode) !== 0 && result.exitCode !== undefined).toBe(true);
  if (message) expect([result.output, String(result.error ?? "")].join("\n")).toMatch(message);
}
function preload(owner: string | null, count = 5) {
  driver.zones.push(...EXPECTED.slice(0, count).map((row, i) => completeRow(row, owner, `${owner ?? "null"}-${i}`)));
}
async function operationalHelper(tenant: unknown, rows: readonly Row[] = EXPECTED) {
  const geo = await import("./geo-db") as unknown as { seedOperationalGeoZones: (owner: unknown, data: readonly Row[]) => Promise<unknown> };
  return geo.seedOperationalGeoZones(tenant, rows);
}

describe("G3a3 cross-version entry controls", () => {
  it("the actual configured entry can execute and persist its five geographic records", async () => {
    succeeded(await invokeEntry());
    expect(driver.zones).toHaveLength(5);
    expect(driver.zones.map(row => row.zoneName)).toEqual([
      "Barrier Island Premium", "Charleston Coastal", "Charleston Metro",
      "Summerville / Goose Creek", "Outer Lowcountry",
    ]);
    expect(driver.clientsCreated).toBe(1); expect(driver.endCalls).toBe(1);
  });
  it("leaves a fully populated own tenant's existing policies and IDs untouched", async () => {
    preload(TENANT_A); driver.zones[2].description = "Existing operator policy";
    const before = clone(driver.zones);
    succeeded(await invokeEntry()); expect(driver.zones).toEqual(before); expect(driver.audits).toEqual([]);
  });
});

describe("G3a3 actual operational entry · explicit owner boundary", () => {
  it.each([undefined, "", "   ", "not-a-uuid", "a3000000-0000-4000-8000", `${TENANT_A}/extra`])("rejects tenant %s before any runtime/client activity", async tenant => {
    vi.stubEnv("SEED_TENANT_ID", tenant);
    const result = await invokeEntry(); failed(result, /SEED_TENANT_ID|tenant/i);
    expect(driver.clientsCreated).toBe(0); expect(driver.registerOptions).toHaveLength(0);
    expect(driver.statements).toHaveLength(0); expect(driver.zones).toHaveLength(0);
  });
  it("does not turn DEV_TENANT_ID into a missing operational owner", async () => {
    vi.stubEnv("SEED_TENANT_ID", undefined); vi.stubEnv("DEV_TENANT_ID", TENANT_A);
    failed(await invokeEntry(), /SEED_TENANT_ID|tenant/i); expect(driver.clientsCreated).toBe(0);
  });
  it("requires a database URL before loading the server graph", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    failed(await invokeEntry(), /DATABASE_URL/); expect(driver.clientsCreated).toBe(0); expect(driver.imports).toHaveLength(0);
  });
  it("canonicalizes an explicitly supplied uppercase and padded UUID", async () => {
    vi.stubEnv("SEED_TENANT_ID", `  ${TENANT_A.toUpperCase()}  `);
    succeeded(await invokeEntry()); expect(driver.zones).toHaveLength(5);
    expect(driver.zones.every(row => row.tenantId === TENANT_A)).toBe(true);
  });
  it("rejects an unknown tenant without provisioning it or any zones", async () => {
    vi.stubEnv("SEED_TENANT_ID", UNKNOWN_TENANT);
    const before = clone(driver.tenants);
    failed(await invokeEntry(), /tenant/i); expect(driver.zones).toHaveLength(0); expect(driver.tenants).toEqual(before);
    expect(driver.audits).toHaveLength(0); expect(driver.endCalls).toBe(1);
  });
  it("fails closed when a tenant lookup returns another tenant", async () => {
    driver.wrongTenantLookup = true;
    failed(await invokeEntry(), /tenant/i); expect(driver.zones).toHaveLength(0); expect(driver.audits).toHaveLength(0);
  });
  it("performs tenant existence and every geo statement inside one transaction", async () => {
    succeeded(await invokeEntry());
    expect(driver.transactions).toBe(1); expect(driver.maxDepth).toBe(1);
    const first = driver.statements[0];
    expect(first).toMatchObject({ operation: "select", table: "tenants", depth: 1, lock: "key share", params: [TENANT_A] });
    expect(driver.statements.filter(s => s.table === "geo_zones").every(s => s.depth === 1)).toBe(true);
  });
});

describe("G3a3 actual operational entry · isolated persisted state", () => {
  it.each([TENANT_B, null])("creates all five for A despite complete name collisions under %s", async owner => {
    preload(owner); const before = clone(driver.zones);
    succeeded(await invokeEntry());
    expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(5);
    expect(driver.zones.filter(row => row.tenantId !== TENANT_A)).toEqual(before);
    expect(messages.join("\n")).not.toContain(owner ?? "null-");
  });
  it("preserves mixed B and NULL rows while creating A's complete dataset", async () => {
    preload(TENANT_B); preload(null); const before = clone(driver.zones);
    succeeded(await invokeEntry());
    expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(5);
    expect(driver.zones.filter(row => row.tenantId !== TENANT_A)).toEqual(before);
  });
  it("persists all five legacy descriptions, policy values, ZIP sequences and required names", async () => {
    succeeded(await invokeEntry()); expect(driver.zones).toHaveLength(5);
    for (let i = 0; i < EXPECTED.length; i++) expect(driver.zones[i]).toMatchObject({ ...EXPECTED[i], tenantId: TENANT_A });
    expect(driver.zones[1].zipCodes).toHaveLength(5);
  });
  it("skips only existing own names and preserves their edited policy without overwrite", async () => {
    preload(TENANT_A, 2); driver.zones[0].laborModifier = "9.99"; driver.zones[0].description = "Operator's existing policy";
    preload(TENANT_B); const before = clone(driver.zones);
    succeeded(await invokeEntry());
    expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(5);
    expect(driver.zones.filter(row => before.some(old => old.id === row.id))).toEqual(before);
    expect(driver.audits).toHaveLength(3);
  });
  it("a serial repeat creates no rows and emits no additional creation audits", async () => {
    succeeded(await invokeEntry()); const before = clone(driver.zones); const auditCount = driver.audits.length;
    succeeded(await invokeEntry()); expect(driver.zones).toEqual(before); expect(driver.audits).toHaveLength(auditCount);
    expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(5);
  });
  it("never queries or writes the coastal price book", async () => {
    succeeded(await invokeEntry()); expect(driver.statements.filter(s => s.table === "price_book_items")).toEqual([]);
    expect(driver.prices).toHaveLength(0);
  });
  it("retains unrelated tenant/NULL rows when an insert fails midway", async () => {
    preload(TENANT_B); preload(null); const before = clone(driver.zones); driver.failInsert = 3;
    failed(await invokeEntry(), /insert failure/i); expect(driver.zones).toEqual(before);
    expect(driver.audits).toHaveLength(0); expect(driver.events).toContain("rollback"); expect(driver.endCalls).toBe(1);
  });
  it.each(["missing", "foreign"])("rolls back every new row when inserted-row readback is %s", async mode => {
    if (mode === "missing") driver.failReadback = 3; else driver.foreignReadback = 3;
    failed(await invokeEntry(), /read.?back/i); expect(driver.zones).toEqual([]); expect(driver.audits).toHaveLength(0);
    expect(driver.events).toContain("rollback");
  });
});

describe("G3a3 actual operational entry · commit, audit and lifecycle", () => {
  it("executes when invoked through an existing filesystem symlink instead of silently succeeding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "structr-g3a3-entry-alias-"));
    try {
      const alias = join(directory, "seed-geo-zones.mjs");
      await symlink(entryPath, alias);
      succeeded(await invokeEntry(false, alias));
      expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(5);
      expect(driver.endCalls).toBe(1); expect(driver.unregisterCalls).toBe(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("audits exactly the committed rows with explicit ownership after commit", async () => {
    succeeded(await invokeEntry()); expect(driver.audits).toHaveLength(5);
    expect(driver.events.indexOf("commit")).toBeLessThan(driver.events.indexOf("audit"));
    for (let i = 0; i < 5; i++) expect(driver.audits[i]).toEqual({
      userId: null, action: "geo_zone.create", tableName: "geo_zones", recordId: driver.zones[i].id, after: driver.zones[i],
    });
    expect(driver.auditPersistence).toHaveLength(5);
  });
  it("reports unconfirmed audit persistence as failure while retaining committed zones", async () => {
    driver.auditMode = "null";
    failed(await invokeEntry(), /audit/i); expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(5);
    expect(driver.audits).toHaveLength(5); expect(driver.auditPersistence).toHaveLength(0);
    expect(messages.join("\n")).toMatch(/commit/i); expect(driver.events).not.toContain("rollback");
    expect(driver.endCalls).toBe(1); expect(driver.unregisterCalls).toBe(1);
  });
  it("a thrown postcommit audit error does not claim rollback and still closes resources", async () => {
    driver.auditMode = "throw";
    failed(await invokeEntry(), /audit failure/i); expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(5);
    expect(driver.events).toContain("commit"); expect(driver.events).not.toContain("rollback");
    expect(driver.endCalls).toBe(1); expect(driver.unregisterCalls).toBe(1);
  });
  it("treats an unavailable DB as an error, then unregisters its runtime", async () => {
    driver.dbUnavailable = true;
    failed(await invokeEntry(), /database|\bdb\b/i); expect(driver.zones).toHaveLength(0);
    expect(driver.unregisterCalls).toBe(1); expect(driver.clientsCreated).toBe(0);
  });
  it.each(["db", "geo"] as const)("unregisters after partial %s module loading fails", async module => {
    driver.failImport = module;
    failed(await invokeEntry(), /module import failure/i); expect(driver.unregisterCalls).toBe(1);
    expect(driver.zones).toHaveLength(0); expect(driver.clientsCreated).toBe(0);
  });
  it("closes the shared pool after all audits, then unregisters the same runtime", async () => {
    succeeded(await invokeEntry());
    expect(driver.registerOptions).toHaveLength(1); expect(driver.registerOptions[0]).toMatchObject({ tsconfig: tsconfigPath });
    expect(driver.imports).toHaveLength(2); expect(driver.imports[0]).toMatch(/\bdb\.ts$/); expect(driver.imports[1]).toMatch(/geo-db\.ts$/);
    expect(driver.clientsCreated).toBe(1); expect(driver.endCalls).toBe(1); expect(driver.unregisterCalls).toBe(1);
    expect(driver.events.lastIndexOf("audit")).toBeLessThan(driver.events.indexOf("client:end"));
    expect(driver.events.indexOf("client:end")).toBeLessThan(driver.events.indexOf("unregister"));
  });
  it("unregisters even if pool shutdown rejects and returns failure", async () => {
    driver.failEnd = true;
    failed(await invokeEntry(), /close failure/i); expect(driver.unregisterCalls).toBe(1);
    expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(5);
  });
  it("reports unregister failure after closing the pool", async () => {
    driver.failUnregister = true;
    failed(await invokeEntry(), /unregister failure/i); expect(driver.endCalls).toBe(1); expect(driver.unregisterCalls).toBe(1);
  });
  it("preserves the operation failure when shutdown also fails", async () => {
    driver.failInsert = 3; driver.failEnd = true;
    const result = await invokeEntry(); failed(result, /insert failure/i);
    expect(driver.zones).toEqual([]); expect(driver.unregisterCalls).toBe(1);
    expect(`${result.output}\n${String(result.error ?? "")}`).toMatch(/close failure/i);
  });
  it("importing the module does not load dotenv, runtime, DB or run the seed", async () => {
    succeeded(await invokeEntry(true)); expect(driver.events).toEqual([]); expect(driver.statements).toEqual([]);
    expect(driver.zones).toEqual([]); expect(driver.prices).toEqual([]);
  });
});

describe("G3a3 operational helper · direct JS caller defense", () => {
  it.each([undefined, null, 7, {}, "", "  ", "not-a-uuid"])("rejects %s before getDb", async tenant => {
    await expect(operationalHelper(tenant)).rejects.toThrow(/tenant/i);
    expect(driver.getDbCalls).toBe(0); expect(driver.clientsCreated).toBe(0);
  });
  it("stamps the validated owner over a foreign payload owner", async () => {
    const result = await operationalHelper(TENANT_A, [{ ...EXPECTED[0], tenantId: TENANT_B }]);
    expect(result).toEqual({ created: 1, auditUnconfirmed: 0 });
    expect(driver.zones).toHaveLength(1); expect(driver.zones[0].tenantId).toBe(TENANT_A);
  });
  it("rolls back prior inserts if a later zone name is empty", async () => {
    await expect(operationalHelper(TENANT_A, [EXPECTED[0], { ...EXPECTED[1], zoneName: " " }])).rejects.toThrow(/name/i);
    expect(driver.zones).toEqual([]); expect(driver.audits).toEqual([]);
  });
  it("returns the committed count separately from unconfirmed audits", async () => {
    driver.auditMode = "null";
    await expect(operationalHelper(TENANT_A, EXPECTED.slice(0, 2))).resolves.toEqual({ created: 2, auditUnconfirmed: 2 });
    expect(driver.zones.filter(row => row.tenantId === TENANT_A)).toHaveLength(2);
    expect(driver.events).not.toContain("rollback");
  });
});
