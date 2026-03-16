# structr.ai structr.ai v9 — Sprint 1-2 TODO

- [x] Upgrade to web-db-user (full-stack with backend, DB, auth)
- [x] Resolve merge conflicts from upgrade (Home.tsx, index.css, App.tsx)
- [x] Configure dark theme with gold accents in new template structure
- [x] Create Drizzle schema for all 15 tables (users, projects, project_files, assemblies, bundles, bundle_items, intake_questions, intake_responses, review_actions, risk_rules, building_codes, crews, crew_assignments, project_history, workflow_runs)
- [x] Run pnpm db:push to sync database schema
- [x] Build DashboardLayout with sidebar navigation (Dashboard, Intake, Estimate, Review, Bundles, History, Settings)
- [x] Build Dashboard (Home) page with metrics, quick actions, recent projects, system status
- [x] Build Bundles page (migrated structr.ai with Assembly Library, Cart, Profit Protection)
- [x] Build Intake page placeholder with form structure
- [x] Build Estimate page placeholder with assembly selector
- [x] Build Review page placeholder with approval workflow
- [x] Build History page with project table and search
- [x] Build Settings page with company profile, profit protection, integrations
- [x] Configure routing in App.tsx with all 7 pages
- [x] Write vitest tests for schema (15 tests) and auth (1 test)
- [ ] Connect structr.ai page to real database data (replace mock data)
- [ ] Implement role-based access (admin, estimator, reviewer, viewer)
- [ ] Populate assemblies table from Supabase data
- [ ] Populate bundles and bundle_items from Supabase data
- [ ] Build tRPC procedures for CRUD operations
- [x] Add catalogItems table to Drizzle schema for JobTread CSV data
- [x] Create seed script to import 509 CSV items into MySQL (filter: UnitCost>0 AND UnitPrice>0)
- [x] Build tRPC catalogRouter with real DB queries (list, getByGroup, search)
- [x] Rewire structr.ai frontend to use live tRPC data instead of mock data.ts
- [x] Write vitest tests for catalog router and seed data integrity (18 tests passing)
- [x] Remove or deprecate client/src/lib/data.ts mock data (no longer imported by any component)
- [x] PHASE A: Add bundles + bundle_items tables to Drizzle schema with snapshots
- [x] PHASE A: Run db:push migration for new tables
- [x] PHASE B: Create tRPC bundleRouter — createBundle procedure
- [x] PHASE B: Create tRPC bundleRouter — getBundleById procedure
- [x] PHASE B: Create tRPC bundleRouter — listBundles procedure
- [x] PHASE B: Create tRPC bundleRouter — updateBundleMeta procedure
- [x] PHASE B: Create tRPC bundleRouter — addItemToBundle procedure
- [x] PHASE B: Create tRPC bundleRouter — updateBundleItemQuantity procedure
- [x] PHASE B: Create tRPC bundleRouter — removeBundleItem procedure
- [x] PHASE B: Create tRPC bundleRouter — duplicateBundle procedure
- [x] PHASE B: Create tRPC bundleRouter — deleteBundle procedure
- [x] PHASE B: Create tRPC bundleRouter — recalculateBundleTotals procedure
- [x] PHASE C: Extend business logic module for line/bundle total calculations
- [x] PHASE C: Enforce Profit Shield floor logic on bundle totals
- [x] PHASE D: Editable quantity per cart item in structr.ai UI
- [x] PHASE D: Save current bundle to database
- [x] PHASE D: Load saved bundle from database
- [x] PHASE D: Rename bundle
- [x] PHASE D: Duplicate bundle
- [x] PHASE D: Delete bundle
- [x] PHASE E: Write vitest tests for all 10 new behaviors (32 tests passing, 65 total)
- [x] SPRINT 4 PHASE A: Add preset fields to bundles schema (presetCategory, presetTags)
- [x] SPRINT 4 PHASE A: Create estimateDrafts table in Drizzle schema
- [x] SPRINT 4 PHASE A: Run db:push migration for schema changes
- [x] SPRINT 4 PHASE B: Create tRPC preset procedures (listPresets, createPresetFromBundle, createBundleFromPreset, updatePresetMeta, deletePreset)
- [x] SPRINT 4 PHASE B: Create tRPC sendBundleToEstimateDraft procedure
- [x] SPRINT 4 PHASE C: Create typed EstimateDraftPayload DTO in shared/catalog-utils
- [x] SPRINT 4 PHASE C: Build transformBundleToEstimateDraft business logic
- [x] SPRINT 4 PHASE D: Update frontend — preset browsing gallery
- [x] SPRINT 4 PHASE D: Update frontend — load preset into working bundle
- [x] SPRINT 4 PHASE D: Update frontend — mark bundle as preset
- [x] SPRINT 4 PHASE D: Update frontend — Send to Estimate button and flow
- [x] SPRINT 4 PHASE D: Clear UI distinction between preset and working bundles
- [x] SPRINT 4 PHASE E: Write vitest tests for preset CRUD lifecycle
- [x] SPRINT 4 PHASE E: Write vitest tests for EstimateDraftPayload transformation
- [x] SPRINT 4 PHASE E: Write vitest tests for no regression in existing bundle behavior (98 tests total, all passing)

## Sprint 5 — Industrial-Grade Schema Migration
- [x] SPRINT 5 PHASE 1: Audit current schema vs proposed DDL — produce diff report
- [x] SPRINT 5 PHASE 2: Generate updated Drizzle schema files matching industrial-grade DDL (29 tables, 12 new)
- [x] SPRINT 5 PHASE 3: Run migrations — all data preserved (458 catalog, 33 bundles, 24 items, 4 drafts, 1 user)
- [x] SPRINT 5 PHASE 4: Implement RBAC — 4 roles, 33 permissions, 69 mappings, 6 admin procedures, seed script
- [x] SPRINT 5 PHASE 5: Implement audit logging — 14 mutations wrapped, admin list/getById procedures
- [x] SPRINT 5 PHASE 6: Supabase assembly migration complete — 15 assemblies, 114 components imported to MySQL
- [x] SPRINT 5 PHASE 7: Write comprehensive vitest tests for all new behavior (151 tests, all passing)
- [x] SPRINT 5 PHASE 8: End-to-end verification and checkpoint

## Sprint 6 — Master Pricing Architecture

