# H1 historical capture — validation report (2026-09-19)

Scope: first isolated historical-price capture slice on base `0bd5d831ad2115fef069e979b0cc89991b52c7f7`. This is a technical candidate, not a declaration that R3/R4 or real-use readiness is complete. Native Jim review and GitHub CI are tracked on the pull request, not asserted by this local report.

## Completion evidence

| Check | Observed result |
| --- | --- |
| TypeScript | `pnpm check --incremental false`: 0 errors |
| Full regression | `pnpm test`: 4,082 passed, 391 skipped, 0 failures; 4,473 total |
| New coverage | 258 new cases: 234 passed in the default suite; 24 physical cases run separately |
| Physical PostgreSQL | 23 constraint/concurrency/atomicity cases passed; 1 RLS metadata case passed |
| Generated schema smoke | 501 statements applied in a second disposable database; 87 tables, 157 FKs; all four historical RLS flags true, zero policies |
| Hosted build | `pnpm build:vercel`: success (existing large-chunk warnings remain) |
| Authentication | All five new business endpoints use tenantProcedure, inheriting protectedProcedure; explicit project checks and transactional rechecks |
| Audit | Both new mutations call logAudit on the same transaction; physical audit failure rolls back business writes |
| Regressions | No failed existing tests in the final complete run |
| Real data / production migration | Not performed |

Baseline default regression was 3,848 passed / 367 skipped. The 24 additional skips in the default run are explicit opt-in physical tests, not omitted failures. The separate physical run used verified socket-only PostgreSQL 17 in a private disposable cluster, not the deployed authentication/role environment. RLS metadata verifies configuration only, not enforcement against table owners or BYPASSRLS roles.

Final migration SHA256: `1741d20d6b9aca3e90e447f9fb8023337a86038ac2cd05271a5fe35f316c5015`.

## Browser rehearsal

An authenticated synthetic operator created a full two-line proposal, selected one line, saved it, and reopened the selection after reload. The original total and both original lines remained stored. Missing cost and taxability stayed unknown. A second project used raw amount text with no currency; the raw text remained visible while normalized and draft money stayed null. Switching projects cleared the form and source/import URL parameters. The legacy estimate detail exposed only the historical notice and the source/selection link, with no approval/export controls. Database reads restricted to the synthetic tenant confirmed both drafts remained unapproved and all four source/selection mutations had audit rows.

This browser rehearsal does not cover network-loss retry or production sign-in. Deterministic API/DB tests cover same-request replay and conflicts; these are distinct from a full browser network-loss simulation. Source-list pagination beyond the first 100 and selection-revision editing are API capabilities not exposed by this initial screen.

## Domain additions

Four tables: `historical_estimate_sources`, `historical_estimate_source_lines`, `historical_estimate_imports`, `historical_estimate_import_lines`.

Pure functions: parseHistoricalDecimal, decimalToMinorUnits, canonicalHistoricalJson, normalizeHistoricalSource, reconcileHistoricalSelection, buildHistoricalSelection, buildHistoricalDraftProjection, assertHistoricalCaptureOnly. Closed versioned JSON schemas accompany them.

DB helpers: recordHistoricalSource, importHistoricalEstimate, getHistoricalSource, getHistoricalImport, listHistoricalSources.

Endpoints: historicalEstimate.recordSource, historicalEstimate.getSource, historicalEstimate.getImport, historicalEstimate.listSources, estimate.importHistorical.

## Review disposition and next boundary

Independent cross-reviews closed missing RLS configuration, immutable-set late insertion, malformed reconciliation envelopes, stale project/form state, unmapped historical errors, and historical ancestry in legacy change orders. Existing generic approval-writer protection is retained. No commercial approval, proposal issuance, execution authorization, or real work-start fact is created by H1.

Remaining work includes the separate approval authorities, conversion of operational consumers to an explicit accepted/execution baseline, full legacy reconciliation, and the actual environment/principal/backup/recovery gates. The four authorities must remain separate: internal estimate approval, proposal issuance, commercial acceptance, and execution authorization. Reported external approval is provenance only.

## Files created

- `client/src/components/historical-estimates/HistoricalSourceView.tsx`
- `client/src/pages/HistoricalEstimates.tsx`
- `docs/architecture/historical-capture-h1.md`
- `drizzle/0005_historical_estimate_capture.sql`
- `server/historical-estimate-db.test.ts`
- `server/historical-estimate-db.ts`
- `server/historical-estimate-engine.test.ts`
- `server/historical-estimate-field-lineage.test.ts`
- `server/historical-estimate-guard.ts`
- `server/historical-estimate-guards.test.ts`
- `server/historical-estimate-physical.test.ts`
- `server/historical-estimate-router.test.ts`
- `server/historical-estimate-router.ts`
- `server/historical-estimate-schema-security.test.ts`
- `server/historical-estimate-ui.test.ts`
- `shared/historical-estimate-engine.ts`
- `docs/release/historical-capture-h1-validation-2026-09-19.md`

## Files modified

- `client/src/App.tsx`
- `client/src/components/DashboardLayout.tsx`
- `client/src/pages/EstimateDetail.tsx`
- `drizzle/meta/_journal.json`
- `drizzle/relations.ts`
- `drizzle/schema.ts`
- `scripts/ed-pilot-lab/app.ts`
- `server/actuals-db.ts`
- `server/actuals-router.ts`
- `server/analytics-db.ts`
- `server/db.ts`
- `server/ed-pilot-lab.test.ts`
- `server/estimate-db.ts`
- `server/estimate-document-export-authorization.test.ts`
- `server/estimate-router.ts`
- `server/estimate-status-approval-guard.test.ts`
- `server/estimate-version-db.ts`
- `server/field-operations-db.ts`
- `server/field-operations-router.ts`
- `server/jobtread-export-db.ts`
- `server/migration-history-reconcile.test.ts`
- `server/phase2-flow.test.ts`
- `server/routers.ts`
- `server/test-support/ed-pilot-lab.ts`
- `shared/domain/normalization.ts`
- `shared/domain/taxonomy.ts`
- `tsconfig.json`
