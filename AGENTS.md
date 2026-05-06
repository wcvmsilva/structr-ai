# AGENTS.md — structr.ai AI Agent Operating Manual

---

## CONTEXT

structr.ai is a **Construction Operating System (COS)** — an enterprise-grade platform for deterministic construction estimation, lead-to-deal pipeline management, and project orchestration. Built for **GC Home Improvement LLC** (Charleston, SC).

**Stack:** React 19, TypeScript 5.9, tRPC v11, Drizzle ORM, PostgreSQL via `postgres` driver (Supabase in production), Vite 7, Express, Vitest, Tailwind CSS 4, shadcn/ui, wouter router.

**Scale:** 56+ tables, 8 engines, 2,000+ tests, 13-step scope-to-estimate pipeline.

**Revenue-critical path:** Lead → Client → Project → Intake → Scope → Review → Override → Estimate → Export. Breaking this pipeline = breaking the business.

**You are an execution agent.** You receive sprint specs designed by the Chief Architect. Your job is to implement exactly what is specified, following the rules below. Do not improvise architecture. Do not skip tests. Do not add features not in the spec.

---

## GOAL

Produce production-quality code that:
1. Passes `pnpm check` with 0 TypeScript errors
2. Passes `pnpm test` with 0 regressions and ≥60 new tests per sprint
3. Follows the exact architecture pattern below
4. Includes audit logging on every mutation
5. Uses protectedProcedure on every business endpoint
6. Is reviewable by the Chief Architect with zero surprises

---

## FILES — Architecture Pattern (Non-Negotiable)

Every new domain MUST produce these files in this exact order:

```
drizzle/schema.ts              → Tables with indexes, timestamps, soft delete
drizzle/relations.ts           → Relations for every new FK
shared/domain/taxonomy.ts      → Canonical enums (add here, NEVER inline)
shared/[domain]-engine.ts      → Pure functions. ZERO DB imports. ZERO side effects.
server/[domain]-db.ts          → DB helpers. ALL mutations wrapped in withAuditLog().
server/[domain]-router.ts      → tRPC procedures. ALL use protectedProcedure.
server/sprint[N]-[domain]-engine.test.ts  → Engine tests (≥20)
server/sprint[N]-[domain]-db.test.ts      → DB tests (≥20)
server/sprint[N]-[domain]-router.test.ts  → Router tests (≥15)
client/src/pages/[Domain].tsx  → React page. tRPC hooks. Lazy-loaded.
```

**Critical files you must also modify:**
- `server/routers.ts` → mount new router
- `client/src/App.tsx` → add lazy-loaded route
- `client/src/components/DashboardLayout.tsx` → add sidebar nav item

---

## CONSTRAINTS — Rules That Kill The Sprint If Violated

### Tier 1 — FATAL (Sprint rejected if any of these fail)

| # | Rule | Why |
|---|------|-----|
| F1 | **NEVER use `publicProcedure`** on business endpoints | Security: unauthenticated access to business data |
| F2 | **EVERY mutation calls `withAuditLog()` or `logAudit()`** | Compliance: no untracked data changes |
| F3 | **NEVER write existence-only tests** (`expect(typeof fn).toBe('function')`) | Quality: tests must verify BEHAVIOR, not existence |
| F4 | **NEVER break existing tests** | Stability: zero regressions allowed |
| F5 | **ALL multi-step DB operations use `db.transaction()`** | Data integrity: atomic or nothing |
| F6 | **When spec says UPDATE an existing endpoint, you MUST modify it** | Correctness: parallel endpoints create silent bugs |

### Tier 2 — SERIOUS (Sprint approved with ressalvas)

| # | Rule | Why |
|---|------|-----|
| S1 | Minimum 60 tests per sprint (20 engine + 20 DB + 15 router + 5 integration) | Coverage |
| S2 | ALL inputs validated with Zod at router boundary | Input safety |
| S3 | ALL enum inputs normalized using `shared/domain/normalization.ts` | Data consistency |
| S4 | Canonical enums in `shared/domain/taxonomy.ts`, never inline | Single source of truth |
| S5 | Use `round2()` and `safeParseFloat()` from `shared/utils/math.ts` | Financial precision |
| S6 | Profit Shield constants from `shared/constants/profit-shield.ts` | Never hardcode margins |

### Tier 3 — BEST PRACTICE (Noted but non-blocking)

| # | Rule | Why |
|---|------|-----|
| B1 | One commit per micro-task with conventional commit messages | Clean history |
| B2 | Never commit `.env` files | Security |
| B3 | Use `import.meta.url` for test file resolution | Portability |
| B4 | Capture `before` state BEFORE executing mutation in audit | Accurate audit trail |

---

## OUTPUT — Completion Requirements

Before declaring any sprint complete, you MUST provide evidence:

```
COMPLETION REPORT
─────────────────
TypeScript:    pnpm check → 0 errors
Tests:         pnpm test  → X new, Y total, 0 failures
Files created: [list]
Files modified: [list]
New tables:    [count and names]
New functions: [list from engine]
New helpers:   [list from db]
New endpoints: [list from router]
Security:      All endpoints use protectedProcedure? YES/NO
Audit:         All mutations have audit logging? YES/NO
Regressions:   Any existing tests broken? YES/NO
```

If ANY line above is NO or shows failures, the sprint is NOT complete. Fix before reporting.

---

## REFERENCE — Existing Engines (Do Not Break)

| Engine | File | Purpose |
|--------|------|---------|
| Scope | shared/scope-engine.ts | Rule-based scope generation from intake |
| Pricing | shared/pricing-engine.ts | Dimensional pricing with multipliers |
| Assembly | shared/assembly-engine.ts | BOM calculation and cost breakdown |
| Estimate | shared/estimate-engine.ts | Estimate validation and transformation |
| Geo | shared/geo-engine.ts | Charleston zone detection and modifiers |
| Geo Override | shared/geo-override-engine.ts | Assembly swap/add by zone |
| Remodel | shared/remodel-engine.ts | Template matching and workflow generation |
| Lead | shared/lead-engine.ts | Lead scoring, classification, conversion |
| Deal | shared/deal-engine.ts | Pipeline management, win probability, forecasting |
| Pipeline | shared/pipeline-orchestrator.ts | Cross-domain orchestration (Lead→Deal→Project) |

## REFERENCE — Database

- **56+ tables** in `drizzle/schema.ts`
- **PostgreSQL** via Drizzle ORM and the `postgres` driver. Production targets Supabase via the connection pooler (port 6543).
- Relations in `drizzle/relations.ts`
- Migrations via `pnpm db:push`
- Profit Shield: GLOBAL_MIN_GP 35%, COASTAL 42%, BARRIER_ISLAND 50%

## REFERENCE — TDD Methodology

```
For every function, helper, or procedure:

1. RED    — Write test FIRST. Run. Confirm FAIL with expected assertion.
2. GREEN  — Write MINIMUM code to pass. Run. Confirm PASS.
3. REFACTOR — Clean up. Run ALL tests. Confirm ZERO regressions.

If you write implementation before writing the test → DELETE and start over.
```
