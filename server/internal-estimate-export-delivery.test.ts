/**
 * Pure unit tests for the closed `DeliveredExport` response schema (QA V2 item
 * 2; MICHAEL-A1-EXPORT-DOWNLOAD-V1-QA-AND-CORRECTION.md). No database, no lab
 * gate. Targeted negative cases only — this does not duplicate the writer's
 * own already-proven engine validation matrix, only this schema's two newly
 * closed gaps (base64 canonicality via byte roundtrip; artifactHash
 * correspondence to the actual returned bytes) plus the structural checks
 * `delivered-parser-probe.mjs` already exercised against the PRE-fix schema.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deliveredExportSchema, parseDeliveredExport } from "../shared/internal-estimate-export-delivery";
import { buildExportFilename } from "../shared/internal-estimate-export-engine";

const EXPORT_ID = "b1111111-0000-4000-8000-000000000001";
const ESTIMATE_ID = "b1111111-0000-4000-8000-000000000002";
const APPROVAL_ID = "b1111111-0000-4000-8000-000000000003";
const SNAPSHOT_ID = "b1111111-0000-4000-8000-000000000004";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const jsonContent = '{"a":1}';
const jsonBytes = Buffer.from(jsonContent, "utf8");
const JSON_BASE = {
  exportId: EXPORT_ID, estimateId: ESTIMATE_ID, approvalId: APPROVAL_ID, snapshotId: SNAPSHOT_ID,
  contentHash: "c".repeat(64), artifactHash: sha256Hex(jsonBytes), format: "json" as const,
  filename: buildExportFilename(ESTIMATE_ID, EXPORT_ID, "json"),
  mimeType: "application/json", encoding: "utf8" as const,
  byteLength: jsonBytes.length, content: jsonContent,
};

const pdfByte = Buffer.from([0x66]); // 'f'
const PDF_BASE = {
  exportId: EXPORT_ID, estimateId: ESTIMATE_ID, approvalId: APPROVAL_ID, snapshotId: SNAPSHOT_ID,
  contentHash: "c".repeat(64), artifactHash: sha256Hex(pdfByte), format: "pdf" as const,
  filename: buildExportFilename(ESTIMATE_ID, EXPORT_ID, "pdf"),
  mimeType: "application/pdf", encoding: "base64" as const,
  byteLength: 1, content: "Zg==", // canonical base64 for 0x66
};

describe("deliveredExportSchema — closed DeliveredExport response DTO", () => {
  it("accepts a well-formed utf8 (json) delivery", async () => {
    expect((await deliveredExportSchema.safeParseAsync(JSON_BASE)).success).toBe(true);
  });
  it("accepts a well-formed base64 (pdf) delivery with canonical padding", async () => {
    expect((await deliveredExportSchema.safeParseAsync(PDF_BASE)).success).toBe(true);
  });

  it("rejects an extra top-level field", async () => {
    expect((await deliveredExportSchema.safeParseAsync({ ...JSON_BASE, canDownload: true })).success).toBe(false);
  });
  for (const field of ["url", "fileKey", "signedUrl", "accepted", "executable", "data"]) {
    it(`rejects a competing '${field}' field`, async () => {
      expect((await deliveredExportSchema.safeParseAsync({ ...JSON_BASE, [field]: "x" })).success).toBe(false);
    });
  }

  it("rejects an encoding that disagrees with the format (base64 for json)", async () => {
    expect((await deliveredExportSchema.safeParseAsync({ ...JSON_BASE, encoding: "base64" })).success).toBe(false);
  });
  it("rejects a mimeType that disagrees with the format", async () => {
    expect((await deliveredExportSchema.safeParseAsync({ ...JSON_BASE, mimeType: "text/plain" })).success).toBe(false);
  });
  it("rejects a filename that disagrees with the norm's own builder", async () => {
    expect((await deliveredExportSchema.safeParseAsync({ ...JSON_BASE, filename: "EST-wrong.json" })).success).toBe(false);
  });
  it("rejects a byteLength that disagrees with the actual decoded length (utf8)", async () => {
    expect((await deliveredExportSchema.safeParseAsync({ ...JSON_BASE, byteLength: JSON_BASE.byteLength + 1 })).success).toBe(false);
  });
  it("rejects a byteLength that disagrees with the actual decoded length (base64)", async () => {
    expect((await deliveredExportSchema.safeParseAsync({ ...PDF_BASE, byteLength: 2 })).success).toBe(false);
  });

  // QA V2 item 2's two concrete pre-fix defects, reproduced here as negative tests.
  it("rejects structurally-valid-but-non-canonical base64 padding ('Zh==' decodes the SAME byte as 'Zg==' but carries non-zero unused padding bits)", async () => {
    const result = await deliveredExportSchema.safeParseAsync({ ...PDF_BASE, content: "Zh==" });
    expect(result.success).toBe(false);
  });
  it("rejects an artifactHash that does not correspond to the actually-returned bytes, even though it is a well-formed 64 hex string", async () => {
    const result = await deliveredExportSchema.safeParseAsync({ ...JSON_BASE, artifactHash: "b".repeat(64) });
    expect(result.success).toBe(false);
  });
  it("rejects an artifactHash mismatch on base64-encoded content too", async () => {
    const result = await deliveredExportSchema.safeParseAsync({ ...PDF_BASE, artifactHash: "b".repeat(64) });
    expect(result.success).toBe(false);
  });

  it("parseDeliveredExport resolves for a well-formed delivery", async () => {
    await expect(parseDeliveredExport(JSON_BASE)).resolves.toMatchObject({ exportId: EXPORT_ID });
  });
  it("parseDeliveredExport rejects (never throws synchronously) for an invalid delivery", async () => {
    await expect(parseDeliveredExport({ ...JSON_BASE, artifactHash: "b".repeat(64) })).rejects.toThrow();
  });
});
