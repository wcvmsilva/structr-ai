/**
 * structr.ai — PHASE 3 Domain Taxonomy
 *
 * Closed vocabularies required by the Phase 3 contract (docs/phase3-contract.md):
 *   - Field task types and lifecycle states       (FO-001 … FO-006)
 *   - Assignee kinds (subcontractor vs own crew)
 *   - Actual cost statuses                        (AC-004)
 *   - Variance severity                           (§4)
 *   - Subcontractor status and compliance states  (SC-001 … SC-003)
 *   - Closeout states and checklist keys          (CO-001 … CO-003)
 *   - Weather conditions for the daily log
 *
 * PURE module: no DB, no IO, no side effects.
 *
 * Design note — why a separate file from `phase2-taxonomy.ts`: Phase 2 governs the
 * commercial decision (channel, evidence, margin floor). Phase 3 governs execution and
 * real cost. Keeping them apart means a change in field vocabulary can never silently
 * alter pricing behaviour.
 */

import { TRADES, type Trade } from "./taxonomy";

// ══════════════════════════════════════════════════════════════════════
// FIELD TASK TYPE
// ══════════════════════════════════════════════════════════════════════

/**
 * Execution task types. Trade-based types mirror `TRADES` so a task can be mapped to the
 * price book without a translation table; the remaining types are execution activities
 * that are not a trade (inspection, cleanup, mobilization, ...).
 */
export const FIELD_TASK_NON_TRADE_TYPES = [
  "mobilization",
  "material_delivery",
  "inspection",
  "cleanup",
  "punch_list",
  "closeout",
  "other",
] as const;

export type FieldTaskNonTradeType = (typeof FIELD_TASK_NON_TRADE_TYPES)[number];

export const FIELD_TASK_TYPES = [...TRADES, ...FIELD_TASK_NON_TRADE_TYPES] as const;

export type FieldTaskType = Trade | FieldTaskNonTradeType;

const FIELD_TASK_TYPE_ALIASES: Record<string, FieldTaskType> = {
  demo: "demolition",
  teardown: "demolition",
  strip_out: "demolition",
  frame: "framing",
  rough_framing: "framing",
  carpentry: "framing",
  electric: "electrical",
  elec: "electrical",
  wiring: "electrical",
  plumb: "plumbing",
  rough_plumbing: "plumbing",
  roof: "roofing",
  reroof: "roofing",
  shingles: "roofing",
  hardie: "siding",
  lap_siding: "siding",
  paint: "painting",
  finish_paint: "painting",
  interior_trim: "trim",
  millwork: "trim",
  baseboard: "trim",
  clean: "cleanup",
  final_clean: "cleanup",
  debris_removal: "cleanup",
  inspect: "inspection",
  code_inspection: "inspection",
  final_inspection: "inspection",
  punchlist: "punch_list",
  punch: "punch_list",
  mobilize: "mobilization",
  setup: "mobilization",
  delivery: "material_delivery",
  materials: "material_delivery",
  hvac_rough: "hvac",
  mechanical: "hvac",
  ac: "hvac",
  sheetrock: "drywall",
  tape_and_float: "drywall",
  slab: "concrete",
  footings: "foundation",
  tile_work: "tile",
  flooring_install: "flooring",
  cabinets: "cabinetry",
  window_install: "windows",
  door_install: "doors",
  deck: "decking",
  screen: "screening",
  fence: "fencing",
  landscape: "landscaping",
  general_labor: "general",
};

/**
 * Human-readable labels for the field task vocabulary.
 *
 * Derived rather than hand-written: a hand-written map drifts from the type list the first
 * time a trade is added, and the UI silently shows a raw enum key.
 */
export const FIELD_TASK_TYPE_LABELS: Record<FieldTaskType, string> = Object.fromEntries(
  FIELD_TASK_TYPES.map((type) => [
    type,
    type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" "),
  ]),
) as Record<FieldTaskType, string>;

/**
 * Minimum length of a block reason (FO-005).
 * Shared between the engine and the transport layer so both reject the same input.
 */
export const MIN_BLOCK_REASON_LENGTH = 5;

/** Task types that must exist before a project can be closed out. */
export const CLOSEOUT_CRITICAL_TASK_TYPES: readonly FieldTaskType[] = [
  "inspection",
  "punch_list",
  "cleanup",
] as const;

