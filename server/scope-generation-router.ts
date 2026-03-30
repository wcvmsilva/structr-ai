/**
 * structr.ai — Scope Generation Workspace Router
 * Sprint 15.5: Scope Generation Workspace
 *
 * Dedicated router for the operator workspace that orchestrates:
 *   1. loadWorkspace        — load project + intake + existing drafts + geo context in one call
 *   2. checkReadiness       — validate whether scope generation can proceed
 *   3. generateScope        — trigger deterministic scope generation (delegates to scope.generate)
 *   4. sendToReview         — idempotent handoff: draft → under_review (or informational if already in review)
 *
 * NON-NEGOTIABLE:
 *   - Does NOT duplicate Scope Builder logic
 *   - Does NOT calculate pricing
 *   - Does NOT bypass Scope Review Workspace
 *   - Does NOT allow direct conversion to Bundle
 *   - Preserves deterministic backend logic
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getProjectById } from "./project-db";
import { getIntakeFormsByProject } from "./intake-db";
import { listScopeDraftsForProject, getScopeDraftWithItems, getScopeDraftById } from "./scope-db";
import { validateIntakeForScope, type ScopeIntakeData } from "@shared/scope-engine";
import {
  validateTransition,
  type ScopeDraftStatus,
} from "@shared/scope-review-state-machine";
import { transitionDraftStatus } from "./scope-review-db";
import { logAudit } from "./audit";
import { normalizeChannel, normalizeFinishLevel, normalizeServiceType, normalizeCondition, normalizeProjectType } from "@shared/domain/normalization";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface WorkspaceReadiness {
  canGenerate: boolean;
  blockers: string[];
  warnings: string[];
}

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const scopeGenerationRouter = router({

  // ────────────────────────────────────────────────────────────────────
  // 1. LOAD WORKSPACE — single call to hydrate the entire workspace
  // ────────────────────────────────────────────────────────────────────
  loadWorkspace: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
    }))
    .query(async ({ input }) => {
      // Load project
      const project = await getProjectById(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectId} not found` });
      }

      // Load intake forms for this project
      const intakeForms = await getIntakeFormsByProject(input.projectId);

      // Load existing scope drafts for this project
      const scopeDrafts = await listScopeDraftsForProject(input.projectId);

      // Load the most recent draft with items (if any)
      let latestDraftWithItems = null;
      if (scopeDrafts.length > 0) {
        latestDraftWithItems = await getScopeDraftWithItems(scopeDrafts[0].id);
      }

      // Build readiness assessment
      const readiness = assessReadiness(project, intakeForms, scopeDrafts);

      return {
        project: {
          id: project.id,
          name: project.name,
          clientName: project.clientName,
          clientEmail: project.clientEmail,
          address: project.address,
          city: project.city,
          state: project.state,
          zipCode: project.zip,
          county: project.county,
          region: project.region,
          zone: project.zone,
          channel: project.channel,
          projectType: project.projectType,
          status: project.status,
          // Geocode fields
          latitude: null,
          longitude: null,
          geocodeConfidence: project.geocodeConfidence,
          geocodeSource: project.geocodeSource,
          geocodedAddress: project.geocodedAddress,
          geocodedAt: project.geocodedAt,
          zoneModifierSnapshot: project.zoneModifierSnapshot,
        },
        intakeForms: intakeForms.map(i => ({
          id: i.id,
          // Sprint 18.5: Normalize passthrough fields at router boundary
          serviceType: normalizeServiceType(((i.formData as any)?.serviceType)) ?? ((i.formData as any)?.serviceType),
          area: ((i.formData as any)?.area),
          finishLevel: normalizeFinishLevel(((i.formData as any)?.finishLevel)) ?? ((i.formData as any)?.finishLevel),
          condition: normalizeCondition(((i.formData as any)?.condition)) ?? ((i.formData as any)?.condition),
          channel: normalizeChannel(((i.formData as any)?.channel)) ?? ((i.formData as any)?.channel),
          notes: ((i.formData as any)?.notes),
          status: i.status,
          confidenceScore: ((i.formData as any)?.confidence),
          createdAt: i.createdAt,
        })),
        scopeDrafts: scopeDrafts.map(d => ({
          id: d.id,
          intakeFormId: d.intakeFormId,
          status: d.status,
          confidenceScore: d.confidence,
          warningsJson: d.warningsJson,
          createdAt: d.createdAt,
        })),
        latestDraft: latestDraftWithItems ? {
          draft: {
            id: latestDraftWithItems.draft.id,
            intakeFormId: latestDraftWithItems.draft.intakeFormId,
            status: latestDraftWithItems.draft.status,
            confidenceScore: latestDraftWithItems.draft.confidence,
            warningsJson: latestDraftWithItems.draft.warningsJson,
            createdAt: latestDraftWithItems.draft.createdAt,
          },
          items: latestDraftWithItems.items.map(item => ({
            id: item.id,
            assemblyId: item.assemblyId,
            quantity: item.quantity,
            unit: item.unit,
            reason: item.reason,
            confidence: item.confidence,
            sortOrder: item.sortOrder,
          })),
        } : null,
        readiness,
      };
    }),

  // ────────────────────────────────────────────────────────────────────
  // 2. CHECK READINESS — validate whether generation can proceed
  // ────────────────────────────────────────────────────────────────────
  checkReadiness: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      intakeFormId: z.string().uuid().optional(),
    }))
    .query(async ({ input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Project ${input.projectId} not found` });
      }

      const intakeForms = await getIntakeFormsByProject(input.projectId);
      const scopeDrafts = await listScopeDraftsForProject(input.projectId);

      // If specific intake specified, validate just that one
      if (input.intakeFormId) {
        const targetIntake = intakeForms.find(i => i.id === input.intakeFormId);
        if (!targetIntake) {
          return {
            canGenerate: false,
            blockers: [`Intake form #${input.intakeFormId} not found for this project`],
            warnings: [],
          };
        }

        // Sprint 18.5: Normalize passthrough fields at router boundary
        const intakeData: ScopeIntakeData = {
          serviceType: normalizeServiceType(targetIntake.serviceType) ?? targetIntake.serviceType ?? "",
          area: targetIntake.area,
          finishLevel: normalizeFinishLevel(targetIntake.finishLevel) ?? targetIntake.finishLevel,
          condition: normalizeCondition(targetIntake.condition) ?? targetIntake.condition,
          channel: normalizeChannel(targetIntake.channel) ?? targetIntake.channel,
        };

        const intakeWarnings = validateIntakeForScope(intakeData);
        const blockers: string[] = [];

        if (!targetIntake.serviceType) {
          blockers.push("Intake is missing service_type — scope generation cannot proceed.");
        }

        // Check for existing drafts for this intake
        const existingDraft = scopeDrafts.find(d => d.intakeFormId === input.intakeFormId);
        if (existingDraft) {
          return {
            canGenerate: true,
            blockers: [],
            warnings: [
              ...intakeWarnings,
              `Existing scope draft #${existingDraft.id} found (status: ${existingDraft.status}). Generating will create a new draft.`,
            ],
            existingDraftId: existingDraft.id,
            existingDraftStatus: existingDraft.status,
          };
        }

        return {
          canGenerate: blockers.length === 0,
          blockers,
          warnings: intakeWarnings,
        };
      }

      return assessReadiness(project, intakeForms, scopeDrafts);
    }),

  // ────────────────────────────────────────────────────────────────────
  // 3. SEND TO REVIEW — idempotent handoff
  // ────────────────────────────────────────────────────────────────────
  sendToReview: adminProcedure
    .input(z.object({
      scopeDraftId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const draft = await getScopeDraftById(input.scopeDraftId);
      if (!draft) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scope draft not found" });
      }

      const currentStatus = draft.status as ScopeDraftStatus;

      // Idempotent: if already in review workflow, return informational message
      if (currentStatus === "under_review") {
        return {
          id: draft.id,
          status: draft.status,
          transitioned: false,
          message: "Scope Draft is already under review.",
        };
      }

      if (currentStatus === "approved") {
        return {
          id: draft.id,
          status: draft.status,
          transitioned: false,
          message: "Scope Draft already approved. No further review needed.",
        };
      }

      if (currentStatus === "converted") {
        return {
          id: draft.id,
          status: draft.status,
          transitioned: false,
          message: "Scope Draft already converted to bundle. Review workflow complete.",
        };
      }

      if (currentStatus === "rejected") {
        return {
          id: draft.id,
          status: draft.status,
          transitioned: false,
          message: "Scope Draft was rejected. Cannot send to review.",
        };
      }

      // Only "draft" can transition to "under_review"
      const result = validateTransition(currentStatus, "under_review");
      if (!result.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error ?? "Invalid state transition",
        });
      }

      const updated = await transitionDraftStatus(input.scopeDraftId, "under_review", ctx.user.id);
      if (!updated) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to transition draft" });
      }

      // Audit: scope sent to review
      await logAudit({
        userId: ctx.user.id,
        action: "scope_sent_to_review",
        tableName: "scope_drafts",
        recordId: input.scopeDraftId,
        before: { status: "draft" },
        after: { status: "under_review" },
      }).catch((err) => console.error("[Audit] write failed:", err.message));

      return {
        id: updated.id,
        status: updated.status,
        transitioned: true,
        message: "Scope Draft sent to Review Workspace. Status: under_review.",
      };
    }),
});

// ══════════════════════════════════════════════════════════════════════
// READINESS ASSESSMENT (pure function)
// ══════════════════════════════════════════════════════════════════════

function assessReadiness(
  project: any,
  intakeForms: any[],
  scopeDrafts: any[]
): WorkspaceReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Check intake forms
  if (intakeForms.length === 0) {
    blockers.push("No intake forms linked to this project. Create an intake first.");
  } else {
    // Check if any intake has service_type
    const hasServiceType = intakeForms.some(i => ((i.formData as any)?.serviceType));
    if (!hasServiceType) {
      blockers.push("No intake form has a service_type. At least one is required for scope generation.");
    }

    // Check for missing area on all intakes
    const allMissingArea = intakeForms.every(i => !((i.formData as any)?.area));
    if (allMissingArea) {
      warnings.push("All intake forms are missing area/dimensions. Default area will be used for quantity calculations.");
    }
  }

  // Check geocode status
  if (!project.geocodeConfidence || project.geocodeConfidence === "failed") {
    warnings.push("Geocoding is unavailable or failed. Zone-specific rules may not match.");
  }

  if (!project.zone) {
    warnings.push("No zone assigned to project. Zone-specific assembly selection will be skipped.");
  }

  // Check for existing drafts
  if (scopeDrafts.length > 0) {
    const latest = scopeDrafts[0]; // Already sorted desc by createdAt
    warnings.push(
      `Existing scope draft found (ID: ${latest.id}, status: ${latest.status}). ` +
      `You can view it or generate a new one.`
    );
  }

  return {
    canGenerate: blockers.length === 0,
    blockers,
    warnings,
  };
}
