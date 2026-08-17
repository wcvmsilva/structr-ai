/**
 * structr.ai — Scope → Estimate Pipeline
 * Sprint 18: Pricing Integrity Hardening (Phase 5)
 *
 * Automated conversion from an approved scope draft to a priced estimate draft.
 *
 * Pipeline steps:
 *   1. Load scope draft + validate status (must be "approved" or "converted")
 *   2. Load effective items (with review deltas applied)
 *   3. Load project context (channel)
 *   4. Fetch assemblies with components from DB
 *   5. Resolve pricing dimensions from DB (channel, finish, regional multipliers)
 *   6. Run calculateMultipleAssemblies (assembly-engine)
 *   7. Validate via estimate-engine
 *   8. Transform to EstimateDraftPersistPayload
 *   9. Persist with source="scope_draft" + context snapshot in draftData jsonb
 *  10. Audit log the conversion
 *
 * Idempotency: If an estimate draft already exists for this scope draft,
 * returns the existing draft instead of creating a duplicate.
 *
 * No new business logic — orchestrates existing modules only.
 */

// TRPCError removed — Sprint 19 uses typed PipelineError instead.
// The estimate-router.ts catches PipelineError and re-throws as TRPCError for transport.
import { eq, and } from "drizzle-orm";
import { getDb } from "./db";
import { estimateDrafts, type EstimateDraft } from "../drizzle/schema";
import { getScopeDraftById } from "./scope-db";
import { getEffectiveItems } from "./scope-review-db";
import { getProjectById } from "./project-db";
import { getAssemblyById } from "./assembly-db";
import {
  calculateMultipleAssemblies,
  type AssemblyComponentInput,
} from "@shared/assembly-engine";
import {
  validateEstimateDraftInputs,
  transformBatchToEstimateDraft,
  type AssemblyMetadata,
  type EstimateDraftContext,
} from "@shared/estimate-engine";
import { createEstimateDraft } from "./db";
import { resolvePricingDimensions, toPricingEngineDimensions } from "./pricing-dimensions";
import { normalizeChannel, normalizeFinishLevel } from "@shared/domain/normalization";
import { logAudit } from "./audit";
import { getOverrideLogForDraft } from "./geo-override-db";
import { WORKFLOW_STEP_CODES } from "@shared/remodel-engine";
// PHASE 2: channel margin floors, geo context propagation, pre-visit gate
import {
  evaluateProfitShield,
  type ProfitShieldEvaluation,
} from "@shared/profit-shield-engine";
import {
  PRICING_TO_COMMERCIAL_CHANNEL,
  PREVISIT_STEPS_ALLOWING_ESTIMATE,
} from "@shared/domain/phase2-taxonomy";
import { getProjectGeoContext } from "./lead-conversion";
import { getLatestBriefForProject } from "./previsit-db";

// ══════════════════════════════════════════════════════════════════════
// ERRORS (Sprint 19: Typed pipeline errors)
// ══════════════════════════════════════════════════════════════════════

export type PipelineErrorCode =
  | "SCOPE_DRAFT_NOT_FOUND"
  | "SCOPE_DRAFT_INVALID_STATUS"
  | "NO_EFFECTIVE_ITEMS"
  | "ASSEMBLIES_NOT_FOUND"
  | "NO_ACTIVE_ASSEMBLIES"
  | "ESTIMATE_VALIDATION_FAILED"
  | "PERSIST_FAILED"
  // PHASE 2
  | "PROFIT_SHIELD_VIOLATION"
  | "PREVISIT_BLOCKS_ESTIMATE";

export class PipelineError extends Error {
  public readonly code: PipelineErrorCode;
  public readonly step: string;
  public readonly details: Record<string, unknown>;

