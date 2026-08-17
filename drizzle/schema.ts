import {
  boolean,
  numeric,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  date,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ══════════════════════════════════════════════════════════════════════
// PHASE 1 — TENANT LAYER (multi-company isolation)
// ══════════════════════════════════════════════════════════════════════

/**
 * Tenants — every operational entity belongs to exactly one tenant.
 * GCHI is the default tenant (slug "gchi"), seeded by migration 0001.
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  legalName: text("legal_name"),
  region: text("region").default("charleston_sc").notNull(),
  timezone: text("timezone").default("America/New_York").notNull(),
  defaultChannel: text("default_channel").default("direct"),
  settings: jsonb("settings").default({}),
  isActive: boolean("is_active").default(true).notNull(),
  // PHASE 4 — tenant lifecycle visible without loading tenant_settings (docs/phase4-contract.md §5)
  /** TenantOnboardingStatus from shared/domain/phase4-taxonomy.ts */
  onboardingStatus: text("onboarding_status").default("not_started"),
  /** Demo tenants exist so a prospect can explore without touching real jobs. */
  isDemo: boolean("is_demo").default(false),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_tenants_slug").on(t.slug),
  index("idx_tenants_active").on(t.isActive),
  index("idx_tenants_onboarding").on(t.onboardingStatus),
]);

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// SUPABASE TABLES (Source of Truth - 24 tables)
// ══════════════════════════════════════════════════════════════════════

// 1. Cost Codes - Master Price Book codes
export const costCodes = pgTable("cost_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  isParent: boolean("is_parent").default(false).notNull(),
  defaultCostTypeId: uuid("default_cost_type_id"),
  defaultUnitId: uuid("default_unit_id"),
  jobtreadId: text("jobtread_id"),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  nahbCode: text("nahb_code"),
  ircReference: text("irc_reference"),
  coastalNotes: text("coastal_notes"),
  description: text("description"),
  // PHASE 4 — calibration provenance on the price book itself (docs/phase4-contract.md §3)
  /** Last approved adjustment applied to this code; the rollback anchor for the operator. */
  lastAdjustmentId: uuid("last_adjustment_id"),
  lastAdjustmentPct: numeric("last_adjustment_pct"),
  lastAdjustedAt: timestamp("last_adjusted_at", { withTimezone: true }),
  /** Closed projects that contributed evidence about this code. */
  calibrationSampleCount: integer("calibration_sample_count").default(0),
}, (t) => [
  index("idx_cost_codes_tenant").on(t.tenantId),
  index("idx_cost_codes_parent").on(t.parentId),
  index("idx_cost_codes_active").on(t.isActive),
  uniqueIndex("uq_cost_codes_tenant_code").on(t.tenantId, t.code),
]);

export type CostCode = typeof costCodes.$inferSelect;
export type InsertCostCode = typeof costCodes.$inferInsert;

// 2. Cost Code Pricing History - Pricing records
export const costCodePricingHistory = pgTable("cost_code_pricing_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  costCodeId: uuid("cost_code_id").notNull().references(() => costCodes.id, { onDelete: "cascade" }),
  unitId: uuid("unit_id"),
  unitCost: numeric("unit_cost").notNull(),
  unitPrice: numeric("unit_price"),
  source: text("source").default("manual"),
  notes: text("notes"),
  effectiveDate: date("effective_date").notNull(),
  expirationDate: date("expiration_date"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid("updated_by"),
  unitCostMaterial: numeric("unit_cost_material"),
  unitCostLabor: numeric("unit_cost_labor"),
  taxable: boolean("taxable").default(false),
  // PHASE 4 — trace a price row back to the adjustment that created it (PA-004)
  priceAdjustmentId: uuid("price_adjustment_id"),
}, (t) => [
  index("idx_ccph_cost_code").on(t.costCodeId),
  index("idx_ccph_active").on(t.isActive),
  index("idx_ccph_effective").on(t.effectiveDate),
]);

export type CostCodePricingHistory = typeof costCodePricingHistory.$inferSelect;
export type InsertCostCodePricingHistory = typeof costCodePricingHistory.$inferInsert;

// 3. Cost Types - Material, Labor, etc.
export const costTypes = pgTable("cost_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  defaultMargin: numeric("default_margin").default("0.30").notNull(),
  isTaxable: boolean("is_taxable").default(false).notNull(),
  isTimeTrackable: boolean("is_time_trackable").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  jobtreadId: text("jobtread_id"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  taxable: boolean("taxable").default(false),
  timeTrackable: boolean("time_trackable").default(true),
});

export type CostType = typeof costTypes.$inferSelect;
export type InsertCostType = typeof costTypes.$inferInsert;

// 4. Assemblies - Pre-built construction assemblies
export const assemblies = pgTable("assemblies", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  defaultUnitId: uuid("default_unit_id"),
  baseUnitQty: numeric("base_unit_qty").default("1.00"),
  wasteFactor: numeric("waste_factor").default("0.10"),
  region: text("region").default("charleston_sc").notNull(),
  code: text("code"),
  trade: text("trade"),
  finishLevel: text("finish_level"),
  coastalModifier: numeric("coastal_modifier"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_assemblies_tenant").on(t.tenantId),
  index("idx_assemblies_category").on(t.category),
  index("idx_assemblies_active").on(t.isActive),
]);

export type Assembly = typeof assemblies.$inferSelect;
export type InsertAssembly = typeof assemblies.$inferInsert;

// 5. Assembly Items - Bill of Materials
export const assemblyItems = pgTable("assembly_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  assemblyId: uuid("assembly_id").notNull().references(() => assemblies.id, { onDelete: "cascade" }),
  costCodeId: uuid("cost_code_id").notNull().references(() => costCodes.id, { onDelete: "restrict" }),
  costTypeId: uuid("cost_type_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  description: text("description"),
  defaultQtyPerUnit: numeric("default_qty_per_unit").default("1.0").notNull(),
  wasteFactor: numeric("waste_factor"),
  priceBookItem: uuid("price_book_item"),
  componentType: text("component_type"),
  unitCostOverride: numeric("unit_cost_override"),
  isOptional: boolean("is_optional").default(false).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_assembly_items_assembly").on(t.assemblyId),
  index("idx_assembly_items_cost_code").on(t.costCodeId),
]);

export type AssemblyItem = typeof assemblyItems.$inferSelect;
export type InsertAssemblyItem = typeof assemblyItems.$inferInsert;

// 6. Bundles - Grouped assemblies
export const bundles = pgTable("bundles", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  bundleDiscount: numeric("bundle_discount").default("0.08").notNull(),
  region: text("region").default("Charleston, SC").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  isCustomizable: boolean("is_customizable").default(true).notNull(),
  minItems: integer("min_items").default(2),
  maxItems: integer("max_items").default(20),
  validFrom: date("valid_from"),
  validUntil: date("valid_until"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_bundles_tenant").on(t.tenantId),
  index("idx_bundles_active").on(t.isActive),
]);

export type Bundle = typeof bundles.$inferSelect;
export type InsertBundle = typeof bundles.$inferInsert;

// 7. Bundle Items - Items within bundles
export const bundleItems = pgTable("bundle_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  bundleId: uuid("bundle_id").notNull().references(() => bundles.id, { onDelete: "cascade" }),
  assemblyId: uuid("assembly_id").notNull().references(() => assemblies.id, { onDelete: "restrict" }),
  quantity: numeric("quantity").default("1").notNull(),
  isOptional: boolean("is_optional").default(false).notNull(),
  overrideQty: numeric("override_qty"),
  sortOrder: integer("sort_order").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_bundle_items_bundle").on(t.bundleId),
  index("idx_bundle_items_assembly").on(t.assemblyId),
  uniqueIndex("uq_bundle_items_bundle_assembly").on(t.bundleId, t.assemblyId),
]);

export type BundleItem = typeof bundleItems.$inferSelect;
export type InsertBundleItem = typeof bundleItems.$inferInsert;

