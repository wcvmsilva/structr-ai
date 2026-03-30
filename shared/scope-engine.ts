/**
 * structr.ai — Scope Builder Engine
 * Sprint 12: Deterministic Scope Generation
 *
 * Pure business logic for scope generation from intake data.
 * No database dependencies — works with in-memory data.
 * No pricing logic — scope only (what + quantity).
 *
 * Architecture Rules:
 *   1. Selects assemblies only
 *   2. Calculates quantity only
 *   3. Does NOT compute price
 *   4. Does NOT apply Profit Shield
 *   5. All matching uses canonical taxonomy
 *   6. Geographic context is input, not calculation logic
 *   7. Every selected assembly includes a reason
 *   8. Missing data generates warnings
 *
 * Key capabilities:
 *   1. matchRules()               — deterministic rule matching
 *   2. evaluateQuantityFormula()   — quantity computation from formulas
 *   3. generateScopeDraft()        — full scope generation pipeline
 *   4. generateGeoWarnings()       — geographic warning generation
 *   5. convertScopeToBundle()      — ScopeDraft → Bundle conversion
 */

import type { ZoneModifierSnapshot, GeoZoneData } from "./geo-engine";
import { COASTAL_EXPOSURE_ORDER } from "./geo-engine";
import type { ScopeRuleCondition } from "../drizzle/schema";
import {
  normalizeServiceType,
  normalizeFinishLevel,
  normalizeChannel,
  normalizeCondition,
  normalizeCategory,
} from "./domain/normalization";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

/** Minimal assembly data needed for scope generation (no pricing fields) */
export interface ScopeAssemblyRef {
  id: string;
  code: string | null;
  name: string;
  category: string;
  trade: string | null;
  finishLevel: string | null;
  defaultUnit: string | null;
  coastalModifier: string | null;
}

/** Scope rule data (matches DB shape but decoupled) */
export interface ScopeRuleData {
  id: string;
  ruleCode: string | null;
  serviceType: string | null;
  projectType: string | null;
  channel: string | null;
  zone: string | null;
  finishLevel: string | null;
  conditionJson: ScopeRuleCondition[] | null;
  assemblyId: string | null;
  quantityFormula: string | null;
  reasonTemplate: string | null;
  priority: number;
  isActive: boolean;
}

/** Intake data for scope generation */
export interface ScopeIntakeData {
  serviceType: string;
  area?: string | null;
  finishLevel?: string | null;
  condition?: string | null;
  channel?: string | null;
  notes?: string | null;
}

/** Project context for scope generation */
export interface ScopeProjectContext {
  projectType?: string | null;
  zone?: string | null;
  zipCode?: string | null;
  channel?: string | null;
  zoneModifierSnapshot?: ZoneModifierSnapshot | null;
}

/** Result of rule matching for a single rule */
export interface RuleMatchResult {
  rule: ScopeRuleData;
  matched: boolean;
  matchScore: number; // Higher = more specific match
  reason: string;
}

/** A single scope item (assembly + quantity + reason) */
export interface ScopeItem {
  assemblyId: string;
  assemblyCode: string;
  assemblyName: string;
  category: string;
  trade: string | null;
  quantity: number;
  unit: string;
  reason: string;
  confidence: number; // 0.0 to 1.0
  ruleCode: string;
  sortOrder: number;
}

/** Complete scope draft output */
export interface ScopeDraftOutput {
  items: ScopeItem[];
  warnings: string[];
  confidenceScore: number; // 0.0 to 1.0
  metadata: {
    rulesEvaluated: number;
    rulesMatched: number;
    assembliesSelected: number;
    intakeServiceType: string;
    intakeFinishLevel: string;
    projectZone: string;
    generatedAt: string;
  };
}

/** Bundle-ready assembly selection (for convertScopeToBundle) */
export interface BundleAssemblySelection {
  assemblyId: string;
  assemblyName: string;
  assemblyCode: string;
  category: string;
  trade: string | null;
  quantity: number;
}

