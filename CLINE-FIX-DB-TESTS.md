# Fix: Guard DB-Dependent Tests Against Missing DATABASE_URL

---

## CONTEXT

The Structr.ai test suite has **2098 passing tests** and **9 failing tests**. All 9 failures share one root cause: they are integration tests that require a live MySQL database, but `DATABASE_URL` is `undefined` in the test environment. These tests were never guarded against missing DB.

**Current state:** TypeScript 0 errors. 2098 tests pass. 9 tests fail due to `db is null` / empty results.

**Stack:** Vitest, tRPC, Drizzle ORM, MySQL (mysql2)

---

## GOAL

Add `skipIf(!process.env.DATABASE_URL)` guards so these 9 tests are automatically skipped when no database is available, and run normally when it is. Zero regressions. No logic changes.

**Expected outcome after fix:**
```
Test Files  0 failed | 44 passed (44)
Tests       0 failed | 2098+ passed | 42 skipped
```

---

## FILES TO MODIFY (only these 3)

| File | Failing Tests | Fix |
|------|---------------|-----|
| `server/catalog.test.ts` | 8 tests (catalog.list ×4, catalog.groups ×2, catalog.stats ×1, catalog.getById ×1) | Wrap DB-dependent describes with `describe.skipIf` |
| `server/count.test.ts` | 1 test (counts catalog items) | Wrap with `it.skipIf` |
| `server/bundle.test.ts` | 0 direct failures, but `beforeAll` in "bundle router — full CRUD lifecycle" fails because `catalog.list()` returns 0 items | Wrap the describe with `describe.skipIf` |

**Also check** `server/sprint4.test.ts` — three `beforeAll` blocks call `catalog.list()` and fail. Wrap those 3 describes with `describe.skipIf`.

---

## CONSTRAINTS

1. **Do NOT modify any non-test files**
2. **Do NOT change test logic** — only add skip guards
3. **Do NOT delete or remove any tests**
4. **Do NOT modify tests that already pass**
5. Run `pnpm check && pnpm test` after changes — must show 0 failures

---

## FIX 1: catalog.test.ts

Add this constant at the top of the file (after imports):

```typescript
const hasDb = !!process.env.DATABASE_URL;
```

Then change ONLY the DB-dependent describes from `describe(...)` to `describe.skipIf(!hasDb)(...)`:

```typescript
// Change these 4 describes:
describe.skipIf(!hasDb)("catalog.list", () => { ...
describe.skipIf(!hasDb)("catalog.groups", () => { ...
describe.skipIf(!hasDb)("catalog.stats", () => { ...
describe.skipIf(!hasDb)("catalog.getById", () => { ...
```

**Do NOT touch** the pure function describes (calcGrossProfit, autoAdjustDiscount, fmtCurrency, generateJobTreadCSV) — they pass and don't need DB.

---

## FIX 2: count.test.ts

Change the test from `it(...)` to `it.skipIf(!process.env.DATABASE_URL)(...)`:

```typescript
it.skipIf(!process.env.DATABASE_URL)("counts catalog items", async () => {
  // ... existing code unchanged ...
});
```

---

## FIX 3: bundle.test.ts

Add this constant at the top (after imports):

```typescript
const hasDb = !!process.env.DATABASE_URL;
```

Then change the DB-dependent describe:

```typescript
describe.skipIf(!hasDb)("bundle router — full CRUD lifecycle", () => { ...
```

**Do NOT touch** the pure function describes (calcLineTotals, calcBundleTotals, validateQuantity, generateJobTreadCSVWithQty, bundle router — auth enforcement) — they pass.

---

## FIX 4: sprint4.test.ts

Add this constant at the top (after imports):

```typescript
const hasDb = !!process.env.DATABASE_URL;
```

Then change the 3 DB-dependent describes:

```typescript
describe.skipIf(!hasDb)("preset router — full lifecycle", () => { ...
describe.skipIf(!hasDb)("estimate router — send bundle to estimate", () => { ...
describe.skipIf(!hasDb)("Sprint 4 — no regression in bundle CRUD", () => { ...
```

**Do NOT touch** these describes — they pass without DB:
- `transformBundleToEstimateDraft` (10 tests) — pure function
- `Sprint 4 — auth enforcement` (5 tests) — mock-based

---

## VERIFICATION

After all fixes:

```bash
pnpm check    # 0 TypeScript errors
pnpm test     # 0 failures, 44 test files pass
```

**Report:**
- [ ] catalog.test.ts: DB tests skipped when no DATABASE_URL
- [ ] count.test.ts: DB test skipped when no DATABASE_URL
- [ ] bundle.test.ts: CRUD lifecycle skipped when no DATABASE_URL
- [ ] sprint4.test.ts: DB lifecycle suites skipped when no DATABASE_URL
- [ ] pnpm check: 0 errors
- [ ] pnpm test: **0 failed**, [count] passed, [count] skipped
