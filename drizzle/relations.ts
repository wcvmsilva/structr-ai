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