// 8. Units - Measurement units (EA, SF, LF, etc.)
export const units = pgTable("units", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  abbreviation: text("abbreviation"),
  jobtreadId: text("jobtread_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Unit = typeof units.$inferSelect;
export type InsertUnit = typeof units.$inferInsert;

// 9. Projects - Construction projects
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  clientId: uuid("client_id"),
  ownerUserId: uuid("owner_user_id"),
  clientName: text("client_name"),
  clientEmail: text("client_email"),
  address: text("address"),
  city: text("city").default("Goose Creek"),
  state: text("state").default("SC"),
  zip: text("zip"),
  projectType: text("project_type").notNull(),
  channel: text("channel").default("premium"),
  status: text("status").default("estimate").notNull(),
  leadId: uuid("lead_id"),
  jobtreadId: text("jobtread_id"),
  estimatedTotal: numeric("estimated_total"),
  actualTotal: numeric("actual_total"),
  variancePct: numeric("variance_pct"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  notes: text("notes"),
  county: text("county"),
  zone: text("zone"),
  region: text("region"),
  finishLevel: text("finish_level"),
  pricingSchemaVersion: text("pricing_schema_version"),
  zoneModifierSnapshot: jsonb("zone_modifier_snapshot"),
  geocodeConfidence: text("geocode_confidence"),
  geocodeSource: text("geocode_source"),
  geocodedAddress: text("geocoded_address"),
  geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
  // PHASE 2 — commercial channel, client type and canonical address key
  clientType: text("client_type"),
  commercialChannel: text("commercial_channel"),
  sourceChannel: text("source_channel"),
  addressNormalized: text("address_normalized"),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  geoWarnings: jsonb("geo_warnings"),
  geoRiskClass: text("geo_risk_class"),
  updatedBy: uuid("updated_by"),
  // PHASE 3 — field execution + real cost tracking (docs/phase3-contract.md)
  varianceThresholdPct: numeric("variance_threshold_pct").default("10"),
  committedCostCents: integer("committed_cost_cents").default(0),
  approvedBudgetCents: integer("approved_budget_cents"),
  changeOrderBudgetCents: integer("change_order_budget_cents").default(0),
  fieldStartedAt: timestamp("field_started_at", { withTimezone: true }),
  fieldCompletedAt: timestamp("field_completed_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // PHASE 4 — learning outputs the dashboard reads without a join (docs/phase4-contract.md §2)
  calibratedAt: timestamp("calibrated_at", { withTimezone: true }),
  scopeCompletenessScore: numeric("scope_completeness_score"),
  realizedGrossProfitPct: numeric("realized_gross_profit_pct"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_projects_tenant").on(t.tenantId),
  index("idx_projects_status").on(t.status),
  index("idx_projects_lead").on(t.leadId),
  index("idx_projects_client").on(t.clientId),
  index("idx_projects_owner").on(t.ownerUserId),
  index("idx_projects_tenant_status").on(t.tenantId, t.status),
  index("idx_projects_address_normalized").on(t.tenantId, t.addressNormalized),
]);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// 10. Leads - CRM lead tracking
export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  source: text("source").default("web"),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  service: text("service").default("roof"),
  urgency: text("urgency").default("medium"),
  leadScore: integer("lead_score").default(0),
  status: text("status").default("new"),
  ownerUserId: uuid("owner_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  tags: text("tags").array(),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  serviceType: text("service_type").default("general"),
  notes: text("notes"),
  // PHASE 2 — governed origin + single next step (LIG-005, LIG-006)
  sourceChannel: text("source_channel"),
  sourceDetail: text("source_detail"),
  clientType: text("client_type"),
  commercialChannel: text("commercial_channel"),
  projectType: text("project_type"),
  nextStep: text("next_step"),
  nextStepSetBy: uuid("next_step_set_by"),
  nextStepSetAt: timestamp("next_step_set_at", { withTimezone: true }),
  convertedClientId: uuid("converted_client_id"),
  convertedProjectId: uuid("converted_project_id"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  conversionDecision: text("conversion_decision"),
  conversionBlockers: jsonb("conversion_blockers"),
}, (t) => [
  index("idx_leads_tenant").on(t.tenantId),
  index("idx_leads_source_channel").on(t.sourceChannel),
  index("idx_leads_next_step").on(t.nextStep),
  index("idx_leads_status").on(t.status),
  index("idx_leads_owner").on(t.ownerUserId),
  index("idx_leads_tenant_status").on(t.tenantId, t.status),
]);

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

// 11. Estimate Items - Line items for project estimates
export const estimateItems = pgTable("estimate_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  costCodeId: uuid("cost_code_id").notNull().references(() => costCodes.id, { onDelete: "restrict" }),
  costTypeId: uuid("cost_type_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
  description: text("description"),
  quantity: numeric("quantity").default("0").notNull(),
  unitCost: numeric("unit_cost").default("0").notNull(),
  unitPrice: numeric("unit_price").default("0").notNull(),
  wastePct: numeric("waste_pct"),
  marginPct: numeric("margin_pct"),
  isTaxable: boolean("is_taxable").default(false).notNull(),
  actualCost: numeric("actual_cost"),
  actualQty: numeric("actual_qty"),
  varianceCost: numeric("variance_cost"),
  varianceQty: numeric("variance_qty"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_estimate_items_tenant").on(t.tenantId),
  index("idx_estimate_items_project").on(t.projectId),
  index("idx_estimate_items_cost_code").on(t.costCodeId),
  index("idx_estimate_items_assembly").on(t.assemblyId),
]);

export type EstimateItem = typeof estimateItems.$inferSelect;
export type InsertEstimateItem = typeof estimateItems.$inferInsert;

// 12. Bill of Quantities (BOQ Items)
export const boqItems = pgTable("boq_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  name: text("name").notNull(),
  skuVendor: text("sku_vendor"),
  vendor: text("vendor").default("other"),
  uom: text("uom").default("EA"),
  qty: doublePrecision("qty").notNull(),
  unitCost: numeric("unit_cost"),
  unitPrice: numeric("unit_price"),
  wastePct: numeric("waste_pct"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_boq_items_lead").on(t.leadId),
]);

export type BoqItem = typeof boqItems.$inferSelect;
export type InsertBoqItem = typeof boqItems.$inferInsert;

// 13. Crew Velocity - Labor productivity metrics
export const crewVelocity = pgTable("crew_velocity", {
  id: uuid("id").defaultRandom().primaryKey(),
  costCodeId: uuid("cost_code_id").notNull(),
  crewSize: integer("crew_size").default(2).notNull(),
  unitId: uuid("unit_id").notNull(),
  outputPerHour: numeric("output_per_hour").notNull(),
  outputPerDay: numeric("output_per_day"),
  conditions: text("conditions").default("standard"),
  difficultyFactor: numeric("difficulty_factor").default("1.00"),
  region: text("region").default("charleston_sc").notNull(),
  season: text("season").default("all"),
  source: text("source").default("field_data"),
  notes: text("notes"),
  recordedDate: date("recorded_date").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CrewVelocity = typeof crewVelocity.$inferSelect;
export type InsertCrewVelocity = typeof crewVelocity.$inferInsert;

// 14. Regional Risk Factors - Risk multipliers by zone
export const regionalRiskFactors = pgTable("regional_risk_factors", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  region: text("region").default("charleston_sc").notNull(),
  riskMultiplier: numeric("risk_multiplier").default("1.00").notNull(),
  description: text("description"),
  codeReference: text("code_reference"),
  isActive: boolean("is_active").default(true).notNull(),
  effectiveDate: date("effective_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RegionalRiskFactor = typeof regionalRiskFactors.$inferSelect;
export type InsertRegionalRiskFactor = typeof regionalRiskFactors.$inferInsert;

// 15. Profiles - User profiles (canonical identity)
//
// PHASE 1 IDENTITY MODEL:
//   profiles.id               → internal canonical UUID (used by every FK, RLS and audit trail)
//   profiles.externalOpenId   → unique external OAuth identifier (Manus openId / provider sub)
// The two MUST never be conflated: the session cookie carries the external openId,
// the database always references the internal UUID.
export const profiles = pgTable("profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  externalOpenId: text("external_open_id"),
  email: text("email"),
  loginMethod: text("login_method"),
  fullName: text("full_name"),
  companyName: text("company_name"),
  role: text("role").default("user"),
  isActive: boolean("is_active").default(true).notNull(),
  lastSignedIn: timestamp("last_signed_in", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_profiles_external_open_id").on(t.externalOpenId),
  index("idx_profiles_tenant").on(t.tenantId),
  index("idx_profiles_email").on(t.email),
]);

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = typeof profiles.$inferInsert;

// PHASE 1: Project membership — authoritative source for requireProjectAccess()
export const projectMembers = pgTable("project_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  // "owner" | "manager" | "estimator" | "field" | "viewer"
  projectRole: text("project_role").default("viewer").notNull(),
  // Optional explicit permission grants: ["read", "write", "approve", "delete"]
  permissions: jsonb("permissions").default([]),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_project_members_project_user").on(t.projectId, t.userId),
  index("idx_project_members_project").on(t.projectId),
  index("idx_project_members_user").on(t.userId),
  index("idx_project_members_tenant").on(t.tenantId),
]);

export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = typeof projectMembers.$inferInsert;

/** Canonical project-level permissions used by requireProjectAccess(). */
export type ProjectPermission = "read" | "write" | "approve" | "delete";

// 16. Audit Logs - System audit trail
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  tableName: text("table_name").notNull(),
  recordId: uuid("record_id"),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_audit_logs_user").on(t.userId),
  index("idx_audit_logs_table_record").on(t.tableName, t.recordId),
  index("idx_audit_logs_created").on(t.createdAt),
]);

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

// 17. Lead Proposals - Proposals linked to leads
export const leadProposals = pgTable("lead_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  subtotal: numeric("subtotal"),
  tax: numeric("tax"),
  discount: numeric("discount"),
  total: numeric("total"),
  terms: text("terms"),
  optionsJson: jsonb("options_json").default("[]"),
  signatureUrl: text("signature_url"),
  status: text("status").default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_lead_proposals_lead").on(t.leadId),
  index("idx_lead_proposals_status").on(t.status),
]);

export type LeadProposal = typeof leadProposals.$inferSelect;
export type InsertLeadProposal = typeof leadProposals.$inferInsert;

// 18. Proposals - Client-facing proposals
export const proposals = pgTable("proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  projectName: text("project_name"),
  clientEmail: text("client_email"),
  filename: text("filename"),
  storagePath: text("storage_path").notNull(),
  signedUrl: text("signed_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Proposal = typeof proposals.$inferSelect;
export type InsertProposal = typeof proposals.$inferInsert;

// 19. Property Cache - Cached property data
export const propertyCache = pgTable("property_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  address: text("address").notNull(),
  sqft: integer("sqft"),
  bedrooms: integer("bedrooms"),
  bathrooms: numeric("bathrooms"),
  propertyType: text("property_type"),
  yearBuilt: integer("year_built"),
  lotSize: integer("lot_size"),
  estimatedValue: numeric("estimated_value"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PropertyCache = typeof propertyCache.$inferSelect;
export type InsertPropertyCache = typeof propertyCache.$inferInsert;

// 20. Proposal Access Log - Tracking proposal access
export const proposalAccessLog = pgTable("proposal_access_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  proposalId: uuid("proposal_id").notNull(),
  action: text("action").notNull(),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow(),
  ipAddress: text("ip_address"),
});

export type ProposalAccessLog = typeof proposalAccessLog.$inferSelect;
export type InsertProposalAccessLog = typeof proposalAccessLog.$inferInsert;

// 21. Roof Segments - Roof segment data
export const roofSegments = pgTable("roof_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  polygonGeojson: jsonb("polygon_geojson").notNull(),
  areaProjectedFt2: doublePrecision("area_projected_ft2"),
  pitchRisePer12: integer("pitch_rise_per_12").default(6),
  tiltDeg: doublePrecision("tilt_deg"),
  azimuthDeg: doublePrecision("azimuth_deg"),
  source: text("source").default("manual"),
  quality: text("quality"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_roof_segments_lead").on(t.leadId),
]);

export type RoofSegment = typeof roofSegments.$inferSelect;
export type InsertRoofSegment = typeof roofSegments.$inferInsert;

// 22. Security Exceptions - Documented security exceptions
export const securityExceptions = pgTable("security_exceptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tableName: text("table_name").notNull(),
  exceptionType: text("exception_type").notNull(),
  justification: text("justification").notNull(),
  riskLevel: text("risk_level").default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  reviewedBy: text("reviewed_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }).defaultNow(),
});

export type SecurityException = typeof securityExceptions.$inferSelect;
export type InsertSecurityException = typeof securityExceptions.$inferInsert;

// 23. Security Review Final - Security audit results
export const securityReviewFinal = pgTable("security_review_final", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewDate: timestamp("review_date", { withTimezone: true }).defaultNow(),
  status: text("status").default("COMPLETED"),
  summary: jsonb("summary"),
});

export type SecurityReviewFinal = typeof securityReviewFinal.$inferSelect;
export type InsertSecurityReviewFinal = typeof securityReviewFinal.$inferInsert;

// 24. System Alerts - System-wide notifications
export const systemAlerts = pgTable("system_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  alertType: text("alert_type").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  data: jsonb("data").default("{}"),
  resolved: boolean("resolved").default(false),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type SystemAlert = typeof systemAlerts.$inferSelect;
export type InsertSystemAlert = typeof systemAlerts.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// APP-ONLY TABLES (Not in Supabase - Internal app logic only)
// ══════════════════════════════════════════════════════════════════════

// APP-ONLY: RBAC - Roles and permissions management
export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  isSystem: boolean("is_system").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Role = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;

export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_perm_resource").on(t.resource),
  uniqueIndex("uq_permissions_resource_action").on(t.resource, t.action),
]);

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = typeof permissions.$inferInsert;

export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_rp_role").on(t.roleId),
  index("idx_rp_perm").on(t.permissionId),
  uniqueIndex("uq_role_permissions_role_perm").on(t.roleId, t.permissionId),
]);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = typeof rolePermissions.$inferInsert;

// APP-ONLY: Estimate workflow
export const estimates = pgTable("estimates", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").default("draft").notNull(),
  subtotal: numeric("subtotal"),
  tax: numeric("tax"),
  discount: numeric("discount"),
  total: numeric("total"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_estimates_tenant").on(t.tenantId),
  index("idx_estimates_project").on(t.projectId),
  index("idx_estimates_status").on(t.status),
]);

export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = typeof estimates.$inferInsert;

// APP-ONLY: Estimate drafts for versioning
export const estimateDrafts = pgTable("estimate_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  estimateId: uuid("estimate_id").references(() => estimates.id, { onDelete: "set null" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").default("draft").notNull(),
  source: text("source"),
  draftData: jsonb("draft_data"),
  bundleName: text("bundle_name"),
  zone: text("zone"),
  finishLevel: text("finish_level"),
  trade: text("trade"),
  pricingSchemaVersion: text("pricing_schema_version"),
  channel: text("channel"),
  region: text("region"),
  createdBy: uuid("created_by"),
  coastalModifier: numeric("coastal_modifier"),
  subtotalPrice: numeric("subtotal_price"),
  subtotalCost: numeric("subtotal_cost"),
  finalTotalPrice: numeric("final_total_price"),
  discountApplied: boolean("discount_applied").default(false),
  discountAmount: numeric("discount_amount"),
  grossProfit: numeric("gross_profit"),
  grossProfitPct: numeric("gross_profit_pct"),
  profitShieldPassed: boolean("profit_shield_passed"),
  profitShieldMinPct: numeric("profit_shield_min_pct"),
  assemblySelections: jsonb("assembly_selections"),
  lineItems: jsonb("line_items"),
  intakeFormId: uuid("intake_form_id"),
  warningsJson: jsonb("warnings_json"),
  scopeDraftId: uuid("scope_draft_id"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  bundleId: uuid("bundle_id"),
  clientId: uuid("client_id"),
  assemblyCount: integer("assembly_count"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // PHASE 2 — versioning + immutability of an approved estimate
  version: integer("version").default(1).notNull(),
  supersededBy: uuid("superseded_by"),
  supersedesId: uuid("supersedes_id"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  changeOrderOf: uuid("change_order_of"),
  changeOrderReason: text("change_order_reason"),
  // PHASE 2 — commercial channel snapshot + Profit Shield evaluation
  commercialChannel: text("commercial_channel"),
  profitShieldFloorPct: numeric("profit_shield_floor_pct"),
  profitShieldEvaluation: jsonb("profit_shield_evaluation"),
  pricingSnapshot: jsonb("pricing_snapshot"),
}, (t) => [
  index("idx_estimate_drafts_tenant").on(t.tenantId),
  index("idx_estimate_drafts_version").on(t.projectId, t.version),
  index("idx_estimate_drafts_project").on(t.projectId),
  index("idx_estimate_drafts_estimate").on(t.estimateId),
  index("idx_estimate_drafts_scope_draft").on(t.scopeDraftId),
  index("idx_estimate_drafts_status").on(t.status),
]);

export type EstimateDraft = typeof estimateDrafts.$inferSelect;
export type InsertEstimateDraft = typeof estimateDrafts.$inferInsert;

/** Line item stored in estimateDrafts.lineItems JSONB — matches JobTread CSV export format */
export type EstimateDraftLineItem = {
  costGroupName: string;
  costItemName: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitCostSnapshot: string | number;
  unitPriceSnapshot: string | number;
  assemblyId?: string | null;
  costCode?: string | null;
  taxable?: boolean;
};

/** Assembly selection stored in estimateDrafts.assemblySelections JSONB */
export type EstimateDraftAssemblySelection = {
  assemblyId: string;
  assemblyName: string;
  assemblyCode?: string;
  category?: string;
  quantity: number;
  unitPrice?: number;
  unitCost?: number;
};

// APP-ONLY: Intake forms for project initiation
export const intakeForms = pgTable("intake_forms", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").default("draft").notNull(),
  formData: jsonb("form_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_intake_forms_tenant").on(t.tenantId),
  index("idx_intake_forms_project").on(t.projectId),
  index("idx_intake_forms_lead").on(t.leadId),
  index("idx_intake_forms_status").on(t.status),
]);

export type IntakeForm = typeof intakeForms.$inferSelect;
export type InsertIntakeForm = typeof intakeForms.$inferInsert;

// APP-ONLY: Project files and documents
export const projectFiles = pgTable("project_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type"),
  storagePath: text("storage_path").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_project_files_project").on(t.projectId),
  index("idx_project_files_tenant").on(t.tenantId),
]);

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = typeof projectFiles.$inferInsert;

// APP-ONLY: Scope drafts and review
export const scopeDrafts = pgTable("scope_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  status: text("status").default("draft").notNull(),
  content: jsonb("content"),
  zone: text("zone"),
  finishLevel: text("finish_level"),
  serviceType: text("service_type"),
  channel: text("channel"),
  confidence: numeric("confidence"),
  reason: text("reason"),
  intakeFormId: uuid("intake_form_id").references(() => intakeForms.id, { onDelete: "set null" }),
  createdBy: uuid("created_by"),
  retryCount: integer("retry_count").default(0),
  warningsJson: jsonb("warnings_json"),
  // PHASE 2 — geo signals propagated from the project geo context
  geoWarnings: jsonb("geo_warnings"),
  geoRiskClass: text("geo_risk_class"),
  previsitBriefId: uuid("previsit_brief_id"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_scope_drafts_tenant").on(t.tenantId),
  index("idx_scope_drafts_project").on(t.projectId),
  index("idx_scope_drafts_status").on(t.status),
  index("idx_scope_drafts_intake").on(t.intakeFormId),
]);

export type ScopeDraft = typeof scopeDrafts.$inferSelect;
export type InsertScopeDraft = typeof scopeDrafts.$inferInsert;

// APP-ONLY: Scope draft items
export const scopeDraftItems = pgTable("scope_draft_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id").notNull().references(() => scopeDrafts.id, { onDelete: "cascade" }),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "set null" }),
  assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
  assemblyName: text("assembly_name"),
  quantity: numeric("quantity"),
  unit: text("unit"),
  reason: text("reason"),
  confidence: numeric("confidence"),
  overrideType: text("override_type"),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_scope_draft_items_draft").on(t.scopeDraftId),
  index("idx_scope_draft_items_assembly").on(t.assemblyId),
  index("idx_scope_draft_items_cost_code").on(t.costCodeId),
]);

