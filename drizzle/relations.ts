import { relations } from "drizzle-orm";
import {
  tenants,
  profiles,
  projectMembers,
  roles,
  permissions,
  rolePermissions,
  clients,
  projects,
  estimates,
  estimateItems,
  scopeDrafts,
  scopeDraftItems,
  bundles,
  bundleItems,
  leads,
  leadActivities,
  deals,
  dealActivities,
  dealStageHistory,
  // PHASE 3 — field execution, real cost, subcontractors, closeout
  subcontractors,
  fieldTasks,
  fieldTaskEvents,
  projectCostActuals,
  dailyLogs,
  projectCloseouts,
  estimateDrafts,
  costCodes,
  assemblies,
  projectFiles,
  historicalEstimateSources,
  historicalEstimateSourceLines,
  historicalEstimateImports,
  historicalEstimateImportLines,
} from "./schema";

// PHASE 1: tenant is the root of every operational aggregate
export const tenantsRelations = relations(tenants, ({ many }) => ({
  profiles: many(profiles),
  projects: many(projects),
  clients: many(clients),
  leads: many(leads),
  deals: many(deals),
  estimates: many(estimates),
  historicalSources: many(historicalEstimateSources),
  historicalImports: many(historicalEstimateImports),
}));

// profiles (aliased as users) — role is a text field, resolved via roles.name
export const profilesRelations = relations(profiles, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [profiles.tenantId],
    references: [tenants.id],
  }),
  ownedLeads: many(leads),
  historicalSourcesRecorded: many(historicalEstimateSources),
  historicalImportsRecorded: many(historicalEstimateImports),
  projectMemberships: many(projectMembers),
}));

// PHASE 1: project membership drives requireProjectAccess()
export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(profiles, {
    fields: [projectMembers.userId],
    references: [profiles.id],
  }),
  tenant: one(tenants, {
    fields: [projectMembers.tenantId],
    references: [tenants.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [clients.tenantId],
    references: [tenants.id],
  }),
  projects: many(projects),
  historicalSources: many(historicalEstimateSources),
  historicalImports: many(historicalEstimateImports),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [projects.tenantId],
    references: [tenants.id],
  }),
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  owner: one(profiles, {
    fields: [projects.ownerUserId],
    references: [profiles.id],
  }),
  lead: one(leads, {
    fields: [projects.leadId],
    references: [leads.id],
  }),
  members: many(projectMembers),
  estimates: many(estimates),
  scopeDrafts: many(scopeDrafts),
  historicalSources: many(historicalEstimateSources),
  historicalImports: many(historicalEstimateImports),
}));

export const estimatesRelations = relations(estimates, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [estimates.tenantId],
    references: [tenants.id],
  }),
  project: one(projects, {
    fields: [estimates.projectId],
    references: [projects.id],
  }),
  lineItems: many(estimateItems),
}));

export const estimateItemsRelations = relations(estimateItems, () => ({
  // estimateItems.projectId exists but no estimateId FK — linked via projectId
}));

export const scopeDraftsRelations = relations(scopeDrafts, ({ one, many }) => ({
  project: one(projects, {
    fields: [scopeDrafts.projectId],
    references: [projects.id],
  }),
  items: many(scopeDraftItems),
}));

export const scopeDraftItemsRelations = relations(scopeDraftItems, ({ one }) => ({
  scopeDraft: one(scopeDrafts, {
    fields: [scopeDraftItems.scopeDraftId],
    references: [scopeDrafts.id],
  }),
}));

export const bundlesRelations = relations(bundles, ({ many }) => ({
  items: many(bundleItems),
}));

export const bundleItemsRelations = relations(bundleItems, ({ one }) => ({
  bundle: one(bundles, {
    fields: [bundleItems.bundleId],
    references: [bundles.id],
  }),
}));

// leads — has ownerUserId, NOT assignedTo
export const leadsRelations = relations(leads, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [leads.tenantId],
    references: [tenants.id],
  }),
  owner: one(profiles, {
    fields: [leads.ownerUserId],
    references: [profiles.id],
  }),
  activities: many(leadActivities),
}));

// leadActivities — no performedBy column
export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, {
    fields: [leadActivities.leadId],
    references: [leads.id],
  }),
}));

// deals — only has leadId as FK; no clientId, projectId, assignedTo, estimateId
export const dealsRelations = relations(deals, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [deals.tenantId],
    references: [tenants.id],
  }),
  lead: one(leads, {
    fields: [deals.leadId],
    references: [leads.id],
  }),
  activities: many(dealActivities),
  stageHistory: many(dealStageHistory),
}));

