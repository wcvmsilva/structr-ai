/** Stable errors shared by estimate formation and lifecycle writers. */
export type EstimateGuardCode =
  | "ESTIMATE_CONTEXT_UNRESOLVED"
  | "ESTIMATE_VERSION_LOCKED"
  | "ESTIMATE_APPROVAL_REQUIRES_DEDICATED_ACTION"
  | "PROFIT_SHIELD_CHANNEL_FLOOR"
  | "SCOPE_NOT_APPROVED";

export class EstimateGuardError extends Error {
  constructor(
    public readonly code: EstimateGuardCode,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "EstimateGuardError";
  }
}
