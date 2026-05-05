# Sprint [N] — [Domain Name]

## Pre-Flight

Before starting, read and internalize:
1. `AGENTS.md` — project rules and architecture patterns
2. `shared/domain/taxonomy.ts` — canonical enums
3. `shared/constants/profit-shield.ts` — profit thresholds
4. Existing engine closest to this domain (for pattern reference)

---

## Phase 1: Database Schema (TDD)

### Task 1.1: Write schema tests
**File:** `server/sprint[N]-[domain].test.ts`
**Tests to write:**
- Table exists with correct columns
- Enum values match canonical taxonomy
- Required indexes exist
- FK constraints valid

### Task 1.2: Add tables to drizzle/schema.ts
- [ ] Table with all columns, types, enums, defaults
- [ ] Indexes on FK columns and query-heavy fields
- [ ] createdAt, updatedAt, deletedAt timestamps
- [ ] createdBy, updatedBy user references

### Task 1.3: Add relations to drizzle/relations.ts

### Task 1.4: Run migration
```bash
pnpm db:push
```

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm test   # all passing
```

---

## Phase 2: Engine Logic (TDD — Pure Functions)

### Task 2.x: For each function:
1. Write test in `server/sprint[N]-[domain]-engine.test.ts`
2. Run test → confirm RED (fails)
3. Implement function in `shared/[domain]-engine.ts`
4. Run test → confirm GREEN (passes)
5. Commit: `feat([domain]): implement [functionName]`

**Required test coverage per function:**
- Happy path (valid input → expected output)
- Edge cases (empty arrays, zero values, null fields)
- Boundary values (threshold transitions)
- Error conditions (invalid input → appropriate error)

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm test   # all passing, engine tests ≥ 20
```

---

## Phase 3: DB Helpers (TDD)

### Task 3.x: For each helper:
1. Write test in `server/sprint[N]-[domain]-db.test.ts`
2. Implement in `server/[domain]-db.ts`
3. Verify audit logging: `logAudit()` called on every mutation
4. Verify transactions: multi-step operations wrapped in `db.transaction()`

**Required test types:**
- CRUD: create returns correct shape, getById returns data, list with filters
- State transitions: valid transition succeeds, invalid transition throws
- Audit: verify logAudit called with correct before/after
- Transactions: verify atomicity (all-or-nothing)
- Search: verify filtering works correctly

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm test   # all passing, DB tests ≥ 20
```

---

## Phase 4: API Router (TDD)

### Task 4.x: For each procedure:
1. Write test in `server/sprint[N]-[domain]-router.test.ts`
2. Implement in `server/[domain]-router.ts`
3. ALL endpoints use `protectedProcedure` or `adminProcedure`
4. ALL inputs validated with Zod
5. ALL enum inputs normalized at boundary

**Required test types:**
- Valid input → correct response
- Missing required fields → TRPCError with BAD_REQUEST
- Invalid enum value → throws or normalizes
- Non-existent ID → TRPCError with NOT_FOUND
- State violation → TRPCError with CONFLICT or PRECONDITION_FAILED
- Router structure: all endpoints exist and use protectedProcedure

### Task 4.final: Mount router in server/routers.ts

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm test   # all passing, router tests ≥ 15
```

---

## Phase 5: Frontend

### Task 5.1: Create page component
- [ ] `client/src/pages/[Domain].tsx`
- [ ] Uses tRPC hooks (useQuery, useMutation)
- [ ] Cache invalidation on mutations
- [ ] Loading states, error handling
- [ ] Responsive layout with Tailwind

### Task 5.2: Add route to App.tsx (lazy-loaded)
```tsx
const DomainPage = lazy(() => import("./pages/Domain"));
```

### Task 5.3: Add to sidebar navigation in DashboardLayout.tsx

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm build  # builds successfully
```

---

## Phase 6: Release Verification

### Mandatory checks:
```bash
pnpm check                    # 0 TypeScript errors
pnpm test                     # ALL tests passing
git diff --stat               # review all changes
```

### Completion report (paste these outputs):
- [ ] Test count: X new tests, Y total, 0 failures
- [ ] TypeScript: 0 errors
- [ ] Files created: (list)
- [ ] Files modified: (list)
- [ ] New tables: (list)
- [ ] New engine functions: (list)
- [ ] New router procedures: (list)

### Final commit:
```bash
git add -A
git commit -m "feat([domain]): Sprint [N] — [Domain Name] complete

- [X] new tests, [Y] total passing
- [engine function count] engine functions
- [db helper count] DB helpers
- [procedure count] tRPC procedures
- [table count] new tables
"
```
