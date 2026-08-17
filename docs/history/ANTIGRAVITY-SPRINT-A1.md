# Sprint A1 — Analytics Engine + Operational Dashboard

---

## CONTEXT

Sprint 26 wired Lead → Deal → Project into a single pipeline with real DB data and a funnel page (`PipelineOverview.tsx`). What is missing is the **operational analytics layer** that aggregates the data already captured by the pipeline into KPIs the GC owner needs to make weekly decisions: which lead sources convert, which job types win, how long the estimate cycle takes, how estimated margin compares to actuals, and how much weighted revenue is in the funnel.

All the source data already exists. Every aggregation in this sprint is derivable from current tables — `leads`, `deals`, `deal_stage_history`, `projects`, `estimates`, `estimate_items`. No new business tables are introduced; this sprint is a read-only analytical projection over the existing pipeline.

This sprint sits between Sprint 26 (Pipeline Integration) and Sprint 27 (Schedule Engine, Phase B). It unblocks the dashboard module proposed for the GC owner without violating the "no mock data" rule from `AGENTS.md`.

**Predecessor sprints:** 24 (Lead Engine), 25 (Deal Engine), 26 (Pipeline Orchestration)
**Dependent tables (read-only):** `leads`, `lead_activities`, `deals`, `deal_activities`, `deal_stage_history`, `projects`, `estimates`, `estimate_items`, `clients`
**Dependent engines:** `shared/lead-engine.ts`, `shared/deal-engine.ts` (`forecastRevenue`, `calculateWeightedPipeline`)
**Dependent helpers:** `server/pipeline-db.ts` (`getPipelineOverview`), `server/deal-db.ts` (`getPipelineForecast`, `getDealStats`), `server/lead-db.ts` (`getLeadStats`)

---

## GOAL

Deliver an Analytics Engine (pure functions), a DB aggregator over existing pipeline tables, a tRPC router, and an `/analytics` page that renders five KPI groups using Recharts: (1) pipeline funnel with `$` value per stage, (2) win rate breakdown by job type / ticket size / lead source, (3) estimate cycle time (days from lead-created to deal-won and from estimate-created to deal-closed), (4) lead source ROI (count, won-value, conversion %), (5) profitability tracker (estimated vs. actual margin per active project, with variance flag). Extend `PipelineOverview` to include `$` value per stage.

All data live from Supabase. Zero mock fixtures in production code.

**Deliverables:**
1. `shared/analytics-engine.ts` with 9 pure functions (≥30 engine tests)
2. `server/analytics-db.ts` with 7 aggregator helpers (≥20 DB tests)
3. `server/analytics-router.ts` with 7 procedures (≥15 router tests)
4. `client/src/pages/Analytics.tsx` with 5 KPI sections, Recharts, responsive layout
5. Extend `PipelineOverview.tsx` funnel to include `$` value per stage
6. Canonical `leadSource` enum in `shared/domain/taxonomy.ts` + normalization helper
7. ≥65 new tests, 0 regressions

---

## FILES

### Files to CREATE:

| File | Purpose | Test Count |
|------|---------|------------|
| `shared/analytics-engine.ts` | Pure aggregation + bucket functions: funnel value, win rate by dimension, cycle time, source ROI, margin variance | ≥30 |
| `server/analytics-db.ts` | Read-only DB helpers that pull from leads/deals/projects and feed engine functions | ≥20 |
| `server/analytics-router.ts` | tRPC procedures, all `protectedProcedure`, all queries (no mutations in this sprint) | ≥15 |
| `client/src/pages/Analytics.tsx` | 5-section KPI dashboard with Recharts | — |
| `server/sprint-a1-analytics-engine.test.ts` | Engine tests | — |
| `server/sprint-a1-analytics-db.test.ts` | DB tests | — |
| `server/sprint-a1-analytics-router.test.ts` | Router tests | — |

### Files to MODIFY:

| File | Change |
|------|--------|
| `shared/domain/taxonomy.ts` | Add `LEAD_SOURCES` enum: `google`, `referral`, `houzz`, `repeat_client`, `insurance`, `web`, `other`. Add `JOB_TYPES` enum: `new_construction`, `remodel`, `addition`, `repair`. Add `TICKET_BUCKETS`: `under_25k`, `25k_75k`, `75k_200k`, `over_200k`. Add `normalizeLeadSource()` helper. |
| `shared/domain/normalization.ts` | Add `normalizeLeadSource(input)` that maps free-text values to canonical enum, falls back to `other` |
| `server/routers.ts` | Mount `analyticsRouter` |
| `client/src/App.tsx` | Add lazy-loaded `/analytics` route |
| `client/src/components/DashboardLayout.tsx` | Add sidebar nav: "Analytics" with `BarChart3` icon (lucide-react) |
| `client/src/pages/PipelineOverview.tsx` | Extend funnel rows to include `$` value per stage from new `analytics.funnelByValue` query |
| `scripts/backfill-lead-source.mjs` | One-shot script to normalize existing `leads.source` text values to canonical enum |

### Files to READ (for context, do not modify):

| File | Why |
|------|-----|
| `AGENTS.md` | Mandatory project rules (TDD, protectedProcedure, audit, normalization at router boundary) |
| `SPRINT-TEMPLATE.md` | Sprint structure |
| `STRUCTR-COS-ROADMAP.md` | Where this sprint sits in the COS evolution |
| `shared/deal-engine.ts` | Existing `forecastRevenue`, `calculateWeightedPipeline`, `calculateWinProbability` — do not duplicate |
| `shared/lead-engine.ts` | Existing `scoreLead`, `classifyPriority` — analytics consume these outputs, do not re-derive |
| `server/pipeline-db.ts` | Existing `getPipelineOverview` (Sprint 26) — analytics complements it, does not replace |
| `server/deal-db.ts` | Existing `getPipelineForecast`, `getDealStats` — reuse where possible |
| `drizzle/schema.ts` | Source-of-truth for all timestamps and value columns the engine reads |

---

## CONSTRAINTS

1. Read `AGENTS.md` completely before writing any code.
2. Follow TDD: RED → GREEN → REFACTOR for every function.
3. Run `pnpm check` + `pnpm test` after every phase (Phase Gate).
4. **All procedures in this sprint are `protectedProcedure` queries.** No mutations. No `publicProcedure`.
5. **Zero mock data in production code.** All KPIs read from Supabase via Drizzle. Test fixtures live only in `sprint-a1-*.test.ts` files.
6. **No new business tables.** This sprint is read-only analytics over existing pipeline tables. The only schema-touching change is non-destructive: adding a CHECK or normalizing existing free-text `leads.source` values via backfill script.
7. **No duplication of existing engine logic.** If `deal-engine.forecastRevenue` covers a metric, the analytics layer wraps it, not reimplements it.
8. **Engine functions are pure.** Zero database imports. They receive arrays of records as parameters and return aggregated results.
9. **Normalize at the router boundary.** All `source`, `jobType`, `bucket` enum inputs go through normalization helpers before reaching the engine.
10. **Audit not required** (no mutations in this sprint), but if the backfill script writes to `leads.source`, it must call `logAudit` with action `lead.source.normalized`.
11. Charts use Recharts (already in `package.json`). No new chart library.

---

## OUTPUT — Phase-by-Phase Execution

### Phase 1: Taxonomy + Normalization

**Tasks:**
- 1.1: Add `LEAD_SOURCES`, `JOB_TYPES`, `TICKET_BUCKETS` enums to `shared/domain/taxonomy.ts`
- 1.2: Add `normalizeLeadSource(raw: string | null): LeadSource` in `shared/domain/normalization.ts` — case-insensitive, trims, maps common aliases (`gmb` → `google`, `word_of_mouth` → `referral`, `previous_customer` → `repeat_client`, etc.)
- 1.3: Add `bucketTicketSize(value: number | null): TicketBucket` — pure function, one of 4 buckets
- 1.4: Add unit tests in `shared/domain/normalization.test.ts` (extend existing file): ≥10 cases for `normalizeLeadSource`, ≥6 for `bucketTicketSize`
- 1.5: Write `scripts/backfill-lead-source.mjs` — reads all `leads`, applies `normalizeLeadSource`, updates rows where current value differs, calls `logAudit` per row, prints summary
- 1.6: Run backfill on dev DB, capture before/after counts