/** Quantity formula context variables */
export interface FormulaContext {
  area: number;
  rooms: number;
  units: number;
  length: number;
  width: number;
  height: number;
  wasteFactor: number;
  luxuryMultiplier: number;
}

// ══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════

/** Default waste factor when not available from Price Book */
export const DEFAULT_WASTE_FACTOR = 1.10;

/** Luxury complexity multiplier (per spec: 1.15) */
export const LUXURY_COMPLEXITY_MULTIPLIER = 1.15;

/** Default area when not provided (sq ft) */
export const DEFAULT_AREA_SQFT = 100;

/** Minimum confidence score */
export const MIN_CONFIDENCE = 0.30;

/** Maximum confidence score */
export const MAX_CONFIDENCE = 1.00;

/** Coastal exposure levels that trigger coastal warnings */
export const COASTAL_WARNING_THRESHOLD = "high"; // "high" and "extreme" trigger warnings

/** Zone names that require coastal-grade assemblies */
export const COASTAL_ZONES = ["Barrier Island Premium", "Charleston Coastal"];

// ══════════════════════════════════════════════════════════════════════
// RULE MATCHING — Deterministic
// ══════════════════════════════════════════════════════════════════════

/**
 * Match a single scope rule against intake + project context.
 * Returns whether the rule matches and a specificity score.
 *
 * Matching logic:
 *   1. service_type MUST match (required field)
 *   2. Optional fields (finish_level, project_type, channel, zone) increase specificity
 *   3. condition_json is evaluated as AND conditions
 *   4. Higher specificity = higher match score = higher priority
 */
export function matchRule(
  rule: ScopeRuleData,
  intake: ScopeIntakeData,
  project: ScopeProjectContext
): RuleMatchResult {
  // Normalize inputs for comparison
  const intakeServiceType = normalizeServiceType(intake.serviceType);
  const intakeFinishLevel = normalizeFinishLevel(intake.finishLevel);
  const intakeChannel = normalizeChannel(intake.channel ?? project.channel);
  const intakeCondition = normalizeCondition(intake.condition);

  // Normalize rule values
  const ruleServiceType = normalizeServiceType(rule.serviceType);

  // 1. Service type MUST match
  if (!intakeServiceType || !ruleServiceType || intakeServiceType !== ruleServiceType) {
    return {
      rule,
      matched: false,
      matchScore: 0,
      reason: `Service type mismatch: intake=${intakeServiceType}, rule=${ruleServiceType}`,
    };
  }

  let matchScore = 1; // Base score for service_type match

  // 2. Optional field matching — each match increases specificity
  // finish_level
  if (rule.finishLevel) {
    const ruleFinish = normalizeFinishLevel(rule.finishLevel);
    if (ruleFinish && intakeFinishLevel && ruleFinish !== intakeFinishLevel) {
      return {
        rule,
        matched: false,
        matchScore: 0,
        reason: `Finish level mismatch: intake=${intakeFinishLevel}, rule=${ruleFinish}`,
      };
    }
    if (ruleFinish && intakeFinishLevel && ruleFinish === intakeFinishLevel) {
      matchScore += 2; // Finish level is a strong discriminator
    }
  }

  // project_type
  if (rule.projectType) {
    const projectType = project.projectType || null;
    if (projectType && rule.projectType !== projectType) {
      return {
        rule,
        matched: false,
        matchScore: 0,
        reason: `Project type mismatch: project=${projectType}, rule=${rule.projectType}`,
      };
    }
    if (projectType && rule.projectType === projectType) {
      matchScore += 1;
    }
  }

  // channel
  if (rule.channel) {
    const ruleChannel = normalizeChannel(rule.channel);
    if (ruleChannel && intakeChannel && ruleChannel !== intakeChannel) {
      return {
        rule,
        matched: false,
        matchScore: 0,
        reason: `Channel mismatch: intake=${intakeChannel}, rule=${ruleChannel}`,
      };
    }
    if (ruleChannel && intakeChannel && ruleChannel === intakeChannel) {
      matchScore += 1;
    }
  }

  // zone
  if (rule.zone) {
    const projectZone = project.zone || project.zoneModifierSnapshot?.zoneName || null;
    if (projectZone && rule.zone !== projectZone) {
      return {
        rule,
        matched: false,
        matchScore: 0,
        reason: `Zone mismatch: project=${projectZone}, rule=${rule.zone}`,
      };
    }
    if (projectZone && rule.zone === projectZone) {
      matchScore += 3; // Zone is the strongest discriminator
    }
  }

  // 3. Condition JSON evaluation (AND logic)
  if (rule.conditionJson && rule.conditionJson.length > 0) {
    const conditionResult = evaluateConditions(rule.conditionJson, intake, project);
    if (!conditionResult.passed) {
      return {
        rule,
        matched: false,
        matchScore: 0,
        reason: `Condition failed: ${conditionResult.failedField}`,
      };
    }
    matchScore += conditionResult.matchedCount;
  }

  // Build reason from template
  const reason = interpolateReasonTemplate(rule.reasonTemplate ?? "", intake, project);

  return {
    rule,
    matched: true,
    matchScore,
    reason,
  };
}

