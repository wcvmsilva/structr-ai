/**
 * structr.ai Construction Brain — Geographic Override Engine
 * Sprint 16: Coastal Override Resolver
 *
 * Pure business logic for geographic assembly override resolution.
 * No database dependencies — works with in-memory data.
 *
 * Architecture:
 *   - Sits BETWEEN scope review approval and remodel workflow generation
 *   - Consumes: reviewed scope items + project zone + override rules
 *   - Produces: resolved scope items with swap/add/warning annotations
 *   - Does NOT modify pricing, quantities, or scope rules
 *   - Does NOT touch the database — caller handles persistence
 *
 * Override Types:
 *   1. SWAP  — replace original assembly with coastal-grade equivalent
 *   2. ADD   — inject additional assembly (e.g., hurricane straps)
 *   3. WARNING_ONLY — flag for operator review, no automatic change
 *
 * Idempotency:
 *   - Caller provides previouslyApplied log entries
 *   - Engine skips any override already in the log
 *   - Re-running produces identical output
 */

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Override rule (matches DB shape but decoupled) */
export interface OverrideRule {
  id: number;
  zone: string;
  trade: string;
  finishLevel: string | null;
  originalAssemblyId: number;
  replacementAssemblyId: number;
  overrideType: "swap" | "add" | "warning_only";
  reasonTemplate: string;
  active: boolean;
}

/** Scope item entering the resolver (from reviewed scope draft) */
export interface ResolverInputItem {
  assemblyId: number;
  assemblyName: string;
  trade: string | null;
  finishLevel: string | null;
  quantity: number;
  unit: string;
  reason: string;
  confidence: number;
  sortOrder: number;
}

/** Assembly lookup entry for name resolution */
export interface AssemblyLookupEntry {
  id: number;
  name: string;
  code: string;
  trade: string | null;
}

/** Previously applied override (from scope_override_log) */
export interface PreviousOverrideEntry {
  scopeDraftId: number;
  originalAssemblyId: number;
  replacementAssemblyId: number;
  overrideType: string;
}

/** Single resolved override action */
export interface ResolvedOverride {
  ruleId: number;
  originalAssemblyId: number;
  originalAssemblyName: string;
  replacementAssemblyId: number;
  replacementAssemblyName: string;
  overrideType: "swap" | "add" | "warning_only";
  overrideReason: string;
  zone: string;
  trade: string;
  skippedBecauseAlreadyApplied: boolean;
}

/** Resolved scope item (after overrides applied) */
export interface ResolvedScopeItem extends ResolverInputItem {
  /** If this item was produced by an override, the original assembly ID */
  overriddenFrom: number | null;
  /** Override type that produced this item */
  overrideType: "swap" | "add" | null;
  /** Human-readable reason for the override */
  overrideReason: string | null;
}

/** Complete resolver output */
export interface OverrideResolverOutput {
  /** Final resolved scope items (original items with swaps applied + additions injected) */
  resolvedItems: ResolvedScopeItem[];
  /** All override actions taken (including skipped-already-applied) */
  overrides: ResolvedOverride[];
  /** Warnings for operator review (warning_only overrides + informational messages) */
  warnings: string[];
  /** Summary statistics */
  stats: {
    totalInputItems: number;
    totalResolvedItems: number;
    swapsApplied: number;
    additionsApplied: number;
    warningsGenerated: number;
    skippedAlreadyApplied: number;
    rulesEvaluated: number;
    rulesMatched: number;
  };
  /** Whether any overrides were applied (false = passthrough) */
  hasOverrides: boolean;
  /** ISO timestamp of resolution */
  resolvedAt: string;
}

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Zones that trigger coastal override evaluation */
export const COASTAL_OVERRIDE_ZONES = [
  "Barrier Island Premium",
  "Charleston Coastal",
  "Kiawah/Seabrook",
  "IOP/Sullivans",
  "Folly Beach",
] as const;

/** Zones that never trigger overrides (passthrough) */
export const INLAND_PASSTHROUGH_ZONES = [
  "Charleston Metro",
  "Summerville/Goose Creek",
  "North Charleston",
  "West Ashley",
] as const;

/**
 * Check if a zone name is a coastal zone that may have overrides.
 * Uses case-insensitive partial matching for flexibility.
 */
export function isCoastalOverrideZone(zoneName: string): boolean {
  const lower = zoneName.toLowerCase();
  return COASTAL_OVERRIDE_ZONES.some(
    (z) => lower.includes(z.toLowerCase()) || z.toLowerCase().includes(lower)
  );
}

