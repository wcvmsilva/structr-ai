# structr.ai — Construction Operating System (COS) Evolution Roadmap

**Author:** Lead Systems Architect (Wellington)
**Date:** 2026-03-20
**Status:** Strategic blueprint for Antigravity execution
**Prerequisite:** Sprint 23 (Production Readiness) must be completed first

---

## EXECUTION METHODOLOGY (Mandatory for ALL Sprints — Adapted from Superpowers Framework)

These rules apply to every sprint from Sprint 24 onward. They are non-negotiable and must be followed exactly.

### Rule 1: TDD — Test-Driven Development

For every new function, DB helper, router procedure, or engine method:
1. **RED** — Write the test FIRST. Run it. Confirm it FAILS with the expected assertion error.
2. **GREEN** — Write the minimum code to make the test pass. Run it. Confirm it PASSES.
3. **REFACTOR** — Clean up the implementation. Run all tests. Confirm zero regressions.

If you write implementation code before writing the test, DELETE the implementation and start over. Code written before tests is untrusted code.

### Rule 2: Micro-Task Decomposition

Every Phase in every Sprint must be broken into micro-tasks of **2-5 minutes** each. Each micro-task specifies:
- **Exact file path** and function name being created/modified
- **Test file and test name** that validates this task
- **Test command:** `pnpm test -- --grep "test name pattern"`
- **Expected result:** "X tests passing, 0 failures"
- **Commit message:** one commit per micro-task

Example micro-task for Lead Engine:
```
Task 3.2: Implement scoreLead — budget factor
File: shared/lead-engine.ts (line ~45)
Test: server/sprint24-lead-engine.test.ts → "scoreLead > adds +15 for budget above 50k"
Command: pnpm test -- --grep "budget above 50k"
Expected: 1 test passing
Commit: "feat(lead): add budget scoring factor to scoreLead"
```

### Rule 3: Scientific Debugging

If a test fails after your change:
- **Phase 1:** Read the full error message. Reproduce. Find root cause.
- **Phase 2:** Find working similar code in the codebase. Compare.
- **Phase 3:** One hypothesis, one change, one test. Repeat up to 3 times.
- **Phase 4:** If 3 attempts fail → STOP. Document in `TECH-DEBT.md`. Move on.

### Rule 4: Phase Gate — Verify Before Advancing

After each Phase:
1. `pnpm check` → 0 TypeScript errors
2. `pnpm test` → ALL tests passing (old + new), zero regressions
3. `git diff --stat` → review what changed
4. Checklist: audit logging on all mutations? Normalization at router boundaries? No publicProcedure on sensitive data? Canonical enums used?

### Rule 5: Evidence-Based Completion

When reporting Phase completion, provide:
- Test output: total count, pass count, fail count
- TypeScript check: "0 errors"
- List of files created/modified
- Number of new tests added

---

## CONTEXT: WHERE WE ARE

The codebase has 7 engines, 51+ tables, 1,944 tests, and a complete **Scope → Estimate pipeline**. This covers roughly 40% of a Construction Operating System. The architecture is disciplined (engine/db/router/page pattern) and extensible.

### What exists (mapped to COS vision):

| COS Module | Current State | Coverage |
|---|---|---|
| **Pricing Engine** | 7 engines, dimensional pricing, Profit Shield, geo modifiers | 95% |
| **Scope Builder Engine** | Rule-based scope gen, review workflow, override resolver | 90% |
| **Integration Engine** | JobTread CSV export, Google Maps geocoding, S3 storage | 30% |
| **Inspection Engine** | field_feedback_reports, project_actuals, variance tracking | 20% |
| **Schedule Engine** | crew_assignments table exists, no scheduling logic | 10% |
| **Lead Engine** | Nothing — no tables, no logic, no UI | 0% |
| **Deal Flow Engine** | Nothing — no pipeline stages, no forecasting | 0% |
| **Conversion Engine** | Scope→Estimate pipeline exists, no follow-up/close logic | 15% |

### What must be built:

```
PHASE A (Sprint 24-26): Lead → Deal → Project Pipeline
PHASE B (Sprint 27-29): Field Intelligence + Scheduling
PHASE C (Sprint 30-32): Integration Hub + Conversion Automation
PHASE D (Sprint 33+):   Learning Layer v2 + AI Orchestration
```