**Phase Gate:** `pnpm check` → 0 errors, `pnpm test` → 0 regressions, normalization tests ≥ 16 passing

---

### Phase 2: Engine Logic (TDD — Pure Functions)

**File:** `shared/analytics-engine.ts`
**Test file:** `server/sprint-a1-analytics-engine.test.ts`

```
funnelByValue(leads, deals, projects) → { stage, count, totalValue, weightedValue }[]
  - Stages: lead, qualified, deal_active, proposal_sent, won, lost
  - totalValue: sum of estimatedBudget (lead) or value (deal) per stage
  - weightedValue: totalValue * stageWinProbability (reuse deal-engine.calculateWinProbability)
  - Edge: empty arrays → all stages with 0/0/0
  - Edge: deal with null value → contributes 0 to totalValue, not NaN
  - Boundary: lead with negative budget → ignored (clamped to 0)

winRateByJobType(deals) → { jobType, total, won, lost, winRate }[]
  - winRate = won / (won + lost), 0 if denominator 0
  - Includes only closed deals (won/lost), excludes in-flight
  - Edge: deal with unrecognized jobType → bucketed as "other"

winRateByTicketBucket(deals) → { bucket, total, won, winRate, avgValue }[]
  - Buckets via bucketTicketSize on deal.value
  - Edge: deal with null value → "under_25k" bucket

winRateByLeadSource(leads, deals) → { source, leadsCount, dealsCount, wonCount, conversionRate, totalWonValue }[]
  - Joins leads → deals via deals.leadId
  - conversionRate = wonCount / leadsCount
  - Edge: deal without leadId → excluded
  - Edge: lead.source null → normalized to "other"

estimateCycleTime(deals, projects) → { p50, p75, p90, mean, sampleSize }
  - Days from project.createdAt to deal.actualCloseDate (won deals only)
  - Excludes deals without actualCloseDate
  - Edge: sampleSize < 3 → returns nulls with sampleSize for UI to show "insufficient data"

leadToWonCycleTime(leads, deals) → { p50, p75, p90, mean, sampleSize }
  - Days from leads.createdAt to deals.actualCloseDate (won)
  - Same insufficient-data behavior

leadSourceROI(leads, deals) → { source, leadsCount, costAssumption, wonValue, roi }[]
  - costAssumption: parameter passed by router (per-source acquisition cost map)
  - roi = (wonValue - cost) / cost
  - Edge: cost 0 → roi null (not Infinity)
  - This sprint accepts cost map as input; storing per-source costs is out of scope

marginVarianceByProject(projects, estimateItems) → { projectId, name, status, estimatedMargin, actualMargin, variancePct, flag }[]
  - estimatedMargin: project.estimatedTotal vs sum(estimateItems.unitCost * quantity)
  - actualMargin: project.actualTotal vs sum(estimateItems.actualCost * actualQty)
  - variancePct = (actualMargin - estimatedMargin) / estimatedMargin
  - flag: "ok" if |variancePct| ≤ 0.05, "warning" if ≤ 0.15, "danger" if > 0.15
  - Includes only active projects (not completed/cancelled)
  - Edge: missing actuals → flag "no_actuals", variancePct null

revenueForecastSeries(deals, periodDays) → { date, weightedRevenue, signedBacklog }[]
  - One point per week for the next periodDays
  - signedBacklog: deals with stage="won" and projects.status in (approved, in_progress) where projected close date in week
  - weightedRevenue: in-flight deals' value * stageProbability bucketed by deal.closureDate
  - Reuses deal-engine.forecastRevenue internals — wraps, does not re-implement
  - Edge: periodDays ≤ 0 → throws Error("periodDays must be positive")
```

**Test count target:** ≥30. Cover happy path, edges, boundaries for every function. No existence-only tests.

**Phase Gate:** `pnpm check` → 0 errors, `pnpm test` → all passing, engine tests ≥ 30

---

### Phase 3: DB Helpers (TDD)

**File:** `server/analytics-db.ts`
**Test file:** `server/sprint-a1-analytics-db.test.ts`

All helpers are read-only. No mutations, no `logAudit`. Each helper fetches the minimum rows needed and feeds the engine function.

