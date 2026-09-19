/** Workflow Visualization UUID Round-trip Contract — caller boundary proof.
 *
 * Real: the visualization router, its tRPC middleware, the project access guard
 * (`project-access`) and the remodel/override engines. Database acquisition is an
 * INSTRUMENTED double that answers only WHICH synthetic rows exist and records every
 * table it was asked for — it takes no tenant, deletion or membership decision. The
 * commercial read helpers are named doubles that record whether they were called, which
 * is what sustains "refused before guard, database and helpers".
 *
 * The authorization decision itself is never mocked. No SQL, persistence or PostgreSQL
 * behaviour is claimed here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Profile, Project, ScopeDraft, ScopeDraftItem } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({
  draft: vi.fn(), draftList: vi.fn(), project: vi.fn(), assemblies: vi.fn(),
  templates: vi.fn(), overrideLog: vi.fn(), rules: vi.fn(),
  acquisitions: 0, tables: [] as string[], writes: 0,
}));

type Row = Record<string, unknown>;
const store: Record<string, Row[]> = {};

/** Existence-only, instrumented. Records each acquisition and each table consulted. */
const authorizationDriver = {
  select: (selection?: Record<string, any>) => {
    let source = ""; let joined = false; let predicate: SQL;
    const evaluate = () => {
      const query = new PgDialect().sqlToQuery(predicate);
      const idParameter = /"[^"]+"\."id" = \$(\d+)/.exec(query.sql);
      const id = idParameter ? query.params[Number(idParameter[1]) - 1] : undefined;
      boundary.tables.push(source);
      if (!joined) return structuredClone((store[source] ?? []).filter(row => row.id === id));
      const draft = (store.scope_drafts ?? []).find(row => row.id === id);
      const project = (store.projects ?? []).find(row => row.id === draft?.projectId);
      if (!draft || !project) return [];
      const pick = (value: any): any => {
        if (value?.table && typeof value.name === "string") {
          const key = value.name.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
          return (getTableName(value.table) === "projects" ? project : draft)[key];
        }
        if (value && typeof value === "object") {
          return Object.fromEntries(Object.entries(value).map(([key, column]) => [key, pick(column)]));
        }
        return value;
      };
      return [pick(selection)];
    };
    const chain: any = {
      from: (table: Table) => { source = getTableName(table); return chain; },
      innerJoin: () => { joined = true; return chain; },
      leftJoin: () => { joined = true; return chain; },
      where: (value: SQL) => { predicate = value; return chain; },
      limit: async (count: number) => evaluate().slice(0, count),
      then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve().then(evaluate).then(resolve, reject),
    };
    return chain;
  },
  insert: () => { boundary.writes++; throw new Error("Unexpected insert in read-only route"); },
  update: () => { boundary.writes++; throw new Error("Unexpected update in read-only route"); },
  delete: () => { boundary.writes++; throw new Error("Unexpected delete in read-only route"); },
};

vi.mock("./db", () => ({
  getDb: async () => { boundary.acquisitions++; return authorizationDriver; },
  getRawClient: vi.fn(),
}));
vi.mock("./rbac", () => ({ hasPermission: vi.fn(async () => false) }));
vi.mock("./scope-db", () => ({
  getScopeDraftWithItems: boundary.draft,
  listScopeDraftsForProject: boundary.draftList,
}));
vi.mock("./project-db", () => ({ getProjectById: boundary.project }));
vi.mock("./assembly-db", () => ({ listAssemblies: boundary.assemblies }));
vi.mock("./remodel-db", () => ({ listRemodelTemplates: boundary.templates }));
vi.mock("./geo-override-db", async importOriginal => ({
  ...await importOriginal<typeof import("./geo-override-db")>(),
  getOverrideLogForDraft: boundary.overrideLog,
  listOverrideRules: boundary.rules,
}));

import { workflowVisualizationRouter } from "./workflow-visualization-router";

const TENANT_A = "11110000-0000-4000-8000-000000000001";
const TENANT_B = "11110000-0000-4000-8000-000000000002";
const ACTOR = "22220000-0000-4000-8000-000000000001";
const PROJECT = "33330000-0000-4000-8000-000000000001";
const DRAFT = "44440000-0000-4000-8000-000000000001";
const FOREIGN_PROJECT = "33330000-0000-4000-8000-000000000002";
const FOREIGN_DRAFT = "44440000-0000-4000-8000-000000000002";
const ASSEMBLY = "55550000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-16T12:00:00.000Z");

