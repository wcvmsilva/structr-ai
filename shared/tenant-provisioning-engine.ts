/**
 * structr.ai — PHASE 4 Tenant Provisioning Engine (PURE)
 *
 * Everything required to turn the platform from "GCHI's system" into "a product another GC
 * can run", without letting a second tenant weaken the controls that make it safe.
 *
 * Contract: docs/phase4-contract.md §5 (MT-001 … MT-004)
 *
 * The two rules that carry the most weight:
 *
 *   - **Floors compose upward, never downward** (MT-001). The effective margin floor is the
 *     MAXIMUM of the platform floor, the tenant override and the geographic floor. A tenant may
 *     be stricter than the platform; it can never be looser. Selling the platform to a GC who
 *     can switch off the Profit Shield means selling a tool that can lose their money silently.
 *
 *   - **Onboarding has blocking steps** (MT-002). A tenant without cost codes and confirmed
 *     margin floors is not "partially ready", it is not allowed to price work. Half-configured
 *     estimating systems produce confident wrong numbers, which is worse than no system.
 *
 * PURE module: no DB, no IO, no clock (timestamps arrive as arguments), no randomness.
 */

import {
  DEFAULT_TENANT_FEATURE_FLAGS,
  MANDATORY_TENANT_FEATURE_FLAGS,
  TENANT_FEATURE_DEPENDENCIES,
  TENANT_FEATURE_FLAGS,
  TENANT_ONBOARDING_BLOCKING_STEPS,
  TENANT_ONBOARDING_STEPS,
  TENANT_ONBOARDING_STEP_LABELS,
  isMandatoryFeatureFlag,
  normalizeTenantFeatureFlag,
  normalizeTenantOnboardingStep,
  type TenantFeatureFlag,
  type TenantOnboardingStatus,
  type TenantOnboardingStep,
} from "./domain/phase4-taxonomy";
import {
  CHANNEL_MIN_MARGIN_PCT,
  GEO_MIN_MARGIN_PCT,
  PROFIT_SHIELD_PCT,
  type GeoRiskClass,
} from "./constants/profit-shield";
import type { CommercialChannel } from "./domain/phase2-taxonomy";
import { round1 } from "./calibration-engine";

// ══════════════════════════════════════════════════════════════════════
// FEATURE FLAGS (MT-001)
// ══════════════════════════════════════════════════════════════════════

export type TenantRuleId = "MT-001" | "MT-002" | "MT-003" | "MT-004";

export interface TenantViolation {
  rule: TenantRuleId;
  field: string;
  message: string;
  severity: "block" | "warn";
}

export interface FeatureFlagResolution {
  /** Flags actually in force, mandatory ones always present, dependencies satisfied. */
  flags: TenantFeatureFlag[];
  /** Flags that were requested but are not part of the closed vocabulary. */
  unknown: string[];
  /** Flags added automatically because another flag depends on them. */
  addedByDependency: TenantFeatureFlag[];
  /** Mandatory flags that had to be re-added. */
  addedMandatory: TenantFeatureFlag[];
  violations: TenantViolation[];
}

/**
 * Resolve the effective flag set of a tenant.
 *
 * Unknown flags are reported rather than ignored: silently dropping `"proft_shield"` because of
 * a typo would look like the guard is on when it is not. Dependencies are added automatically
 * because a tenant that enables `closeout` without `actuals_ledger` has a closeout that cannot
 * see any cost.
 */