export type ScopeDraftItem = typeof scopeDraftItems.$inferSelect;
export type InsertScopeDraftItem = typeof scopeDraftItems.$inferInsert;

// APP-ONLY: Geographic zones and pricing
export const geoZones = pgTable("geo_zones", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  boundaryGeojson: jsonb("boundary_geojson"),
  costMultiplier: numeric("cost_multiplier").default("1.0").notNull(),
  zoneName: text("zone_name"),
  county: text("county"),
  zipCodes: text("zip_codes").array(),
  centerLat: doublePrecision("center_lat"),
  centerLng: doublePrecision("center_lng"),
  radiusMiles: numeric("radius_miles"),
  coastalExposureLevel: text("coastal_exposure_level"),
  laborModifier: numeric("labor_modifier"),
  materialModifier: numeric("material_modifier"),
  logisticsModifier: numeric("logistics_modifier"),
  logisticsComplexity: text("logistics_complexity"),
  contingencyPct: numeric("contingency_pct"),
  minProfitShieldPct: numeric("min_profit_shield_pct"),
  isActive: boolean("is_active").default(true).notNull(),
  // PHASE 4 — zones become tenant property so a second GC starts with its own, and the
  // configured floor can be compared against what the zone actually delivered (CL-001).
  tenantId: uuid("tenant_id"),
  validatedFloorPct: numeric("validated_floor_pct"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  validationSampleCount: integer("validation_sample_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_geo_zones_tenant").on(t.tenantId),
]);

export type GeoZone = typeof geoZones.$inferSelect;
export type InsertGeoZone = typeof geoZones.$inferInsert;

// APP-ONLY: Scope rules for automation
export const scopeRules = pgTable("scope_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  ruleDefinition: jsonb("rule_definition"),
  ruleCode: text("rule_code"),
  assemblyId: uuid("assembly_id"),
  channel: text("channel"),
  finishLevel: text("finish_level"),
  zone: text("zone"),
  serviceType: text("service_type"),
  projectType: text("project_type"),
  reasonTemplate: text("reason_template"),
  quantityFormula: jsonb("quantity_formula"),
  conditionJson: jsonb("condition_json"),
  isActive: boolean("is_active").default(true).notNull(),
  priority: integer("priority").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScopeRule = typeof scopeRules.$inferSelect;
export type InsertScopeRule = typeof scopeRules.$inferInsert;

// APP-ONLY: Workflow automation
export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workflowName: text("workflow_name").notNull(),
  status: text("status").default("pending").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type InsertWorkflowRun = typeof workflowRuns.$inferInsert;

// APP-ONLY: System settings and configuration
export const systemSettings = pgTable("system_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  settingKey: text("setting_key").notNull().unique(),
  settingValue: jsonb("setting_value"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

// APP-ONLY: Regional modifiers
export const regionalModifiers = pgTable("regional_modifiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  region: text("region").notNull(),
  category: text("category").notNull(),
  multiplier: numeric("multiplier").notNull(),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RegionalModifier = typeof regionalModifiers.$inferSelect;
export type InsertRegionalModifier = typeof regionalModifiers.$inferInsert;

// APP-ONLY: Channel multipliers
export const channelMultipliers = pgTable("channel_multipliers", {
  id: uuid("id").defaultRandom().primaryKey(),
  channel: text("channel").notNull(),
  multiplier: numeric("multiplier").notNull(),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ChannelMultiplier = typeof channelMultipliers.$inferSelect;
export type InsertChannelMultiplier = typeof channelMultipliers.$inferInsert;

// APP-ONLY: Parametric models for estimation
export const parametricModels = pgTable("parametric_models", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  modelType: text("model_type").notNull(),
  formula: jsonb("formula"),
  variables: jsonb("variables"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ParametricModel = typeof parametricModels.$inferSelect;
export type InsertParametricModel = typeof parametricModels.$inferInsert;

// APP-ONLY: Field feedback reports
export const fieldFeedbackReports = pgTable("field_feedback_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  feedbackType: text("feedback_type").notNull(),
  issueCategory: text("issue_category"),
  description: text("description").notNull(),
  attachments: jsonb("attachments"),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_field_feedback_project").on(t.projectId),
  index("idx_field_feedback_status").on(t.status),
]);

export type FieldFeedbackReport = typeof fieldFeedbackReports.$inferSelect;
export type InsertFieldFeedbackReport = typeof fieldFeedbackReports.$inferInsert;

// APP-ONLY: Project actuals tracking
export const projectActuals = pgTable("project_actuals", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateItemId: uuid("estimate_item_id").references(() => estimateItems.id, { onDelete: "set null" }),
  actualQuantity: numeric("actual_quantity"),
  actualCost: numeric("actual_cost"),
  actualLaborHours: numeric("actual_labor_hours"),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "set null" }),
  variancePct: numeric("variance_pct"),
  isHighVariance: boolean("is_high_variance").default(false),
  notes: text("notes"),
  recordedDate: date("recorded_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_project_actuals_tenant").on(t.tenantId),
  index("idx_project_actuals_project").on(t.projectId),
  index("idx_project_actuals_cost_code").on(t.costCodeId),
  index("idx_project_actuals_estimate_item").on(t.estimateItemId),
]);

export type ProjectActual = typeof projectActuals.$inferSelect;
export type InsertProjectActual = typeof projectActuals.$inferInsert;

// APP-ONLY: Review actions and approvals
export const reviewActions = pgTable("review_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  estimateId: uuid("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  reviewerId: uuid("reviewer_id").notNull(),
  action: text("action").notNull(),
  comments: text("comments"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_review_actions_estimate").on(t.estimateId),
  index("idx_review_actions_reviewer").on(t.reviewerId),
]);

export type ReviewAction = typeof reviewActions.$inferSelect;
export type InsertReviewAction = typeof reviewActions.$inferInsert;

// APP-ONLY: Calibration suggestions
export const calibrationSuggestions = pgTable("calibration_suggestions", {
  id: uuid("id").defaultRandom().primaryKey(),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "cascade" }),
  issueName: text("issue_name").notNull(),
  currentValue: numeric("current_value"),
  suggestedValue: numeric("suggested_value"),
  reasoning: text("reasoning"),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CalibrationSuggestion = typeof calibrationSuggestions.$inferSelect;
export type InsertCalibrationSuggestion = typeof calibrationSuggestions.$inferInsert;

// APP-ONLY: Assembly performance metrics
export const assemblyPerformanceMetrics = pgTable("assembly_performance_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  assemblyId: uuid("assembly_id").notNull().references(() => assemblies.id, { onDelete: "cascade" }),
  projectCount: integer("project_count").default(0).notNull(),
  avgActualCost: numeric("avg_actual_cost"),
  avgEstimatedCost: numeric("avg_estimated_cost"),
  costVariancePercent: numeric("cost_variance_percent"),
  assemblyName: text("assembly_name"),
  avgVariancePct: numeric("avg_variance_pct"),
  overrunCount: integer("overrun_count").default(0),
  underrunCount: integer("underrun_count").default(0),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_assembly_perf_assembly").on(t.assemblyId),
]);

export type AssemblyPerformanceMetric = typeof assemblyPerformanceMetrics.$inferSelect;
export type InsertAssemblyPerformanceMetric = typeof assemblyPerformanceMetrics.$inferInsert;

// APP-ONLY: Lead activities
export const leadActivities = pgTable("lead_activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  activityType: text("activity_type").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_lead_activities_lead").on(t.leadId),
]);

export type LeadActivity = typeof leadActivities.$inferSelect;
export type InsertLeadActivity = typeof leadActivities.$inferInsert;

// APP-ONLY: Deals CRM
export const deals = pgTable("deals", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  stage: text("stage").default("discovery").notNull(),
  value: numeric("value"),
  closureDate: date("closure_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_deals_tenant").on(t.tenantId),
  index("idx_deals_lead").on(t.leadId),
  index("idx_deals_stage").on(t.stage),
]);