/**
 * Match all rules against intake + project context.
 * Returns matched rules sorted by priority (lower number = higher priority),
 * then by match score (higher = more specific).
 *
 * Deduplication: If multiple rules select the same assembly_id,
 * keep only the most specific (highest matchScore) one.
 */
export function matchRules(
  rules: ScopeRuleData[],
  intake: ScopeIntakeData,
  project: ScopeProjectContext
): RuleMatchResult[] {
  const activeRules = rules.filter(r => r.isActive);

  const results = activeRules.map(rule => matchRule(rule, intake, project));
  const matched = results.filter(r => r.matched);

  // Sort by priority (ascending), then matchScore (descending)
  matched.sort((a, b) => {
    if (a.rule.priority !== b.rule.priority) {
      return a.rule.priority - b.rule.priority;
    }
    return b.matchScore - a.matchScore;
  });

  // Deduplicate by assembly_id — keep highest matchScore
  const seen = new Map<string, RuleMatchResult>();
  for (const result of matched) {
    const existing = seen.get(result.rule.assemblyId!);
    if (!existing || result.matchScore > existing.matchScore) {
      seen.set(result.rule.assemblyId!, result);
    }
  }

  return Array.from(seen.values());
}

// ══════════════════════════════════════════════════════════════════════
// CONDITION EVALUATION
// ══════════════════════════════════════════════════════════════════════

interface ConditionEvalResult {
  passed: boolean;
  matchedCount: number;
  failedField?: string;
}

/**
 * Evaluate condition_json array (AND logic).
 * Each condition must pass for the rule to match.
 */
export function evaluateConditions(
  conditions: ScopeRuleCondition[],
  intake: ScopeIntakeData,
  project: ScopeProjectContext
): ConditionEvalResult {
  let matchedCount = 0;

  for (const cond of conditions) {
    const value = resolveConditionField(cond.field, intake, project);

    if (!evaluateSingleCondition(cond, value)) {
      return { passed: false, matchedCount, failedField: cond.field };
    }
    matchedCount++;
  }

  return { passed: true, matchedCount };
}

/**
 * Resolve a condition field to its actual value from intake/project.
 */
