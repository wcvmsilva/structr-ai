# Sprint [N] — [Domain Name]

---

## CONTEXT

[What exists in the codebase that this sprint builds on. What problem this sprint solves. Why this sprint matters in the COS evolution. What engines/tables/endpoints already exist that this sprint integrates with.]

**Predecessor sprints:** [list relevant sprints and what they delivered]
**Dependent tables:** [list tables this sprint reads from or writes to]
**Dependent engines:** [list engines this sprint imports from]

---

## GOAL

[One paragraph. What the sprint delivers when complete. Measurable outcome. Example: "Wire Lead Engine + Deal Flow Engine into a unified pipeline with atomic cross-domain transactions, a funnel visualization page, and real-time dashboard metrics."]

**Deliverables:**
1. [Engine file with N functions]
2. [DB file with N helpers]
3. [Router with N procedures]
4. [Page with specific UI elements]
5. [N tests across all layers]

---

## FILES

### Files to CREATE:

| File | Purpose | Test Count |
|------|---------|------------|
| `shared/[domain]-engine.ts` | [what it does] | ≥20 |
| `server/[domain]-db.ts` | [what it does] | ≥20 |
| `server/[domain]-router.ts` | [what it does] | ≥15 |
| `client/src/pages/[Domain].tsx` | [what it does] | — |
| `server/sprint[N]-[domain]-engine.test.ts` | Engine tests | — |
| `server/sprint[N]-[domain]-db.test.ts` | DB tests | — |
| `server/sprint[N]-[domain]-router.test.ts` | Router tests | — |

### Files to MODIFY:

| File | Change |
|------|--------|
| `drizzle/schema.ts` | Add [table names] |
| `drizzle/relations.ts` | Add relations for new FKs |
| `shared/domain/taxonomy.ts` | Add [enum names] if needed |
| `server/routers.ts` | Mount [domain]Router |
| `client/src/App.tsx` | Add lazy-loaded route |
| `client/src/components/DashboardLayout.tsx` | Add sidebar nav item |

### Files to READ (for context, do not modify):

| File | Why |
|------|-----|
| `AGENTS.md` | Mandatory project rules |
| [list relevant existing engines] | Pattern reference |
| [list relevant existing DB helpers] | Integration reference |

---

## CONSTRAINTS

1. Read `AGENTS.md` completely before writing any code
2. Follow TDD: RED → GREEN → REFACTOR for every function
3. Run `pnpm check` + `pnpm test` after every phase (Phase Gate)
4. All FATAL rules from AGENTS.md Tier 1 apply (no publicProcedure, audit on all mutations, behavior-only tests, no broken tests, transactions on multi-step ops)
5. Do not advance to next phase until current phase gate passes
6. [Any sprint-specific constraints]

---

## OUTPUT — Phase-by-Phase Execution

### Phase 1: Database Schema

**Tasks:**
- 1.1: Add tables to `drizzle/schema.ts` with columns, types, enums, indexes
- 1.2: Add relations to `drizzle/relations.ts`
- 1.3: Add enums to `shared/domain/taxonomy.ts` if new enums needed
- 1.4: Run `pnpm db:push`

**Phase Gate:** `pnpm check` → 0 errors, `pnpm test` → 0 regressions

---

### Phase 2: Engine Logic (TDD — Pure Functions)

**File:** `shared/[domain]-engine.ts`
**Test file:** `server/sprint[N]-[domain]-engine.test.ts`

For each function:
```
[functionName](params) → ReturnType
- Test: [what to test]
- Edge: [edge cases]
- Boundary: [boundary values]
```

**Phase Gate:** `pnpm check` → 0 errors, `pnpm test` → all passing, engine tests ≥ 20

---

### Phase 3: DB Helpers (TDD)

**File:** `server/[domain]-db.ts`
**Test file:** `server/sprint[N]-[domain]-db.test.ts`

For each helper:
```
[helperName](params) → ReturnType
- Audit: withAuditLog() with action "[domain].[action]"
- Transaction: [if multi-step, specify what's in the transaction]
- Test: [what to test]
```

**Phase Gate:** `pnpm check` → 0 errors, `pnpm test` → all passing, DB tests ≥ 20

---

### Phase 4: API Router (TDD)

**File:** `server/[domain]-router.ts`
**Test file:** `server/sprint[N]-[domain]-router.test.ts`

For each procedure:
```
[domain].[procedureName] — [query|mutation] — protectedProcedure
  Input: z.object({ ... })
  Calls: [which DB helper]
  Returns: { ... }
  Errors: [which TRPCError codes for which conditions]
```

Mount in `server/routers.ts`:
```typescript
import { [domain]Router } from "./[domain]-router";
// Add to appRouter: [domain]: [domain]Router,
```

**Phase Gate:** `pnpm check` → 0 errors, `pnpm test` → all passing, router tests ≥ 15

---

### Phase 5: Frontend

**File:** `client/src/pages/[Domain].tsx`

```
[ASCII layout of the page]
```

- Uses: [which tRPC hooks]
- Loading states, error handling
- Responsive layout with Tailwind
- Route: `/[path]` in App.tsx (lazy-loaded)
- Sidebar: Add "[Label]" with [icon] in DashboardLayout.tsx

**Phase Gate:** `pnpm check` → 0 errors, `pnpm build` → success

---

### Phase 6: Release Verification

```bash
pnpm check    # 0 TypeScript errors
pnpm test     # ALL tests passing, 0 regressions
git diff --stat
```

**Completion Report:**
```
TypeScript:    0 errors
Tests:         [X] new, [Y] total, 0 failures
Files created: [list]
Files modified: [list]
New tables:    [list]
New functions: [list]
New helpers:   [list]
New endpoints: [list]
Security:      All protectedProcedure? YES
Audit:         All mutations logged? YES
Regressions:   0
```
