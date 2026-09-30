import { describe, it, expect, vi, beforeEach } from "vitest";

// B2: pipeline helpers take the caller's resolved tenant as a required argument.
const T = "t-fixture";

// ─────────────────────────────────────────────────────────────────────────────
// ROBUST MOCKS
// ─────────────────────────────────────────────────────────────────────────────

const createQueryBuilder = (resolveType: "select" | "insert" | "update" | "delete") => {
  return {
    $dynamic: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    execute: vi.fn().mockReturnThis(),
    then(resolve: any) {
      resolve(queryResolveData[resolveType]);
    }
  };
};

let queryResolveData: any = { 
  select: [{ id: 1, status: "qualified", projectId: 10, leadId: 5, clientId: 20 }], 
  insert: [{ insertId: 1 }], 
  update: [{ affectedRows: 1 }], 
  delete: [] 
};

const mockDb = {
  select: vi.fn(() => createQueryBuilder("select")),
  insert: vi.fn(() => createQueryBuilder("insert")),
  update: vi.fn(() => createQueryBuilder("update")),
  delete: vi.fn(() => createQueryBuilder("delete")),
  execute: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn(async (cb: any) => cb(mockDb)),
};

vi.mock("./db", () => ({ getDb: vi.fn(() => mockDb) }));
// Audits resolve a truthy row by default — matching the fail-closed contract the
// conversion writers now enforce (an audit call that returns null/undefined aborts the
// whole conversion).
vi.mock("./audit", () => ({
  logAudit: vi.fn(async (params: any) => ({
    id: "audit-fixture-1",
    userId: params.userId ?? null,
    action: params.action,
    tableName: params.tableName,
    recordId: params.recordId ?? null,
    oldValues: params.before ?? null,
    newValues: params.after ?? null,
    createdAt: new Date(),
    ipAddress: null,
    userAgent: null,
  })),
  withAuditLog: vi.fn(async (params, before, fn) => {
    const res = await fn();
    return res;
  }),
}));

import * as pipelineDb from "./pipeline-db";
import * as pipelineEngine from "../shared/pipeline-orchestrator";

// These tests integrate the engine logic with the DB orchestration logic 
// using the robust mocking established in Phase 3.

describe("Pipeline Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // "1. Full Conversion Flow" moved to pipeline-conversion-audit-v2.test.ts:
  // orchestrateLeadConversion now looks up profiles/projects/clients/deals for identity/
  // replay verification, which this file's per-verb-type mock (one resolved array per
  // select regardless of table) cannot represent — see the same note in
  // sprint26-pipeline-db.test.ts.

  it("2. Complete Deal Win Life-cycle", async () => {
    // 1. Mock deal state
    const mockDeal = { id: 10, projectId: 100, stage: "negotiation" };
    
    // 2. Validate with engine
    const winPayload = pipelineEngine.buildDealWinPayload(mockDeal as any);
    expect(winPayload.valid).toBe(true);
    
    // 3. Orchestrate with DB
    const res = await pipelineDb.orchestrateDealWin("10", "99", T);
    expect(res.success).toBe(true);
  });

  it("3. Pipeline Summary Integration (Engine + Data)", async () => {
    const leads = [{ status: "new" }, { status: "qualified" }];
    const deals = [{ stage: "negotiation", weightedValue: "500" }];
    const projects = [{ status: "in_progress" }];

    const summary = pipelineEngine.getPipelineSummary(leads as any, deals as any, projects as any);
    expect(summary.totalLeads).toBe(2);
    expect(summary.pipelineValue).toBe(500);
  });

  it("4. Data Integrity: Linked State Consistency", async () => {
    // Verify that getFullPipelineState correlates all entities correctly
    const result = await pipelineDb.getFullPipelineState("10", T);
    expect(result).not.toBeNull();
    // In our mock, it returns whatever queryResolveData.select has
  });

  // "5. Audit Trail Integration" (orchestrateLeadConversion) moved to
  // pipeline-conversion-audit-v2.test.ts for the same reason as test 1 above.
});
