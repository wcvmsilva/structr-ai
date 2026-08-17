/**
 * structr.ai — PHASE 4 Tenant Settings Persistence
 *
 * Contract: docs/phase4-contract.md §5 (MT-001 … MT-004)
 *
 * Stores per-tenant configuration: commercial defaults, branding, margin floor overrides,
 * feature flags and onboarding progress. Decision logic lives in
 * `shared/tenant-provisioning-engine.ts`; this module persists, guards and audits.
 *
 * Invariants enforced here:
 *   MT-001  mandatory flags cannot be removed; dependencies are closed automatically
 *   MT-001  margin floor overrides compose upward only
 *   MT-002  a tenant with open blocking onboarding steps cannot run a commercial cycle
 *   MT-003  `autoApplyAdjustments` is never true
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { assertSameTenant } from "./tenant-scope";
import {
  tenantSettings,
  tenants,
  type TenantSettings,
} from "../drizzle/schema";
import { recordAuditAsync } from "./audit-trail";
import {
  assertTenantCanOperate,
  buildTenantProvisionPlan,
  completeOnboardingStep,
  defaultFeatureFlags,
  evaluateOnboarding,
  isFeatureEnabled,
  resolveEffectiveFloor,
  resolveFeatureFlags,
  validateFlagRemoval,
  validateProfitShieldOverrides,
  type EffectiveFloorResult,
  type OnboardingProgress,
  type OnboardingStepMap,
  type TenantViolation,
} from "@shared/tenant-provisioning-engine";
import type { TenantFeatureFlag } from "@shared/domain/phase4-taxonomy";
import type { CommercialChannel } from "@shared/domain/phase2-taxonomy";
import type { GeoRiskClass } from "@shared/constants/profit-shield";

// ══════════════════════════════════════════════════════════════════════
// ERRORS
// ══════════════════════════════════════════════════════════════════════

export type TenantSettingsErrorCode =
  | "DB_UNAVAILABLE"
  | "TENANT_NOT_FOUND"
  | "SETTINGS_NOT_FOUND"
  | "SETTINGS_ALREADY_EXIST"
  | "MANDATORY_FLAG_REMOVED"
  | "FLAG_DEPENDENCY_VIOLATION"
  | "UNKNOWN_FEATURE_FLAG"
  | "INVALID_OVERRIDE"
  | "ONBOARDING_BLOCKED"
  | "AUTO_APPLY_FORBIDDEN"
  | "INVALID_ONBOARDING_STEP";

export class TenantSettingsError extends Error {
  public readonly code: TenantSettingsErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    code: TenantSettingsErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TenantSettingsError";
    this.code = code;
    this.details = details;
  }
}

function firstBlockMessage(violations: readonly TenantViolation[]): string {
  return violations.find(v => v.severity === "block")?.message ?? "Operation not allowed.";
}

function hasBlock(violations: readonly TenantViolation[]): boolean {
  return violations.some(v => v.severity === "block");
}

// ══════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════

export async function getTenantSettings(
  tenantId: string,
): Promise<TenantSettings | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);

  if (!row) return null;

  // Belt and braces: the query is already keyed by tenant, but the assertion documents the
  // invariant and catches a future refactor that switches this lookup to a settings id.
  if (!assertSameTenant(row.tenantId, tenantId)) return null;

  return row;
}

/**
 * Settings for a tenant, creating the default row when absent.
 *
 * Lazy creation matters for multi-tenant rollout: a tenant provisioned by a migration or an
 * out-of-band script must never leave the estimating engine without floors and flags.
 */
export async function getOrCreateTenantSettings(input: {
  tenantId: string;
  actorId?: string | null;
}): Promise<TenantSettings> {
  const db = await getDb();
  if (!db) {
    throw new TenantSettingsError("DB_UNAVAILABLE", "Database not available.");
  }

  const existing = await getTenantSettings(input.tenantId);
  if (existing) return existing;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  if (!tenant) {
    throw new TenantSettingsError("TENANT_NOT_FOUND", `Tenant ${input.tenantId} not found.`, {
      tenantId: input.tenantId,
    });
  }

  const [created] = await db
    .insert(tenantSettings)
    .values({
      tenantId: input.tenantId,
      featureFlags: defaultFeatureFlags() as never,
      autoApplyAdjustments: false,
      brandName: tenant.name ?? null,
      createdBy: input.actorId ?? null,
    })
    .returning();

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId ?? null,
    entityType: "tenant_settings",
    entityId: created.id,
    action: "tenant_settings.updated",
    before: null,
    after: created,
    reason: "Default settings created for tenant.",
  });

  return created;
}