---

## ARCHITECTURAL PRINCIPLE

Every new module MUST follow the established pattern:

```
shared/[domain]-engine.ts    → Pure functions, zero DB, zero side effects
server/[domain]-db.ts        → DB helpers with audit logging
server/[domain]-router.ts    → tRPC procedures with Zod validation + RBAC
client/src/pages/[Domain].tsx → React page with tRPC hooks
drizzle/schema.ts            → New tables with proper indexes
```

Every new table MUST have:
- `id` (auto-increment)
- `createdAt`, `updatedAt` timestamps
- `createdBy` / `updatedBy` user references
- Soft delete via `deletedAt` where applicable
- Audit logging on all mutations

---

## PHASE A: Lead → Deal → Project Pipeline (Sprint 24-26)

This is the highest-value gap. Today, leads arrive via email/phone and are manually entered. This phase makes Structr the single entry point for all new business.

---

### Sprint 24 — Lead Engine

**New tables:**

```sql
leads (18 columns)
├── id, nanoid (external ref)
├── source (enum: website, email, phone, referral, social, walk_in)
├── channel (enum: direct, insurance, commercial) -- reuse canonical enum
├── status (enum: new, contacted, qualified, disqualified, converted)
├── priority (enum: hot, warm, cold)
├── firstName, lastName, email, phone
├── address, city, state, zip
├── serviceTypeInterest (varchar) -- e.g. "kitchen, bathroom"
├── estimatedBudget (decimal)
├── notes (text)
├── assignedTo (FK → users)
├── qualifiedAt, convertedAt, disqualifiedAt (timestamps)
├── createdAt, updatedAt, createdBy, deletedAt

lead_activities (10 columns)
├── id
├── leadId (FK → leads)
├── activityType (enum: note, call, email, sms, meeting, status_change)
├── description (text)
├── metadata (JSON) -- flexible payload for different activity types
├── performedBy (FK → users)
├── performedAt, createdAt
```

**Engine:** `shared/lead-engine.ts`
```
Functions:
- scoreLead(lead) → { score: 0-100, factors: string[] }
  Scoring factors:
  * +20 if serviceTypeInterest matches high-value trades (kitchen, bathroom, roofing)
  * +15 if estimatedBudget > $50k
  * +10 if zip in Charleston service radius (reuse geo-engine)
  * +10 if source is referral
  * +5 if has email AND phone
  * -10 if zip outside service radius
  * -20 if budget < $5k

- classifyPriority(score) → hot | warm | cold
  hot: score >= 70
  warm: score >= 40
  cold: score < 40

- validateLeadForConversion(lead) → { valid: boolean, blockers: string[] }
  Requires: name, phone OR email, valid service type, status = qualified

- convertLeadToClient(lead) → ClientCreatePayload
  Maps lead fields to client schema fields

- detectDuplicateLead(lead, existingLeads) → { isDuplicate: boolean, matchedLeadId?: number }
  Match on: normalized email OR normalized phone OR (firstName + lastName + zip)
```

**DB Helpers:** `server/lead-db.ts`
```
- createLead, getLeadById, listLeads (with filters: status, priority, assignedTo, dateRange)
- updateLead, updateLeadStatus (with state machine validation)
- qualifyLead, disqualifyLead (with reason)
- convertLeadToProject (atomic: creates client + project + links lead)
- addLeadActivity, getLeadActivities
- getLeadStats (by status, by source, by period)
- searchLeads (by name, email, phone, address)
```

**Router:** `server/lead-router.ts`
```
Procedures (all protectedProcedure):
- lead.create, lead.getById, lead.list, lead.update
- lead.qualify, lead.disqualify, lead.convert
- lead.addActivity, lead.getActivities
- lead.score (runs lead-engine scoring)
- lead.stats, lead.search
- lead.detectDuplicate
```

**Page:** `client/src/pages/Leads.tsx`
```
- Lead list with kanban-style columns (New | Contacted | Qualified | Converted)
- Lead detail panel with activity timeline
- Quick actions: Call, Email, Qualify, Convert
- Lead scoring badge (hot/warm/cold with color coding)
- Filter by: status, priority, source, assigned user, date range
```

**Sidebar:** Add "Leads" as the FIRST item in navigation (before Dashboard), with a badge showing count of "new" leads.

