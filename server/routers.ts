import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { pricingRouter } from "./pricing-router";
import { assemblyRouter } from "./assembly-router";
import { estimateRouter } from "./estimate-router";
import { clientRouter } from "./client-router";
import { projectRouter } from "./project-router";
import { intakeRouter } from "./intake-router";
import { previsitRouter } from "./previsit-router";
import { geoRouter } from "./geo-router";
import { scopeRouter } from "./scope-router";
import { remodelRouter } from "./remodel-router";
import { scopeReviewRouter } from "./scope-review-router";
import { scopeGenerationRouter } from "./scope-generation-router";
import { geoOverrideRouter } from "./geo-override-router";
import { workflowVisualizationRouter } from "./workflow-visualization-router";
import { issueReportRouter } from "./issue-report-router";
import { fieldLaunchRouter } from "./field-launch-router";
import { learningLayerRouter } from "./learning-layer-router";
import { authRouter } from "./auth-router";
import { catalogRouter } from "./catalog-router";
import { bundleRouter } from "./bundle-router";
import { presetRouter } from "./preset-router";
import { estimateLegacyRouter } from "./estimate-legacy-router";
import { rbacRouter } from "./rbac-router";
import { auditRouter } from "./audit-router";
import { leadRouter } from "./lead-router";
import { dealRouter } from "./deal-router";
import { pipelineRouter } from "./pipeline-router";
import { drawingRouter } from "./drawing-router";
import { scopeSourceRouter } from "./scope-source-router";
import { rfiRouter } from "./rfi-router";
// PHASE 3 — field execution, real cost, subcontractors, daily logs, closeout
import { fieldOperationsRouter } from "./field-operations-router";
import { actualsRouter } from "./actuals-router";
import { subcontractorsRouter } from "./subcontractors-router";
import { dailyLogsRouter } from "./daily-logs-router";
import { closeoutRouter } from "./closeout-router";
// PHASE 4 — controlled learning and replicable product
import { calibrationRouter } from "./calibration-router";
import { priceAdjustmentRouter } from "./price-adjustment-router";
import { scopeCompletenessRouter } from "./scope-completeness-router";
import { tenantSettingsRouter } from "./tenant-settings-router";
import { analyticsRouter } from "./analytics-router";
import { auditTrailRouter } from "./audit-trail-router";

export const appRouter = router({
  geo: geoRouter,
  geoOverride: geoOverrideRouter,
  scope: scopeRouter,
  scopeReview: scopeReviewRouter,
  scopeGeneration: scopeGenerationRouter,
  remodel: remodelRouter,
  workflowViz: workflowVisualizationRouter,
  system: systemRouter,

  // ══════════════════════════════════════════════════════════
  // CLIENT DOMAIN (Sprint 10 — Operational Pre-Estimate)
  // ══════════════════════════════════════════════════════════
  clients: clientRouter,
  leads: leadRouter,

  // ══════════════════════════════════════════════════════════
  // PROJECT DOMAIN (Sprint 10 — Operational Pre-Estimate)
  // ══════════════════════════════════════════════════════════
  project: projectRouter,

  // ══════════════════════════════════════════════════════════
  // INTAKE FORMS (Sprint 10 — Operational Pre-Estimate)
  // ══════════════════════════════════════════════════════════
  intake: intakeRouter,

  // ══════════════════════════════════════════════════════════
  // PRE-VISIT (Phase 2 — briefing, evidence, field checklist)
  // ══════════════════════════════════════════════════════════
  previsit: previsitRouter,

  // ══════════════════════════════════════════════════════════
  // PRICING ENGINE (Sprint 6 — Master Pricing Architecture)
  // ══════════════════════════════════════════════════════════
  pricing: pricingRouter,

  // ══════════════════════════════════════════════════════════
  // ASSEMBLY LIBRARY (Sprint 7 — Remodel Scope)
  // ══════════════════════════════════════════════════════════
  assembly: assemblyRouter,

  // ══════════════════════════════════════════════════════════
  // ESTIMATE DRAFTS (Sprint 9 — Real Flow)
  // ══════════════════════════════════════════════════════════
  estimate: estimateRouter,

  // ══════════════════════════════════════════════════════════
  // ISSUE REPORTS (Sprint 20 — Field Launch Toolkit)
  // ══════════════════════════════════════════════════════════
  issueReport: issueReportRouter,

  // ══════════════════════════════════════════════════════════
  // FIELD LAUNCH CONTROL (Sprint 21)
  // ══════════════════════════════════════════════════════════
  fieldLaunch: fieldLaunchRouter,

  // ══════════════════════════════════════════════════════════
  // LEARNING LAYER (Sprint 22 — Analytics Pipeline)
  // ══════════════════════════════════════════════════════════
  learning: learningLayerRouter,

  auth: authRouter,
  catalog: catalogRouter,
  bundle: bundleRouter,
  preset: presetRouter,
  estimateLegacy: estimateLegacyRouter,
  rbac: rbacRouter,
  audit: auditRouter,
  deal: dealRouter,
  pipeline: pipelineRouter,

  // ══════════════════════════════════════════════════════════
  // DRAWING INTAKE LAYER — TakeOff V1
  // ══════════════════════════════════════════════════════════
  drawing: drawingRouter,
  scopeSource: scopeSourceRouter,
  rfi: rfiRouter,

  // ══════════════════════════════════════════════════════════
  // PHASE 3 — FIELD EXECUTION AND REAL COST
  // docs/phase3-contract.md
  // ══════════════════════════════════════════════════════════
  fieldOperations: fieldOperationsRouter,
  actuals: actualsRouter,
  subcontractors: subcontractorsRouter,
  dailyLogs: dailyLogsRouter,
  closeout: closeoutRouter,

  // ══════════════════════════════════════════════════════════
  // PHASE 4 — CONTROLLED LEARNING AND REPLICABLE PRODUCT
  // docs/phase4-contract.md
  //
  // `calibration` and `priceAdjustment` supersede the Sprint 22 `learning` namespace above,
  // which stays mounted for backward compatibility. New work targets these.
  // ══════════════════════════════════════════════════════════
  calibration: calibrationRouter,
  priceAdjustment: priceAdjustmentRouter,
  scopeCompleteness: scopeCompletenessRouter,
  tenantSettings: tenantSettingsRouter,
  analytics: analyticsRouter,
  auditTrail: auditTrailRouter,
});

export type AppRouter = typeof appRouter;
