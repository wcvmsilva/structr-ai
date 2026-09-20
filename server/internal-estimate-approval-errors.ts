/** Persistence errors stay separate from legacy estimate wrappers to avoid an import cycle. */
export class InternalApprovalPersistenceError extends Error {
  constructor(
    public readonly code:
      | "INTERNAL_APPROVAL_REQUEST_CONFLICT"
      | "INTERNAL_APPROVAL_ALREADY_DECIDED"
      | "PROFIT_SHIELD_CHANNEL_FLOOR"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INTERNAL_SERVER_ERROR"
  ) {
    super(`${code}: Internal approval operation could not be completed`);
    this.name = "InternalApprovalPersistenceError";
  }
}

/** Preserve the underlying audit failure without treating it as retryable database work. */
export class InternalApprovalAuditFailure extends Error {
  constructor(public readonly auditCause: unknown) {
    super(
      auditCause instanceof Error
        ? auditCause.message
        : "Internal approval audit failed"
    );
    this.name = "InternalApprovalAuditFailure";
  }
}