// ══════════════════════════════════════════════════════════════════════
// FEATURE FLAGS (MT-001)
// ══════════════════════════════════════════════════════════════════════

function readFlags(settings: TenantSettings): string[] {
  const raw = settings.featureFlags;
  return Array.isArray(raw) ? raw.map(String) : [];
}

/** Effective flag set of a tenant, with mandatory flags and dependencies resolved. */
export async function getEffectiveFeatureFlags(
  tenantId: string,
): Promise<TenantFeatureFlag[]> {
  const settings = await getTenantSettings(tenantId);
  if (!settings) return defaultFeatureFlags();
  return resolveFeatureFlags(readFlags(settings)).flags;
}

/** True when the module is available to the tenant. Mandatory flags are always true. */
export async function isTenantFeatureEnabled(
  tenantId: string,
  flag: TenantFeatureFlag,
): Promise<boolean> {
  const settings = await getTenantSettings(tenantId);
  if (!settings) return isFeatureEnabled(defaultFeatureFlags(), flag);
  return isFeatureEnabled(readFlags(settings), flag);
}

export async function setFeatureFlags(input: {
  tenantId: string;
  flags: readonly string[];
  actorId: string;
  reason?: string | null;
}): Promise<TenantSettings> {
  const db = await getDb();
  if (!db) throw new TenantSettingsError("DB_UNAVAILABLE", "Database not available.");

  const settings = await getOrCreateTenantSettings({
    tenantId: input.tenantId,
    actorId: input.actorId,
  });

  const resolution = resolveFeatureFlags(input.flags);
  if (resolution.unknown.length > 0) {
    throw new TenantSettingsError(
      "UNKNOWN_FEATURE_FLAG",
      `Unknown feature flag(s): ${resolution.unknown.join(", ")}. An unrecognized flag is rejected, not treated as off.`,
      { unknown: resolution.unknown },
    );
  }

  const [updated] = await db
    .update(tenantSettings)
    .set({
      featureFlags: resolution.flags as never,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    })
    .where(eq(tenantSettings.tenantId, input.tenantId))
    .returning();

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId,
    entityType: "tenant_settings",
    entityId: updated.id,
    entityKey: "feature_flags",
    action: "tenant_settings.feature_flag_changed",
    before: { featureFlags: readFlags(settings) },
    after: { featureFlags: resolution.flags },
    reason: input.reason ?? null,
    metadata: {
      addedMandatory: resolution.addedMandatory,
      addedByDependency: resolution.addedByDependency,
    },
  });

  return updated;
}

/** Disable a single module, refusing mandatory flags and dependency breaks (MT-001). */
export async function disableFeatureFlag(input: {
  tenantId: string;
  flag: string;
  actorId: string;
  reason?: string | null;
}): Promise<TenantSettings> {
  const settings = await getOrCreateTenantSettings({
    tenantId: input.tenantId,
    actorId: input.actorId,
  });

  const current = readFlags(settings);
  const violations = validateFlagRemoval({ currentFlags: current, flagToRemove: input.flag });

  if (hasBlock(violations)) {
    const mandatory = violations.some(v => v.message.includes("cannot be disabled"));
    throw new TenantSettingsError(
      mandatory ? "MANDATORY_FLAG_REMOVED" : "FLAG_DEPENDENCY_VIOLATION",
      firstBlockMessage(violations),
      { violations },
    );
  }

  const next = resolveFeatureFlags(current).flags.filter(f => f !== input.flag);

  return setFeatureFlags({
    tenantId: input.tenantId,
    flags: next,
    actorId: input.actorId,
    reason: input.reason ?? `Disabled ${input.flag}.`,
  });
}

// ══════════════════════════════════════════════════════════════════════
// SETTINGS UPDATE
// ══════════════════════════════════════════════════════════════════════