export type Deal = typeof deals.$inferSelect;
export type InsertDeal = typeof deals.$inferInsert;

// APP-ONLY: Deal activities
export const dealActivities = pgTable("deal_activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  activityType: text("activity_type").notNull(),
  description: text("description"),
  performedBy: uuid("performed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_deal_activities_deal").on(t.dealId),
]);

export type DealActivity = typeof dealActivities.$inferSelect;
export type InsertDealActivity = typeof dealActivities.$inferInsert;

// APP-ONLY: Deal stage history
export const dealStageHistory = pgTable("deal_stage_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  previousStage: text("previous_stage"),
  newStage: text("new_stage").notNull(),
  changedBy: uuid("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_deal_stage_history_deal").on(t.dealId),
]);

export type DealStageHistory = typeof dealStageHistory.$inferSelect;
export type InsertDealStageHistory = typeof dealStageHistory.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// ADDITIONAL APP-ONLY TABLES (Required by server logic)
// ══════════════════════════════════════════════════════════════════════

// APP-ONLY: Clients table
export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  notes: text("notes"),
  isActive: boolean("is_active").default(true).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  // PHASE 2 — canonical client identity + governed origin
  clientType: text("client_type"),
  commercialChannel: text("commercial_channel"),
  sourceChannel: text("source_channel"),
  emailNormalized: text("email_normalized"),
  phoneNormalized: text("phone_normalized"),
  originLeadId: uuid("origin_lead_id"),
}, (t) => [
  index("idx_clients_tenant").on(t.tenantId),
  index("idx_clients_active").on(t.isActive),
  index("idx_clients_email").on(t.email),
  index("idx_clients_email_normalized").on(t.tenantId, t.emailNormalized),
  index("idx_clients_phone_normalized").on(t.tenantId, t.phoneNormalized),
]);

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

// APP-ONLY: Finish Levels
export const finishLevels = pgTable("finish_levels", {
  id: uuid("id").defaultRandom().primaryKey(),
  level: text("level").notNull(),
  trade: text("trade"),
  multiplier: numeric("multiplier").default("1.0").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FinishLevel = typeof finishLevels.$inferSelect;
export type InsertFinishLevel = typeof finishLevels.$inferInsert;

// APP-ONLY: Remodel Templates
export const remodelTemplates = pgTable("remodel_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  scopeJson: jsonb("scope_json"),
  defaultFinishLevel: text("default_finish_level").default("standard"),
  serviceType: text("service_type"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RemodelTemplate = typeof remodelTemplates.$inferSelect;
export type InsertRemodelTemplate = typeof remodelTemplates.$inferInsert;

// APP-ONLY: New Construction Templates
export const newconTemplates = pgTable("newcon_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  scopeJson: jsonb("scope_json"),
  defaultFinishLevel: text("default_finish_level").default("standard"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type NewconTemplate = typeof newconTemplates.$inferSelect;
export type InsertNewconTemplate = typeof newconTemplates.$inferInsert;

// APP-ONLY: System Issue Reports
export const systemIssueReports = pgTable("system_issue_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(),
  severity: text("severity").default("medium").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  metadata: jsonb("metadata"),
  status: text("status").default("open").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SystemIssueReport = typeof systemIssueReports.$inferSelect;
export type InsertSystemIssueReport = typeof systemIssueReports.$inferInsert;

// Type alias for scope rule conditions (used by scope engine)
export type ScopeRuleCondition = {
  field: string;
  op: string;
  operator?: string;
  value: string | number | boolean | string[];
};

// Type aliases for remodel engine
export type WorkflowStep = {
  code: string;
  name?: string;
  label?: string;
  description?: string;
  order: number;
  assemblyIds?: string[];
};

export type RequiredScopeRuleRef = {
  ruleCode: string;
  reason?: string;
  mandatory?: boolean;
};

// ══════════════════════════════════════════════════════════════════════
// ADDITIONAL APP-ONLY TABLES (Required by server modules)
// ══════════════════════════════════════════════════════════════════════

// APP-ONLY: Users alias (old name for profiles — used by rbac, issue-report, etc.)
export const users = profiles;

// APP-ONLY: Scope Review Deltas (Sprint 14)
export const scopeReviewDeltas = pgTable("scope_review_deltas", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id").notNull().references(() => scopeDrafts.id, { onDelete: "cascade" }),
  reviewerId: uuid("reviewer_id"),
  deltaType: text("delta_type").notNull(), // "add" | "remove" | "modify"
  actionType: text("action_type"),
  assemblyId: uuid("assembly_id"),
  costCodeId: uuid("cost_code_id"),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  newQuantity: numeric("new_quantity"),
  previousQuantity: numeric("previous_quantity"),
  reason: text("reason"),
  operatorReason: text("operator_reason"),
  createdBy: uuid("created_by"),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_scope_review_deltas_draft").on(t.scopeDraftId),
  index("idx_scope_review_deltas_status").on(t.status),
]);

export type ScopeReviewDelta = typeof scopeReviewDeltas.$inferSelect;
export type InsertScopeReviewDelta = typeof scopeReviewDeltas.$inferInsert;

// APP-ONLY: Scope Review Snapshots (Sprint 14)
export const scopeReviewSnapshots = pgTable("scope_review_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id").notNull().references(() => scopeDrafts.id, { onDelete: "cascade" }),
  snapshotData: jsonb("snapshot_data"),
  approvedItems: jsonb("approved_items"),
  bundleId: uuid("bundle_id").references(() => bundles.id, { onDelete: "set null" }),
  deltaChanges: jsonb("delta_changes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // PHASE 2 — explicit approval accountability on the snapshot
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  decision: text("decision"),
  deltaCount: integer("delta_count").default(0).notNull(),
}, (t) => [
  index("idx_scope_review_snapshots_draft").on(t.scopeDraftId),
  index("idx_scope_review_snapshots_approver").on(t.approvedBy),
]);

export type ScopeReviewSnapshot = typeof scopeReviewSnapshots.$inferSelect;
export type InsertScopeReviewSnapshot = typeof scopeReviewSnapshots.$inferInsert;

// Type aliases for scope review
export type SnapshotItem = Record<string, unknown>;
export type SnapshotDelta = Record<string, unknown>;

// APP-ONLY: Geographic Overrides (Sprint 16)
export const geographicOverrides = pgTable("geographic_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  zoneId: uuid("zone_id").references(() => geoZones.id, { onDelete: "cascade" }),
  assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "set null" }),
  overrideType: text("override_type").notNull(),
  overrideValue: numeric("override_value"),
  reason: text("reason"),
  zone: text("zone"),
  trade: text("trade"),
  finishLevel: text("finish_level"),
  reasonTemplate: text("reason_template"),
  originalAssemblyId: uuid("original_assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
  replacementAssemblyId: uuid("replacement_assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_geo_overrides_tenant").on(t.tenantId),
  index("idx_geo_overrides_zone").on(t.zoneId),
  index("idx_geo_overrides_assembly").on(t.assemblyId),
  index("idx_geo_overrides_active").on(t.isActive),
]);

export type GeographicOverride = typeof geographicOverrides.$inferSelect;
export type InsertGeographicOverride = typeof geographicOverrides.$inferInsert;

// APP-ONLY: Scope Override Log (Sprint 16)
export const scopeOverrideLog = pgTable("scope_override_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id").notNull().references(() => scopeDrafts.id, { onDelete: "cascade" }),
  overrideId: uuid("override_id").references(() => geographicOverrides.id, { onDelete: "set null" }),
  originalAssemblyId: uuid("original_assembly_id"),
  replacementAssemblyId: uuid("replacement_assembly_id"),
  overrideType: text("override_type"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_scope_override_log_draft").on(t.scopeDraftId),
]);

export type ScopeOverrideLogEntry = typeof scopeOverrideLog.$inferSelect;
export type InsertScopeOverrideLogEntry = typeof scopeOverrideLog.$inferInsert;

// APP-ONLY: Pipeline Partial Drafts (Sprint 20)
export const pipelinePartialDrafts = pgTable("pipeline_partial_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id").references(() => scopeDrafts.id, { onDelete: "cascade" }),
  pipelineStep: text("pipeline_step"),
  partialData: jsonb("partial_data"),
  errorMessage: text("error_message"),
  errorCode: text("error_code"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  userId: uuid("user_id"),
  recoveredEstimateId: uuid("recovered_estimate_id"),
  recoveredAt: timestamp("recovered_at", { withTimezone: true }),
  status: text("status").default("partial").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_pipeline_partial_drafts_draft").on(t.scopeDraftId),
  index("idx_pipeline_partial_drafts_status").on(t.status),
]);

export type PipelinePartialDraft = typeof pipelinePartialDrafts.$inferSelect;
export type InsertPipelinePartialDraft = typeof pipelinePartialDrafts.$inferInsert;

// APP-ONLY: Estimate Variance Events (Sprint 22 - Learning Layer)
export const estimateVarianceEvents = pgTable("estimate_variance_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  estimateItemId: uuid("estimate_item_id").references(() => estimateItems.id, { onDelete: "set null" }),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  estimatedValue: numeric("estimated_value"),
  actualValue: numeric("actual_value"),
  variancePct: numeric("variance_pct"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_variance_events_project").on(t.projectId),
  index("idx_variance_events_cost_code").on(t.costCodeId),
]);

export type EstimateVarianceEvent = typeof estimateVarianceEvents.$inferSelect;
export type InsertEstimateVarianceEvent = typeof estimateVarianceEvents.$inferInsert;

// (EstimateDraftLineItem and EstimateDraftAssemblySelection defined above after estimateDrafts table)

// ══════════════════════════════════════════════════════════════════════
// DRAWING INTAKE LAYER — V1 (TakeOff Module)
// ══════════════════════════════════════════════════════════════════════

// APP-ONLY: Project Drawings — uploaded construction drawings linked to projects
export const projectDrawings = pgTable("project_drawings", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(), // "pdf" | "png" | "jpg" | "tiff"
  storagePath: text("storage_path").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  revisionLabel: text("revision_label").default("A").notNull(),
  sheetLabel: text("sheet_label"), // e.g. "A1", "S2", "MEP-01"
  sheetType: text("sheet_type"), // "floor_plan" | "elevation" | "section" | "detail" | "site" | "other"
  notes: text("notes"),
  isActiveRevision: boolean("is_active_revision").default(true).notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_project_drawings_project").on(t.projectId),
  index("idx_project_drawings_active").on(t.projectId, t.isActiveRevision),
  index("idx_project_drawings_tenant").on(t.tenantId),
]);

export type ProjectDrawing = typeof projectDrawings.$inferSelect;
export type InsertProjectDrawing = typeof projectDrawings.$inferInsert;