```
getFunnelByValue() → ReturnType<funnelByValue>
  - Fetches: leads (status, leadScore, estimatedBudget), deals (stage, value), projects (status, estimatedTotal)
  - Test: seeds N records, expects engine output

getWinRateByJobType(filter?: { fromDate, toDate }) → ReturnType<winRateByJobType>
  - Fetches: deals where stage in (won, lost), optionally bounded by actualCloseDate
  - Test: respects filter, excludes in-flight

getWinRateByTicketBucket(filter?) → ReturnType<winRateByTicketBucket>
  - Fetches: deals (closed), groups by value bucket

getWinRateByLeadSource(filter?) → ReturnType<winRateByLeadSource>
  - Joins: leads ⋈ deals on lead_id
  - Applies normalizeLeadSource at the boundary

getEstimateCycleTime(filter?) → { estimateCycle, leadCycle }
  - Two cycle metrics in one call to avoid double-fetch

getLeadSourceROI(costMap: Record<LeadSource, number>) → ReturnType<leadSourceROI>
  - Cost map passed from router; this sprint hardcodes a default in router

getMarginVariance() → ReturnType<marginVarianceByProject>
  - Fetches: active projects + their estimate_items (actualCost, actualQty)
  - One query per project for items, batched

getRevenueForecastSeries(periodDays: number) → ReturnType<revenueForecastSeries>
  - Fetches: deals in flight + won deals with closure_date in horizon
```

**DB test pattern:** seed via existing test helpers (`createTestLead`, `createTestDeal`, etc.), call helper, assert shape and values. Use real Postgres test DB (no mocks per AGENTS.md tier 1).

**Phase Gate:** `pnpm check` → 0 errors, `pnpm test` → all passing, DB tests ≥ 20

---

### Phase 4: API Router (TDD)

**File:** `server/analytics-router.ts`
**Test file:** `server/sprint-a1-analytics-router.test.ts`

All `protectedProcedure`. All queries. Inputs validated with Zod. Enum inputs normalized at boundary.

```
analytics.funnelByValue — query — protectedProcedure
  Input: none
  Calls: analyticsDb.getFunnelByValue()
  Returns: { stages: { stage, count, totalValue, weightedValue }[] }

analytics.winRateByJobType — query — protectedProcedure
  Input: z.object({ fromDate: z.string().datetime().optional(), toDate: z.string().datetime().optional() }).optional()
  Calls: analyticsDb.getWinRateByJobType(filter)
  Errors: BAD_REQUEST if fromDate > toDate

analytics.winRateByTicketBucket — query — protectedProcedure
  Input: same shape as above
  Calls: analyticsDb.getWinRateByTicketBucket(filter)

analytics.winRateByLeadSource — query — protectedProcedure
  Input: same shape as above
  Calls: analyticsDb.getWinRateByLeadSource(filter)

analytics.estimateCycleTime — query — protectedProcedure
  Input: same shape as above
  Calls: analyticsDb.getEstimateCycleTime(filter)

analytics.leadSourceROI — query — protectedProcedure
  Input: z.object({ costMap: z.record(z.string(), z.number().nonnegative()).optional() }).optional()
  Calls: analyticsDb.getLeadSourceROI(costMap ?? DEFAULT_COST_MAP)
  Note: DEFAULT_COST_MAP is a constant in this router, documented inline. Real per-source costs are out of scope.

analytics.marginVariance — query — protectedProcedure
  Input: none
  Calls: analyticsDb.getMarginVariance()

analytics.revenueForecastSeries — query — protectedProcedure
  Input: z.object({ periodDays: z.number().int().min(7).max(365).default(90) }).optional()
  Calls: analyticsDb.getRevenueForecastSeries(periodDays)
  Errors: BAD_REQUEST via Zod on invalid range
```

Mount in `server/routers.ts`:
```typescript
import { analyticsRouter } from "./analytics-router";
// Add to appRouter: analytics: analyticsRouter,
```

**Phase Gate:** `pnpm check` → 0 errors, `pnpm test` → all passing, router tests ≥ 15

---

### Phase 5: Frontend

