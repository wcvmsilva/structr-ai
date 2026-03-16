import {
  boolean,
  decimal,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  char,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ══════════════════════════════════════════════════════════════════════
// RBAC — Roles, Permissions, Role-Permissions
// ══════════════════════════════════════════════════════════════════════

export const roles = mysqlTable("roles", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 50 }).notNull().unique(),
  description: varchar("description", { length: 255 }),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Role = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;

export const permissions = mysqlTable("permissions", {
  id: int("id").autoincrement().primaryKey(),
  resource: varchar("resource", { length: 80 }).notNull(),
  action: varchar("action", { length: 30 }).notNull(),
  description: varchar("description", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_perm_resource").on(t.resource),
]);

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = typeof permissions.$inferInsert;

export const rolePermissions = mysqlTable("role_permissions", {
  id: int("id").autoincrement().primaryKey(),
  roleId: int("role_id").notNull(),
  permissionId: int("permission_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_rp_role").on(t.roleId),
  index("idx_rp_permission").on(t.permissionId),
]);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = typeof rolePermissions.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// USERS (existing — extended with RBAC fields)
// ══════════════════════════════════════════════════════════════════════

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  uuid: char("uuid", { length: 36 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "estimator", "reviewer"])
    .default("user")
    .notNull(),
  roleId: int("role_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  index("idx_users_role_id").on(t.roleId),
  index("idx_users_active").on(t.isActive),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ══════════════════════════════════════════════════════════════════════

export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id"),
  action: varchar("action", { length: 80 }).notNull(),
  tableName: varchar("table_name", { length: 80 }).notNull(),
  recordId: int("record_id"),
  before: json("before_snapshot"),
  after: json("after_snapshot"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 512 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_audit_user").on(t.userId),
  index("idx_audit_table").on(t.tableName),
  index("idx_audit_action").on(t.action),
  index("idx_audit_created").on(t.createdAt),
]);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// PRICE BOOK ITEMS (industrial-grade version of catalog_items)
// ══════════════════════════════════════════════════════════════════════

export const priceBookItems = mysqlTable("price_book_items", {
  id: int("id").autoincrement().primaryKey(),
  uuid: char("uuid", { length: 36 }).notNull().unique(),
  sku: varchar("sku", { length: 80 }).notNull().unique(),
  category: varchar("category", { length: 100 }).notNull(),
  subcategory: varchar("subcategory", { length: 100 }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  unitOfMeasure: varchar("unit_of_measure", { length: 30 }).notNull(),
  unitCost: decimal("unit_cost", { precision: 10, scale: 4 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 4 }).notNull(),
  isAdminFee: boolean("is_admin_fee").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastCostUpdatedAt: timestamp("last_cost_updated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deleted_at"),
  // Pricing Dimensions (Sprint 6 — Master Pricing Architecture)
  itemType: mysqlEnum("item_type", ["material", "labor", "subcontract", "permit_fee", "equipment", "allowance"])
    .default("material"),
  trade: varchar("trade", { length: 80 }),
  finishLevel: mysqlEnum("finish_level", ["standard", "premium", "luxury"])
    .default("standard"),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial"])
    .default("direct"),
  region: varchar("region", { length: 80 }).default("charleston_metro"),
  wasteFactor: decimal("waste_factor", { precision: 6, scale: 4 }).default("1.0000"),
  coastalModifier: decimal("coastal_modifier", { precision: 6, scale: 4 }).default("1.0000"),
  channelMultiplier: decimal("channel_multiplier", { precision: 6, scale: 4 }).default("1.0000"),
  source: varchar("source", { length: 80 }).default("jobtread_csv"),
  effectiveDate: timestamp("effective_date"),
  // Columns preserved from catalog_items for backward compatibility
  costCode: varchar("cost_code", { length: 16 }),
  costType: varchar("cost_type", { length: 64 }),
  taxable: boolean("taxable").default(true),
}, (t) => [
  index("idx_pbi_category").on(t.category),
  index("idx_pbi_active").on(t.isActive),
  index("idx_pbi_sku").on(t.sku),
  index("idx_pbi_trade").on(t.trade),
  index("idx_pbi_item_type").on(t.itemType),
  index("idx_pbi_finish").on(t.finishLevel),
  index("idx_pbi_channel").on(t.channel),
]);

export type PriceBookItem = typeof priceBookItems.$inferSelect;
export type InsertPriceBookItem = typeof priceBookItems.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// PRICE BOOK HISTORY (audit trail for price changes)
// ══════════════════════════════════════════════════════════════════════

export const priceBookHistory = mysqlTable("price_book_history", {
  id: int("id").autoincrement().primaryKey(),
  priceBookItemId: int("price_book_item_id").notNull(),
  oldUnitCost: decimal("old_unit_cost", { precision: 10, scale: 4 }).notNull(),
  newUnitCost: decimal("new_unit_cost", { precision: 10, scale: 4 }).notNull(),
  oldUnitPrice: decimal("old_unit_price", { precision: 10, scale: 4 }).notNull(),
  newUnitPrice: decimal("new_unit_price", { precision: 10, scale: 4 }).notNull(),
  changedBy: int("changed_by"),
  reason: varchar("reason", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_pbh_item").on(t.priceBookItemId),
  index("idx_pbh_created").on(t.createdAt),
]);

export type PriceBookHistoryEntry = typeof priceBookHistory.$inferSelect;
export type InsertPriceBookHistoryEntry = typeof priceBookHistory.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════════════════

export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  uuid: char("uuid", { length: 36 }).notNull().unique(),
  firstName: varchar("first_name", { length: 80 }).notNull(),
  lastName: varchar("last_name", { length: 80 }).notNull(),
  companyName: varchar("company_name", { length: 160 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 30 }),
  // Legacy single address field (kept for backward compatibility)
  address: text("address"),
  city: varchar("city", { length: 128 }).default("Charleston"),
  state: varchar("state", { length: 2 }).default("SC"),
  zip: varchar("zip", { length: 10 }),
  county: varchar("county", { length: 128 }),
  // ── Sprint 10: Atomic billing address ──
  billingAddressLine1: varchar("billing_address_line1", { length: 255 }),
  billingAddressLine2: varchar("billing_address_line2", { length: 255 }),
  billingCity: varchar("billing_city", { length: 128 }),
  billingState: varchar("billing_state", { length: 2 }),
  billingZip: varchar("billing_zip", { length: 10 }),
  // ── Sprint 10: Atomic shipping address ──
  shippingAddressLine1: varchar("shipping_address_line1", { length: 255 }),
  shippingAddressLine2: varchar("shipping_address_line2", { length: 255 }),
  shippingCity: varchar("shipping_city", { length: 128 }),
  shippingState: varchar("shipping_state", { length: 2 }),
  shippingZip: varchar("shipping_zip", { length: 10 }),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial", "residential"])
    .default("direct")
    .notNull(),
  source: varchar("source", { length: 100 }),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: int("created_by"),
  updatedBy: int("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  index("idx_clients_email").on(t.email),
  index("idx_clients_channel").on(t.channel),
  index("idx_clients_active").on(t.isActive),
]);

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// PROJECTS (existing — extended with client_id and industrial fields)
// ══════════════════════════════════════════════════════════════════════

export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  uuid: char("uuid", { length: 36 }),
  name: varchar("name", { length: 255 }).notNull(),
  clientId: int("client_id"),
  // Legacy inline client fields — kept for backward compatibility
  clientName: varchar("clientName", { length: 255 }),
  clientEmail: varchar("clientEmail", { length: 320 }),
  clientPhone: varchar("clientPhone", { length: 32 }),
  address: text("address"),
  city: varchar("city", { length: 128 }).default("Charleston"),
  county: varchar("county", { length: 128 }),
  // ── Sprint 10: Additional location fields ──
  state: varchar("state", { length: 2 }).default("SC"),
  zipCode: varchar("zip_code", { length: 10 }),
  region: varchar("region", { length: 80 }),
  zone: varchar("zone", { length: 80 }),
  // ── Sprint 10: Project type ──
  projectType: mysqlEnum("project_type", [
    "remodel", "new_construction", "repair", "insurance_restoration",
    "commercial_buildout", "addition", "exterior"
  ]).default("remodel"),
  status: mysqlEnum("status", [
    "intake",
    "estimating",
    "review",
    "approved",
    "in_progress",
    "completed",
    "cancelled",
  ])
    .default("intake")
    .notNull(),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial", "residential"])
    .default("direct")
    .notNull(),
  estimatedValue: decimal("estimatedValue", { precision: 12, scale: 2 }),
  actualCost: decimal("actualCost", { precision: 12, scale: 2 }),
  grossProfit: decimal("grossProfit", { precision: 5, scale: 2 }),
  profitShieldMinPct: decimal("profit_shield_min_pct", { precision: 5, scale: 2 }).default("35.00"),
  notes: text("notes"),
  metadata: json("metadata"),
  createdBy: int("createdBy"),
  updatedBy: int("updated_by"),
  assignedTo: int("assignedTo"),
  // ── Sprint 11: Geographic Intelligence ──
  zoneModifierSnapshot: json("zone_modifier_snapshot").$type<ZoneModifierSnapshot>(),
  // ── Sprint 15: Geocoding Integration ──
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  geocodeConfidence: mysqlEnum("geocode_confidence", ["high", "medium", "low", "failed", "pending"]).default("pending"),
  geocodeSource: varchar("geocode_source", { length: 32 }),  // 'google_maps' | 'manual' | 'zip_centroid'
  geocodedAddress: text("geocoded_address"),  // formatted address returned by geocoder
  geocodedAt: timestamp("geocoded_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  index("idx_projects_status").on(t.status),
  index("idx_projects_channel").on(t.channel),
  index("idx_projects_client").on(t.clientId),
  index("idx_projects_region").on(t.region),
  index("idx_projects_type").on(t.projectType),
  index("idx_projects_geocode_confidence").on(t.geocodeConfidence),
]);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// PROJECT FILES (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const projectFiles = mysqlTable("project_files", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  fileType: varchar("fileType", { length: 64 }),
  mimeType: varchar("mimeType", { length: 128 }),
  sizeBytes: int("sizeBytes"),
  uploadedBy: int("uploadedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectFile = typeof projectFiles.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// ASSEMBLIES (Sprint 7 — extended with remodel scope fields)
// ══════════════════════════════════════════════════════════════════════

export const assemblies = mysqlTable("assemblies", {
  id: int("id").autoincrement().primaryKey(),
  uuid: char("uuid", { length: 36 }),
  supabaseId: varchar("supabaseId", { length: 64 }),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 32 }).notNull(),
  trade: varchar("trade", { length: 80 }),
  category: varchar("category", { length: 128 }),
  subcategory: varchar("subcategory", { length: 128 }),
  description: text("description"),
  defaultUnit: varchar("defaultUnit", { length: 16 }).default("EA"),
  unitOfMeasure: varchar("unit_of_measure", { length: 30 }),
  directCost: decimal("directCost", { precision: 12, scale: 2 }).notNull(),
  sellPrice: decimal("sellPrice", { precision: 12, scale: 2 }).notNull(),
  crewHours: decimal("crewHours", { precision: 8, scale: 2 }).default("0"),
  itemCount: int("itemCount").default(0),
  grossProfitPct: decimal("grossProfitPct", { precision: 5, scale: 2 }),
  assemblyType: mysqlEnum("assembly_type", ["scope", "system", "package", "parametric"])
    .default("scope")
    .notNull(),
  // Sprint 7 — Remodel scope fields
  finishLevel: mysqlEnum("finish_level", ["standard", "premium", "luxury"])
    .default("standard"),
  region: varchar("region", { length: 80 }).default("charleston_metro"),
  coastalModifier: decimal("coastal_modifier", { precision: 6, scale: 4 }).default("1.0000"),
  tradeSequenceOrder: int("trade_sequence_order").default(100),
  inclusions: text("inclusions"),
  exclusions: text("exclusions"),
  hiddenConditionFlag: boolean("hidden_condition_flag").default(false),
  parentAssemblyId: int("parent_assembly_id"),
  isPreset: boolean("is_preset").default(false),
  version: int("version").default(1),
  isActive: boolean("isActive").default(true).notNull(),
  conditionRules: json("conditionRules"),
  notes: text("notes"),
  createdBy: int("created_by"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  index("idx_assemblies_trade").on(t.trade),
  index("idx_assemblies_category").on(t.category),
  index("idx_assemblies_active").on(t.isActive),
  index("idx_assemblies_parent").on(t.parentAssemblyId),
  index("idx_assemblies_finish").on(t.finishLevel),
  index("idx_assemblies_type").on(t.assemblyType),
]);

export type Assembly = typeof assemblies.$inferSelect;
export type InsertAssembly = typeof assemblies.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// ASSEMBLY COMPONENTS (Sprint 7 — BOM with component_type)
// ══════════════════════════════════════════════════════════════════════

export const assemblyComponents = mysqlTable("assembly_components", {
  id: int("id").autoincrement().primaryKey(),
  assemblyId: int("assembly_id").notNull(),
  priceBookItemId: int("price_book_item_id"),
  catalogItemId: int("catalog_item_id"),
  componentType: mysqlEnum("component_type", ["material", "labor", "subcontract", "equipment", "permit", "admin"])
    .default("material"),
  description: varchar("description", { length: 255 }),
  quantity: decimal("quantity", { precision: 10, scale: 4 }).default("1.0000").notNull(),
  unit: varchar("unit", { length: 30 }),
  wasteFactorPct: decimal("waste_factor_pct", { precision: 5, scale: 2 }).default("0.00"),
  unitCostOverride: decimal("unit_cost_override", { precision: 10, scale: 4 }),
  notes: text("notes"),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_ac_assembly").on(t.assemblyId),
  index("idx_ac_pbi").on(t.priceBookItemId),
  index("idx_ac_catalog").on(t.catalogItemId),
  index("idx_ac_type").on(t.componentType),
]);

export type AssemblyComponent = typeof assemblyComponents.$inferSelect;
export type InsertAssemblyComponent = typeof assemblyComponents.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// BUNDLES (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const bundles = mysqlTable("bundles", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial", "residential"])
    .default("direct"),
  defaultDiscount: decimal("defaultDiscount", { precision: 5, scale: 2 }).default("8.00"),
  minGrossProfit: decimal("minGrossProfit", { precision: 5, scale: 2 }).default("35.00"),
  totalCost: decimal("totalCost", { precision: 14, scale: 2 }).default("0.00"),
  totalPrice: decimal("totalPrice", { precision: 14, scale: 2 }).default("0.00"),
  itemCount: int("itemCount").default(0),
  isPreset: boolean("isPreset").default(false),
  presetCategory: varchar("presetCategory", { length: 128 }),
  presetTags: json("presetTags").$type<string[]>(),
  isActive: boolean("isActive").default(true).notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_bundles_preset").on(t.isPreset),
  index("idx_bundles_active").on(t.isActive),
  index("idx_bundles_created_by").on(t.createdBy),
]);