// APP-ONLY: Drawing Revision Snapshots — frozen snapshots when a drawing set is finalized
export const drawingRevisionSnapshots = pgTable("drawing_revision_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  revisionLabel: text("revision_label").notNull(),
  drawingIds: jsonb("drawing_ids").notNull(), // string[] — IDs of drawings in this revision
  snapshotData: jsonb("snapshot_data"), // frozen metadata at time of snapshot
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_drawing_snapshots_project").on(t.projectId),
  index("idx_drawing_snapshots_tenant").on(t.tenantId),
]);

export type DrawingRevisionSnapshot = typeof drawingRevisionSnapshots.$inferSelect;
export type InsertDrawingRevisionSnapshot = typeof drawingRevisionSnapshots.$inferInsert;

// APP-ONLY: Scope Sources — unified input layer (manual + drawing + narrative + hybrid)
export const scopeSources = pgTable("scope_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceType: text("source_type").default("manual").notNull(), // "manual" | "drawing" | "narrative" | "hybrid"
  drawingRevisionId: uuid("drawing_revision_id").references(() => drawingRevisionSnapshots.id, { onDelete: "set null" }), // links to drawingRevisionSnapshots if source includes drawing
  intakeFormId: uuid("intake_form_id").references(() => intakeForms.id, { onDelete: "set null" }), // links to intake_forms if source includes manual
  payloadJson: jsonb("payload_json").notNull(), // normalized ScopeSourcePayload
  confidenceSummaryJson: jsonb("confidence_summary_json"), // { measured: N, scaled: N, assumed: N, ai_extracted: N }
  assemblyCandidates: jsonb("assembly_candidates"), // ScopeSourceAssemblyCandidate[]
  assumptions: jsonb("assumptions"), // string[] — explicit assumptions made
  reviewStatus: text("review_status").default("pending").notNull(), // "pending" | "partial" | "approved" | "rejected"
  isActive: boolean("is_active").default(true).notNull(),
  scopeDraftId: uuid("scope_draft_id").references(() => scopeDrafts.id, { onDelete: "set null" }), // set after normalization → scope_draft conversion
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_scope_sources_project").on(t.projectId),
  index("idx_scope_sources_active").on(t.projectId, t.isActive),
  index("idx_scope_sources_tenant").on(t.tenantId),
  index("idx_scope_sources_review_status").on(t.reviewStatus),
]);

export type ScopeSource = typeof scopeSources.$inferSelect;
export type InsertScopeSource = typeof scopeSources.$inferInsert;

// APP-ONLY: RFI Candidates — flagged items that need clarification before scope finalization
export const rfiCandidates = pgTable("rfi_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  scopeSourceId: uuid("scope_source_id").references(() => scopeSources.id, { onDelete: "cascade" }), // which scope source raised this
  drawingId: uuid("drawing_id").references(() => projectDrawings.id, { onDelete: "set null" }), // which drawing raised this (optional)
  category: text("category").notNull(), // "dimension" | "material" | "quantity" | "spec" | "conflict" | "other"
  question: text("question").notNull(),
  context: text("context"), // what triggered the RFI
  suggestedAnswer: text("suggested_answer"),
  resolution: text("resolution"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  status: text("status").default("open").notNull(), // "open" | "resolved" | "dismissed" | "promoted"
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_rfi_candidates_project").on(t.projectId),
  index("idx_rfi_candidates_source").on(t.scopeSourceId),
  index("idx_rfi_candidates_tenant").on(t.tenantId),
  index("idx_rfi_candidates_status").on(t.status),
])

export type RfiCandidate = typeof rfiCandidates.$inferSelect;
export type InsertRfiCandidate = typeof rfiCandidates.$inferInsert;


// ══════════════════════════════════════════════════════════════════════
// PHASE 2 — PRE-VISIT, ESTIMATE VERSIONING, JOBTREAD EXPORT
// See docs/phase2-contract.md
// ══════════════════════════════════════════════════════════════════════

/**
 * Pre-Visit Project Brief — the executive deliverable of the pre-visit.
 * Never carries a definitive price; it carries classified evidence and exactly one
 * next-step recommendation (dossier §3.2).
 */
export const previsitBriefs = pgTable("previsit_briefs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  intakeFormId: uuid("intake_form_id").references(() => intakeForms.id, { onDelete: "set null" }),
  status: text("status").default("draft").notNull(), // "draft" | "completed" | "superseded"
  summary: text("summary"),
  /** Classified evidence items (EvidenceItem[] from shared/previsit-engine.ts) */
  evidenceItems: jsonb("evidence_items").default([]).notNull(),
  /** Aggregated evidence statistics (EvidenceSummary) */
  evidenceSummary: jsonb("evidence_summary").default({}).notNull(),
  factCoveragePct: numeric("fact_coverage_pct"),
  unknownCount: integer("unknown_count").default(0).notNull(),
  inferenceCount: integer("inference_count").default(0).notNull(),
  /** The single main recommendation (PrevisitNextStep) */
  nextStep: text("next_step").notNull(),
  nextStepRationale: text("next_step_rationale"),
  /** Options considered and dropped, with the normalization note */
  discardedNextSteps: jsonb("discarded_next_steps").default([]).notNull(),
  /** Geo warning codes propagated from the geo context */
  geoWarnings: jsonb("geo_warnings").default([]).notNull(),
  warnings: jsonb("warnings").default([]).notNull(),
  /** Always false — enforced by the engine and by the DB default */
  emitsDefinitivePrice: boolean("emits_definitive_price").default(false).notNull(),
  preparedBy: uuid("prepared_by"),
  completedBy: uuid("completed_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_previsit_briefs_tenant").on(t.tenantId),
  index("idx_previsit_briefs_project").on(t.projectId),
  index("idx_previsit_briefs_status").on(t.status),
  index("idx_previsit_briefs_intake").on(t.intakeFormId),
]);

export type PrevisitBriefRow = typeof previsitBriefs.$inferSelect;
export type InsertPrevisitBrief = typeof previsitBriefs.$inferInsert;

/**
 * Field inspection checklist item derived from the brief.
 * Required items block promotion of the brief to "completed".
 */
export const previsitChecklistItems = pgTable("previsit_checklist_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id").notNull().references(() => previsitBriefs.id, { onDelete: "cascade" }),
  itemKey: text("item_key").notNull(),
  section: text("section").notNull(),
  label: text("label").notNull(),
  reason: text("reason"),
  isRequired: boolean("is_required").default(true).notNull(),
  /** Evidence key that generated this item, when applicable */
  sourceKey: text("source_key"),
  status: text("status").default("open").notNull(), // "open" | "captured" | "waived"
  capturedValue: text("captured_value"),
  /** Evidence class assigned when the item was captured in the field */
  capturedEvidence: text("captured_evidence"),
  capturedBy: uuid("captured_by"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  waivedReason: text("waived_reason"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_previsit_checklist_project").on(t.projectId),
  index("idx_previsit_checklist_brief").on(t.briefId),
  index("idx_previsit_checklist_status").on(t.status),
  uniqueIndex("uq_previsit_checklist_brief_key").on(t.briefId, t.itemKey),
]);

export type PrevisitChecklistItem = typeof previsitChecklistItems.$inferSelect;
export type InsertPrevisitChecklistItem = typeof previsitChecklistItems.$inferInsert;

/**
 * JobTread export attempt — immutable per attempt (JIC-014).
 * Re-exporting the same estimate version creates a new row even when the CSV hash matches.
 */
export const jobtreadExports = pgTable("jobtread_exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  estimateDraftId: uuid("estimate_draft_id").references(() => estimateDrafts.id, { onDelete: "cascade" }),
  estimateVersion: integer("estimate_version"),
  contractVersion: text("contract_version").default("csv-v1.0").notNull(),
  /** ExportState from shared/jobtread-reconciliation.ts */
  status: text("status").default("requested").notNull(),
  blockReason: text("block_reason"),
  rowCount: integer("row_count").default(0).notNull(),
  /** Integer cents — reconciliation evidence is never stored as a float */
  approvedTotalCents: integer("approved_total_cents"),
  exportedTotalCents: integer("exported_total_cents"),
  differenceCents: integer("difference_cents"),
  reconciliationStatus: text("reconciliation_status"),
  csvHash: text("csv_hash"),
  /** Per-row manifest including cost code mapping (JIC-005) */
  manifest: jsonb("manifest"),
  validationReport: jsonb("validation_report"),
  skillId: text("skill_id").default("gchi-jobtread-integration-contract").notNull(),
  skillVersion: text("skill_version").default("1.0.0").notNull(),
  requestedBy: uuid("requested_by"),
  downloadedBy: uuid("downloaded_by"),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_jobtread_exports_tenant").on(t.tenantId),
  index("idx_jobtread_exports_project").on(t.projectId),
  index("idx_jobtread_exports_estimate").on(t.estimateDraftId),
  index("idx_jobtread_exports_status").on(t.status),
]);

export type JobtreadExport = typeof jobtreadExports.$inferSelect;
export type InsertJobtreadExport = typeof jobtreadExports.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// PHASE 3 — FIELD EXECUTION, REAL COST, SUBCONTRACTORS AND CLOSEOUT
// docs/phase3-contract.md
//
// Design rules of this block:
//   1. every row carries tenant_id and (except subcontractors) project_id — a real cost
//      without a canonical project is exactly the parallel-spreadsheet failure the dossier
//      forbids;
//   2. money is stored as INTEGER CENTS, never numeric/float, so the cost ledger rounds
//      identically to the JobTread reconciliation;
//   3. the approved estimate is referenced explicitly (budget_estimate_draft_id) and the
//      change order scope is separated (change_order_id).
// ══════════════════════════════════════════════════════════════════════

/**
 * Subcontractors — tenant-level trade partners.
 *
 * Not project-scoped on purpose: the same company works across projects, and performance
 * is only meaningful when accumulated across them. What belongs to a project is the
 * assignment (field_tasks) and the cost (project_cost_actuals).
 */
export const subcontractors = pgTable("subcontractors", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  /** Canonical lowercase key used to prevent duplicated vendor records. */
  nameNormalized: text("name_normalized").notNull(),
  /** Trade from shared/domain/taxonomy.ts TRADES. */
  trade: text("trade").notNull(),
  companyType: text("company_type"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  address: text("address"),
  city: text("city"),
  state: text("state").default("SC"),
  zip: text("zip"),
  // Compliance (SC-001)
  licenseNumber: text("license_number"),
  licenseExpiry: date("license_expiry"),
  insuranceCarrier: text("insurance_carrier"),
  insurancePolicyNumber: text("insurance_policy_number"),
  insuranceExpiry: date("insurance_expiry"),
  insuranceCoverageCents: integer("insurance_coverage_cents"),
  workersCompExpiry: date("workers_comp_expiry"),
  w9OnFile: boolean("w9_on_file").default(false).notNull(),
  complianceState: text("compliance_state").default("missing").notNull(),
  // Operator-declared rating (0–5) — kept separate from the derived metrics below
  rating: numeric("rating"),
  // Derived performance (SC-003) — recomputed from tasks/actuals, never hand-typed
  onTimePct: numeric("on_time_pct"),
  qualityScore: numeric("quality_score"),
  costVarianceAvgPct: numeric("cost_variance_avg_pct"),
  derivedRating: numeric("derived_rating"),
  completedTaskCount: integer("completed_task_count").default(0).notNull(),
  committedCostCents: integer("committed_cost_cents").default(0).notNull(),
  performanceComputedAt: timestamp("performance_computed_at", { withTimezone: true }),
  /** SubcontractorStatus from shared/domain/phase3-taxonomy.ts */
  status: text("status").default("active").notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_subcontractors_tenant").on(t.tenantId),
  index("idx_subcontractors_trade").on(t.trade),
  index("idx_subcontractors_status").on(t.status),
  index("idx_subcontractors_insurance_expiry").on(t.insuranceExpiry),
  index("idx_subcontractors_license_expiry").on(t.licenseExpiry),
  uniqueIndex("uq_subcontractors_tenant_name_trade").on(t.tenantId, t.nameNormalized, t.trade),
]);