**Tests:** ~80 tests covering:
- Lead scoring formula (all factor combinations)
- Priority classification boundaries
- Duplicate detection (email match, phone match, name+zip match)
- State machine (new→contacted→qualified→converted, new→disqualified)
- Conversion mapping (lead → client + project)

---

### Sprint 25 — Deal Flow Engine

**New tables:**

```sql
deals (22 columns)
├── id, nanoid
├── leadId (FK → leads, nullable — deals can exist without leads)
├── clientId (FK → clients)
├── projectId (FK → projects, nullable — assigned when deal closes)
├── title (varchar)
├── stage (enum: discovery, site_visit, estimating, proposal_sent, negotiation, won, lost)
├── value (decimal) -- estimated deal value
├── probability (int 0-100) -- win probability percentage
├── weightedValue (decimal) -- value * probability/100
├── expectedCloseDate (date)
├── actualCloseDate (date, nullable)
├── lostReason (varchar, nullable)
├── serviceTypes (JSON array) -- e.g. ["kitchen", "bathroom"]
├── channel, region, zone
├── assignedTo (FK → users)
├── estimateId (FK → estimate_drafts, nullable)
├── notes (text)
├── createdAt, updatedAt, createdBy, deletedAt

deal_activities (same structure as lead_activities, FK → deals)

deal_stage_history (8 columns)
├── id, dealId, fromStage, toStage, changedBy, changedAt, dwellTimeDays, notes
```

**Engine:** `shared/deal-engine.ts`
```
Functions:
- calculateWeightedPipeline(deals[]) → { total: number, byStage: Record<Stage, number> }
- calculateWinProbability(deal, historicalDeals) → number
  Based on: service type close rates, deal value bracket, channel, time in pipeline
- forecastRevenue(deals[], period) → { expected: number, best: number, worst: number }
- suggestNextAction(deal) → { action: string, reason: string, urgency: string }
  Examples:
  * discovery + no site visit scheduled → "Schedule site visit"
  * estimating + estimate complete → "Send proposal"
  * proposal_sent + 3 days elapsed → "Follow up"
  * negotiation + 7 days elapsed → "Escalate or close"
- detectStaleDeal(deal) → { isStale: boolean, daysSinceLastActivity: number }
- validateStageTransition(from, to) → boolean
  Valid: discovery→site_visit→estimating→proposal_sent→negotiation→won/lost
  Also: any stage→lost
```

**DB Helpers:** `server/deal-db.ts`
```
- createDeal, getDealById, listDeals (filters: stage, assignedTo, client, dateRange, value range)
- updateDeal, updateDealStage (records history + dwellTime)
- markWon (links to project, sets actualCloseDate)
- markLost (requires lostReason)
- linkEstimate (connects estimate draft to deal)
- addDealActivity, getDealActivities
- getDealStats (pipeline summary, win rate, avg deal size, avg cycle time)
- getStaleDeals (no activity in X days)
- getPipelineForecast (weighted value by stage)
```

**Router:** `server/deal-router.ts`
```
Procedures:
- deal.create, deal.getById, deal.list, deal.update
- deal.advanceStage, deal.markWon, deal.markLost
- deal.linkEstimate, deal.addActivity, deal.getActivities
- deal.stats, deal.forecast, deal.staleDeals
- deal.suggestNextAction
```

**Page:** `client/src/pages/Deals.tsx`
```
- Pipeline kanban board (drag-and-drop stage transitions)
- Pipeline value bar chart (weighted by stage)
- Deal detail with linked estimate, client, activities
- Stale deal alerts
- Monthly/quarterly forecast widget
```

**Tests:** ~90 tests

---

### Sprint 26 — Lead-to-Deal-to-Project Pipeline Integration

This sprint wires everything together into a single flow.

**Unified Pipeline Flow:**
```
Lead arrives (any source)
  ↓ score + classify
  ↓ assign to user
Lead.qualify()
  ↓ validateLeadForConversion()
Lead.convert()
  ↓ creates Client (if new)
  ↓ creates Deal (stage: discovery)
  ↓ creates Project (status: intake)
  ↓ links all three
Deal advances through stages:
  discovery → site_visit → estimating → proposal_sent → negotiation → won
  ↓ At "estimating" stage:
    ↓ Intake form created for project
    ↓ Scope generated from intake (existing engine)
    ↓ Estimate created from scope (existing pipeline)
    ↓ Estimate linked to deal
  ↓ At "won" stage:
    ↓ Deal.markWon()
    ↓ Project status → active
    ↓ Estimate status → approved
```

