import { relations } from "drizzle-orm";
import {
  profiles,
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
} from "./schema";

// profiles (aliased as users) — no roleId column exists
export const profilesRelations = relations(profiles, ({ many }) => ({
  ownedLeads: many(leads),
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

export const clientsRelations = relations(clients, () => ({
  // projects.clientId doesn't exist yet — wire up after schema migration
}));

// projects — no clientId column exists in schema
export const projectsRelations = relations(projects, ({ one, many }) => ({
  lead: one(leads, {
    fields: [projects.leadId],
    references: [leads.id],
  }),
  estimates: many(estimates),
  scopeDrafts: many(scopeDrafts),
}));

export const estimatesRelations = relations(estimates, ({ one, many }) => ({
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