export function resolveFeatureFlags(
  requested: readonly string[] | null | undefined,
): FeatureFlagResolution {
  const violations: TenantViolation[] = [];
  const unknown: string[] = [];
  const resolved = new Set<TenantFeatureFlag>();

  for (const raw of requested ?? []) {
    const flag = normalizeTenantFeatureFlag(raw);
    if (!flag) {
      unknown.push(String(raw));
      violations.push({
        rule: "MT-001",
        field: "featureFlags",
        message: `Unknown feature flag "${raw}". An unrecognized flag is rejected, not treated as off.`,
        severity: "block",
      });
      continue;
    }
    resolved.add(flag);
  }

  const addedMandatory: TenantFeatureFlag[] = [];
  for (const flag of MANDATORY_TENANT_FEATURE_FLAGS) {
    if (!resolved.has(flag)) {
      resolved.add(flag);
      addedMandatory.push(flag);
      violations.push({
        rule: "MT-001",
        field: "featureFlags",
        message: `${flag} is mandatory on every tenant and was re-enabled.`,
        severity: "warn",
      });
    }
  }

  // Dependency closure. Iterating to a fixed point handles chains such as
  // price_adjustments → calibration → closeout → actuals_ledger → field_operations.
  const addedByDependency: TenantFeatureFlag[] = [];
  let changed = true;
  let guard = 0;
  while (changed && guard < TENANT_FEATURE_FLAGS.length + 1) {
    changed = false;
    guard += 1;
    for (const flag of Array.from(resolved)) {
      const deps = TENANT_FEATURE_DEPENDENCIES[flag] ?? [];
      for (const dep of deps) {
        if (!resolved.has(dep)) {
          resolved.add(dep);
          addedByDependency.push(dep);
          changed = true;
        }
      }
    }
  }

  const flags = TENANT_FEATURE_FLAGS.filter(f => resolved.has(f));

  return { flags, unknown, addedByDependency, addedMandatory, violations };
}

/** Default flag set for a brand-new tenant. */
export function defaultFeatureFlags(): TenantFeatureFlag[] {
  return resolveFeatureFlags(DEFAULT_TENANT_FEATURE_FLAGS).flags;
}

/**
 * Validate an attempt to disable a flag.
 * Also refuses to disable a flag other enabled modules depend on: turning off `pricing_engine`
 * while `scope_builder` is live produces a scope nobody can price.
 */
export function validateFlagRemoval(input: {
  currentFlags: readonly string[];
  flagToRemove: string;
}): TenantViolation[] {
  const violations: TenantViolation[] = [];
  const flag = normalizeTenantFeatureFlag(input.flagToRemove);

  if (!flag) {
    violations.push({
      rule: "MT-001",
      field: "flag",
      message: `Unknown feature flag "${input.flagToRemove}".`,
      severity: "block",
    });
    return violations;
  }

  if (isMandatoryFeatureFlag(flag)) {
    violations.push({
      rule: "MT-001",
      field: "flag",
      message: `${flag} cannot be disabled: it is what makes the platform safe to operate.`,
      severity: "block",
    });
  }

  const current = resolveFeatureFlags(input.currentFlags).flags.filter(f => f !== flag);
  for (const enabled of current) {
    const deps = TENANT_FEATURE_DEPENDENCIES[enabled] ?? [];
    if (deps.includes(flag)) {
      violations.push({
        rule: "MT-001",
        field: "flag",
        message: `${enabled} depends on ${flag}. Disable ${enabled} first.`,
        severity: "block",
      });
    }
  }

  return violations;
}

/** True when a module is available to the tenant. */
export function isFeatureEnabled(
  flags: readonly string[] | null | undefined,
  flag: TenantFeatureFlag,
): boolean {
  if (isMandatoryFeatureFlag(flag)) return true;
  const resolved = resolveFeatureFlags(flags).flags;
  return resolved.includes(flag);
}

// ══════════════════════════════════════════════════════════════════════
// EFFECTIVE MARGIN FLOORS (MT-001)
// ══════════════════════════════════════════════════════════════════════

export interface EffectiveFloorResult {
  /** The floor to enforce, percent. */
  floorPct: number;
  /** Which input produced the winning floor. */
  source: "platform" | "tenant_override" | "geo" | "channel";
  platformFloorPct: number;
  channelFloorPct: number;
  geoFloorPct: number;
  tenantOverridePct: number | null;
  /** True when the tenant tried to configure a floor below the platform minimum. */
  overrideRejected: boolean;
  rationale: string;
}

/**
 * Resolve the margin floor actually in force for a (channel, geo) combination.
 *
 * Composition is by MAXIMUM, always. A tenant override of 20% on a coastal premium job does not
 * lower anything: the coastal floor of 42% still wins, and the attempted override is reported
 * as rejected so the operator sees that their configuration had no effect.
 */
