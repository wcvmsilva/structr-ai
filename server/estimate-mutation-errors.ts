import { TRPCError } from "@trpc/server";
import { EstimateGuardError } from "./estimate-guard-error";
import { ProjectAccessError } from "./project-access";
import { HistoricalEstimateError } from "../shared/historical-estimate-engine";
import { mapHistoricalError } from "./historical-estimate-router";
import { InternalApprovalAuditFailure, InternalApprovalPersistenceError } from "./internal-estimate-approval-errors";
import { EstimateDiscountError } from "../shared/estimate-discount-engine";

/** Typed writer failures take precedence over legacy message-based transition handling. */
export function isEstimateMutationError(error: unknown): boolean {
  return error instanceof EstimateGuardError || error instanceof ProjectAccessError
    || error instanceof HistoricalEstimateError || error instanceof InternalApprovalAuditFailure
    || error instanceof InternalApprovalPersistenceError || error instanceof EstimateDiscountError;
}

/** Generic lifecycle routes expose actionable failures without leaking driver/audit details. */
export function mapEstimateMutationError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof EstimateDiscountError) {
    if (error.code === "ESTIMATE_DISCOUNT_PERCENT_INVALID") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The discount percentage must be a finite number between 0 and 50." });
    }
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The stored estimate subtotal must be corrected before applying a discount." });
  }
  if (error instanceof ProjectAccessError) throw new TRPCError({ code: error.code, message: error.message });
  if (error instanceof HistoricalEstimateError) return mapHistoricalError(error);
  if (error instanceof EstimateGuardError) {
    const codes: Record<string, TRPCError["code"]> = {
      ESTIMATE_CONTEXT_UNRESOLVED: "PRECONDITION_FAILED",
      ESTIMATE_VERSION_LOCKED: "CONFLICT",
      ESTIMATE_APPROVAL_REQUIRES_DEDICATED_ACTION: "BAD_REQUEST",
      PROFIT_SHIELD_CHANNEL_FLOOR: "PRECONDITION_FAILED",
      SCOPE_NOT_APPROVED: "PRECONDITION_FAILED",
    };
    throw new TRPCError({ code: codes[error.code] ?? "BAD_REQUEST", message: error.message });
  }
  if (error instanceof InternalApprovalPersistenceError) {
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") {
      throw new TRPCError({ code: error.code, message: "This estimate is not available to your account." });
    }
    if (error.code === "INTERNAL_APPROVAL_REQUEST_CONFLICT" || error.code === "INTERNAL_APPROVAL_ALREADY_DECIDED") {
      throw new TRPCError({ code: "CONFLICT", message: "The estimate changed during this request. Refresh it and try again." });
    }
  }
  // Do not attach an auditCause or raw database error as the public error cause.
  if (error instanceof InternalApprovalAuditFailure) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The estimate change could not be saved. Please try again." });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The estimate change could not be saved. Please try again." });
}

export function requireEstimateMutationTenant(tenantId: string | null): string {
  if (!tenantId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "An active company is required to change this estimate." });
  return tenantId;
}
