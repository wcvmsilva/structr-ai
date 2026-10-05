/**
 * A1 export — strict `DeliveredExport` response DTO (Export §9, line 329).
 * `server/internal-estimate-export-db.ts`'s `downloadExportAttempt` must parse
 * its return value through this schema before the final transaction's callback
 * resolves — no extra/competing field (no `url`/`fileKey`/`signedUrl`/`accepted`/
 * `executable`/stray `data`) leaves the writer, and a failure here aborts the
 * whole transaction (no partially-accepted delivery).
 *
 * Same house pattern as `shared/internal-estimate-export-attempt.ts`: a closed
 * Zod parser, not a hand-typed TS interface — the exact same class of gap that
 * schema's own history caught (a hand-typed interface is not a closed boundary
 * at runtime). Reuses already-public primitives/taxonomy/the engine's own
 * exported `buildExportFilename` — never a second, competing vocabulary.
 */
import { z } from "zod";
import { InternalApprovalError, internalApprovalVersionPrimitives as p } from "./internal-estimate-approval-engine";
import { EXPORT_FORMATS, EXPORT_RESPONSE_BYTE_LIMIT, type ExportFormat } from "./domain/taxonomy";
import { buildExportFilename } from "./internal-estimate-export-engine";

// Exported so the writer can CONSTRUCT a DeliveredExport with the correct
// mimeType/encoding directly, rather than guessing and letting this schema
// catch the mistake after the fact — single source of truth either way.
export const DELIVERED_EXPORT_MIME_BY_FORMAT: Record<ExportFormat, string> = {
  pdf: "application/pdf", json: "application/json", printable: "text/html", csv_jobtread: "text/csv",
};
export const DELIVERED_EXPORT_ENCODING_BY_FORMAT: Record<ExportFormat, "base64" | "utf8"> = {
  pdf: "base64", json: "utf8", printable: "utf8", csv_jobtread: "utf8",
};
/** Strict base64 (no internal whitespace, correctly padded) — accepting anything
 * `Buffer.from(x,"base64")` tolerates would let malformed content through. */
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const deliveredExportSchema = z.object({
  exportId: p.uuid, estimateId: p.uuid, approvalId: p.uuid, snapshotId: p.uuid,
  contentHash: p.hash, artifactHash: p.hash, format: z.enum(EXPORT_FORMATS),
  filename: z.string().min(1), mimeType: z.string().min(1), encoding: z.enum(["utf8", "base64"]),
  byteLength: z.number().int().min(1).max(EXPORT_RESPONSE_BYTE_LIMIT), content: z.string().min(1),
}).strict().superRefine((v, ctx) => {
  function fail(path: (string | number)[], message: string): void {
    ctx.addIssue({ code: "custom", path, message });
  }
  if (v.encoding !== DELIVERED_EXPORT_ENCODING_BY_FORMAT[v.format]) fail(["encoding"], "DELIVERED_EXPORT_ENCODING_FORMAT_MISMATCH");
  if (v.mimeType !== DELIVERED_EXPORT_MIME_BY_FORMAT[v.format]) fail(["mimeType"], "DELIVERED_EXPORT_MIME_TYPE_FORMAT_MISMATCH");
  if (v.filename !== buildExportFilename(v.estimateId, v.exportId, v.format)) fail(["filename"], "DELIVERED_EXPORT_FILENAME_MISMATCH");
  // byteLength is ALWAYS over decoded bytes, never text/base64 string length —
  // the norm's own explicit distinction (A1-EXPORT-DATA-CONTRACT.md §9).
  if (v.encoding === "base64") {
    if (!STRICT_BASE64.test(v.content)) {
      fail(["content"], "DELIVERED_EXPORT_CONTENT_NOT_STRICT_BASE64");
    } else {
      const decodedLength = Buffer.from(v.content, "base64").length;
      if (decodedLength !== v.byteLength) fail(["byteLength"], "DELIVERED_EXPORT_BYTE_LENGTH_MISMATCH");
    }
  } else {
    const decodedLength = Buffer.byteLength(v.content, "utf8");
    if (decodedLength !== v.byteLength) fail(["byteLength"], "DELIVERED_EXPORT_BYTE_LENGTH_MISMATCH");
  }
});
export type DeliveredExport = z.infer<typeof deliveredExportSchema>;

/** Throws INTERNAL_APPROVAL_INTEGRITY_ERROR — the writer's own invariant-failure
 * vocabulary — never a bespoke error type, and never a user-input-shaped code: a
 * failure here is this module's own construction being wrong, not caller input. */
export function parseDeliveredExport(value: unknown): DeliveredExport {
  const result = deliveredExportSchema.safeParse(value);
  if (!result.success) throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
  return result.data;
}