- [x] SPRINT 6 PHASE 1: Audit current schema, price_book_items, catalog_items, assemblies, assembly_components
- [x] SPRINT 6 PHASE 2: Design and document complete Master Pricing Architecture (10-section deliverable)
- [x] SPRINT 6 PHASE 3a: Extend Drizzle schema — 6 new tables (36 total MySQL tables)
- [x] SPRINT 6 PHASE 3b: Extend price_book_items with 10 pricing dimension columns
- [x] SPRINT 6 PHASE 3c: Add assembly_type enum to assemblies table
- [x] SPRINT 6 PHASE 3d: Create remodel_templates and newcon_templates tables
- [x] SPRINT 6 PHASE 3e: Run db:push migrations — all 36 tables live
- [x] SPRINT 6 PHASE 4a: Migrate 458 catalog_items into price_book_items (458 items, 458 history entries, totals verified $206K/$363K)
- [x] SPRINT 6 PHASE 4b: Seed pricing reference data — 10 regions, 9 channel muls, 12 finish levels, 5 parametric models, 9 remodel templates, 3 newcon templates
- [x] SPRINT 6 PHASE 5a: Build tRPC priceBook router — CRUD, search, filter by trade/category/channel/finish
- [x] SPRINT 6 PHASE 5b: Build tRPC regional router — coastal modifiers, channel multipliers
- [x] SPRINT 6 PHASE 5c: Build pricing calculation engine — cumulative formula (unit_cost × waste × coastal × channel)
- [x] SPRINT 6 PHASE 5d: Build price governance procedures — history tracking, manual override workflow
- [x] SPRINT 6 PHASE 6: Write comprehensive vitest tests for all pricing behavior (212 tests, all passing)
- [x] SPRINT 6 PHASE 7: End-to-end verification, checkpoint, and deliver complete report

## Sprint 7 — Assembly Library (Remodel Scope)

- [x] SPRINT 7 PHASE 1: Read existing schema, pricing engine, price book data for integration points
- [x] SPRINT 7 PHASE 2: Update Drizzle schema — assemblies (9 new fields: subcategory, finishLevel, region, coastalModifier, tradeSequenceOrder, inclusions, exclusions, hiddenConditionFlag, parentAssemblyId), assembly_components (componentType enum)
- [x] SPRINT 7 PHASE 3: Create assembly-db.ts — 13 DB helpers (listAssemblies, getById, getByTrade, getByCategory, create, update, delete, clone, addComponent, removeComponent, getCategories, getTrades, getStats)
- [x] SPRINT 7 PHASE 4: Create assembly-engine.ts — BOM calculation, cost/price breakdown by component_type, Profit Shield, batch multi-assembly calculation, formatCostBreakdown
- [x] SPRINT 7 PHASE 5: Create assembly-router.ts — 8 tRPC procedures (list, getById, create, update, delete, clone, addComponent, removeComponent, calculateCost, stats, categories, trades), integrated into appRouter
- [x] SPRINT 7 PHASE 6: Seed 58 remodel assemblies across 9 categories (Kitchen, Bathroom, Flooring, Painting, Electrical, Plumbing, HVAC, Exterior, General) with real price_book_items references
- [x] SPRINT 7 PHASE 7: Write 46 comprehensive vitest tests (schema, BOM calc, Profit Shield, batch, cost breakdown, edge cases, router structure, pricing engine integration)
- [x] SPRINT 7 PHASE 8: All 258 tests passing (46 new + 212 existing), zero regressions
- [x] SPRINT 7 PHASE 9: End-to-end verification, checkpoint, and deliver Sprint 7 report

## Sprint 8 — Bundle Calculator UI

- [x] SPRINT 8 PHASE 1: Create useBundleCalculator hook — state management, tRPC calls, debounced recalculation, 25-assembly limit
- [x] SPRINT 8 PHASE 2: Create AssemblySelector component — category filter tabs, search, assembly cards with checkbox, quantity +/- controls
- [x] SPRINT 8 PHASE 3: Create CostBreakdownTable — expandable per assembly, columns: Component, Type, Qty, Unit, Base Cost, Waste, Adjusted, Subtotal, GP%
- [x] SPRINT 8 PHASE 4: Create BundleSummaryPanel — totals, Profit Shield badge (green/yellow/red), trade breakdown with progress bars, region/channel/finish badges
- [x] SPRINT 8 PHASE 5: Create main Calculator page — context selectors (region, channel, finish), two-column layout, "Export to Estimate" button (placeholder)
- [x] SPRINT 8 PHASE 6: Add /calculator route to App.tsx and Calculator to dashboard sidebar navigation
- [x] SPRINT 8 PHASE 7: Server-side calculateBatch procedure already existed from Sprint 7 — verified integration
- [x] SPRINT 8 PHASE 8: Write 55 comprehensive vitest tests — Profit Shield status, trade breakdown, export eligibility, batch calculation, cost breakdown by type, context validation, edge cases, result structure
- [x] SPRINT 8 PHASE 9: All 313 tests passing (55 new + 258 existing), zero regressions
- [x] SPRINT 8 PHASE 10: End-to-end verification, checkpoint, and deliver Sprint 8 report

## Sprint 9 — Estimate Draft Real Flow

- [x] SPRINT 9 PHASE 1: Domain audit — reviewed estimates, estimate_drafts, estimate_line_items, EstimateDraftPayload, routers, audit, RBAC; documented in sprint9-audit.md
- [x] SPRINT 9 PHASE 2: Extended estimate_drafts schema — 9 new columns (region, finishLevel, source, assemblyCount, assemblySelections, profitShieldPassed, profitShieldMinPct, projectId, clientId); db:push successful
- [x] SPRINT 9 PHASE 3: Created estimate-engine.ts — pure type mapping (BatchCalculationResult → EstimateDraftPersistPayload), ZERO arithmetic, 7 validation rules, channel mapping
- [x] SPRINT 9 PHASE 4: Created estimate-db.ts — 8 DB helpers (createFromPayload with audit, getById, list with pagination/filter, updateStatus with state machine, updateNotes, applyDiscount, archiveEstimateDraft, getStats)
- [x] SPRINT 9 PHASE 5: Created estimate-router.ts — 9 tRPC procedures (createFromCalculator, getById, list, updateStatus, updateNotes, applyDiscount, archive, stats, validate)
- [x] SPRINT 9 PHASE 6: Integrated estimate-router into appRouter, wired Calculator UI "Export to Estimate" button to estimate.createFromCalculator mutation
- [x] SPRINT 9 PHASE 7: Validation rules implemented — region required, channel required, ≥1 assembly, valid quantities, zero-component check, bundle GP ≥ 35%, individual assembly GP ≥ 28% critical warning
- [x] SPRINT 9 PHASE 8: Written 70 comprehensive vitest tests — schema extensions, validation (14), type mapping (14), channel mapping (3), line item mapping (4), assembly selection mapping (4), status transitions (8), discount calc (4), router structure (10), end-to-end flow (3)
- [x] SPRINT 9 PHASE 9: All 383 tests passing (70 new + 313 existing), zero regressions; fixed Sprint 4 tests to use estimateLegacy namespace
- [x] SPRINT 9 PHASE 10: End-to-end verification, checkpoint, and deliver Sprint 9 report

## Sprint 10 — Operational Project Foundation

