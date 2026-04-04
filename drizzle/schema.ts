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
} from "drizzle-orm/pg-core";

// ══════════════════════════════════════════════════════════════════════
// SUPABASE TABLES (Source of Truth - 24 tables)
// ══════════════════════════════════════════════════════════════════════

// 1. Cost Codes - Master Price Book codes
export const costCodes = pgTable("cost_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
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
});

export type CostCode = typeof costCodes.$inferSelect;
export type InsertCostCode = typeof costCodes.$inferInsert;

// 2. Cost Code Pricing History - Pricing records
export const costCodePricingHistory = pgTable("cost_code_pricing_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  costCodeId: uuid("cost_code_id").notNull(),
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
});

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
});

export type Assembly = typeof assemblies.$inferSelect;
export type InsertAssembly = typeof assemblies.$inferInsert;

// 5. Assembly Items - Bill of Materials
export const assemblyItems = pgTable("assembly_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  assemblyId: uuid("assembly_id").notNull(),
  costCodeId: uuid("cost_code_id").notNull(),
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
});

export type AssemblyItem = typeof assemblyItems.$inferSelect;
export type InsertAssemblyItem = typeof assemblyItems.$inferInsert;

// 6. Bundles - Grouped assemblies
export const bundles = pgTable("bundles", {
  id: uuid("id").defaultRandom().primaryKey(),
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
});

export type Bundle = typeof bundles.$inferSelect;
export type InsertBundle = typeof bundles.$inferInsert;

// 7. Bundle Items - Items within bundles
export const bundleItems = pgTable("bundle_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  bundleId: uuid("bundle_id").notNull(),
  assemblyId: uuid("assembly_id").notNull(),
  quantity: numeric("quantity").default("1").notNull(),
  isOptional: boolean("is_optional").default(false).notNull(),
  overrideQty: numeric("override_qty"),
  sortOrder: integer("sort_order").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  name: text("name").notNull(),
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
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// 10. Leads - CRM lead tracking
export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
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
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

// 11. Estimate Items - Line items for project estimates
export const estimateItems = pgTable("estimate_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  costCodeId: uuid("cost_code_id").notNull(),
  costTypeId: uuid("cost_type_id").notNull(),
  unitId: uuid("unit_id").notNull(),
  assemblyId: uuid("assembly_id"),
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
});

export type EstimateItem = typeof estimateItems.$inferSelect;
export type InsertEstimateItem = typeof estimateItems.$inferInsert;

// 12. Bill of Quantities (BOQ Items)
export const boqItems = pgTable("boq_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull(),
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
});

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

// 15. Profiles - User profiles (linked to Supabase auth)
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  fullName: text("full_name"),
  companyName: text("company_name"),
  role: text("role").default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = typeof profiles.$inferInsert;

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
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

// 17. Lead Proposals - Proposals linked to leads
export const leadProposals = pgTable("lead_proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull(),
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
});

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
  leadId: uuid("lead_id").notNull(),
  polygonGeojson: jsonb("polygon_geojson").notNull(),
  areaProjectedFt2: doublePrecision("area_projected_ft2"),
  pitchRisePer12: integer("pitch_rise_per_12").default(6),
  tiltDeg: doublePrecision("tilt_deg"),
  azimuthDeg: doublePrecision("azimuth_deg"),
  source: text("source").default("manual"),
  quality: text("quality"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
]);

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = typeof permissions.$inferInsert;

export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  roleId: uuid("role_id").notNull(),
  permissionId: uuid("permission_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_rp_role").on(t.roleId),
  index("idx_rp_perm").on(t.permissionId),
]);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = typeof rolePermissions.$inferInsert;