/**
 * Check if a zone name is an inland zone (passthrough, no overrides).
 */
export function isInlandPassthroughZone(zoneName: string): boolean {
  const lower = zoneName.toLowerCase();
  return INLAND_PASSTHROUGH_ZONES.some(
    (z) => lower.includes(z.toLowerCase()) || z.toLowerCase().includes(lower)
  );
}

// ══════════════════════════════════════════════════════════════════════
// RULE MATCHING
// ══════════════════════════════════════════════════════════════════════

/**
 * Find all active override rules that match a given zone and scope item.
 *
 * Matching logic:
 *   1. Rule zone must match project zone (case-insensitive)
 *   2. Rule trade must match item trade (case-insensitive)
 *   3. Rule originalAssemblyId must match item assemblyId
 *   4. If rule has finishLevel, it must match item finishLevel
 *   5. Rule must be active
 */
export function matchOverrideRules(
  item: ResolverInputItem,
  projectZone: string,
  rules: OverrideRule[]
): OverrideRule[] {
  return rules.filter((rule) => {
    if (!rule.active) return false;

    // Zone match (case-insensitive)
    if (rule.zone.toLowerCase() !== projectZone.toLowerCase()) return false;

    // Assembly match (exact ID)
    if (rule.originalAssemblyId !== item.assemblyId) return false;

    // Trade match (case-insensitive, both must be non-null)
    if (item.trade && rule.trade) {
      if (rule.trade.toLowerCase() !== item.trade.toLowerCase()) return false;
    }

    // Finish level match (if rule specifies one)
    if (rule.finishLevel !== null && rule.finishLevel !== undefined) {
      const itemFinish = (item.finishLevel ?? "standard").toLowerCase();
      if (rule.finishLevel.toLowerCase() !== itemFinish) return false;
    }

    return true;
  });
}

/**
 * Render a reason template with variable substitution.
 * Supported variables: {zone}, {trade}, {original}, {replacement}
 */
export function renderReasonTemplate(
  template: string,
  vars: {
    zone: string;
    trade: string;
    originalName: string;
    replacementName: string;
  }
): string {
  return template
    .replace(/\{zone\}/gi, vars.zone)
    .replace(/\{trade\}/gi, vars.trade)
    .replace(/\{original\}/gi, vars.originalName)
    .replace(/\{replacement\}/gi, vars.replacementName);
}

// ══════════════════════════════════════════════════════════════════════
// RESOLVER — MAIN PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Resolve geographic overrides for a set of scope items.
 *
 * This is the main entry point. It:
 *   1. Checks if the zone triggers overrides
 *   2. Matches rules against each scope item
 *   3. Applies swaps, additions, and warnings
 *   4. Checks idempotency against previously applied overrides
 *   5. Returns the resolved scope with full audit trail
 *
 * @param items        - Reviewed scope draft items
 * @param projectZone  - Project's detected zone name
 * @param rules        - All active override rules (engine filters by zone)
 * @param assemblyLookup - Assembly name/code lookup for replacement IDs
 * @param previouslyApplied - Override log entries for idempotency check
 */
