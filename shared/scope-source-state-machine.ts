/**
 * structr.ai — Scope Source Review State Machine
 * TakeOff V1: Deterministic status transitions for scope sources
 *
 * Pure functions — no DB, no side effects.
 * Mirrors pattern from shared/scope-review-state-machine.ts
 *
 * States:
 *   pending → partial → approved → (finalize)
 *                     → rejected → pending (reopen)
 */

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export type ReviewStatus = "pending" | "partial" | "approved" | "rejected";

export interface ReviewTransitionResult {
  valid: boolean;
  from: string;
  to: string;
  error?: string;
}

// ══════════════════════════════════════════════════════════════════════
// TRANSITION MAP
// ══════════════════════════════════════════════════════════════════════

export const ALLOWED_REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  pending: ["partial", "approved", "rejected"],
  partial: ["approved", "rejected"],
  approved: ["rejected"],
  rejected: ["pending"],
};

export const ALL_REVIEW_STATUSES: readonly ReviewStatus[] = [
  "pending",
  "partial",
  "approved",
  "rejected",
] as const;

// ══════════════════════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════════════════════

export function validateReviewTransition(
  from: string,
  to: string
): ReviewTransitionResult {
  const allowed = ALLOWED_REVIEW_TRANSITIONS[from as ReviewStatus];
  if (!allowed) {
    return { valid: false, from, to, error: `Unknown current status: "${from}"` };
  }
  if (!allowed.includes(to as ReviewStatus)) {
    return {
      valid: false,
      from,
      to,
      error: `Transition "${from}" → "${to}" is not allowed. Valid transitions: ${allowed.join(", ")}`,
    };
  }
  return { valid: true, from, to };
}
