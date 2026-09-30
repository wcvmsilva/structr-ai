/**
 * Router-level: only the error-translation added in this slice and the
 * updateStatus procedure upgrade (protectedProcedure → tenantProcedure). The real
 * authorization/payload-barrier control flow is already exercised against a real
 * requireProjectAccess in server/project-db.test.ts — mocking createProject/
 * updateProject/updateProjectStatus here keeps this file scoped to what changed in
 * project-router.ts, not a second copy of that coverage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  updateProjectStatus: vi.fn(),
}));
vi.mock("./project-db", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createProject: mocks.createProject,
  updateProject: mocks.updateProject,
  updateProjectStatus: mocks.updateProjectStatus,
}));

import { projectRouter } from "./project-router";
import { ProjectAccessError } from "./project-access";
import { ProjectOperationBlockedError } from "@shared/project-operation-guard";

const TENANT = "c3100000-0000-4000-8000-000000000001";
const USER = "c3100000-0000-4000-8000-000000000010";
const PROJECT = "c3100000-0000-4000-8000-000000000100";
const NOW = new Date("2026-09-30T12:00:00Z");

function context(tenantId: string | null = TENANT): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId,
    user: {
      id: USER, tenantId, role: "user", isActive: true, externalOpenId: null,
      email: "operator@example.invalid", fullName: "Synthetic Operator", companyName: null,
      loginMethod: "legacy", lastSignedIn: NOW, createdAt: NOW, updatedAt: NOW,
    } as any,
  };
}
const caller = (tenantId: string | null = TENANT) => projectRouter.createCaller(context(tenantId));

beforeEach(() => vi.clearAllMocks());

describe("error translation added by this slice", () => {
  it("update: ProjectAccessError keeps its own code (FORBIDDEN)", async () => {
    mocks.updateProject.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "no standing"));
    await expect(caller().update({ id: PROJECT, data: { notes: "x" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("update: ProjectOperationBlockedError becomes PRECONDITION_FAILED", async () => {
    mocks.updateProject.mockRejectedValue(new ProjectOperationBlockedError("estimatedTotal"));
    await expect(caller().update({ id: PROJECT, data: { notes: "x" } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("updateStatus: ProjectAccessError keeps its own code (NOT_FOUND)", async () => {
    mocks.updateProjectStatus.mockRejectedValue(new ProjectAccessError("NOT_FOUND", "gone"));
    await expect(caller().updateStatus({ id: PROJECT, status: "estimating" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updateStatus: ProjectOperationBlockedError becomes PRECONDITION_FAILED", async () => {
    mocks.updateProjectStatus.mockRejectedValue(new ProjectOperationBlockedError("status"));
    await expect(caller().updateStatus({ id: PROJECT, status: "approved" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("create: ProjectOperationBlockedError becomes PRECONDITION_FAILED", async () => {
    mocks.createProject.mockRejectedValue(new ProjectOperationBlockedError("status"));
    await expect(caller().create({ name: "New Project" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("create: ProjectAccessError keeps its own code (FORBIDDEN)", async () => {
    mocks.createProject.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "identity mismatch"));
    await expect(caller().create({ name: "New Project" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an unrelated error is not swallowed or relabeled", async () => {
    mocks.updateProject.mockRejectedValue(new Error("unexpected"));
    await expect(caller().update({ id: PROJECT, data: { notes: "x" } })).rejects.toThrow("unexpected");
  });
});

describe("updateStatus now requires a resolved tenant (tenantProcedure)", () => {
  it("rejects before the helper is ever called when the caller has no tenant", async () => {
    await expect(caller(null).updateStatus({ id: PROJECT, status: "estimating" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.updateProjectStatus).not.toHaveBeenCalled();
  });

  it("passes ctx.tenantId through to the helper on a resolved-tenant call", async () => {
    mocks.updateProjectStatus.mockResolvedValue({ id: PROJECT, status: "estimating" });
    await caller().updateStatus({ id: PROJECT, status: "estimating" });
    expect(mocks.updateProjectStatus).toHaveBeenCalledWith(PROJECT, "estimating", USER, TENANT);
  });
});
