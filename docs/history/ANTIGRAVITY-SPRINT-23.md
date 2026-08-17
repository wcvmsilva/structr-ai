# structr.ai — Sprint 23: Production Readiness & Bug Resolution

**Author:** Lead Systems Architect (Wellington)
**Date:** 2026-03-20
**Target:** Antigravity AI Agent
**Context:** Full codebase audit completed. 1,944 tests passing across 30 test files, 22 sprints completed. System is feature-complete but has accumulated technical debt and bugs that must be resolved before production deployment.

---

## MISSION

Execute Sprint 23 — Production Readiness. Fix all bugs, security gaps, and inconsistencies identified below. After each phase, run `pnpm test` and confirm zero regressions. Do NOT skip any item. Do NOT introduce new features. This is a hardening sprint.

---

## EXECUTION METHODOLOGY (Mandatory — Adapted from Superpowers Framework)

These rules govern HOW you execute every task in this sprint. Violation of these rules is treated as a bug.

### Rule 1: Test-Driven Development (TDD)

For every new function or bug fix:
1. **RED** — Write the test FIRST. Run it. Confirm it FAILS.
2. **GREEN** — Write the minimum code to make the test pass. Run it. Confirm it PASSES.
3. **REFACTOR** — Clean up. Run tests again. Confirm still passing.

If you write implementation code before writing the test, DELETE the implementation and start over. This is non-negotiable.

### Rule 2: Micro-Task Decomposition

Each Phase below must be broken into tasks of **2-5 minutes each**. Each micro-task must specify:
- **Exact file path** and line range to modify
- **Exact test command** to run after the change: `pnpm test -- --grep "pattern"`
- **Expected output** (test count, pass/fail)
- **Git commit message** for that micro-task

Do NOT batch multiple changes into one large edit. One concern per task. One commit per task.

### Rule 3: Scientific Debugging

If a test fails after your change:
- **Phase 1 — Investigate:** Read the full error. Reproduce it. Identify the root cause.
- **Phase 2 — Compare:** Find working code that does something similar. Compare line by line.
- **Phase 3 — Hypothesize:** Form ONE hypothesis. Make ONE minimal change. Test.
- **Phase 4 — Escalate:** If 3 attempts fail → STOP. Do not continue guessing. Write a note in `TECH-DEBT.md` describing the issue and move to the next task.

NEVER do "shotgun debugging" (changing multiple things at once hoping something works).

### Rule 4: Verify Before Advancing

After completing each Phase (not each micro-task, each Phase):
1. `pnpm check` — zero TypeScript errors
2. `pnpm test` — ALL tests passing, zero regressions
3. Review your own diff: `git diff --stat`
4. Confirm: audit logging present? No publicProcedure on sensitive data? No hardcoded values?

Only advance to the next Phase after ALL 4 checks pass.

### Rule 5: Evidence-Based Completion

Do NOT declare a Phase complete based on "I think it works." Provide evidence:
- Paste the test output showing pass count
- Paste the TypeScript check output showing 0 errors
- List the exact files modified and why

---

## PHASE 1: Critical Infrastructure (Do First)

### 1.1 — Fix Environment Variable Validation

**File:** `server/_core/env.ts`
**Bug:** All env vars default to empty string `""` instead of failing at startup. A missing `DATABASE_URL` causes a silent runtime crash instead of a clear error.

**Fix:** Add startup validation for required variables:
```typescript
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'OAUTH_SERVER_URL', 'OWNER_OPEN_ID'];
const missing = REQUIRED.filter(v => !process.env[v]);
if (missing.length > 0) {
  throw new Error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
}
```

**Deliverable:** Create `.env.example` in project root with all 8 variables documented:
```
DATABASE_URL=mysql://user:pass@localhost:3306/structr_ai
JWT_SECRET=your-secret-key-here
OAUTH_SERVER_URL=https://your-oauth-provider.com
OWNER_OPEN_ID=your-owner-open-id
VITE_APP_ID=structr-ai
BUILT_IN_FORGE_API_URL=https://api.example.com
BUILT_IN_FORGE_API_KEY=your-api-key
PORT=5000
```

### 1.2 — Remove Manus Platform Artifacts

