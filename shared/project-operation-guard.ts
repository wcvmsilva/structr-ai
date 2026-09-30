/**
 * structr.ai — Project negative payload barrier (Integration §5.3, partial).
 *
 * `createProject`/`updateProject`/`updateProjectStatus` must not let a generic payload
 * produce an operational projection (approved/in_progress/completed/closed) or write an
 * operational/financial field that belongs to a governed domain (actuals, budget,
 * variance). This module recognizes those keys/values only to refuse them — it is not a
 * financial mapping and creates no writer for any of them.
 *
 * Mirrors the shape of `shared/estimate-legacy-hold.ts`: a typed error a helper throws,
 * translated by the router to `PRECONDITION_FAILED`.
 */

export const PROJECT_OPERATION_BLOCKED_MESSAGE =
  "This field or status cannot be set through this operation.";

export class ProjectOperationBlockedError extends Error {
  readonly code = "EXECUTION_AUTHORITY_NOT_AVAILABLE" as const;
  constructor(readonly field: string) {
    super(PROJECT_OPERATION_BLOCKED_MESSAGE);
    this.name = "ProjectOperationBlockedError";
  }
}

/** `"closed"` is deliberately included even though it is absent from the current
 * `projects.status` enum and from the router's public `statusEnum` — the barrier does not
 * rely on either to reject it. */
export const PROJECT_FORBIDDEN_OPERATIONAL_STATUSES = [
  "approved", "in_progress", "completed", "closed",
] as const;

/** Direct helper fields plus the router's own alias names for the same governed data
 * (`estimatedValue`→estimatedTotal, `actualCost`→actualTotal, `grossProfit`, an alias the
 * helper has no field for at all, `profitShieldMinPct`). All are refused identically so a
 * payload cannot appear to "succeed" while the value is silently dropped. */
export const PROJECT_FORBIDDEN_OPERATIONAL_KEYS = [
  "estimatedTotal", "actualTotal", "variancePct", "startDate", "endDate",
  "estimatedValue", "actualCost", "grossProfit", "profitShieldMinPct",
] as const;

/**
 * Rejects the whole payload — never a partial apply — when it carries a forbidden key
 * with a defined value (explicit `null` included) or a forbidden status destination.
 * A key that is simply absent (`undefined`) is not a write and passes through untouched.
 */
export function assertNoOperationalProjectPayload(data: Record<string, unknown>): void {
  for (const key of PROJECT_FORBIDDEN_OPERATIONAL_KEYS) {
    if (data[key] !== undefined) throw new ProjectOperationBlockedError(key);
  }
  const status = data.status;
  if (
    status !== undefined &&
    (PROJECT_FORBIDDEN_OPERATIONAL_STATUSES as readonly unknown[]).includes(status)
  ) {
    throw new ProjectOperationBlockedError("status");
  }
}