export type Subcontractor = typeof subcontractors.$inferSelect;
export type InsertSubcontractor = typeof subcontractors.$inferInsert;

/**
 * Field tasks — the unit of execution in the field.
 *
 * A task may only exist for a project that already has an approved estimate
 * (budget_estimate_draft_id, FO-001): work without approved money is exactly what Phase 2
 * made impossible on the commercial side.
 */
export const fieldTasks = pgTable("field_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** Approved estimate this task executes against (FO-001). */
  budgetEstimateDraftId: uuid("budget_estimate_draft_id").references(() => estimateDrafts.id, { onDelete: "set null" }),
  /** Populated when the task came from an approved change order (§7). */
  changeOrderId: uuid("change_order_id").references(() => estimateDrafts.id, { onDelete: "set null" }),
  /** Idempotency key for change-order-derived tasks: `{changeOrderId}:{taskKey}`. */
  sourceKey: text("source_key"),
  /** FieldTaskSource from shared/domain/phase3-taxonomy.ts */
  source: text("source").default("manual").notNull(),
  /** FieldTaskType from shared/domain/phase3-taxonomy.ts */
  taskType: text("task_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  /** FieldTaskStatus from shared/domain/phase3-taxonomy.ts */
  status: text("status").default("pending").notNull(),
  sequence: integer("sequence").default(0).notNull(),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "set null" }),
  costCode: text("cost_code"),
  assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
  estimateItemId: uuid("estimate_item_id").references(() => estimateItems.id, { onDelete: "set null" }),
  quantity: numeric("quantity"),
  unit: text("unit"),
  /** Budgeted cost for this task, integer cents. */
  budgetedCostCents: integer("budgeted_cost_cents"),
  // Assignment (FO-002)
  /** FieldAssigneeType from shared/domain/phase3-taxonomy.ts */
  assigneeType: text("assignee_type"),
  subcontractorId: uuid("subcontractor_id").references(() => subcontractors.id, { onDelete: "set null" }),
  assigneeName: text("assignee_name"),
  assignedUserId: uuid("assigned_user_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  assignedBy: uuid("assigned_by"),
  // Schedule (FO-003)
  plannedStartDate: date("planned_start_date"),
  plannedEndDate: date("planned_end_date"),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  plannedHours: numeric("planned_hours"),
  actualHours: numeric("actual_hours"),
  // Quality (FO-004) and blocking (FO-005)
  verifiedBy: uuid("verified_by"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verificationNotes: text("verification_notes"),
  blockReason: text("block_reason"),
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  reworkCount: integer("rework_count").default(0).notNull(),
  photosCount: integer("photos_count").default(0).notNull(),
  requiresInspection: boolean("requires_inspection").default(false).notNull(),
  inspectionPassed: boolean("inspection_passed"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_field_tasks_tenant").on(t.tenantId),
  index("idx_field_tasks_project").on(t.projectId),
  index("idx_field_tasks_status").on(t.status),
  index("idx_field_tasks_project_status").on(t.projectId, t.status),
  index("idx_field_tasks_type").on(t.taskType),
  index("idx_field_tasks_subcontractor").on(t.subcontractorId),
  index("idx_field_tasks_budget_estimate").on(t.budgetEstimateDraftId),
  index("idx_field_tasks_change_order").on(t.changeOrderId),
  index("idx_field_tasks_planned_end").on(t.plannedEndDate),
  uniqueIndex("uq_field_tasks_source_key").on(t.projectId, t.sourceKey),
]);

export type FieldTask = typeof fieldTasks.$inferSelect;
export type InsertFieldTask = typeof fieldTasks.$inferInsert;

/**
 * Project cost actuals — the real cost ledger.
 *
 * Named `project_cost_actuals` to avoid colliding with the legacy `project_actuals` table
 * (a thin quantity/variance record from an earlier sprint). This table is the Phase 3
 * contract: cost code mandatory, approved-estimate baseline mandatory, integer cents.
 */
export const projectCostActuals = pgTable("project_cost_actuals", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** Approved estimate serving as the budget baseline (AC-001). */
  budgetEstimateDraftId: uuid("budget_estimate_draft_id").references(() => estimateDrafts.id, { onDelete: "set null" }),
  /** Present when the cost belongs to a change order scope (§7). */
  changeOrderId: uuid("change_order_id").references(() => estimateDrafts.id, { onDelete: "set null" }),
  fieldTaskId: uuid("field_task_id").references(() => fieldTasks.id, { onDelete: "set null" }),
  estimateItemId: uuid("estimate_item_id").references(() => estimateItems.id, { onDelete: "set null" }),
  assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "set null" }),
  /** Textual cost code snapshot (AC-002) — preserved even if the catalog changes. */
  costCode: text("cost_code"),
  costCodeName: text("cost_code_name"),
  /** ActualCostCategory from shared/domain/phase3-taxonomy.ts */
  category: text("category").default("other").notNull(),
  description: text("description"),
  // Money — integer cents only
  amountCents: integer("amount_cents").notNull(),
  estimatedAmountCents: integer("estimated_amount_cents"),
  varianceCents: integer("variance_cents"),
  variancePct: numeric("variance_pct"),
  /** VarianceSeverity from shared/domain/phase3-taxonomy.ts */
  varianceSeverity: text("variance_severity"),
  quantity: numeric("quantity"),
  unit: text("unit"),
  laborHours: numeric("labor_hours"),
  // Payee
  vendorName: text("vendor_name"),
  subcontractorId: uuid("subcontractor_id").references(() => subcontractors.id, { onDelete: "set null" }),
  invoiceRef: text("invoice_ref"),
  invoiceDate: date("invoice_date"),
  dateIncurred: date("date_incurred").notNull(),
  // Lifecycle (AC-004)
  /** ActualStatus from shared/domain/phase3-taxonomy.ts */
  status: text("status").default("pending").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidBy: uuid("paid_by"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  voidReason: text("void_reason"),
  /** Human review of a critical/unbudgeted variance (CO-003). */
  varianceReviewed: boolean("variance_reviewed").default(false).notNull(),
  varianceReviewedBy: uuid("variance_reviewed_by"),
  varianceReviewedAt: timestamp("variance_reviewed_at", { withTimezone: true }),
  varianceReason: text("variance_reason"),
  receiptUrl: text("receipt_url"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  recordedBy: uuid("recorded_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_pca_tenant").on(t.tenantId),
  index("idx_pca_project").on(t.projectId),
  index("idx_pca_status").on(t.status),
  index("idx_pca_project_status").on(t.projectId, t.status),
  index("idx_pca_cost_code").on(t.costCodeId),
  index("idx_pca_cost_code_text").on(t.projectId, t.costCode),
  index("idx_pca_field_task").on(t.fieldTaskId),
  index("idx_pca_subcontractor").on(t.subcontractorId),
  index("idx_pca_budget_estimate").on(t.budgetEstimateDraftId),
  index("idx_pca_change_order").on(t.changeOrderId),
  index("idx_pca_date_incurred").on(t.dateIncurred),
  index("idx_pca_severity").on(t.varianceSeverity),
]);

export type ProjectCostActual = typeof projectCostActuals.$inferSelect;
export type InsertProjectCostActual = typeof projectCostActuals.$inferInsert;

/**
 * Daily logs — one field report per project per day (DL-001).
 *
 * The unique constraint is the point: two logs for the same day means two versions of what
 * happened on site, and neither can be used as evidence later.
 */
export const dailyLogs = pgTable("daily_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  logDate: date("log_date").notNull(),
  /** WeatherCondition from shared/domain/phase3-taxonomy.ts */
  weather: text("weather"),
  temperatureF: integer("temperature_f"),
  /** True when weather stopped exterior work. */
  weatherDelay: boolean("weather_delay").default(false).notNull(),
  crewCount: integer("crew_count").default(0).notNull(),
  subcontractorsOnSite: jsonb("subcontractors_on_site"),
  workPerformed: text("work_performed"),
  issues: text("issues"),
  delays: text("delays"),
  delayHours: numeric("delay_hours"),
  materialsDelivered: text("materials_delivered"),
  visitors: text("visitors"),
  inspectionsToday: text("inspections_today"),
  photosCount: integer("photos_count").default(0).notNull(),
  photoUrls: jsonb("photo_urls"),
  safetyIncidents: integer("safety_incidents").default(0).notNull(),
  safetyIncidentDetails: text("safety_incident_details"),
  safetyIncidentResolved: boolean("safety_incident_resolved").default(false).notNull(),
  laborHoursTotal: numeric("labor_hours_total"),
  /** GPS capture inherited from the GC Clock migration (dossier §3.5). */
  gpsLatitude: numeric("gps_latitude"),
  gpsLongitude: numeric("gps_longitude"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_daily_logs_tenant").on(t.tenantId),
  index("idx_daily_logs_project").on(t.projectId),
  index("idx_daily_logs_date").on(t.logDate),
  uniqueIndex("uq_daily_logs_project_date").on(t.projectId, t.logDate),
]);

export type DailyLog = typeof dailyLogs.$inferSelect;
export type InsertDailyLog = typeof dailyLogs.$inferInsert;

/**
 * Project closeouts — formal end of the job and the home of the final variance snapshot.
 *
 * The final report is persisted, not recomputed: a closed project must keep the numbers it
 * was closed with, even after the price book moves.
 */
export const projectCloseouts = pgTable("project_closeouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  budgetEstimateDraftId: uuid("budget_estimate_draft_id").references(() => estimateDrafts.id, { onDelete: "set null" }),
  /** CloseoutStatus from shared/domain/phase3-taxonomy.ts */
  status: text("status").default("open").notNull(),
  // Checklist (CO-002)
  finalInspectionPassed: boolean("final_inspection_passed").default(false).notNull(),
  finalInspectionDate: date("final_inspection_date"),
  finalInspectionBy: uuid("final_inspection_by"),
  punchListComplete: boolean("punch_list_complete").default(false).notNull(),
  punchListItemCount: integer("punch_list_item_count").default(0).notNull(),
  lienWaiversCollected: boolean("lien_waivers_collected").default(false).notNull(),
  lienWaiverCount: integer("lien_waiver_count").default(0).notNull(),
  finalPaymentReceived: boolean("final_payment_received").default(false).notNull(),
  finalPaymentCents: integer("final_payment_cents"),
  finalPaymentDate: date("final_payment_date"),
  warrantyDocsDelivered: boolean("warranty_docs_delivered").default(false).notNull(),
  warrantyDocsRef: text("warranty_docs_ref"),
  warrantyExpiry: date("warranty_expiry"),
  clientSatisfactionScore: integer("client_satisfaction_score"),
  clientFeedback: text("client_feedback"),
  checklistCompletionPct: numeric("checklist_completion_pct"),
  // Final variance snapshot (immutable evidence)
  baselineEstimatedCents: integer("baseline_estimated_cents"),
  changeOrderEstimatedCents: integer("change_order_estimated_cents"),
  totalEstimatedCents: integer("total_estimated_cents"),
  baselineActualCents: integer("baseline_actual_cents"),
  changeOrderActualCents: integer("change_order_actual_cents"),
  totalActualCents: integer("total_actual_cents"),
  finalVarianceCents: integer("final_variance_cents"),
  finalVariancePct: numeric("final_variance_pct"),
  finalVarianceSeverity: text("final_variance_severity"),
  approvedSellPriceCents: integer("approved_sell_price_cents"),
  realizedGrossProfitCents: integer("realized_gross_profit_cents"),
  realizedGrossProfitPct: numeric("realized_gross_profit_pct"),
  varianceReport: jsonb("variance_report"),
  varianceThresholdPct: numeric("variance_threshold_pct"),
  blockers: jsonb("blockers"),
  lessonsLearned: text("lessons_learned"),
  notes: text("notes"),
  openedBy: uuid("opened_by"),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  closedBy: uuid("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_project_closeouts_tenant").on(t.tenantId),
  index("idx_project_closeouts_status").on(t.status),
  index("idx_project_closeouts_estimate").on(t.budgetEstimateDraftId),
  uniqueIndex("uq_project_closeouts_project_active").on(t.projectId),
]);