export interface UpdateTenantSettingsInput {
  tenantId: string;
  actorId: string;
  defaultChannel?: string | null;
  defaultCommercialChannel?: CommercialChannel | null;
  geoRegion?: string | null;
  defaultGeoRiskClass?: GeoRiskClass | null;
  timezone?: string | null;
  currency?: string | null;
  locale?: string | null;
  supportedLocales?: string[] | null;
  profitShieldOverrides?: Record<string, number> | null;
  geoFloorOverrides?: Record<string, number> | null;
  varianceThresholdPct?: number | null;
  biasTolerancePct?: number | null;
  maxAdjustmentPct?: number | null;
  brandName?: string | null;
  brandLegalName?: string | null;
  brandLogoUrl?: string | null;
  brandPrimaryColor?: string | null;
  brandSecondaryColor?: string | null;
  brandEmailSignature?: string | null;
  brandLicenseNumber?: string | null;
  brandContactPhone?: string | null;
  brandContactEmail?: string | null;
  brandAddress?: string | null;
  proposalFooterText?: string | null;
  integrations?: Record<string, unknown> | null;
  notes?: string | null;
  /** Present only so an attempt to set it can be rejected explicitly (MT-003). */
  autoApplyAdjustments?: boolean;
}

/**
 * Update tenant settings.
 *
 * An attempt to enable `autoApplyAdjustments` is rejected loudly rather than ignored: a tenant
 * that believes automatic repricing is on, and is wrong, will stop reviewing proposals.
 */
export async function updateTenantSettings(
  input: UpdateTenantSettingsInput,
): Promise<{ settings: TenantSettings; warnings: TenantViolation[] }> {
  const db = await getDb();
  if (!db) throw new TenantSettingsError("DB_UNAVAILABLE", "Database not available.");

  if (input.autoApplyAdjustments === true) {
    throw new TenantSettingsError(
      "AUTO_APPLY_FORBIDDEN",
      "Automatic application of price adjustments is not available on any tenant. Every price change requires human approval.",
    );
  }

  const before = await getOrCreateTenantSettings({
    tenantId: input.tenantId,
    actorId: input.actorId,
  });

  const overrideViolations = [
    ...validateProfitShieldOverrides(input.profitShieldOverrides ?? null),
    ...validateProfitShieldOverrides(input.geoFloorOverrides ?? null),
  ];
  if (hasBlock(overrideViolations)) {
    throw new TenantSettingsError(
      "INVALID_OVERRIDE",
      firstBlockMessage(overrideViolations),
      { violations: overrideViolations },
    );
  }

  const patch: Record<string, unknown> = {
    updatedBy: input.actorId,
    updatedAt: new Date(),
  };

  const assign = (key: keyof UpdateTenantSettingsInput, column: string) => {
    const value = input[key];
    if (value !== undefined) patch[column] = value;
  };

  assign("defaultChannel", "defaultChannel");
  assign("defaultCommercialChannel", "defaultCommercialChannel");
  assign("geoRegion", "geoRegion");
  assign("defaultGeoRiskClass", "defaultGeoRiskClass");
  assign("timezone", "timezone");
  assign("currency", "currency");
  assign("locale", "locale");
  assign("brandName", "brandName");
  assign("brandLegalName", "brandLegalName");
  assign("brandLogoUrl", "brandLogoUrl");
  assign("brandPrimaryColor", "brandPrimaryColor");
  assign("brandSecondaryColor", "brandSecondaryColor");
  assign("brandEmailSignature", "brandEmailSignature");
  assign("brandLicenseNumber", "brandLicenseNumber");
  assign("brandContactPhone", "brandContactPhone");
  assign("brandContactEmail", "brandContactEmail");
  assign("brandAddress", "brandAddress");
  assign("proposalFooterText", "proposalFooterText");
  assign("notes", "notes");

  if (input.supportedLocales !== undefined) patch.supportedLocales = input.supportedLocales;
  if (input.profitShieldOverrides !== undefined) {
    patch.profitShieldOverrides = input.profitShieldOverrides;
  }
  if (input.geoFloorOverrides !== undefined) patch.geoFloorOverrides = input.geoFloorOverrides;
  if (input.integrations !== undefined) patch.integrations = input.integrations;
  if (input.varianceThresholdPct != null) {
    patch.varianceThresholdPct = String(input.varianceThresholdPct);
  }
  if (input.biasTolerancePct != null) patch.biasTolerancePct = String(input.biasTolerancePct);
  if (input.maxAdjustmentPct != null) patch.maxAdjustmentPct = String(input.maxAdjustmentPct);

  const [updated] = await db
    .update(tenantSettings)
    .set(patch as never)
    .where(eq(tenantSettings.tenantId, input.tenantId))
    .returning();

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId,
    entityType: "tenant_settings",
    entityId: updated.id,
    action: "tenant_settings.updated",
    before,
    after: updated,
  });

  return { settings: updated, warnings: overrideViolations.filter(v => v.severity === "warn") };
}