**File:** `vite.config.ts`
**Bug:** `vite-plugin-manus-runtime` is a platform-specific dependency that breaks builds outside Manus.

**Fix:**
1. Remove the import of `vitePluginManusRuntime` from `vite.config.ts`
2. Remove the plugin from the plugins array
3. Remove the entire `vitePluginManusDebugCollector()` function and its middleware (the `configureServer` block that handles `/__manus_debug_collect`)
4. Remove `vite-plugin-manus-runtime` from `devDependencies` in `package.json`
5. Run `pnpm install` to update lockfile

### 1.3 — Add Database Connection Pooling

**File:** `server/db.ts` (lines 2, 13)
**Bug:** Single Drizzle instance with no pool configuration. Under concurrent load, connections will exhaust.

**Fix:** Replace raw connection with pooled connection:
```typescript
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";

const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

_db = drizzle(pool);
```

### 1.4 — Add Security Middleware

**File:** `server/_core/index.ts`
**Bug:** No CORS, no rate limiting, no security headers. Body limit is 50MB (excessive).

**Fix:** Install and configure:
```bash
pnpm add helmet express-rate-limit cors
```

Add to Express setup:
```typescript
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5000'], credentials: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true }));
app.use(express.json({ limit: "10mb" })); // Reduce from 50mb
```

Add `ALLOWED_ORIGINS` to `.env.example`.

---

## PHASE 2: Security Hardening

### 2.1 — Protect Public Endpoints

**File:** `server/routers.ts`
**Bug:** Multiple endpoints use `publicProcedure` that expose business data to unauthenticated users.

**Fix — change these to `protectedProcedure`:**

| Line(s) | Procedure | Current | Target |
|---------|-----------|---------|--------|
| ~135 | `catalog.list` | publicProcedure | protectedProcedure |
| ~143 | `catalog.groups` | publicProcedure | protectedProcedure |
| ~148 | `catalog.stats` | publicProcedure | protectedProcedure |
| ~153 | `catalog.getById` | publicProcedure | protectedProcedure |
| ~182 | `bundle.getById` | publicProcedure | protectedProcedure |
| ~192 | `bundle.list` | publicProcedure | protectedProcedure |
| ~506 | `estimateLegacy.getById` | publicProcedure | protectedProcedure |
| ~516 | `estimateLegacy.list` | publicProcedure | protectedProcedure |

Also check all files matching `server/*-router.ts` for any other `publicProcedure` on read endpoints that should be protected.

### 2.2 — Fix Audit Log Query Ordering

**File:** `server/audit.ts` (lines ~89-98)
**Bug:** `WHERE` clause is applied AFTER `LIMIT/OFFSET`, causing incorrect pagination results.

**Fix:** Restructure the query to apply WHERE before LIMIT:
```typescript
let query = db.select().from(auditLogs);
if (whereClause) {
  query = query.where(whereClause);
}
query = query.orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset);
```

### 2.3 — Fix Audit Log "Before" Snapshot Bug

**File:** `server/routers.ts` (line ~264-271, `updateItemQuantity`)
**Bug:** The "before" snapshot stores the NEW quantity instead of the OLD quantity.

**Fix:** Fetch the existing item BEFORE updating, capture its old quantity:
```typescript
// Fetch current state BEFORE mutation
const existingItem = await db.select().from(bundleItems).where(eq(bundleItems.id, input.bundleItemId));
const oldQuantity = existingItem[0]?.quantity;

// Then perform the update...
// Then log with correct before/after:
logAudit({
  before: { quantity: oldQuantity },
  after: { quantity: input.quantity },
  ...
});
```

---

## PHASE 3: Engine Bug Fixes

### 3.1 — Fix Duplicate Swap Items in Override Resolver

**File:** `shared/geo-override-engine.ts` (lines ~340, 376-384)
**Bug:** CRITICAL — When multiple swap rules match the same scope item, BOTH the original AND the swapped item end up in `resolvedItems`, creating duplicate entries.

**Fix:** Track swapped assembly IDs in a Set. After processing all rules for an item, only push to resolvedItems if it wasn't already swapped:
```typescript
const swappedAssemblyIds = new Set<number>();

// In the swap processing block:
swappedAssemblyIds.add(item.assemblyId);
resolvedItems.push(swappedItem);

// After all rules for this item are processed:
if (!swappedAssemblyIds.has(item.assemblyId)) {
  resolvedItems.push(toResolvedItem(item));
}
```