- [x] SPRINT 10 PHASE 1: Client Domain — extended clients schema (billing/shipping address fields, updatedBy), created client-db.ts (8 DB helpers: create, getById, list with pagination/search, update, softDelete, getByEmail, getByPhone, getStats), created client-router.ts (8 tRPC procedures with audit logging)
- [x] SPRINT 10 PHASE 2: Project Domain — extended projects schema (project_type, state, zip_code, zone, region, updatedBy), created project-db.ts (10 DB helpers: create, getById, list with filters, update, updateStatus, softDelete, getByClient, getStats, getByStatus, getRecent), created project-router.ts (9 tRPC procedures with audit logging)
- [x] SPRINT 10 PHASE 3: Intake Foundation — extended intake_forms schema (service_type, area, finish_level, condition, notes), created intake-db.ts (8 DB helpers: create, getById, list, update, softDelete, getByProject, getStats, getRecent), created intake-router.ts (7 tRPC procedures with audit logging)
- [x] SPRINT 10 PHASE 4: Estimate Draft Linking — added project_id/client_id existence validation to createFromCalculator (verifies FK references exist before creating draft)
- [x] SPRINT 10 PHASE 5: Frontend — created Clients.tsx (list/create/edit with search, dialog forms), Projects.tsx (list/create/edit with status badges, client dropdown), rewrote Intake.tsx (project/client selection, form submission). Added /clients and /projects routes + sidebar navigation
- [x] SPRINT 10 PHASE 6: Validation rules — project_id/client_id existence checks in estimate-router, Zod schema validation in all 3 new routers, soft delete protection
- [x] SPRINT 10 PHASE 7: Written 76 comprehensive vitest tests — Client DB helpers (10), Client router structure (8), Project DB helpers (12), Project router structure (9), Intake DB helpers (8), Intake router structure (7), Estimate linking validation (6), Frontend page exports (3), Cross-domain integration (13)
- [x] SPRINT 10 PHASE 8: All 459 tests passing (76 new + 383 existing), zero regressions
- [x] SPRINT 10 PHASE 9: End-to-end verification, checkpoint, and deliver Sprint 10 report

## Sprint 11 — Geographic Intelligence Layer

- [x] SPRINT 11 PHASE 1: Create geo_zones table in Drizzle schema with all required fields (18 columns, 2 indexes)
- [x] SPRINT 11 PHASE 2: Seed 5 Charleston zones (Barrier Island Premium, Charleston Coastal, Charleston Metro, Summerville/Goose Creek, Outer Lowcountry)
- [x] SPRINT 11 PHASE 3: Create geo-engine.ts — 12 functions: detectZoneFromZip, detectZoneFromCoords, detectZone, getZoneModifiers, zoneToPricingDimensions, coastalExposureToModifier, getEffectiveMinProfitShield, buildProjectGeoContext, validateGeoContext, haversineDistance + CHARLESTON_ZONES seed data
- [x] SPRINT 11 PHASE 4: Extended projects table with zone_modifier_snapshot JSON column
- [x] SPRINT 11 PHASE 5: Created geo-db.ts — 12 DB helpers (createGeoZone, getById, getByName, list, update, deactivate, reactivate, loadActiveZonesForEngine, dbZoneToEngineZone, assignZoneToProject, getProjectZoneSnapshot, getGeoZoneStats, seedCharlestonZones)
- [x] SPRINT 11 PHASE 6: Created geo-router.ts — 14 tRPC procedures (list, getById, getByName, create, update, deactivate, reactivate, detectFromZip, detectFromCoords, assignToProject, getProjectZone, stats, seedCharleston, charlestonZones)
- [x] SPRINT 11 PHASE 7: Pricing Engine integration — zoneToPricingDimensions maps zone modifiers to PricingDimensions (laborModifier→regionalLaborModifier, materialModifier→regionalMaterialModifier, logisticsModifier→regionalCostModifier, coastalExposure→coastalModifier)
- [x] SPRINT 11 PHASE 8: Price Book extension — 12 coastal-grade items added (Hurricane Straps, Impact Windows, Marine-Grade Hardware, etc.)
- [x] SPRINT 11 PHASE 9: Written 66 comprehensive vitest tests — Schema (6), ZIP Detection (7), Coord Detection (5), Combined Detection (3), Modifier Snapshots (4), Pricing Dims (4), Coastal Exposure (5), Validation (7), Haversine (4), Charleston Seed (6), DB Helpers (5), Router Structure (6), Pricing Integration (4)
- [x] SPRINT 11 PHASE 10: All 525 tests passing (66 new + 459 existing), zero regressions across 12 test files
- [x] SPRINT 11 PHASE 11: End-to-end verification, checkpoint, and deliver Sprint 11 report

## Sprint 11.5 — Hardening Pass (Pre-Sprint 12)

- [x] PHASE 1: Create shared/utils/math.ts with canonical round2/round4 functions
- [x] PHASE 1: Replace duplicated round2 in pricing-engine.ts with import from shared/utils/math.ts
- [x] PHASE 1: Replace duplicated round2 in geo-engine.ts with import from shared/utils/math.ts
- [x] PHASE 1: Ensure all cost/pricing calculations reference the shared utility (assembly-engine imports from pricing-engine re-export)
- [x] PHASE 2: Add audit logging to assembly-db.ts (create, update, delete, clone, addComponent, removeComponent)
- [x] PHASE 2: Add audit logging to pricing-db.ts (create, update, deactivate) + removed duplicate router-level audit calls
- [x] PHASE 2: Add audit logging to project-db.ts (create, update, status change, delete) — already had audit logging
- [x] PHASE 2: Verify audit logs remain append-only — no DELETE on audit_logs table anywhere in codebase
- [x] PHASE 3: Elevate assembly create to adminProcedure
- [x] PHASE 3: Elevate assembly update to adminProcedure
- [x] PHASE 3: Elevate assembly delete to adminProcedure
- [x] PHASE 3: Elevate assembly clone to adminProcedure
- [x] PHASE 3: Elevate assembly addComponent to adminProcedure
- [x] PHASE 3: Elevate assembly removeComponent to adminProcedure
- [x] PHASE 4: Verify zoneToPricingDimensions mapping works correctly
- [x] PHASE 4: Verify geo modifiers propagate into assembly-engine calculations
- [x] PHASE 4: Verify geo modifiers propagate into estimate totals + added geoDimensions schema to calculateCost/calculateBatch routers
- [x] PHASE 5: Written 37 hardening tests across 5 sections (Rounding 6, Audit 8, RBAC 8, Geo Propagation 10, E2E Integration 6) — note: 1 extra test added
- [x] PHASE 5: All 562 tests passing (37 new + 525 existing), zero regressions across 13 test files
- [x] Sprint 11.5 checkpoint and report delivery

## Sprint 11.6 — Domain Normalization Pass

