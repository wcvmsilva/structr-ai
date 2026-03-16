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
  from: ScopeDraftStatus,
  to: ScopeDraftStatus
): StateTransitionResult {
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
  return (EDITABLE_STATES as readonly string[]).includes(status);
}

/**
 * Check if a state is terminal (no further transitions).
 */
export function isTerminalState(status: ScopeDraftStatus): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(status);
}

/**
 * Get the list of valid next states from a given state.
 */
export function getValidNextStates(from: ScopeDraftStatus): ScopeDraftStatus[] {
  const allowed = ALLOWED_TRANSITIONS[from];
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