const actor: Profile = {
  id: ACTOR, tenantId: TENANT_A, role: "user", isActive: true,
  externalOpenId: "synthetic-viz", fullName: "Synthetic", companyName: null,
  email: "viz@example.invalid", loginMethod: "lab", lastSignedIn: null,
  createdAt: NOW, updatedAt: NOW,
};
const project = {
  id: PROJECT, tenantId: TENANT_A, ownerUserId: ACTOR, name: "Synthetic project",
  zone: "inland", channel: "direct", geocodeConfidence: "high", deletedAt: null,
} as unknown as Project;
const draft = {
  id: DRAFT, tenantId: TENANT_A, projectId: PROJECT, status: "approved",
  confidence: "0.90", warningsJson: [], createdAt: NOW,
} as unknown as ScopeDraft;
const item = {
  id: "66660000-0000-4000-8000-000000000001", scopeDraftId: DRAFT, assemblyId: ASSEMBLY,
  assemblyName: "Synthetic assembly", quantity: "2", unit: "EA", reason: "scope",
  confidence: "0.90", sortOrder: 0,
} as unknown as ScopeDraftItem;

function context(tenantId: string | null = TENANT_A, user: Profile | null = actor): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"],
    authProvider: "supabase", user, tenantId,
  };
}
const caller = (ctx: TrpcContext = context()) => workflowVisualizationRouter.createCaller(ctx);
const outcome = <T>(work: Promise<T>) =>
  work.then(value => ({ value, error: null as any }), error => ({ value: null, error }));
/** Bypasses compile-time input typing only where the test intentionally exercises runtime validation. */
const runtimeInput = (value: unknown): never => value as never;
const snapshot = () => JSON.stringify(store);

beforeEach(() => {
  vi.clearAllMocks();
  boundary.acquisitions = 0;
  boundary.tables = [];
  boundary.writes = 0;
  store.profiles = [{ ...actor }];
  store.projects = [
    { ...project },
    { id: FOREIGN_PROJECT, tenantId: TENANT_B, ownerUserId: "99990000-0000-4000-8000-000000000009", name: "Foreign", deletedAt: null },
  ];
  store.scope_drafts = [
    { ...draft },
    { ...draft, id: FOREIGN_DRAFT, projectId: FOREIGN_PROJECT, tenantId: TENANT_B },
  ];
  boundary.draft.mockResolvedValue({ draft: { ...draft }, items: [{ ...item }] });
  boundary.draftList.mockResolvedValue([{ ...draft }]);
  boundary.project.mockResolvedValue({ ...project });
  boundary.assemblies.mockResolvedValue({
    items: [{ id: ASSEMBLY, name: "Synthetic assembly", code: "SY-01", trade: "carpentry", category: "carpentry", isActive: true }],
    total: 1,
  });
  boundary.templates.mockResolvedValue([]);
  boundary.overrideLog.mockResolvedValue([]);
  boundary.rules.mockResolvedValue([]);
});

describe("Ciclo A — contrato de entrada", () => {
  it("A1: loadVisualization aceita UUID e alcança o guard", async () => {
    const result = await outcome(caller().loadVisualization({ scopeDraftId: DRAFT }));
    expect.soft(result.error).toBeNull();
    expect.soft(boundary.acquisitions).toBe(2);
    expect.soft(boundary.tables).toEqual(["scope_drafts", "projects", "profiles"]);
    expect(result.value).toBeTruthy();
  });

  it("A2: listDraftsForProject aceita UUID de projeto autorizado", async () => {
    const result = await outcome(caller().listDraftsForProject({ projectId: PROJECT }));
    expect.soft(result.error).toBeNull();
    expect.soft(boundary.acquisitions).toBe(1);
    expect.soft(boundary.tables).toEqual(["projects", "profiles"]);
    expect(boundary.draftList).toHaveBeenCalledWith(PROJECT);
  });

  it("A3: entrada numérica é recusada antes de guard, banco e helpers", async () => {
    const visualization = await outcome(caller().loadVisualization({ scopeDraftId: runtimeInput(17) }));
    const list = await outcome(caller().listDraftsForProject({ projectId: runtimeInput(17) }));
    expect.soft(visualization.error).toMatchObject({ code: "BAD_REQUEST" });
    expect.soft(list.error).toMatchObject({ code: "BAD_REQUEST" });
    expect.soft(boundary.acquisitions).toBe(0);
    expect.soft(boundary.tables).toEqual([]);
    expect.soft(boundary.writes).toBe(0);
    expect.soft(boundary.draft).not.toHaveBeenCalled();
    expect.soft(boundary.draftList).not.toHaveBeenCalled();
    expect.soft(boundary.project).not.toHaveBeenCalled();
    expect.soft(boundary.assemblies).not.toHaveBeenCalled();
    expect.soft(boundary.templates).not.toHaveBeenCalled();
    expect.soft(boundary.overrideLog).not.toHaveBeenCalled();
    expect(boundary.rules).not.toHaveBeenCalled();
  });
});