- [x] PHASE 1: Domain audit — 21 assembly categories (should be ~12), 28 trades (should be ~15), 3 different channel enum sets across 8 tables, PBI has 19 categories in Title Case
- [x] PHASE 2: Define canonical enums in shared/domain/taxonomy.ts — 9 enums (Channel 3, FinishLevel 3, ProjectType 7, ServiceType 20, AssemblyType 4, Trade 26, Category 19, PbCategory 19, Condition 6) + LABELS maps
- [x] PHASE 3: Create shared/domain/normalization.ts — 8 normalize functions (channel, finishLevel, projectType, serviceType, trade, category, pbCategory, condition) + normalizeRecord batch helper + 150+ alias mappings
- [x] PHASE 4: API boundary enforcement — unified channel enum [direct, insurance, commercial, residential] across all 8 schema tables, updated all DB helpers to default "direct", updated all router Zod schemas, updated estimate-engine mapChannelToDbEnum, zero TS errors
- [x] PHASE 5: Legacy data migration — forward (289 rows: 52 assembly cats, 44 assembly trades, 175 bundle channels, 18 estimate draft channels) + rollback script. Categories: 21→13, Trades: 28→20, Channels: residential→direct
- [x] PHASE 6: Validation hardening — normalizeChannel/normalizeCategory/normalizeTrade applied at all router boundaries; Zod schemas constrained to canonical enum values
- [x] PHASE 7: Geographic layer compatibility — verified: zero normalization imports in geo-engine.ts, geo-db.ts, geo-router.ts. Zone names (Barrier Island Premium, Charleston Coastal, etc.) remain untouched by normalization layer
- [x] PHASE 8: Written 45 normalization tests (Taxonomy 6, Channel 5, FinishLevel 4, Trade 5, Category 5, ServiceType 4, PbCategory 4, Condition 3, Idempotency 1, Batch 3, Geo Isolation 2, Scope Builder 3) + fixed buildLookup alias key normalization bug
- [x] All 607 tests passing (45 new + 562 existing), zero regressions across 14 test files. Fixed 3 legacy tests referencing 'residential' → 'direct'
- [x] Sprint 11.6 checkpoint and report delivery

## Sprint 12 — Scope Builder Engine

- [x] PHASE 1: Create scope_rules table (15 columns, 8 indexes, ScopeRuleCondition JSON type)
- [x] PHASE 1: Create scope_drafts table (10 columns, 3 indexes, status enum [draft,reviewed,approved,converted])
- [x] PHASE 1: Create scope_draft_items table (9 columns, 3 indexes)
- [x] PHASE 1: Run db:push migration — 3 new tables live (scope_rules, scope_drafts, scope_draft_items)
- [x] PHASE 2: Create scope-db.ts — 18 DB helpers (createScopeRule, getById, getByCode, list, loadActiveRulesForEngine, update, deactivate, reactivate, getStats, createScopeDraft, getScopeDraftById, listScopeDraftsForProject, updateScopeDraftStatus, addScopeDraftItems, getScopeDraftItems, removeScopeDraftItem, clearScopeDraftItems, getScopeDraftWithItems, seedScopeRules)
- [x] PHASE 3: Created scope-engine.ts — 12 exported functions (matchRule, matchRules, evaluateConditions, parseArea, buildFormulaContext, evaluateQuantityFormula, safeEvaluateArithmetic, generateGeoWarnings, generateScopeDraft, convertScopeToBundle, validateIntakeForScope), 7 exported types, 6 constants. Zero pricing logic.
- [x] PHASE 4: Created scope-rules-seed.ts — 65 scope rules across 9 trade groups (Kitchen 12, Bathroom 8, Roofing 8, Siding 5, Windows/Doors 7, Deck 6, Paint 5, Flooring 6, Exterior 5) + 4 coastal hardening rules with zone-specific overrides
- [x] PHASE 5: Created scope-router.ts — 18 tRPC procedures (listRules, getRuleById, getRuleByCode, createRule, updateRule, deactivateRule, reactivateRule, ruleStats, seedRules, generate, preview, getDraft, listDrafts, updateDraftStatus, removeDraftItem, regenerate, convertToBundle, validateIntake). Integrated into appRouter.
- [x] PHASE 6: Written 200 comprehensive vitest tests across 2 test files — scope-engine pure functions (138 tests: parseArea, buildFormulaContext, evaluateQuantityFormula, safeEvaluateArithmetic, matchRule, matchRules, evaluateConditions, generateGeoWarnings, validateIntakeForScope, generateScopeDraft, convertScopeToBundle, confidence scoring, constants, seed data integrity, edge cases) + scope DB/router/architecture (62 tests: schema validation, DB helper exports, router structure, seed DB compatibility, cross-module architecture, trade coverage)
- [x] PHASE 7: All 807 tests passing (200 new + 607 existing), zero regressions across 16 test files
- [x] PHASE 8: Create checkpoint and deliver Sprint 12 report

## Sprint 12.5 — Scope Builder Domain Alignment Patch
- [x] PHASE 1: Rule Domain Inventory — 42/62 rules use legacy serviceType values, 8 missing normalization aliases (FUNCTIONAL BUG), channel enum includes legacy 'residential'
- [x] PHASE 2: Taxonomy Alignment — all 62 rules updated to canonical serviceType, scopeVariant added, 13 legacy aliases added to normalization.ts
- [x] PHASE 3: Enum Validation — scope_variant column added, channel enum fixed (removed 'residential'), migration 0013 applied
- [x] PHASE 4: Assembly Reference Integrity — all 53 unique assembly_id references verified present in DB (53/53 match)
- [x] PHASE 5: Audit Log Verification — 8 audit hooks confirmed (create/update/deactivate/reactivate rules, create/status_change drafts, remove/clear items). addScopeDraftItems bulk insert is covered by parent createScopeDraft audit. seedScopeRules delegates to createScopeRule (audited).
- [x] PHASE 6: Testing — 62 new domain alignment tests added, 8 legacy Sprint 12 tests updated to canonical values. All 869 tests passing (62 new + 807 updated), zero regressions across 17 test files
- [x] PHASE 7: Produce final report, checkpoint, deliver results

## Sprint 13 — Remodel Engine
- [x] PHASE 1: Database — remodel_templates upgraded with finish_level, zone, channel, required_scope_rules, optional_assemblies, workflow_steps. Service types migrated to canonical. Migration applied.
- [x] PHASE 2: Engine Module — remodel-engine.ts created (550 lines): matchTemplate, matchTemplates, mergeAssemblies, organizeIntoWorkflow, workflowToBundleSelections, generateRemodelWorkflow, previewRemodelWorkflow. 20 workflow step codes, trade-to-stage heuristics, template confidence scoring.
- [x] PHASE 3: DB Helpers — remodel-db.ts created: createRemodelTemplate, getRemodelTemplateById, listRemodelTemplates, updateRemodelTemplate, deactivateRemodelTemplate, reactivateRemodelTemplate, seedRemodelTemplates, getRemodelTemplateCountByServiceType. All mutations audit-logged.
- [x] PHASE 4: Router — remodel-router.ts created with 9 tRPC procedures: listTemplates, getTemplate, templateStats, createTemplate, updateTemplate, deactivateTemplate, reactivateTemplate, generateWorkflow, previewWorkflow. Wired into appRouter as `remodel`. RBAC: admin for CRUD, protected for generation.
- [x] PHASE 5: Seed Data — remodel-templates-seed.ts created: 18 templates across 10 service types (Kitchen 3, Bathroom 2, Roofing 2, Siding 2, Windows/Doors 2, Deck 2, Painting 3, Flooring 2, Exterior 1, Full Remodel 2). Wired into seedTemplates router procedure.
- [x] PHASE 6: Testing — 84 tests written across 14 describe blocks: constants, matchTemplate, matchTemplates, mergeAssemblies, getAvailableOptionalAssemblies, getStepOrder, organizeIntoWorkflow, buildTradeToStageMap, workflowToBundleSelections, flattenWorkflow, generateRemodelWorkflow, previewRemodelWorkflow, seed data integrity, cross-module compatibility
- [x] PHASE 7: All 953 tests passing (84 new + 869 existing), zero regressions across 18 test files

