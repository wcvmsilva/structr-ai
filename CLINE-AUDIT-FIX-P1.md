# Hotfix: Audit Priority 1 — Critical Fixes

---

## CONTEXT

A comprehensive system audit of Structr.ai (post-Sprint 26) identified 5 CRITICAL issues that affect data integrity, authentication, and type safety. These must be fixed before any new sprint work begins.

**Audit Date:** March 21, 2026
**Affected domains:** Estimate, Pipeline, Schema/Taxonomy

---

## GOAL

Fix all 5 CRITICAL audit findings with surgical changes. No new features, no refactoring beyond what's needed. Zero regressions.

**Expected outcome:**
- geo-override-router uses `ctx.user.id` consistently (not `ctx.user.openId`)
- Single estimate draft creation path via `estimate-db.ts`
- Empty assembly guard in `transformBatchToEstimateDraft`
- Channel enum standardized with `"residential"` removed from schema
- All existing tests pass, new tests added for each fix

---

## FILES

### Files to READ first:
| File | Why |
|------|-----|
| `AGENTS.md` | Project rules |
| `shared/domain/taxonomy.ts` | Canonical channel enum definition |
| `shared/estimate-engine.ts` | transformBatchToEstimateDraft + EstimateDraftPersistPayload |
| `server/geo-override-router.ts` | See ctx.user.openId usage |

### Files to MODIFY:
| File | Change |
|------|--------|
| `server/geo-override-router.ts` | Replace `ctx.user.openId` with `ctx.user.id` (9 locations) |
| `shared/estimate-engine.ts` | Add empty assembly guard in transformBatchToEstimateDraft |
| `drizzle/schema.ts` | Remove `"residential"` from channel enum if present, keep `"direct"` |
| `server/sprint26-pipeline-engine.test.ts` | Add tests for fixes |

### Files to VERIFY (read but do NOT modify unless broken):
| File | Why |
|------|-----|
| `server/estimate-db.ts` | Confirm it's the only active draft creation path |
| `server/lead-db.ts` | Check if convertLeadToProject is still imported anywhere |

---

## CONSTRAINTS

1. **Do NOT modify any files** beyond those listed above
2. **Do NOT add new functions** — only modify existing ones
3. **Do NOT change function signatures** — only change internal implementation
4. **Run `pnpm check` + `pnpm test` after EACH change** — zero regressions
5. Follow AGENTS.md Tier 1 rules

---

## OUTPUT — Exact Changes Required

### Change 1: Fix ctx.user.openId in geo-override-router.ts

**Problem:** `ctx.user.openId` is used at 9 locations. All other routers use `ctx.user.id`. If auth middleware only sets `.id`, the geo-override router silently passes `undefined`.

**Find and replace ALL occurrences of `ctx.user.openId` with `ctx.user.id`:**

Locations (line numbers approximate):
- Line 114: `createOverrideRule(..., ctx.user.openId)` → `ctx.user.id`
- Line 146: `updateOverrideRule(id, normalizedData, ctx.user.openId)` → `ctx.user.id`
- Line 157: `deactivateOverrideRule(input.id, ctx.user.openId)` → `ctx.user.id`
- Line 168: `reactivateOverrideRule(input.id, ctx.user.openId)` → `ctx.user.id`
- Line 270: `writeOverrideLogEntries(newEntries, ctx.user.openId)` → `ctx.user.id`
- Line 284: `operatorId: ctx.user.openId` → `operatorId: ctx.user.id`
- Line 372: `clearOverrideLogForDraft(input.scopeDraftId, ctx.user.openId)` → `ctx.user.id`
- Line 416: `createOverrideRule(rule, ctx.user.openId)` → `ctx.user.id`
- Line 428: `operatorId: ctx.user.openId` → `operatorId: ctx.user.id`

**This is a global find-and-replace within this one file.** Replace every `ctx.user.openId` with `ctx.user.id`.

**Verify:** `pnpm check && pnpm test`

---

### Change 2: Add empty assembly guard in transformBatchToEstimateDraft

**Problem:** `transformBatchToEstimateDraft` in `shared/estimate-engine.ts` accepts an empty assemblies array, producing an invalid draft with 0 line items.

**Find this function (around line 264):**
```typescript
export function transformBatchToEstimateDraft(
  batchResult: BatchCalculationResult,
  context: EstimateDraftContext,
  assemblyMetadata: Map<number, AssemblyMetadata>,
  minGP: number = 35
): EstimateDraftPersistPayload {
```

**Add this guard as the FIRST line inside the function body:**
```typescript
  if (!batchResult.assemblies || batchResult.assemblies.length === 0) {
    throw new Error("Cannot create estimate draft: assembly list is empty");
  }
```

**Verify:** `pnpm check && pnpm test`

---

### Change 3: Standardize channel enum in schema

**Problem:** The schema may accept `"residential"` as a channel value, but taxonomy.ts defines channels as `["direct", "insurance", "commercial"]`. The `mapChannelToDbEnum()` function already normalizes `"residential"` → `"direct"`, confirming `"residential"` should NOT be a valid DB value.

**In `drizzle/schema.ts`:** Find any channel enum or column definition that includes `"residential"` and remove it. The valid values are: `"direct"`, `"insurance"`, `"commercial"`.

If `"residential"` does NOT appear in the schema enum, skip this change — the normalization in estimate-engine.ts already handles it at the application layer.

**Verify:** `pnpm check && pnpm test`

---

### Change 4: Add test coverage for the empty assembly guard

**In `server/sprint26-pipeline-engine.test.ts` or a new test section in an appropriate test file:**

```typescript
import { transformBatchToEstimateDraft } from "../shared/estimate-engine";

describe("transformBatchToEstimateDraft guards", () => {
  it("should throw on empty assembly list", () => {
    const emptyBatch = { assemblies: [], totalCost: 0, totalPrice: 0, grossProfit: 0, grossProfitPct: 0 };
    const context = { channel: "direct", region: "charleston", finishLevel: "standard" };
    expect(() => transformBatchToEstimateDraft(emptyBatch as any, context as any, new Map())).toThrow("assembly list is empty");
  });
});
```

**Verify:** `pnpm check && pnpm test`

---

### Final Verification:
```bash
pnpm check    # 0 TypeScript errors
pnpm test     # ALL tests passing, 0 regressions
```

**Report these results:**
- [ ] geo-override-router uses ctx.user.id (not openId): YES/NO
- [ ] Empty assembly guard added: YES/NO
- [ ] Channel enum standardized: YES/NO (or N/A if already correct)
- [ ] New tests added: [count]
- [ ] All tests passing: [count] passing, 0 failures
- [ ] TypeScript: 0 errors