// APP-ONLY: Estimate workflow
export const estimates = pgTable("estimates", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  status: text("status").default("draft").notNull(),
  subtotal: numeric("subtotal"),
  tax: numeric("tax"),
  discount: numeric("discount"),
  total: numeric("total"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = typeof estimates.$inferInsert;

// APP-ONLY: Estimate drafts for versioning
export const estimateDrafts = pgTable("estimate_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  estimateId: uuid("estimate_id"),
  projectId: uuid("project_id").notNull(),
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
});

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
  leadId: uuid("lead_id"),
  projectId: uuid("project_id"),
  status: text("status").default("draft").notNull(),
  formData: jsonb("form_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type IntakeForm = typeof intakeForms.$inferSelect;
export type InsertIntakeForm = typeof intakeForms.$inferInsert;

// APP-ONLY: Project files and documents
export const projectFiles = pgTable("project_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type"),
  storagePath: text("storage_path").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = typeof projectFiles.$inferInsert;

// APP-ONLY: Scope drafts and review
export const scopeDrafts = pgTable("scope_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  status: text("status").default("draft").notNull(),
  content: jsonb("content"),
  zone: text("zone"),
  finishLevel: text("finish_level"),
  serviceType: text("service_type"),
  channel: text("channel"),
  confidence: numeric("confidence"),
  reason: text("reason"),
  intakeFormId: uuid("intake_form_id"),
  createdBy: uuid("created_by"),
  retryCount: integer("retry_count").default(0),
  warningsJson: jsonb("warnings_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScopeDraft = typeof scopeDrafts.$inferSelect;
export type InsertScopeDraft = typeof scopeDrafts.$inferInsert;

// APP-ONLY: Scope draft items
export const scopeDraftItems = pgTable("scope_draft_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id").notNull(),
  costCodeId: uuid("cost_code_id"),
  assemblyId: uuid("assembly_id"),
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
});

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  projectId: uuid("project_id"),
  feedbackType: text("feedback_type").notNull(),
  issueCategory: text("issue_category"),
  description: text("description").notNull(),
  attachments: jsonb("attachments"),
  status: text("status").default("open").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FieldFeedbackReport = typeof fieldFeedbackReports.$inferSelect;
export type InsertFieldFeedbackReport = typeof fieldFeedbackReports.$inferInsert;

// APP-ONLY: Project actuals tracking
export const projectActuals = pgTable("project_actuals", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  estimateItemId: uuid("estimate_item_id"),
  actualQuantity: numeric("actual_quantity"),
  actualCost: numeric("actual_cost"),
  actualLaborHours: numeric("actual_labor_hours"),
  costCodeId: uuid("cost_code_id"),
  variancePct: numeric("variance_pct"),
  isHighVariance: boolean("is_high_variance").default(false),
  notes: text("notes"),
  recordedDate: date("recorded_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ProjectActual = typeof projectActuals.$inferSelect;
export type InsertProjectActual = typeof projectActuals.$inferInsert;

// APP-ONLY: Review actions and approvals
export const reviewActions = pgTable("review_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  estimateId: uuid("estimate_id").notNull(),
  reviewerId: uuid("reviewer_id").notNull(),
  action: text("action").notNull(),
  comments: text("comments"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ReviewAction = typeof reviewActions.$inferSelect;
export type InsertReviewAction = typeof reviewActions.$inferInsert;

// APP-ONLY: Calibration suggestions
export const calibrationSuggestions = pgTable("calibration_suggestions", {
  id: uuid("id").defaultRandom().primaryKey(),
  costCodeId: uuid("cost_code_id"),
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
  assemblyId: uuid("assembly_id").notNull(),
  projectCount: integer("project_count").default(0).notNull(),
  avgActualCost: numeric("avg_actual_cost"),
  avgEstimatedCost: numeric("avg_estimated_cost"),
  costVariancePercent: numeric("cost_variance_percent"),
  assemblyName: text("assembly_name"),
  avgVariancePct: numeric("avg_variance_pct"),
  overrunCount: integer("overrun_count").default(0),
  underrunCount: integer("underrun_count").default(0),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).defaultNow().notNull(),
});

export type AssemblyPerformanceMetric = typeof assemblyPerformanceMetrics.$inferSelect;
export type InsertAssemblyPerformanceMetric = typeof assemblyPerformanceMetrics.$inferInsert;

// APP-ONLY: Lead activities
export const leadActivities = pgTable("lead_activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id").notNull(),
  activityType: text("activity_type").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LeadActivity = typeof leadActivities.$inferSelect;
export type InsertLeadActivity = typeof leadActivities.$inferInsert;

// APP-ONLY: Deals CRM
export const deals = pgTable("deals", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id"),
  name: text("name").notNull(),
  stage: text("stage").default("discovery").notNull(),
  value: numeric("value"),
  closureDate: date("closure_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Deal = typeof deals.$inferSelect;
export type InsertDeal = typeof deals.$inferInsert;

// APP-ONLY: Deal activities
export const dealActivities = pgTable("deal_activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull(),
  activityType: text("activity_type").notNull(),
  description: text("description"),
  performedBy: uuid("performed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DealActivity = typeof dealActivities.$inferSelect;
export type InsertDealActivity = typeof dealActivities.$inferInsert;

// APP-ONLY: Deal stage history
export const dealStageHistory = pgTable("deal_stage_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  dealId: uuid("deal_id").notNull(),
  previousStage: text("previous_stage"),
  newStage: text("new_stage").notNull(),
  changedBy: uuid("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DealStageHistory = typeof dealStageHistory.$inferSelect;
export type InsertDealStageHistory = typeof dealStageHistory.$inferInsert;

// ══════════════════════════════════════════════════════════════════════
// ADDITIONAL APP-ONLY TABLES (Required by server logic)
// ══════════════════════════════════════════════════════════════════════

// APP-ONLY: Clients table
export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
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
});

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
  scopeDraftId: uuid("scope_draft_id").notNull(),
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
});

export type ScopeReviewDelta = typeof scopeReviewDeltas.$inferSelect;
export type InsertScopeReviewDelta = typeof scopeReviewDeltas.$inferInsert;

// APP-ONLY: Scope Review Snapshots (Sprint 14)
export const scopeReviewSnapshots = pgTable("scope_review_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id").notNull(),
  snapshotData: jsonb("snapshot_data"),
  approvedItems: jsonb("approved_items"),
  bundleId: uuid("bundle_id"),
  deltaChanges: jsonb("delta_changes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScopeReviewSnapshot = typeof scopeReviewSnapshots.$inferSelect;
export type InsertScopeReviewSnapshot = typeof scopeReviewSnapshots.$inferInsert;

// Type aliases for scope review
export type SnapshotItem = Record<string, unknown>;
export type SnapshotDelta = Record<string, unknown>;

// APP-ONLY: Geographic Overrides (Sprint 16)
export const geographicOverrides = pgTable("geographic_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  zoneId: uuid("zone_id"),
  assemblyId: uuid("assembly_id"),
  costCodeId: uuid("cost_code_id"),
  overrideType: text("override_type").notNull(),
  overrideValue: numeric("override_value"),
  reason: text("reason"),
  zone: text("zone"),
  trade: text("trade"),
  finishLevel: text("finish_level"),
  reasonTemplate: text("reason_template"),
  originalAssemblyId: uuid("original_assembly_id"),
  replacementAssemblyId: uuid("replacement_assembly_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GeographicOverride = typeof geographicOverrides.$inferSelect;
export type InsertGeographicOverride = typeof geographicOverrides.$inferInsert;

// APP-ONLY: Scope Override Log (Sprint 16)
export const scopeOverrideLog = pgTable("scope_override_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id").notNull(),
  overrideId: uuid("override_id"),
  originalAssemblyId: uuid("original_assembly_id"),
  replacementAssemblyId: uuid("replacement_assembly_id"),
  overrideType: text("override_type"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScopeOverrideLogEntry = typeof scopeOverrideLog.$inferSelect;
export type InsertScopeOverrideLogEntry = typeof scopeOverrideLog.$inferInsert;

// APP-ONLY: Pipeline Partial Drafts (Sprint 20)
export const pipelinePartialDrafts = pgTable("pipeline_partial_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeDraftId: uuid("scope_draft_id"),
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
});

export type PipelinePartialDraft = typeof pipelinePartialDrafts.$inferSelect;
export type InsertPipelinePartialDraft = typeof pipelinePartialDrafts.$inferInsert;

// APP-ONLY: Estimate Variance Events (Sprint 22 - Learning Layer)
export const estimateVarianceEvents = pgTable("estimate_variance_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id"),
  estimateItemId: uuid("estimate_item_id"),
  costCodeId: uuid("cost_code_id"),
  eventType: text("event_type").notNull(),
  estimatedValue: numeric("estimated_value"),
  actualValue: numeric("actual_value"),
  variancePct: numeric("variance_pct"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EstimateVarianceEvent = typeof estimateVarianceEvents.$inferSelect;
export type InsertEstimateVarianceEvent = typeof estimateVarianceEvents.$inferInsert;

// (EstimateDraftLineItem and EstimateDraftAssemblySelection defined above after estimateDrafts table)

// ══════════════════════════════════════════════════════════════════════
// DRAWING INTAKE LAYER — V1 (TakeOff Module)
// ══════════════════════════════════════════════════════════════════════

// APP-ONLY: Project Drawings — uploaded construction drawings linked to projects
export const projectDrawings = pgTable("project_drawings", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
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
]);

export type ProjectDrawing = typeof projectDrawings.$inferSelect;
export type InsertProjectDrawing = typeof projectDrawings.$inferInsert;

// APP-ONLY: Drawing Revision Snapshots — frozen snapshots when a drawing set is finalized
export const drawingRevisionSnapshots = pgTable("drawing_revision_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  revisionLabel: text("revision_label").notNull(),
  drawingIds: jsonb("drawing_ids").notNull(), // string[] — IDs of drawings in this revision
  snapshotData: jsonb("snapshot_data"), // frozen metadata at time of snapshot
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_drawing_snapshots_project").on(t.projectId),
]);

export type DrawingRevisionSnapshot = typeof drawingRevisionSnapshots.$inferSelect;
export type InsertDrawingRevisionSnapshot = typeof drawingRevisionSnapshots.$inferInsert;

// APP-ONLY: Scope Sources — unified input layer (manual + drawing + narrative + hybrid)
export const scopeSources = pgTable("scope_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  sourceType: text("source_type").default("manual").notNull(), // "manual" | "drawing" | "narrative" | "hybrid"
  drawingRevisionId: uuid("drawing_revision_id"), // links to drawingRevisionSnapshots if source includes drawing
  intakeFormId: uuid("intake_form_id"), // links to intake_forms if source includes manual
  payloadJson: jsonb("payload_json").notNull(), // normalized ScopeSourcePayload
  confidenceSummaryJson: jsonb("confidence_summary_json"), // { measured: N, scaled: N, assumed: N, ai_extracted: N }
  assemblyCandidates: jsonb("assembly_candidates"), // ScopeSourceAssemblyCandidate[]
  assumptions: jsonb("assumptions"), // string[] — explicit assumptions made
  reviewStatus: text("review_status").default("pending").notNull(), // "pending" | "partial" | "approved" | "rejected"
  isActive: boolean("is_active").default(true).notNull(),
  scopeDraftId: uuid("scope_draft_id"), // set after normalization → scope_draft conversion
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_scope_sources_project").on(t.projectId),
  index("idx_scope_sources_active").on(t.projectId, t.isActive),
]);

export type ScopeSource = typeof scopeSources.$inferSelect;
export type InsertScopeSource = typeof scopeSources.$inferInsert;

// APP-ONLY: RFI Candidates — flagged items that need clarification before scope finalization
export const rfiCandidates = pgTable("rfi_candidates", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull(),
  scopeSourceId: uuid("scope_source_id"), // which scope source raised this
  drawingId: uuid("drawing_id"), // which drawing raised this (optional)
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
])

export type RfiCandidate = typeof rfiCandidates.$inferSelect;
export type InsertRfiCandidate = typeof rfiCandidates.$inferInsert;
