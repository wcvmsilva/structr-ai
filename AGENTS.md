# structr.ai — Agent Instructions

This file contains mandatory instructions for ANY AI agent working on this codebase.
Read this BEFORE writing any code.

---

## PROJECT IDENTITY

structr.ai is a **Construction Operating System** — an enterprise-grade platform
for deterministic construction estimation, lead management, and project orchestration.
Built for GC Home Improvement LLC (Charleston, SC).

## ARCHITECTURE RULES (Non-Negotiable)

### File Organization Pattern

Every new domain MUST follow this exact structure:

```
shared/[domain]-engine.ts      → Pure functions. ZERO database imports. ZERO side effects.
server/[domain]-db.ts           → DB helpers. ALL mutations wrapped in logAudit().
server/[domain]-router.ts       → tRPC procedures. ALL use protectedProcedure or adminProcedure.
server/sprint[N]-[domain].test.ts → Tests. Minimum 60 tests per sprint.
client/src/pages/[Domain].tsx    → React page. Uses tRPC hooks. Lazy-loaded in App.tsx.
drizzle/schema.ts                → Tables added here. Include indexes.
drizzle/relations.ts             → Relations added here for every new FK.
```

### Security Rules

1. **NEVER use `publicProcedure`** for any endpoint that reads or writes business data.
2. **ALWAYS use `protectedProcedure`** (requires auth) or `adminProcedure` (requires admin role).
3. **ALWAYS validate inputs** with Zod schemas at router boundaries.
4. **ALWAYS normalize** enum inputs using functions from `shared/domain/normalization.ts`.
5. **NEVER store secrets** in code. Use environment variables via `server/_core/env.ts`.

### Audit Rules

1. **EVERY mutation** (create, update, delete, status change) MUST call `logAudit()`.
2. Audit logs MUST include `before` and `after` snapshots where applicable.
3. Capture the `before` state BEFORE executing the mutation, not after.

### Testing Rules

1. **TDD is mandatory.** Write the test FIRST. Confirm it fails. Then implement.
2. **Minimum 60 tests per sprint.** No sprint ships with fewer.
3. **Test structure per domain:**
   - Engine tests: pure function inputs/outputs, edge cases, boundary values
   - DB tests: CRUD operations, audit logging verification, transaction behavior
   - Router tests: input validation, error handling, auth verification, endpoint structure
4. **NEVER write existence-only tests** (e.g., `expect(typeof fn).toBe('function')`).
   Every test must verify BEHAVIOR, not just existence.
5. Run `pnpm test` after EVERY phase. Zero regressions allowed.

### Code Quality Rules

1. Use canonical enums from `shared/domain/taxonomy.ts`. Add new enums there, not inline.
2. Use `round2()` and `safeParseFloat()` from `shared/utils/math.ts` for all numeric operations.
3. Use Profit Shield constants from `shared/constants/profit-shield.ts`. Never hardcode percentages.
4. Use `import.meta.url` for file path resolution in tests. Never use absolute paths.
5. Database operations MUST use connection pooling (already configured in `server/db.ts`).

### Git Rules

1. One commit per micro-task. Descriptive messages following conventional commits:
   - `feat(domain):` for new features
   - `fix(domain):` for bug fixes
   - `test(domain):` for test additions
   - `refactor(domain):` for restructuring
2. Never commit `.env` files. Only `.env.example`.

---

## EXISTING ENGINES (Do Not Break)

| Engine | Location | Purpose |
|--------|----------|---------|
| Scope Engine | shared/scope-engine.ts | Rule-based scope generation from intake |
| Pricing Engine | shared/pricing-engine.ts | Dimensional pricing with multipliers |
| Assembly Engine | shared/assembly-engine.ts | BOM calculation and cost breakdown |
| Estimate Engine | shared/estimate-engine.ts | Estimate validation and transformation |
| Geo Engine | shared/geo-engine.ts | Charleston zone detection and modifiers |
| Geo Override Engine | shared/geo-override-engine.ts | Assembly swap/add by geographic zone |
| Remodel Engine | shared/remodel-engine.ts | Template matching and workflow generation |
| Lead Engine | shared/lead-engine.ts | Lead scoring, classification, conversion |

## EXISTING PIPELINE (Do Not Break)

```
Lead → Client → Project → Intake → Scope → Review → Override → Estimate → Export
```

The scope-to-estimate pipeline in `server/scope-to-estimate-pipeline.ts` is the
revenue-critical path. Every change must preserve this flow with zero regressions.

## DATABASE

- **51+ tables** in `drizzle/schema.ts`
- **MySQL** via Drizzle ORM with connection pooling
- Relations defined in `drizzle/relations.ts`
- Migrations via `pnpm db:push`

## COMPLETION CHECKLIST

Before declaring any sprint complete, verify ALL of the following:

- [ ] `pnpm check` → 0 TypeScript errors
- [ ] `pnpm test` → ALL tests passing, zero regressions
- [ ] New tests count ≥ 60
- [ ] All mutations have audit logging
- [ ] All router endpoints use protectedProcedure
- [ ] All enum inputs normalized at router boundary
- [ ] Relations defined in drizzle/relations.ts
- [ ] Route added to App.tsx (lazy-loaded)
- [ ] Sidebar navigation updated in DashboardLayout.tsx
