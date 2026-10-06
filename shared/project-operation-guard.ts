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

/**
 * A syntactically-recognized status that is neither one of the four operationally-forbidden
 * destinations nor a legal next hop from the row's current status (project-db.ts's
 * STATUS_TRANSITIONS / assertValidStatusTransition). Distinct from
 * ProjectOperationBlockedError: the value was never a policy violation, just not a state
 * machine transition that exists — the router maps it to BAD_REQUEST, not
 * PRECONDITION_FAILED, and it is only ever thrown AFTER authorization has already run.
 */
export class ProjectStatusTransitionInvalidError extends Error {
  readonly code = "PROJECT_STATUS_TRANSITION_INVALID" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProjectStatusTransitionInvalidError";
  }
}

/**
 * The database's own mandatory reopen-formation gate (drizzle/0012_project_reopen_
 * provenance.sql) refused an exit from 'cancelled' because provenance_state was not
 * exactly 'formation_only' at the end of the statement. This is thrown only by the
 * matcher in project-db.ts that inspects the raw driver error AFTER db.transaction(...)
 * has already rejected/rolled back — never a guess from message text, and never for a
 * different SQLSTATE/constraint (those surface as-is, unreclassified).
 */
export class ProjectReopenNotVerifiedError extends Error {
  readonly code = "PROJECT_REOPEN_FORMATION_NOT_VERIFIED" as const;
  constructor() {
    super("This project cannot be reopened until its formation is verified.");
    this.name = "ProjectReopenNotVerifiedError";
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
 * payload cannot appear to "succeed" while the value is silently dropped.
 *
 * `approvedBudgetCents`/`changeOrderBudgetCents`: both columns exist (drizzle/schema.ts)
 * but were absent from this list, so a payload carrying either was silently stripped by
 * the router's Zod schema before ever reaching this function — the exact partial-success
 * gap the other 9 keys already close. A1-INTEGRATION-CONTRACT.md:130 names "budget" in the
 * same sentence as the fields already barred here; :98 separately names both fields in the
 * CO-materialization prohibition. These routes do not allow editing budget: this function
 * recognizes both keys only to refuse the whole payload, same as the other 9 — it creates
 * no writer for either field. */
/**
 * `provenanceState` (drizzle/0012_project_reopen_provenance.sql): the database computes
 * this column itself, from its own triggers, against a strict positive INSERT set and a
 * permanent UPDATE ratchet — never from a caller-supplied value. Recognized here only so
 * a payload carrying any defined value (including explicit `null`) is refused wholesale,
 * same as the other 12 keys; `undefined` (the key simply absent) is not a write.
 */
export const PROJECT_FORBIDDEN_OPERATIONAL_KEYS = [
  "estimatedTotal", "actualTotal", "variancePct", "startDate", "endDate",
  "estimatedValue", "actualCost", "grossProfit", "profitShieldMinPct",
  "approvedBudgetCents", "changeOrderBudgetCents", "provenanceState",
] as const;

/**
 * Rejects the whole payload — never a partial apply — when it carries a forbidden key
 * with a defined value (explicit `null` included) or a status this call does not allow.
 * A key that is simply absent (`undefined`) is not a write and passes through untouched.
 *
 * `allowFormationStatus` defaults to `false`: ANY defined status is refused unless the
 * caller explicitly opts in. This is deliberately NOT the router's default for
 * `project.update` — a prior candidate let a formation/cancellation status (e.g.
 * "estimating") through this generic, write-permission-only route, which meant an actor
 * with "write" but not "approve" (e.g. the "field" project role) could reach formation/
 * cancellation transitions that the dedicated, approve-gated `project.updateStatus` route
 * correctly denies them. `updateProject()` passes `true` here ONLY when an explicit,
 * trusted, non-payload-derived option asks for it (its own `options.allowFormationStatus`
 * parameter) — never derived from the request body, and never set by the public router's
 * `update` mutation. `create` always passes `false`: it has no current row to check a
 * transition against and no contract authorizes a caller-chosen initial status at all.
 */
export function assertNoOperationalProjectPayload(
  data: Record<string, unknown>,
  options?: { allowFormationStatus?: boolean },
): void {
  for (const key of PROJECT_FORBIDDEN_OPERATIONAL_KEYS) {
    if (data[key] !== undefined) throw new ProjectOperationBlockedError(key);
  }
  const status = data.status;
  if (status === undefined) return;
  const allowFormation = options?.allowFormationStatus ?? false;
  if (!allowFormation || (PROJECT_FORBIDDEN_OPERATIONAL_STATUSES as readonly unknown[]).includes(status)) {
    throw new ProjectOperationBlockedError("status");
  }
}