**Write a test** that verifies: given an item with 2 matching swap rules, only 1 resolved item appears (the first swap), not 3 (original + 2 swaps).

### 3.2 — Fix Division by Zero in Scope Engine

**File:** `shared/scope-engine.ts` (line ~613)
**Bug:** Division by zero returns `0` silently, which masks formula errors and could produce incorrect quantities.

**Fix:** Add a warning to the scope draft when division by zero occurs:
```typescript
if (factor === 0) {
  warnings.push(`Division by zero in formula for assembly ${assemblyId}. Defaulting quantity to 1.`);
  return 1;
}
return Math.max(1, result / factor);
```

### 3.3 — Fix Profit Shield Threshold Inconsistency

**Files:** Multiple engines use different hardcoded thresholds:
- `estimate-engine.ts` line ~152: hardcoded `28%` for individual assembly warning
- `assembly-engine.ts`: uses `MIN_GROSS_PROFIT` from `catalog-utils.ts` (35%)
- `geo-engine.ts` line ~308: zone-specific `minProfitShieldPct` (42-50%)

**Fix:** Create a centralized Profit Shield config in `shared/constants/profit-shield.ts`:
```typescript
export const PROFIT_SHIELD = {
  GLOBAL_MIN_GP: 0.35,           // 35% — absolute floor
  INDIVIDUAL_WARNING_GP: 0.28,    // 28% — per-assembly warning threshold
  COASTAL_MIN_GP: 0.42,           // 42% — coastal zone floor
  BARRIER_ISLAND_MIN_GP: 0.50,    // 50% — barrier island floor
} as const;
```

Update all 3 engines to import from this single source of truth. Remove hardcoded values.

### 3.4 — Add parseFloat Validation

**File:** `server/db.ts` (lines ~309-310, 344-345)
**Bug:** `parseFloat()` on DB decimal strings can produce `NaN` if data is corrupted, causing silent calculation failures.

**Fix:** Add a validated parseFloat utility in `shared/utils/math.ts`:
```typescript
export function safeParseFloat(value: string | number, fieldName: string): number {
  const result = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(result)) {
    throw new Error(`Invalid numeric value for ${fieldName}: "${value}"`);
  }
  return result;
}
```

Replace all `parseFloat(catItem.unitCost)` and `parseFloat(catItem.unitPrice)` calls in `db.ts` with `safeParseFloat(catItem.unitCost, 'unitCost')`.

### 3.5 — Add Transaction to duplicateBundle

**File:** `server/db.ts` (lines ~398-433)
**Bug:** If bundle item insertion fails after bundle creation, you get an orphaned empty bundle.

**Fix:** Wrap in a transaction:
```typescript
export async function duplicateBundle(bundleId: number, userId: number) {
  return await db.transaction(async (tx) => {
    // Create bundle using tx
    // Insert items using tx
    // If anything fails, entire transaction rolls back
  });
}
```

---

## PHASE 4: Frontend Fixes

### 4.1 — Fix Duplicated Brand Name

**File:** `client/src/components/DashboardLayout.tsx`

**Location 1 (Login Screen, lines ~99-109):** The login screen shows "structr.ai structr.ai". Fix to show only once:
```tsx
<span className="text-2xl font-extrabold tracking-tight">
  <span className="bg-gradient-to-r from-gold-dark via-gold to-gold-light bg-clip-text text-transparent">
    structr.ai
  </span>
</span>
```

**Location 2 (Sidebar Header, lines ~219-227):** Same duplication. Fix to:
```tsx
<span className="font-bold tracking-tight truncate">
  <span className="text-gold">structr.ai</span>
</span>
```

**Location 3:** In `Home.tsx` line ~100, "structr.ai — Charleston, SC — structr.ai Overview" — remove the redundant "structr.ai" at the end.

### 4.2 — Replace Fake Dashboard Data

**File:** `client/src/pages/Home.tsx` (lines 18-60)
**Bug:** Dashboard shows hardcoded fake data instead of real DB queries.