// dealActivities — no performedBy column
export const dealActivitiesRelations = relations(dealActivities, ({ one }) => ({
  deal: one(deals, {
    fields: [dealActivities.dealId],
    references: [deals.id],
  }),
}));

// dealStageHistory — no changedBy column
export const dealStageHistoryRelations = relations(dealStageHistory, ({ one }) => ({
  deal: one(deals, {
    fields: [dealStageHistory.dealId],
    references: [deals.id],
  }),
}));

// ══════════════════════════════════════════════════════════════════════
// PHASE 3 — field execution, real cost, subcontractors, closeout
// Every relation below mirrors an FK declared in drizzle/schema.ts and created by
// drizzle/0003_phase3_field_actuals.sql.
// ══════════════════════════════════════════════════════════════════════

export const subcontractorsRelations = relations(subcontractors, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [subcontractors.tenantId],
    references: [tenants.id],
  }),
  fieldTasks: many(fieldTasks),
  actuals: many(projectCostActuals),
}));

export const fieldTasksRelations = relations(fieldTasks, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [fieldTasks.tenantId],
    references: [tenants.id],
  }),
  project: one(projects, {
    fields: [fieldTasks.projectId],
    references: [projects.id],
  }),
  budgetEstimate: one(estimateDrafts, {
    fields: [fieldTasks.budgetEstimateDraftId],
    references: [estimateDrafts.id],
    relationName: "fieldTaskBudgetEstimate",
  }),
  changeOrder: one(estimateDrafts, {
    fields: [fieldTasks.changeOrderId],
    references: [estimateDrafts.id],
    relationName: "fieldTaskChangeOrder",
  }),
  subcontractor: one(subcontractors, {
    fields: [fieldTasks.subcontractorId],
    references: [subcontractors.id],
  }),
  costCode: one(costCodes, {
    fields: [fieldTasks.costCodeId],
    references: [costCodes.id],
  }),
  assembly: one(assemblies, {
    fields: [fieldTasks.assemblyId],
    references: [assemblies.id],
  }),
  estimateItem: one(estimateItems, {
    fields: [fieldTasks.estimateItemId],
    references: [estimateItems.id],
  }),
  actuals: many(projectCostActuals),
  events: many(fieldTaskEvents),
}));

export const fieldTaskEventsRelations = relations(fieldTaskEvents, ({ one }) => ({
  task: one(fieldTasks, {
    fields: [fieldTaskEvents.fieldTaskId],
    references: [fieldTasks.id],
  }),
  project: one(projects, {
    fields: [fieldTaskEvents.projectId],
    references: [projects.id],
  }),
}));

export const projectCostActualsRelations = relations(projectCostActuals, ({ one }) => ({
  tenant: one(tenants, {
    fields: [projectCostActuals.tenantId],
    references: [tenants.id],
  }),
  project: one(projects, {
    fields: [projectCostActuals.projectId],
    references: [projects.id],
  }),
  budgetEstimate: one(estimateDrafts, {
    fields: [projectCostActuals.budgetEstimateDraftId],
    references: [estimateDrafts.id],
    relationName: "actualBudgetEstimate",
  }),
  changeOrder: one(estimateDrafts, {
    fields: [projectCostActuals.changeOrderId],
    references: [estimateDrafts.id],
    relationName: "actualChangeOrder",
  }),
  fieldTask: one(fieldTasks, {
    fields: [projectCostActuals.fieldTaskId],
    references: [fieldTasks.id],
  }),
  subcontractor: one(subcontractors, {
    fields: [projectCostActuals.subcontractorId],
    references: [subcontractors.id],
  }),
  costCode: one(costCodes, {
    fields: [projectCostActuals.costCodeId],
    references: [costCodes.id],
  }),
  assembly: one(assemblies, {
    fields: [projectCostActuals.assemblyId],
    references: [assemblies.id],
  }),
  estimateItem: one(estimateItems, {
    fields: [projectCostActuals.estimateItemId],
    references: [estimateItems.id],
  }),
}));

export const dailyLogsRelations = relations(dailyLogs, ({ one }) => ({
  tenant: one(tenants, {
    fields: [dailyLogs.tenantId],
    references: [tenants.id],
  }),
  project: one(projects, {
    fields: [dailyLogs.projectId],
    references: [projects.id],
  }),
}));

export const projectCloseoutsRelations = relations(projectCloseouts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [projectCloseouts.tenantId],
    references: [tenants.id],
  }),
  project: one(projects, {
    fields: [projectCloseouts.projectId],
    references: [projects.id],
  }),
  budgetEstimate: one(estimateDrafts, {
    fields: [projectCloseouts.budgetEstimateDraftId],
    references: [estimateDrafts.id],
  }),
}));