function resolveConditionField(
  field: string,
  intake: ScopeIntakeData,
  project: ScopeProjectContext
): string | number | null {
  switch (field) {
    case "condition":
      return normalizeCondition(intake.condition) ?? intake.condition ?? null;
    case "finish_level":
    case "finishLevel":
      return normalizeFinishLevel(intake.finishLevel) ?? null;
    case "channel":
      return normalizeChannel(intake.channel ?? project.channel) ?? null;
    case "service_type":
    case "serviceType":
      return normalizeServiceType(intake.serviceType) ?? null;
    case "area":
      return parseArea(intake.area);
    case "area_gte":
    case "area_lte":
      return parseArea(intake.area);
    case "zone":
      return project.zone ?? project.zoneModifierSnapshot?.zoneName ?? null;
    case "project_type":
    case "projectType":
      return project.projectType ?? null;
    case "coastal_exposure":
    case "coastalExposure":
      return project.zoneModifierSnapshot?.coastalExposureLevel ?? "none";
    default:
      return null;
  }
}

/**
 * Evaluate a single condition against a value.
 */
function evaluateSingleCondition(
  cond: ScopeRuleCondition,
  value: string | number | null
): boolean {
  if (value === null || value === undefined) {
    // If the field is not available, the condition cannot be evaluated
    // For "neq" operator, null != something is true
    if (cond.op === "neq") return true;
    return false;
  }

  switch (cond.op) {
    case "eq":
      return String(value).toLowerCase() === String(cond.value).toLowerCase();
    case "neq":
      return String(value).toLowerCase() !== String(cond.value).toLowerCase();
    case "in":
      if (Array.isArray(cond.value)) {
        return cond.value.some(v => String(v).toLowerCase() === String(value).toLowerCase());
      }
      return false;
    case "gte":
      return Number(value) >= Number(cond.value);
    case "lte":
      return Number(value) <= Number(cond.value);
    case "contains":
      return String(value).toLowerCase().includes(String(cond.value).toLowerCase());
    default:
      return false;
  }
}

// ══════════════════════════════════════════════════════════════════════
// QUANTITY FORMULAS
// ══════════════════════════════════════════════════════════════════════

/**
 * Parse area string into a numeric value.
 * Handles formats: "200", "200 sqft", "200 sq ft", "10x20", etc.
 */
export function parseArea(area: string | null | undefined): number {
  if (!area) return DEFAULT_AREA_SQFT;

  const trimmed = area.trim();

  // Try dimension format: "10x20" or "10 x 20"
  const dimMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)$/);
  if (dimMatch) {
    return parseFloat(dimMatch[1]) * parseFloat(dimMatch[2]);
  }

  // Try numeric with optional unit: "200", "200 sqft", "200 sq ft"
  const numMatch = trimmed.match(/^(\d+(?:\.\d+)?)/);
  if (numMatch) {
    return parseFloat(numMatch[1]);
  }

  return DEFAULT_AREA_SQFT;
}

/**
 * Build the formula context from intake + project data.
 */
export function buildFormulaContext(
  intake: ScopeIntakeData,
  _project: ScopeProjectContext,
  wasteFactor?: number
): FormulaContext {
  const area = parseArea(intake.area);
  const isLuxury = normalizeFinishLevel(intake.finishLevel) === "luxury";

  return {
    area,
    rooms: Math.max(1, Math.ceil(area / 150)), // Rough estimate: 1 room per 150 sqft
    units: Math.max(1, Math.ceil(area / 15)),   // Rough estimate: 1 unit per 15 sqft (windows/doors)
    length: Math.sqrt(area),                     // Approximate dimension
    width: Math.sqrt(area),                      // Approximate dimension
    height: 8,                                   // Standard ceiling height
    wasteFactor: wasteFactor ?? DEFAULT_WASTE_FACTOR,
    luxuryMultiplier: isLuxury ? LUXURY_COMPLEXITY_MULTIPLIER : 1.0,
  };
}