export type ProjectCloseout = typeof projectCloseouts.$inferSelect;
export type InsertProjectCloseout = typeof projectCloseouts.$inferInsert;

/**
 * Field task events — append-only audit of every state transition.
 *
 * The audit_logs table records that a change happened; this table records the operational
 * story of the task (who moved it, from what, to what, and why), which is what a dispute
 * about schedule or backcharge actually needs.
 */
export const fieldTaskEvents = pgTable("field_task_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fieldTaskId: uuid("field_task_id").notNull().references(() => fieldTasks.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  reason: text("reason"),
  actorId: uuid("actor_id"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_field_task_events_task").on(t.fieldTaskId),
  index("idx_field_task_events_project").on(t.projectId),
  index("idx_field_task_events_created").on(t.createdAt),
]);

export type FieldTaskEvent = typeof fieldTaskEvents.$inferSelect;
export type InsertFieldTaskEvent = typeof fieldTaskEvents.$inferInsert;


// ══════════════════════════════════════════════════════════════════════
// PHASE 4 — CONTROLLED LEARNING AND REPLICABLE PRODUCT
// docs/phase4-contract.md
//
// Design rules of this block:
//   1. every row carries tenant_id — Phase 4 is the phase where a second company becomes
//      possible, so a table without a tenant is a data leak waiting to happen;
//   2. money stays in INTEGER CENTS and percentages stay in numeric, never mixed;
//   3. learning is EVIDENCE, not authority: a calibration event may propose, only a human
//      may approve, and the applied adjustment keeps a reversible snapshot;
//   4. the audit trail is append-only and carries both snapshots for money/permission acts.
// ══════════════════════════════════════════════════════════════════════

/**
 * Tenant settings — per-company configuration of the same platform.
 *
 * Kept as a separate table rather than growing `tenants.settings` JSONB because these
 * values gate behaviour (margin floors, active modules) and must be constrainable,
 * indexable and auditable column by column.
 */
export const tenantSettings = pgTable("tenant_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  // ── Commercial defaults ────────────────────────────────────────────
  /** Default pricing channel used when the intake does not declare one. */
  defaultChannel: text("default_channel").default("direct").notNull(),
  /** Default commercial channel (premium | trade | capital). */
  defaultCommercialChannel: text("default_commercial_channel").default("premium").notNull(),
  geoRegion: text("geo_region").default("charleston_sc").notNull(),
  defaultGeoRiskClass: text("default_geo_risk_class").default("coastal").notNull(),
  timezone: text("timezone").default("America/New_York").notNull(),
  currency: text("currency").default("USD").notNull(),
  locale: text("locale").default("en-US").notNull(),
  /** Supported document/UI languages for this tenant. */
  supportedLocales: jsonb("supported_locales").default(["en-US"]),
  // ── Profit Shield overrides (never below the platform floor) ───────
  /**
   * Per-channel margin floor overrides, e.g. `{ "premium": 32, "trade": 20 }`.
   * The effective floor is always MAX(platform floor, tenant override, geo floor):
   * a tenant may be stricter than the platform, never looser.
   */
  profitShieldOverrides: jsonb("profit_shield_overrides").default({}),
  /** Per-risk-class geo floor overrides, e.g. `{ "coastal": 45 }`. */
  geoFloorOverrides: jsonb("geo_floor_overrides").default({}),
  varianceThresholdPct: numeric("variance_threshold_pct").default("10").notNull(),
  biasTolerancePct: numeric("bias_tolerance_pct").default("5").notNull(),
  maxAdjustmentPct: numeric("max_adjustment_pct").default("25").notNull(),
  /** Guard PA-002: automatic application of a calibration proposal is never allowed. */
  autoApplyAdjustments: boolean("auto_apply_adjustments").default(false).notNull(),
  // ── Branding ───────────────────────────────────────────────────────
  brandName: text("brand_name"),
  brandLegalName: text("brand_legal_name"),
  brandLogoUrl: text("brand_logo_url"),
  brandPrimaryColor: text("brand_primary_color"),
  brandSecondaryColor: text("brand_secondary_color"),
  brandEmailSignature: text("brand_email_signature"),
  brandLicenseNumber: text("brand_license_number"),
  brandContactPhone: text("brand_contact_phone"),
  brandContactEmail: text("brand_contact_email"),
  brandAddress: text("brand_address"),
  proposalFooterText: text("proposal_footer_text"),
  // ── Feature flags (MT-001) ─────────────────────────────────────────
  /** Array of `TenantFeatureFlag`. Mandatory flags cannot be absent. */
  featureFlags: jsonb("feature_flags").default([]),
  /** Integration configuration (JobTread contract version, storage bucket, ...). */
  integrations: jsonb("integrations").default({}),
  // ── Onboarding (MT-002) ────────────────────────────────────────────
  /** TenantOnboardingStatus */
  onboardingStatus: text("onboarding_status").default("not_started").notNull(),
  /** Map of step → { completed, completedAt, completedBy, notes }. */
  onboardingSteps: jsonb("onboarding_steps").default({}),
  onboardingCompletionPct: numeric("onboarding_completion_pct").default("0").notNull(),
  onboardingStartedAt: timestamp("onboarding_started_at", { withTimezone: true }),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  isDemo: boolean("is_demo").default(false).notNull(),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_tenant_settings_tenant").on(t.tenantId),
  index("idx_tenant_settings_onboarding").on(t.onboardingStatus),
  index("idx_tenant_settings_region").on(t.geoRegion),
]);

export type TenantSettings = typeof tenantSettings.$inferSelect;
export type InsertTenantSettings = typeof tenantSettings.$inferInsert;

/**
 * Calibration events — one measured finding about estimating accuracy.
 *
 * A row is evidence produced from closed work: it names the target (cost code, assembly,
 * trade, geo zone), the measured deviation, the sample size and the confidence. It never
 * changes a price by itself; that requires a `price_adjustments` row approved by a human.
 */
export const calibrationEvents = pgTable("calibration_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  /** Null for tenant-level aggregations (CL-003). */
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  closeoutId: uuid("closeout_id").references(() => projectCloseouts.id, { onDelete: "set null" }),
  /** Approved estimate the finding was measured against. */
  budgetEstimateDraftId: uuid("budget_estimate_draft_id").references(() => estimateDrafts.id, { onDelete: "set null" }),
  /** CalibrationEventType from shared/domain/phase4-taxonomy.ts */
  eventType: text("event_type").notNull(),
  /** CalibrationScope: `project` | `tenant`. */
  scope: text("scope").default("project").notNull(),
  /** CalibrationPeriod of a tenant aggregation. */
  period: text("period").default("project").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  /** CalibrationEventStatus */
  status: text("status").default("open").notNull(),
  // ── Target of the finding ──────────────────────────────────────────
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "set null" }),
  costCode: text("cost_code"),
  assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "set null" }),
  trade: text("trade"),
  geoZoneId: uuid("geo_zone_id").references(() => geoZones.id, { onDelete: "set null" }),
  geoZoneName: text("geo_zone_name"),
  geoRiskClass: text("geo_risk_class"),
  projectType: text("project_type"),
  commercialChannel: text("commercial_channel"),
  /** Stable key used for idempotent upsert: `{type}:{scope}:{target}:{period}`. */
  findingKey: text("finding_key").notNull(),
  // ── Measurement (money in integer cents, durations in days) ────────
  estimatedCents: integer("estimated_cents"),
  actualCents: integer("actual_cents"),
  varianceCents: integer("variance_cents"),
  variancePct: numeric("variance_pct"),
  estimatedDurationDays: numeric("estimated_duration_days"),
  actualDurationDays: numeric("actual_duration_days"),
  durationVarianceDays: numeric("duration_variance_days"),
  /** Observed value of the factor under test (e.g. configured coastal floor 42). */
  observedFactor: numeric("observed_factor"),
  /** Value the evidence supports (e.g. realized floor 45). */
  suggestedFactor: numeric("suggested_factor"),
  // ── Bias and confidence (§2, CL-004) ──────────────────────────────
  /** BiasDirection */
  biasDirection: text("bias_direction"),
  /** Mean deviation across the samples, percent. */
  meanDeviationPct: numeric("mean_deviation_pct"),
  /** Median deviation, percent — resistant to a single outlier project. */
  medianDeviationPct: numeric("median_deviation_pct"),
  /** Standard deviation of the sample deviations, percent. */
  deviationStdDevPct: numeric("deviation_std_dev_pct"),
  sampleCount: integer("sample_count").default(0).notNull(),
  overrunCount: integer("overrun_count").default(0).notNull(),
  underrunCount: integer("underrun_count").default(0).notNull(),
  /** 0–100. */
  confidenceScore: numeric("confidence_score"),
  /** ConfidenceBand derived from the score and the sample count. */
  confidenceBand: text("confidence_band").default("insufficient").notNull(),
  // ── Recommendation (never applied automatically) ───────────────────
  /** Damped, capped adjustment the evidence supports, percent. */
  suggestedAdjustmentPct: numeric("suggested_adjustment_pct"),
  recommendation: text("recommendation"),
  rationale: text("rationale"),
  /** Machine-readable evidence: per-sample deviations, project ids, cost codes. */
  evidence: jsonb("evidence"),
  /** Set when this finding produced a proposal. */
  priceAdjustmentId: uuid("price_adjustment_id"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  supersededBy: uuid("superseded_by"),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_calibration_events_tenant").on(t.tenantId),
  index("idx_calibration_events_project").on(t.projectId),
  index("idx_calibration_events_type").on(t.eventType),
  index("idx_calibration_events_status").on(t.status),
  index("idx_calibration_events_tenant_type").on(t.tenantId, t.eventType),
  index("idx_calibration_events_cost_code").on(t.costCodeId),
  index("idx_calibration_events_assembly").on(t.assemblyId),
  index("idx_calibration_events_geo_zone").on(t.geoZoneId),
  index("idx_calibration_events_band").on(t.confidenceBand),
  index("idx_calibration_events_closeout").on(t.closeoutId),
  /** Idempotency: recomputing the same finding updates it instead of duplicating it. */
  uniqueIndex("uq_calibration_events_finding").on(t.tenantId, t.findingKey),
]);

export type CalibrationEvent = typeof calibrationEvents.$inferSelect;
export type InsertCalibrationEvent = typeof calibrationEvents.$inferInsert;

/**
 * Calibration reports — the persisted snapshot of a calibration run.
 *
 * Per project (after closeout) and per tenant (aggregated period). Persisted rather than
 * recomputed so a decision taken in Q3 can still be explained with the numbers of Q3.
 */
