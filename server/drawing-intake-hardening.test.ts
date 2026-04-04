/**
 * structr.ai — Drawing Intake Layer Hardening Tests
 * TakeOff V1: Tests for audit blocker fixes B1–B3
 *
 * 1. validateReviewTransition — pure state machine unit tests
 * 2. setActiveRevision — deactivation logic correctness
 * 3. finalize alreadyFinalized — idempotent return path
 *
 * Tests 2 & 3 are structural/contract tests that verify the logic
 * without requiring a live database (import checks + pure-function paths).
 */

import { describe, it, expect } from "vitest";
import {
  validateReviewTransition,
  ALLOWED_REVIEW_TRANSITIONS,
  ALL_REVIEW_STATUSES,
  type ReviewStatus,
} from "../shared/scope-source-state-machine";

// ══════════════════════════════════════════════════════════════════════
// 1. validateReviewTransition — full coverage
// ══════════════════════════════════════════════════════════════════════

describe("validateReviewTransition", () => {
  // ── Valid transitions ──────────────────────────────────────────────

  describe("allowed transitions", () => {
    const validCases: [ReviewStatus, ReviewStatus][] = [
      // from pending
      ["pending", "partial"],
      ["pending", "approved"],
      ["pending", "rejected"],
      // from partial
      ["partial", "approved"],
      ["partial", "rejected"],
      // from approved
      ["approved", "rejected"],
      // from rejected
      ["rejected", "pending"],
    ];

    for (const [from, to] of validCases) {
      it(`allows "${from}" → "${to}"`, () => {
        const result = validateReviewTransition(from, to);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });
    }
  });

  // ── Blocked transitions ────────────────────────────────────────────

  describe("blocked transitions", () => {
    const blockedCases: [ReviewStatus, ReviewStatus, string][] = [
      // Cannot go backwards
      ["partial", "pending", "cannot revert partial to pending"],
      ["approved", "pending", "cannot revert approved to pending"],
      ["approved", "partial", "cannot revert approved to partial"],
      // Cannot skip rejected → approved (must go through pending)
      ["rejected", "approved", "rejected cannot jump to approved"],
      ["rejected", "partial", "rejected cannot jump to partial"],
      ["rejected", "rejected", "rejected cannot self-transition"],
      // No self-transitions
      ["pending", "pending", "pending cannot self-transition"],
      ["partial", "partial", "partial cannot self-transition"],
      ["approved", "approved", "approved cannot self-transition"],
    ];

    for (const [from, to, reason] of blockedCases) {
      it(`blocks "${from}" → "${to}" (${reason})`, () => {
        const result = validateReviewTransition(from, to);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain("not allowed");
      });
    }
  });

  // ── Unknown status handling ────────────────────────────────────────

  describe("unknown status", () => {
    it("rejects unknown 'from' status", () => {
      const result = validateReviewTransition("garbage", "approved");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown current status");
    });

    it("rejects empty string as 'from'", () => {
      const result = validateReviewTransition("", "pending");
      expect(result.valid).toBe(false);
    });

    it("rejects unknown 'to' status against valid 'from'", () => {
      const result = validateReviewTransition("pending", "finalized");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not allowed");
    });
  });

  // ── Transition map completeness ────────────────────────────────────

  describe("transition map completeness", () => {
    it("every status in ALL_REVIEW_STATUSES has an entry in ALLOWED_REVIEW_TRANSITIONS", () => {
      for (const status of ALL_REVIEW_STATUSES) {
        expect(ALLOWED_REVIEW_TRANSITIONS[status]).toBeDefined();
      }
    });

    it("approved only allows rejected (single exit before finalize)", () => {
      expect(ALLOWED_REVIEW_TRANSITIONS.approved).toEqual(["rejected"]);
    });

    it("rejected only allows pending (reopen for re-review)", () => {
      expect(ALLOWED_REVIEW_TRANSITIONS.rejected).toEqual(["pending"]);
    });

    it("no status allows transition to itself", () => {
      for (const status of ALL_REVIEW_STATUSES) {
        const allowed = ALLOWED_REVIEW_TRANSITIONS[status];
        expect(allowed).not.toContain(status);
      }
    });

    it("all transition targets are valid statuses", () => {
      for (const status of ALL_REVIEW_STATUSES) {
        for (const target of ALLOWED_REVIEW_TRANSITIONS[status]) {
          expect(ALL_REVIEW_STATUSES).toContain(target);
        }
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. setActiveRevision — deactivation contract
// ══════════════════════════════════════════════════════════════════════

describe("setActiveRevision deactivation contract", () => {
  /**
   * These tests verify the B3 fix structurally by reading the implementation.
   * The original bug was: deactivation was gated behind `if (target.sheetLabel)`.
   * After the fix, deactivation is unconditional.
   *
   * We verify this by importing and inspecting the source code,
   * since the function requires a live DB for full integration testing.
   */

  it("drawing-db.ts setActiveRevision does NOT gate deactivation on sheetLabel", async () => {
    // Read the source file and verify the B3 fix is in place
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./drawing-db.ts", import.meta.url).pathname,
      "utf-8"
    );

    // The original bug had: if (target.sheetLabel) { ... deactivate ... }
    // After fix: deactivation is unconditional
    const setActiveRevisionBlock = source.slice(
      source.indexOf("async function setActiveRevision"),
      source.indexOf("async function deleteProjectDrawing")
    );

    // Must NOT contain the conditional guard
    expect(setActiveRevisionBlock).not.toContain("if (target.sheetLabel)");

    // Must contain unconditional deactivation
    expect(setActiveRevisionBlock).toContain("isActiveRevision: false");
    expect(setActiveRevisionBlock).toContain("isActiveRevision: true");

    // The deactivation must come BEFORE the activation
    const deactivatePos = setActiveRevisionBlock.indexOf("isActiveRevision: false");
    const activatePos = setActiveRevisionBlock.indexOf("isActiveRevision: true");
    expect(deactivatePos).toBeLessThan(activatePos);
  });

  it("deactivation targets all project drawings (projectId filter, not sheetLabel filter)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./drawing-db.ts", import.meta.url).pathname,
      "utf-8"
    );

    const setActiveRevisionBlock = source.slice(
      source.indexOf("async function setActiveRevision"),
      source.indexOf("async function deleteProjectDrawing")
    );

    // Must filter by projectId when deactivating
    expect(setActiveRevisionBlock).toContain("projectDrawings.projectId");

    // Must filter by isActiveRevision: true (only deactivate active ones)
    expect(setActiveRevisionBlock).toContain("projectDrawings.isActiveRevision");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. finalize alreadyFinalized — idempotent return contract
// ══════════════════════════════════════════════════════════════════════

describe("finalize alreadyFinalized return contract", () => {
  /**
   * The finalize endpoint's transaction has two code paths:
   *   1. Normal: creates draft + items + links → returns { alreadyFinalized: false }
   *   2. Idempotent: detects scopeDraftId already set → returns { alreadyFinalized: true }
   *
   * Since the router requires a live DB + auth context, we verify the
   * contract structurally: the source must contain both paths and the
   * return shape must differ correctly.
   */

  it("scope-source-router.ts finalize contains transactional idempotency re-check", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./scope-source-router.ts", import.meta.url).pathname,
      "utf-8"
    );

    // Must use db.transaction
    expect(source).toContain("db.transaction(async (tx)");

    // Must re-read scopeDraftId INSIDE the transaction
    expect(source).toContain("scopeSources.scopeDraftId");
    expect(source).toContain("freshSource?.scopeDraftId");

    // Must have the two return paths
    expect(source).toContain("alreadyFinalized: true");
    expect(source).toContain("alreadyFinalized: false");
  });

  it("idempotent path returns existing scopeDraftId without creating new rows", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./scope-source-router.ts", import.meta.url).pathname,
      "utf-8"
    );

    // Extract the transaction block
    const txStart = source.indexOf("db.transaction(async (tx)");
    const txEnd = source.indexOf("// ── Step 5: Audit");
    const txBlock = source.slice(txStart, txEnd);

    // The idempotent return must happen BEFORE any insert
    const idempotentReturn = txBlock.indexOf("alreadyFinalized: true");
    const firstInsert = txBlock.indexOf("tx.insert(");
    expect(idempotentReturn).toBeLessThan(firstInsert);

    // The idempotent path returns the EXISTING scopeDraftId
    expect(txBlock).toContain("freshSource.scopeDraftId");
  });

  it("normal path creates draft, items, and links atomically within transaction", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./scope-source-router.ts", import.meta.url).pathname,
      "utf-8"
    );

    const txStart = source.indexOf("db.transaction(async (tx)");
    const txEnd = source.indexOf("// ── Step 5: Audit");
    const txBlock = source.slice(txStart, txEnd);

    // All three operations must use `tx` (not `db`)
    expect(txBlock).toContain("tx.insert(scopeDrafts)");
    expect(txBlock).toContain("tx.insert(scopeDraftItems)");
    expect(txBlock).toContain(".update(scopeSources)");

    // The link update must set scopeDraftId
    expect(txBlock).toContain("scopeDraftId: draft.id");
  });

  it("response shape includes alreadyFinalized flag for callers to distinguish", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./scope-source-router.ts", import.meta.url).pathname,
      "utf-8"
    );

    // The final return block must expose alreadyFinalized
    const returnBlock = source.slice(source.lastIndexOf("return {"));
    expect(returnBlock).toContain("alreadyFinalized:");
    expect(returnBlock).toContain("scopeDraftId:");
    expect(returnBlock).toContain("itemCount:");
    expect(returnBlock).toContain("warnings:");
  });

  it("audit differentiates between first finalize and idempotent return", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("./scope-source-router.ts", import.meta.url).pathname,
      "utf-8"
    );

    // Two distinct audit actions
    expect(source).toContain("scope_source.finalize_idempotent");
    expect(source).toContain("scope_source.finalized");
  });
});
