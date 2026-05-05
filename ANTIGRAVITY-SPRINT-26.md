# Sprint 26 — Lead-to-Deal-to-Project Pipeline Integration

## BEFORE ANYTHING ELSE

Read these files completely before writing any code:
1. `AGENTS.md` — ALL project rules, architecture, testing, security
2. `SPRINT-TEMPLATE.md` — exact sprint structure to follow
3. `STRUCTR-COS-ROADMAP.md` — Sprint 26 spec (section "Sprint 26 — Lead-to-Deal-to-Project Pipeline Integration")

Also read (existing code you'll integrate with):
4. `shared/lead-engine.ts` — scoreLead, classifyPriority, validateLeadForConversion, convertLeadToClient, detectDuplicateLead
5. `shared/deal-engine.ts` — calculateWeightedPipeline, calculateWinProbability, forecastRevenue, suggestNextAction, detectStaleDeal, validateStageTransition
6. `server/lead-db.ts` — createLead, getLeadById, listLeads, updateLead, updateLeadStatus, qualifyLead, disqualifyLead, convertLeadToProject, addLeadActivity, getLeadActivities, searchLeads, getLeadStats
7. `server/deal-db.ts` — createDeal, getDealById, listDeals, updateDeal, updateDealStage, markWon, markLost, linkEstimate, addDealActivity, getDealActivities, getDealStats, getStaleDeals, getPipelineForecast
8. `server/lead-router.ts` — all lead endpoints
9. `server/deal-router.ts` — all deal endpoints
10. `server/routers.ts` — current router mount structure
11. `client/src/pages/Home.tsx` — current dashboard (to update with real pipeline data)

---

## SPRINT OBJECTIVE

Wire Lead Engine (Sprint 24) + Deal Flow Engine (Sprint 25) + existing Client/Project infrastructure into a unified pipeline. Create orchestration functions that coordinate cross-domain transactions atomically, a pipeline overview page with funnel visualization, and update the homepage with real lead/deal/project/revenue data.

**No new database tables in this sprint.** All tables already exist (leads, deals, clients, projects, deal_stage_history, lead_activities, deal_activities). This sprint creates orchestration logic and integration UI.

---

## Phase 1: Pipeline Orchestrator Engine (TDD — Pure Functions)

**File:** `shared/pipeline-orchestrator.ts`

These are PURE FUNCTIONS. Zero database imports. They receive data as parameters and return instructions/payloads. The DB layer handles actual persistence.

### Task 1.1: Write tests for `buildLeadConversionPayload`
**Test file:** `server/sprint26-pipeline-engine.test.ts`
**Tests:**
- Happy path: qualified lead with all fields → returns valid { clientPayload, dealPayload, projectPayload }
- clientPayload maps firstName, lastName, email, phone, address, city, state, zip from lead
- clientPayload.channel = "commercial" when lead.channel is "commercial", else "residential"
- dealPayload.stage = "discovery"
- dealPayload.value = lead.estimatedBudget (or 0 if null)
- dealPayload.serviceTypes = parsed from lead.serviceTypeInterest
- dealPayload.probability = 10 (discovery stage default)
- projectPayload.name = "{firstName} {lastName} - {serviceTypeInterest}"
- projectPayload.status = "intake"
- projectPayload.address = lead.address
- Edge: lead with null estimatedBudget → dealPayload.value = 0
- Edge: lead with null serviceTypeInterest → dealPayload.serviceTypes = []
- Edge: lead with null address fields → graceful handling, no crash

```typescript
// Function signature:
export function buildLeadConversionPayload(lead: Lead): {
  clientPayload: Omit<InsertClient, "id" | "uuid" | "createdAt" | "updatedAt">;
  dealPayload: Omit<InsertDeal, "id" | "nanoid" | "createdAt" | "updatedAt">;
  projectPayload: Omit<InsertProject, "id" | "uuid" | "createdAt" | "updatedAt">;
}
```

### Task 1.2: Write tests for `buildDealWinPayload`
**Tests:**
- Happy path: deal with estimateId → returns { projectUpdate: { status: "approved" }, estimateUpdate: { status: "approved" } }
- Deal without estimateId → returns { projectUpdate: { status: "in_progress" }, estimateUpdate: null }
- Deal with value → projectUpdate includes estimatedValue = deal.value
- Deal.actualCloseDate is set to current date
- Edge: deal.projectId is null → returns error indicator { valid: false, reason: "Deal has no linked project" }

```typescript
export function buildDealWinPayload(deal: Deal): {
  valid: boolean;
  reason?: string;
  projectUpdate?: Partial<InsertProject>;
  estimateUpdate?: { status: string } | null;
  dealUpdate: { stage: "won"; actualCloseDate: Date; projectId?: number };
}
```

### Task 1.3: Write tests for `getPipelineSummary`
**Tests:**
- Takes array of leads, deals, projects → returns summary object
- leadsByStatus: counts leads grouped by status
- dealsByStage: counts deals grouped by stage
- pipelineValue: sum of all deal weighted values
- conversionRate: (converted leads / total leads) * 100
- avgDealValue: mean of all deal values
- Empty arrays → all zeros, no division by zero
- Single lead, no deals → conversionRate = 0

```typescript
export function getPipelineSummary(
  leads: Pick<Lead, "status">[],
  deals: Pick<Deal, "stage" | "value" | "probability" | "weightedValue">[],
  projects: Pick<Project, "status">[]
): {
  leadsByStatus: Record<string, number>;
  dealsByStage: Record<string, number>;
  projectsByStatus: Record<string, number>;
  pipelineValue: number;
  conversionRate: number;
  avgDealValue: number;
  totalLeads: number;
  totalDeals: number;
  totalProjects: number;
}
```

### Task 1.4: Write tests for `validatePipelineIntegrity`
**Tests:**
- Deal with leadId but lead doesn't exist → issue: "Lead {leadId} not found"
- Deal with clientId but client doesn't exist → issue: "Client {clientId} not found"
- Deal with projectId but project doesn't exist → issue: "Project {projectId} not found"
- Deal.stage = "won" but no projectId → issue: "Won deal has no linked project"
- Deal.stage = "won" but no actualCloseDate → issue: "Won deal has no close date"
- Deal with estimateId but no estimate exists → issue: "Estimate {estimateId} not found"
- All entities exist and consistent → { valid: true, issues: [] }
- Multiple issues → all captured in issues array

```typescript
export function validatePipelineIntegrity(
  deal: Deal,
  lead: Lead | null,
  client: Client | null,
  project: Project | null,
  estimate: { id: number } | null
): { valid: boolean; issues: string[] }
```

### Task 1.5: Write tests for `calculateFunnelMetrics`
**Tests:**
- Happy path: leads=100, qualified=50, deals=30, proposals=15, won=5 → rates calculated at each stage
- Zero at any stage → 0% conversion for that step, no division by zero
- Returns { stages: [{ name, count, conversionFromPrevious }] }

```typescript
export function calculateFunnelMetrics(counts: {
  totalLeads: number;
  qualifiedLeads: number;
  totalDeals: number;
  proposalsSent: number;
  dealsWon: number;
}): {
  stages: Array<{ name: string; count: number; value: number; conversionFromPrevious: number }>;
  overallConversionRate: number;
}
```

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm test   # all passing, engine tests ≥ 20
```

---

## Phase 2: Pipeline DB Helpers (TDD)

**File:** `server/pipeline-db.ts`

These functions orchestrate cross-domain database transactions. They use existing helpers from `lead-db.ts` and `deal-db.ts` where possible, but wrap multi-step operations in transactions.

### Task 2.1: Write tests for `orchestrateLeadConversion`
**Test file:** `server/sprint26-pipeline-db.test.ts`
**Tests:**
- Calls validateLeadForConversion → if invalid, throws with blockers
- Creates client (via existing client creation logic)
- Creates deal at stage "discovery" linked to lead and client
- Creates project at status "intake" linked to client
- Updates lead status to "converted" with convertedAt timestamp
- Records lead activity "Lead converted → Deal #{dealId}, Project #{projectId}"
- Records deal activity "Deal created from Lead #{leadId}"
- ALL steps in single transaction (atomicity)
- Audit logged: action = "pipeline.convert_lead"
- Returns { clientId, dealId, projectId }
- Edge: lead not found → throws "Lead not found"
- Edge: lead status != qualified → blocks conversion

```typescript
export async function orchestrateLeadConversion(
  leadId: number,
  userId: number
): Promise<{ clientId: number; dealId: number; projectId: number }>
```

### Task 2.2: Write tests for `orchestrateDealWin`
**Tests:**
- Validates deal exists and is not already won/lost
- If deal has no projectId → throws "Deal must have a linked project"
- Updates deal: stage="won", actualCloseDate=now
- Updates project: status="in_progress" (or "approved" if estimateId exists)
- Records deal stage history (won transition with dwellTimeDays)
- Records deal activity "Deal won — Project #{projectId} activated"
- ALL steps in single transaction
- Audit logged: action = "pipeline.deal_won"
- Returns { projectId, dealStage: "won" }
- Edge: deal already won → throws "Deal already won"
- Edge: deal is lost → throws "Cannot win a lost deal"

```typescript
export async function orchestrateDealWin(
  dealId: number,
  userId: number
): Promise<{ projectId: number; dealStage: string }>
```

### Task 2.3: Write tests for `getFullPipelineState`
**Tests:**
- Takes dealId, returns full state including linked lead, client, project, estimate
- Deal with no lead (standalone deal) → lead = null
- Deal with no project yet → project = null
- Deal with estimate → includes estimate data
- Non-existent dealId → returns null

```typescript
export async function getFullPipelineState(dealId: number): Promise<{
  deal: Deal;
  lead: Lead | null;
  client: Client | null;
  project: Project | null;
  estimate: any | null;
  activities: DealActivity[];
  stageHistory: DealStageHistory[];
} | null>
```

### Task 2.4: Write tests for `getPipelineOverviewData`
**Tests:**
- Returns aggregated data for the pipeline overview page
- leadStats: total, by status
- dealStats: total, by stage, total pipeline value
- projectStats: total, by status
- recentActivity: last 20 activities across leads and deals
- Returns correct counts with empty database

```typescript
export async function getPipelineOverviewData(): Promise<{
  leadStats: { total: number; byStatus: Record<string, number> };
  dealStats: { total: number; byStage: Record<string, number>; totalPipelineValue: number };
  projectStats: { total: number; byStatus: Record<string, number> };
  recentActivity: Array<{ type: string; description: string; timestamp: Date }>;
}>
```

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm test   # all passing, DB tests ≥ 20
```

---

## Phase 3: Pipeline Router (TDD)

**File:** `server/pipeline-router.ts`

### Task 3.1: Write tests for router structure
**Test file:** `server/sprint26-pipeline-router.test.ts`
**Tests:**
- All endpoints use protectedProcedure (NEVER publicProcedure)
- All input validated with Zod schemas
- All endpoints exist: convertLead, winDeal, getState, overview, funnel, validate

### Task 3.2: `pipeline.convertLead`
**Input:** `{ leadId: z.number() }`
**Calls:** `orchestrateLeadConversion(leadId, ctx.user.id)`
**Returns:** `{ clientId, dealId, projectId }`
**Tests:**
- Valid leadId → returns IDs
- Invalid leadId → TRPCError NOT_FOUND
- Lead not qualified → TRPCError PRECONDITION_FAILED

### Task 3.3: `pipeline.winDeal`
**Input:** `{ dealId: z.number() }`
**Calls:** `orchestrateDealWin(dealId, ctx.user.id)`
**Returns:** `{ projectId, dealStage }`
**Tests:**
- Valid dealId → returns result
- Already won → TRPCError CONFLICT
- No project linked → TRPCError PRECONDITION_FAILED

### Task 3.4: `pipeline.getState`
**Input:** `{ dealId: z.number() }`
**Calls:** `getFullPipelineState(dealId)`
**Returns:** full pipeline state
**Tests:**
- Valid dealId → full state returned
- Non-existent → TRPCError NOT_FOUND

### Task 3.5: `pipeline.overview`
**No input (query)**
**Calls:** `getPipelineOverviewData()`
**Returns:** aggregated pipeline overview data
**Tests:**
- Returns expected shape

### Task 3.6: `pipeline.funnel`
**No input (query)**
**Returns:** funnel metrics calculated from live data
**Tests:**
- Returns stages array with conversion rates

### Task 3.7: `pipeline.validate`
**Input:** `{ dealId: z.number() }`
**Calls:** `getFullPipelineState` → `validatePipelineIntegrity`
**Returns:** `{ valid, issues }`
**Tests:**
- Consistent deal → valid: true
- Inconsistent → valid: false with issues

### Task 3.8: Mount router in `server/routers.ts`
```typescript
import { pipelineRouter } from "./pipeline-router";
// Add to appRouter:
pipeline: pipelineRouter,
```

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm test   # all passing, router tests ≥ 15
```

---

## Phase 4: Enhance Existing lead-db.ts convertLeadToProject

**IMPORTANT:** The existing `convertLeadToProject` in `server/lead-db.ts` creates a client and project but does NOT create a deal. Sprint 26 replaces this flow with `orchestrateLeadConversion` which also creates a deal.

### Task 4.1: Update `lead-router.ts` convert endpoint
The `lead.convert` procedure should now call `orchestrateLeadConversion` from `pipeline-db.ts` instead of the old `convertLeadToProject`. This ensures that converting a lead ALWAYS creates a deal.

**Tests:**
- lead.convert now returns { clientId, dealId, projectId } (previously no dealId)
- The old convertLeadToProject function remains in lead-db.ts for backward compatibility but is deprecated

---

## Phase 5: Frontend — PipelineOverview.tsx

**File:** `client/src/pages/PipelineOverview.tsx`

### Task 5.1: Create PipelineOverview page
**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  Pipeline Overview                                    │
├────────┬────────┬────────┬────────┬─────────────────┤
│ Leads  │ Deals  │ Active │ Revenue│ Conversion Rate │
│  {n}   │  {n}   │ Proj   │  MTD   │    {n}%         │
│        │        │  {n}   │  {$}   │                 │
├────────┴────────┴────────┴────────┴─────────────────┤
│                                                       │
│  PIPELINE FUNNEL                                      │
│  ████████████████████████ Leads ({n})                 │
│  ██████████████████ Qualified ({n})                   │
│  ████████████████ Deals ({n})                         │
│  ████████████ Proposals ({n})                         │
│  ██████ Won ({n})                                     │
│                                                       │
│  Conversion: Leads→Qualified {x}%  Deals→Won {y}%    │
├─────────────────────────────────────────────────────┤
│  DEAL PIPELINE BY STAGE                               │
│  ┌──────────┬──────────┬──────────┬──────────┐       │
│  │Discovery │Site Visit│Estimating│Proposal  │       │
│  │  $xxx    │  $xxx    │  $xxx    │  $xxx    │       │
│  │  n deals │  n deals │  n deals │  n deals │       │
│  └──────────┴──────────┴──────────┴──────────┘       │
├─────────────────────────────────────────────────────┤
│  RECENT ACTIVITY                                      │
│  • Lead "John Smith" converted → Deal #42             │
│  • Deal "Kitchen Remodel" won: $67,500                │
│  • Lead scored: Hot (85 points)                       │
└─────────────────────────────────────────────────────┘
```

**Uses:**
- `trpc.pipeline.overview.useQuery()` for stats
- `trpc.pipeline.funnel.useQuery()` for funnel data
- `trpc.deal.forecast.useQuery()` for revenue forecasting
- Loading states, error handling
- Responsive layout with Tailwind
- Color-coded funnel bars (gold theme consistent with app)

### Task 5.2: Add route to App.tsx (lazy-loaded)
```tsx
const PipelineOverview = lazy(() => import("./pages/PipelineOverview"));
// Add route: /pipeline → PipelineOverview
```

### Task 5.3: Add to sidebar navigation in DashboardLayout.tsx
Add "Pipeline" item with a funnel/flow icon AFTER "Leads" in navigation order:
```
Leads → Pipeline → Deals → Projects → ...
```

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm build  # builds successfully
```

---

## Phase 6: Frontend — Update Home.tsx with Real Pipeline Data

### Task 6.1: Add pipeline queries to Home.tsx
Replace the static metric cards with real data:
```tsx
// Add these queries:
const { data: leadStats } = trpc.leads.stats.useQuery();
const { data: dealStats } = trpc.deal.stats.useQuery();
const { data: pipelineOverview } = trpc.pipeline.overview.useQuery();
```

### Task 6.2: Update Quick Action cards
Add a "New Lead" quick action button (navigates to /leads).
Add "Pipeline" quick action button (navigates to /pipeline).

### Task 6.3: Add pipeline metrics row
Above or alongside existing metrics, add:
- Active Leads: count from leadStats
- Pipeline Value: totalPipelineValue from dealStats (formatted as currency)
- Deals in Progress: count of deals not won/lost
- Revenue MTD: sum of won deals this month

### Task 6.4: Add mini pipeline funnel
Below metrics, add a compact horizontal funnel showing:
`Leads (n) → Deals (n) → Won (n) → Revenue ($)`
Each step shows the count and a conversion arrow.

### Phase Gate:
```bash
pnpm check  # 0 errors
pnpm build  # builds successfully
```

---

## Phase 7: Release Verification

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
- [ ] New tables: 0 (integration sprint — no new tables)
- [ ] New engine functions: (list from pipeline-orchestrator.ts)
- [ ] New DB helpers: (list from pipeline-db.ts)
- [ ] New router procedures: (list from pipeline-router.ts)
- [ ] Home.tsx updated with real pipeline data: YES/NO
- [ ] PipelineOverview.tsx created and routed: YES/NO
- [ ] Sidebar updated with Pipeline nav item: YES/NO
- [ ] All mutations have audit logging: YES/NO
- [ ] All router endpoints use protectedProcedure: YES/NO
- [ ] lead.convert now creates a deal: YES/NO

### Final commit:
```bash
git add -A
git commit -m "feat(pipeline): Sprint 26 — Lead-to-Deal-to-Project Pipeline Integration

- [X] new tests, [Y] total passing
- 5 pipeline orchestrator functions
- 4 pipeline DB helpers
- 7 pipeline router procedures
- PipelineOverview.tsx with funnel visualization
- Home.tsx updated with real lead/deal/project data
- lead.convert now creates deal atomically
"
```

---

## EXECUTION METHODOLOGY REMINDER

### TDD — Every function:
1. **RED** — Write test FIRST. Run. Confirm FAIL.
2. **GREEN** — Minimum code to pass. Run. Confirm PASS.
3. **REFACTOR** — Clean up. Run ALL tests. Zero regressions.

### Micro-tasks (2-5 min each):
Each task above is already a micro-task. Commit after each one.

### Phase Gates:
`pnpm check` + `pnpm test` after EVERY phase. Do not advance if anything fails.

### CRITICAL RULES:
- **NEVER use publicProcedure** — all pipeline endpoints use protectedProcedure
- **ALL mutations call logAudit()** — pipeline operations are business-critical
- **ALL transactions are atomic** — orchestrateLeadConversion and orchestrateDealWin must use db.transaction()
- **Import canonical types** from `drizzle/schema.ts` and `shared/domain/taxonomy.ts`
- **Use round2() from shared/utils/math.ts** for any financial calculations
- **NEVER write existence-only tests** — every test must verify BEHAVIOR
- **Reuse existing helpers** — don't rewrite what's in lead-db.ts and deal-db.ts

### TEST QUALITY STANDARD:
Target: 60+ tests total for this sprint
- Engine tests: ≥ 20 (pure function behavior, edge cases, boundary values)
- DB tests: ≥ 20 (CRUD, transactions, audit logging, cross-domain atomicity)
- Router tests: ≥ 15 (input validation, error handling, auth verification)
- Integration tests: ≥ 5 (full Lead→Deal→Project flow end-to-end)

**DB and Router tests must test BEHAVIOR, not existence.** Examples:
- GOOD: "orchestrateLeadConversion creates a deal at discovery stage"
- GOOD: "pipeline.convertLead returns TRPCError PRECONDITION_FAILED when lead not qualified"
- BAD: "orchestrateLeadConversion is a function"
- BAD: "pipeline router has a convertLead endpoint"
