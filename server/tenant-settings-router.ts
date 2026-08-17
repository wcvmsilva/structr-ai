/**
 * structr.ai — PHASE 4 Tenant Settings tRPC Router
 *
 * Procedures:
 *   - tenantSettings.get               (protected)        → settings of the caller's tenant
 *   - tenantSettings.update            (protected, admin) → commercial/brand/threshold config
 *   - tenantSettings.getFeatureFlags   (protected)        → effective flags
 *   - tenantSettings.setFeatureFlags   (protected, admin) → replace the flag set (MT-001)
 *   - tenantSettings.disableFeature    (protected, admin) → disable one module
 *   - tenantSettings.getEffectiveFloor (protected)        → margin floor in force
 *   - tenantSettings.getOnboarding     (protected)        → onboarding progress (MT-002)
 *   - tenantSettings.completeStep      (protected, admin) → complete an onboarding step
 *   - tenantSettings.provision         (admin)            → provision a new tenant
 *   - tenantSettings.coverageAudit     (admin)            → MT-004 tenant isolation audit
 *
 * Every procedure reads the tenant from `ctx.tenantId`. There is no procedure that accepts a
 * tenant id from the client, with the single exception of `provision`, which creates one.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  completeOnboarding,
  disableFeatureFlag,
  getEffectiveFeatureFlags,
  getEffectiveFloor,
  getOnboardingProgress,
  getOrCreateTenantSettings,
  provisionTenant,
  setFeatureFlags,
  TenantSettingsError,
  updateTenantSettings,
} from "./tenant-settings-db";
import { runTenantCoverageAudit } from "./tenant-coverage-audit";
import {
  TENANT_FEATURE_FLAGS,
  TENANT_ONBOARDING_STEPS,
} from "@shared/domain/phase4-taxonomy";
import { COMMERCIAL_CHANNELS } from "@shared/domain/phase2-taxonomy";
import type { GeoRiskClass } from "@shared/constants/profit-shield";

/**
 * Geo risk classes accepted on the wire.
 * `profit-shield.ts` exposes the type and the floor map but no runtime tuple, so the enum is
 * declared here and kept in sync by the type assertion below.
 */
const GEO_RISK_CLASSES = ["inland", "coastal", "barrier_island"] as const;

// Fails to compile in either direction if the tuple and the type drift apart.
const _geoRiskClassExhaustive: readonly GeoRiskClass[] = GEO_RISK_CLASSES;
void _geoRiskClassExhaustive;

type _GeoRiskClassCheck =
  Exclude<GeoRiskClass, (typeof GEO_RISK_CLASSES)[number]> extends never ? true : never;
const _geoRiskClassCheck: _GeoRiskClassCheck = true;
void _geoRiskClassCheck;

function requireTenant(tenantId: string | null | undefined): string {
  if (!tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant in session.",
    });
  }
  return tenantId;
}

