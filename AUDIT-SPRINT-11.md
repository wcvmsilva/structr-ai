# GCHI Construction Brain — System Architecture Audit

**Audit Date:** March 14, 2026
**Scope:** Sprints 6 through 11 (Pricing Engine through Geographic Intelligence Layer)
**Auditor:** Lead Systems Architect
**System Version:** Checkpoint `7dea8a2c`

---

## 1. Executive Summary

The GCHI Construction Brain has been built across six sprints into a substantial construction estimation platform comprising **2,053 lines** of shared engine logic, **4,020 lines** of server-side DB helpers, **2,796 lines** of tRPC router code, **1,085 lines** of Drizzle schema (36 tables), and **7,127 lines** of test coverage across **525 passing tests in 12 test files**. The architecture follows a disciplined layered pattern: pure computation engines in `shared/`, DB helpers in `server/*-db.ts`, and tRPC routers in `server/*-router.ts`. This separation is well-executed and positions the system favorably for Sprint 12 (Scope Builder).

However, the audit reveals several issues that, while not blocking, should be addressed to prevent compounding technical debt. The most significant findings are: **inconsistent channel enum definitions** across 8 tables, **missing audit logging** in the assembly and pricing domains, a **duplicated `round2` function**, **zero foreign key constraints** at the database level, and **mixed naming conventions** (207 snake_case vs. 117 camelCase column names). None of these are Sprint 12 blockers, but three items warrant pre-Sprint 12 remediation.

> **Overall Readiness: GREEN** — The system is architecturally sound for Sprint 12 with three recommended pre-flight fixes.

---

## 2. Architecture Strengths

The system demonstrates several architectural decisions that reflect mature engineering judgment.

**Pure Engine Separation.** The four shared engines (`pricing-engine.ts`, `assembly-engine.ts`, `estimate-engine.ts`, `geo-engine.ts`) are implemented as pure functions with zero database dependencies. This makes them fully testable without mocking, portable across contexts, and composable. The estimate-engine explicitly declares itself as a "ZERO arithmetic" type-mapping layer, which is an excellent design choice that prevents calculation drift between modules.

**Layered Responsibility Model.** Each domain follows a consistent three-tier pattern: `shared/*-engine.ts` (pure computation) then `server/*-db.ts` (persistence + audit) then `server/*-router.ts` (validation + orchestration). This pattern is applied uniformly across pricing, assembly, estimate, client, project, intake, and geo domains.

**Profit Shield Governance.** The `MIN_GROSS_PROFIT` constant is defined once in `catalog-utils.ts` and imported by both `assembly-engine.ts` and `pricing-engine.ts`. The `enforceMinGP` function provides a centralized mechanism for profit floor enforcement. The geo-engine extends this with zone-specific minimum profit shields, creating a hierarchical governance model.

**Comprehensive Test Coverage.** With 525 tests across 12 files, the system has strong regression protection. Tests cover pure engine logic, schema validation, and operational flows. The test-to-source ratio is approximately 1:1.3 (7,127 test lines vs. 8,869 source lines), which is healthy for a business-critical system.

**Audit Infrastructure.** The `logAudit` helper provides a consistent interface for recording mutations with before/after snapshots, user attribution, and table-level granularity. It is correctly integrated into client, estimate, geo, and intake domains.

| Domain | Engine (shared) | DB Helper (server) | Router (server) | Tests |
|--------|----------------|-------------------|-----------------|-------|
| Pricing | 453 lines | 721 lines | 658 lines | 737 lines |
| Assembly | 400 lines | 491 lines | 430 lines | 782 lines |
| Estimate | 330 lines | 460 lines | 433 lines | 932 lines |
| Geo | 533 lines | 334 lines | 304 lines | 826 lines |
| Client | -- | 358 lines | 111 lines | (in sprint10) |
| Project | -- | 395 lines | 152 lines | (in sprint10) |
| Intake | -- | 324 lines | 126 lines | (in sprint10) |
| Catalog | 337 lines | (in db.ts) | (in routers.ts) | 262 lines |

---

## 3. Architecture Weaknesses

### 3.1 Duplicated `round2` Function

The `round2` helper is defined in two locations:

- `shared/pricing-engine.ts` (line 446) — exported
- `shared/geo-engine.ts` (line 531) — private, module-scoped

