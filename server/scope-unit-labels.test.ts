import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ db: vi.fn(), transaction: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.db }));
import { listAssemblies } from "./assembly-db";
import { assemblies, units } from "../drizzle/schema";
import { ScopeUnit } from "../client/src/components/ScopeUnit";

const UNIT = "c4200000-0000-4000-8000-000000000001";
let unitRows: Array<{ id: string; abbreviation: string | null; name: string }>;
let assemblyRows: any[];
let queries: Array<{ table: unknown; predicate?: unknown; source: "raw" | "transaction" }>;
let afterAssemblyRead: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks(); queries = []; afterAssemblyRead = undefined;
  assemblyRows = [{ id: "one", name: "Synthetic one", defaultUnitId: UNIT }, { id: "two", name: "Synthetic two", defaultUnitId: UNIT }];
  unitRows = [{ id: UNIT, abbreviation: " SF ", name: "Square foot" }];
  const select = (source: "raw" | "transaction", snapshot?: { units: typeof unitRows; assemblies: typeof assemblyRows }) => (selection?: any) => ({ from: (table: unknown) => {
    const entry: { table: unknown; predicate?: unknown; source: "raw" | "transaction" } = { table, source }; queries.push(entry);
    const values = () => table === units ? snapshot?.units ?? unitRows : selection?.count ? [{ count: (snapshot?.assemblies ?? assemblyRows).length }] : snapshot?.assemblies ?? assemblyRows;
    const query: any = { where: (predicate: unknown) => { entry.predicate = predicate; return query; }, orderBy: () => query,
      limit: () => query, offset: () => query, then: (resolve: any, reject: any) => {
        const result = values();
        if (table === assemblies && !selection?.count) afterAssemblyRead?.();
        return Promise.resolve(result).then(resolve, reject);
      } };
    return query;
  } });
  mocks.transaction.mockImplementation(async callback => callback({ select: select("transaction", {
    units: structuredClone(unitRows), assemblies: structuredClone(assemblyRows),
  }) }));
  mocks.db.mockResolvedValue({ select: select("raw"), transaction: mocks.transaction });
});

describe("optional scope unit labels from exact unit references", () => {
  it("preserves raw list callers and performs no unit lookup by default", async () => {
    const result = await listAssemblies();
    expect(result.items).toEqual(assemblyRows);
    expect(result.items[0]).not.toHaveProperty("defaultUnitLabel");
    expect(queries.filter(q => q.table === units)).toHaveLength(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(queries.every(q => q.source === "raw")).toBe(true);
  });
  it("resolves a text label once in bulk, keeps UUID identity separate and preserves count", async () => {
    const result = await listAssemblies({ includeUnitLabel: true } as any);
    expect(result).toMatchObject({ total: 2, items: [
      { id: "one", defaultUnitId: UNIT, defaultUnitLabel: "SF" },
      { id: "two", defaultUnitId: UNIT, defaultUnitLabel: "SF" },
    ] });
    const unitQueries = queries.filter(q => q.table === units);
    expect(unitQueries).toHaveLength(1);
    const statement = new PgDialect().sqlToQuery(unitQueries[0].predicate as any);
    expect(statement.params).toEqual([UNIT]);
    expect(statement.sql).toContain('"units"."id"');
    expect(assemblyRows[0]).not.toHaveProperty("defaultUnitLabel");
  });
  it("uses the referenced unit name only when its own abbreviation is empty", async () => {
    unitRows[0].abbreviation = " ";
    expect((await listAssemblies({ includeUnitLabel: true } as any)).items[0]).toMatchObject({ defaultUnitLabel: "Square foot" });
  });
  it.each(["missing row", "empty labels"])("leaves %s unresolved without UUID or EA substitution", async scenario => {
    unitRows = scenario === "missing row" ? [] : [{ id: UNIT, abbreviation: " ", name: " " }];
    expect((await listAssemblies({ includeUnitLabel: true } as any)).items[0]).toMatchObject({ defaultUnitId: UNIT, defaultUnitLabel: null });
  });
  it("does not query a unit or invent EA when all assemblies lack a default unit", async () => {
    assemblyRows = [{ id: "one", defaultUnitId: null }];
    expect((await listAssemblies({ includeUnitLabel: true } as any)).items[0]).toMatchObject({ defaultUnitLabel: null });
    expect(queries.filter(q => q.table === units)).toHaveLength(0);
  });
  it("keeps an empty library empty without a unit lookup", async () => {
    assemblyRows = [];
    expect(await listAssemblies({ includeUnitLabel: true } as any)).toEqual({ items: [], total: 0 });
    expect(queries.filter(q => q.table === units)).toHaveLength(0);
  });
  it("reads count, assemblies and units through one read-only repeatable-read transaction", async () => {
    await listAssemblies({ includeUnitLabel: true });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    expect(queries).toHaveLength(3);
    expect(queries.every(q => q.source === "transaction")).toBe(true);
  });
  it("does not combine assembly rows with a later concurrent unit label", async () => {
    afterAssemblyRead = () => { unitRows = [{ id: UNIT, abbreviation: "CHANGED", name: "Changed after assembly read" }]; };
    const result = await listAssemblies({ includeUnitLabel: true });
    expect(result.items[0].defaultUnitLabel).toBe("SF");
    expect(unitRows[0].abbreviation).toBe("CHANGED");
  });
  it("does not fall back to unscoped reads if the read-only transaction cannot start", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("Snapshot unavailable"));
    await expect(listAssemblies({ includeUnitLabel: true })).rejects.toThrow("Snapshot unavailable");
    expect(queries).toHaveLength(0);
  });
});

describe("scope and review unit presentation", () => {
  it.each([null, undefined, "", "  ", UNIT])("marks missing or legacy UUID unit %s for review", unit => {
    const html = renderToStaticMarkup(createElement(ScopeUnit, { unit }));
    expect(html).toContain("Unit needs review");
    expect(html).not.toContain(UNIT); expect(html).not.toContain(">EA<");
  });
  it.each(["SF", "EA", "Square foot"])("shows the known unit label %s unchanged", unit => {
    expect(renderToStaticMarkup(createElement(ScopeUnit, { unit }))).toContain(`>${unit}<`);
  });
});