**New:** `shared/pipeline-orchestrator.ts`
```
Functions:
- orchestrateLeadConversion(leadId) → { clientId, dealId, projectId }
- orchestrateDealWin(dealId) → { projectId, estimateStatus }
- getFullPipelineState(dealId) → { lead, client, deal, project, intake, scope, estimate }
- validatePipelineIntegrity(dealId) → { valid: boolean, issues: string[] }
```

**Page:** `client/src/pages/PipelineOverview.tsx`
```
- Full funnel visualization: Leads → Deals → Projects → Revenue
- Conversion rate at each stage
- Revenue forecast
- Activity feed across all pipeline entities
```

**Homepage update:** Replace fake data in Home.tsx with real queries:
- Active leads count (from lead.stats)
- Pipeline value (from deal.forecast)
- Active projects (from project.getStats)
- Revenue this month (from deal.stats where stage=won)

**Tests:** ~60 tests covering orchestration and integration

---

## PHASE B: Field Intelligence + Scheduling (Sprint 27-29)

### Sprint 27 — Inspection Engine

**New tables:**
```sql
inspection_templates (12 columns)
├── id, name, serviceType, checklistItems (JSON), requiredPhotos (int)
├── passThreshold (int), isActive, createdAt, updatedAt, createdBy

inspections (18 columns)
├── id, projectId, dealId, templateId
├── status (enum: scheduled, in_progress, completed, failed)
├── scheduledDate, completedDate
├── inspectorId (FK → users)
├── location (text), latitude, longitude
├── checklistResults (JSON), photoCount, score, passed
├── notes, findings (JSON)
├── createdAt, updatedAt, createdBy

inspection_photos (8 columns)
├── id, inspectionId, s3Key, caption, category, sortOrder, createdAt
```

**Engine:** `shared/inspection-engine.ts`
```
- evaluateChecklist(template, results) → { score, passed, failedItems[] }
- generateInspectionReport(inspection) → InspectionReport
- suggestFollowUpActions(inspection) → Action[]
- calculateCompletionRate(inspections[]) → percentage
```

---

### Sprint 28 — Schedule Engine

**New tables:**
```sql
project_phases (14 columns)
├── id, projectId, name, trade
├── startDate, endDate, duration (days)
├── status (enum: planned, in_progress, completed, delayed, blocked)
├── dependencies (JSON) -- array of phaseIds that must complete first
├── assignedCrewId, crewSize, laborHours
├── sortOrder, createdAt, updatedAt

schedule_conflicts (8 columns)
├── id, projectId, phaseId, conflictType, description, severity, resolvedAt, createdAt
```

**Engine:** `shared/schedule-engine.ts`
```
- generateProjectTimeline(project, assemblies, crews) → Phase[]
  Maps assemblies to trade-sequenced phases with duration estimates
- detectConflicts(phases[], crews[]) → Conflict[]
  Checks: crew double-booking, dependency violations, weekend overlaps
- optimizeRoute(projects[], baseLocation) → OrderedProjects[]
  Uses haversine (from geo-engine) to minimize travel distance
- calculateCrewUtilization(crews[], phases[], dateRange) → UtilizationReport
```

---

### Sprint 29 — Field Visit Workflow

**Enhances inspection + schedule into a unified field experience.**

**New tables:**
```sql
field_visits (16 columns)
├── id, projectId, dealId, visitType (enum: initial, follow_up, final_inspection)
├── scheduledDate, scheduledTime, actualArrivalTime
├── latitude, longitude, geoVerified (boolean)
├── preVisitChecklist (JSON), postVisitNotes
├── signatureS3Key, status (enum: scheduled, en_route, on_site, completed, no_show)
├── createdAt, updatedAt, assignedTo
```

**Engine:** `shared/field-visit-engine.ts`
```
- generatePreVisitChecklist(project, deal) → ChecklistItem[]
  Based on service type, project stage, and historical patterns
- validateArrival(visit, gpsCoords) → { verified, distanceFromSite }
- calculateOptimalRoute(visits[], startLocation) → OrderedVisits[]
- detectScheduleConflicts(visits[], existingSchedule) → Conflict[]
```

