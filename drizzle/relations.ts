import { relations } from "drizzle-orm";
import {
  users,
  roles,
  permissions,
  rolePermissions,
  clients,
  projects,
  estimates,
  estimateLineItems,
  scopeDrafts,
  scopeDraftItems,
  bundles,
  bundleItems,
  leads,
  leadActivities,
  deals,
  dealActivities,
  dealStageHistory,
  estimateDrafts,
} from "./schema";

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
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

export const clientsRelations = relations(clients, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  estimates: many(estimates),
  scopeDrafts: many(scopeDrafts),
}));

export const estimatesRelations = relations(estimates, ({ one, many }) => ({
  project: one(projects, {
    fields: [estimates.projectId],
    references: [projects.id],
  }),
  lineItems: many(estimateLineItems),
}));

export const estimateLineItemsRelations = relations(estimateLineItems, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimateLineItems.estimateId],
    references: [estimates.id],
  }),
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

export const leadsRelations = relations(leads, ({ one, many }) => ({
  assignedToUser: one(users, {
    fields: [leads.assignedTo],
    references: [users.id],
  }),
  activities: many(leadActivities),
}));

export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, {
    fields: [leadActivities.leadId],
    references: [leads.id],
  }),
  performedByUser: one(users, {
    fields: [leadActivities.performedBy],
    references: [users.id],
  }),
}));

export const dealsRelations = relations(deals, ({ one, many }) => ({
  lead: one(leads, {
    fields: [deals.leadId],
    references: [leads.id],
  }),
  client: one(clients, {
    fields: [deals.clientId],
    references: [clients.id],
  }),
  project: one(projects, {
    fields: [deals.projectId],
    references: [projects.id],
  }),
  assignedToUser: one(users, {
    fields: [deals.assignedTo],
    references: [users.id],
  }),
  estimate: one(estimateDrafts, {
    fields: [deals.estimateId],
    references: [estimateDrafts.id],
  }),
  activities: many(dealActivities),
  stageHistory: many(dealStageHistory),
}));

export const dealActivitiesRelations = relations(dealActivities, ({ one }) => ({
  deal: one(deals, {
    fields: [dealActivities.dealId],
    references: [deals.id],
  }),
  performedByUser: one(users, {
    fields: [dealActivities.performedBy],
    references: [users.id],
  }),
}));

export const dealStageHistoryRelations = relations(dealStageHistory, ({ one }) => ({
  deal: one(deals, {
    fields: [dealStageHistory.dealId],
    references: [deals.id],
  }),
  changedByUser: one(users, {
    fields: [dealStageHistory.changedBy],
    references: [users.id],
  }),
}));
