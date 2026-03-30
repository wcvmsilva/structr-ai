# Hotfix: Audit Priority 2 — Serious Fixes

---

## CONTEXT

After fixing Priority 1 (Critical) items from the system audit, these Priority 2 (Serious) issues remain. They don't cause data corruption but create maintenance debt, duplicate code paths, and security gaps.

**Prerequisite:** CLINE-AUDIT-FIX-P1.md must be completed first.

---

## GOAL

Fix all 8 SERIOUS audit findings. Clean up dead code, remove duplicate entry points, fix async patterns, and convert public endpoints to protected. Zero regressions.

**Expected outcome:**
- Single lead conversion entry point (lead-router only)
- Dead code removed from lead-db.ts
- bundle-router.ts getDb() pattern fixed
- publicProcedure endpoints converted to protectedProcedure
- Unused imports cleaned from routers.ts
- All tests pass, new tests where needed

---

## FILES

### Files to READ first:
| File | Why |
|------|-----|
| `AGENTS.md` | Project rules |
| `server/pipeline-router.ts` | See convertLead duplicate procedure |
| `server/lead-db.ts` | See dead convertLeadToProject function |
| `server/bundle-router.ts` | See broken getDb() pattern |

### Files to MODIFY:
| File | Change |
|------|--------|
| `server/pipeline-router.ts` | Remove `convertLead` procedure (duplicate of lead-router.convertToProject) |
| `server/lead-db.ts` | Remove `convertLeadToProject` function (dead code, replaced by pipeline-db.ts) |
| `server/bundle-router.ts` | Fix getDb().then() chaining at line ~121 |
| `server/assembly-router.ts` | Convert publicProcedure → protectedProcedure (9 procedures) |
| `server/pricing-router.ts` | Convert publicProcedure → protectedProcedure (all procedures) |
| `server/preset-router.ts` | Convert publicProcedure → protectedProcedure (list procedure) |
| `server/routers.ts` | Remove unused imports (validateQuantity, transformBundleToEstimateDraft) |

---

## CONSTRAINTS

1. **Do NOT modify schema or engine files** — this is cleanup only
2. **Do NOT change function signatures** in DB helpers
3. **Do NOT add new functions** — only modify/remove existing ones
4. **Run `pnpm check` + `pnpm test` after EACH change** — zero regressions
5. Follow AGENTS.md Tier 1 rules
6. **auth.me and auth.logout MUST remain publicProcedure** — do NOT convert those

---

## OUTPUT — Exact Changes Required

### Change 1: Remove duplicate convertLead from pipeline-router.ts

**Problem:** `orchestrateLeadConversion` is callable from both `lead-router.convertToProject` AND `pipeline-router.convertLead`. Two entry points for the same atomic transaction.

**In `server/pipeline-router.ts`, find and DELETE the entire `convertLead` procedure (lines ~26-37):**
```typescript
  convertLead: protectedProcedure
    .input(z.object({ leadId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await orchestrateLeadConversion(input.leadId, ctx.user.id);
      } catch (error: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to convert lead: ${error.message}`,
        });
      }
    }),
```

Also remove the `orchestrateLeadConversion` import from the top of the file IF it's no longer used by any other procedure in this file. Check first — `orchestrateDealWin` may also be imported from the same source.

**Verify:** `pnpm check && pnpm test`

---

### Change 2: Remove dead convertLeadToProject from lead-db.ts

**Problem:** The old `convertLeadToProject` function (lines ~111-168) still exists but is no longer called — `lead-router.ts` now uses `orchestrateLeadConversion` from `pipeline-db.ts`.

**Step 1:** Search the entire codebase for any remaining imports of `convertLeadToProject`:
```bash
grep -r "convertLeadToProject" --include="*.ts" --include="*.tsx"
```

**Step 2:** If ONLY `lead-db.ts` defines it and NO other file imports it, DELETE the entire function (lines ~111-168).

**Step 3:** Also remove any imports this function uses that are no longer needed (e.g., `convertLeadToClient` if only used here).

**Verify:** `pnpm check && pnpm test`

---

### Change 3: Fix getDb() chaining in bundle-router.ts

**Problem:** Line ~121 uses `getDb().then(db => db?.select()...)` — fragile async pattern with optional chaining that silently returns undefined on connection failure.

**Find this pattern (around line 120-121):**
```typescript
const existingBundleItems = await getDb().then(db => db?.select().from(bundleItems).where(eq(bundleItems.id, input.bundleItemId)).limit(1));
```

**Replace with:**
```typescript
const db = await getDb();
if (!db) throw new Error("DB not initialized");
const existingBundleItems = await db.select().from(bundleItems).where(eq(bundleItems.id, input.bundleItemId)).limit(1);
```

**Verify:** `pnpm check && pnpm test`

---

### Change 4: Convert publicProcedure to protectedProcedure in assembly-router.ts

**Problem:** 9 procedures expose business assembly data without authentication.

**In `server/assembly-router.ts`:** Replace ALL instances of `publicProcedure` with `protectedProcedure`.

The procedures to convert: `list`, `getById`, `getByTrade`, `getByCategory`, `calculateCost`, `calculateBatch`, `categories`, `trades`, `stats`.

**Ensure `protectedProcedure` is imported** at the top of the file. If only `publicProcedure` was imported before, change the import.

**Verify:** `pnpm check && pnpm test`

---

### Change 5: Convert publicProcedure to protectedProcedure in pricing-router.ts

**Problem:** 25+ procedures expose proprietary pricing data without authentication.

**In `server/pricing-router.ts`:** Replace ALL instances of `publicProcedure` with `protectedProcedure`.

This includes all nested routers: priceBook, regional, channel, finish, parametric, templates, calculate, governance.

**Ensure `protectedProcedure` is imported.** Remove `publicProcedure` from import if no longer used.

**Verify:** `pnpm check && pnpm test`

---

### Change 6: Convert publicProcedure to protectedProcedure in preset-router.ts

**In `server/preset-router.ts`:** Replace the `list` procedure's `publicProcedure` with `protectedProcedure`.

**Verify:** `pnpm check && pnpm test`

---

### Change 7: Clean unused imports in routers.ts

**In `server/routers.ts`:** Remove unused imports:
- `validateQuantity` (if imported but never used)
- `transformBundleToEstimateDraft` (if imported but never used)
- `publicProcedure` (if imported but never used in this file)

**Verify:** `pnpm check && pnpm test`

---

### Final Verification:
```bash
pnpm check    # 0 TypeScript errors
pnpm test     # ALL tests passing, 0 regressions
```

**Report these results:**
- [ ] Duplicate convertLead removed from pipeline-router: YES/NO
- [ ] Dead convertLeadToProject removed from lead-db: YES/NO
- [ ] bundle-router getDb() pattern fixed: YES/NO
- [ ] assembly-router: all protectedProcedure: YES/NO
- [ ] pricing-router: all protectedProcedure: YES/NO
- [ ] preset-router: all protectedProcedure: YES/NO
- [ ] Unused imports cleaned: YES/NO
- [ ] All tests passing: [count] passing, 0 failures
- [ ] TypeScript: 0 errors
