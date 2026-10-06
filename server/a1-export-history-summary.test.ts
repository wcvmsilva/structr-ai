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
import { EXPORT_PROTOCOL as EP } from "@shared/domain/taxonomy";
import { buildExportFilename } from "@shared/internal-estimate-export-engine";

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
  it("outcome:legacy with every A1 field null, availability legacy_reconciliation_required, no projectId (not one of Export§9's 11 keys)", () => {
    const row = { ...BASE, status: "completed", rowCount: 3 };
    const summary = summaryOf(row);
    expect(summary).toEqual({
      exportId: BASE.id, estimateId: BASE.estimateDraftId,
      format: null, kind: null, outcome: "legacy", status: "completed", checkedAt: null,
      authority: null, validation: null, artifact: null, availability: "legacy_reconciliation_required",
    });
    expect(summary).not.toHaveProperty("projectId");
  });

  it("detailOf never attaches a manifest for a legacy row, even if the JSON column happens to hold something", () => {
    const row = { ...BASE, manifest: { stray: "legacy json blob" } };
    const detail = detailOf(row);
    expect(detail.manifest).toBeNull();
    expect(detail.outcome).toBe("legacy");
  });

  // MICHAEL-A1-EXPORT-SURFACE-V1-QA-AND-CORRECTION.md item 2.
  it("rejects an empty artifactContractVersion marker instead of reclassifying as legacy", () => {
    expect(() => summaryOf({ ...BASE, artifactContractVersion: "" } as unknown as JobtreadExport)).toThrow();
  });
  it("rejects an unknown/forged artifactContractVersion", () => {
    expect(() => summaryOf({ ...BASE, artifactContractVersion: "future-or-forged-version" } as unknown as JobtreadExport)).toThrow();
  });
});

// MICHAEL-A1-EXPORT-SURFACE-V4-QA-AND-CORRECTION.md: `summaryOf` (not only
// `detailOf`) now parses+cross-checks the manifest for every A1 row — this
// fixture needs a genuinely coherent manifest and every legacy-column mirror
// (contractVersion/skillId/reconciliationStatus/Cents), not only the fields
// the summary itself exposes.
// Export§5.1/§3.2: a ready manifest (no ESTIMATE_CLIENT_MISSING/CONTEXT_MISMATCH
// issue) always requires a real, non-null clientId — never null, regardless
// of the row's own default.
const CLIENT_ID = "b1000000-0000-4000-8000-000000000060";
const A1_READY_VALIDATION = { version: "internal-estimate-export-validation-v1", state: "valid", issues: [], reconciliation: { state: "matched", approvedTotalMinor: "10000", exportedTotalMinor: "10000", differenceMinor: "0", estimatedCostMinor: "8000" } };
const A1_READY_MANIFEST = {
  version: "internal-estimate-export-v1", format: "json", attemptKind: "preflight", outcome: "ready",
  exportId: "b1000000-0000-4000-8000-000000000001",
  context: { tenantId: "b1000000-0000-4000-8000-000000000010", projectId: "b1000000-0000-4000-8000-000000000020", clientId: CLIENT_ID, estimateDraftId: "b1000000-0000-4000-8000-000000000030", estimateVersion: 1, requestedBy: "b1000000-0000-4000-8000-000000000010" },
  authority: { approvalId: "b1000000-0000-4000-8000-000000000040", snapshotId: "b1000000-0000-4000-8000-000000000050", contentHash: "a".repeat(64) },
  checkedAt: "2026-10-01T01:00:00.000Z",
  lineKeys: ["line:1", "line:2"],
  validation: A1_READY_VALIDATION,
  representation: {
    format: "json", rendererVersion: EP.jsonRenderer, generatedAt: "2026-10-01T00:59:00.000Z", generatedBy: "b1000000-0000-4000-8000-000000000010",
    filename: buildExportFilename("b1000000-0000-4000-8000-000000000030", "b1000000-0000-4000-8000-000000000001", "json"),
    mimeType: "application/json", encoding: "utf8", artifactHash: "b".repeat(64), byteLength: 1234,
    details: { documentVersion: EP.document, serialization: EP.jsonSerialization },
  },
};
const A1_READY: JobtreadExport = {
  ...BASE, status: "approved_for_download", attemptKind: "preflight", artifactFormat: "json", clientId: CLIENT_ID,
  artifactContractVersion: "internal-estimate-export-v1", rowCount: 2,
  contractVersion: "internal-estimate-export-v1", skillId: "structr-internal-estimate-export",
  reconciliationStatus: "matched", approvedTotalCents: "10000", exportedTotalCents: "10000", differenceCents: "0",
  checkedAt: new Date("2026-10-01T01:00:00.000Z"),
  internalApprovalId: "b1000000-0000-4000-8000-000000000040",
  internalSnapshotId: "b1000000-0000-4000-8000-000000000050",
  approvedContentHash: "a".repeat(64),
  artifactHash: "b".repeat(64), artifactByteLength: 1234, rendererVersion: EP.jsonRenderer,
  generatedAt: new Date("2026-10-01T00:59:00.000Z"),
  validationReport: A1_READY_VALIDATION,
  manifest: A1_READY_MANIFEST,
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

  // MICHAEL-A1-EXPORT-SURFACE-V1-QA-AND-CORRECTION.md item 2: a malformed
  // manifest on a row whose own summary claims ready A1 evidence is a real
  // integrity failure — thrown, never silently degraded to manifest:null on
  // an otherwise-"successful" ready detail.
  it("detailOf throws on a malformed manifest instead of returning ready with manifest:null", () => {
    const malformedManifestRow = { ...A1_READY, manifest: { not: "a valid manifest" } };
    expect(() => detailOf(malformedManifestRow)).toThrow();
  });

  it("summaryOf rejects extra nested validation metadata smuggled into validationReport", () => {
    const bad = { ...A1_READY, validationReport: { ...(A1_READY.validationReport as object), rawPrivateMetadata: "MUST_NOT_LEAVE" } };
    expect(() => summaryOf(bad as unknown as JobtreadExport)).toThrow();
  });
});