**Fix:** Replace static data with tRPC queries:
```typescript
// Replace hardcoded projectStats with:
const { data: projectStats } = trpc.project.getStats.useQuery();
const { data: estimateStats } = trpc.estimate.stats.useQuery();
const { data: recentProjects } = trpc.project.getRecent.useQuery({ limit: 5 });
```

The backend already has `project.getStats`, `project.getRecent`, and `estimate.stats` procedures — they just aren't wired to the frontend.

---

## PHASE 5: Code Organization

### 5.1 — Extract Inline Router Procedures

**File:** `server/routers.ts` (613 lines)
**Problem:** Contains inline procedures for `catalog`, `bundle`, `preset`, `estimateLegacy`, `rbac`, `audit`, and `auth` that should be in dedicated files following the project convention.

**Fix:** Extract into dedicated router files:
- `server/catalog-router.ts` ← catalog procedures
- `server/bundle-router.ts` ← bundle procedures
- `server/preset-router.ts` ← preset procedures
- `server/estimate-legacy-router.ts` ← estimateLegacy procedures
- `server/rbac-router.ts` ← rbac procedures (currently mixed with seed)
- `server/auth-router.ts` ← auth procedures

Keep `server/routers.ts` as a thin aggregator that imports and merges all sub-routers into `appRouter`.

### 5.2 — Add Seed Scripts to package.json

**File:** `package.json`
**Problem:** Seed scripts exist but aren't exposed as npm scripts.

**Fix:** Add to `"scripts"`:
```json
"seed:catalog": "node seed-catalog.mjs",
"seed:assemblies": "node seed-assemblies.mjs",
"seed:pricebook": "node seed-pricebook.mjs",
"seed:pricing": "node seed-pricing.mjs",
"seed:rbac": "node seed-rbac.mjs",
"seed:all": "node seed-catalog.mjs && node seed-assemblies.mjs && node seed-pricebook.mjs && node seed-pricing.mjs && node seed-rbac.mjs",
"setup": "pnpm install && pnpm db:push && pnpm seed:all"
```

### 5.3 — Fix Hardcoded Test Paths

**Affected test files (5):**
- `server/sprint21-field-launch-control.test.ts` (8 tests)
- `server/sprint12-scope-db.test.ts`
- Any other files referencing `/home/ubuntu/gchi-bundle-builder-web/...`

**Fix:** Replace all hardcoded absolute paths with relative paths:
```typescript
// BEFORE (broken):
fs.readFileSync("/home/ubuntu/gchi-bundle-builder-web/client/src/App.tsx", "utf-8")

// AFTER (portable):
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
fs.readFileSync(path.join(projectRoot, "client/src/App.tsx"), "utf-8")
```

Search ALL test files for `/home/ubuntu/` and replace every occurrence.

### 5.4 — Populate Drizzle Relations

**File:** `drizzle/relations.ts`
**Problem:** File is empty (only contains `import {} from "./schema"`). With 51+ tables and many FK relationships, no typed relations exist.

**Fix:** Define relations for at least the core domain entities:
```typescript
import { relations } from "drizzle-orm";
import { users, projects, clients, estimates, scopeDrafts, ... } from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
  estimates: many(estimates),
  scopeDrafts: many(scopeDrafts),
  intakeForms: many(intakeForms),
}));

// Continue for all major entities...
```

This enables Drizzle relational queries (`.with()`) instead of manual joins.

---

## PHASE 6: Fix README

**File:** `README.md`
**Problems:**
- Says "PostgreSQL" — should say "MySQL"
- Says "React 18" — should say "React 19"
- Says "10-step deterministic flow" — scope-to-estimate-pipeline has 13 steps
- Missing info about the 7 shared engines, 51+ tables, 22 sprints of development
- No setup instructions beyond basic dev commands

**Fix:** Update README to accurately reflect:
- Stack: React 19 + TypeScript + tRPC + Drizzle ORM + **MySQL** + Tailwind CSS 4 + shadcn/ui
- Engines: 7 (Scope, Pricing, Assembly, Estimate, Geo, Geo Override, Remodel)
- Pipeline: 13-step deterministic flow
- Tests: 1,944 across 30 files
- Tables: 51+
- Setup: reference `.env.example` and `pnpm setup`

---

## PHASE 7: Verification

After all fixes are applied:

1. Run `pnpm check` — must pass with 0 TypeScript errors
2. Run `pnpm test` — must pass ALL 1,944+ tests (including the 24 previously failing ones that are now fixed)
3. Run `pnpm build` — must succeed
4. Verify no `publicProcedure` on sensitive data endpoints
5. Verify no hardcoded paths referencing `/home/ubuntu/`
6. Verify no `vite-plugin-manus-runtime` references remain
7. Verify `.env.example` exists and documents all required vars
8. Verify `structr.ai` does NOT appear duplicated in any UI component

**Expected test count after Sprint 23:** ~1,970+ (1,944 existing + new tests for swap dedup, division-by-zero, parseFloat validation, transaction rollback)

---

## PHASE 8: Checkpoint

After all verifications pass:
1. Save checkpoint
2. Create git commit: `fix: Sprint 23 — Production readiness hardening (security, bugs, DX)`
3. Deliver Sprint 23 report with:
   - Issues found count
   - Issues fixed count
   - Test count before/after
   - Breaking changes (if any)

---

## RULES FOR THIS SPRINT

1. **Do NOT add new features.** This is a bug-fix and hardening sprint only.
2. **Do NOT rename or reorganize test files** (beyond fixing hardcoded paths). Test file naming by sprint is a known tech debt item but is NOT in scope for this sprint.
3. **Run tests after EVERY phase.** If any test breaks, fix it before moving to the next phase.
4. **Preserve all existing behavior.** Every fix must be backward-compatible. No breaking changes to the tRPC API contract.
5. **Document every change** in the commit message with the specific phase number.
6. **If you encounter an issue not listed here,** fix it if it's clearly a bug. If it's ambiguous, document it in a new `TECH-DEBT.md` file but do NOT attempt to fix it.

---

## APPENDIX: Full Bug Inventory

| # | File | Line(s) | Severity | Issue | Phase |
|---|------|---------|----------|-------|-------|
| 1 | env.ts | 1-10 | CRITICAL | No env var validation at startup | 1.1 |
| 2 | vite.config.ts | 7+ | HIGH | Manus platform artifact breaks external builds | 1.2 |
| 3 | db.ts | 2, 13 | HIGH | No connection pooling | 1.3 |
| 4 | index.ts | all | HIGH | No CORS, rate limiting, or security headers | 1.4 |
| 5 | routers.ts | 135-521 | HIGH | 8+ public endpoints exposing business data | 2.1 |
| 6 | audit.ts | 89-98 | MEDIUM | WHERE after LIMIT in pagination | 2.2 |
| 7 | routers.ts | 264-271 | MEDIUM | Audit log captures wrong "before" value | 2.3 |
| 8 | geo-override-engine.ts | 340-384 | HIGH | Duplicate items on multi-rule swap | 3.1 |
| 9 | scope-engine.ts | 613 | MEDIUM | Silent zero on division by zero | 3.2 |
| 10 | estimate/assembly/geo engines | multiple | MEDIUM | Inconsistent Profit Shield thresholds | 3.3 |
| 11 | db.ts | 309-345 | MEDIUM | parseFloat without NaN validation | 3.4 |
| 12 | db.ts | 398-433 | MEDIUM | No transaction in duplicateBundle | 3.5 |
| 13 | DashboardLayout.tsx | 99-227 | LOW | Brand name "structr.ai" duplicated twice | 4.1 |
| 14 | Home.tsx | 18-60 | MEDIUM | Dashboard shows hardcoded fake data | 4.2 |
| 15 | routers.ts | all 613 lines | MEDIUM | Monolithic file needs extraction | 5.1 |
| 16 | package.json | scripts | LOW | Missing seed scripts | 5.2 |
| 17 | 5 test files | multiple | HIGH | Hardcoded paths cause 24 test failures | 5.3 |
| 18 | drizzle/relations.ts | all | MEDIUM | Empty file, no relations defined | 5.4 |
| 19 | README.md | all | LOW | Outdated info (PostgreSQL, React 18, etc.) | 6 |
| 20 | db.ts | 374-396 | LOW | Race condition in recalculateBundleTotals | future |
| 21 | audit.ts | 135-141 | LOW | Fire-and-forget audit can lose data | future |

**Total: 21 issues identified. 19 to fix in this sprint. 2 deferred to future sprint.**