// H1: every evidence FK names its full tenant/resource identity.
export const historicalEstimateSourcesRelations = relations(historicalEstimateSources, ({ one, many }) => ({
  tenant: one(tenants, { fields: [historicalEstimateSources.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [historicalEstimateSources.tenantId, historicalEstimateSources.projectId, historicalEstimateSources.clientId], references: [projects.tenantId, projects.id, projects.clientId] }),
  client: one(clients, { fields: [historicalEstimateSources.tenantId, historicalEstimateSources.clientId], references: [clients.tenantId, clients.id] }),
  recordedBy: one(profiles, { fields: [historicalEstimateSources.tenantId, historicalEstimateSources.recordedBy], references: [profiles.tenantId, profiles.id] }),
  sourceFile: one(projectFiles, { fields: [historicalEstimateSources.tenantId, historicalEstimateSources.projectId, historicalEstimateSources.sourceFileId], references: [projectFiles.tenantId, projectFiles.projectId, projectFiles.id] }),
  lines: many(historicalEstimateSourceLines), imports: many(historicalEstimateImports),
}));
export const historicalEstimateSourceLinesRelations = relations(historicalEstimateSourceLines, ({ one, many }) => ({
  source: one(historicalEstimateSources, { fields: [historicalEstimateSourceLines.tenantId, historicalEstimateSourceLines.sourceId], references: [historicalEstimateSources.tenantId, historicalEstimateSources.id] }),
  selections: many(historicalEstimateImportLines),
}));
export const historicalEstimateImportsRelations = relations(historicalEstimateImports, ({ one, many }) => ({
  tenant: one(tenants, { fields: [historicalEstimateImports.tenantId], references: [tenants.id] }),
  project: one(projects, { fields: [historicalEstimateImports.tenantId, historicalEstimateImports.projectId, historicalEstimateImports.clientId], references: [projects.tenantId, projects.id, projects.clientId] }),
  client: one(clients, { fields: [historicalEstimateImports.tenantId, historicalEstimateImports.clientId], references: [clients.tenantId, clients.id] }),
  recordedBy: one(profiles, { fields: [historicalEstimateImports.tenantId, historicalEstimateImports.recordedBy], references: [profiles.tenantId, profiles.id] }),
  source: one(historicalEstimateSources, { fields: [historicalEstimateImports.tenantId, historicalEstimateImports.projectId, historicalEstimateImports.clientId, historicalEstimateImports.sourceId], references: [historicalEstimateSources.tenantId, historicalEstimateSources.projectId, historicalEstimateSources.clientId, historicalEstimateSources.id] }),
  draft: one(estimateDrafts, { fields: [historicalEstimateImports.tenantId, historicalEstimateImports.projectId, historicalEstimateImports.clientId, historicalEstimateImports.estimateDraftId], references: [estimateDrafts.tenantId, estimateDrafts.projectId, estimateDrafts.clientId, estimateDrafts.id] }),
  priorImport: one(historicalEstimateImports, { fields: [historicalEstimateImports.tenantId, historicalEstimateImports.projectId, historicalEstimateImports.clientId, historicalEstimateImports.priorImportId], references: [historicalEstimateImports.tenantId, historicalEstimateImports.projectId, historicalEstimateImports.clientId, historicalEstimateImports.id], relationName: "historicalRevisionChain" }),
  followingImports: many(historicalEstimateImports, { relationName: "historicalRevisionChain" }),
  lines: many(historicalEstimateImportLines),
}));
export const historicalEstimateImportLinesRelations = relations(historicalEstimateImportLines, ({ one }) => ({
  historicalImport: one(historicalEstimateImports, { fields: [historicalEstimateImportLines.tenantId, historicalEstimateImportLines.importId, historicalEstimateImportLines.sourceId], references: [historicalEstimateImports.tenantId, historicalEstimateImports.id, historicalEstimateImports.sourceId] }),
  sourceLine: one(historicalEstimateSourceLines, { fields: [historicalEstimateImportLines.tenantId, historicalEstimateImportLines.sourceId, historicalEstimateImportLines.sourceLineId], references: [historicalEstimateSourceLines.tenantId, historicalEstimateSourceLines.sourceId, historicalEstimateSourceLines.id] }),
}));
export const projectFilesHistoricalRelations = relations(projectFiles, ({ many }) => ({ historicalSources: many(historicalEstimateSources) }));
export const estimateDraftsHistoricalRelations = relations(estimateDrafts, ({ many }) => ({ historicalImports: many(historicalEstimateImports) }));