function toTrpcError(err: unknown): never {
  if (err instanceof TenantSettingsError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      TENANT_NOT_FOUND: "NOT_FOUND",
      SETTINGS_NOT_FOUND: "NOT_FOUND",
      SETTINGS_ALREADY_EXIST: "CONFLICT",
      MANDATORY_FLAG_REMOVED: "FORBIDDEN",
      FLAG_DEPENDENCY_VIOLATION: "CONFLICT",
      UNKNOWN_FEATURE_FLAG: "BAD_REQUEST",
      INVALID_OVERRIDE: "BAD_REQUEST",
      ONBOARDING_BLOCKED: "PRECONDITION_FAILED",
      AUTO_APPLY_FORBIDDEN: "FORBIDDEN",
      INVALID_ONBOARDING_STEP: "BAD_REQUEST",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

/** Percent overrides keyed by channel or geo risk class. */
const overrideMap = z.record(z.string(), z.number().min(0).max(100));

export const tenantSettingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getOrCreateTenantSettings({
        tenantId: requireTenant(ctx.tenantId),
        actorId: ctx.user.id,
      });
    } catch (err) {
      return toTrpcError(err);
    }
  }),

  update: adminProcedure
    .input(
      z.object({
        defaultCommercialChannel: z.enum(COMMERCIAL_CHANNELS).nullish(),
        geoRegion: z.string().max(100).nullish(),
        defaultGeoRiskClass: z.enum(GEO_RISK_CLASSES).nullish(),
        timezone: z.string().max(64).nullish(),
        currency: z.string().length(3).nullish(),
        locale: z.string().max(10).nullish(),
        supportedLocales: z.array(z.string().max(10)).max(20).nullish(),
        /** Channel → floor percent. Composes upward only (MT-001). */
        profitShieldOverrides: overrideMap.nullish(),
        /** Geo risk class → floor percent. */
        geoFloorOverrides: overrideMap.nullish(),
        varianceThresholdPct: z.number().min(0).max(100).nullish(),
        biasTolerancePct: z.number().min(0).max(100).nullish(),
        maxAdjustmentPct: z.number().min(0).max(100).nullish(),
        brandName: z.string().max(200).nullish(),
        brandLegalName: z.string().max(200).nullish(),
        brandLogoUrl: z.string().url().max(500).nullish(),
        brandPrimaryColor: z.string().max(20).nullish(),
        brandSecondaryColor: z.string().max(20).nullish(),
        brandEmailSignature: z.string().max(2000).nullish(),
        brandLicenseNumber: z.string().max(100).nullish(),
        brandContactPhone: z.string().max(50).nullish(),
        brandContactEmail: z.string().email().max(200).nullish(),
        brandAddress: z.string().max(500).nullish(),
        proposalFooterText: z.string().max(2000).nullish(),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await updateTenantSettings({
          tenantId: requireTenant(ctx.tenantId),
          actorId: ctx.user.id,
          ...input,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  getFeatureFlags: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = requireTenant(ctx.tenantId);
    return { flags: await getEffectiveFeatureFlags(tenantId) };
  }),

  /** Replace the flag set. Mandatory flags and dependencies are re-added automatically. */
  setFeatureFlags: adminProcedure
    .input(
      z.object({
        flags: z.array(z.enum(TENANT_FEATURE_FLAGS)).max(TENANT_FEATURE_FLAGS.length),
        reason: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await setFeatureFlags({
          tenantId: requireTenant(ctx.tenantId),
          flags: input.flags,
          actorId: ctx.user.id,
          reason: input.reason ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  disableFeature: adminProcedure
    .input(
      z.object({
        flag: z.enum(TENANT_FEATURE_FLAGS),
        reason: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await disableFeatureFlag({
          tenantId: requireTenant(ctx.tenantId),
          flag: input.flag,
          actorId: ctx.user.id,
          reason: input.reason ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * The margin floor actually in force for a channel and geo risk class.
   * Estimating screens should show this number, not a hardcoded constant.
   */
  getEffectiveFloor: protectedProcedure
    .input(
      z.object({
        channel: z.enum(COMMERCIAL_CHANNELS),
        geoRiskClass: z.enum(GEO_RISK_CLASSES).nullish(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getEffectiveFloor({
        tenantId: requireTenant(ctx.tenantId),
        channel: input.channel,
        geoRiskClass: input.geoRiskClass ?? null,
      });
    }),

  getOnboarding: protectedProcedure.query(async ({ ctx }) => {
    return getOnboardingProgress(requireTenant(ctx.tenantId));
  }),

  completeStep: adminProcedure
    .input(
      z.object({
        step: z.enum(TENANT_ONBOARDING_STEPS),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await completeOnboarding({
          tenantId: requireTenant(ctx.tenantId),
          step: input.step,
          actorId: ctx.user.id,
          notes: input.notes ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Provision a new tenant.
   *
   * Only `tenant_created` is completed; the price book, geo config and margin floors must be
   * set by someone who knows that company. A tenant that looks configured but is not produces
   * confident wrong estimates.
   */
  provision: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(200),
        slug: z
          .string()
          .min(2)
          .max(60)
          .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, digits and hyphens."),
        legalName: z.string().max(200).nullish(),
        geoRegion: z.string().max(100).nullish(),
        defaultGeoRiskClass: z.enum(GEO_RISK_CLASSES).nullish(),
        defaultCommercialChannel: z.enum(COMMERCIAL_CHANNELS).nullish(),
        requestedFlags: z.array(z.enum(TENANT_FEATURE_FLAGS)).nullish(),
        isDemo: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await provisionTenant({
          name: input.name,
          slug: input.slug,
          legalName: input.legalName ?? null,
          geoRegion: input.geoRegion ?? null,
          defaultGeoRiskClass: input.defaultGeoRiskClass ?? null,
          defaultCommercialChannel: input.defaultCommercialChannel ?? null,
          requestedFlags: input.requestedFlags ?? null,
          isDemo: input.isDemo,
          actorId: ctx.user.id,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * MT-004: static audit of tenant isolation across the codebase.
   *
   * Exposed as a procedure so the check is available in a running environment, not only in CI.
   * It reads source files, so it is admin-only.
   */
  coverageAudit: adminProcedure.query(async () => {
    return runTenantCoverageAudit();
  }),
});