export function resolveEffectiveFloor(input: {
  channel: CommercialChannel;
  geoRiskClass?: GeoRiskClass | null;
  /** Per-channel override from tenant_settings.profitShieldOverrides. */
  tenantOverridePct?: number | null;
  /** Per-risk-class override from tenant_settings.geoFloorOverrides. */
  tenantGeoOverridePct?: number | null;
}): EffectiveFloorResult {
  const platformFloorPct = PROFIT_SHIELD_PCT.GLOBAL_MIN_GP;
  const channelFloorPct = CHANNEL_MIN_MARGIN_PCT[input.channel] ?? platformFloorPct;
  const baseGeoFloor = input.geoRiskClass ? GEO_MIN_MARGIN_PCT[input.geoRiskClass] ?? 0 : 0;

  // A tenant geo override may only raise the geographic floor.
  const geoFloorPct =
    input.tenantGeoOverridePct != null
      ? Math.max(baseGeoFloor, input.tenantGeoOverridePct)
      : baseGeoFloor;

  const tenantOverridePct = input.tenantOverridePct ?? null;

  const candidates: Array<{ pct: number; source: EffectiveFloorResult["source"] }> = [
    { pct: channelFloorPct, source: "channel" },
    { pct: geoFloorPct, source: "geo" },
  ];
  if (tenantOverridePct != null) {
    candidates.push({ pct: tenantOverridePct, source: "tenant_override" });
  }

  let winner = candidates[0];
  for (const c of candidates) {
    if (c.pct > winner.pct) winner = c;
  }

  const overrideRejected =
    tenantOverridePct != null && tenantOverridePct < Math.max(channelFloorPct, geoFloorPct);

  const rationale = overrideRejected
    ? `Tenant override of ${round1(tenantOverridePct!)}% is below the enforced floor of ${round1(winner.pct)}% (${winner.source}) and was ignored. Floors compose upward only.`
    : `Effective floor ${round1(winner.pct)}% comes from the ${winner.source} floor.`;

  return {
    floorPct: round1(winner.pct),
    source: winner.source,
    platformFloorPct,
    channelFloorPct,
    geoFloorPct,
    tenantOverridePct,
    overrideRejected,
    rationale,
  };
}

/** Validate a tenant's override map before it is stored. */
export function validateProfitShieldOverrides(
  overrides: Record<string, unknown> | null | undefined,
): TenantViolation[] {
  const violations: TenantViolation[] = [];
  if (!overrides) return violations;

  for (const [channel, value] of Object.entries(overrides)) {
    const pct = Number(value);
    if (!Number.isFinite(pct)) {
      violations.push({
        rule: "MT-001",
        field: `profitShieldOverrides.${channel}`,
        message: `Override for ${channel} is not a number.`,
        severity: "block",
      });
      continue;
    }
    if (pct < 0 || pct > 100) {
      violations.push({
        rule: "MT-001",
        field: `profitShieldOverrides.${channel}`,
        message: `Override for ${channel} must be between 0 and 100.`,
        severity: "block",
      });
      continue;
    }
    const platformFloor = CHANNEL_MIN_MARGIN_PCT[channel as CommercialChannel];
    if (platformFloor != null && pct < platformFloor) {
      violations.push({
        rule: "MT-001",
        field: `profitShieldOverrides.${channel}`,
        message: `Override of ${pct}% for ${channel} is below the platform floor of ${platformFloor}% and will have no effect. Floors compose upward only.`,
        severity: "warn",
      });
    }
  }

  return violations;
}

// ══════════════════════════════════════════════════════════════════════
// ONBOARDING (MT-002)
// ══════════════════════════════════════════════════════════════════════

export interface OnboardingStepState {
  completed: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
  notes?: string | null;
}

export type OnboardingStepMap = Partial<Record<TenantOnboardingStep, OnboardingStepState>>;