// ══════════════════════════════════════════════════════════════════════
// FIELD TASK STATUS (state machine — FO-001)
// ══════════════════════════════════════════════════════════════════════

export const FIELD_TASK_STATUSES = [
  "pending",
  "assigned",
  "in_progress",
  "completed",
  "verified",
  "blocked",
  "cancelled",
] as const;

export type FieldTaskStatus = (typeof FIELD_TASK_STATUSES)[number];

/**
 * Allowed transitions. `verified` and `cancelled` are terminal (FO-006).
 * `blocked` is reachable from any active state and returns to the state that makes sense
 * for the work already done, which is why it lists several successors.
 */
export const FIELD_TASK_TRANSITIONS: Record<FieldTaskStatus, readonly FieldTaskStatus[]> = {
  pending: ["assigned", "in_progress", "blocked", "cancelled"],
  assigned: ["in_progress", "pending", "blocked", "cancelled"],
  in_progress: ["completed", "blocked", "cancelled"],
  completed: ["verified", "in_progress", "blocked"],
  verified: [],
  blocked: ["pending", "assigned", "in_progress", "cancelled"],
  cancelled: [],
};

/** Statuses that count as "work no longer open" for the closeout gate (CO-001). */
export const FIELD_TASK_CLOSED_STATUSES: readonly FieldTaskStatus[] = [
  "completed",
  "verified",
  "cancelled",
] as const;

/** Statuses that block a closeout from opening. */
export const FIELD_TASK_OPEN_STATUSES: readonly FieldTaskStatus[] = [
  "pending",
  "assigned",
  "in_progress",
  "blocked",
] as const;

const FIELD_TASK_STATUS_ALIASES: Record<string, FieldTaskStatus> = {
  todo: "pending",
  not_started: "pending",
  open: "pending",
  scheduled: "assigned",
  dispatched: "assigned",
  active: "in_progress",
  working: "in_progress",
  started: "in_progress",
  done: "completed",
  finished: "completed",
  complete: "completed",
  approved: "verified",
  qc_passed: "verified",
  on_hold: "blocked",
  hold: "blocked",
  stalled: "blocked",
  canceled: "cancelled",
  void: "cancelled",
};

// ══════════════════════════════════════════════════════════════════════
// ASSIGNEE
// ══════════════════════════════════════════════════════════════════════

export const FIELD_ASSIGNEE_TYPES = ["subcontractor", "crew", "self_perform", "vendor"] as const;

export type FieldAssigneeType = (typeof FIELD_ASSIGNEE_TYPES)[number];

const FIELD_ASSIGNEE_TYPE_ALIASES: Record<string, FieldAssigneeType> = {
  sub: "subcontractor",
  subcontractor_company: "subcontractor",
  trade_partner: "subcontractor",
  internal: "crew",
  in_house: "crew",
  employee: "crew",
  own_crew: "crew",
  self: "self_perform",
  owner: "self_perform",
  supplier: "vendor",
};

// ══════════════════════════════════════════════════════════════════════
// FIELD TASK SOURCE
// ══════════════════════════════════════════════════════════════════════

export const FIELD_TASK_SOURCES = [
  "estimate",
  "change_order",
  "manual",
  "punch_list",
  "inspection",
] as const;

export type FieldTaskSource = (typeof FIELD_TASK_SOURCES)[number];

// ══════════════════════════════════════════════════════════════════════
// ACTUAL COST STATUS (AC-004)
// ══════════════════════════════════════════════════════════════════════

export const ACTUAL_STATUSES = ["pending", "approved", "paid", "rejected", "void"] as const;

export type ActualStatus = (typeof ACTUAL_STATUSES)[number];

export const ACTUAL_TRANSITIONS: Record<ActualStatus, readonly ActualStatus[]> = {
  pending: ["approved", "rejected", "void"],
  approved: ["paid", "void"],
  paid: [],
  rejected: [],
  void: [],
};

/**
 * Statuses that represent committed money. A `pending` actual is a cost pipeline, not a
 * commitment, so it must not inflate the variance report.
 */
export const ACTUAL_COMMITTED_STATUSES: readonly ActualStatus[] = ["approved", "paid"] as const;

const ACTUAL_STATUS_ALIASES: Record<string, ActualStatus> = {
  submitted: "pending",
  new: "pending",
  awaiting_approval: "pending",
  ok: "approved",
  authorized: "approved",
  settled: "paid",
  closed: "paid",
  denied: "rejected",
  declined: "rejected",
  cancelled: "void",
  canceled: "void",
  voided: "void",
};