---

## PHASE C: Integration Hub + Conversion (Sprint 30-32)

### Sprint 30 — Integration Engine

**New tables:**
```sql
integrations (12 columns)
├── id, name, type (enum: jobtread, quickbooks, google_calendar, email, sms)
├── config (JSON, encrypted), status (enum: active, paused, error)
├── lastSyncAt, syncFrequency, errorCount, lastError
├── createdAt, updatedAt

sync_events (10 columns)
├── id, integrationId, direction (enum: inbound, outbound)
├── entityType, entityId, status, payload (JSON)
├── errorMessage, createdAt
```

**Engine:** `shared/integration-engine.ts`
```
- buildJobTreadPayload(estimate) → JobTreadCSV (enhance existing)
- buildQuickBooksPayload(estimate) → QuickBooksInvoice
- mapInboundLead(source, rawData) → LeadCreatePayload
- validateSyncPayload(integration, payload) → ValidationResult
- detectSyncConflicts(local, remote) → Conflict[]
```

### Sprint 31 — Conversion Engine

**Enhancement to existing estimate pipeline + new follow-up automation.**

**New tables:**
```sql
proposals (14 columns)
├── id, estimateId, dealId, clientId
├── version (int), status (enum: draft, sent, viewed, accepted, rejected, expired)
├── sentAt, viewedAt, respondedAt, expiresAt
├── pdfS3Key, coverLetter (text)
├── createdAt, updatedAt

follow_up_tasks (14 columns)
├── id, entityType (lead/deal/proposal), entityId
├── taskType (enum: call, email, sms, meeting, review)
├── title, description
├── dueDate, completedAt
├── assignedTo, priority (enum: high, medium, low)
├── isAutomated (boolean)
├── createdAt, updatedAt

follow_up_rules (10 columns)
├── id, triggerEvent (enum: proposal_sent, proposal_viewed, deal_stale, lead_cold)
├── delayDays (int), taskType, templateMessage
├── isActive, createdAt, updatedAt
```

**Engine:** `shared/conversion-engine.ts`
```
- generateFollowUpSchedule(deal, rules) → FollowUpTask[]
- calculateConversionProbability(deal, history) → percentage
- suggestOptimalFollowUp(deal, activities) → { channel, timing, message }
- detectAtRiskDeals(deals[], rules) → AtRiskDeal[]
- generateProposalCoverLetter(estimate, client, deal) → string
```

### Sprint 32 — Unified Dashboard (COS Home)

Replace current Home.tsx with a true command center:

```
┌────────────────────────────────────────────────┐
│  STRUCTR.AI — Construction Operating System     │
├──────────┬──────────┬──────────┬───────────────┤
│ New Leads │ Pipeline │ Active   │ Revenue MTD   │
│    12     │  $847K   │ Projects │   $187,500    │
│           │          │    8     │               │
├──────────┴──────────┴──────────┴───────────────┤
│                                                  │
│  PIPELINE FUNNEL                                 │
│  ████████████████████ Discovery (5)  $230K       │
│  ██████████████ Site Visit (3)       $180K       │
│  █████████████████ Estimating (4)    $290K       │
│  ████████ Proposal Sent (2)          $95K        │
│  ████ Negotiation (1)                $52K        │
│                                                  │
├──────────────────────────────────────────────────┤
│  TODAY'S ACTIONS                                 │
│  ⚡ 3 follow-ups due                             │
│  📋 2 inspections scheduled                      │
│  📄 1 proposal expiring tomorrow                 │
│  🔥 1 hot lead uncontacted (2 days)              │
├──────────────────────────────────────────────────┤
│  RECENT ACTIVITY                                 │
│  • Lead "James Morrison" qualified → Deal created│
│  • Estimate #47 sent as proposal to Sarah Chen   │
│  • Inspection completed: 142 King St (Score: 92) │
│  • Deal "Williams Roofing" won: $67,500          │
└──────────────────────────────────────────────────┘
```

---

## PHASE D: AI Orchestration Layer (Sprint 33+)

This is where Structr becomes truly intelligent.

### Sprint 33 — Learning Layer v2