This creates a maintenance risk. If rounding behavior needs to change (e.g., banker's rounding for financial compliance), two locations must be updated. The canonical definition should live in `catalog-utils.ts` alongside `calcGrossProfit` and `MIN_GROSS_PROFIT`, and both engines should import from there.

**Severity:** Low. **Effort:** 10 minutes.

### 3.2 Missing Audit Logging in Assembly and Pricing Domains

The audit analysis reveals a significant gap:

| Domain | Audit Logging |
|--------|:------------:|
| Client | Present (create, update, delete) |
| Estimate | Present (create, status change, discount, archive) |
| Geo Zone | Present (create, update, deactivate, reactivate, seed) |
| Intake | Present (create, update status) |
| **Assembly** | **Missing** |
| **Pricing (Price Book)** | **Missing** |
| **Project** | **Missing** |

Assembly create, update, delete, and clone operations execute without audit trail. Price Book item create, update, and deactivate operations similarly lack audit records. Project create, update, status transitions, and delete operations are also unaudited. For a construction estimation system where pricing changes directly impact profitability, this is a governance concern.

**Severity:** Medium. **Effort:** 2-3 hours.

### 3.3 Inconsistent Channel Enum Definitions

The `channel` enum is defined differently across tables, creating a semantic mismatch:

| Table | Channel Values |
|-------|---------------|
| `price_book_items` | `direct`, `insurance`, `commercial` |
| `channel_multipliers` | `direct`, `insurance`, `commercial` |
| `clients` | `residential`, `commercial`, `insurance`, `direct` |
| `projects` | `residential`, `commercial`, `insurance` |
| `estimates` | `residential`, `commercial`, `insurance` |
| `estimate_drafts` | `residential`, `commercial`, `insurance` |
| `intake_forms` | `residential`, `commercial`, `insurance` |

The `estimate-engine.ts` contains a `mapChannelToDbEnum` function that maps `direct` to `residential`, confirming that these are meant to be equivalent. However, the schema itself uses both vocabularies, and the `clients` table uniquely includes all four values. This creates confusion about whether `direct` and `residential` are the same concept and risks silent data mismatches in joins.

**Severity:** Medium. **Effort:** 1-2 hours (schema migration + code update).

### 3.4 Assembly CRUD Uses `protectedProcedure` Instead of `adminProcedure`

Assembly create, update, delete, and clone operations use `protectedProcedure` (any authenticated user), while equivalent operations in pricing, geo, and project domains correctly use `adminProcedure`. In a multi-user environment, this means any logged-in user could modify the assembly library, which is a core pricing asset.

**Severity:** Medium. **Effort:** 15 minutes.

### 3.5 Legacy `db.ts` and `routers.ts` Monoliths

The original `server/db.ts` (619 lines) and `server/routers.ts` (582 lines) still contain bundle/catalog CRUD logic from early sprints. While newer domains have been properly extracted into dedicated files (`assembly-db.ts`, `estimate-db.ts`, etc.), the legacy bundle and catalog operations remain in the monolithic files. This makes navigation harder and creates an inconsistent organizational pattern.

**Severity:** Low. **Effort:** 1-2 hours.

---

## 4. Data Model Observations

### 4.1 Zero Foreign Key Constraints

The schema defines **zero** `references()` calls across all 36 tables. Every `projectId`, `clientId`, `assemblyId`, `estimateId`, `bundleId`, `intakeFormId`, and similar FK-like column is a bare `int()` with no referential integrity enforcement at the database level. While the application layer validates references before writes (e.g., `estimate-router.ts` checks `getProjectById` before creating a draft), the database itself permits orphan records.

This is a deliberate trade-off — Drizzle ORM with MySQL/TiDB can enforce FKs, but the `relations.ts` file is empty (`import {} from "./schema"`), confirming that relations were intentionally deferred. For a single-writer application this is acceptable, but as the system grows toward multi-user concurrent access, orphan risk increases.

**Recommendation:** Add Drizzle relations for documentation and type-safe joins, even if MySQL FK constraints remain deferred. Priority FK candidates:

| Child Table | FK Column | Parent Table |
|------------|-----------|-------------|
| `assembly_components` | `assemblyId` | `assemblies` |
| `assembly_components` | `priceBookItemId` | `price_book_items` |
| `estimate_line_items` | `estimateId` | `estimates` |
| `bundle_items` | `bundleId` | `bundles` |
| `scope_suggestions` | `intakeFormId` | `intake_forms` |
| `projects` | `clientId` | `clients` |
| `intake_forms` | `projectId` | `projects` |

### 4.2 Mixed Column Naming Convention

The schema contains **207 snake_case** columns and **117 camelCase** columns. The pattern is clear: tables created in Sprint 6+ use snake_case (`price_book_items`, `assemblies`, `geo_zones`), while tables from earlier sprints use camelCase (`catalogItems`, `bundles`, `intakeQuestions`). This is a cosmetic issue that does not affect functionality but complicates query writing and onboarding.

**Recommendation:** Standardize on snake_case for all new tables. Migrate legacy tables opportunistically during future schema changes.

### 4.3 Soft Delete Inconsistency

Six tables implement soft delete via `deletedAt` timestamp: `users`, `price_book_items`, `clients`, `projects`, `assemblies`, and `estimates`. However, several tables that logically should support soft delete do not:

| Table | Has `deletedAt` | Has `isActive` | Risk |
|-------|:--------------:|:--------------:|------|
| `estimate_drafts` | No | No | Drafts use status-based archival (`archived` status) — acceptable |
| `geo_zones` | No | Yes | Uses `isActive` flag only — acceptable for reference data |
| `bundles` | No | Yes | Uses `isActive` flag only — acceptable for legacy |
| `intake_forms` | No | No | Uses status-based flow — acceptable |
| `catalog_items` | No | Yes | Uses `isActive` flag only — legacy table |

The dual-strategy (some tables use `deletedAt`, others use `isActive`, others use status enums) is not inherently wrong, but it requires developers to know which strategy each table uses. A consistent pattern would reduce cognitive load.

### 4.4 Index Coverage

Index coverage is generally strong. All FK-like columns that participate in frequent queries have indexes. Notable coverage:

- `projects`: 5 indexes (status, channel, clientId, region, projectType)
- `assemblies`: 6 indexes (trade, category, isActive, parentAssemblyId, finishLevel, assemblyType)
- `price_book_items`: 7 indexes (category, isActive, sku, trade, itemType, finishLevel, channel)
- `estimates`: 4 indexes (projectId, clientId, status, estimateDraftId)

No missing indexes were identified for current query patterns.

### 4.5 `zone_modifier_snapshot` Column on Projects

The `projects` table includes a `zone_modifier_snapshot` JSON column that captures geo zone modifiers at the time of zone assignment. This is a correct point-in-time snapshot pattern that prevents retroactive price changes from affecting existing projects. The `ZoneModifierSnapshot` interface is well-defined with `capturedAt` timestamp for auditability.

---

## 5. Governance Validation

### 5.1 RBAC Implementation

The RBAC system is implemented at two levels:

**Procedure-level guards** use three tRPC middleware tiers: `publicProcedure` (no auth), `protectedProcedure` (authenticated user), and `adminProcedure` (admin role check). This is correctly applied across most domains, with the assembly domain exception noted in Section 3.4.

**Database-level RBAC** includes `roles`, `permissions`, and `role_permissions` tables with a join-table pattern. The `users` table has a `roleId` FK and a `role` enum (`admin`/`user`). The `rbac.ts` module provides `listRoles`, `listPermissions`, `getRoleWithPermissions`, and `assignRole` helpers. This infrastructure is in place but not yet consumed by the procedure-level guards (which use the simpler `ctx.user.role` check). The granular permission system is ready for future Sprint requirements.

### 5.2 Audit Logging

The `audit_logs` table captures: `userId`, `action` (create/update/delete/status_change/login/logout), `tableName`, `recordId`, `before` (JSON), `after` (JSON), and `createdAt`. The `logAudit` helper is fire-and-forget (does not block the mutation), which is appropriate for non-critical audit trails.

**Coverage gaps** are documented in Section 3.2. The three unaudited domains (assembly, pricing, project) represent the highest-value data in the system.

### 5.3 Transaction Atomicity

Transaction usage is minimal. Only `estimate-db.ts` mentions transactional behavior in its documentation header, but the actual implementation uses sequential `db.insert` and `logAudit` calls without wrapping them in a `db.transaction()` block. This means a failed audit log write after a successful insert would leave an unaudited record, and a server crash between insert and audit would produce the same result.

For the current single-user context, this risk is low. For multi-user concurrent access, wrapping critical multi-step mutations in `db.transaction()` becomes important.

### 5.4 Soft Delete Safety

Soft delete is correctly implemented where present. The `assembly-db.ts` consistently filters `isNull(assemblies.deletedAt)` in list and get queries. The `client-db.ts` and `project-db.ts` similarly respect soft delete in all read paths. The `estimate-router.ts` validates that referenced projects and clients are not soft-deleted before creating drafts.

**Orphan risk:** When a client is soft-deleted, their projects remain active. When a project is soft-deleted, its estimates, intake forms, and drafts remain accessible. This is by design (preserving historical data), but the system does not currently prevent new records from referencing soft-deleted parents. The router-level validation in `estimate-router.ts` is the correct mitigation pattern and should be replicated in other domains.

---

## 6. Data Flow Validation

The intended data flow is:

```
Client → Project → Intake → Geographic Intelligence → Assemblies → Bundle → Estimate
```

**Current implementation status:**

| Step | Status | Notes |
|------|--------|-------|
| Client creation | Implemented | `client-db.ts` + `client-router.ts` |
| Client to Project | Implemented | `projects.clientId` FK, validated in router |
| Project to Intake | Implemented | `intake_forms.projectId` FK |
| Intake to Geo Intelligence | **Partially connected** | Geo engine exists but is not auto-triggered by intake |
| Geo to Assemblies | **Not yet connected** | `zoneToPricingDimensions` exists but is not called in assembly calculation flow |
| Assemblies to Bundle/Estimate | Implemented | `estimate-router.createFromCalculator` orchestrates full flow |

**Gap 1: Geo-to-Assembly Integration.** The `geo-engine.ts` exports `zoneToPricingDimensions()` which maps zone modifiers to `PricingDimensions`, and the `assembly-engine.ts` accepts `PricingDimensions` in its calculation context. However, the `estimate-router.ts` currently hardcodes channel multipliers (lines 202-203) instead of pulling them from the geo zone snapshot. This means geographic modifiers are computed and stored but not yet applied to actual pricing calculations.

**Gap 2: Intake-to-Scope Automation.** The `scope_suggestions` table exists with `intakeFormId` and `assemblyId` columns, but no engine or router populates it. This is the exact gap that Sprint 12 (Scope Builder) is designed to fill.

Both gaps are expected at this stage and are correctly positioned for Sprint 12 resolution.

---

## 7. Scope Builder Readiness Assessment

Sprint 12 (Scope Builder) requires the ability to: (1) read intake data, (2) match intake parameters to assemblies, (3) apply geographic modifiers, (4) generate a scope suggestion, and (5) persist the result for review.

### 7.1 Intake Data Structure Sufficiency

The `intake_forms` table provides: `serviceType`, `area`, `finishLevel`, `condition`, `notes`, `rawPayload` (JSON), and `parsedScope` (JSON). The `parsedScope` field is designed to hold structured output from AI parsing, and the `confidenceScore` provides a quality signal. The `intakeQuestions` and `intakeResponses` tables provide a flexible Q&A structure for detailed data capture.

**Assessment:** Sufficient. The `parsedScope` JSON field provides the extensibility needed for scope rules without schema changes.

### 7.2 Assembly Library Completeness

The assembly library includes 491 lines of DB helpers with full CRUD, component management, and cost calculation. The `assemblies` table supports `assemblyType` (standard/composite/template), `category`, `trade`, `finishLevel`, and `region` fields — all of which are matchable dimensions for scope rules.

**Assessment:** Sufficient. The assembly metadata provides enough dimensions for rule-based matching.

### 7.3 Geographic Modifier Isolation

The geo-engine is fully isolated in `shared/geo-engine.ts` with pure functions. The `zoneToPricingDimensions` function provides a clean interface for converting zone data into pricing modifiers. The `buildProjectGeoContext` function creates a complete geo context from an address, ready for integration.

**Assessment:** Sufficient. The geo layer is well-isolated and ready for Scope Builder consumption.

### 7.4 Estimate Engine Compatibility

The estimate-engine accepts `BatchCalculationResult` from the assembly-engine and transforms it into a persistence payload. The `transformBatchToEstimateDraft` function is a pure type mapper. The Scope Builder can feed its output directly into this pipeline.

**Assessment:** Sufficient. The estimate pipeline is composable.

### 7.5 Ability to Introduce `scope_rules` Without Refactoring

The `scope_suggestions` table already exists with the correct structure. A new `scope_rules` table can be added alongside it without touching existing tables. The Scope Builder can be implemented as a new engine (`shared/scope-engine.ts`) + DB helper (`server/scope-db.ts`) + router (`server/scope-router.ts`) following the established pattern.

**Assessment:** Sufficient. The architecture supports additive extension.

---

## 8. Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|:-----------:|:------:|------------|
| Channel enum mismatch causes silent data corruption in cross-domain joins | Medium | High | Standardize enum values before Sprint 12 |
| Missing audit trail on assembly/pricing changes makes it impossible to trace pricing errors | Low | High | Add audit logging to assembly-db and pricing-db |
| Geo modifiers computed but not applied to pricing creates false confidence in geographic accuracy | Medium | Medium | Wire `zoneToPricingDimensions` into estimate-router before Sprint 12 |
| No DB-level FK constraints allows orphan records under concurrent writes | Low | Medium | Add Drizzle relations; consider MySQL FKs for critical paths |
| `round2` duplication causes rounding inconsistency if one copy is updated | Low | Low | Consolidate to single export in catalog-utils |

---

## 9. Recommended Pre-Sprint 12 Fixes

These three items should be resolved before starting Sprint 12 to prevent compounding issues:

### Fix 1: Consolidate `round2` (10 minutes)

Move the `round2` function from `pricing-engine.ts` to `catalog-utils.ts` (alongside `calcGrossProfit` and `MIN_GROSS_PROFIT`). Update imports in `pricing-engine.ts` and `geo-engine.ts`. Remove the private copy from `geo-engine.ts`.

### Fix 2: Add Audit Logging to Assembly and Pricing Domains (2 hours)

Add `logAudit` calls to `assembly-db.ts` (create, update, delete, clone) and `pricing-db.ts` (create, update, deactivate). Follow the pattern established in `client-db.ts` and `geo-db.ts`. Add `logAudit` to `project-db.ts` (create, update, status change, delete) as well.

### Fix 3: Elevate Assembly CRUD to `adminProcedure` (15 minutes)

Change `create`, `update`, `delete`, `clone`, `addComponent`, and `removeComponent` in `assembly-router.ts` from `protectedProcedure` to `adminProcedure`. Read-only operations (`list`, `getById`, `getByTrade`, `getByCategory`, `calculateCost`, `calculateBatch`, `categories`, `trades`, `stats`) should remain as `publicProcedure`.

### Deferred Items (Post-Sprint 12)

The following items are noted but not blocking:

- Channel enum standardization (requires schema migration)
- Column naming convention standardization (cosmetic, low priority)
- Drizzle relations definition (documentation value, no runtime impact)
- Transaction wrapping for multi-step mutations (needed for multi-user)
- Legacy `db.ts`/`routers.ts` extraction (organizational cleanup)

---

## 10. Sprint 12 Readiness Status

| Audit Area | Status | Notes |
|-----------|:------:|-------|
| Module Architecture | **GREEN** | Clean layered separation, composable engines |
| Data Model Integrity | **GREEN** | Schema supports Scope Builder without changes |
| Data Flow | **YELLOW** | Geo modifiers not yet wired into pricing pipeline |
| Governance | **YELLOW** | Assembly/pricing audit gaps; assembly RBAC too permissive |
| Scope Builder Readiness | **GREEN** | `scope_suggestions` table exists; pattern is clear |
| Test Coverage | **GREEN** | 525 tests, zero regressions |

### Overall Verdict

> **GREEN — Proceed to Sprint 12.**
>
> The system architecture is fundamentally sound. The three-tier engine pattern is well-established, the data model supports additive extension, and the test suite provides strong regression protection. The recommended pre-flight fixes (audit logging, RBAC elevation, round2 consolidation) are low-effort, high-value improvements that should be completed in a pre-Sprint 12 hardening pass before the Scope Builder work begins.

---

## Appendix A: Codebase Metrics

| Metric | Value |
|--------|-------|
| Total schema tables | 36 |
| Total schema lines | 1,085 |
| Shared engine lines | 2,053 |
| Server DB helper lines | 4,020 |
| Server router lines | 2,796 |
| Test lines | 7,127 |
| Test files | 12 |
| Total tests | 525 |
| Test pass rate | 100% |
| Audit-covered domains | 4 of 7 |
| FK constraints defined | 0 |
| Indexes defined | 40+ |

## Appendix B: Module Dependency Graph

```
catalog-utils.ts (MIN_GROSS_PROFIT, calcGrossProfit, round2, round4, enforceMinGP)
    ↑                    ↑
    |                    |
pricing-engine.ts    assembly-engine.ts
    ↑                    ↑
    |                    |
    └──── estimate-engine.ts (type mapping only, zero arithmetic)
                         ↑
                         |
              geo-engine.ts (pure, standalone — zoneToPricingDimensions bridges to pricing)
```

## Appendix C: Channel Enum Mapping

```
Price Book / Channel Multipliers:  direct | insurance | commercial
Clients:                           residential | commercial | insurance | direct
Projects / Estimates / Drafts:     residential | commercial | insurance
Intake Forms:                      residential | commercial | insurance

Mapping rule (estimate-engine.ts):
  direct     → residential
  insurance  → insurance
  commercial → commercial
```

The canonical vocabulary for customer-facing contexts should be `residential | commercial | insurance`. The `direct` value in price book and channel multipliers represents the internal pricing channel and should be renamed to `residential` for consistency, or explicitly documented as a distinct concept.
