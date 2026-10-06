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
import { sha256HexOfBytes } from "./internal-estimate-export-renderer";

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

/**
 * MICHAEL-A1-EXPORT-SURFACE-V1-QA-AND-CORRECTION.md (post-checkpoint note,
 * 2026-10-06T03-23-17-780Z-489942): this module is imported by the CLIENT now
 * (EstimateDetail.tsx's `validateAndDownload`), not only by the server
 * writers that originally accepted it — `Buffer` is a Node global, never
 * guaranteed in a real browser bundle (Vite does not polyfill it by
 * default). `sha256HexOfBytes` was already Web-Crypto-portable; these two
 * helpers replace the remaining `Buffer.from`/`.toString("base64")` calls
 * with `atob`/`btoa` + `TextEncoder` — both standard in browsers AND in
 * Node (global since Node 16+) — preserving byte-for-byte the SAME
 * canonicality/length semantics `Buffer` gave: `base64Decode` only ever
 * runs after `STRICT_BASE64` already accepted the input, and `base64Encode`
 * chunks the re-encode so a large (up to the 10 MiB response limit) byte
 * array never blows the call stack via a spread/`apply` on the whole array.
 */
function base64Decode(content: string): Uint8Array {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function base64Encode(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export const deliveredExportSchema = z.object({
  exportId: p.uuid, estimateId: p.uuid, approvalId: p.uuid, snapshotId: p.uuid,
  contentHash: p.hash, artifactHash: p.hash, format: z.enum(EXPORT_FORMATS),
  filename: z.string().min(1), mimeType: z.string().min(1), encoding: z.enum(["utf8", "base64"]),
  byteLength: z.number().int().min(1).max(EXPORT_RESPONSE_BYTE_LIMIT), content: z.string().min(1),
}).strict().superRefine(async (v, ctx) => {
  function fail(path: (string | number)[], message: string): void {
    ctx.addIssue({ code: "custom", path, message });
  }
  if (v.encoding !== DELIVERED_EXPORT_ENCODING_BY_FORMAT[v.format]) fail(["encoding"], "DELIVERED_EXPORT_ENCODING_FORMAT_MISMATCH");
  if (v.mimeType !== DELIVERED_EXPORT_MIME_BY_FORMAT[v.format]) fail(["mimeType"], "DELIVERED_EXPORT_MIME_TYPE_FORMAT_MISMATCH");
  if (v.filename !== buildExportFilename(v.estimateId, v.exportId, v.format)) fail(["filename"], "DELIVERED_EXPORT_FILENAME_MISMATCH");
  // byteLength is ALWAYS over decoded bytes, never text/base64 string length —
  // the norm's own explicit distinction (A1-EXPORT-DATA-CONTRACT.md §9).
  let bytes: Uint8Array | null = null;
  if (v.encoding === "base64") {
    // Structural validity is not canonicality (QA V2 item 2): "Zh==" is a
    // well-formed base64 token (passes STRICT_BASE64) that decodes to the
    // SAME byte as the canonical "Zg==", but carries non-zero unused padding
    // bits. Only a real decode -> re-encode byte roundtrip catches that.
    if (!STRICT_BASE64.test(v.content)) {
      fail(["content"], "DELIVERED_EXPORT_CONTENT_NOT_STRICT_BASE64");
    } else {
      let decoded: Uint8Array;
      try { decoded = base64Decode(v.content); }
      catch { fail(["content"], "DELIVERED_EXPORT_CONTENT_NOT_STRICT_BASE64"); decoded = new Uint8Array(0); }
      if (base64Encode(decoded) !== v.content) {
        fail(["content"], "DELIVERED_EXPORT_CONTENT_NOT_STRICT_BASE64");
      } else {
        bytes = decoded;
        if (decoded.length !== v.byteLength) fail(["byteLength"], "DELIVERED_EXPORT_BYTE_LENGTH_MISMATCH");
      }
    }
  } else {
    bytes = new TextEncoder().encode(v.content);
    if (bytes.length !== v.byteLength) fail(["byteLength"], "DELIVERED_EXPORT_BYTE_LENGTH_MISMATCH");
  }
  // artifactHash must correspond to the ACTUALLY returned bytes, never merely
  // be well-formed 64 hex chars in isolation (QA V2 item 2) — reuses the same
  // raw-bytes SHA-256 helper every accepted renderer already uses, never a
  // new crypto policy or a synchronous concurrent hash.
  if (bytes !== null) {
    const actualHash = await sha256HexOfBytes(bytes as Uint8Array<ArrayBuffer>);
    if (actualHash !== v.artifactHash) fail(["artifactHash"], "DELIVERED_EXPORT_ARTIFACT_HASH_MISMATCH");
  }
});
export type DeliveredExport = z.infer<typeof deliveredExportSchema>;

/** Throws INTERNAL_APPROVAL_INTEGRITY_ERROR — the writer's own invariant-failure
 * vocabulary — never a bespoke error type, and never a user-input-shaped code: a
 * failure here is this module's own construction being wrong, not caller input.
 * Async (QA V2 item 2: hash-correspondence needs the accepted async SHA-256
 * helper) — the caller must complete this before commit/return, never render
 * inside a retryable transaction callback. */
export async function parseDeliveredExport(value: unknown): Promise<DeliveredExport> {
  const result = await deliveredExportSchema.safeParseAsync(value);
  if (!result.success) throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
  return result.data;
}