export type Bundle = typeof bundles.$inferSelect;
export type InsertBundle = typeof bundles.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// BUNDLE ITEMS (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const bundleItems = mysqlTable("bundle_items", {
  id: int("id").autoincrement().primaryKey(),
  bundleId: int("bundleId").notNull(),
  catalogItemId: int("catalogItemId").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).default("1").notNull(),
  unitCostSnapshot: decimal("unitCostSnapshot", { precision: 12, scale: 2 }).notNull(),
  unitPriceSnapshot: decimal("unitPriceSnapshot", { precision: 12, scale: 2 }).notNull(),
  lineTotalCost: decimal("lineTotalCost", { precision: 14, scale: 2 }).notNull(),
  lineTotalPrice: decimal("lineTotalPrice", { precision: 14, scale: 2 }).notNull(),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (t) => [
  index("idx_bi_bundle").on(t.bundleId, t.sortOrder),
  index("idx_bi_catalog").on(t.catalogItemId),
]);

export type BundleItem = typeof bundleItems.$inferSelect;
export type InsertBundleItem = typeof bundleItems.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// ESTIMATES (industrial-grade — formal estimates with versioning)
// ══════════════════════════════════════════════════════════════════════

export const estimates = mysqlTable("estimates", {
  id: int("id").autoincrement().primaryKey(),
  uuid: char("uuid", { length: 36 }).notNull().unique(),
  projectId: int("project_id"),
  clientId: int("client_id"),
  estimateDraftId: int("estimate_draft_id"),
  version: int("version").default(1).notNull(),
  status: mysqlEnum("status", ["draft", "pending_review", "approved", "sent", "accepted", "rejected", "expired"])
    .default("draft")
    .notNull(),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial", "residential"])
    .default("direct"),
  subtotalCost: decimal("subtotal_cost", { precision: 14, scale: 2 }).notNull(),
  subtotalPrice: decimal("subtotal_price", { precision: 14, scale: 2 }).notNull(),
  grossProfit: decimal("gross_profit", { precision: 14, scale: 2 }).notNull(),
  grossProfitPct: decimal("gross_profit_pct", { precision: 5, scale: 2 }).notNull(),
  discountPct: decimal("discount_pct", { precision: 5, scale: 2 }).default("0.00"),
  discountAmount: decimal("discount_amount", { precision: 14, scale: 2 }).default("0.00"),
  taxAmount: decimal("tax_amount", { precision: 14, scale: 2 }).default("0.00"),
  finalTotal: decimal("final_total", { precision: 14, scale: 2 }).notNull(),
  profitShieldMinPct: decimal("profit_shield_min_pct", { precision: 5, scale: 2 }).default("35.00"),
  validUntil: timestamp("valid_until"),
  notes: text("notes"),
  internalNotes: text("internal_notes"),
  metadata: json("metadata"),
  createdBy: int("created_by"),
  approvedBy: int("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  index("idx_estimates_project").on(t.projectId),
  index("idx_estimates_client").on(t.clientId),
  index("idx_estimates_status").on(t.status),
  index("idx_estimates_draft").on(t.estimateDraftId),
]);

export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = typeof estimates.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// ESTIMATE LINE ITEMS (normalized from JSON)
// ══════════════════════════════════════════════════════════════════════

export const estimateLineItems = mysqlTable("estimate_line_items", {
  id: int("id").autoincrement().primaryKey(),
  estimateId: int("estimate_id").notNull(),
  priceBookItemId: int("price_book_item_id"),
  catalogItemId: int("catalog_item_id"),
  costGroupName: varchar("cost_group_name", { length: 255 }).notNull(),
  costItemName: varchar("cost_item_name", { length: 512 }).notNull(),
  description: text("description"),
  unit: varchar("unit", { length: 32 }).notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).default("1").notNull(),
  unitCost: decimal("unit_cost", { precision: 12, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 12, scale: 2 }).notNull(),
  lineTotalCost: decimal("line_total_cost", { precision: 14, scale: 2 }).notNull(),
  lineTotalPrice: decimal("line_total_price", { precision: 14, scale: 2 }).notNull(),
  grossProfitPct: decimal("gross_profit_pct", { precision: 5, scale: 2 }),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_eli_estimate").on(t.estimateId),
  index("idx_eli_pbi").on(t.priceBookItemId),
  index("idx_eli_catalog").on(t.catalogItemId),
]);

