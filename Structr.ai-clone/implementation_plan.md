# Structr.ai Sprint 24: Lead Engine Implementation Plan

## Goal Description
Implement the **Lead Engine** as the first step of Phase A (Lead → Deal → Project Pipeline). The Lead Engine will serve as the single entry point for all new business, replacing manual email/phone workflows. It includes a comprehensive schema for leads and activities, a scoring engine based on rules, a database abstraction layer, a tRPC router, and a React frontend page. This will be developed strictly using TDD methodology (2-5 minute micro-tasks).

## Proposed Changes

### Database Schema
#### [MODIFY] [schema.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/drizzle/schema.ts)
- Add `leads` table with columns: id, nanoid, source, channel, status, priority, firstName, lastName, email, phone, address, city, state, zip, serviceTypeInterest, estimatedBudget, notes, assignedTo, timestamps (qualifiedAt, convertedAt, disqualifiedAt, createdAt, updatedAt, createdBy, deletedAt).
- Add `leadActivities` table with columns: id, leadId, activityType, description, metadata, performedBy, performedAt, createdAt.
#### [MODIFY] [relations.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/drizzle/relations.ts)
- Define relations for `leads` and `leadActivities`.

### Sub-Engine
#### [NEW] [sprint24-lead-engine.test.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/sprint24-lead-engine.test.ts)
- Write tests for `scoreLead`, `classifyPriority`, `validateLeadForConversion`, `convertLeadToClient`, `detectDuplicateLead`.
#### [NEW] [lead-engine.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/shared/lead-engine.ts)
- Implement pure logic for scoring, priority classification, conversion validation, and deduplication based on TDD.

### Database Layer
#### [NEW] [sprint24-lead-db.test.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/sprint24-lead-db.test.ts)
- Write tests for DB helpers: `createLead`, `listLeads`, `updateLeadStatus`, `convertLeadToProject`, etc.
#### [NEW] [lead-db.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts)
- Implement CRUD helpers + `convertLeadToProject` (atomic transaction).
- Ensure [logAudit](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/audit.ts#25-54) is called on mutations.

### API Router
#### [NEW] [sprint24-lead-router.test.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/sprint24-lead-router.test.ts)
- Write tests validating the tRPC router endpoints, RBAC, and Zod inputs.
#### [NEW] [lead-router.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-router.ts)
- Implement `protectedProcedure` endpoints matching the DB helpers.
#### [MODIFY] [routers.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/routers.ts)
- Mount `lead: leadRouter`.

### Frontend
#### [NEW] [Leads.tsx](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/client/src/pages/Leads.tsx)
- Kanban-style columns (New | Contacted | Qualified | Converted) with lead detail panel.
#### [MODIFY] [App.tsx](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/client/src/App.tsx)
- Add `/leads` route.
#### [MODIFY] [DashboardLayout.tsx](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/client/src/components/DashboardLayout.tsx)
- Insert "Leads" as the first navigation item.

## Verification Plan

### Automated Tests
- Run `pnpm check` to assert zero TypeScript errors.
- Run `pnpm test` globally to guarantee 0 regressions against the ~1,944 existing tests.
- Run `pnpm test -- --grep "Sprint 24"` to validate the ~80 new tests sequentially as part of the Red-Green-Refactor TDD loop.

### Manual Verification
- Verify the local database migrated successfully via `pnpm db:push`.
- View the kanban board locally by navigating to `/leads`.
- Check if audit logs are actively capturing `lead.*` actions.