describe("summaryOf — A1 blocked variant", () => {
  it("outcome:blocked, availability blocked, no artifact, authority null for an authority-null code", () => {
    const blockedValidation = { version: "internal-estimate-export-validation-v1", state: "not_evaluated", issues: [{ code: "INTERNAL_APPROVAL_REQUIRED", lineKey: null, field: null }], reconciliation: { state: "not_evaluated", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } };
    const row = {
      ...BASE, status: "blocked_authorization", blockReason: "INTERNAL_APPROVAL_REQUIRED", attemptKind: "delivery",
      artifactFormat: "pdf", artifactContractVersion: "internal-estimate-export-v1", clientId: CLIENT_ID,
      contractVersion: "internal-estimate-export-v1", skillId: "structr-internal-estimate-export",
      reconciliationStatus: "not_evaluated",
      checkedAt: new Date("2026-10-01T02:00:00.000Z"),
      validationReport: blockedValidation,
      manifest: {
        version: "internal-estimate-export-v1", format: "pdf", attemptKind: "delivery", outcome: "blocked",
        exportId: "b1000000-0000-4000-8000-000000000001",
        context: { tenantId: "b1000000-0000-4000-8000-000000000010", projectId: "b1000000-0000-4000-8000-000000000020", clientId: CLIENT_ID, estimateDraftId: "b1000000-0000-4000-8000-000000000030", estimateVersion: 1, requestedBy: "b1000000-0000-4000-8000-000000000010" },
        authority: null, checkedAt: "2026-10-01T02:00:00.000Z", lineKeys: [], validation: blockedValidation, representation: null,
      },
    } as unknown as JobtreadExport;
    const summary = summaryOf(row);
    expect(summary.outcome).toBe("blocked");
    expect(summary.availability).toBe("blocked");
    expect(summary.artifact).toBeNull();
    expect(summary.authority).toBeNull();
    expect(summary.kind).toBe("delivery");
  });
});