## Sprint 14 — Scope Review Workspace

- [x] PHASE 1: Database — scope_review_deltas + scope_review_snapshots tables created, scope_drafts status enum updated (draft/under_review/approved/rejected/converted), migration 0014 applied
- [x] PHASE 2: State Machine — scope-review-state-machine.ts created: validateTransition, isValidTransition, isEditableState, isTerminalState, getValidNextStates, assertTransition, assertEditable. 5 states, 4 valid transitions, 2 terminal states.
- [x] PHASE 3: DB Helpers — scope-review-db.ts created: createScopeReviewDelta, getDeltasForDraft, getDeltasForAssembly, transitionDraftStatus, getEffectiveItems, createReviewSnapshot, getSnapshotForDraft, updateSnapshotBundleId, buildSnapshotData. All mutations audit-logged.
- [x] PHASE 4: Router — scope-review-router.ts created: startReview, applyDelta, getReviewState, approveOrReject, convertToBundle. All state transitions enforced by state machine. Wired into appRouter as `scopeReview`.
- [x] PHASE 5: Profit Shield integration — convertToBundle now validates item confidence (<50%), overall confidence (<60%), and merges PROFIT_SHIELD warnings into snapshot. Returns profitShieldPassed flag and profitShieldWarnings array.
- [x] PHASE 6: UI — Review.tsx rewritten as Scope Review Workspace: draft list with status filter, project selector, detail panel with state machine actions (Start Review, Approve, Reject, Convert to Bundle), inline delta form (quantity adjust/remove), effective items table with confidence badges, warnings panel, snapshot display, Profit Shield status
- [x] PHASE 7: Testing — 103 tests written across 13 describe blocks: state machine transitions (12), validateTransition results (5), assert functions (9), getValidNextStates (5), constants (12), schema deltas (8), schema snapshots (7), SnapshotItem/SnapshotDelta interfaces (4), DB helper exports (9), router structure (7), Profit Shield thresholds (5), cross-module integration (8), edge cases (9). Fixed 1 Sprint 12 regression (status enum 4→5).
- [x] PHASE 8: All 1056 tests passing (103 new + 953 existing), zero regressions across 19 test files

## Sprint 15 — Geocoding Integration (Infrastructure)

- [x] PHASE 1: Project Domain Extension — latitude (decimal 10,7), longitude (decimal 10,7), geocode_confidence (enum: high/medium/low/failed/pending), geocode_source (varchar 32), geocoded_address (text), geocoded_at (timestamp). Migration 0015 applied.
- [x] PHASE 2: Geocoding Module — geo-geocoding.ts created: normalizeAddress, buildGeocodeInput, validateAddressForGeocoding, geocodeAddress (Google Maps proxy), reverseGeocode, classifyGeocodeQuality, isWithinServiceRadius, distanceFromOperatingCenter, geocodeProject. Pure address resolution, no zone logic.
- [x] PHASE 3: Geo-Engine Integration — geo-integration.ts created: geocodeAndDetectZone (full pipeline: address→geocode→zone→snapshot), persistGeocodeResult (DB update + audit), refreshProjectGeocode (re-geocode existing project). Bridges geo-geocoding.ts → geo-engine.ts → geo-db.ts.
- [x] PHASE 4: Project Create/Update Flow — project.create auto-geocodes on valid address, project.update re-geocodes on address change. Both non-blocking (try/catch).
- [x] PHASE 5: Failure Handling — validateAddressForGeocoding pre-check, geocoding failure non-blocking, outside radius warnings, confidence classification (high/medium/low/failed).
- [x] PHASE 6: Router/API Integration — project-router: +geocode, +validateAddress. geo-router: +geocodeAddress, +reverseGeocode, +geocodeAndDetectZone, +checkServiceRadius. All wired and TS clean.
- [x] PHASE 7: Minimal UI — Projects.tsx updated: geocode confidence badge (color-coded), zone shield badge, expanded detail shows coordinates/geocoded address/detected zone, GeocodeButton component with loading state and toast feedback
- [x] PHASE 8: Audit Logging — 4 audit events confirmed in geo-integration.ts: project.geocode_resolved (success), project.geocode_failed (failure), project.zone_assigned (first zone), project.zone_changed (zone update). All via centralized logAudit with before/after snapshots.
- [x] PHASE 9: Testing — 101 tests written across 15 describe blocks: constants (6), normalizeAddress (7), buildGeocodeInput (8), validateAddressForGeocoding (10), classifyGeocodeQuality (11), isWithinServiceRadius (7), distanceFromOperatingCenter (4), GeocodeResult interface (4), GeocodeAndZoneResult pipeline (2), schema fields (8), router structure (6), geocoding→zone integration (8), audit events (4), edge cases (9), cross-module compatibility (6)
- [x] PHASE 10: All 1157 tests passing (101 new + 1056 existing), zero regressions across 20 test files. Checkpoint saved, Sprint 15 report delivered.

## Sprint 15.5 — Scope Generation Workspace

- [x] PHASE 1: Workspace Data Model — audit complete. All required entities exist: project (project-router/db), intake (intake-router/db), scope draft (scope-router/db), geo (geo-router/integration). No new tables needed.
- [x] PHASE 2: Router Integration — wire generateScopeFromIntake endpoint; ensure listProjects, getProjectById, getIntakeByProject, getScopeDraft, startScopeReview are accessible from workspace
- [x] PHASE 3: Workspace Page — create ScopeGeneration.tsx with: (A) project selector, (B) project context panel, (C) intake summary panel, (D) generate scope action, (E) scope draft preview, (F) send to review action
- [x] PHASE 4: UX Rules — display generation blockers (missing intake, missing service_type, missing area, geocode missing, existing draft); typed errors, no crash, no invalid state persistence
- [x] PHASE 5: Geographic Context Visibility — display zone, geocode_confidence, service radius warning; no zone editing from this workspace
- [x] PHASE 6: Review Handoff (Idempotent) — Send to Review transitions draft→under_review; idempotent for already-in-review/approved/converted states with informational message
- [x] PHASE 7: Error States — handle missing intake, incomplete intake, geocode unavailable, scope with warnings, existing draft present; show most recent draft if multiple exist
- [x] PHASE 8: Audit Logging — scope_generation_requested, scope_generation_completed, scope_sent_to_review via centralized audit helper
- [x] PHASE 9: Testing — 64 tests written across 10 describe blocks: Blockers (5), Warnings (9), State Machine (10), Idempotent Responses (5), Intake Validation (6), Router Structure (6), Geographic Context (6), Edge Cases (5), State Machine Completeness (7), Cross-Module Compatibility (5)
- [x] PHASE 10: All 1221 tests passing (64 new + 1157 existing), zero regressions across 21 test files. Checkpoint saved, Sprint 15.5 report delivered.

