/**
 * structr.ai — PHASE 4 Domain Taxonomy
 *
 * Closed vocabularies required by the Phase 4 contract (docs/phase4-contract.md):
 *   - Calibration event types and lifecycle          (CL-001 … CL-006)
 *   - Bias direction and confidence bands            (§2)
 *   - Price adjustment lifecycle and targets         (PA-001 … PA-005)
 *   - Scope completeness verdicts                    (SC4-001 … SC4-003)
 *   - Tenant feature flags and onboarding steps      (MT-001 … MT-004)
 *   - Audit trail actions and entity types           (AU-001 … AU-003)
 *
 * PURE module: no DB, no IO, no side effects.
 *
 * Design note — why a fourth taxonomy file: Phase 3 governs *what happened* in the field.
 * Phase 4 governs *what the company learns from it* and *what another company inherits*.
 * A change in the learning vocabulary must never be able to silently move a field state
 * machine or a margin floor, so the vocabularies stay in separate modules.
 */

// ══════════════════════════════════════════════════════════════════════
// CALIBRATION EVENT TYPE (CL-001)
// ══════════════════════════════════════════════════════════════════════

/**
 * The four things the system is allowed to learn from a finished project.
 *
 * Deliberately narrow: each type has a distinct evidence source and a distinct operator
 * action. A generic "insight" type would produce a feed nobody acts on.
 */
export const CALIBRATION_EVENT_TYPES = [
  /** Estimated cost vs committed actual cost, per cost code. */
  "price_accuracy",
  /** Approved scope vs what was actually executed and paid for. */
  "scope_completeness",
  /** Planned duration vs real duration, per trade. */
  "duration_accuracy",
  /** Geographic modifier / margin floor vs realized margin in that zone. */
  "geo_factor_validation",
] as const;

export type CalibrationEventType = (typeof CALIBRATION_EVENT_TYPES)[number];

export const CALIBRATION_EVENT_TYPE_LABELS: Record<CalibrationEventType, string> = {
  price_accuracy: "Price accuracy",
  scope_completeness: "Scope completeness",
  duration_accuracy: "Duration accuracy",
  geo_factor_validation: "Geo factor validation",
};

const CALIBRATION_EVENT_TYPE_ALIASES: Record<string, CalibrationEventType> = {
  price: "price_accuracy",
  cost_accuracy: "price_accuracy",
  pricing_accuracy: "price_accuracy",
  price_bias: "price_accuracy",
  scope: "scope_completeness",
  scope_gap: "scope_completeness",
  missing_scope: "scope_completeness",
  duration: "duration_accuracy",
  schedule_accuracy: "duration_accuracy",
  time_accuracy: "duration_accuracy",
  geo: "geo_factor_validation",
  geo_factor: "geo_factor_validation",
  coastal_factor: "geo_factor_validation",
  zone_validation: "geo_factor_validation",
};

// ══════════════════════════════════════════════════════════════════════
// CALIBRATION EVENT STATUS (CL-002)
// ══════════════════════════════════════════════════════════════════════

/**
 * A calibration event is evidence, not a decision. It can be acknowledged, turned into a
 * proposal, dismissed as noise, or superseded by a later aggregation.
 */
export const CALIBRATION_EVENT_STATUSES = [
  "open",
  "acknowledged",
  "actioned",
  "dismissed",
  "superseded",
] as const;

export type CalibrationEventStatus = (typeof CALIBRATION_EVENT_STATUSES)[number];

export const CALIBRATION_EVENT_TRANSITIONS: Record<
  CalibrationEventStatus,
  readonly CalibrationEventStatus[]
> = {
  open: ["acknowledged", "dismissed", "superseded"],
  acknowledged: ["actioned", "dismissed", "superseded"],
  actioned: ["superseded"],
  dismissed: ["open", "superseded"],
  superseded: [],
};

const CALIBRATION_EVENT_STATUS_ALIASES: Record<string, CalibrationEventStatus> = {
  new: "open",
  pending: "open",
  reviewed: "acknowledged",
  seen: "acknowledged",
  applied: "actioned",
  used: "actioned",
  ignored: "dismissed",
  rejected: "dismissed",
  stale: "superseded",
  replaced: "superseded",
};

// ══════════════════════════════════════════════════════════════════════
// CALIBRATION SCOPE (CL-003)
// ══════════════════════════════════════════════════════════════════════

/** A calibration event is produced either from one project or from a tenant aggregation. */
export const CALIBRATION_SCOPES = ["project", "tenant"] as const;

