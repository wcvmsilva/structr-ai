import { describe, expect, it } from "vitest";
import { decodeAuthenticatedEstimateDraftRead } from "./authenticated-estimate-draft-read";
import { buildAuthenticatedInternalApprovalRecord } from "./authenticated-internal-approval-record";
import {
  estimateReadEnvelope,
  approvalRecordEnvelope,
  recordedApprovalEnvelope,
} from "./adr002-minimum-read.fixtures";
import {
  approvalRows,
  approvalContext,
} from "./internal-estimate-approval-adapter.fixtures";
const command = { id: approvalRows().draft.id };
const identity = {
  actorId: approvalContext.actorId,
  tenantId: approvalContext.tenantId,
};
const other = "a1000000-0000-4000-8000-000000000105";
const decode = (
  wire: unknown,
  input: unknown = command,
  expected: unknown = identity
) => decodeAuthenticatedEstimateDraftRead(wire, input, expected);
const record = (
  wire: unknown,
  input: unknown = command,
  expected: unknown = identity
) => buildAuthenticatedInternalApprovalRecord(wire, input, expected);

describe("ADR-002 general estimate read decoder", () => {
  it("preserves all 54 columns, JSON and numeric strings, while restoring Date objects", () => {
    const wire = estimateReadEnvelope(),
      before = JSON.stringify(wire);
    expect(Object.keys(wire.draft)).toHaveLength(54);
    expect(decode(wire)).toEqual({
      ...approvalRows().draft,
      historicalImportId: null,
    });
    expect(JSON.stringify(wire)).toBe(before);
  });
  it.each([null, other])(
    "preserves project-based tenancy when draft tenant is %s",
    tenantId => {
      const wire = estimateReadEnvelope();
      wire.draft.tenantId = tenantId;
      expect(decode(wire).tenantId).toBe(tenantId);
    }
  );
  it("preserves a historical reference and source without A1 eligibility checks", () => {
    const wire = estimateReadEnvelope();
    wire.historicalImportId = other;
    wire.draft.source = "historical_import";
    wire.draft.version = 0;
    expect(decode(wire)).toMatchObject({
      historicalImportId: other,
      source: "historical_import",
      version: 0,
    });
  });
  it.each(Object.keys(estimateReadEnvelope().draft))(
    "refuses missing physical column %s",
    field => {
      const wire = estimateReadEnvelope();
      delete wire.draft[field];
      expect(() => decode(wire)).toThrow();
    }
  );
  it.each([
    [
      "actor",
      (w: any) => {
        w.context.actorId = other;
      },
    ],
    [
      "tenant",
      (w: any) => {
        w.context.tenantId = other;
      },
    ],
    [
      "draft",
      (w: any) => {
        w.draft.id = other;
      },
    ],
    [
      "version tag",
      (w: any) => {
        w.version = "v2";
      },
    ],
    [
      "extra envelope",
      (w: any) => {
        w.secret = "private";
      },
    ],
    [
      "extra draft",
      (w: any) => {
        w.draft.secret = "private";
      },
    ],
    [
      "numeric coercion",
      (w: any) => {
        w.draft.subtotalPrice = 100;
      },
    ],
    [
      "boolean coercion",
      (w: any) => {
        w.draft.discountApplied = 0;
      },
    ],
    [
      "null required",
      (w: any) => {
        w.draft.projectId = null;
      },
    ],
    [
      "fractional version",
      (w: any) => {
        w.draft.version = 1.1;
      },
    ],
    [
      "noncanonical timestamp",
      (w: any) => {
        w.draft.createdAt = "2026-09-01T12:00:00Z";
      },
    ],
    [
      "invalid date",
      (w: any) => {
        w.draft.createdAt = "2026-02-30T12:00:00.000Z";
      },
    ],
    [
      "undefined JSON",
      (w: any) => {
        w.draft.metadata = { private: undefined };
      },
    ],
    [
      "nonfinite JSON",
      (w: any) => {
        w.draft.metadata = { price: Infinity };
      },
    ],
    [
      "sparse JSON",
      (w: any) => {
        w.draft.metadata = Array(1);
      },
    ],
  ] as const)("refuses invalid %s", (_name, mutate) => {
    const wire = estimateReadEnvelope();
    mutate(wire);
    expect(() => decode(wire)).toThrow();
  });
  it("refuses getter evidence without executing it", () => {
    const wire = estimateReadEnvelope();
    let read = false;
    Object.defineProperty(wire.draft, "metadata", {
      enumerable: true,
      get() {
        read = true;
        return null;
      },
    });
    expect(() => decode(wire)).toThrow();
    expect(read).toBe(false);
  });
  it.each([{ ...command, tenantId: other }, { id: "invalid" }])(
    "rejects invalid command %#",
    input => {
      expect(() => decode(estimateReadEnvelope(), input)).toThrow();
    }
  );
});