// ══════════════════════════════════════════════════════════════════════
// ACTUAL COST CATEGORY
// ══════════════════════════════════════════════════════════════════════

/** Mirrors the JobTread Cost Type vocabulary so actuals stay reconcilable with exports. */
export const ACTUAL_COST_CATEGORIES = [
  "labor",
  "materials",
  "subcontractor",
  "equipment_rental",
  "permits_fees",
  "allowance",
  "other",
] as const;

export type ActualCostCategory = (typeof ACTUAL_COST_CATEGORIES)[number];

const ACTUAL_COST_CATEGORY_ALIASES: Record<string, ActualCostCategory> = {
  labour: "labor",
  payroll: "labor",
  wages: "labor",
  material: "materials",
  supplies: "materials",
  lumber: "materials",
  sub: "subcontractor",
  trade: "subcontractor",
  equipment: "equipment_rental",
  rental: "equipment_rental",
  "equipment / rental": "equipment_rental",
  permit: "permits_fees",
  fees: "permits_fees",
  "permits / fees": "permits_fees",
  contingency: "allowance",
  misc: "other",
};

// ══════════════════════════════════════════════════════════════════════
// VARIANCE SEVERITY (§4)
// ══════════════════════════════════════════════════════════════════════

export const VARIANCE_SEVERITIES = [
  "ok",
  "under_budget",
  "warning",
  "critical",
  "unbudgeted",
] as const;

export type VarianceSeverity = (typeof VARIANCE_SEVERITIES)[number];

/** Default overrun tolerance before an alert is raised (percent). */
export const DEFAULT_VARIANCE_THRESHOLD_PCT = 10;

/** Multiplier applied to the threshold to separate `warning` from `critical`. */
export const CRITICAL_VARIANCE_MULTIPLIER = 2;

/** Severities that must be reviewed before a project can be closed. */
export const VARIANCE_SEVERITIES_REQUIRING_REVIEW: readonly VarianceSeverity[] = [
  "critical",
  "unbudgeted",
] as const;

// ══════════════════════════════════════════════════════════════════════
// SUBCONTRACTOR
// ══════════════════════════════════════════════════════════════════════

export const SUBCONTRACTOR_STATUSES = ["active", "probation", "suspended", "archived"] as const;

export type SubcontractorStatus = (typeof SUBCONTRACTOR_STATUSES)[number];

/** Statuses that may receive a new field task assignment. */
export const SUBCONTRACTOR_ASSIGNABLE_STATUSES: readonly SubcontractorStatus[] = [
  "active",
  "probation",
] as const;

const SUBCONTRACTOR_STATUS_ALIASES: Record<string, SubcontractorStatus> = {
  approved: "active",
  enabled: "active",
  watchlist: "probation",
  warning: "probation",
  blocked: "suspended",
  disabled: "suspended",
  inactive: "archived",
  removed: "archived",
};

export const COMPLIANCE_STATES = ["compliant", "expiring", "expired", "missing"] as const;

export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

/** Days before expiry that turn a compliant document into an `expiring` alert. */
export const DEFAULT_COMPLIANCE_WARNING_DAYS = 30;

// ══════════════════════════════════════════════════════════════════════
// DAILY LOG
// ══════════════════════════════════════════════════════════════════════

export const WEATHER_CONDITIONS = [
  "clear",
  "partly_cloudy",
  "overcast",
  "rain",
  "heavy_rain",
  "storm",
  "wind",
  "heat_advisory",
  "freeze",
  "hurricane_watch",
] as const;

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

/** Conditions that stop exterior work in a coastal market. */
export const WORK_STOPPING_WEATHER: readonly WeatherCondition[] = [
  "heavy_rain",
  "storm",
  "hurricane_watch",
  "freeze",
] as const;

const WEATHER_CONDITION_ALIASES: Record<string, WeatherCondition> = {
  sunny: "clear",
  fair: "clear",
  cloudy: "overcast",
  showers: "rain",
  drizzle: "rain",
  downpour: "heavy_rain",
  thunderstorm: "storm",
  tstorm: "storm",
  windy: "wind",
  heat: "heat_advisory",
  frost: "freeze",
  hurricane: "hurricane_watch",
  tropical_storm: "hurricane_watch",
};