export type CalibrationScope = (typeof CALIBRATION_SCOPES)[number];

/** Period granularity of a tenant-level aggregation. */
export const CALIBRATION_PERIODS = ["project", "month", "quarter", "year", "all_time"] as const;

export type CalibrationPeriod = (typeof CALIBRATION_PERIODS)[number];

// ══════════════════════════════════════════════════════════════════════
// BIAS DIRECTION (§2)
// ══════════════════════════════════════════════════════════════════════

/**
 * Bias is directional and asymmetric in consequence.
 *
 * `underestimates` means the estimate was below reality — it destroys margin and is the
 * expensive failure. `overestimates` means the estimate was above reality — it costs jobs.
 * They are never collapsed into a single "error" figure because the remedy differs.
 */
export const BIAS_DIRECTIONS = [
  /** Estimate < actual: the price book is too cheap. */
  "underestimates",
  /** Estimate > actual: the price book is too expensive. */
  "overestimates",
  /** Within tolerance. */
  "accurate",
  /** Direction flips project to project: the driver is not the price, it is the scope. */
  "inconsistent",
] as const;

export type BiasDirection = (typeof BIAS_DIRECTIONS)[number];

export const BIAS_DIRECTION_LABELS: Record<BiasDirection, string> = {
  underestimates: "Consistently under-estimates",
  overestimates: "Consistently over-estimates",
  accurate: "Within tolerance",
  inconsistent: "Inconsistent (scope-driven)",
};

/** Bias tolerance: mean absolute deviation at or below this is `accurate` (percent). */
export const DEFAULT_BIAS_TOLERANCE_PCT = 5;

/**
 * Minimum share of samples pointing the same way before a bias is called consistent.
 * Below it the finding is `inconsistent`, which points at scope, not at price.
 */
export const BIAS_CONSISTENCY_THRESHOLD = 0.7;

// ══════════════════════════════════════════════════════════════════════
// CONFIDENCE (CL-004)
// ══════════════════════════════════════════════════════════════════════

/**
 * Confidence bands. The band, not the raw score, decides what the operator may do:
 * only `high` may be auto-proposed as a price adjustment, and no band may auto-apply.
 */
export const CONFIDENCE_BANDS = ["insufficient", "low", "medium", "high"] as const;

