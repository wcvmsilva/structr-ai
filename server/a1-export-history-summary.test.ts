/**
 * A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md — pure unit tests for
 * `summaryOf`/`detailOf` (server/jobtread-export-db.ts), the history/detail
 * projection that distinguishes A1 ready/downloaded/blocked from the explicit
 * legacy variant. No database: a hand-built `JobtreadExport`-shaped row in,
 * a closed `ExportHistorySummary`/`ExportAttemptDetail` out.
 *
 * The legacy branch specifically cannot be proven against a real row in the
 * physical lab: the migration's own INSERT guard trigger refuses any NEW
 * insert without the full A1 marker set (confirmed physically while writing
 * a1-export-surface-integration.test.ts) — a fresh lab has no pre-migration
 * data to grandfather in. This is the real proof for that branch instead.
 */
import { describe, expect, it } from "vitest";
import { summaryOf, detailOf } from "./jobtread-export-db";
import type { JobtreadExport } from "../drizzle/schema";

const BASE: JobtreadExport = {
  id: "b1000000-0000-4000-8000-000000000001",
  tenantId: "b1000000-0000-4000-8000-000000000010",
  projectId: "b1000000-0000-4000-8000-000000000020",
  estimateDraftId: "b1000000-0000-4000-8000-000000000030",
  estimateVersion: 1, contractVersion: "csv-v1.0", status: "requested", blockReason: null, rowCount: 0,
  approvedTotalCents: null, exportedTotalCents: null, differenceCents: null, reconciliationStatus: null,
  csvHash: null, manifest: null, validationReport: null,
  skillId: "gchi-jobtread-integration-contract", skillVersion: "1.0.0",
  requestedBy: "b1000000-0000-4000-8000-000000000010", downloadedBy: null, downloadedAt: null,
  createdAt: new Date("2026-10-01T00:00:00.000Z"), updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  artifactContractVersion: null, artifactFormat: null, attemptKind: null, clientId: null,
  internalApprovalId: null, internalSnapshotId: null, approvedContentHash: null,
  artifactHash: null, rendererVersion: null, generatedAt: null, artifactByteLength: null, checkedAt: null,
  a1EstimateDraftId: null, a1RequestedBy: null, a1DownloadedBy: null,
} as unknown as JobtreadExport;

describe("summaryOf — legacy variant (no artifactContractVersion)", () => {
  it("outcome:legacy with every A1 field null, availability legacy_reconciliation_required", () => {
    const row = { ...BASE, status: "completed", rowCount: 3 };
    const summary = summaryOf(row);
    expect(summary).toEqual({
      exportId: BASE.id, estimateId: BASE.estimateDraftId, projectId: BASE.projectId,
      format: null, kind: null, outcome: "legacy", status: "completed", checkedAt: null,
      authority: null, validation: null, artifact: null, availability: "legacy_reconciliation_required",
    });
  });

  it("detailOf never attaches a manifest for a legacy row, even if the JSON column happens to hold something", () => {
    const row = { ...BASE, manifest: { stray: "legacy json blob" } };
    const detail = detailOf(row);
    expect(detail.manifest).toBeNull();
    expect(detail.outcome).toBe("legacy");
  });
});

const A1_READY: JobtreadExport = {
  ...BASE, status: "approved_for_download", attemptKind: "preflight", artifactFormat: "json",
  artifactContractVersion: "internal-estimate-export-v1", rowCount: 2,
  checkedAt: new Date("2026-10-01T01:00:00.000Z"),
  internalApprovalId: "b1000000-0000-4000-8000-000000000040",
  internalSnapshotId: "b1000000-0000-4000-8000-000000000050",
  approvedContentHash: "a".repeat(64),
  artifactHash: "b".repeat(64), artifactByteLength: 1234, rendererVersion: "internal-estimate-export-json-v1",
  generatedAt: new Date("2026-10-01T00:59:00.000Z"),
  validationReport: { state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: "10000", exportedTotalMinor: "10000", differenceMinor: "0", estimatedCostMinor: "8000" } },
} as unknown as JobtreadExport;

describe("summaryOf — A1 ready/downloaded variant", () => {
  it("outcome:ready, availability requires_revalidation, authority+artifact populated", () => {
    const summary = summaryOf(A1_READY);
    expect(summary.outcome).toBe("ready");
    expect(summary.kind).toBe("preflight");
    expect(summary.format).toBe("json");
    expect(summary.availability).toBe("requires_revalidation");
    expect(summary.authority).toEqual({ approvalId: A1_READY.internalApprovalId, snapshotId: A1_READY.internalSnapshotId, contentHash: A1_READY.approvedContentHash });
    expect(summary.artifact).toEqual({ artifactHash: A1_READY.artifactHash, byteLength: A1_READY.artifactByteLength, rendererVersion: A1_READY.rendererVersion, generatedAt: A1_READY.generatedAt!.toISOString() });
  });

  it("'downloaded' status is ALSO outcome:ready/requires_revalidation (never a third availability class)", () => {
    const summary = summaryOf({ ...A1_READY, status: "downloaded", downloadedBy: BASE.requestedBy, downloadedAt: A1_READY.checkedAt });
    expect(summary.outcome).toBe("ready");
    expect(summary.availability).toBe("requires_revalidation");
    expect(summary.status).toBe("downloaded");
  });

  it("detailOf re-parses the manifest and exposes it, never the raw unvalidated JSON value", () => {
    const malformedManifestRow = { ...A1_READY, manifest: { not: "a valid manifest" } };
    expect(detailOf(malformedManifestRow).manifest).toBeNull(); // fails its own closed grammar -> treated as absent, not surfaced malformed
  });
});

describe("summaryOf — A1 blocked variant", () => {
  it("outcome:blocked, availability blocked, no artifact, authority null for an authority-null code", () => {
    const row = {
      ...BASE, status: "blocked_authorization", blockReason: "INTERNAL_APPROVAL_REQUIRED", attemptKind: "delivery",
      artifactFormat: "pdf", artifactContractVersion: "internal-estimate-export-v1",
      checkedAt: new Date("2026-10-01T02:00:00.000Z"),
      validationReport: { state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } },
    } as unknown as JobtreadExport;
    const summary = summaryOf(row);
    expect(summary.outcome).toBe("blocked");
    expect(summary.availability).toBe("blocked");
    expect(summary.artifact).toBeNull();
    expect(summary.authority).toBeNull();
    expect(summary.kind).toBe("delivery");
  });
});