## Housekeeping — Sprint Renumbering
- [x] Rename "Sprint 16" to "Sprint 15.5" in todo.md header
- [x] Rename "Sprint 16" to "Sprint 15.5" in test file comments
- [x] Rename test file from sprint16-* to sprint15.5-*
- [x] Rename "Sprint 16" to "Sprint 15.5" in router comments
- [x] Rename "Sprint 16" to "Sprint 15.5" in page component comments
- [x] Verify all tests pass after rename — 1221/1221 passing, 21 files, zero regressions
- [x] Save checkpoint

## Sprint 16 — Geographic / Coastal Override Resolver

- [x] PHASE 1: Override Rule Model — geographic_overrides table (11 columns, 6 indexes)
- [x] PHASE 1: Override Log Model — scope_override_log table (8 columns, 4 indexes)
- [x] PHASE 1: Run db:push migration 0016 applied — both tables live
- [x] PHASE 2: Engine Module — geo-override-engine.ts: read reviewed scope draft items + project zone + applicable overrides → produce resolved scope (original_assemblies, resolved_assemblies, override_reason, override_type). Idempotency via scope_override_log check.
- [x] PHASE 3: DB Helpers — geo-override-db.ts: CRUD for geographic_overrides, log queries for scope_override_log, resolver execution helpers
- [x] PHASE 3: Router — geo-override-router.ts: CRUD procedures, resolveOverrides procedure, getOverrideLog procedure. Wired into appRouter.
- [x] PHASE 4: Remodel Engine Integration — wire resolver before remodel workflow generation (reviewed scope → resolver → remodel engine receives only resolved list)
- [x] PHASE 5: UI Visibility — extend Review page: show original vs overridden assemblies, override type, reason, triggering zone. Explicit "No geographic overrides applied" when resolver finds no matches.
- [x] PHASE 6: Seed Data — coastal override rules for Charleston zones (Barrier Island Premium, Charleston Coastal) with realistic swap/add/warning rules
- [x] PHASE 7: Testing — 93 tests written across 15 describe blocks: Zone Classification (11), Rule Matching (9), Swap Override Logic (5), Addition Override Logic (4), Warning-Only Logic (3), Idempotency (4), Inland/Metro Passthrough (5), Reason Template Rendering (6), Rule Validation (7), Resolver Output Validation (4), Seed Data Integrity (10), Router Structure (8), Schema Fields (6), Edge Cases (6), Cross-Module Compatibility (5)
- [x] PHASE 8: All 1314 tests passing (93 new + 1221 existing), zero regressions across 22 test files. Checkpoint saved, Sprint 16 report delivered.

## Sprint 17 — Remodel Workflow Visualization

- [x] PHASE 1: Workflow Data Model — audit complete. assembly_id ✅ (WorkflowAssemblyRef.assemblyId), stage_order ✅ (WorkflowStage.order), override fields available via getOverrideLog cross-reference. No engine modification needed.
- [x] PHASE 2: Router Integration — workflowVisualizationRouter with loadVisualization (aggregates scope draft, project, override log, remodel workflow, enriched stages) and listDraftsForProject. Wired as workflowViz in appRouter.
- [x] PHASE 3: UI Component — RemodelWorkflowTimeline: vertical stage stack with stage cards, assembly rows, quantity/unit, override badges (swap/add/warning_only), expandable stages
- [x] PHASE 4: Override Visibility — AssemblyRow shows override badge, original→replacement IDs, reason text, zone badge. OverrideSummary panel with swap/add/warning counts.
- [x] PHASE 5: Warnings Panel — WarningsPanel component shows all warnings above timeline with expandable list (3 shown by default, "Show all" toggle)
- [x] PHASE 6: Page + Sidebar — WorkflowPage at /workflow, GitBranch icon in sidebar between Calculator and Review. Project + Scope Draft selectors.
- [x] PHASE 7: Performance — WorkflowSkeleton loader during data fetch, single aggregated query (loadVisualization), expandable stages for large workflows
- [x] PHASE 8: Testing — 55 tests written across 13 describe blocks: Constants (8), WorkflowStage (3), WorkflowAssemblyRef (5), Visualization Types (3), WorkflowVisualizationData (3), Stage Ordering (3), Assembly Grouping (2), Override Visibility (4), Warning Aggregation (4), Router Structure (6), Template Matching (4), Edge Cases (5), Cross-Module Compatibility (5)
- [x] PHASE 9: All 1369 tests passing (55 new + 1314 existing), zero regressions across 23 test files. Checkpoint saved, Sprint 17 report delivered.

## Sprint 18 — Pricing Integrity Hardening (Audit Resolution)

- [x] PHASE 1: Removed hardcoded multipliers from assembly-router.ts (calculateCost + calculateBatch) — replaced with resolvePricingDimensions + toPricingEngineDimensions
- [x] PHASE 1: Removed hardcoded multipliers from estimate-router.ts (createFromCalculator) — replaced with resolvePricingDimensions + toPricingEngineDimensions
- [x] PHASE 2: Created pricing-dimensions.ts — centralized resolver using getChannelMultiplier, getFinishLevel, getRegionalModifier from pricing-db.ts. toPricingEngineDimensions maps resolved values to engine field names.
- [x] PHASE 3: Verified — all cost/price calculations flow through assembly-engine (calculateAssemblyCost/calculateMultipleAssemblies). Routers only do DB→engine type mapping (parseFloat on Drizzle decimals) and display formatting (.toFixed for warnings). Zero violations.
- [x] PHASE 4: Enforce normalization at estimate-router.ts boundary (channel, finishLevel)
- [x] PHASE 4: Enforce normalization at pricing-router.ts boundary (trade, serviceType)
- [x] PHASE 4: Enforce normalization at scope-router.ts boundary (serviceType, finishLevel, condition, channel, projectType)
- [x] PHASE 4: Enforce normalization at remodel-router.ts boundary (serviceType, finishLevel, channel)
- [x] PHASE 4: Enforce normalization at geo-override-router.ts boundary (trade, finishLevel)
- [x] PHASE 5: Implemented scope-to-estimate-pipeline.ts (10-step orchestrator) + createFromScopeDraft procedure in estimate-router.ts. Idempotent: returns existing draft if one already exists for this scope draft.
- [x] PHASE 6: ContextSnapshot type captures scopeDraftId, channel/finish/region with source tracking (override/project/default), zone, assemblyIds, pricingDimensionsSources, generatedAt. Stored in estimate_drafts.metadata.contextSnapshot.
- [x] PHASE 7: Audit events implemented — pricing_multiplier_lookup (pricing-dimensions.ts:154), scope_to_estimate.convert (pipeline.ts:375). Both non-blocking.
- [x] PHASE 8: Legacy compatibility verified — source enum extended (not replaced) in schema, estimate-db.ts, estimate-router.ts list filter. Existing drafts unaffected.
- [x] PHASE 9: Write 105 comprehensive vitest tests across 18 describe blocks: PricingDimensionInput (3), ResolvedPricingDimensions (3), DimensionSources (2), toPricingEngineDimensions (7), channelCostMultiplier Bug Fix (6), Assembly Engine Integration (4), Scope-to-Estimate Pipeline Types (4), Pipeline Source Validation (10), Estimate Router Integration (6), Assembly Router Integration (4), Normalization at Router Boundaries (8), Normalization Idempotency (8), Normalization Alias Coverage (11), Normalization Edge Cases (6), normalizeRecord Batch Normalizer (5), Cross-Module Compatibility (4), Pricing Dimensions Resolver Source (10), Schema Validation (4). CRITICAL BUG FIXED: channelMultiplier→channelCostMultiplier field name mismatch in toPricingEngineDimensions.
- [x] PHASE 10: All 1474 tests passing (105 new + 1369 existing), zero regressions across 24 test files. Checkpoint saved, Sprint 18 report delivered.