/**
 * Evaluate a quantity formula string.
 *
 * Supported formulas:
 *   - "1"                        → fixed quantity
 *   - "area / 100"               → area-based
 *   - "area * waste_factor"      → with waste
 *   - "area * waste_factor * luxury_multiplier" → with luxury
 *   - "rooms"                    → room count
 *   - "units"                    → unit count
 *   - "length * 2 + width * 2"  → perimeter
 *   - "ceil(area / 32)"         → ceiling division
 *
 * All formulas are evaluated safely (no eval).
 */
export function evaluateQuantityFormula(
  formula: string,
  ctx: FormulaContext
): number {
  if (!formula || formula.trim() === "") return 1;

  let expr = formula.trim().toLowerCase();

  // Replace variable names with values
  expr = expr.replace(/\barea\b/g, String(ctx.area));
  expr = expr.replace(/\brooms\b/g, String(ctx.rooms));
  expr = expr.replace(/\bunits\b/g, String(ctx.units));
  expr = expr.replace(/\blength\b/g, String(ctx.length));
  expr = expr.replace(/\bwidth\b/g, String(ctx.width));
  expr = expr.replace(/\bheight\b/g, String(ctx.height));
  expr = expr.replace(/\bwaste_factor\b/g, String(ctx.wasteFactor));
  expr = expr.replace(/\bluxury_multiplier\b/g, String(ctx.luxuryMultiplier));

  // Handle ceil() function
  expr = expr.replace(/ceil\(([^)]+)\)/g, (_, inner) => {
    const val = safeEvaluateArithmetic(inner);
    return String(Math.ceil(val));
  });

  // Handle floor() function
  expr = expr.replace(/floor\(([^)]+)\)/g, (_, inner) => {
    const val = safeEvaluateArithmetic(inner);
    return String(Math.floor(val));
  });

  // Handle round() function
  expr = expr.replace(/round\(([^)]+)\)/g, (_, inner) => {
    const val = safeEvaluateArithmetic(inner);
    return String(Math.round(val));
  });

  // Handle max(a, b) function
  expr = expr.replace(/max\(([^,]+),\s*([^)]+)\)/g, (_, a, b) => {
    return String(Math.max(safeEvaluateArithmetic(a), safeEvaluateArithmetic(b)));
  });

  // Handle min(a, b) function
  expr = expr.replace(/min\(([^,]+),\s*([^)]+)\)/g, (_, a, b) => {
    return String(Math.min(safeEvaluateArithmetic(a), safeEvaluateArithmetic(b)));
  });

  const result = safeEvaluateArithmetic(expr);

  // Ensure minimum quantity of 1
  return Math.max(1, result);
}

/**
 * Safe arithmetic evaluator — no eval().
 * Supports: +, -, *, /, parentheses, and decimal numbers.
 */
export function safeEvaluateArithmetic(expr: string): number {
  // Remove whitespace
  const cleaned = expr.replace(/\s+/g, "");

  // Validate: only allow digits, operators, parentheses, decimal points
  if (!/^[\d+\-*/().]+$/.test(cleaned)) {
    return 1; // Invalid expression → default to 1
  }

  try {
    // Tokenize and evaluate using recursive descent parser
    return parseExpression(cleaned, { pos: 0 });
  } catch {
    return 1; // Parse error → default to 1
  }
}

// ── Recursive descent parser for arithmetic ──

interface ParseState {
  pos: number;
}

function parseExpression(expr: string, state: ParseState): number {
  let result = parseTerm(expr, state);
  while (state.pos < expr.length) {
    const op = expr[state.pos];
    if (op !== "+" && op !== "-") break;
    state.pos++;
    const term = parseTerm(expr, state);
    result = op === "+" ? result + term : result - term;
  }
  return result;
}

function parseTerm(expr: string, state: ParseState): number {
  let result = parseFactor(expr, state);
  while (state.pos < expr.length) {
    const op = expr[state.pos];
    if (op !== "*" && op !== "/") break;
    state.pos++;
    const factor = parseFactor(expr, state);
    result = op === "*" ? result * factor : (factor !== 0 ? result / factor : 1);
  }
  return result;
}

