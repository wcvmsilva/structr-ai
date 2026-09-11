/**
 * structr.ai — PHASE 3 Subcontractor tRPC Router
 *
 * Procedures:
 *   - subcontractors.create           (tenant)    → register a trade partner
 *   - subcontractors.get              (tenant)    → record + compliance + performance
 *   - subcontractors.list             (tenant)    → tenant roster, filterable
 *   - subcontractors.update           (tenant)    → update record, recompute compliance
 *   - subcontractors.archive          (tenant)    → archive (blocked while tasks are open)
 *   - subcontractors.getCompliance    (tenant)    → compliance + assignment eligibility
 *   - subcontractors.complianceAlerts (tenant)    → documents expiring or expired
 *   - subcontractors.getPerformance   (tenant)    → derived on-time / quality / cost metrics
 *   - subcontractors.refreshPerformance (tenant)  → recompute and persist metrics
 *   - subcontractors.listTasks        (tenant)    → tasks assigned across projects
 *   - subcontractors.trades           (protected) → trade vocabulary (static, no data access)
 *
 * Authorization: subcontractors are tenant-level, not project-level, so there is no project
 * to resolve. Every route that touches a subcontractor record runs behind `tenantProcedure`
 * — an unresolved caller tenant is rejected before the handler — and is then scoped either
 * by a tenant-filtered query or, for point lookups by id, by `loadSubcontractorInTenant()`.
 * `trades` is deliberately left on `protectedProcedure`: it returns a static vocabulary
 * derived from a TypeScript enum and reads no tenant data at all.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, tenantProcedure, router } from "./_core/trpc";
import { assertSameTenant } from "./tenant-scope";
import {
  archiveSubcontractor,
  createSubcontractor,
  getSubcontractor,
  getSubcontractorCompliance,
  getSubcontractorPerformance,
  listComplianceAlerts,
  listSubcontractors,
  listTasksForSubcontractor,
  refreshSubcontractorPerformance,
  SubcontractorError,
  updateSubcontractor,
} from "./subcontractor-db";
import {
  COMPLIANCE_STATES,
  DEFAULT_COMPLIANCE_WARNING_DAYS,
  SUBCONTRACTOR_STATUSES,
} from "@shared/domain/phase3-taxonomy";
import { TRADES } from "@shared/domain/taxonomy";
import { formatCents } from "@shared/actuals-variance-engine";

// ══════════════════════════════════════════════════════════════════════
// SCHEMAS
// ══════════════════════════════════════════════════════════════════════

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be ISO format YYYY-MM-DD");

const contactSchema = {
  contactName: z.string().max(255).nullish(),
  contactEmail: z.string().email().max(255).nullish(),
  contactPhone: z.string().max(64).nullish(),
  address: z.string().max(500).nullish(),
  city: z.string().max(128).nullish(),
  state: z.string().max(32).nullish(),
  zip: z.string().max(16).nullish(),
};

const complianceSchema = {
  licenseNumber: z.string().max(128).nullish(),
  licenseExpiry: isoDate.nullish(),
  insuranceCarrier: z.string().max(255).nullish(),
  insurancePolicyNumber: z.string().max(128).nullish(),
  insuranceExpiry: isoDate.nullish(),
  insuranceCoverageCents: z.number().int().min(0).max(1_000_000_000_00).nullish(),
  workersCompExpiry: isoDate.nullish(),
  w9OnFile: z.boolean().optional(),
};

// ══════════════════════════════════════════════════════════════════════
// ERROR MAPPING
// ══════════════════════════════════════════════════════════════════════

/** Map a SubcontractorError to the tRPC code the UI can act on. */
function toTrpcError(err: unknown): never {
  if (err instanceof SubcontractorError) {
    const codeMap: Record<string, TRPCError["code"]> = {
      DB_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      SUBCONTRACTOR_NOT_FOUND: "NOT_FOUND",
      DUPLICATE_SUBCONTRACTOR: "CONFLICT",
      SUBCONTRACTOR_NOT_ELIGIBLE: "PRECONDITION_FAILED",
      INVALID_TRADE: "BAD_REQUEST",
      INVALID_STATUS: "BAD_REQUEST",
    };
    throw new TRPCError({
      code: codeMap[err.code] ?? "BAD_REQUEST",
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

/**
 * Tenant guard for a tenant-level entity.
 *
 * A subcontractor has no project to resolve, so isolation is enforced by comparing the
 * record's tenant with the caller's.
 *
 * B2 CORRECTION (Codex P1-1, second review). This function was previously a PRIVATE
 * `assertSameTenant` that shadowed the name of the shared primitive while implementing the
 * opposite semantics:
 *
 *     if (sub.tenantId && callerTenantId && sub.tenantId !== callerTenantId) throw;
 *
 * That comparison is skipped whenever either side is null, so a caller whose tenant could
 * not be resolved passed it for EVERY tenant's subcontractor — and `getSubcontractor()` is
 * an unscoped primary-key lookup returning the whole row, `license_number` included. Its
 * docstring also claimed "platform admins pass through", which the code never implemented:
 * the branch was null-tolerance, not an admin rule.
 *
 * It now delegates to the hardened `assertSameTenant()` in server/tenant-scope.ts, and is
 * renamed so it can no longer be mistaken for, or shadow, that primitive. The ROW axis is
 * unchanged: a legacy subcontractor with `tenant_id IS NULL` stays reachable to a resolved
 * caller while TENANT_STRICT is off (F15 / issue #10), exactly as before.
 *
 * A record belonging to another tenant is still reported as FORBIDDEN rather than
 * NOT_FOUND, preserving today's contract. That does disclose the id's existence; it is
 * recorded as a separate observation rather than changed here.
 */
async function loadSubcontractorInTenant(
  subcontractorId: string,
  callerTenantId: string,
) {
  const sub = await getSubcontractor(subcontractorId);
  if (!sub) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Subcontractor not found" });
  }
  if (!assertSameTenant(sub.tenantId, callerTenantId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Subcontractor belongs to another tenant",
    });
  }
  return sub;
}

// ══════════════════════════════════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════════════════════════════════

export const subcontractorsRouter = router({
  /**
   * Register a trade partner.
   * The compliance state is derived from the documents provided (SC-001) — it is never
   * accepted as an input, because a self-declared "compliant" is worth nothing in a claim.
   */
  create: tenantProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        trade: z.enum(TRADES),
        companyType: z.string().max(64).nullish(),
        ...contactSchema,
        ...complianceSchema,
        rating: z.number().min(0).max(5).nullish(),
        status: z.enum(SUBCONTRACTOR_STATUSES).optional(),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await createSubcontractor({
          userId: ctx.user.id,
          tenantId: ctx.tenantId,
          name: input.name,
          trade: input.trade,
          companyType: input.companyType ?? null,
          contactName: input.contactName ?? null,
          contactEmail: input.contactEmail ?? null,
          contactPhone: input.contactPhone ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          zip: input.zip ?? null,
          licenseNumber: input.licenseNumber ?? null,
          licenseExpiry: input.licenseExpiry ?? null,
          insuranceCarrier: input.insuranceCarrier ?? null,
          insurancePolicyNumber: input.insurancePolicyNumber ?? null,
          insuranceExpiry: input.insuranceExpiry ?? null,
          insuranceCoverageCents: input.insuranceCoverageCents ?? null,
          workersCompExpiry: input.workersCompExpiry ?? null,
          w9OnFile: input.w9OnFile,
          rating: input.rating ?? null,
          status: input.status ?? null,
          notes: input.notes ?? null,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Full view of a trade partner: record, compliance, eligibility and performance. */
  get: tenantProcedure
    .input(z.object({ subcontractorId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const sub = await loadSubcontractorInTenant(input.subcontractorId, ctx.tenantId);

      const [compliance, performance] = await Promise.all([
        getSubcontractorCompliance(input.subcontractorId),
        getSubcontractorPerformance(input.subcontractorId),
      ]);

      return {
        subcontractor: sub,
        compliance: compliance.compliance,
        eligibility: compliance.eligibility,
        performance,
        formatted: { committedCost: formatCents(performance.committedCostCents) },
      };
    }),

  list: tenantProcedure
    .input(
      z.object({
        trade: z.enum(TRADES).optional(),
        status: z
          .union([z.enum(SUBCONTRACTOR_STATUSES), z.array(z.enum(SUBCONTRACTOR_STATUSES))])
          .optional(),
        complianceState: z.enum(COMPLIANCE_STATES).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) =>
      listSubcontractors({ ...(input ?? {}), tenantId: ctx.tenantId }),
    ),

  update: tenantProcedure
    .input(
      z.object({
        subcontractorId: z.string().uuid(),
        name: z.string().min(2).max(255).optional(),
        trade: z.enum(TRADES).optional(),
        ...contactSchema,
        ...complianceSchema,
        rating: z.number().min(0).max(5).nullish(),
        status: z.enum(SUBCONTRACTOR_STATUSES).optional(),
        notes: z.string().max(5000).nullish(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await loadSubcontractorInTenant(input.subcontractorId, ctx.tenantId);

      try {
        return await updateSubcontractor({ ...input, userId: ctx.user.id });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Archive a trade partner. Blocked while it still has open assignments. */
  archive: tenantProcedure
    .input(z.object({ subcontractorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await loadSubcontractorInTenant(input.subcontractorId, ctx.tenantId);

      try {
        return await archiveSubcontractor(input.subcontractorId, ctx.user.id);
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Compliance state and whether the company may receive new work today (SC-002). */
  getCompliance: tenantProcedure
    .input(
      z.object({
        subcontractorId: z.string().uuid(),
        requiredCoverageCents: z.number().int().min(0).nullish(),
        strict: z.boolean().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await loadSubcontractorInTenant(input.subcontractorId, ctx.tenantId);

      try {
        return await getSubcontractorCompliance(input.subcontractorId, {
          requiredCoverageCents: input.requiredCoverageCents ?? null,
          strict: input.strict,
        });
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /**
   * Documents expiring within `withinDays` or already expired.
   * This is the pre-scheduling check: an expired COI found on the morning of the pour is a
   * stopped job and an uninsured exposure.
   */
  complianceAlerts: tenantProcedure
    .input(
      z
        .object({
          withinDays: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) =>
      listComplianceAlerts({
        tenantId: ctx.tenantId,
        withinDays: input?.withinDays ?? DEFAULT_COMPLIANCE_WARNING_DAYS,
      }),
    ),

  /** Derived performance metrics (SC-003), computed on read. */
  getPerformance: tenantProcedure
    .input(z.object({ subcontractorId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await loadSubcontractorInTenant(input.subcontractorId, ctx.tenantId);

      try {
        const performance = await getSubcontractorPerformance(input.subcontractorId);
        return {
          ...performance,
          formatted: { committedCost: formatCents(performance.committedCostCents) },
        };
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Recompute and persist the performance metrics. */
  refreshPerformance: tenantProcedure
    .input(z.object({ subcontractorId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await loadSubcontractorInTenant(input.subcontractorId, ctx.tenantId);

      try {
        return await refreshSubcontractorPerformance(input.subcontractorId, ctx.user.id);
      } catch (err) {
        return toTrpcError(err);
      }
    }),

  /** Tasks assigned to this company across projects. */
  listTasks: tenantProcedure
    .input(
      z.object({
        subcontractorId: z.string().uuid(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      await loadSubcontractorInTenant(input.subcontractorId, ctx.tenantId);
      return listTasksForSubcontractor(input.subcontractorId, input.limit ?? 200);
    }),

  /** Trade vocabulary for the UI. */
  trades: protectedProcedure.query(async () =>
    TRADES.map((trade) => ({
      value: trade,
      label: trade
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
    })),
  ),
});
