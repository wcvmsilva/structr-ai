import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { validateQuantity, transformBundleToEstimateDraft } from "@shared/catalog-utils";
import {
  getCatalogItems,
  getCatalogGroups,
  getCatalogItemById,
  getCatalogStats,
  createBundle,
  getBundleById,
  listBundles,
  updateBundleMeta,
  addItemToBundle,
  updateBundleItemQuantity,
  removeBundleItem,
  duplicateBundle,
  deleteBundle,
  recalculateBundleTotals,
  createPresetFromBundle,
  createBundleFromPreset,
  markBundleAsPreset,
  unmarkBundleAsPreset,
  createEstimateDraft,
  getEstimateDraftById,
  listEstimateDrafts,
} from "./db";
import { TRPCError } from "@trpc/server";
import { logAudit, listAuditLogs, getAuditLogById, withAuditLog } from "./audit";
import {
  getUserPermissions,
  hasPermission,
  listRoles,
  listPermissions,
  getRoleWithPermissions,
  assignRoleToUser,
  clearPermissionCache,
} from "./rbac";
import { pricingRouter } from "./pricing-router";
import { assemblyRouter } from "./assembly-router";
import { estimateRouter } from "./estimate-router";
import { clientRouter } from "./client-router";
import { projectRouter } from "./project-router";
import { intakeRouter } from "./intake-router";
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
});

export type AppRouter = typeof appRouter;