  constructor(code: PipelineErrorCode, step: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.step = step;
    this.details = details;
  }
}

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface ScopeToEstimateInput {
  scopeDraftId: string;
  /** Override channel from project if needed */
  channelOverride?: "direct" | "insurance" | "commercial" | null;
  /** Override finish level from project if needed */
  finishLevelOverride?: "standard" | "premium" | "luxury" | null;
  /** Override region from project if needed */
  regionOverride?: string | null;
  /** Custom name for the estimate draft */
  draftName?: string | null;
  /** Additional notes */
  notes?: string | null;
  /**
   * PHASE 2 — when true, a Profit Shield violation blocks creation instead of being
   * recorded as a warning on the draft. Approval always blocks regardless of this flag;
   * this only controls whether the operator may hold a non-compliant draft for rework.
   */
  blockOnProfitShield?: boolean;
  /** PHASE 2 — explicit commercial channel (premium/trade/capital). */
  commercialChannelOverride?: string | null;
}

export interface ScopeToEstimateResult {
  /** The created or existing estimate draft */
  draft: EstimateDraft;
  /** Whether this was a new creation or existing draft was returned */
  created: boolean;
  /** Validation warnings (non-blocking) */
  warnings: Array<{ field: string; message: string }>;
  /** Context snapshot — what was used to generate the estimate */
  contextSnapshot: ContextSnapshot;
  /** Batch calculation summary */
  batchSummary: {
    totalCost: number;
    totalPrice: number;
    grossProfitPct: number;
    meetsMinGP: boolean;
    assemblyCount: number;
  };
  /** PHASE 2 — channel/geo margin floor evaluation for this draft. */
  profitShield: ProfitShieldEvaluation | null;
}

export interface ContextSnapshot {
  scopeDraftId: string;
  scopeDraftStatus: string;
  projectId: string | null;
  projectName: string | null;
  channel: string;
  channelSource: "project" | "override" | "default";
  finishLevel: string;
  finishLevelSource: "project" | "override" | "default";
  region: string;
  regionSource: "project" | "override" | "default";
  effectiveItemCount: number;
  assemblyIds: string[];
  pricingDimensionsSources: Record<string, string>;
  /** Sprint 19: Actual resolved multiplier values for full traceability */
  multipliersApplied: {
    channelCostMultiplier: number;
    channelPriceMultiplier: number;
    finishPriceMultiplier: number;
    regionalCostModifier: number;
    regionalLaborModifier: number;
    regionalMaterialModifier: number;
    regionalPermitModifier: number;
  };
  /** Sprint 19: Pricing schema version used for this estimate */
  pricingSchemaVersion: string;
  generatedAt: string;
  /** PHASE 2 — commercial channel enforced by the Profit Shield. */
  commercialChannel?: string | null;
  /** PHASE 2 — geographic zone snapshot at estimate time. */
  zone?: string | null;
  /** PHASE 2 — geographic risk class derived from the zone. */
  geoRiskClass?: string | null;
  /** PHASE 2 — geo warning codes carried from the project geo context. */
  geoWarningCodes?: string[];
  /** PHASE 2 — pre-visit brief that authorized this pricing work. */
  previsitBriefId?: string | null;
}

// ══════════════════════════════════════════════════════════════════════
// PIPELINE
// ══════════════════════════════════════════════════════════════════════

/**
 * Execute the Scope → Estimate pipeline.
 *
 * Converts an approved scope draft into a priced estimate draft
 * using the full pricing stack (DB-driven multipliers, assembly-engine,
 * estimate-engine).
 *
 * @throws PipelineError with typed code for each failure mode
 * @throws TRPCError wrapping PipelineError for tRPC transport
 */