## Sprint 18.5 — Normalization Enforcement & Estimate Versioning

- [x] PHASE 1a: Enforce normalization at assembly-router.ts boundary (calculateCost/calculateBatch: channel, finishLevel)
- [x] PHASE 1b: Enforce normalization at pricing-router.ts boundary (create/update: trade, category, finishLevel, channel; resolveDimensions: finishLevel, channel)
- [x] PHASE 1c: Enforce normalization at client-router.ts boundary (create/update/list: channel)
- [x] PHASE 1d: Enforce normalization at scope-generation-router.ts boundary (passthrough fields from intake: serviceType, finishLevel, condition, channel)
- [x] PHASE 1e: Enforce normalization at estimate-router.ts boundary (createFromScopeDraft: channelOverride, finishLevelOverride)
- [x] PHASE 2a: Add pricing_schema_version column to estimate_drafts schema (VARCHAR(10) DEFAULT '1.0')
- [x] PHASE 2b: Run db:push migration (0018_fine_lake.sql applied)
- [x] PHASE 2c: Backfill historical records with pricing_schema_version = 'pre_fix'
- [x] PHASE 2d: Write pricing_schema_version = '1.0' on all new estimate creation paths (estimate-db.ts + scope-to-estimate-pipeline.ts)
- [x] PHASE 2e: Include pricing_schema_version in EstimateDraft type (auto-inferred from schema) and audit logs
- [x] PHASE 3a: Implement router_normalization_applied audit event (assembly-router.ts calculateCost)
- [x] PHASE 3b: Implement estimate_version_assigned audit event (pricingSchemaVersion in estimate-db.ts + scope-to-estimate-pipeline.ts audit logs)
- [x] PHASE 4: Create project_actuals table (23 columns, 6 indexes, migration 0019_spotty_steve_rogers.sql applied)
- [x] PHASE 5: Write 87 tests across 16 describe blocks (GROUP A: Router Boundary Normalization 5 suites/35 tests, GROUP B: Estimate Versioning 4 suites/15 tests, GROUP C: Audit Logging 2 suites/8 tests, GROUP D: project_actuals Table 2 suites/12 tests, GROUP E: Cross-Module Integration 3 suites/10 tests, GROUP F: Edge Cases 1 suite/7 tests). Also updated Sprint 11.5 test for logAudit compatibility. All 1561 tests passing.

## Sprint 19 — Scope-to-Estimate Pipeline Finalization
- [ ] PHASE 1: Verify pipeline module deterministic steps (load → validate → extract → calculate → persist)
- [x] PHASE 2a: Add scopeDraftId column to estimate_drafts schema with unique constraint (migration 0020_clammy_warpath.sql)
- [x] PHASE 2b: Migrate DB and refactor findExistingEstimateForScope to O(1) column lookup + backfill historical records
- [x] PHASE 3a: Add multipliersApplied to ContextSnapshot (7 actual resolved multiplier values from ResolvedPricingDimensions)
- [x] PHASE 3b: Added pricingSchemaVersion to ContextSnapshot type and both buildContextSnapshot call sites
- [x] PHASE 4a: Add stage, overrideFlag, sortOrder to EstimateDraftAssemblySelection type + pipeline enrichment
- [x] PHASE 4b: Enforce deterministic bundle ordering via tradeSequenceOrder * 100 + insertionOrder, sorted after enrichment
- [x] PHASE 5a: Add estimate_created_from_scope audit event (with multipliersApplied + bundleConsistency)
- [x] PHASE 5b: Add estimate_pipeline_executed audit event (full contextSnapshot + 13 pipeline steps)
- [x] PHASE 5c: Add estimate_pipeline_idempotent_return audit event (on idempotent return path)
- [x] PHASE 6a: Add PipelineError class with 7 typed error codes (SCOPE_DRAFT_NOT_FOUND, SCOPE_DRAFT_INVALID_STATUS, NO_EFFECTIVE_ITEMS, ASSEMBLIES_NOT_FOUND, NO_ACTIVE_ASSEMBLIES, ESTIMATE_VALIDATION_FAILED, PERSIST_FAILED)
- [x] PHASE 6b: PipelineError→TRPCError mapping in estimate-router.ts createFromScopeDraft with typed code map for transport
- [x] PHASE 7: Write 71 tests across 16 describe blocks (GROUP A: PipelineError class 6 + usage 6, GROUP B: schema 4 + idempotency 6, GROUP C: interface 3 + source 7, GROUP D: schema 4 + enrichment 8, GROUP E: audit 8, GROUP F: error mapping 8, GROUP G: project_actuals 6, GROUP H: E2E trace 5). All 1632 tests passing across 26 test files.

## Sprint 20 — Field Launch Toolkit (Operational Tooling for Internal Deployment)

- [x] PHASE 1a: Install jsPDF for server-side PDF generation
- [x] PHASE 1b: Create estimate-export.ts module (generatePdfExport, generateJsonExport, generatePrintableExport)
- [x] PHASE 1c: Add export tRPC procedures (exportPdf→S3, exportJson→S3, exportPrintable→inline HTML) with audit logging
- [x] PHASE 2a: Create EstimateDetail page (read-only) with route /estimates/:id
- [x] PHASE 2b: Show estimate metadata, scope source, assemblies, workflow stages, multipliers, overrides, warnings
- [x] PHASE 3a: Create Pricing Provenance Panel (zone, channel, finish_level, multipliers_applied, pricing_schema_version, source) — extracted MultipliersGrid component
- [x] PHASE 3b: Embed provenance panel in estimate detail page + export buttons (PDF/JSON/Print)
- [x] PHASE 4a: Create system_issue_reports + pipeline_partial_drafts tables (migration 0021)
- [x] PHASE 4b: Create issue-report-router.ts (create, list, getById, updateStatus, stats) wired into appRouter
- [x] PHASE 4c: Add Report Issue button + Dialog to EstimateDetail (category, severity, title, description, auto-populated metadata)
- [x] PHASE 5: Add operational logging events — estimate_generated (createFromCalculator), estimate_viewed (getById), estimate.export_pdf/json/printable (3 export procedures), issue_reported (create issue) — all non-blocking with .catch(() => {})
- [x] PHASE 6a: Add Quick Actions to estimate-router (approveEstimate, rejectEstimate with reason) + audit events
- [x] PHASE 6b: Add Quick Action buttons to EstimateDetail page (Approve, Reject, Archive with confirmation dialogs)
- [x] PHASE 6c: Add draft recovery DB helpers (createPartialDraft, listPartialDrafts, retryPartialDraft, abandonPartialDraft)
- [x] PHASE 6d: Hook draft recovery into pipeline catch block (auto-save partial on PERSIST_FAILED)
- [x] PHASE 7: Write 40+ tests covering export, detail, issue reporting, quick actions, draft recovery, audit logs (77 tests in sprint20-field-launch.test.ts)

