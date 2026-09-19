/** R2: real preset route, DB helpers and tenant guards; only driver/audit sinks are isolated. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { bundles, type Bundle } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import type { AuditLogParams } from "./audit";

const TENANT = "90000000-0000-4000-8000-000000000001";
const FOREIGN = "90000000-0000-4000-8000-000000000002";
const BUNDLE = "c0000000-0000-4000-8000-000000000001";
const USER = "a0000000-0000-4000-8000-000000000001";
const date = new Date("2026-09-18T12:00:00.000Z");
const original: Bundle = {
  id: BUNDLE, tenantId: TENANT, name: "Kitchen", description: "before deletion",
  category: "general", bundleDiscount: "0.08", region: "Charleston, SC",
  isActive: true, isCustomizable: true, minItems: 2, maxItems: 20,
  validFrom: null, validUntil: null, notes: null, createdAt: date, updatedAt: date,
};
const driver = {
  row: structuredClone(original) as Bundle | null,
  events: [] as string[],
  predicates: [] as SQL[],
  failWrite: false,
  writeGate: undefined as Promise<void> | undefined,
  writeStarted: () => {},
};
const audit = vi.fn<(params: AuditLogParams) => Promise<{ id: string } | null>>();

const fakeDb = {
  select: () => ({ from: (table: unknown) => ({ where: (where: SQL) => ({ limit: async () => {
    expect(table).toBe(bundles);
    driver.events.push("read");
    driver.predicates.push(where);
    // Intentionally no tenant filtering: the real post-read guard must refuse foreign rows.
    const params = new PgDialect().sqlToQuery(where).params;
    return driver.row && params.includes(driver.row.id) ? [structuredClone(driver.row)] : [];
  } }) }) }),
  update: (table: unknown) => ({ set: (values: Partial<Bundle>) => ({ where: async (where: SQL) => {
    expect(table).toBe(bundles);
    driver.events.push("write-start");
    driver.predicates.push(where);
    driver.writeStarted();
    await driver.writeGate;
    if (driver.failWrite) throw new Error("delete write failed");
    if (driver.row) Object.assign(driver.row, values);
    driver.events.push("write-success");
  } }) }),
};
vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn(() => fakeDb) }));
vi.mock("./audit", () => ({ logAudit: audit }));
// getDb is real, but its driver factory is isolated before the route is imported.
const { presetRouter } = await import("./preset-router");

function caller(options: { tenantId?: string | null; authenticated?: boolean; admin?: boolean } = {}) {
  const tenantId = options.tenantId === undefined ? TENANT : options.tenantId;
  const ctx: TrpcContext = {
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    authProvider: "legacy", tenantId,
    user: options.authenticated === false ? null : {
      id: USER, tenantId, externalOpenId: null, email: "operator@example.test",
      loginMethod: "legacy", fullName: "Operator", companyName: null,
      role: options.admin ? "admin" : "user", isActive: true,
      lastSignedIn: date, createdAt: date, updatedAt: date,
    },
  };
  return presetRouter.createCaller(ctx);
}
function expectNoEffects() {
  expect(driver.row?.isActive).not.toBe(false);
  expect(driver.events).not.toContain("write-start");
  expect(audit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://isolated-driver/preset-audit");
  driver.row = structuredClone(original);
  driver.events = [];
  driver.predicates = [];
  driver.failWrite = false;
  driver.writeGate = undefined;
  driver.writeStarted = () => {};
  audit.mockReset();
  audit.mockImplementation(async () => {
    driver.events.push("audit");
    return { id: "isolated-audit-result" };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe.each(["false", "true"])("preset.delete audit, TENANT_STRICT=%s", strict => {
  beforeEach(() => { vi.stubEnv("TENANT_STRICT", strict); });

  it("records one bundle.delete event with the authorized before value after the write", async () => {
    const before = structuredClone(original);
    await expect(caller().delete({ bundleId: BUNDLE })).resolves.toEqual({ success: true });
    expect(driver.row?.isActive).toBe(false);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({
      userId: USER, action: "bundle.delete", tableName: "bundles", recordId: BUNDLE,
      before, after: { isActive: false },
    });
    expect(driver.events).toEqual(["read", "read", "write-start", "write-success", "audit"]);
    expect(audit.mock.calls[0][0].before).toEqual(before);
    for (const predicate of driver.predicates) {
      const query = new PgDialect().sqlToQuery(predicate);
      expect(query.params).toContain(TENANT);
      expect(query.params).toContain(BUNDLE);
      expect(query.params).not.toContain(FOREIGN);
    }
  });

  it("rejects malformed UUID before business reads or audit", async () => {
    await expect(caller().delete({ bundleId: "invalid" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(driver.events).toEqual([]);
    expectNoEffects();
  });

  it("rejects an unauthenticated caller before business reads or audit", async () => {
    await expect(caller({ authenticated: false }).delete({ bundleId: BUNDLE })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(driver.events).toEqual([]);
    expectNoEffects();
  });

  it.each([false, true])("rejects unresolved caller tenant even when admin=%s", async admin => {
    await expect(caller({ tenantId: null, admin }).delete({ bundleId: BUNDLE })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(driver.events).toEqual([]);
    expectNoEffects();
  });

  it("preserves NOT_FOUND for a missing bundle and attempts no audit", async () => {
    driver.row = null;
    await expect(caller().delete({ bundleId: BUNDLE })).rejects.toMatchObject({ code: "NOT_FOUND", message: `Bundle ${BUNDLE} not found` });
    expectNoEffects();
  });

  it("preserves NOT_FOUND for a foreign row returned by the permissive driver", async () => {
    driver.row = { ...original, tenantId: FOREIGN };
    await expect(caller().delete({ bundleId: BUNDLE })).rejects.toMatchObject({ code: "NOT_FOUND", message: `Bundle ${BUNDLE} not found` });
    expectNoEffects();
  });

  it("propagates failed deletion without attempting an audit", async () => {
    driver.failWrite = true;
    await expect(caller().delete({ bundleId: BUNDLE })).rejects.toThrow("delete write failed");
    expect(driver.events).toEqual(["read", "read", "write-start"]);
    expect(driver.row).toEqual(original);
    expect(audit).not.toHaveBeenCalled();
  });

  it("keeps a successful deletion when the audit sink returns null", async () => {
    audit.mockResolvedValue(null);
    await expect(caller().delete({ bundleId: BUNDLE })).resolves.toEqual({ success: true });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(driver.row?.isActive).toBe(false);
  });

  it("handles an unexpected audit rejection locally after successful deletion", async () => {
    const failure = new Error("audit connection unavailable");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    audit.mockRejectedValue(failure);
    await expect(caller().delete({ bundleId: BUNDLE })).resolves.toEqual({ success: true });
    // Let rejection handlers run; an unhandled rejection also fails the Vitest process.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(audit).toHaveBeenCalledTimes(1);
    expect(driver.row?.isActive).toBe(false);
    expect(report).toHaveBeenCalledWith(expect.any(String), failure);
  });
});

it("preserves legacy null-tenant mutation and audit while strict mode is off", async () => {
  vi.stubEnv("TENANT_STRICT", "false");
  driver.row = { ...original, tenantId: null };
  await expect(caller().delete({ bundleId: BUNDLE })).resolves.toEqual({ success: true });
  expect(driver.row?.isActive).toBe(false);
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0].before).toEqual({ ...original, tenantId: null });
});

it("refuses legacy null-tenant mutation and audit while strict mode is on", async () => {
  vi.stubEnv("TENANT_STRICT", "true");
  driver.row = { ...original, tenantId: null };
  await expect(caller().delete({ bundleId: BUNDLE })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expectNoEffects();
});

it("waits for deletion success before attempting the audit", async () => {
  let releaseWrite!: () => void;
  driver.writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
  const started = new Promise<void>(resolve => { driver.writeStarted = resolve; });
  const deletion = caller().delete({ bundleId: BUNDLE });
  await started;
  expect(driver.row?.isActive).toBe(true);
  expect(audit).not.toHaveBeenCalled();
  releaseWrite();
  await expect(deletion).resolves.toEqual({ success: true });
  expect(audit).toHaveBeenCalledTimes(1);
});

it("returns business success without waiting for the best-effort audit to settle", async () => {
  let releaseAudit!: () => void;
  audit.mockImplementation(() => new Promise<null>(resolve => { releaseAudit = () => resolve(null); }));
  try {
    await expect(caller().delete({ bundleId: BUNDLE })).resolves.toEqual({ success: true });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(driver.row?.isActive).toBe(false);
  } finally {
    releaseAudit?.();
  }
});
