/**
 * A1 export preflight writer — strict `ExportAttemptSummary` response DTO (§9).
 * `server/internal-estimate-export-db.ts`'s `createExportAttempt` must parse its
 * return value through this schema before the final transaction's callback
 * resolves — no extra/competing field leaves the writer, and a failure here
 * aborts the whole transaction (no partially-accepted attempt).
 *
 * Reuses the SAME primitives/enums the already-accepted manifest engine uses
 * (`internalApprovalVersionPrimitives`, `EXPORT_*` taxonomy, the engine's own
 * `exportIssueOrderIsValid`) — never a second, competing vocabulary.
 * `internal-estimate-export-engine.ts`'s own envelope schemas (`issueSchema`,
 * `authoritySchema`, `validationSchema`, `lineKeySchema`, …) are private to that
 * module, which is off-limits to edit under this contract's boundaries — the
 * pieces below intentionally MIRROR those exact shapes rather than diverge from
 * them; they cannot be imported, only reproduced identically.
 */
import { z } from "zod";
import { InternalApprovalError, internalApprovalVersionPrimitives as p } from "./internal-estimate-approval-engine";
import {
  EXPORT_FORMATS, EXPORT_OUTCOMES, EXPORT_STATUSES, EXPORT_VALIDATION_STATES,
  EXPORT_RECONCILIATION_STATES, EXPORT_ISSUE_CODES, EXPORT_ISSUE_FIELDS,
} from "./domain/taxonomy";
import { exportIssueOrderIsValid } from "./internal-estimate-export-engine";

// Mirrors internal-estimate-export-engine.ts's private lineKeySchema exactly —
// that module cannot be edited to export it under this contract's boundaries.
const lineKeySchema = z.string().regex(/^line:([1-9][0-9]{0,2}|1000)$/);
const authoritySchema = z.object({ approvalId: p.uuid, snapshotId: p.uuid, contentHash: p.hash }).strict().nullable();
const issueSchema = z.object({
  code: z.enum(EXPORT_ISSUE_CODES), lineKey: lineKeySchema.nullable(), field: z.enum(EXPORT_ISSUE_FIELDS).nullable(),
}).strict();
const issuesArraySchema = z.array(issueSchema).max(4002).superRefine((v, ctx) => {
  if (!exportIssueOrderIsValid(v)) ctx.addIssue({ code: "custom", path: ["issues"], message: "EXPORT_ATTEMPT_ISSUES_UNORDERED" });
});
const reconciliationSchema = z.object({
  state: z.enum(EXPORT_RECONCILIATION_STATES), approvedTotalMinor: p.minor.nullable(),
  exportedTotalMinor: p.minor.nullable(), differenceMinor: p.signedMinor.nullable(), estimatedCostMinor: p.minor.nullable(),
}).strict();
const validationSchema = z.object({
  state: z.enum(EXPORT_VALIDATION_STATES), issues: issuesArraySchema, reconciliation: reconciliationSchema,
}).strict();
const artifactSchema = z.object({
  artifactHash: p.hash, byteLength: z.number().int().min(1).max(10_485_760),
  rendererVersion: z.string().min(1), generatedAt: p.timestamp,
}).strict().nullable();

export const exportAttemptSummarySchema = z.object({
  exportId: p.uuid, estimateId: p.uuid, format: z.enum(EXPORT_FORMATS), kind: z.literal("preflight"),
  outcome: z.enum(EXPORT_OUTCOMES), status: z.enum(EXPORT_STATUSES), checkedAt: p.timestamp,
  authority: authoritySchema, validation: validationSchema, artifact: artifactSchema,
  availability: z.enum(["requires_revalidation", "blocked"]),
}).strict().superRefine((v, ctx) => {
  const ready = v.outcome === "ready";
  if (ready !== (v.status === "approved_for_download" || v.status === "downloaded")) {
    ctx.addIssue({ code: "custom", path: ["status"], message: "EXPORT_ATTEMPT_OUTCOME_STATUS_MISMATCH" });
  }
  if (ready !== (v.availability === "requires_revalidation")) {
    ctx.addIssue({ code: "custom", path: ["availability"], message: "EXPORT_ATTEMPT_OUTCOME_AVAILABILITY_MISMATCH" });
  }
  if (ready !== (v.artifact !== null)) {
    ctx.addIssue({ code: "custom", path: ["artifact"], message: "EXPORT_ATTEMPT_OUTCOME_ARTIFACT_MISMATCH" });
  }
  if (ready && v.validation.issues.length !== 0) {
    ctx.addIssue({ code: "custom", path: ["validation", "issues"], message: "EXPORT_ATTEMPT_READY_WITH_ISSUES" });
  }
  if (!ready && v.validation.issues.length === 0) {
    ctx.addIssue({ code: "custom", path: ["validation", "issues"], message: "EXPORT_ATTEMPT_BLOCKED_WITHOUT_ISSUES" });
  }
});
export type ExportAttemptSummary = z.infer<typeof exportAttemptSummarySchema>;

/** Throws INTERNAL_APPROVAL_INTEGRITY_ERROR — the writer's own invariant-failure
 * vocabulary — never a bespoke error type, and never a user-input-shaped code: a
 * failure here is this module's own construction being wrong, not caller input. */
export function parseExportAttemptSummary(value: unknown): ExportAttemptSummary {
  const result = exportAttemptSummarySchema.safeParse(value);
  if (!result.success) throw new InternalApprovalError("INTERNAL_APPROVAL_INTEGRITY_ERROR");
  return result.data;
}