// ══════════════════════════════════════════════════════════════════════
// CLOSEOUT
// ══════════════════════════════════════════════════════════════════════

export const CLOSEOUT_STATUSES = [
  "blocked",
  "open",
  "in_progress",
  "ready_to_close",
  "closed",
] as const;

export type CloseoutStatus = (typeof CLOSEOUT_STATUSES)[number];

export const CLOSEOUT_TRANSITIONS: Record<CloseoutStatus, readonly CloseoutStatus[]> = {
  blocked: ["open"],
  open: ["in_progress", "blocked"],
  in_progress: ["ready_to_close", "blocked"],
  ready_to_close: ["closed", "in_progress"],
  closed: [],
};

/** Checklist items required before `ready_to_close` (CO-002). */
export const CLOSEOUT_CHECKLIST_KEYS = [
  "final_inspection_passed",
  "punch_list_complete",
  "lien_waivers_collected",
  "final_payment_received",
  "warranty_docs_delivered",
] as const;

export type CloseoutChecklistKey = (typeof CLOSEOUT_CHECKLIST_KEYS)[number];

export const CLOSEOUT_CHECKLIST_LABELS: Record<CloseoutChecklistKey, string> = {
  final_inspection_passed: "Final inspection passed",
  punch_list_complete: "Punch list complete",
  lien_waivers_collected: "Lien waivers collected",
  final_payment_received: "Final payment received",
  warranty_docs_delivered: "Warranty documents delivered",
};

/** Client satisfaction is captured on a 0–10 scale. */
export const CLIENT_SATISFACTION_MIN = 0;
export const CLIENT_SATISFACTION_MAX = 10;

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

export const normalizeFieldTaskType = buildLookup(FIELD_TASK_TYPES, FIELD_TASK_TYPE_ALIASES);
export const normalizeFieldTaskStatus = buildLookup(
  FIELD_TASK_STATUSES,
  FIELD_TASK_STATUS_ALIASES,
);
export const normalizeAssigneeType = buildLookup(
  FIELD_ASSIGNEE_TYPES,
  FIELD_ASSIGNEE_TYPE_ALIASES,
);
export const normalizeActualStatus = buildLookup(ACTUAL_STATUSES, ACTUAL_STATUS_ALIASES);
export const normalizeActualCostCategory = buildLookup(
  ACTUAL_COST_CATEGORIES,
  ACTUAL_COST_CATEGORY_ALIASES,
);
export const normalizeSubcontractorStatus = buildLookup(
  SUBCONTRACTOR_STATUSES,
  SUBCONTRACTOR_STATUS_ALIASES,
);
export const normalizeWeatherCondition = buildLookup(
  WEATHER_CONDITIONS,
  WEATHER_CONDITION_ALIASES,
);
export const normalizeCloseoutStatus = buildLookup(CLOSEOUT_STATUSES, {
  not_started: "open",
  started: "in_progress",
  ready: "ready_to_close",
  done: "closed",
  complete: "closed",
});

// ══════════════════════════════════════════════════════════════════════
// TRANSITION HELPERS
// ══════════════════════════════════════════════════════════════════════

/** True when a field task may move from `from` to `to` (FO-006). */
export function canTransitionFieldTask(from: FieldTaskStatus, to: FieldTaskStatus): boolean {
  return FIELD_TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

/** True when an actual may move from `from` to `to` (AC-004). */
export function canTransitionActual(from: ActualStatus, to: ActualStatus): boolean {
  return ACTUAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** True when a closeout may move from `from` to `to`. */
export function canTransitionCloseout(from: CloseoutStatus, to: CloseoutStatus): boolean {
  return CLOSEOUT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** True when the task status still counts as open work for the closeout gate. */
export function isFieldTaskOpen(status: FieldTaskStatus): boolean {
  return FIELD_TASK_OPEN_STATUSES.includes(status);
}

/** True when the actual represents committed money for variance purposes. */
export function isActualCommitted(status: ActualStatus): boolean {
  return ACTUAL_COMMITTED_STATUSES.includes(status);
}

/** True when the subcontractor status allows a new assignment. */
export function isAssignableSubcontractorStatus(status: SubcontractorStatus): boolean {
  return SUBCONTRACTOR_ASSIGNABLE_STATUSES.includes(status);
}