**File:** `client/src/pages/Analytics.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│ Analytics                                       [date range pick] │
│ Operational KPIs — GC Home Improvement                            │
├──────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ Pipeline Funnel — counts and $ value per stage              │   │
│ │ [stacked bars: count + $ overlay]                           │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│ ┌─────────────────┬─────────────────┬─────────────────┐          │
│ │ Win Rate by     │ Win Rate by     │ Win Rate by     │          │
│ │ Job Type        │ Ticket Size     │ Lead Source     │          │
│ │ [horizontal bar]│ [horizontal bar]│ [horizontal bar]│          │
│ └─────────────────┴─────────────────┴─────────────────┘          │
│                                                                   │
│ ┌─────────────────────────────┬─────────────────────────────┐    │
│ │ Estimate Cycle Time         │ Revenue Forecast (90d)      │    │
│ │ p50/p75/p90 + sampleSize    │ [area: weighted + backlog]  │    │
│ └─────────────────────────────┴─────────────────────────────┘    │
│                                                                   │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ Lead Source ROI — table: source, leads, won $, ROI %        │   │
│ └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ Profitability Tracker — table: project, est margin %,       │   │
│ │ actual margin %, variance %, flag (ok/warning/danger)       │   │
│ └────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

- Uses: `trpc.analytics.*` queries, all 7 endpoints
- Loading skeletons per section (independent so one slow query doesn't block all)
- Error boundaries per section (existing `ErrorBoundary` component)
- Empty states: "Insufficient data — need ≥ N records" when sampleSize < threshold
- Responsive: 1 col mobile, 2 col tablet, 3 col desktop for win-rate row
- Route: `/analytics` in `App.tsx` (lazy-loaded via `React.lazy`)
- Sidebar: "Analytics" with `BarChart3` icon, between "Pipeline" and "Settings"

**Also extend `PipelineOverview.tsx`:**
- Replace counts-only funnel with counts + `$` value per stage using `analytics.funnelByValue`
- Add weighted value badge per stage
- Keep existing dropoff % indicator

**Phase Gate:** `pnpm check` → 0 errors, `pnpm build` → success, manual smoke test on `pnpm dev` (load `/analytics`, verify all 7 sections render with real data, verify `/pipeline` shows `$` per stage)

---

### Phase 6: Release Verification

```bash
pnpm check    # 0 TypeScript errors
pnpm test     # ALL tests passing, 0 regressions
pnpm build    # production build succeeds
git diff --stat
```

**Completion Report:**
```
TypeScript:    0 errors
Tests:         [≥65] new, [Y] total, 0 failures
Files created: shared/analytics-engine.ts
               server/analytics-db.ts
               server/analytics-router.ts
               client/src/pages/Analytics.tsx
               server/sprint-a1-analytics-engine.test.ts
               server/sprint-a1-analytics-db.test.ts
               server/sprint-a1-analytics-router.test.ts
               scripts/backfill-lead-source.mjs
Files modified: shared/domain/taxonomy.ts
                shared/domain/normalization.ts
                server/routers.ts
                client/src/App.tsx
                client/src/components/DashboardLayout.tsx
                client/src/pages/PipelineOverview.tsx
New tables:    none (read-only analytical projection)
New enums:     LEAD_SOURCES, JOB_TYPES, TICKET_BUCKETS
New functions: 9 engine functions
New helpers:   7 DB helpers
New endpoints: 7 query procedures (all protectedProcedure)
Security:      All protectedProcedure? YES
Audit:         Backfill script logs audit per normalized row? YES
Mock data:     None in production code. Fixtures only in sprint-a1-*.test.ts
Regressions:   0
```

---

## OUT OF SCOPE (deferred)

- **Per-source acquisition cost storage.** This sprint accepts a `costMap` parameter or hardcoded default. A `lead_source_costs` table with a settings UI is a follow-up.
- **Crew Capacity vs. Backlog.** Belongs to Sprint 27 (Schedule Engine, Phase B).
- **HubSpot / Close / Salesforce sync.** Belongs to Phase C (Integration Hub, Sprint 30-32). JobTread CSV export already exists.
- **Saved analytics views / scheduled reports.** Future sprint if validated.
- **Forecasting beyond 90 days** with seasonality. Out of scope; current `forecastRevenue` is linear weighted.
- **Drill-down navigation** (click bar → filtered list). Phase 2 of analytics if validated.