## Sprint 20.1 — JobTread CSV Compliance Hardening
- [x] PHASE 1: CSV header contract (exact column order: Cost Group Name, Cost Item Name, Description, Quantity, Unit, Unit Cost, Unit Price, Cost Type, Taxable)
- [x] PHASE 2: Load JobTread master catalogs (cost-codes.csv, cost-types.csv, units.csv) as validation sources
- [x] PHASE 3: Cost Type validation — block export if cost type not in allowed list
- [x] PHASE 4: Unit normalization — map internal units to JobTread canonical units, block if no mapping
- [x] PHASE 5: Cost Code validation — validate each row against cost-codes.csv, block if unrecognized
- [x] PHASE 6: Strict validation report (valid rows, invalid rows, error list) — block CSV download on failure
- [x] PHASE 6b: Wire CSV export into estimate-router + UI validation feedback in EstimateDetail
- [x] PHASE 7: Write 40+ tests covering header ordering, cost type, unit normalization, cost code, export blocking (77 tests in sprint20-1-jobtread-csv.test.ts)

## Sprint 21 — Field Launch Control
- [x] PHASE 1a: Add field_launch_mode feature flag to system_settings table
- [x] PHASE 1b: Create feature flag DB helpers + tRPC procedures (get/set)
- [x] PHASE 2a: Create monitoring dashboard DB helpers (aggregate estimate stats, pipeline errors, override frequency, CSV validation failures)
- [x] PHASE 2b: Create monitoring dashboard tRPC router
- [x] PHASE 2c: Build Monitoring Dashboard UI page
- [x] PHASE 3a: Create field_feedback_reports table schema
- [x] PHASE 3b: Create field feedback DB helpers + tRPC router
- [x] PHASE 3c: Build Field Feedback UI (submit button + form)
- [x] PHASE 4a: Create project_actuals table schema (enhanced existing table with isHighVariance + varianceAmount)
- [x] PHASE 4b: Create project actuals DB helpers + tRPC router
- [x] PHASE 4c: Build Project Actuals UI (manual input form + live variance preview)
- [x] PHASE 5: Variance detection logic (>20% threshold → high_variance_project flag + alert in dashboard)
- [x] PHASE 6: Add audit events (field_feedback_submitted, actuals_recorded, high_variance_detected, field_launch_mode_enabled)
- [x] PHASE 7: Write 40+ tests covering feedback, actuals, variance, monitoring, feature flag (69 tests in sprint21-field-launch-control.test.ts)

## Sprint 22 — Learning Layer Foundation

- [x] PHASE 1: Extend project_actuals ingestion pipeline (assembly_id, estimated_qty, actual_qty, estimated_cost, actual_cost, project_id, timestamp)
- [x] PHASE 2: Create estimate_variance_events table (project_id, estimate_id, assembly_id, estimated_cost, actual_cost, variance_pct, variance_type, timestamp)
- [x] PHASE 3: Create assembly_performance_metrics table (assembly_id, project_count, avg_estimated_qty, avg_actual_qty, avg_estimated_cost, avg_actual_cost, avg_variance_pct, last_updated)
- [x] PHASE 4: Create calibration_suggestions table (assembly_id, suggested_waste_factor, suggested_labor_multiplier, suggested_material_multiplier, confidence_score, generated_at, status)
- [x] PHASE 5a: Build Learning Layer DB helpers (variance events CRUD, assembly metrics aggregation, calibration suggestion generation)
- [x] PHASE 5b: Build Learning Layer tRPC router (18 procedures wired into appRouter)
- [x] PHASE 6: Build Learning Dashboard UI (highest variance, consistent overruns, consistent underruns, calibration review)
- [x] PHASE 7: Write 40+ tests covering variance calculations, aggregation, suggestion generation, dashboard queries, data integrity (77 tests in sprint22-learning-layer.test.ts)

## Bug Fix — Intake Not Saving
- [x] BUG: Intake form not saving records to database — root cause: Intake UI sent channel="residential" but Zod schema only accepts "direct"|"insurance"|"commercial". Fixed CHANNELS array and emptyForm default.

## Documentation
- [x] Create simple user manual for the structr.ai structr.ai system (21 sections, PDF delivered)

## Bug Fix — Workflow Templates Not Loading
- [x] BUG: Workflow Visualization page shows "Failed to load workflow" — root cause: DB missing 6 columns (finish_level, zone, channel, required_scope_rules, workflow_steps, optional_assemblies) + old service_type enum values. Fixed via ALTER TABLE + re-seed.
- [x] Verify remodel_templates table exists and has correct columns (added 6 missing columns via ALTER TABLE)
- [x] Seed 19 templates: kitchen_remodel(3), bathroom_remodel(2), roofing(2), siding(2), windows_doors(2), deck_porch(2), painting(3), flooring(2), exterior(1) — all is_active=true
- [x] Ensure is_active = true for all required templates (verified via SQL query)
- [x] Confirm server running clean, all 1,944 tests passing

## Rebranding — structr.ai → structr.ai
- [x] Inventory all files with structr.ai/structr.ai/structr.ai references (80+ files, 4 brand terms)
- [x] Update backend files (routers, DB helpers, tests, shared)
- [x] Update frontend files (pages, components, layout, CSS)
- [x] Update project config (package.json, env, Vite title/logo)
- [x] Update documentation files (todo.md, manual, roadmap, blueprint)
- [x] GitHub repository — no external GitHub repo exists yet (project uses Manus internal S3 git). Can export to GitHub as 'structr-ai' via Settings > GitHub when ready.
- [x] Run full test suite and save checkpoint — all 1,944 tests passing, 30/30 test files green

## Domain Update — structr-ai.manus.space
- [x] Check for hardcoded domain references — no hardcoded URLs found, HTML title already 'structr.ai', all UI branding correct
- [x] Create fresh checkpoint for publishing

## Bug Fix — Publish Error (insertBefore DOM crash)
- [x] Investigate NotFoundError: Failed to execute 'insertBefore' on 'Node' during publish — root cause: 1.4MB monolithic bundle causing preview panel DOM crash
- [x] Implement code splitting with React.lazy() for all 17 pages + Suspense fallback
- [x] Configure Vite rollupOptions manualChunks: vendor (react/react-dom), ui-primitives (all @radix-ui), icons (lucide-react), trpc (@trpc + react-query + superjson), framework (wouter + sonner + cva + clsx + tailwind-merge)
- [x] Result: index chunk reduced from 512KB → 72.7KB (86% reduction), gzipped from 145KB → 13.5KB (91% reduction)
- [x] All 1,944 tests passing, build successful, dev server healthy
- [ ] Save checkpoint and publish
- [ ] Export to GitHub as private repository 'structr-ai'