export type EstimateLineItem = typeof estimateLineItems.$inferSelect;
export type InsertEstimateLineItem = typeof estimateLineItems.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// ESTIMATE DRAFTS (Sprint 9 — extended: Assembly-based + legacy bundle bridge)
// ══════════════════════════════════════════════════════════════════════

/** Assembly selection stored as JSON in estimate_drafts.assemblySelections */
export interface EstimateDraftAssemblySelection {
  assemblyId: number;
  assemblyName: string;
  assemblyCode: string;
  category: string;
  trade: string | null;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  extendedCost: number;
  extendedPrice: number;
  grossProfitPct: number;
  componentCount: number;
  /** Sprint 19: Workflow stage code (e.g., "demo", "framing", "mechanical") */
  stage?: string | null;
  /** Sprint 19: Whether this assembly was added via override (geo, operator, etc.) */
  overrideFlag?: boolean;
  /** Sprint 19: Sort order for bundle consistency (respects workflow stage ordering) */
  sortOrder?: number;
}

export const estimateDrafts = mysqlTable("estimate_drafts", {
  id: int("id").autoincrement().primaryKey(),
  // Legacy bundle reference (nullable for assembly-based drafts)
  bundleId: int("bundleId"),
  bundleName: varchar("bundleName", { length: 255 }).notNull(),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial", "residential"])
    .default("direct"),
  lineItems: json("lineItems").$type<EstimateDraftLineItem[]>().notNull(),
  subtotalCost: decimal("subtotalCost", { precision: 14, scale: 2 }).notNull(),
  subtotalPrice: decimal("subtotalPrice", { precision: 14, scale: 2 }).notNull(),
  grossProfit: decimal("grossProfit", { precision: 14, scale: 2 }).notNull(),
  grossProfitPct: decimal("grossProfitPct", { precision: 5, scale: 2 }).notNull(),
  discountApplied: decimal("discountApplied", { precision: 5, scale: 2 }).default("0.00").notNull(),
  discountAmount: decimal("discountAmount", { precision: 14, scale: 2 }).default("0.00").notNull(),
  finalTotalPrice: decimal("finalTotalPrice", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  metadata: json("metadata"),
  status: mysqlEnum("status", ["draft", "sent_to_estimate", "converted", "archived", "approved", "rejected"])
    .default("draft")
    .notNull(),
  // Sprint 20: Quick Actions fields
  approvedBy: int("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectedBy: int("rejected_by"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  // ── Sprint 9 extensions ──
  region: varchar("region", { length: 80 }),
  finishLevel: mysqlEnum("finish_level", ["standard", "premium", "luxury"]).default("standard"),
  projectId: int("project_id"),
  clientId: int("client_id"),
  assemblySelections: json("assembly_selections").$type<EstimateDraftAssemblySelection[]>(),
  assemblyCount: int("assembly_count").default(0),
  profitShieldPassed: boolean("profit_shield_passed").default(false),
  profitShieldMinPct: decimal("profit_shield_min_pct", { precision: 5, scale: 2 }).default("35.00"),
  source: mysqlEnum("source", ["legacy_bundle", "assembly_calculator", "scope_draft"]).default("legacy_bundle"),
  // Sprint 18.5: Estimate versioning — tracks which pricing schema produced this estimate
  pricingSchemaVersion: varchar("pricing_schema_version", { length: 10 }).default("1.0"),
  // Sprint 19: Direct FK to scope_drafts for idempotency (unique per scope_draft)
  scopeDraftId: int("scope_draft_id"),
}, (t) => [
  index("idx_ed_status").on(t.status),
  index("idx_ed_bundle").on(t.bundleId),
  index("idx_ed_region").on(t.region),
  index("idx_ed_source").on(t.source),
  index("idx_ed_project").on(t.projectId),
  index("idx_ed_created_by").on(t.createdBy),
  uniqueIndex("idx_ed_scope_draft_unique").on(t.scopeDraftId),
]);

export type EstimateDraft = typeof estimateDrafts.$inferSelect;
export type InsertEstimateDraft = typeof estimateDrafts.$inferInsert;

/** Typed line item shape stored as JSON in estimate_drafts.lineItems */
export interface EstimateDraftLineItem {
  catalogItemId: number;
  costItemId: string | null;
  costGroupName: string;
  costItemName: string;
  description: string | null;
  unit: string;
  quantity: number;
  unitCostSnapshot: number;
  unitPriceSnapshot: number;
  lineTotalCost: number;
  lineTotalPrice: number;
  grossProfitPct: number;
  sortOrder: number;
  // ── Sprint 9 extensions ──
  assemblyId?: number;
  assemblyName?: string;
  componentType?: string;
  priceBookItemId?: number | null;
  wasteFactor?: number;
  adjustedUnitCost?: number;
}

// ══════════════════════════════════════════════════════════════════════
// INTAKE FORMS (AI-powered intake processing)
// ══════════════════════════════════════════════════════════════════════

export const intakeForms = mysqlTable("intake_forms", {
  id: int("id").autoincrement().primaryKey(),
  uuid: char("uuid", { length: 36 }).notNull().unique(),
  projectId: int("project_id"),
  clientId: int("client_id"),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial", "residential"])
    .default("direct"),
  // ── Sprint 10: Structured intake fields ──
  serviceType: varchar("service_type", { length: 128 }),
  area: varchar("area", { length: 255 }),
  finishLevel: mysqlEnum("finish_level", ["standard", "premium", "luxury"]).default("standard"),
  condition: varchar("condition", { length: 255 }),
  notes: text("notes"),
  rawPayload: json("raw_payload").notNull(),
  parsedScope: json("parsed_scope"),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 2 }),
  status: mysqlEnum("status", ["received", "parsing", "parsed", "reviewed", "converted"])
    .default("received")
    .notNull(),
  processedBy: int("processed_by"),
  createdBy: int("created_by"),
  updatedBy: int("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_intake_project").on(t.projectId),
  index("idx_intake_client").on(t.clientId),
  index("idx_intake_status").on(t.status),
  index("idx_intake_service").on(t.serviceType),
]);

