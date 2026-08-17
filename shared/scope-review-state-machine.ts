/**
 * structr.ai — Scope Review State Machine
 * Sprint 14: Scope Review Workspace
 *
 * Deterministic state machine for Scope Draft lifecycle.
 * Enforces strict transition rules — no invalid jumps allowed.
 *
 * States:
 *   draft → under_review → approved → converted
 *                        → rejected
 *
 * PHASE 2: `in_review` is accepted as a public alias of `under_review`, which remains
 * the persisted value. The Phase 2 contract names the review state `in_review`, but
 * renaming the stored value would invalidate every existing scope draft row, so the
 * alias is normalized at the boundary instead.
 *
 * Pure functions — no DB, no side effects.
 */

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export type ScopeDraftStatus =
  | "draft"
  | "under_review"
  | "approved"
  | "rejected"
  | "converted";

export interface StateTransitionResult {
  valid: boolean;
  from: ScopeDraftStatus;
  to: ScopeDraftStatus;
  error?: string;
}

/** Public alias accepted by the API for the review state. */
export const SCOPE_STATUS_ALIASES: Record<string, ScopeDraftStatus> = {
  in_review: "under_review",
  inreview: "under_review",
  "in review": "under_review",
  review: "under_review",
  pending_review: "under_review",
};

/**
 * Normalize any accepted representation of a scope status to the persisted value.
 * Unknown values are returned unchanged so callers can produce a precise error.
 */
export function normalizeScopeStatus(status: string): ScopeDraftStatus {
  const key = String(status ?? "").trim().toLowerCase();
  if ((ALL_STATES as readonly string[]).includes(key)) return key as ScopeDraftStatus;
  return SCOPE_STATUS_ALIASES[key] ?? (status as ScopeDraftStatus);
}

/** Statuses that satisfy the "approved scope" prerequisite for an estimate. */
export const ESTIMATE_READY_STATES: readonly ScopeDraftStatus[] = [
  "approved",
  "converted",
] as const;

/** True when a scope draft status authorizes estimate creation. */
export function isEstimateReady(status: string): boolean {
  return (ESTIMATE_READY_STATES as readonly string[]).includes(normalizeScopeStatus(status));
}

// ══════════════════════════════════════════════════════════════════════
// TRANSITION MAP
// ══════════════════════════════════════════════════════════════════════

/**
 * Allowed state transitions.
 * Key = current state, Value = set of valid next states.
 */
export const ALLOWED_TRANSITIONS: Record<ScopeDraftStatus, Set<ScopeDraftStatus>> = {
  draft: new Set<ScopeDraftStatus>(["under_review"]),
  under_review: new Set<ScopeDraftStatus>(["approved", "rejected"]),
  approved: new Set<ScopeDraftStatus>(["converted"]),
  rejected: new Set<ScopeDraftStatus>(),  // terminal state
  converted: new Set<ScopeDraftStatus>(), // terminal state
};

/**
 * All valid states in the lifecycle.
 */
export const ALL_STATES: readonly ScopeDraftStatus[] = [
  "draft",
  "under_review",
  "approved",
  "rejected",
  "converted",
] as const;

/**
 * Terminal states — no further transitions allowed.
 */
export const TERMINAL_STATES: readonly ScopeDraftStatus[] = [
  "rejected",
  "converted",
] as const;

/**
 * States where editing (delta application) is allowed.
 */
export const EDITABLE_STATES: readonly ScopeDraftStatus[] = [
  "under_review",
] as const;

// ══════════════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate whether a state transition is allowed.
 * Returns a structured result with error message if invalid.
 */
export function validateTransition(
  fromInput: ScopeDraftStatus,
  toInput: ScopeDraftStatus
): StateTransitionResult {
  const from = normalizeScopeStatus(fromInput);
  const to = normalizeScopeStatus(toInput);
  const allowed = ALLOWED_TRANSITIONS[from];

  if (!allowed) {
    return {
      valid: false,
      from,
      to,
      error: `Unknown state: '${from}'`,
    };
  }

  if (!allowed.has(to)) {
    return {
      valid: false,
      from,
      to,
      error: `Invalid transition: '${from}' → '${to}'. Allowed from '${from}': [${Array.from(allowed).join(", ")}]`,
    };
  }

  return { valid: true, from, to };
}

/**
 * Check if a transition is valid (boolean shorthand).
 */
export function isValidTransition(
  from: ScopeDraftStatus,
  to: ScopeDraftStatus
): boolean {
  return validateTransition(from, to).valid;
}

/**
 * Check if a state allows editing (delta application).
 */
export function isEditableState(status: ScopeDraftStatus): boolean {
  return (EDITABLE_STATES as readonly string[]).includes(normalizeScopeStatus(status));
}

/**
 * Check if a state is terminal (no further transitions).
 */
export function isTerminalState(status: ScopeDraftStatus): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(normalizeScopeStatus(status));
}

/**
 * Get the list of valid next states from a given state.
 */
export function getValidNextStates(from: ScopeDraftStatus): ScopeDraftStatus[] {
  const allowed = ALLOWED_TRANSITIONS[normalizeScopeStatus(from)];
  return allowed ? Array.from(allowed) : [];
}

/**
 * Assert a transition is valid — throws if not.
 * Use in router procedures for guard clauses.
 */
export function assertTransition(
  from: ScopeDraftStatus,
  to: ScopeDraftStatus
): void {
  const result = validateTransition(from, to);
  if (!result.valid) {
    throw new Error(result.error);
  }
}

/**
 * Assert a state is editable — throws if not.
 * Use in router procedures before applying deltas.
 */
export function assertEditable(status: ScopeDraftStatus): void {
  if (!isEditableState(status)) {
    throw new Error(
      `Scope draft in state '${status}' is not editable. Editing is only allowed in: [${EDITABLE_STATES.join(", ")}]`
    );
  }
}