export function resolveOverrides(
  items: ResolverInputItem[],
  projectZone: string,
  rules: OverrideRule[],
  assemblyLookup: Map<number, AssemblyLookupEntry>,
  previouslyApplied: PreviousOverrideEntry[] = []
): OverrideResolverOutput {
  const resolvedAt = new Date().toISOString();
  const overrides: ResolvedOverride[] = [];
  const warnings: string[] = [];
  let swapsApplied = 0;
  let additionsApplied = 0;
  let warningsGenerated = 0;
  let skippedAlreadyApplied = 0;
  let rulesMatched = 0;

  // Build a set of previously applied overrides for O(1) lookup
  const appliedSet = new Set(
    previouslyApplied.map(
      (p) => `${p.originalAssemblyId}:${p.replacementAssemblyId}:${p.overrideType}`
    )
  );

  // If zone is inland/metro or unknown, passthrough with no overrides
  if (!projectZone || projectZone === "unknown" || isInlandPassthroughZone(projectZone)) {
    return buildPassthroughOutput(items, rules.length, resolvedAt);
  }

  // Process each item
  const resolvedItems: ResolvedScopeItem[] = [];
  const additionsToInject: ResolvedScopeItem[] = [];

  for (const item of items) {
    const matchedRules = matchOverrideRules(item, projectZone, rules);

    if (matchedRules.length === 0) {
      // No override — passthrough
      resolvedItems.push(toResolvedItem(item));
      continue;
    }

    rulesMatched += matchedRules.length;

    for (const rule of matchedRules) {
      const originalName = item.assemblyName;
      const replacementLookup = assemblyLookup.get(rule.replacementAssemblyId);
      const replacementName = replacementLookup?.name ?? `Assembly #${rule.replacementAssemblyId}`;

      const reason = renderReasonTemplate(rule.reasonTemplate, {
        zone: projectZone,
        trade: rule.trade,
        originalName,
        replacementName,
      });

      // Idempotency check
      const alreadyAppliedKey = `${rule.originalAssemblyId}:${rule.replacementAssemblyId}:${rule.overrideType}`;
      const isAlreadyApplied = appliedSet.has(alreadyAppliedKey);

      const resolvedOverride: ResolvedOverride = {
        ruleId: rule.id,
        originalAssemblyId: rule.originalAssemblyId,
        originalAssemblyName: originalName,
        replacementAssemblyId: rule.replacementAssemblyId,
        replacementAssemblyName: replacementName,
        overrideType: rule.overrideType,
        overrideReason: reason,
        zone: projectZone,
        trade: rule.trade,
        skippedBecauseAlreadyApplied: isAlreadyApplied,
      };

      overrides.push(resolvedOverride);

      if (isAlreadyApplied) {
        skippedAlreadyApplied++;
        continue;
      }

      switch (rule.overrideType) {
        case "swap": {
          // Replace the item in-place — the item in resolvedItems will be the replacement
          // We handle this after the loop to avoid double-processing
          // For now, mark that this item was swapped
          const swappedItem: ResolvedScopeItem = {
            ...item,
            assemblyId: rule.replacementAssemblyId,
            assemblyName: replacementName,
            overriddenFrom: rule.originalAssemblyId,
            overrideType: "swap",
            overrideReason: reason,
          };
          // Replace the original item with the swapped version
          // We'll handle this by NOT pushing the original and pushing the swap instead
          resolvedItems.push(swappedItem);
          swapsApplied++;
          break;
        }

        case "add": {
          // Inject an additional assembly after the current item
          const addedItem: ResolvedScopeItem = {
            assemblyId: rule.replacementAssemblyId,
            assemblyName: replacementName,
            trade: replacementLookup?.trade ?? item.trade,
            finishLevel: item.finishLevel,
            quantity: item.quantity, // Same quantity as the triggering item
            unit: item.unit,
            reason: reason,
            confidence: 1.0, // Code-mandated addition
            sortOrder: item.sortOrder + 1, // Insert after the triggering item
            overriddenFrom: rule.originalAssemblyId,
            overrideType: "add",
            overrideReason: reason,
          };
          additionsToInject.push(addedItem);
          additionsApplied++;
          break;
        }

        case "warning_only": {
          warnings.push(
            `[${projectZone}] ${rule.trade}: ${reason}`
          );
          warningsGenerated++;
          break;
        }
      }
    }

    // If no swap was applied for this item, push the original
    const wasSwapped = matchedRules.some(
      (r) =>
        r.overrideType === "swap" &&
        !appliedSet.has(`${r.originalAssemblyId}:${r.replacementAssemblyId}:${r.overrideType}`)
    );
    if (!wasSwapped) {
      resolvedItems.push(toResolvedItem(item));
    }
  }

  // Inject additions at appropriate positions
  const finalItems = injectAdditions(resolvedItems, additionsToInject);

  // Re-number sort orders
  finalItems.forEach((item, idx) => {
    item.sortOrder = idx + 1;
  });

  const hasOverrides = swapsApplied > 0 || additionsApplied > 0 || warningsGenerated > 0;

  return {
    resolvedItems: finalItems,
    overrides,
    warnings,
    stats: {
      totalInputItems: items.length,
      totalResolvedItems: finalItems.length,
      swapsApplied,
      additionsApplied,
      warningsGenerated,
      skippedAlreadyApplied,
      rulesEvaluated: rules.length,
      rulesMatched,
    },
    hasOverrides,
    resolvedAt,
  };
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Convert a plain input item to a resolved item (no override) */
function toResolvedItem(item: ResolverInputItem): ResolvedScopeItem {
  return {
    ...item,
    overriddenFrom: null,
    overrideType: null,
    overrideReason: null,
  };
}

/** Build a passthrough output when no overrides apply */
function buildPassthroughOutput(
  items: ResolverInputItem[],
  rulesEvaluated: number,
  resolvedAt: string
): OverrideResolverOutput {
  return {
    resolvedItems: items.map(toResolvedItem),
    overrides: [],
    warnings: [],
    stats: {
      totalInputItems: items.length,
      totalResolvedItems: items.length,
      swapsApplied: 0,
      additionsApplied: 0,
      warningsGenerated: 0,
      skippedAlreadyApplied: 0,
      rulesEvaluated,
      rulesMatched: 0,
    },
    hasOverrides: false,
    resolvedAt,
  };
}

/**
 * Inject addition items into the resolved list at appropriate positions.
 * Additions are placed after the item they were triggered by (based on sortOrder).
 */
function injectAdditions(
  resolvedItems: ResolvedScopeItem[],
  additions: ResolvedScopeItem[]
): ResolvedScopeItem[] {
  if (additions.length === 0) return resolvedItems;

  // Group additions by their target sortOrder
  const additionsBySort = new Map<number, ResolvedScopeItem[]>();
  for (const add of additions) {
    const key = add.sortOrder - 1; // The triggering item's sortOrder
    if (!additionsBySort.has(key)) {
      additionsBySort.set(key, []);
    }
    additionsBySort.get(key)!.push(add);
  }

  // Build final list with additions injected
  const result: ResolvedScopeItem[] = [];
  for (const item of resolvedItems) {
    result.push(item);
    const adds = additionsBySort.get(item.sortOrder);
    if (adds) {
      result.push(...adds);
    }
  }

  // Any additions that didn't match a sort position go at the end
  Array.from(additionsBySort.entries()).forEach(([sortOrder, adds]) => {
    if (!resolvedItems.some((i) => i.sortOrder === sortOrder)) {
      result.push(...adds);
    }
  });

  return result;
}

// ══════════════════════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════════════════════

/** Validate an override rule for completeness */
export function validateOverrideRule(rule: Partial<OverrideRule>): string[] {
  const errors: string[] = [];

  if (!rule.zone || rule.zone.trim() === "") {
    errors.push("Zone is required");
  }
  if (!rule.trade || rule.trade.trim() === "") {
    errors.push("Trade is required");
  }
  if (!rule.originalAssemblyId || rule.originalAssemblyId <= 0) {
    errors.push("Original assembly ID must be a positive integer");
  }
  if (!rule.replacementAssemblyId || rule.replacementAssemblyId <= 0) {
    errors.push("Replacement assembly ID must be a positive integer");
  }
  if (rule.originalAssemblyId === rule.replacementAssemblyId) {
    errors.push("Original and replacement assembly IDs must be different");
  }
  if (!rule.overrideType || !["swap", "add", "warning_only"].includes(rule.overrideType)) {
    errors.push("Override type must be 'swap', 'add', or 'warning_only'");
  }
  if (!rule.reasonTemplate || rule.reasonTemplate.trim() === "") {
    errors.push("Reason template is required");
  }

  return errors;
}

/**
 * Validate that a resolver output is internally consistent.
 * Used in tests and diagnostic mode.
 */
export function validateResolverOutput(output: OverrideResolverOutput): string[] {
  const errors: string[] = [];

  // Stats consistency
  if (output.stats.totalResolvedItems !== output.resolvedItems.length) {
    errors.push(
      `Stats mismatch: totalResolvedItems=${output.stats.totalResolvedItems} but resolvedItems.length=${output.resolvedItems.length}`
    );
  }

  // All swap items must have overriddenFrom set
  for (const item of output.resolvedItems) {
    if (item.overrideType === "swap" && item.overriddenFrom === null) {
      errors.push(`Swap item ${item.assemblyId} missing overriddenFrom`);
    }
    if (item.overrideType === "add" && item.overriddenFrom === null) {
      errors.push(`Addition item ${item.assemblyId} missing overriddenFrom`);
    }
    if (item.overrideType === null && item.overriddenFrom !== null) {
      errors.push(`Non-override item ${item.assemblyId} has unexpected overriddenFrom`);
    }
  }

  // Warning count matches
  if (output.stats.warningsGenerated !== output.warnings.length) {
    errors.push(
      `Warning count mismatch: stats=${output.stats.warningsGenerated} but warnings.length=${output.warnings.length}`
    );
  }

  return errors;
}