export const calibrationReports = pgTable("calibration_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  /** Null for tenant-level reports. */
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  closeoutId: uuid("closeout_id").references(() => projectCloseouts.id, { onDelete: "set null" }),
  /** CalibrationScope */
  scope: text("scope").default("project").notNull(),
  /** CalibrationPeriod */
  period: text("period").default("project").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  /** Stable key for idempotent regeneration. */
  reportKey: text("report_key").notNull(),
  projectCount: integer("project_count").default(0).notNull(),
  eventCount: integer("event_count").default(0).notNull(),
  // Aggregate accuracy
  totalEstimatedCents: integer("total_estimated_cents").default(0).notNull(),
  totalActualCents: integer("total_actual_cents").default(0).notNull(),
  totalVarianceCents: integer("total_variance_cents").default(0).notNull(),
  totalVariancePct: numeric("total_variance_pct"),
  meanAbsDeviationPct: numeric("mean_abs_deviation_pct"),
  /** Weighted 0–100 accuracy score of the estimating engine for the period. */
  accuracyScore: numeric("accuracy_score"),
  scopeCompletenessScore: numeric("scope_completeness_score"),
  /** ScopeCompletenessVerdict */
  scopeCompletenessVerdict: text("scope_completeness_verdict"),
  durationAccuracyPct: numeric("duration_accuracy_pct"),
  realizedGrossProfitPct: numeric("realized_gross_profit_pct"),
  estimatedGrossProfitPct: numeric("estimated_gross_profit_pct"),
  /** Cost codes with a consistent bias, ordered by money impact. */
  biasedCostCodes: jsonb("biased_cost_codes"),
  assembliesNeedingReview: jsonb("assemblies_needing_review"),
  geoFactorFindings: jsonb("geo_factor_findings"),
  durationFindings: jsonb("duration_findings"),
  scopeGapFindings: jsonb("scope_gap_findings"),
  proposedAdjustments: jsonb("proposed_adjustments"),
  /** Full immutable snapshot of the report as generated. */
  reportSnapshot: jsonb("report_snapshot"),
  summary: text("summary"),
  generatedBy: uuid("generated_by"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_calibration_reports_tenant").on(t.tenantId),
  index("idx_calibration_reports_project").on(t.projectId),
  index("idx_calibration_reports_scope").on(t.scope),
  index("idx_calibration_reports_period").on(t.tenantId, t.period, t.periodStart),
  uniqueIndex("uq_calibration_reports_key").on(t.tenantId, t.reportKey),
]);

export type CalibrationReport = typeof calibrationReports.$inferSelect;
export type InsertCalibrationReport = typeof calibrationReports.$inferInsert;

/**
 * Price adjustments — the only legitimate path from learning to the price book.
 *
 * `proposed → approved → applied`, with `rolled_back` preserving history. The row stores
 * the before/after value so a rollback restores exactly what was replaced (PA-004): a
 * price book that cannot be reverted is a price book nobody will let the system touch.
 */
export const priceAdjustments = pgTable("price_adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  /** PriceAdjustmentTarget */
  targetType: text("target_type").default("cost_code").notNull(),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "cascade" }),
  costCode: text("cost_code"),
  assemblyId: uuid("assembly_id").references(() => assemblies.id, { onDelete: "cascade" }),
  geoZoneId: uuid("geo_zone_id").references(() => geoZones.id, { onDelete: "cascade" }),
  trade: text("trade"),
  /** Percentage change requested; sign carries the direction. */
  adjustmentPct: numeric("adjustment_pct").notNull(),
  /** Value before the adjustment (unit cost in cents, or factor value). */
  previousValue: numeric("previous_value"),
  /** Value after the adjustment. */
  newValue: numeric("new_value"),
  previousUnitCostCents: integer("previous_unit_cost_cents"),
  newUnitCostCents: integer("new_unit_cost_cents"),
  reason: text("reason").notNull(),
  /** The calibration event that produced the proposal (null when entered by hand). */
  sourceCalibrationId: uuid("source_calibration_id").references(() => calibrationEvents.id, { onDelete: "set null" }),
  sourceReportId: uuid("source_report_id").references(() => calibrationReports.id, { onDelete: "set null" }),
  /** "calibration" | "manual" | "import" */
  source: text("source").default("calibration").notNull(),
  confidenceScore: numeric("confidence_score"),
  confidenceBand: text("confidence_band"),
  sampleCount: integer("sample_count").default(0).notNull(),
  /** PriceAdjustmentStatus */
  status: text("status").default("proposed").notNull(),
  proposedBy: uuid("proposed_by"),
  proposedAt: timestamp("proposed_at", { withTimezone: true }).defaultNow().notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  appliedBy: uuid("applied_by"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  rejectedBy: uuid("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  rolledBackBy: uuid("rolled_back_by"),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  rollbackReason: text("rollback_reason"),
  /** Pricing history row created when the adjustment was applied — the rollback anchor. */
  appliedPricingHistoryId: uuid("applied_pricing_history_id"),
  /** Snapshot of the target before application, for exact restoration. */
  rollbackSnapshot: jsonb("rollback_snapshot"),
  effectiveFrom: date("effective_from"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_price_adjustments_tenant").on(t.tenantId),
  index("idx_price_adjustments_status").on(t.status),
  index("idx_price_adjustments_cost_code").on(t.costCodeId),
  index("idx_price_adjustments_assembly").on(t.assemblyId),
  index("idx_price_adjustments_geo_zone").on(t.geoZoneId),
  index("idx_price_adjustments_source").on(t.sourceCalibrationId),
  index("idx_price_adjustments_tenant_status").on(t.tenantId, t.status),
  index("idx_price_adjustments_applied_at").on(t.appliedAt),
]);

export type PriceAdjustment = typeof priceAdjustments.$inferSelect;
export type InsertPriceAdjustment = typeof priceAdjustments.$inferInsert;

/**
 * Scope completeness scores — approved scope vs executed scope, per project.
 *
 * The interesting output is not the score, it is `missingItems`: the recurring gaps
 * ("trim always forgotten on a bathroom remodel") that become the next checklist.
 */
export const scopeCompletenessScores = pgTable("scope_completeness_scores", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  closeoutId: uuid("closeout_id").references(() => projectCloseouts.id, { onDelete: "set null" }),
  budgetEstimateDraftId: uuid("budget_estimate_draft_id").references(() => estimateDrafts.id, { onDelete: "set null" }),
  projectType: text("project_type"),
  commercialChannel: text("commercial_channel"),
  /** 0–100. */
  score: numeric("score").notNull(),
  /** ScopeCompletenessVerdict */
  verdict: text("verdict").notNull(),
  plannedItemCount: integer("planned_item_count").default(0).notNull(),
  executedItemCount: integer("executed_item_count").default(0).notNull(),
  matchedItemCount: integer("matched_item_count").default(0).notNull(),
  missingItemCount: integer("missing_item_count").default(0).notNull(),
  unplannedItemCount: integer("unplanned_item_count").default(0).notNull(),
  /** Money executed without a matching approved scope line. */
  unplannedCostCents: integer("unplanned_cost_cents").default(0).notNull(),
  /** Approved scope lines that never received cost. */
  unexecutedCostCents: integer("unexecuted_cost_cents").default(0).notNull(),
  /** Cost codes present in the actuals but absent from the approved scope. */
  missingItems: jsonb("missing_items"),
  /** Approved scope lines with no execution. */
  unexecutedItems: jsonb("unexecuted_items"),
  changeOrderCoveredCount: integer("change_order_covered_count").default(0).notNull(),
  summary: text("summary"),
  computedBy: uuid("computed_by"),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_scope_completeness_tenant").on(t.tenantId),
  index("idx_scope_completeness_project").on(t.projectId),
  index("idx_scope_completeness_verdict").on(t.verdict),
  index("idx_scope_completeness_type").on(t.tenantId, t.projectType),
  uniqueIndex("uq_scope_completeness_project").on(t.projectId),
]);

export type ScopeCompletenessScore = typeof scopeCompletenessScores.$inferSelect;
export type InsertScopeCompletenessScore = typeof scopeCompletenessScores.$inferInsert;

/**
 * Scope checklist patterns — recurring omissions promoted to a reusable checklist.
 *
 * Aggregated per (tenant, project type, cost code). The row survives across projects: it is
 * the institutional memory that replaces "I always forget this".
 */
export const scopeChecklistPatterns = pgTable("scope_checklist_patterns", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectType: text("project_type").notNull(),
  costCodeId: uuid("cost_code_id").references(() => costCodes.id, { onDelete: "set null" }),
  costCode: text("cost_code").notNull(),
  costCodeName: text("cost_code_name"),
  trade: text("trade"),
  /** Number of projects of this type where the item was executed but not planned. */
  occurrenceCount: integer("occurrence_count").default(0).notNull(),
  /** Number of projects of this type observed in total. */
  projectCount: integer("project_count").default(0).notNull(),
  /** occurrenceCount / projectCount, 0–1. */
  frequency: numeric("frequency"),
  avgUnplannedCents: integer("avg_unplanned_cents").default(0).notNull(),
  totalUnplannedCents: integer("total_unplanned_cents").default(0).notNull(),
  confidenceScore: numeric("confidence_score"),
  confidenceBand: text("confidence_band").default("insufficient").notNull(),
  /** True when the pattern is above the frequency threshold and should be suggested. */
  isRecurring: boolean("is_recurring").default(false).notNull(),
  suggestion: text("suggestion"),
  /** Project ids that produced the pattern, for drill-down. */
  evidence: jsonb("evidence"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_scope_patterns_tenant").on(t.tenantId),
  index("idx_scope_patterns_type").on(t.tenantId, t.projectType),
  index("idx_scope_patterns_recurring").on(t.isRecurring),
  uniqueIndex("uq_scope_patterns_target").on(t.tenantId, t.projectType, t.costCode),
]);

export type ScopeChecklistPattern = typeof scopeChecklistPatterns.$inferSelect;
export type InsertScopeChecklistPattern = typeof scopeChecklistPatterns.$inferInsert;

/**
 * Audit log (Phase 4 canonical) — append-only trail of the acts that matter.
 *
 * Kept separate from the legacy `audit_logs` table instead of migrating it: the legacy table
 * has no tenant and no entity taxonomy, and rewriting historical rows to invent a tenant
 * would fabricate evidence. New writes land here; `audit_logs` stays readable as history.
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "restrict" }),
  userId: uuid("user_id"),
  /** Denormalized for a readable trail after a user is renamed or deactivated. */
  userLabel: text("user_label"),
  /** AuditEntityType from shared/domain/phase4-taxonomy.ts */
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  /** Free-form business key when the entity has no uuid (cost code, feature flag). */
  entityKey: text("entity_key"),
  /** AuditAction */
  action: text("action").notNull(),
  /** Project context, when the act belongs to a project. */
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  beforeSnapshot: jsonb("before_snapshot"),
  afterSnapshot: jsonb("after_snapshot"),
  /** Field-level diff derived from the snapshots. */
  changedFields: jsonb("changed_fields"),
  /** Money impact of the act, when applicable — makes the trail searchable by damage. */
  amountCents: integer("amount_cents"),
  reason: text("reason"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  requestId: text("request_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_audit_log_tenant").on(t.tenantId),
  index("idx_audit_log_entity").on(t.entityType, t.entityId),
  index("idx_audit_log_user").on(t.userId),
  index("idx_audit_log_action").on(t.action),
  index("idx_audit_log_project").on(t.projectId),
  index("idx_audit_log_created").on(t.createdAt),
  index("idx_audit_log_tenant_created").on(t.tenantId, t.createdAt),
  index("idx_audit_log_tenant_entity").on(t.tenantId, t.entityType, t.entityId),
]);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type InsertAuditLogEntry = typeof auditLog.$inferInsert;

/**
 * Analytics snapshots — persisted dashboard aggregations per tenant.
 *
 * The dashboard reads live aggregations; this table exists so a period can be frozen
 * (month/quarter close) and compared later without the numbers moving underneath.
 */
export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  /** "pipeline" | "revenue_forecast" | "profit_health" | "field_progress" | "subcontractor_leaderboard" */
  snapshotType: text("snapshot_type").notNull(),
  period: text("period").default("month").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  snapshotKey: text("snapshot_key").notNull(),
  payload: jsonb("payload").notNull(),
  generatedBy: uuid("generated_by"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_analytics_snapshots_tenant").on(t.tenantId),
  index("idx_analytics_snapshots_type").on(t.tenantId, t.snapshotType),
  uniqueIndex("uq_analytics_snapshots_key").on(t.tenantId, t.snapshotKey),
]);

export type AnalyticsSnapshot = typeof analyticsSnapshots.$inferSelect;
export type InsertAnalyticsSnapshot = typeof analyticsSnapshots.$inferInsert;