describe("Controles de preservação — devem passar antes e depois", () => {
  for (const [name, value] of [["vazio", ""], ["texto", "abc"], ["nulo", null]] as const) {
    it(`recusa entrada ${name} com BAD_REQUEST`, async () => {
      const result = await outcome(caller().loadVisualization({ scopeDraftId: runtimeInput(value) }));
      expect(result.error).toMatchObject({ code: "BAD_REQUEST" });
    });
  }

  it("nenhuma escrita ocorre em nenhum caminho", async () => {
    const before = snapshot();
    const visualization = await outcome(caller().loadVisualization({ scopeDraftId: DRAFT }));
    const numeric = await outcome(caller().loadVisualization({ scopeDraftId: runtimeInput(17) }));
    const list = await outcome(caller().listDraftsForProject({ projectId: PROJECT }));
    expect.soft(visualization.error).toBeNull();
    expect.soft(numeric.error).toMatchObject({ code: "BAD_REQUEST" });
    expect.soft(list.error).toBeNull();
    expect.soft(boundary.writes).toBe(0);
    expect(snapshot()).toBe(before);
  });

  it("loadVisualization sem empresa resolvida recusa por tenantProcedure", async () => {
    const result = await outcome(caller(context(null)).loadVisualization({ scopeDraftId: DRAFT }));
    expect.soft(result.error).toMatchObject({ code: "FORBIDDEN" });
    expect(boundary.acquisitions).toBe(0);
  });

  it("F1: listDraftsForProject com tenantId nulo ainda alcança o guard de projeto", async () => {
    // Distingue protectedProcedure de tenantProcedure: a fronteira atual NÃO exige
    // empresa resolvida, e a autorização fica a cargo de requireProjectAccessTrpc.
    const result = await outcome(caller(context(null)).listDraftsForProject({ projectId: PROJECT }));
    expect.soft(result.error).toBeNull();
    expect.soft(boundary.acquisitions).toBe(1);
    expect.soft(boundary.tables).toEqual(["projects", "profiles"]);
    expect(boundary.draftList).toHaveBeenCalledWith(PROJECT);
  });
});

describe("Controles após GREEN A", () => {
  it("X1: UUID estrangeiro alcança o guard real e é recusado antes dos helpers", async () => {
    const result = await outcome(caller().loadVisualization({ scopeDraftId: FOREIGN_DRAFT }));
    expect.soft(result.error).toMatchObject({ code: "FORBIDDEN" });
    expect.soft(boundary.acquisitions).toBe(2);
    expect.soft(boundary.tables).toEqual(["scope_drafts", "projects", "profiles"]);
    expect.soft(boundary.draft).not.toHaveBeenCalled();
    expect.soft(boundary.draftList).not.toHaveBeenCalled();
    expect.soft(boundary.project).not.toHaveBeenCalled();
    expect.soft(boundary.assemblies).not.toHaveBeenCalled();
    expect.soft(boundary.templates).not.toHaveBeenCalled();
    expect.soft(boundary.overrideLog).not.toHaveBeenCalled();
    expect(boundary.rules).not.toHaveBeenCalled();
  });

  it("Q1: quantity permanece numérica na saída", async () => {
    const result = await outcome(caller().loadVisualization({ scopeDraftId: DRAFT }));
    expect.soft(result.error).toBeNull();
    const data = result.value as { workflow: { stages: Array<{ assemblies: Array<{ quantity: unknown }> }> } } | null;
    const quantities = (data?.workflow.stages ?? []).flatMap(stage => stage.assemblies.map(a => a.quantity));
    expect(quantities).toEqual([2]);
  });
});

describe("Ciclo B — round-trip de saída", () => {
  it("B1: project.id preserva exatamente o UUID da linha carregada", async () => {
    const result = await outcome(caller().loadVisualization({ scopeDraftId: DRAFT }));
    expect.soft(result.error).toBeNull();
    expect(result.value?.project.id).toBe(PROJECT);
  });

  it("B2: scopeDraft.id preserva exatamente o UUID da linha carregada", async () => {
    const result = await outcome(caller().loadVisualization({ scopeDraftId: DRAFT }));
    expect.soft(result.error).toBeNull();
    expect(result.value?.scopeDraft.id).toBe(DRAFT);
  });
});