// ══════════════════════════════════════════════════════════════════════
// EFFECTIVE FLOORS (MT-001)
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolve the margin floor in force for a tenant, channel and geo risk class.
 *
 * Every estimating path should call this rather than reading the constants directly, so a
 * tenant that configured stricter floors actually gets them.
 */
export async function getEffectiveFloor(input: {
  tenantId: string;
  channel: CommercialChannel;
  geoRiskClass?: GeoRiskClass | null;
}): Promise<EffectiveFloorResult> {
  const settings = await getTenantSettings(input.tenantId);

  const channelOverrides = (settings?.profitShieldOverrides ?? {}) as Record<string, number>;
  const geoOverrides = (settings?.geoFloorOverrides ?? {}) as Record<string, number>;

  const geoRiskClass =
    input.geoRiskClass ?? ((settings?.defaultGeoRiskClass as GeoRiskClass | null) ?? null);

  return resolveEffectiveFloor({
    channel: input.channel,
    geoRiskClass,
    tenantOverridePct:
      channelOverrides && typeof channelOverrides[input.channel] === "number"
        ? channelOverrides[input.channel]
        : null,
    tenantGeoOverridePct:
      geoRiskClass && typeof geoOverrides[geoRiskClass] === "number"
        ? geoOverrides[geoRiskClass]
        : null,
  });
}

// ══════════════════════════════════════════════════════════════════════
// ONBOARDING (MT-002)
// ══════════════════════════════════════════════════════════════════════

function readSteps(settings: TenantSettings | null): OnboardingStepMap {
  const raw = settings?.onboardingSteps;
  return (raw && typeof raw === "object" ? raw : {}) as OnboardingStepMap;
}

export async function getOnboardingProgress(
  tenantId: string,
): Promise<OnboardingProgress> {
  const settings = await getTenantSettings(tenantId);
  return evaluateOnboarding(readSteps(settings), {
    suspended: settings?.onboardingStatus === "suspended",
  });
}

export async function completeOnboarding(input: {
  tenantId: string;
  step: string;
  actorId: string;
  completedAt?: string;
  notes?: string | null;
}): Promise<{ settings: TenantSettings; progress: OnboardingProgress }> {
  const db = await getDb();
  if (!db) throw new TenantSettingsError("DB_UNAVAILABLE", "Database not available.");

  const before = await getOrCreateTenantSettings({
    tenantId: input.tenantId,
    actorId: input.actorId,
  });

  const { steps, violations } = completeOnboardingStep(readSteps(before), {
    step: input.step,
    completedAt: input.completedAt ?? new Date().toISOString(),
    completedBy: input.actorId,
    notes: input.notes ?? null,
  });

  if (hasBlock(violations)) {
    throw new TenantSettingsError(
      "INVALID_ONBOARDING_STEP",
      firstBlockMessage(violations),
      { violations },
    );
  }

  const progress = evaluateOnboarding(steps, {
    suspended: before.onboardingStatus === "suspended",
  });

  const [updated] = await db
    .update(tenantSettings)
    .set({
      onboardingSteps: steps as never,
      onboardingStatus: progress.status,
      onboardingCompletionPct: String(progress.completionPct),
      onboardingStartedAt: before.onboardingStartedAt ?? new Date(),
      onboardingCompletedAt:
        progress.status === "active" ? (before.onboardingCompletedAt ?? new Date()) : null,
      updatedBy: input.actorId,
      updatedAt: new Date(),
    })
    .where(eq(tenantSettings.tenantId, input.tenantId))
    .returning();

  await db
    .update(tenants)
    .set({
      onboardingStatus: progress.status,
      activatedAt: progress.canOperate ? new Date() : null,
    })
    .where(eq(tenants.id, input.tenantId));

  recordAuditAsync({
    tenantId: input.tenantId,
    userId: input.actorId,
    entityType: "tenant_settings",
    entityId: updated.id,
    entityKey: input.step,
    action: "tenant_onboarding.step_completed",
    before: { onboardingSteps: readSteps(before), status: before.onboardingStatus },
    after: { onboardingSteps: steps, status: progress.status },
    reason: input.notes ?? null,
  });

  return { settings: updated, progress };
}