Enhance existing learning layer with:
- Win/loss pattern recognition (which service types close best, which channels, which regions)
- Optimal pricing suggestion (based on historical win rates at different price points)
- Crew performance scoring (which crews deliver on time/budget)
- Seasonal demand forecasting

### Sprint 34 — AI Orchestrator

**This is the "brain" of the COS.**

**Engine:** `shared/orchestrator-engine.ts`
```
- suggestDailyPriorities(userId) → PriorityAction[]
  Aggregates across all domains: leads to contact, deals to follow up,
  estimates to complete, inspections to schedule, proposals expiring

- detectAnomalies(timeRange) → Anomaly[]
  Unusual variance, stale deals, pricing drift, crew utilization drops

- generateWeeklyReport() → COSReport
  Pipeline health, conversion rates, revenue forecast, team performance

- recommendPricingAdjustment(assembly, historicalData) → PricingRecommendation
  Based on learning layer metrics + market conditions
```

---

## EXECUTION ORDER FOR ANTIGRAVITY

```
PREREQUISITE: Sprint 23 (Production Readiness) ← already delivered

Sprint 24: Lead Engine                    ← START HERE
Sprint 25: Deal Flow Engine
Sprint 26: Pipeline Integration
Sprint 27: Inspection Engine
Sprint 28: Schedule Engine
Sprint 29: Field Visit Workflow
Sprint 30: Integration Engine
Sprint 31: Conversion Engine
Sprint 32: Unified COS Dashboard
Sprint 33: Learning Layer v2
Sprint 34: AI Orchestrator
```

**Each sprint MUST:**
1. Follow the engine/db/router/page pattern
2. Include 60-100 vitest tests
3. Pass ALL existing tests (zero regressions)
4. Include audit logging on all mutations
5. Use canonical enums from `shared/domain/taxonomy.ts`
6. Add normalization at all router boundaries

---

## DATABASE TABLE COUNT PROJECTION

| Phase | Current | New Tables | Running Total |
|---|---|---|---|
| Current | 51 | — | 51 |
| Sprint 24 (Lead) | 51 | +2 | 53 |
| Sprint 25 (Deal) | 53 | +3 | 56 |
| Sprint 26 (Pipeline) | 56 | +0 | 56 |
| Sprint 27 (Inspection) | 56 | +3 | 59 |
| Sprint 28 (Schedule) | 59 | +2 | 61 |
| Sprint 29 (Field Visit) | 61 | +1 | 62 |
| Sprint 30 (Integration) | 62 | +2 | 64 |
| Sprint 31 (Conversion) | 64 | +3 | 67 |
| Sprint 32 (Dashboard) | 67 | +0 | 67 |

**Final projected: 67 tables, ~12 engines, ~2,800+ tests**

---

## TEST COUNT PROJECTION

| Sprint | New Tests | Running Total |
|---|---|---|
| Sprint 23 (Hardening) | ~30 | ~1,974 |
| Sprint 24 (Lead) | ~80 | ~2,054 |
| Sprint 25 (Deal) | ~90 | ~2,144 |
| Sprint 26 (Pipeline) | ~60 | ~2,204 |
| Sprint 27 (Inspection) | ~70 | ~2,274 |
| Sprint 28 (Schedule) | ~75 | ~2,349 |
| Sprint 29 (Field Visit) | ~65 | ~2,414 |
| Sprint 30 (Integration) | ~70 | ~2,484 |
| Sprint 31 (Conversion) | ~80 | ~2,564 |
| Sprint 32 (Dashboard) | ~40 | ~2,604 |

---

## CRITICAL RULES FOR ALL SPRINTS

1. **NEVER break the existing pipeline.** The Scope → Estimate flow is the revenue engine. Every sprint must preserve it.
2. **Reuse canonical enums.** New domains (lead, deal) must use the same `Channel`, `ServiceType`, `FinishLevel` enums from `shared/domain/taxonomy.ts`.
3. **Reuse geo-engine.** Lead scoring and schedule optimization should import from `shared/geo-engine.ts` for distance calculations and zone detection.
4. **Reuse pricing-engine.** Deal value estimation should use the same pricing dimensions as estimates.
5. **Audit everything.** Every new mutation gets `logAudit()`.
6. **Test everything.** No sprint ships with less than 60 new tests.
7. **One commit per phase.** Makes rollback possible.