export type IntakeForm = typeof intakeForms.$inferSelect;
export type InsertIntakeForm = typeof intakeForms.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// SCOPE SUGGESTIONS (AI-generated scope from intake)
// ══════════════════════════════════════════════════════════════════════

export const scopeSuggestions = mysqlTable("scope_suggestions", {
  id: int("id").autoincrement().primaryKey(),
  intakeFormId: int("intake_form_id").notNull(),
  assemblyId: int("assembly_id"),
  suggestedScope: text("suggested_scope").notNull(),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 2 }),
  estimatedCost: decimal("estimated_cost", { precision: 12, scale: 2 }),
  estimatedPrice: decimal("estimated_price", { precision: 12, scale: 2 }),
  status: mysqlEnum("status", ["pending", "accepted", "rejected", "modified"])
    .default("pending")
    .notNull(),
  reviewedBy: int("reviewed_by"),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ss_intake").on(t.intakeFormId),
  index("idx_ss_assembly").on(t.assemblyId),
  index("idx_ss_status").on(t.status),
]);

export type ScopeSuggestion = typeof scopeSuggestions.$inferSelect;
export type InsertScopeSuggestion = typeof scopeSuggestions.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// INTAKE QUESTIONS (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const intakeQuestions = mysqlTable("intake_questions", {
  id: int("id").autoincrement().primaryKey(),
  category: varchar("category", { length: 128 }).notNull(),
  question: text("question").notNull(),
  inputType: mysqlEnum("inputType", [
    "text",
    "number",
    "select",
    "multiselect",
    "boolean",
    "file",
  ])
    .default("text")
    .notNull(),
  options: json("options"),
  isRequired: boolean("isRequired").default(false),
  sortOrder: int("sortOrder").default(0),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type IntakeQuestion = typeof intakeQuestions.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// INTAKE RESPONSES (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const intakeResponses = mysqlTable("intake_responses", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  questionId: int("questionId").notNull(),
  answer: text("answer"),
  answeredBy: int("answeredBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type IntakeResponse = typeof intakeResponses.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// REVIEW ACTIONS (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const reviewActions = mysqlTable("review_actions", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  reviewerId: int("reviewerId").notNull(),
  action: mysqlEnum("action", ["approved", "rejected", "revision_requested"])
    .notNull(),
  comments: text("comments"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ReviewAction = typeof reviewActions.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// RISK RULES (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const riskRules = mysqlTable("risk_rules", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 128 }).notNull(),
  description: text("description"),
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"])
    .default("medium")
    .notNull(),
  condition: json("condition"),
  mitigation: text("mitigation"),
  costImpactPct: decimal("costImpactPct", { precision: 5, scale: 2 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RiskRule = typeof riskRules.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// BUILDING CODES (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const buildingCodes = mysqlTable("building_codes", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 64 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  jurisdiction: varchar("jurisdiction", { length: 128 }).notNull(),
  category: varchar("category", { length: 128 }),
  description: text("description"),
  requirements: json("requirements"),
  effectiveDate: timestamp("effectiveDate"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BuildingCode = typeof buildingCodes.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// CREWS (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const crews = mysqlTable("crews", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  specialty: varchar("specialty", { length: 128 }),
  size: int("size").default(2),
  hourlyRate: decimal("hourlyRate", { precision: 8, scale: 2 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Crew = typeof crews.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// CREW ASSIGNMENTS (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const crewAssignments = mysqlTable("crew_assignments", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  crewId: int("crewId").notNull(),
  assemblyId: int("assemblyId"),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  status: mysqlEnum("status", ["scheduled", "in_progress", "completed", "cancelled"])
    .default("scheduled")
    .notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CrewAssignment = typeof crewAssignments.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// PROJECT HISTORY (existing — unchanged, superseded by audit_logs)
// ══════════════════════════════════════════════════════════════════════

export const projectHistory = mysqlTable("project_history", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  eventType: mysqlEnum("eventType", [
    "status_change",
    "estimate_created",
    "estimate_updated",
    "review_action",
    "file_uploaded",
    "note_added",
    "cost_adjustment",
    "bundle_applied",
  ]).notNull(),
  description: text("description"),
  previousValue: json("previousValue"),
  newValue: json("newValue"),
  performedBy: int("performedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectHistoryEntry = typeof projectHistory.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// WORKFLOW RUNS (existing — unchanged)
// ══════════════════════════════════════════════════════════════════════

export const workflowRuns = mysqlTable("workflow_runs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId"),
  workflowType: varchar("workflowType", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"])
    .default("pending")
    .notNull(),
  input: json("input"),
  output: json("output"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  error: text("error"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WorkflowRun = typeof workflowRuns.$inferSelect;

// ══════════════════════════════════════════════════════════════════════
// REGIONAL MODIFIERS (Sprint 6 — Pricing Architecture)
// ══════════════════════════════════════════════════════════════════════

export const regionalModifiers = mysqlTable("regional_modifiers", {
  id: int("id").autoincrement().primaryKey(),
  regionCode: varchar("region_code", { length: 80 }).notNull().unique(),
  regionName: varchar("region_name", { length: 160 }).notNull(),
  costModifier: decimal("cost_modifier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  laborModifier: decimal("labor_modifier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  materialModifier: decimal("material_modifier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  permitModifier: decimal("permit_modifier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type RegionalModifier = typeof regionalModifiers.$inferSelect;
export type InsertRegionalModifier = typeof regionalModifiers.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// CHANNEL MULTIPLIERS (Sprint 6 — Pricing Architecture)
// ══════════════════════════════════════════════════════════════════════

export const channelMultipliers = mysqlTable("channel_multipliers", {
  id: int("id").autoincrement().primaryKey(),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial"]).notNull(),
  trade: varchar("trade", { length: 80 }),
  costMultiplier: decimal("cost_multiplier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  priceMultiplier: decimal("price_multiplier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cm_channel").on(t.channel),
  index("idx_cm_trade").on(t.trade),
]);

export type ChannelMultiplier = typeof channelMultipliers.$inferSelect;
export type InsertChannelMultiplier = typeof channelMultipliers.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// FINISH LEVELS (Sprint 6 — Pricing Architecture)
// ══════════════════════════════════════════════════════════════════════

export const finishLevels = mysqlTable("finish_levels", {
  id: int("id").autoincrement().primaryKey(),
  level: mysqlEnum("level", ["standard", "premium", "luxury"]).notNull(),
  trade: varchar("trade", { length: 80 }),
  priceMultiplier: decimal("price_multiplier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_fl_level").on(t.level),
  index("idx_fl_trade").on(t.trade),
]);

export type FinishLevel = typeof finishLevels.$inferSelect;
export type InsertFinishLevel = typeof finishLevels.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// PARAMETRIC MODELS (Sprint 6 — Pricing Architecture)
// ══════════════════════════════════════════════════════════════════════

export const parametricModels = mysqlTable("parametric_models", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  structureType: mysqlEnum("structure_type", ["adu", "one_story", "two_story", "two_story_terrace", "shell"]).notNull(),
  baseCostPerSqft: decimal("base_cost_per_sqft", { precision: 10, scale: 4 }).notNull(),
  basePricePerSqft: decimal("base_price_per_sqft", { precision: 10, scale: 4 }).notNull(),
  minSqft: int("min_sqft").default(400),
  maxSqft: int("max_sqft").default(5000),
  complexityMultiplier: decimal("complexity_multiplier", { precision: 6, scale: 4 }).default("1.0000"),
  defaultSystems: json("default_systems"),
  defaultOptions: json("default_options"),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_pm_type").on(t.structureType),
]);

export type ParametricModel = typeof parametricModels.$inferSelect;
export type InsertParametricModel = typeof parametricModels.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// REMODEL TEMPLATES (Sprint 6 → Sprint 13: Remodel Engine)
// ══════════════════════════════════════════════════════════════════════

/** Workflow step definition stored in workflow_steps JSON column */
export interface WorkflowStep {
  /** Step order (1-based) */
  order: number;
  /** Step code (e.g. "demo", "framing", "mechanical") */
  code: string;
  /** Human-readable label */
  label: string;
  /** Assembly IDs assigned to this step */
  assemblyIds: number[];
}

/** Required scope rule reference stored in required_scope_rules JSON column */
export interface RequiredScopeRuleRef {
  /** Rule code from scope_rules table */
  ruleCode: string;
  /** Whether this rule is mandatory (true) or recommended (false) */
  mandatory: boolean;
}

export const remodelTemplates = mysqlTable("remodel_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  serviceType: mysqlEnum("service_type", [
    "kitchen_remodel", "bathroom_remodel", "roofing",
    "siding", "windows_doors", "deck_porch",
    "painting", "flooring", "exterior",
    "full_remodel",
  ]).notNull(),
  finishLevel: mysqlEnum("finish_level", ["standard", "premium", "luxury"]),
  zone: varchar("zone", { length: 128 }),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial"]),
  description: text("description"),
  /** Scope rule codes that MUST be present in the ScopeDraft for this template to apply */
  requiredScopeRules: json("required_scope_rules").$type<RequiredScopeRuleRef[]>(),
  /** Assembly IDs always included when this template is applied */
  defaultAssemblies: json("default_assemblies").$type<number[]>(),
  /** Assembly IDs that can optionally be added */
  optionalAssemblies: json("optional_assemblies").$type<number[]>(),
  /** Ordered workflow steps with assembly assignments */
  workflowSteps: json("workflow_steps").$type<WorkflowStep[]>(),
  defaultOptions: json("default_options"),
  typicalSqftRange: json("typical_sqft_range").$type<{ min: number; max: number }>(),
  estimatedDuration: varchar("estimated_duration", { length: 80 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_rt_service").on(t.serviceType),
  index("idx_rt_finish").on(t.finishLevel),
  index("idx_rt_active").on(t.isActive),
]);

export type RemodelTemplate = typeof remodelTemplates.$inferSelect;
export type InsertRemodelTemplate = typeof remodelTemplates.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// NEW CONSTRUCTION TEMPLATES (Sprint 6 — Pricing Architecture)
// ══════════════════════════════════════════════════════════════════════

export const newconTemplates = mysqlTable("newcon_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  structureType: mysqlEnum("structure_type", ["adu", "one_story", "two_story", "two_story_terrace", "shell"]).notNull(),
  description: text("description"),
  parametricModelId: int("parametric_model_id"),
  defaultParameters: json("default_parameters").notNull(),
  defaultSystems: json("default_systems"),
  defaultOptions: json("default_options"),
  mepPackages: json("mep_packages"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_nt_type").on(t.structureType),
]);

export type NewconTemplate = typeof newconTemplates.$inferSelect;
export type InsertNewconTemplate = typeof newconTemplates.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// CATALOG ITEMS (existing — Master Price Book from JobTread CSV)
// Kept intact for backward compatibility with bundle_items FK
// ══════════════════════════════════════════════════════════════════════

export const catalogItems = mysqlTable("catalog_items", {
  id: int("id").autoincrement().primaryKey(),
  costItemId: varchar("costItemId", { length: 64 }),
  costGroupName: varchar("costGroupName", { length: 255 }).notNull(),
  costItemName: varchar("costItemName", { length: 512 }).notNull(),
  description: text("description"),
  unit: varchar("unit", { length: 32 }).notNull(),
  unitCost: decimal("unitCost", { precision: 12, scale: 2 }).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  margin: varchar("margin", { length: 16 }).default("35%"),
  costCode: varchar("costCode", { length: 16 }).notNull(),
  costType: varchar("costType", { length: 64 }),
  taxable: boolean("taxable").default(true),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ci_group").on(t.costGroupName),
  index("idx_ci_active").on(t.isActive),
  index("idx_ci_code").on(t.costCode),
]);

export type CatalogItem = typeof catalogItems.$inferSelect;
export type InsertCatalogItem = typeof catalogItems.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// GEO ZONES (Sprint 11 — Geographic Intelligence Layer)
// ══════════════════════════════════════════════════════════════════════

export const geoZones = mysqlTable("geo_zones", {
  id: int("id").autoincrement().primaryKey(),
  zoneName: varchar("zone_name", { length: 160 }).notNull().unique(),
  county: varchar("county", { length: 128 }),
  zipCodes: json("zip_codes").$type<string[]>(),
  centerLat: decimal("center_lat", { precision: 10, scale: 7 }),
  centerLng: decimal("center_lng", { precision: 10, scale: 7 }),
  radiusMiles: decimal("radius_miles", { precision: 6, scale: 2 }).default("15.00"),
  coastalExposureLevel: mysqlEnum("coastal_exposure_level", [
    "none", "low", "moderate", "high", "extreme"
  ]).default("none").notNull(),
  logisticsComplexity: mysqlEnum("logistics_complexity", [
    "standard", "moderate", "complex", "extreme"
  ]).default("standard").notNull(),
  laborModifier: decimal("labor_modifier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  logisticsModifier: decimal("logistics_modifier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  materialModifier: decimal("material_modifier", { precision: 6, scale: 4 }).default("1.0000").notNull(),
  contingencyPct: decimal("contingency_pct", { precision: 5, scale: 2 }).default("0.00").notNull(),
  minProfitShieldPct: decimal("min_profit_shield_pct", { precision: 5, scale: 2 }).default("35.00").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_gz_coastal").on(t.coastalExposureLevel),
  index("idx_gz_active").on(t.isActive),
]);

export type GeoZone = typeof geoZones.$inferSelect;
export type InsertGeoZone = typeof geoZones.$inferInsert;

/** Zone modifier snapshot stored as JSON in projects.zone_modifier_snapshot */
export interface ZoneModifierSnapshot {
  zoneId: number;
  zoneName: string;
  laborModifier: number;
  logisticsModifier: number;
  materialModifier: number;
  contingencyPct: number;
  minProfitShieldPct: number;
  coastalExposureLevel: string;
  capturedAt: string; // ISO timestamp
}


// ══════════════════════════════════════════════════════════════════════
// SPRINT 12 — SCOPE BUILDER ENGINE
// ══════════════════════════════════════════════════════════════════════

// ── Scope Rules (deterministic rule matching) ──

/** Condition JSON structure for scope rules */
export interface ScopeRuleCondition {
  /** Field to evaluate (e.g. "condition", "area_gte", "area_lte") */
  field: string;
  /** Operator: eq, neq, in, gte, lte, contains */
  op: "eq" | "neq" | "in" | "gte" | "lte" | "contains";
  /** Value to compare against */
  value: string | number | string[];
}

export const scopeRules = mysqlTable("scope_rules", {
  id: int("id").autoincrement().primaryKey(),
  ruleCode: varchar("rule_code", { length: 80 }).notNull().unique(),
  serviceType: varchar("service_type", { length: 128 }).notNull(),
  scopeVariant: varchar("scope_variant", { length: 128 }),
  projectType: mysqlEnum("project_type", [
    "remodel", "new_construction", "repair", "insurance_restoration",
    "commercial_buildout", "addition", "exterior"
  ]),
  channel: mysqlEnum("channel", ["direct", "insurance", "commercial"]),
  zone: varchar("zone", { length: 128 }),
  finishLevel: mysqlEnum("finish_level", ["standard", "premium", "luxury"]),
  conditionJson: json("condition_json").$type<ScopeRuleCondition[]>(),
  assemblyId: int("assembly_id").notNull(),
  quantityFormula: varchar("quantity_formula", { length: 255 }).notNull(),
  reasonTemplate: varchar("reason_template", { length: 512 }).notNull(),
  priority: int("priority").default(100).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_sr_service_type").on(t.serviceType),
  index("idx_sr_scope_variant").on(t.scopeVariant),
  index("idx_sr_project_type").on(t.projectType),
  index("idx_sr_channel").on(t.channel),
  index("idx_sr_zone").on(t.zone),
  index("idx_sr_finish").on(t.finishLevel),
  index("idx_sr_active").on(t.active),
  index("idx_sr_priority").on(t.priority),
  index("idx_sr_assembly").on(t.assemblyId),
]);

export type ScopeRule = typeof scopeRules.$inferSelect;
export type InsertScopeRule = typeof scopeRules.$inferInsert;

// ── Scope Drafts (generated scope output) ──

export const scopeDrafts = mysqlTable("scope_drafts", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  intakeFormId: int("intake_form_id").notNull(),
  status: mysqlEnum("status", ["draft", "under_review", "approved", "rejected", "converted"])
    .default("draft")
    .notNull(),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 2 }),
  warningsJson: json("warnings_json").$type<string[]>(),
  createdBy: int("created_by"),
  updatedBy: int("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_sd_project").on(t.projectId),
  index("idx_sd_intake").on(t.intakeFormId),
  index("idx_sd_status").on(t.status),
]);

export type ScopeDraft = typeof scopeDrafts.$inferSelect;
export type InsertScopeDraft = typeof scopeDrafts.$inferInsert;

// ── Scope Draft Items (selected assemblies with quantities) ──

export const scopeDraftItems = mysqlTable("scope_draft_items", {
  id: int("id").autoincrement().primaryKey(),
  scopeDraftId: int("scope_draft_id").notNull(),
  assemblyId: int("assembly_id").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 4 }).notNull(),
  unit: varchar("unit", { length: 30 }).default("EA").notNull(),
  reason: text("reason").notNull(),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).default("1.00").notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sdi_draft").on(t.scopeDraftId),
  index("idx_sdi_assembly").on(t.assemblyId),
  index("idx_sdi_sort").on(t.sortOrder),
]);

export type ScopeDraftItem = typeof scopeDraftItems.$inferSelect;
export type InsertScopeDraftItem = typeof scopeDraftItems.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// SCOPE REVIEW DELTAS (Sprint 14 — operator edits during review)
// ══════════════════════════════════════════════════════════════════════

export const scopeReviewDeltas = mysqlTable("scope_review_deltas", {
  id: int("id").autoincrement().primaryKey(),
  scopeDraftId: int("scope_draft_id").notNull(),
  assemblyId: int("assembly_id").notNull(),
  actionType: mysqlEnum("action_type", ["remove", "quantity_adjustment"]).notNull(),
  previousQuantity: decimal("previous_quantity", { precision: 10, scale: 4 }).notNull(),
  newQuantity: decimal("new_quantity", { precision: 10, scale: 4 }),
  operatorReason: text("operator_reason"),
  createdBy: int("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_srd_draft").on(t.scopeDraftId),
  index("idx_srd_assembly").on(t.assemblyId),
  index("idx_srd_action").on(t.actionType),
]);

export type ScopeReviewDelta = typeof scopeReviewDeltas.$inferSelect;
export type InsertScopeReviewDelta = typeof scopeReviewDeltas.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// SCOPE REVIEW SNAPSHOTS (Sprint 14 — frozen state at conversion time)
// ══════════════════════════════════════════════════════════════════════

/** Snapshot item stored in the approved_items JSON column */
export interface SnapshotItem {
  assemblyId: number;
  assemblyName: string;
  quantity: number;
  unit: string;
  reason: string;
  confidence: number;
}

/** Delta record stored in the delta_changes JSON column */
export interface SnapshotDelta {
  assemblyId: number;
  actionType: "remove" | "quantity_adjustment";
  previousQuantity: number;
  newQuantity: number | null;
  operatorReason: string | null;
}

export const scopeReviewSnapshots = mysqlTable("scope_review_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  scopeDraftId: int("scope_draft_id").notNull(),
  approvedItems: json("approved_items").$type<SnapshotItem[]>().notNull(),
  deltaChanges: json("delta_changes").$type<SnapshotDelta[]>().notNull(),
  warnings: json("warnings").$type<string[]>(),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 2 }),
  operatorId: int("operator_id").notNull(),
  bundleId: int("bundle_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_srs_draft").on(t.scopeDraftId),
  index("idx_srs_operator").on(t.operatorId),
  index("idx_srs_bundle").on(t.bundleId),
]);

export type ScopeReviewSnapshot = typeof scopeReviewSnapshots.$inferSelect;
export type InsertScopeReviewSnapshot = typeof scopeReviewSnapshots.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// GEOGRAPHIC OVERRIDES — Sprint 16
// ══════════════════════════════════════════════════════════════════════

export const geographicOverrides = mysqlTable("geographic_overrides", {
  id: int("id").autoincrement().primaryKey(),
  zone: varchar("zone", { length: 100 }).notNull(),
  trade: varchar("trade", { length: 80 }).notNull(),
  finishLevel: varchar("finish_level", { length: 50 }),
  originalAssemblyId: int("original_assembly_id").notNull(),
  replacementAssemblyId: int("replacement_assembly_id").notNull(),
  overrideType: mysqlEnum("override_type", ["swap", "add", "warning_only"]).notNull(),
  reasonTemplate: text("reason_template").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_go_zone").on(t.zone),
  index("idx_go_trade").on(t.trade),
  index("idx_go_original").on(t.originalAssemblyId),
  index("idx_go_replacement").on(t.replacementAssemblyId),
  index("idx_go_active").on(t.active),
  index("idx_go_zone_trade").on(t.zone, t.trade),
]);

export type GeographicOverride = typeof geographicOverrides.$inferSelect;
export type InsertGeographicOverride = typeof geographicOverrides.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// SCOPE OVERRIDE LOG — Sprint 16
// ══════════════════════════════════════════════════════════════════════

export const scopeOverrideLog = mysqlTable("scope_override_log", {
  id: int("id").autoincrement().primaryKey(),
  scopeDraftId: int("scope_draft_id").notNull(),
  originalAssemblyId: int("original_assembly_id").notNull(),
  replacementAssemblyId: int("replacement_assembly_id").notNull(),
  zone: varchar("zone", { length: 100 }).notNull(),
  overrideType: mysqlEnum("override_type", ["swap", "add", "warning_only"]).notNull(),
  overrideReason: text("override_reason").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_sol_draft").on(t.scopeDraftId),
  index("idx_sol_original").on(t.originalAssemblyId),
  index("idx_sol_replacement").on(t.replacementAssemblyId),
  index("idx_sol_draft_original_replacement").on(t.scopeDraftId, t.originalAssemblyId, t.replacementAssemblyId),
]);

export type ScopeOverrideLogEntry = typeof scopeOverrideLog.$inferSelect;
export type InsertScopeOverrideLogEntry = typeof scopeOverrideLog.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// PROJECT ACTUALS (Sprint 18.5 — Blueprint v1.0 Feedback Loop stub)
// Tracks actual costs vs. estimated costs per assembly/line-item.
// Empty for now — will be populated by future closeout/field-reporting sprints.
// ══════════════════════════════════════════════════════════════════════

export const projectActuals = mysqlTable("project_actuals", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  estimateDraftId: int("estimate_draft_id"),
  assemblyId: int("assembly_id"),
  assemblyName: varchar("assembly_name", { length: 255 }),
  lineItemDescription: varchar("line_item_description", { length: 512 }),
  unit: varchar("unit", { length: 32 }),
  estimatedQty: decimal("estimated_qty", { precision: 12, scale: 4 }),
  actualQty: decimal("actual_qty", { precision: 12, scale: 4 }),
  estimatedUnitCost: decimal("estimated_unit_cost", { precision: 12, scale: 4 }),
  actualUnitCost: decimal("actual_unit_cost", { precision: 12, scale: 4 }),
  estimatedTotalCost: decimal("estimated_total_cost", { precision: 14, scale: 2 }),
  actualTotalCost: decimal("actual_total_cost", { precision: 14, scale: 2 }),
  variancePct: decimal("variance_pct", { precision: 8, scale: 2 }),
  varianceAmount: decimal("variance_amount", { precision: 14, scale: 2 }),
  isHighVariance: boolean("is_high_variance").default(false).notNull(),
  varianceReason: text("variance_reason"),
  trade: varchar("trade", { length: 128 }),
  category: varchar("category", { length: 128 }),
  region: varchar("region", { length: 128 }),
  pricingSchemaVersion: varchar("pricing_schema_version", { length: 10 }),
  recordedBy: int("recorded_by"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_pa_project").on(t.projectId),
  index("idx_pa_estimate").on(t.estimateDraftId),
  index("idx_pa_assembly").on(t.assemblyId),
  index("idx_pa_trade").on(t.trade),
  index("idx_pa_region").on(t.region),
  index("idx_pa_recorded_at").on(t.recordedAt),
]);

export type ProjectActual = typeof projectActuals.$inferSelect;
export type InsertProjectActual = typeof projectActuals.$inferInsert;

// ── System Issue Reports ──────────────────────────────────────────────
export const systemIssueReports = mysqlTable("system_issue_reports", {
  id: int("id").primaryKey().autoincrement(),
  reportedBy: int("reported_by").notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(), // 'estimate_draft', 'scope_draft', 'assembly', 'price_book_item'
  entityId: int("entity_id").notNull(),
  issueCategory: mysqlEnum("issue_category", [
    "pricing_mismatch",
    "missing_assembly",
    "wrong_multiplier",
    "scope_error",
    "ui_bug",
    "data_integrity",
    "other",
  ]).notNull(),
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  metadata: json("metadata"), // contextSnapshot, multipliers, etc.
  status: mysqlEnum("status", ["open", "acknowledged", "investigating", "resolved", "dismissed"]).default("open").notNull(),
  resolvedBy: int("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_sir_entity").on(t.entityType, t.entityId),
  index("idx_sir_category").on(t.issueCategory),
  index("idx_sir_status").on(t.status),
  index("idx_sir_reported_by").on(t.reportedBy),
  index("idx_sir_severity").on(t.severity),
]);
export type SystemIssueReport = typeof systemIssueReports.$inferSelect;
export type InsertSystemIssueReport = typeof systemIssueReports.$inferInsert;

// ── Pipeline Partial Drafts (Draft Recovery) ──────────────────────────
export const pipelinePartialDrafts = mysqlTable("pipeline_partial_drafts", {
  id: int("id").primaryKey().autoincrement(),
  scopeDraftId: int("scope_draft_id").notNull(),
  userId: int("user_id").notNull(),
  failedStep: varchar("failed_step", { length: 128 }).notNull(),
  errorCode: varchar("error_code", { length: 64 }).notNull(),
  errorMessage: text("error_message").notNull(),
  partialPayload: json("partial_payload"), // whatever was computed before failure
  contextSnapshot: json("context_snapshot"), // ContextSnapshot at failure point
  retryCount: int("retry_count").default(0).notNull(),
  maxRetries: int("max_retries").default(3).notNull(),
  status: mysqlEnum("status", ["pending", "retrying", "recovered", "abandoned"]).default("pending").notNull(),
  recoveredEstimateId: int("recovered_estimate_id"),
  recoveredAt: timestamp("recovered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ppd_scope_draft").on(t.scopeDraftId),
  index("idx_ppd_user").on(t.userId),
  index("idx_ppd_status").on(t.status),
  index("idx_ppd_error_code").on(t.errorCode),
]);
export type PipelinePartialDraft = typeof pipelinePartialDrafts.$inferSelect;
export type InsertPipelinePartialDraft = typeof pipelinePartialDrafts.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// Sprint 21 — Field Launch Control
// ══════════════════════════════════════════════════════════════════════

// ── System Settings / Feature Flags ───────────────────────────────────
export const systemSettings = mysqlTable("system_settings", {
  id: int("id").primaryKey().autoincrement(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value").notNull(),
  description: varchar("description", { length: 512 }),
  updatedBy: int("updated_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  uniqueIndex("idx_ss_key").on(t.key),
]);
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

// ── Field Feedback Reports ────────────────────────────────────────────
export const fieldFeedbackReports = mysqlTable("field_feedback_reports", {
  id: int("id").primaryKey().autoincrement(),
  projectId: int("project_id"),
  estimateId: int("estimate_id"),
  userId: int("user_id").notNull(),
  issueType: mysqlEnum("issue_type", [
    "pricing_inaccuracy",
    "scope_mismatch",
    "material_unavailable",
    "labor_shortage",
    "timeline_issue",
    "quality_concern",
    "client_complaint",
    "safety_issue",
    "other",
  ]).notNull(),
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  description: text("description").notNull(),
  resolution: text("resolution"),
  status: mysqlEnum("status", ["open", "in_review", "resolved", "dismissed"]).default("open").notNull(),
  resolvedBy: int("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_ffr_project").on(t.projectId),
  index("idx_ffr_estimate").on(t.estimateId),
  index("idx_ffr_user").on(t.userId),
  index("idx_ffr_type").on(t.issueType),
  index("idx_ffr_severity").on(t.severity),
  index("idx_ffr_status").on(t.status),
]);
export type FieldFeedbackReport = typeof fieldFeedbackReports.$inferSelect;
export type InsertFieldFeedbackReport = typeof fieldFeedbackReports.$inferInsert;


// ══════════════════════════════════════════════════════════════════════
// SPRINT 22 — LEARNING LAYER FOUNDATION
// Separate analytics pipeline — reads from project_actuals and estimates.
// Does NOT modify Scope Builder, Remodel Engine, Pricing Engine, or Override Resolver.
// ══════════════════════════════════════════════════════════════════════

// ── Estimate Variance Events ────────────────────────────────────────
export const estimateVarianceEvents = mysqlTable("estimate_variance_events", {
  id: int("id").primaryKey().autoincrement(),
  projectId: int("project_id").notNull(),
  estimateId: int("estimate_id").notNull(),
  assemblyId: int("assembly_id").notNull(),
  assemblyName: varchar("assembly_name", { length: 255 }),
  estimatedCost: decimal("estimated_cost", { precision: 14, scale: 2 }).notNull(),
  actualCost: decimal("actual_cost", { precision: 14, scale: 2 }).notNull(),
  variancePct: decimal("variance_pct", { precision: 8, scale: 2 }).notNull(),
  varianceAmount: decimal("variance_amount", { precision: 14, scale: 2 }).notNull(),
  varianceType: mysqlEnum("variance_type", [
    "labor_variance",
    "material_variance",
    "waste_variance",
    "scope_variance",
  ]).notNull(),
  varianceDirection: mysqlEnum("variance_direction", ["overrun", "underrun"]).default("overrun").notNull(),
  trade: varchar("trade", { length: 128 }),
  region: varchar("region", { length: 128 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_eve_project").on(t.projectId),
  index("idx_eve_estimate").on(t.estimateId),
  index("idx_eve_assembly").on(t.assemblyId),
  index("idx_eve_type").on(t.varianceType),
  index("idx_eve_direction").on(t.varianceDirection),
  index("idx_eve_created").on(t.createdAt),
]);
export type EstimateVarianceEvent = typeof estimateVarianceEvents.$inferSelect;
export type InsertEstimateVarianceEvent = typeof estimateVarianceEvents.$inferInsert;

// ── Assembly Performance Metrics ────────────────────────────────────
export const assemblyPerformanceMetrics = mysqlTable("assembly_performance_metrics", {
  id: int("id").primaryKey().autoincrement(),
  assemblyId: int("assembly_id").notNull(),
  assemblyName: varchar("assembly_name", { length: 255 }),
  projectCount: int("project_count").default(0).notNull(),
  avgEstimatedQty: decimal("avg_estimated_qty", { precision: 12, scale: 4 }).default("0"),
  avgActualQty: decimal("avg_actual_qty", { precision: 12, scale: 4 }).default("0"),
  avgEstimatedCost: decimal("avg_estimated_cost", { precision: 14, scale: 2 }).default("0"),
  avgActualCost: decimal("avg_actual_cost", { precision: 14, scale: 2 }).default("0"),
  avgVariancePct: decimal("avg_variance_pct", { precision: 8, scale: 2 }).default("0"),
  totalEstimatedCost: decimal("total_estimated_cost", { precision: 16, scale: 2 }).default("0"),
  totalActualCost: decimal("total_actual_cost", { precision: 16, scale: 2 }).default("0"),
  overrunCount: int("overrun_count").default(0).notNull(),
  underrunCount: int("underrun_count").default(0).notNull(),
  highVarianceCount: int("high_variance_count").default(0).notNull(),
  lastUpdated: timestamp("last_updated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("idx_apm_assembly").on(t.assemblyId),
  index("idx_apm_variance").on(t.avgVariancePct),
  index("idx_apm_overrun").on(t.overrunCount),
  index("idx_apm_underrun").on(t.underrunCount),
]);
export type AssemblyPerformanceMetric = typeof assemblyPerformanceMetrics.$inferSelect;
export type InsertAssemblyPerformanceMetric = typeof assemblyPerformanceMetrics.$inferInsert;

// ── Calibration Suggestions ─────────────────────────────────────────
export const calibrationSuggestions = mysqlTable("calibration_suggestions", {
  id: int("id").primaryKey().autoincrement(),
  assemblyId: int("assembly_id").notNull(),
  assemblyName: varchar("assembly_name", { length: 255 }),
  suggestedWasteFactor: decimal("suggested_waste_factor", { precision: 6, scale: 4 }),
  suggestedLaborMultiplier: decimal("suggested_labor_multiplier", { precision: 6, scale: 4 }),
  suggestedMaterialMultiplier: decimal("suggested_material_multiplier", { precision: 6, scale: 4 }),
  currentWasteFactor: decimal("current_waste_factor", { precision: 6, scale: 4 }),
  currentLaborMultiplier: decimal("current_labor_multiplier", { precision: 6, scale: 4 }),
  currentMaterialMultiplier: decimal("current_material_multiplier", { precision: 6, scale: 4 }),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 2 }).notNull(),
  sampleSize: int("sample_size").default(0).notNull(),
  avgVariancePct: decimal("avg_variance_pct", { precision: 8, scale: 2 }),
  rationale: text("rationale"),
  status: mysqlEnum("status", ["pending", "reviewed", "accepted", "rejected"]).default("pending").notNull(),
  reviewedBy: int("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (t) => [
  index("idx_cs_assembly").on(t.assemblyId),
  index("idx_cs_status").on(t.status),
  index("idx_cs_confidence").on(t.confidenceScore),
  index("idx_cs_generated").on(t.generatedAt),
]);
export type CalibrationSuggestion = typeof calibrationSuggestions.$inferSelect;
export type InsertCalibrationSuggestion = typeof calibrationSuggestions.$inferInsert;