export interface OnboardingProgress {
  status: TenantOnboardingStatus;
  completionPct: number;
  completedSteps: TenantOnboardingStep[];
  pendingSteps: TenantOnboardingStep[];
  /** Blocking steps still open — while any exists, the tenant cannot price real work. */
  blockingSteps: TenantOnboardingStep[];
  /** The single next action, so the operator is never shown a wall of tasks. */
  nextStep: TenantOnboardingStep | null;
  nextStepLabel: string | null;
  canOperate: boolean;
  summary: string;
}

/**
 * Evaluate onboarding progress.
 *
 * Returns exactly one `nextStep`, following the same principle Phase 2 applied to leads: a
 * checklist with eleven simultaneous "next actions" produces no action at all. Blocking steps
 * are surfaced first, in canonical order, because they gate the tenant's ability to work.
 */
export function evaluateOnboarding(
  steps: OnboardingStepMap | null | undefined,
  options: { suspended?: boolean } = {},
): OnboardingProgress {
  const map = steps ?? {};
  const completedSteps: TenantOnboardingStep[] = [];
  const pendingSteps: TenantOnboardingStep[] = [];

  for (const step of TENANT_ONBOARDING_STEPS) {
    if (map[step]?.completed) completedSteps.push(step);
    else pendingSteps.push(step);
  }

  const blockingSteps = TENANT_ONBOARDING_BLOCKING_STEPS.filter(s => !map[s]?.completed);
  const completionPct = round1((completedSteps.length / TENANT_ONBOARDING_STEPS.length) * 100);

  const nextStep = blockingSteps[0] ?? pendingSteps[0] ?? null;
  const canOperate = blockingSteps.length === 0;

  let status: TenantOnboardingStatus;
  if (options.suspended) status = "suspended";
  else if (completedSteps.length === 0) status = "not_started";
  else if (!canOperate) status = "in_progress";
  else if (pendingSteps.length === 0) status = "active";
  else status = "ready";

  const summary = options.suspended
    ? "Tenant is suspended; no commercial activity is allowed."
    : canOperate
      ? pendingSteps.length === 0
        ? "Onboarding complete: the tenant can run the full cycle."
        : `Tenant can price and sell work. ${pendingSteps.length} optional step(s) remain, starting with ${TENANT_ONBOARDING_STEP_LABELS[nextStep!]}.`
      : `Blocked: ${blockingSteps.length} mandatory step(s) remain. A tenant without them would produce confident wrong numbers. Next: ${TENANT_ONBOARDING_STEP_LABELS[blockingSteps[0]]}.`;

  return {
    status,
    completionPct,
    completedSteps,
    pendingSteps,
    blockingSteps: [...blockingSteps],
    nextStep,
    nextStepLabel: nextStep ? TENANT_ONBOARDING_STEP_LABELS[nextStep] : null,
    canOperate,
    summary,
  };
}

/** Mark a step complete, returning the updated map. Never mutates the input. */
export function completeOnboardingStep(
  steps: OnboardingStepMap | null | undefined,
  input: { step: string; completedAt: string; completedBy?: string | null; notes?: string | null },
): { steps: OnboardingStepMap; violations: TenantViolation[] } {
  const violations: TenantViolation[] = [];
  const step = normalizeTenantOnboardingStep(input.step);

  if (!step) {
    violations.push({
      rule: "MT-002",
      field: "step",
      message: `Unknown onboarding step "${input.step}".`,
      severity: "block",
    });
    return { steps: { ...(steps ?? {}) }, violations };
  }

  return {
    steps: {
      ...(steps ?? {}),
      [step]: {
        completed: true,
        completedAt: input.completedAt,
        completedBy: input.completedBy ?? null,
        notes: input.notes ?? null,
      },
    },
    violations,
  };
}

/** Validate whether a tenant may run a real commercial cycle (MT-002). */
export function assertTenantCanOperate(
  steps: OnboardingStepMap | null | undefined,
  options: { suspended?: boolean } = {},
): TenantViolation[] {
  const progress = evaluateOnboarding(steps, options);
  if (progress.canOperate && progress.status !== "suspended") return [];

  if (progress.status === "suspended") {
    return [
      {
        rule: "MT-002",
        field: "onboardingStatus",
        message: "Tenant is suspended.",
        severity: "block",
      },
    ];
  }

  return progress.blockingSteps.map(step => ({
    rule: "MT-002" as const,
    field: "onboardingSteps",
    message: `Onboarding step not complete: ${TENANT_ONBOARDING_STEP_LABELS[step]}.`,
    severity: "block" as const,
  }));
}

