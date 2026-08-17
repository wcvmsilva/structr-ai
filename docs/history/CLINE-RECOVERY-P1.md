# Recovery: Fix 9 TypeScript Errors from Interrupted P1 Audit

---

## CONTEXT

The previous Cline session was executing CLINE-AUDIT-FIX-P1.md but was interrupted mid-execution (API credits exhausted). The fixes were partially applied, leaving 9 TypeScript errors in 3 files. This prompt completes ONLY the remaining broken fixes.

**Current state:** `pnpm check` reports 9 errors in 3 files.
**Goal:** 0 TypeScript errors, all tests passing.

---

## FILES TO MODIFY (only these 3)

| File | Errors | Root Cause |
|------|--------|------------|
| `server/geo-override-router.ts` | 6 errors | `ctx.user.id` is number, functions expect string |
| `shared/pipeline-orchestrator.ts` | 1 error | Assigns `"residential"` which was removed from schema |
| `client/src/pages/Bundles.tsx` | 1 error | Mock data missing `createdAt`/`updatedAt` |

---

## CONSTRAINTS

1. Do NOT modify any other files
2. Do NOT revert previous changes — only fix forward
3. Do NOT add new features or refactor
4. Run `pnpm check` after ALL 3 fixes — must show 0 errors
5. Run `pnpm test` after pnpm check passes — 0 regressions

---

## FIX 1: geo-override-router.ts — Add .toString() (6 errors)

The previous session correctly replaced `ctx.user.openId` with `ctx.user.id`, but the DB functions expect a `string` parameter. Line 114 was already fixed correctly with `.toString()`. The remaining 6 locations need the same treatment.

**Find and fix these 6 lines** — add `.toString()` after `ctx.user.id`:

```
Line ~146: ctx.user.id  →  ctx.user.id.toString()
Line ~157: ctx.user.id  →  ctx.user.id.toString()
Line ~168: ctx.user.id  →  ctx.user.id.toString()
Line ~270: ctx.user.id  →  ctx.user.id.toString()
Line ~372: ctx.user.id  →  ctx.user.id.toString()
Line ~416: ctx.user.id  →  ctx.user.id.toString()
```

**Do NOT touch line 114** — it already has `.toString()` and is correct.

---

## FIX 2: pipeline-orchestrator.ts — Remove "residential" reference (1 error)

The schema no longer accepts `"residential"` as a channel value. In `shared/pipeline-orchestrator.ts`, find this line (around line 8 in `buildLeadConversionPayload`):

```typescript
const clientChannel = lead.channel === "direct" ? "residential" : lead.channel;
```

**Replace with:**
```typescript
const clientChannel = lead.channel ?? "direct";
```

This keeps the lead's channel as-is (which is already one of `"direct" | "insurance" | "commercial"`), defaulting to `"direct"` if null.

---

## FIX 3: Bundles.tsx — Add missing Date fields to mock data (1 error)

In `client/src/pages/Bundles.tsx` around line 150, there is a `DEV_MOCK_CATALOG` array. Each object in this array needs `createdAt` and `updatedAt` properties to match the expected type.

**Add these two fields to EVERY object in the mock array:**
```typescript
createdAt: new Date(),
updatedAt: new Date(),
```

---

## VERIFICATION

After applying all 3 fixes, run:

```bash
pnpm check    # Must show 0 errors
pnpm test     # Must show 0 failures
```

**Report:**
- [ ] geo-override-router.ts: 0 errors (6 .toString() added)
- [ ] pipeline-orchestrator.ts: 0 errors (residential removed)
- [ ] Bundles.tsx: 0 errors (Date fields added)
- [ ] pnpm check: 0 errors total
- [ ] pnpm test: [count] passing, 0 failures