export async function executeScopeToEstimatePipeline(
  input: ScopeToEstimateInput,
  userId: string
): Promise<ScopeToEstimateResult> {
  // ── Step 1: Load scope draft ──────────────────────────────────────────
  const scopeDraft = await getScopeDraftById(input.scopeDraftId);
  if (!scopeDraft) {
    throw new PipelineError(
      "SCOPE_DRAFT_NOT_FOUND",
      "load_scope_draft",
      `Scope draft ${input.scopeDraftId} not found`,
      { scopeDraftId: input.scopeDraftId }
    );
  }

  // Must be approved or converted (converted = already went through review)
  const validStatuses = ["approved", "converted"];
  if (!validStatuses.includes(scopeDraft.status)) {
    throw new PipelineError(
      "SCOPE_DRAFT_INVALID_STATUS",
      "validate_status",
      `Scope draft status is "${scopeDraft.status}" — must be "approved" or "converted" to generate an estimate. Current pipeline: intake → scope → review → approve → estimate.`,
      { scopeDraftId: input.scopeDraftId, currentStatus: scopeDraft.status, validStatuses }
    );
  }

  // ── Step 1b: Idempotency check ────────────────────────────────────
  const existingDraft = await findExistingEstimateForScope(input.scopeDraftId);
  if (existingDraft) {
    // Return existing draft — don't create a duplicate
    // Extract data from draftData jsonb
    const draftData = existingDraft.draftData as any || {};
    const channel = draftData.channel ?? "direct";
    const finishLevel = draftData.finishLevel ?? "standard";
    const region = draftData.region ?? "charleston";
    const pricingSchemaVersion = draftData.pricingSchemaVersion ?? "1.0";
    const contextSnapshot = draftData.contextSnapshot as ContextSnapshot | undefined;

    const snapshot = buildContextSnapshot(
      input.scopeDraftId,
      scopeDraft.status,
      scopeDraft.projectId,
      null, // project name not needed for existing
      channel,
      "existing",
      finishLevel,
      "existing",
      region,
      "existing",
      [],
      [],
      {},
      // Sprint 19: Existing draft — multipliers not re-resolved, use identity
      {
        channelCostMultiplier: 1.0,
        channelPriceMultiplier: 1.0,
        finishPriceMultiplier: 1.0,
        regionalCostModifier: 1.0,
        regionalLaborModifier: 1.0,
        regionalMaterialModifier: 1.0,
        regionalPermitModifier: 1.0,
      },
      pricingSchemaVersion
    );

    // Sprint 19: Audit the idempotent return
    try {
      await logAudit({
        userId,
        action: "estimate_pipeline_idempotent_return",
        tableName: "estimate_drafts",
        recordId: existingDraft.id,
        before: null,
        after: {
          scopeDraftId: input.scopeDraftId,
          existingEstimateDraftId: existingDraft.id,
          pricingSchemaVersion,
          reason: "Estimate draft already exists for this scope draft — returning existing.",
        },
      });
    } catch {
      // Audit failure is non-blocking
    }

    return {
      draft: existingDraft,
      created: false,
      warnings: [],
      contextSnapshot: snapshot,
      batchSummary: {
        totalCost: draftData.totalCost ?? 0,
        totalPrice: draftData.totalPrice ?? 0,
        grossProfitPct: draftData.grossProfitPct ?? 0,
        meetsMinGP: draftData.profitShieldPassed ?? false,
        assemblyCount: draftData.assemblyCount ?? 0,
      },
      profitShield: ((existingDraft as Record<string, unknown>).profitShieldEvaluation ??
        draftData.profitShieldEvaluation ??
        null) as ProfitShieldEvaluation | null,
    };
  }

  // ── Step 2: Load effective items ──────────────────────────────────
  const effectiveItems = await getEffectiveItems(input.scopeDraftId);
  if (effectiveItems.length === 0) {
    throw new PipelineError(
      "NO_EFFECTIVE_ITEMS",
      "load_effective_items",
      `Scope draft ${input.scopeDraftId} has no effective items after review deltas`,
      { scopeDraftId: input.scopeDraftId }
    );
  }

  // ── Step 3: Load project context ──────────────────────────────────
  let project: Awaited<ReturnType<typeof getProjectById>> = null;
  if (scopeDraft.projectId) {
    project = await getProjectById(scopeDraft.projectId);
  }

  // ── Step 3b (PHASE 2): pre-visit gate ─────────────────────────────
  // A pre-visit whose single recommendation is verification work (survey, structural
  // evaluation, design) does not authorize a priced estimate. When no brief exists the
  // pipeline proceeds — pre-visit is not retroactively mandatory for legacy projects —
  // but the absence is recorded on the draft as a warning.
  let previsitBriefId: string | null = null;
  let previsitWarning: string | null = null;

  if (scopeDraft.projectId) {
    const brief = await getLatestBriefForProject(scopeDraft.projectId).catch(() => null);
    if (brief) {
      previsitBriefId = brief.brief.id;
      if (!(PREVISIT_STEPS_ALLOWING_ESTIMATE as readonly string[]).includes(brief.brief.nextStep)) {
        throw new PipelineError(
          "PREVISIT_BLOCKS_ESTIMATE",
          "validate_previsit",
          `Pre-visit recommendation is "${brief.brief.nextStep}", which requires verification work before pricing. Resolve that step and issue a new pre-visit brief before generating an estimate.`,
          {
            scopeDraftId: input.scopeDraftId,
            briefId: brief.brief.id,
            nextStep: brief.brief.nextStep,
            allowed: PREVISIT_STEPS_ALLOWING_ESTIMATE,
          },
        );
      }
      if (brief.brief.status !== "completed") {
        previsitWarning = `Pre-visit brief ${brief.brief.id} is "${brief.brief.status}" rather than completed — estimate is based on an unfinished pre-visit.`;
      }
    } else {
      previsitWarning =
        "No pre-visit brief exists for this project — estimate was generated without a classified field briefing.";
    }
  }

  // Resolve channel, finishLevel, region with priority: override > project > default
  const channel = resolveWithSource(
    input.channelOverride,
    project?.channel,
    "direct"
  );
  const finishLevel = resolveWithSource(
    input.finishLevelOverride,
    null, // project.finishLevel doesn't exist in schema
    "standard"
  );
  const region = resolveWithSource(
    input.regionOverride,
    null, // project.region doesn't exist in schema
    "charleston"
  );

  // Normalize at pipeline boundary
  const normalizedChannel = (normalizeChannel(channel.value) ?? channel.value) as "direct" | "insurance" | "commercial";
  const normalizedFinish = (normalizeFinishLevel(finishLevel.value) ?? finishLevel.value) as "standard" | "premium" | "luxury";

  // ── Step 4: Fetch assemblies with components ──────────────────────
  const assemblyDataList: Array<{
    assembly: NonNullable<Awaited<ReturnType<typeof getAssemblyById>>>;
    quantity: number;
    scopeItemReason: string | null;
  }> = [];

  const missingAssemblies: string[] = [];
  const inactiveAssemblies: string[] = [];

  for (const item of effectiveItems) {
    const assembly = await getAssemblyById(item.assemblyId ?? "");
    if (!assembly) {
      missingAssemblies.push(item.assemblyId ?? "");
      continue;
    }
    if (!assembly.isActive) {
      inactiveAssemblies.push(`${assembly.name} (ID: ${assembly.id})`);
      continue;
    }
    assemblyDataList.push({
      assembly,
      quantity: Number(item.quantity) || 1,
      scopeItemReason: item.reason,
    });
  }

  if (missingAssemblies.length > 0) {
    throw new PipelineError(
      "ASSEMBLIES_NOT_FOUND",
      "fetch_assemblies",
      `Assemblies not found in database: ${missingAssemblies.join(", ")}. The scope draft references assemblies that may have been deleted.`,
      { scopeDraftId: input.scopeDraftId, missingAssemblyIds: missingAssemblies }
    );
  }

  if (assemblyDataList.length === 0) {
    throw new PipelineError(
      "NO_ACTIVE_ASSEMBLIES",
      "fetch_assemblies",
      `No active assemblies found for scope draft ${input.scopeDraftId}. ${inactiveAssemblies.length} assemblies are inactive: ${inactiveAssemblies.join(", ")}`,
      { scopeDraftId: input.scopeDraftId, inactiveAssemblies }
    );
  }

  // ── Step 5: Resolve pricing dimensions + build calc inputs ────────
  const calcInputs = [];
  const assemblyMetadata = new Map<string, AssemblyMetadata>();
  // Sprint 19: Capture the last resolved multipliers for the context snapshot
  // (All assemblies in a single pipeline run share the same channel/finish/region,
  //  so the last resolved is representative of the whole batch.)
  let lastResolved: import("./pricing-dimensions").ResolvedPricingDimensions | null = null;

  for (const { assembly, quantity } of assemblyDataList) {
    // Map DB components to engine input format
    const components: AssemblyComponentInput[] = (assembly.components ?? []).map((comp: any) => ({
      id: comp.id,
      componentType: comp.componentType ?? "material",
      description: comp.description,
      quantity: comp.quantity,
      unit: comp.unit,
      wasteFactorPct: comp.wasteFactor,
      unitCostOverride: comp.unitCostOverride,
      priceBookItem: comp.priceBookItem
        ? {
            id: comp.priceBookItem.id,
            name: comp.priceBookItem.name,
            unitCost: comp.priceBookItem.unitCost,
            unitPrice: comp.priceBookItem.unitPrice,
            wasteFactor: comp.priceBookItem.wasteFactor,
            coastalModifier: comp.priceBookItem.coastalModifier,
            itemType: comp.priceBookItem.itemType,
          }
        : null,
    }));

    // DB-driven multiplier resolution
    // Note: assemblies no longer have .trade or .finishLevel columns
    const resolved = await resolvePricingDimensions({
      channel: normalizedChannel,
      finishLevel: normalizedFinish,
      region: region.value,
      trade: null, // assembly.trade doesn't exist
    }, {
      userId,
      scopeDraftId: input.scopeDraftId,
      projectId: scopeDraft.projectId ?? undefined,
    });
    lastResolved = resolved;

    calcInputs.push({
      components,
      context: {
        assemblyId: assembly.id,
        assemblyName: assembly.name,
        coastalModifier: null, // assembly.coastalModifier doesn't exist
        finishLevel: normalizedFinish, // Use normalized input, not assembly field
        region: region.value, // Use resolved region, not assembly field
        dimensions: toPricingEngineDimensions(resolved),
      },
      quantity,
    });

    assemblyMetadata.set(assembly.id, {
      id: assembly.id,
      code: `ASM-${assembly.id}`, // assembly.code doesn't exist
      category: assembly.category ?? "General",
      trade: assembly.category ?? "General", // Use category instead of trade
    });
  }

  // ── Step 6: Calculate ─────────────────────────────────────────────
  const batchResult = calculateMultipleAssemblies(calcInputs);

  // ── Step 7: Validate ──────────────────────────────────────────────
  const estimateContext: EstimateDraftContext = {
    region: region.value,
    channel: normalizedChannel,
    finishLevel: normalizedFinish,
    projectId: scopeDraft.projectId,
    clientId: null, // project.clientId doesn't exist in schema
    notes: input.notes ?? `Auto-generated from Scope Draft #${input.scopeDraftId}`,
    draftName: input.draftName ?? `Estimate — Scope #${input.scopeDraftId} — ${new Date().toLocaleDateString("en-US")}`,
  };

  // ── Step 7b (PHASE 2): Profit Shield by commercial channel ────────────
  const geoContext = scopeDraft.projectId
    ? await getProjectGeoContext(scopeDraft.projectId).catch(() => null)
    : null;

  const commercialChannel =
    input.commercialChannelOverride ??
    project?.commercialChannel ??
    PRICING_TO_COMMERCIAL_CHANNEL[normalizedChannel];

  const profitShield = evaluateProfitShield(batchResult.grossProfitPct, {
    channel: commercialChannel,
    zone: project?.zone ?? geoContext?.zoneName ?? null,
    riskClass: geoContext?.riskClass ?? null,
    assemblyMargins: batchResult.assemblies.map((a) => ({
      assemblyId: a.assemblyId,
      assemblyName: a.assemblyName,
      grossProfitPct: a.grossProfitPct,
    })),
  });

  if (profitShield.blocked && input.blockOnProfitShield) {
    throw new PipelineError(
      "PROFIT_SHIELD_VIOLATION",
      "profit_shield",
      `Profit Shield blocked estimate creation: ${profitShield.violations.map((v) => v.message).join(" ")} Remediation: ${profitShield.remediation.join(" | ")}`,
      {
        scopeDraftId: input.scopeDraftId,
        channel: commercialChannel,
        effectiveFloorPct: profitShield.effectiveFloorPct,
        actualPct: profitShield.actualPct,
        violations: profitShield.violations,
      },
    );
  }

  const errors = validateEstimateDraftInputs(batchResult, estimateContext);
  const blockingErrors = errors.filter((e) => e.field !== "profitShield");
  if (blockingErrors.length > 0) {
    throw new PipelineError(
      "ESTIMATE_VALIDATION_FAILED",
      "validate_estimate",
      `Estimate validation failed: ${blockingErrors.map((e) => e.message).join("; ")}`,
      { scopeDraftId: input.scopeDraftId, errors: blockingErrors }
    );
  }

  // ── Step 8: Transform to persist payload ──────────────────────────
  const payload = transformBatchToEstimateDraft(
    batchResult,
    estimateContext,
    assemblyMetadata
  );

  // Override source to "scope_draft"
  (payload as any).source = "scope_draft";

  // ── Step 8b (Sprint 19): Enrich assemblySelections with stage, overrideFlag, sortOrder ──
  const overrideLog = await getOverrideLogForDraft(input.scopeDraftId);
  const overriddenAssemblyIds = new Set(
    overrideLog.map((e) => e.replacementAssemblyId)
  );

  if (Array.isArray(payload.assemblySelections)) {
    let sortIdx = 0;
    for (const sel of payload.assemblySelections as any[]) {
      sortIdx++;
      // Find the matching assembly data for stage info
      const asmData = assemblyDataList.find((a) => a.assembly.id === sel.assemblyId);

      // assemblies.tradeSequenceOrder doesn't exist — use simple insertion order
      const sortOrder = sortIdx;

      // Determine stage from category (best-effort mapping)
      const category = (asmData?.assembly.category ?? "").toLowerCase().replace(/\s+/g, "_");
      const matchedStage = WORKFLOW_STEP_CODES.find((code) => category.includes(code)) ?? null;

      sel.stage = matchedStage;
      sel.overrideFlag = overriddenAssemblyIds.has(sel.assemblyId);
      sel.sortOrder = sortOrder;
    }

    // Sort by sortOrder for deterministic bundle ordering
    (payload.assemblySelections as any[]).sort(
      (a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    );
  }

  // Enrich metadata with scope context snapshot
  // Sprint 19: Build multipliers snapshot from last resolved dimensions
  const multipliersApplied: ContextSnapshot["multipliersApplied"] = lastResolved
    ? {
        channelCostMultiplier: lastResolved.channelCostMultiplier,
        channelPriceMultiplier: lastResolved.channelPriceMultiplier,
        finishPriceMultiplier: lastResolved.finishPriceMultiplier,
        regionalCostModifier: lastResolved.regionalCostModifier,
        regionalLaborModifier: lastResolved.regionalLaborModifier,
        regionalMaterialModifier: lastResolved.regionalMaterialModifier,
        regionalPermitModifier: lastResolved.regionalPermitModifier,
      }
    : {
        channelCostMultiplier: 1.0,
        channelPriceMultiplier: 1.0,
        finishPriceMultiplier: 1.0,
        regionalCostModifier: 1.0,
        regionalLaborModifier: 1.0,
        regionalMaterialModifier: 1.0,
        regionalPermitModifier: 1.0,
      };

  const contextSnapshot = buildContextSnapshot(
    input.scopeDraftId,
    scopeDraft.status,
    scopeDraft.projectId,
    project?.name ?? null,
    normalizedChannel,
    channel.source,
    normalizedFinish,
    finishLevel.source,
    region.value,
    region.source,
    effectiveItems.map((i) => i.assemblyId).filter((x): x is string => x != null),
    assemblyDataList.map((a) => a.assembly.id),
    lastResolved?.sources
      ? {
          channel: lastResolved.sources.channel,
          finish: lastResolved.sources.finish,
          regional: lastResolved.sources.regional,
        }
      : {},
    multipliersApplied,
    "1.0"
  );

  // PHASE 2 — the estimate must carry the dimensions it was priced under, so a later
  // reader can tell whether the numbers still apply.
  contextSnapshot.commercialChannel = profitShield.channel ?? commercialChannel ?? null;
  contextSnapshot.zone = project?.zone ?? geoContext?.zoneName ?? null;
  contextSnapshot.geoRiskClass = profitShield.riskClass;
  contextSnapshot.geoWarningCodes = geoContext?.codes ?? [];
  contextSnapshot.previsitBriefId = previsitBriefId;

  // Store all data in draftData jsonb
  const draftData = {
    ...(payload.metadata as Record<string, unknown> ?? {}),
    pipelineSource: "scope_to_estimate",
    scopeDraftId: input.scopeDraftId,
    contextSnapshot,
    inactiveAssembliesSkipped: inactiveAssemblies,
    pricingSchemaVersion: "1.0",
    channel: normalizedChannel,
    finishLevel: normalizedFinish,
    region: region.value,
    totalCost: batchResult.totalCost,
    totalPrice: batchResult.totalPrice,
    grossProfitPct: batchResult.grossProfitPct,
    profitShieldPassed: batchResult.meetsMinGP,
    assemblyCount: batchResult.assemblies.length,
    assemblySelections: payload.assemblySelections,
    // PHASE 2 — full pricing snapshot preserved on the draft
    commercialChannel: profitShield.channel ?? commercialChannel ?? null,
    profitShieldEvaluation: profitShield,
    profitShieldFloorPct: profitShield.effectiveFloorPct,
    profitShieldBlocked: profitShield.blocked,
    zone: contextSnapshot.zone,
    geoRiskClass: profitShield.riskClass,
    geoWarningCodes: contextSnapshot.geoWarningCodes,
    previsitBriefId,
    previsitWarning,
  };

  // ── Step 9: Persist ───────────────────────────────────────────────
  const draft = await createEstimateDraft({
    projectId: scopeDraft.projectId,
    status: "draft",
    source: "scope_draft",
    draftData,
  });

  if (!draft) {
    throw new PipelineError(
      "PERSIST_FAILED",
      "persist_draft",
      "Failed to persist estimate draft",
      { scopeDraftId: input.scopeDraftId }
    );
  }

  // ── Step 10: Audit — Sprint 19 enriched ──────────────────────────
  try {
    // Primary audit: estimate_created_from_scope
    await logAudit({
      userId,
      action: "estimate_created_from_scope",
      tableName: "estimate_drafts",
      recordId: draft.id,
      before: {
        scopeDraftId: input.scopeDraftId,
        scopeDraftStatus: scopeDraft.status,
        effectiveItemCount: effectiveItems.length,
      },
      after: {
        estimateDraftId: draft.id,
        source: "scope_draft",
        pricingSchemaVersion: "1.0",
        channel: normalizedChannel,
        finishLevel: normalizedFinish,
        region: region.value,
        assemblyCount: assemblyDataList.length,
        totalCost: batchResult.totalCost,
        totalPrice: batchResult.totalPrice,
        grossProfitPct: batchResult.grossProfitPct,
        profitShieldPassed: batchResult.meetsMinGP,
        inactiveAssembliesSkipped: inactiveAssemblies.length,
        // PHASE 2: channel floor evidence
        commercialChannel: profitShield.channel ?? commercialChannel ?? null,
        profitShieldFloorPct: profitShield.effectiveFloorPct,
        profitShieldBlocked: profitShield.blocked,
        profitShieldViolations: profitShield.violations.map((v) => v.code),
        geoRiskClass: profitShield.riskClass,
        previsitBriefId,
        // Sprint 19: Full traceability
        multipliersApplied,
        bundleConsistency: {
          overriddenAssemblyCount: overriddenAssemblyIds.size,
          stagesDetected: Array.from(new Set(
            (draftData.assemblySelections as any[]).map((s: any) => s.stage).filter(Boolean)
          )),
          sortOrderApplied: true,
        },
      },
    });

    // Secondary audit: estimate_pipeline_executed (full context snapshot)
    await logAudit({
      userId,
      action: "estimate_pipeline_executed",
      tableName: "estimate_drafts",
      recordId: draft.id,
      before: null,
      after: {
        contextSnapshot,
        pipelineSteps: [
          "load_scope_draft",
          "validate_status",
          "idempotency_check",
          "load_effective_items",
          "load_project_context",
          "normalize_inputs",
          "fetch_assemblies",
          "resolve_pricing_dimensions",
          "calculate_batch",
          "validate_estimate",
          "enrich_bundle_selections",
          "persist_draft",
          "audit_log",
        ],
        executedAt: new Date().toISOString(),
      },
    });
  } catch {
    // Audit failure is non-blocking
  }

  const warnings = errors.filter((e) => e.field === "profitShield");

  // PHASE 2 — surface the channel floor result and pre-visit gap as warnings the caller
  // can display without having to inspect draftData.
  for (const violation of profitShield.violations) {
    warnings.push({ field: "profitShieldChannel", message: violation.message });
  }
  for (const shieldWarning of profitShield.warnings) {
    warnings.push({ field: "profitShieldWarning", message: shieldWarning.message });
  }
  if (previsitWarning) {
    warnings.push({ field: "previsit", message: previsitWarning });
  }
  for (const code of contextSnapshot.geoWarningCodes ?? []) {
    warnings.push({ field: "geo", message: code });
  }

  return {
    draft,
    created: true,
    warnings,
    contextSnapshot,
    batchSummary: {
      totalCost: batchResult.totalCost,
      totalPrice: batchResult.totalPrice,
      grossProfitPct: batchResult.grossProfitPct,
      meetsMinGP: batchResult.meetsMinGP,
      assemblyCount: batchResult.assemblies.length,
    },
    profitShield,
  };
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Check if an estimate draft already exists for this scope draft.
 * Searches by checking draftData jsonb for scopeDraftId.
 */
async function findExistingEstimateForScope(
  scopeDraftId: string
): Promise<EstimateDraft | null> {
  const db = await getDb();
  if (!db) return null;

  // Query all estimate drafts and filter by draftData->scopeDraftId
  // (Note: Drizzle may not support JSON operators directly in where clauses,
  //  so this may need adjustment based on db implementation)
  const allDrafts = await db
    .select()
    .from(estimateDrafts)
    .where(and(
      eq(estimateDrafts.source, "scope_draft"),
      eq(estimateDrafts.status, "draft")
    ));

  // Filter in memory for draftData.scopeDraftId
  const existing = allDrafts.find((draft) => {
    const draftData = draft.draftData as any;
    return draftData?.scopeDraftId === scopeDraftId;
  });

  return existing ?? null;
}

/**
 * Resolve a value with priority: override > project > default.
 * Returns the value and its source for the context snapshot.
 */
function resolveWithSource<T extends string>(
  override: T | null | undefined,
  projectValue: T | string | null | undefined,
  defaultValue: T
): { value: T; source: "override" | "project" | "default" } {
  if (override) return { value: override, source: "override" };
  if (projectValue) return { value: projectValue as T, source: "project" };
  return { value: defaultValue, source: "default" };
}

/**
 * Build a context snapshot for audit and traceability.
 */
function buildContextSnapshot(
  scopeDraftId: string,
  scopeDraftStatus: string,
  projectId: string | null,
  projectName: string | null,
  channel: string,
  channelSource: string,
  finishLevel: string,
  finishLevelSource: string,
  region: string,
  regionSource: string,
  effectiveItemAssemblyIds: string[],
  resolvedAssemblyIds: string[],
  pricingDimensionsSources: Record<string, string>,
  multipliersApplied: ContextSnapshot["multipliersApplied"],
  pricingSchemaVersion: string
): ContextSnapshot {
  return {
    scopeDraftId,
    scopeDraftStatus,
    projectId,
    projectName,
    channel,
    channelSource: channelSource as "project" | "override" | "default",
    finishLevel,
    finishLevelSource: finishLevelSource as "project" | "override" | "default",
    region,
    regionSource: regionSource as "project" | "override" | "default",
    effectiveItemCount: effectiveItemAssemblyIds.length,
    assemblyIds: resolvedAssemblyIds,
    pricingDimensionsSources,
    multipliersApplied,
    pricingSchemaVersion,
    generatedAt: new Date().toISOString(),
  };
}
