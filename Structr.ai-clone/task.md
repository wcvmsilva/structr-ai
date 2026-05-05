# Sprint 24: Lead Engine 

## Phase 1: Database Schema
- [x] 1.1 Add `leads` and `lead_activities` tables to Drizzle Schema
- [x] 1.2 Run db migration (`pnpm db:push`)
- [x] 1.3 Populate relationships in [relations.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/drizzle/relations.ts)

## Phase 2: Engine Logic (TDD)
- [x] 2.1 Write test + implement [scoreLead](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/shared/lead-engine.ts#4-57)
- [x] 2.2 Write test + implement [classifyPriority](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/shared/lead-engine.ts#58-63)
- [x] 2.3 Write test + implement [validateLeadForConversion](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/shared/lead-engine.ts#64-91)
- [x] 2.4 Write test + implement [convertLeadToClient](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/shared/lead-engine.ts#92-105)
- [x] 2.5 Write test + implement [detectDuplicateLead](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/shared/lead-engine.ts#111-150)

## Phase 3: DB Helpers (TDD)
- [x] 3.1 Write test + implement [createLead](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts#9-28) / [getLeadById](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts#29-36)
- [x] 3.2 Write test + implement [listLeads](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts#37-63) / [searchLeads](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts#187-203)
- [x] 3.3 Write test + implement status transitions ([updateLeadStatus](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts#81-90), [qualifyLead](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts#91-94)) 
- [x] 3.4 Write test + implement [convertLeadToProject](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts#111-169) (transaction)
- [x] 3.5 Write test + implement activities CRUD ([addLeadActivity](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-db.ts#170-177))

## Phase 4: API Router (TDD)
- [x] 4.1 Write integration tests for tRPC `lead.*` paths
- [x] 4.2 Initialize [lead-router.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/lead-router.ts) with Zod schemas
- [x] 4.3 Implement `lead.create`, `lead.get`, `lead.list`, `lead.search`
- [x] 4.4 Implement `lead.update`, `lead.updateStatus`
- [x] 4.5 Implement `lead.convert`
- [x] 4.6 Implement `lead.addActivity`, `lead.getActivities`
- [x] 4.7 Update [server/routers.ts](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/server/routers.ts) to mount `leadRouter`

## Phase 5: Frontend Experience
- [x] 5.1 Implement [Leads.tsx](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/client/src/pages/Leads.tsx) Kanban board & logic
- [x] 5.2 Add [LeadModal](file:///Users/wsilva/Structr.ai/Structr.ai-clone/structr-ai/client/src/components/leads/LeadModal.tsx#17-269) (create/edit)
- [x] 5.3 Add Lead detail view (notes, activities, conversion button)
- [x] 5.4 Update navigation sidebar to include "Leads" routelink

## Phase 6: Release & Verification
- [x] 6.1 `npm run check`
- [x] 6.2 `npm run test`
- [x] 6.3 Update [walkthrough.md](file:///Users/wsilva/.gemini/antigravity/brain/54a3d1c4-b0b7-4bbb-9360-51247ae534d4/walkthrough.md) with final summaryint 24