export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const CONFIDENCE_BAND_LABELS: Record<ConfidenceBand, string> = {
  insufficient: "Insufficient data",
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

/** Minimum number of closed projects before a finding is anything but `insufficient`. */
export const MIN_SAMPLES_FOR_CONFIDENCE = 3;

/** Sample count at which the sample component of the score saturates. */
export const SAMPLE_SATURATION_COUNT = 12;

/** Score thresholds (0–100) that separate the confidence bands. */
export const CONFIDENCE_BAND_THRESHOLDS: Record<Exclude<ConfidenceBand, "insufficient">, number> = {
  low: 0,
  medium: 50,
  high: 75,
};

/** Only findings at or above this band may generate a proposed price adjustment. */
export const MIN_BAND_FOR_PROPOSAL: ConfidenceBand = "medium";

// ══════════════════════════════════════════════════════════════════════
// PRICE ADJUSTMENT (PA-001 … PA-005)
// ══════════════════════════════════════════════════════════════════════

/**
 * Lifecycle of a price adjustment.
 *
 * `applied` is only reachable from `approved`, and approval is a human act (PA-002).
 * `rolled_back` preserves the fact that the adjustment was once live — deleting it would
 * erase the reason an old estimate carried a different price.
 */
export const PRICE_ADJUSTMENT_STATUSES = [
  "proposed",
  "approved",
  "applied",
  "rejected",
  "rolled_back",
  "expired",
] as const;

export type PriceAdjustmentStatus = (typeof PRICE_ADJUSTMENT_STATUSES)[number];

export const PRICE_ADJUSTMENT_TRANSITIONS: Record<
  PriceAdjustmentStatus,
  readonly PriceAdjustmentStatus[]
> = {
  proposed: ["approved", "rejected", "expired"],
  approved: ["applied", "rejected", "expired"],
  applied: ["rolled_back"],
  rejected: [],
  rolled_back: [],
  expired: [],
};

const PRICE_ADJUSTMENT_STATUS_ALIASES: Record<string, PriceAdjustmentStatus> = {
  suggested: "proposed",
  pending: "proposed",
  draft: "proposed",
  accepted: "approved",
  authorized: "approved",
  live: "applied",
  active: "applied",
  denied: "rejected",
  declined: "rejected",
  reverted: "rolled_back",
  rollback: "rolled_back",
  stale: "expired",
};

/** Statuses in which the adjustment is influencing new estimates. */
export const PRICE_ADJUSTMENT_LIVE_STATUSES: readonly PriceAdjustmentStatus[] = [
  "applied",
] as const;

/** Statuses that can no longer change. */
export const PRICE_ADJUSTMENT_TERMINAL_STATUSES: readonly PriceAdjustmentStatus[] = [
  "rejected",
  "rolled_back",
  "expired",
] as const;

/** What a price adjustment may target. */
export const PRICE_ADJUSTMENT_TARGETS = [
  "cost_code",
  "assembly",
  "geo_factor",
  "duration_factor",
] as const;

export type PriceAdjustmentTarget = (typeof PRICE_ADJUSTMENT_TARGETS)[number];

/**
 * Hard cap on a single adjustment (percent, absolute).
 *
 * A calibration engine that proposes +180% on three samples is not learning, it is
 * amplifying an outlier. Anything beyond the cap must be entered by hand with a reason.
 */
export const MAX_ADJUSTMENT_PCT = 25;

/** Adjustments below this magnitude are noise and are not proposed at all (percent). */
export const MIN_ADJUSTMENT_PCT = 2;

/**
 * Fraction of the observed deviation that a proposal is allowed to close in one step.
 * Damping exists so the price book converges instead of oscillating around reality.
 */
export const ADJUSTMENT_DAMPING_FACTOR = 0.6;

// ══════════════════════════════════════════════════════════════════════
// SCOPE COMPLETENESS (SC4-001 … SC4-003)
// ══════════════════════════════════════════════════════════════════════

/** Verdict of the scope completeness score. */
export const SCOPE_COMPLETENESS_VERDICTS = [
  "complete",
  "minor_gaps",
  "material_gaps",
  "systemic_gaps",
] as const;

export type ScopeCompletenessVerdict = (typeof SCOPE_COMPLETENESS_VERDICTS)[number];

export const SCOPE_COMPLETENESS_VERDICT_LABELS: Record<ScopeCompletenessVerdict, string> = {
  complete: "Scope was complete",
  minor_gaps: "Minor scope gaps",
  material_gaps: "Material scope gaps",
  systemic_gaps: "Systemic scope gaps",
};

/** Score thresholds (0–100) mapping a completeness score to a verdict. */
export const SCOPE_COMPLETENESS_THRESHOLDS = {
  complete: 95,
  minor_gaps: 85,
  material_gaps: 70,
} as const;

/**
 * Number of projects of the same type in which an item must be missing before it becomes a
 * recurring pattern worth putting on a checklist.
 */
export const MIN_OCCURRENCES_FOR_PATTERN = 2;

/** Share of projects of a type where the gap must appear to be flagged as recurring. */
export const PATTERN_FREQUENCY_THRESHOLD = 0.4;

// ══════════════════════════════════════════════════════════════════════
// TENANT FEATURE FLAGS (MT-001)
// ══════════════════════════════════════════════════════════════════════

/**
 * Modules a tenant may switch on. The list is closed so a typo cannot silently disable a
 * gate: an unknown flag is not "off", it is rejected.
 */
export const TENANT_FEATURE_FLAGS = [
  "lead_intake",
  "previsit",
  "scope_builder",
  "geo_intelligence",
  "pricing_engine",
  "profit_shield",
  "estimate_versioning",
  "jobtread_export",
  "field_operations",
  "actuals_ledger",
  "subcontractor_management",
  "daily_logs",
  "closeout",
  "calibration",
  "price_adjustments",
  "analytics",
  "audit_trail",
  "multi_language",
] as const;

export type TenantFeatureFlag = (typeof TENANT_FEATURE_FLAGS)[number];

/**
 * Flags that cannot be turned off. Profit Shield and the audit trail are the two controls
 * that make the platform safe to resell: a tenant that can disable them can lose money and
 * then prove nothing about how.
 */
export const MANDATORY_TENANT_FEATURE_FLAGS: readonly TenantFeatureFlag[] = [
  "profit_shield",
  "audit_trail",
] as const;

/** Dependencies between modules: enabling the key requires the listed flags. */
export const TENANT_FEATURE_DEPENDENCIES: Partial<
  Record<TenantFeatureFlag, readonly TenantFeatureFlag[]>
> = {
  previsit: ["lead_intake"],
  scope_builder: ["pricing_engine"],
  estimate_versioning: ["pricing_engine", "profit_shield"],
  jobtread_export: ["estimate_versioning"],
  field_operations: ["estimate_versioning"],
  actuals_ledger: ["field_operations"],
  subcontractor_management: ["field_operations"],
  daily_logs: ["field_operations"],
  closeout: ["actuals_ledger"],
  calibration: ["closeout"],
  price_adjustments: ["calibration", "pricing_engine"],
  analytics: ["audit_trail"],
};

/** Default flag set for a new tenant: the full commercial cycle, learning switched off. */
export const DEFAULT_TENANT_FEATURE_FLAGS: readonly TenantFeatureFlag[] = [
  "lead_intake",
  "previsit",
  "pricing_engine",
  "profit_shield",
  "scope_builder",
  "geo_intelligence",
  "estimate_versioning",
  "jobtread_export",
  "audit_trail",
  "analytics",
] as const;

// ══════════════════════════════════════════════════════════════════════
// TENANT ONBOARDING (MT-002)
// ══════════════════════════════════════════════════════════════════════

/** Ordered steps required to activate a new GC on the platform. */
export const TENANT_ONBOARDING_STEPS = [
  "tenant_created",
  "owner_user_assigned",
  "branding_configured",
  "geo_region_configured",
  "margin_floors_confirmed",
  "cost_codes_imported",
  "assemblies_seeded",
  "channels_configured",
  "field_roles_assigned",
  "jobtread_contract_verified",
  "pilot_project_completed",
] as const;

export type TenantOnboardingStep = (typeof TENANT_ONBOARDING_STEPS)[number];

export const TENANT_ONBOARDING_STEP_LABELS: Record<TenantOnboardingStep, string> = {
  tenant_created: "Tenant record created",
  owner_user_assigned: "Owner user assigned",
  branding_configured: "Branding and document identity configured",
  geo_region_configured: "Geographic region and zones configured",
  margin_floors_confirmed: "Margin floors confirmed by the owner",
  cost_codes_imported: "Cost codes imported into the price book",
  assemblies_seeded: "Assemblies seeded and reviewed",
  channels_configured: "Commercial channels configured",
  field_roles_assigned: "Field roles and crew access assigned",
  jobtread_contract_verified: "JobTread export contract verified",
  pilot_project_completed: "Pilot project completed end to end",
};

/**
 * Steps that must be complete before the tenant may run a real commercial cycle.
 * Everything else can be finished while the first jobs are being priced.
 */
export const TENANT_ONBOARDING_BLOCKING_STEPS: readonly TenantOnboardingStep[] = [
  "tenant_created",
  "owner_user_assigned",
  "geo_region_configured",
  "margin_floors_confirmed",
  "cost_codes_imported",
] as const;

/** Onboarding lifecycle. */
export const TENANT_ONBOARDING_STATUSES = [
  "not_started",
  "in_progress",
  "ready",
  "active",
  "suspended",
] as const;

export type TenantOnboardingStatus = (typeof TENANT_ONBOARDING_STATUSES)[number];

// ══════════════════════════════════════════════════════════════════════
// AUDIT TRAIL (AU-001 … AU-003)
// ══════════════════════════════════════════════════════════════════════

/**
 * Actions that must always be auditable. This is not "every write": it is the set of acts
 * that move money, change a commitment, or change what the platform is allowed to do.
 */
export const AUDIT_ACTIONS = [
  "estimate.approved",
  "estimate.rejected",
  "estimate.discount_applied",
  "estimate.version_created",
  "change_order.created",
  "change_order.approved",
  "closeout.opened",
  "closeout.closed",
  "actual.approved",
  "actual.rejected",
  "calibration.event_created",
  "calibration.report_generated",
  "calibration.event_transitioned",
  "price_adjustment.proposed",
  "price_adjustment.approved",
  "price_adjustment.rejected",
  "price_adjustment.applied",
  "price_adjustment.rolled_back",
  "tenant_settings.updated",
  "tenant_settings.feature_flag_changed",
  "tenant_onboarding.step_completed",
  "jobtread.export_downloaded",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Entity types recognized by the audit trail. */
export const AUDIT_ENTITY_TYPES = [
  "tenant",
  "tenant_settings",
  "project",
  "estimate_draft",
  "change_order",
  "project_closeout",
  "project_cost_actual",
  "field_task",
  "calibration_event",
  "calibration_report",
  "price_adjustment",
  "cost_code",
  "assembly",
  "geo_zone",
  "jobtread_export",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * Actions whose audit entry must carry both snapshots.
 * A money or permission change without a before/after cannot be explained six months later.
 */
export const AUDIT_ACTIONS_REQUIRING_SNAPSHOTS: readonly AuditAction[] = [
  "estimate.approved",
  "estimate.discount_applied",
  "change_order.approved",
  "price_adjustment.applied",
  "price_adjustment.rolled_back",
  "tenant_settings.updated",
  "tenant_settings.feature_flag_changed",
] as const;

// ═══════════════════════════════════════════════════════════════════
// ANALYTICS SNAPSHOTS (AN-001 … AN-004)
// ═══════════════════════════════════════════════════════════════════

/**
 * Aggregations that can be frozen for a period.
 *
 * A closed month must keep reporting what it closed with. Recomputing "last quarter" from live
 * data after three change orders landed produces a different past every time it is asked about.
 */
export const ANALYTICS_SNAPSHOT_TYPES = [
  "pipeline",
  "revenue_forecast",
  "profit_health",
  "field_progress",
  "subcontractor_leaderboard",
] as const;

export type AnalyticsSnapshotType = (typeof ANALYTICS_SNAPSHOT_TYPES)[number];

// ══════════════════════════════════════════════════════════════════════
// NORMALIZERS (idempotent, never throw, unknown → null)
// ══════════════════════════════════════════════════════════════════════

function buildLookup<T extends string>(
  canonicals: readonly T[],
  aliases: Record<string, T>,
): (input: string | null | undefined) => T | null {
  const map = new Map<string, T>();
  for (const c of canonicals) map.set(c.toLowerCase(), c);
  for (const [alias, canonical] of Object.entries(aliases)) {
    map.set(alias.toLowerCase().replace(/\s+/g, "_"), canonical);
  }
  return (input: string | null | undefined): T | null => {
    if (input == null || input === "") return null;
    const key = String(input).trim().toLowerCase().replace(/[\s-]+/g, "_");
    return map.get(key) ?? null;
  };
}

export const normalizeCalibrationEventType = buildLookup(
  CALIBRATION_EVENT_TYPES,
  CALIBRATION_EVENT_TYPE_ALIASES,
);

export const normalizeCalibrationEventStatus = buildLookup(
  CALIBRATION_EVENT_STATUSES,
  CALIBRATION_EVENT_STATUS_ALIASES,
);

export const normalizePriceAdjustmentStatus = buildLookup(
  PRICE_ADJUSTMENT_STATUSES,
  PRICE_ADJUSTMENT_STATUS_ALIASES,
);

export const normalizePriceAdjustmentTarget = buildLookup(PRICE_ADJUSTMENT_TARGETS, {
  costcode: "cost_code",
  code: "cost_code",
  item: "cost_code",
  bundle: "assembly",
  geo: "geo_factor",
  zone: "geo_factor",
  coastal: "geo_factor",
  duration: "duration_factor",
  schedule: "duration_factor",
});

export const normalizeTenantFeatureFlag = buildLookup(TENANT_FEATURE_FLAGS, {
  leads: "lead_intake",
  intake: "lead_intake",
  pre_visit: "previsit",
  scope: "scope_builder",
  geo: "geo_intelligence",
  pricing: "pricing_engine",
  margin_guard: "profit_shield",
  versioning: "estimate_versioning",
  jobtread: "jobtread_export",
  field: "field_operations",
  actuals: "actuals_ledger",
  subs: "subcontractor_management",
  learning: "calibration",
  adjustments: "price_adjustments",
  dashboard: "analytics",
  audit: "audit_trail",
  i18n: "multi_language",
});

export const normalizeTenantOnboardingStep = buildLookup(TENANT_ONBOARDING_STEPS, {
  created: "tenant_created",
  owner: "owner_user_assigned",
  branding: "branding_configured",
  region: "geo_region_configured",
  margins: "margin_floors_confirmed",
  cost_codes: "cost_codes_imported",
  price_book: "cost_codes_imported",
  assemblies: "assemblies_seeded",
  channels: "channels_configured",
  roles: "field_roles_assigned",
  jobtread: "jobtread_contract_verified",
  pilot: "pilot_project_completed",
});

export const normalizeAuditEntityType = buildLookup(AUDIT_ENTITY_TYPES, {
  estimate: "estimate_draft",
  estimate_drafts: "estimate_draft",
  closeout: "project_closeout",
  actual: "project_cost_actual",
  cost_actual: "project_cost_actual",
  task: "field_task",
  calibration: "calibration_event",
  adjustment: "price_adjustment",
  settings: "tenant_settings",
});

export const normalizeCalibrationScope = buildLookup(CALIBRATION_SCOPES, {
  job: "project",
  company: "tenant",
  org: "tenant",
});

export const normalizeCalibrationPeriod = buildLookup(CALIBRATION_PERIODS, {
  q: "quarter",
  quarterly: "quarter",
  monthly: "month",
  yearly: "year",
  annual: "year",
  lifetime: "all_time",
  all: "all_time",
});

// ══════════════════════════════════════════════════════════════════════
// TRANSITION AND MEMBERSHIP HELPERS
// ══════════════════════════════════════════════════════════════════════

/**
 * True when no further transition is possible.
 * `superseded` is the only true dead end: an `actioned` event can still be superseded by a
 * later aggregation, and a `dismissed` one can be reopened when new evidence arrives.
 */
export function isCalibrationEventTerminal(status: CalibrationEventStatus): boolean {
  return (CALIBRATION_EVENT_TRANSITIONS[status]?.length ?? 0) === 0;
}

/** True when a calibration event may move from `from` to `to` (CL-002). */
export function canTransitionCalibrationEvent(
  from: CalibrationEventStatus,
  to: CalibrationEventStatus,
): boolean {
  return CALIBRATION_EVENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** True when a price adjustment may move from `from` to `to` (PA-003). */
export function canTransitionPriceAdjustment(
  from: PriceAdjustmentStatus,
  to: PriceAdjustmentStatus,
): boolean {
  return PRICE_ADJUSTMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** True when the adjustment is currently influencing new estimates. */
export function isPriceAdjustmentLive(status: PriceAdjustmentStatus): boolean {
  return PRICE_ADJUSTMENT_LIVE_STATUSES.includes(status);
}

/** True when the adjustment can no longer change. */
export function isPriceAdjustmentTerminal(status: PriceAdjustmentStatus): boolean {
  return PRICE_ADJUSTMENT_TERMINAL_STATUSES.includes(status);
}

/** True when the flag can never be switched off (MT-001). */
export function isMandatoryFeatureFlag(flag: TenantFeatureFlag): boolean {
  return MANDATORY_TENANT_FEATURE_FLAGS.includes(flag);
}

/** True when the onboarding step blocks the first real commercial cycle. */
export function isBlockingOnboardingStep(step: TenantOnboardingStep): boolean {
  return TENANT_ONBOARDING_BLOCKING_STEPS.includes(step);
}

/** True when the audit action must carry before/after snapshots (AU-002). */
export function requiresAuditSnapshots(action: string): boolean {
  return (AUDIT_ACTIONS_REQUIRING_SNAPSHOTS as readonly string[]).includes(action);
}

/** Map a 0–100 confidence score and a sample count to a confidence band (CL-004). */
export function confidenceBandFor(score: number, sampleCount: number): ConfidenceBand {
  if (sampleCount < MIN_SAMPLES_FOR_CONFIDENCE) return "insufficient";
  const bounded = Math.max(0, Math.min(100, score));
  if (bounded >= CONFIDENCE_BAND_THRESHOLDS.high) return "high";
  if (bounded >= CONFIDENCE_BAND_THRESHOLDS.medium) return "medium";
  return "low";
}

/** Rank of a confidence band, for comparisons against `MIN_BAND_FOR_PROPOSAL`. */
export function confidenceBandRank(band: ConfidenceBand): number {
  return CONFIDENCE_BANDS.indexOf(band);
}

/** True when the band is strong enough to generate a proposed adjustment (PA-001). */
export function bandAllowsProposal(band: ConfidenceBand): boolean {
  return confidenceBandRank(band) >= confidenceBandRank(MIN_BAND_FOR_PROPOSAL);
}

/** Map a completeness score (0–100) to a verdict (SC4-002). */
export function scopeCompletenessVerdictFor(score: number): ScopeCompletenessVerdict {
  const bounded = Math.max(0, Math.min(100, score));
  if (bounded >= SCOPE_COMPLETENESS_THRESHOLDS.complete) return "complete";
  if (bounded >= SCOPE_COMPLETENESS_THRESHOLDS.minor_gaps) return "minor_gaps";
  if (bounded >= SCOPE_COMPLETENESS_THRESHOLDS.material_gaps) return "material_gaps";
  return "systemic_gaps";
}