describe("ADR-002 recorded approval decoder", () => {
  it("returns the legacy empty record", async () => {
    expect(await record(approvalRecordEnvelope())).toEqual({
      state: "none",
      snapshot: null,
      approval: null,
      revocation: null,
    });
  });
  it.each([false, null])(
    "permits an inactive/nullable client (%s), including soft deletion",
    async isActive => {
      const wire = approvalRecordEnvelope();
      wire.rows.client.isActive = isActive;
      wire.rows.client.deletedAt = "2026-10-01T00:00:00.000Z";
      expect(await record(wire)).toMatchObject({ state: "none" });
    }
  );
  it("does not invent eligibility or historical-lineage checks for no evidence", async () => {
    const wire = approvalRecordEnvelope();
    wire.rows.draft.version = 0;
    wire.rows.draft.source = "historical_import";
    expect(await record(wire)).toMatchObject({ state: "none" });
  });
  it.each(["active", "revoked"] as const)(
    "returns a cryptographically validated %s decision",
    async state => {
      const wire = approvalRecordEnvelope(
        await recordedApprovalEnvelope(state)
      );
      const before = JSON.stringify(wire),
        result = await record(wire);
      expect(result.state).toBe(state);
      expect(result.snapshot?.contentHash).toBe(
        wire.approvalEvidence.snapshots[0].contentHash
      );
      expect(JSON.stringify(wire)).toBe(before);
    }
  );
  it("uses frozen policy rather than recomputing current geo", async () => {
    const wire = approvalRecordEnvelope(await recordedApprovalEnvelope());
    wire.rows.project.zoneModifierSnapshot = null;
    wire.rows.project.geocodeConfidence = "low";
    expect(await record(wire)).toMatchObject({ state: "active" });
  });
  it.each([
    [
      "actor",
      (w: any) => {
        w.context.actorId = other;
      },
    ],
    [
      "tenant",
      (w: any) => {
        w.context.tenantId = other;
      },
    ],
    [
      "draft",
      (w: any) => {
        w.rows.draft.id = other;
      },
    ],
    [
      "client context",
      (w: any) => {
        w.rows.client.tenantId = other;
      },
    ],
    [
      "client link",
      (w: any) => {
        w.rows.project.clientId = other;
      },
    ],
    [
      "inactive tenant",
      (w: any) => {
        w.rows.tenant.isActive = false;
      },
    ],
    [
      "inactive actor",
      (w: any) => {
        w.rows.profile.isActive = false;
      },
    ],
    [
      "deleted project",
      (w: any) => {
        w.rows.project.deletedAt = "2026-10-01T00:00:00.000Z";
      },
    ],
    [
      "extra row",
      (w: any) => {
        w.rows.secret = {};
      },
    ],
    [
      "orphan status",
      (w: any) => {
        w.rows.draft.status = "internally_approved";
      },
    ],
    [
      "empty source verdict",
      (w: any) => {
        w.approvalEvidence.sourceMatches = true;
      },
    ],
    [
      "empty author",
      (w: any) => {
        w.approvalEvidence.authors.push({
          id: other,
          tenantId: identity.tenantId,
        });
      },
    ],
  ] as const)("refuses inconsistent %s", async (_name, mutate) => {
    const wire = approvalRecordEnvelope();
    mutate(wire);
    await expect(record(wire)).rejects.toMatchObject({
      code: "INTERNAL_APPROVAL_INTEGRITY_ERROR",
    });
  });
  it.each([
    [
      "content hash",
      (w: any) => {
        w.approvalEvidence.snapshots[0].contentHash = "0".repeat(64);
      },
    ],
    [
      "policy hash",
      (w: any) => {
        w.approvalEvidence.snapshots[0].policyHash = "0".repeat(64);
      },
    ],
    [
      "request hash",
      (w: any) => {
        w.approvalEvidence.approvals[0].requestHash = "0".repeat(64);
      },
    ],
    [
      "source mismatch",
      (w: any) => {
        w.approvalEvidence.sourceMatches = false;
      },
    ],
    [
      "foreign author",
      (w: any) => {
        w.approvalEvidence.authors[0].tenantId = other;
      },
    ],
    [
      "foreign snapshot",
      (w: any) => {
        w.approvalEvidence.snapshots[0].projectId = other;
      },
    ],
    [
      "current financial",
      (w: any) => {
        w.rows.draft.subtotalCost = "41.00";
      },
    ],
    [
      "duplicate approval",
      (w: any) => {
        w.approvalEvidence.approvals.push({
          ...w.approvalEvidence.approvals[0],
        });
      },
    ],
  ] as const)("refuses corrupt persisted %s", async (_name, mutate) => {
    const wire = approvalRecordEnvelope(await recordedApprovalEnvelope());
    mutate(wire);
    await expect(record(wire)).rejects.toMatchObject({
      code: "INTERNAL_APPROVAL_INTEGRITY_ERROR",
    });
  });
});

it("matches a general uppercase UUID command to the canonical database row", () => {
  expect(
    decode(estimateReadEnvelope(), { id: command.id.toUpperCase() })
  ).toMatchObject({ id: command.id });
});
it("retains the legacy A1 lowercase command grammar", async () => {
  await expect(
    record(approvalRecordEnvelope(), { id: command.id.toUpperCase() })
  ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INPUT_INVALID" });
});