// ══════════════════════════════════════════════════════════════════════
// PROVISIONING PLAN
// ══════════════════════════════════════════════════════════════════════

export interface TenantProvisionInput {
  tenantName: string;
  slug: string;
  geoRegion?: string | null;
  defaultGeoRiskClass?: GeoRiskClass | null;
  defaultCommercialChannel?: CommercialChannel | null;
  requestedFlags?: readonly string[] | null;
  isDemo?: boolean;
  createdAt: string;
}

export interface TenantProvisionPlan {
  slug: string
  tenantName: string;
  settings: {
    geoRegion: string;
    defaultGeoRiskClass: GeoRiskClass;
    defaultCommercialChannel: CommercialChannel;
    featureFlags: TenantFeatureFlag[];
    onboardingStatus: TenantOnboardingStatus;
    onboardingSteps: OnboardingStepMap;
    onboardingCompletionPct: number;
    autoApplyAdjustments: false;
    isDemo: boolean;
  };
  effectiveFloors: Record<CommercialChannel, EffectiveFloorResult>;
  onboarding: OnboardingProgress;
  violations: TenantViolation[];
}

/**
 * Build the provisioning plan for a new tenant.
 *
 * `tenant_created` is the only step marked complete: everything else requires a human decision
 * about that company's price book, region and margins. Pre-marking steps to make the dashboard
 * look finished is precisely how a GC ends up pricing coastal work with inland assumptions.
 */
export function buildTenantProvisionPlan(
  input: TenantProvisionInput,
): TenantProvisionPlan {
  const flagResolution = resolveFeatureFlags(
    input.requestedFlags ?? DEFAULT_TENANT_FEATURE_FLAGS,
  );

  // Collapse separators and trim their edges: `Demo Coastal GC!` must become
  // `demo-coastal-gc`, not a different-looking `demo-coastal-gc-` tenant namespace.
  const slug = String(input.slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const violations: TenantViolation[] = [...flagResolution.violations];

  if (!slug) {
    violations.push({
      rule: "MT-004",
      field: "slug",
      message: "A tenant needs a stable slug to scope its data.",
      severity: "block",
    });
  }
  if (!String(input.tenantName ?? "").trim()) {
    violations.push({
      rule: "MT-004",
      field: "tenantName",
      message: "A tenant needs a name.",
      severity: "block",
    });
  }

  const steps: OnboardingStepMap = {
    tenant_created: {
      completed: true,
      completedAt: input.createdAt,
      completedBy: null,
      notes: "Created by provisioning.",
    },
  };

  const onboarding = evaluateOnboarding(steps);
  const geoRiskClass = input.defaultGeoRiskClass ?? "coastal";

  const channels: CommercialChannel[] = ["premium", "trade", "capital"];
  const effectiveFloors = {} as Record<CommercialChannel, EffectiveFloorResult>;
  for (const channel of channels) {
    effectiveFloors[channel] = resolveEffectiveFloor({ channel, geoRiskClass });
  }

  return {
    slug,
    tenantName: String(input.tenantName ?? "").trim(),
    settings: {
      geoRegion: input.geoRegion ?? "charleston_sc",
      defaultGeoRiskClass: geoRiskClass,
      defaultCommercialChannel: input.defaultCommercialChannel ?? "premium",
      featureFlags: flagResolution.flags,
      onboardingStatus: onboarding.status,
      onboardingSteps: steps,
      onboardingCompletionPct: onboarding.completionPct,
      // MT-003: never true, for any tenant, under any configuration.
      autoApplyAdjustments: false,
      isDemo: !!input.isDemo,
    },
    effectiveFloors,
    onboarding,
    violations,
  };
}

/** True when no `block` violation is present. */
export function isTenantPlanValid(violations: readonly TenantViolation[]): boolean {
  return !violations.some(v => v.severity === "block");
}