/**
 * Assert that the tenant may run a commercial cycle (MT-002).
 * Called by estimating and field paths before they create anything real.
 */
export async function assertTenantOperational(tenantId: string): Promise<void> {
  const settings = await getTenantSettings(tenantId);
  const violations = assertTenantCanOperate(readSteps(settings), {
    suspended: settings?.onboardingStatus === "suspended",
  });

  if (violations.length > 0) {
    throw new TenantSettingsError("ONBOARDING_BLOCKED", firstBlockMessage(violations), {
      violations,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════
// PROVISIONING
// ══════════════════════════════════════════════════════════════════════

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  legalName?: string | null;
  geoRegion?: string | null;
  defaultGeoRiskClass?: GeoRiskClass | null;
  defaultCommercialChannel?: CommercialChannel | null;
  requestedFlags?: readonly string[] | null;
  isDemo?: boolean;
  actorId: string;
}

/**
 * Provision a new tenant with its settings row.
 *
 * Only `tenant_created` is marked complete. The remaining blocking steps must be done by a human
 * who knows that company's price book and region — a tenant that looks configured but is not
 * produces confident wrong estimates, which is worse than an obviously empty system.
 */
export async function provisionTenant(input: ProvisionTenantInput): Promise<{
  tenantId: string;
  settings: TenantSettings;
  progress: OnboardingProgress;
  violations: TenantViolation[];
}> {
  const db = await getDb();
  if (!db) throw new TenantSettingsError("DB_UNAVAILABLE", "Database not available.");

  const createdAt = new Date();
  const plan = buildTenantProvisionPlan({
    tenantName: input.name,
    slug: input.slug,
    geoRegion: input.geoRegion ?? null,
    defaultGeoRiskClass: input.defaultGeoRiskClass ?? null,
    defaultCommercialChannel: input.defaultCommercialChannel ?? null,
    requestedFlags: input.requestedFlags ?? null,
    isDemo: input.isDemo,
    createdAt: createdAt.toISOString(),
  });

  if (hasBlock(plan.violations)) {
    throw new TenantSettingsError("INVALID_OVERRIDE", firstBlockMessage(plan.violations), {
      violations: plan.violations,
    });
  }

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: plan.tenantName,
      slug: plan.slug,
      legalName: input.legalName ?? plan.tenantName,
      region: plan.settings.geoRegion,
      onboardingStatus: plan.settings.onboardingStatus,
      isDemo: plan.settings.isDemo,
    })
    .returning();

  const [settings] = await db
    .insert(tenantSettings)
    .values({
      tenantId: tenant.id,
      geoRegion: plan.settings.geoRegion,
      defaultGeoRiskClass: plan.settings.defaultGeoRiskClass,
      defaultCommercialChannel: plan.settings.defaultCommercialChannel,
      featureFlags: plan.settings.featureFlags as never,
      onboardingStatus: plan.settings.onboardingStatus,
      onboardingSteps: plan.settings.onboardingSteps as never,
      onboardingCompletionPct: String(plan.settings.onboardingCompletionPct),
      onboardingStartedAt: createdAt,
      autoApplyAdjustments: false,
      isDemo: plan.settings.isDemo,
      brandName: plan.tenantName,
      brandLegalName: input.legalName ?? plan.tenantName,
      createdBy: input.actorId,
    })
    .returning();

  recordAuditAsync({
    tenantId: tenant.id,
    userId: input.actorId,
    entityType: "tenant",
    entityId: tenant.id,
    action: "tenant_settings.updated",
    before: null,
    after: { tenant, settings },
    reason: `Tenant ${plan.slug} provisioned.`,
  });

  return {
    tenantId: tenant.id,
    settings,
    progress: plan.onboarding,
    violations: plan.violations,
  };
}