function parseFactor(expr: string, state: ParseState): number {
  // Handle unary minus
  if (expr[state.pos] === "-") {
    state.pos++;
    return -parseFactor(expr, state);
  }

  // Handle parentheses
  if (expr[state.pos] === "(") {
    state.pos++; // skip '('
    const result = parseExpression(expr, state);
    if (expr[state.pos] === ")") state.pos++; // skip ')'
    return result;
  }

  // Parse number
  const start = state.pos;
  while (state.pos < expr.length && (/\d/.test(expr[state.pos]) || expr[state.pos] === ".")) {
    state.pos++;
  }
  const numStr = expr.substring(start, state.pos);
  return numStr ? parseFloat(numStr) : 0;
}

// ══════════════════════════════════════════════════════════════════════
// GEOGRAPHIC WARNINGS
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate geographic warnings based on zone context and selected assemblies.
 *
 * Warnings are generated when:
 *   1. Coastal zone detected but no coastal-grade assemblies selected
 *   2. High/extreme coastal exposure without coastal hardening
 *   3. Zone modifiers are significantly elevated
 */
export function generateGeoWarnings(
  project: ScopeProjectContext,
  selectedAssemblies: ScopeAssemblyRef[]
): string[] {
  const warnings: string[] = [];
  const snapshot = project.zoneModifierSnapshot;

  if (!snapshot) {
    warnings.push("No geographic zone assigned to project. Zone modifiers will not be applied.");
    return warnings;
  }

  const zoneName = snapshot.zoneName;
  const coastalLevel = snapshot.coastalExposureLevel;
  const coastalOrder = COASTAL_EXPOSURE_ORDER[coastalLevel] ?? 0;
  const thresholdOrder = COASTAL_EXPOSURE_ORDER[COASTAL_WARNING_THRESHOLD] ?? 3;

  // Check if coastal zone requires coastal-grade assemblies
  if (coastalOrder >= thresholdOrder) {
    const hasCoastalAssemblies = selectedAssemblies.some(
      a => a.coastalModifier && parseFloat(a.coastalModifier) > 1.0
    );

    if (!hasCoastalAssemblies) {
      warnings.push(
        `${zoneName} zone detected (coastal exposure: ${coastalLevel}). ` +
        `Coastal-grade components recommended. Review assembly selections for marine-rated alternatives.`
      );
    }
  }

  // Barrier Island Premium specific warning
  if (COASTAL_ZONES.includes(zoneName)) {
    warnings.push(
      `Project is in ${zoneName} zone. Applied Coastal Hardening Logic. ` +
      `Verify all exterior assemblies meet coastal building code requirements.`
    );
  }

  // High logistics complexity warning
  if (snapshot.logisticsModifier > 1.15) {
    warnings.push(
      `${zoneName} has elevated logistics complexity (modifier: ${snapshot.logisticsModifier}x). ` +
      `Consider delivery scheduling and material staging requirements.`
    );
  }

  // Elevated contingency warning
  if (snapshot.contingencyPct > 3.0) {
    warnings.push(
      `${zoneName} zone carries ${snapshot.contingencyPct}% contingency due to environmental factors.`
    );
  }

  return warnings;
}

// ══════════════════════════════════════════════════════════════════════
// SCOPE DRAFT GENERATION — Main Pipeline
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate a complete scope draft from intake data.
 *
 * Pipeline:
 *   1. Normalize intake data
 *   2. Match rules against intake + project context
 *   3. Resolve assemblies for matched rules
 *   4. Compute quantities using formulas
 *   5. Generate geographic warnings
 *   6. Compute confidence score
 *   7. Return ScopeDraftOutput
 */
export function generateScopeDraft(
  intake: ScopeIntakeData,
  project: ScopeProjectContext,
  rules: ScopeRuleData[],
  assemblies: ScopeAssemblyRef[],
  wasteFactors?: Map<string, number> // assemblyId → waste factor from Price Book
): ScopeDraftOutput {
  const warnings: string[] = [];

  // 1. Validate intake
  const intakeWarnings = validateIntakeForScope(intake);
  warnings.push(...intakeWarnings);

  // 2. Match rules
  const matchedRules = matchRules(rules, intake, project);

  if (matchedRules.length === 0) {
    warnings.push(
      `No scope rules matched for service type "${intake.serviceType}". ` +
      `Manual scope definition required.`
    );
  }

  // 3. Build assembly lookup
  const assemblyMap = new Map<string, ScopeAssemblyRef>();
  for (const a of assemblies) {
    assemblyMap.set(a.id, a);
  }

  // 4. Generate scope items
  const items: ScopeItem[] = [];
  let sortOrder = 0;

  for (const match of matchedRules) {
    const assembly = assemblyMap.get(match.rule.assemblyId!);
    if (!assembly) {
      warnings.push(
        `Rule ${match.rule.ruleCode} references assembly ID ${match.rule.assemblyId} ` +
        `which was not found in the assembly library.`
      );
      continue;
    }

    // Get waste factor from Price Book or default
    const wasteFactor = wasteFactors?.get(assembly.id) ?? DEFAULT_WASTE_FACTOR;

    // Build formula context
    const formulaCtx = buildFormulaContext(intake, project, wasteFactor);

    // Evaluate quantity
    const quantity = evaluateQuantityFormula(match.rule.quantityFormula ?? "1", formulaCtx);

    // Compute item confidence
    const itemConfidence = computeItemConfidence(match.matchScore, intake);

    sortOrder++;
    items.push({
      assemblyId: assembly.id,
      assemblyCode: assembly.code,
      assemblyName: assembly.name,
      category: assembly.category,
      trade: assembly.trade,
      quantity,
      unit: assembly.defaultUnit ?? "EA",
      reason: match.reason,
      confidence: itemConfidence,
      ruleCode: match.rule.ruleCode ?? "",
      sortOrder,
    });
  }

  // 5. Generate geographic warnings
  const selectedAssemblyRefs = items
    .map(item => assemblyMap.get(item.assemblyId))
    .filter(Boolean) as ScopeAssemblyRef[];
  const geoWarnings = generateGeoWarnings(project, selectedAssemblyRefs);
  warnings.push(...geoWarnings);

  // 6. Compute overall confidence
  const confidenceScore = computeDraftConfidence(items, intake, matchedRules.length);

  // 7. Build metadata
  const intakeServiceType = normalizeServiceType(intake.serviceType) ?? intake.serviceType;
  const intakeFinishLevel = normalizeFinishLevel(intake.finishLevel) ?? "standard";
  const projectZone = project.zone ?? project.zoneModifierSnapshot?.zoneName ?? "unknown";

  return {
    items,
    warnings,
    confidenceScore,
    metadata: {
      rulesEvaluated: rules.filter(r => r.isActive).length,
      rulesMatched: matchedRules.length,
      assembliesSelected: items.length,
      intakeServiceType,
      intakeFinishLevel,
      projectZone,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════
// BUNDLE CONVERSION
// ══════════════════════════════════════════════════════════════════════

/**
 * Convert a ScopeDraft output to bundle-ready assembly selections.
 *
 * Flow: ScopeDraft → Bundle → Estimate Draft
 *
 * Assemblies and quantities remain unchanged.
 * This function strips scope-specific metadata and produces
 * the format expected by the Bundle Calculator.
 */
export function convertScopeToBundle(
  draft: ScopeDraftOutput
): BundleAssemblySelection[] {
  return draft.items.map(item => ({
    assemblyId: item.assemblyId,
    assemblyName: item.assemblyName,
    assemblyCode: item.assemblyCode,
    category: item.category,
    trade: item.trade,
    quantity: item.quantity,
  }));
}

// ══════════════════════════════════════════════════════════════════════
// CONFIDENCE SCORING
// ══════════════════════════════════════════════════════════════════════

/**
 * Compute confidence for a single scope item.
 * Based on rule match specificity and intake data completeness.
 */
function computeItemConfidence(matchScore: number, intake: ScopeIntakeData): number {
  let confidence = MIN_CONFIDENCE;

  // Match score contribution (0-7 possible)
  confidence += Math.min(matchScore * 0.08, 0.56);

  // Intake completeness bonus
  if (intake.area) confidence += 0.05;
  if (intake.finishLevel) confidence += 0.03;
  if (intake.condition) confidence += 0.03;
  if (intake.channel) confidence += 0.02;

  return Math.min(confidence, MAX_CONFIDENCE);
}

/**
 * Compute overall draft confidence score.
 */
function computeDraftConfidence(
  items: ScopeItem[],
  intake: ScopeIntakeData,
  matchedRuleCount: number
): number {
  if (items.length === 0) return MIN_CONFIDENCE;

  // Average item confidence
  const avgItemConfidence = items.reduce((sum, i) => sum + i.confidence, 0) / items.length;

  // Rule coverage bonus
  const coverageBonus = Math.min(matchedRuleCount * 0.02, 0.10);

  // Intake completeness bonus
  let completenessBonus = 0;
  if (intake.serviceType) completenessBonus += 0.03;
  if (intake.area) completenessBonus += 0.03;
  if (intake.finishLevel) completenessBonus += 0.02;
  if (intake.condition) completenessBonus += 0.02;

  const total = avgItemConfidence + coverageBonus + completenessBonus;
  return Math.min(Math.round(total * 100) / 100, MAX_CONFIDENCE);
}

// ══════════════════════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Validate intake data for scope generation.
 * Returns warnings for missing or incomplete data.
 */
export function validateIntakeForScope(intake: ScopeIntakeData): string[] {
  const warnings: string[] = [];

  if (!intake.serviceType) {
    warnings.push("Intake is missing service_type. Scope generation cannot proceed without a service type.");
  }

  if (!intake.area) {
    warnings.push("Intake is missing area/dimensions. Using default area for quantity calculations.");
  }

  if (!intake.finishLevel) {
    warnings.push("Intake is missing finish_level. Defaulting to 'standard' for assembly selection.");
  }

  if (!intake.condition) {
    warnings.push("Intake is missing condition assessment. Some condition-specific rules may not match.");
  }

  return warnings;
}

// ══════════════════════════════════════════════════════════════════════
// REASON TEMPLATE INTERPOLATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Interpolate a reason template with intake/project values.
 *
 * Supported placeholders:
 *   {{service_type}}, {{finish_level}}, {{condition}},
 *   {{zone}}, {{channel}}, {{area}}
 */
function interpolateReasonTemplate(
  template: string,
  intake: ScopeIntakeData,
  project: ScopeProjectContext
): string {
  const serviceType = normalizeServiceType(intake.serviceType) ?? intake.serviceType;
  const finishLevel = normalizeFinishLevel(intake.finishLevel) ?? "standard";
  const condition = normalizeCondition(intake.condition) ?? intake.condition ?? "unknown";
  const zone = project.zone ?? project.zoneModifierSnapshot?.zoneName ?? "unknown";
  const channel = normalizeChannel(intake.channel ?? project.channel) ?? "direct";
  const area = intake.area ?? "unspecified";

  return template
    .replace(/\{\{service_type\}\}/g, serviceType ?? "unknown")
    .replace(/\{\{finish_level\}\}/g, finishLevel)
    .replace(/\{\{condition\}\}/g, condition)
    .replace(/\{\{zone\}\}/g, zone)
    .replace(/\{\{channel\}\}/g, channel)
    .replace(/\{\{area\}\}/g, area);
}
