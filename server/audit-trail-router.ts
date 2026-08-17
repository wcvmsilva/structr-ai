/**
 * structr.ai — PHASE 4 Audit Trail tRPC Router
 *
 * Procedures:
 *   - auditTrail.list           (protected, admin) → query the trail
 *   - auditTrail.getEntity      (protected)        → full history of one entity
 *   - auditTrail.getProject     (protected)        → everything that happened on a project
 *   - auditTrail.getStats       (protected, admin) → aggregate counts
 *
 * There is deliberately no create, update or delete procedure. The trail is written by the
 * business modules themselves and the database refuses updates and deletes (AU-002); exposing a
 * write endpoint would let a caller fabricate history, which defeats the purpose of having it.
 *
 * `list` and `getStats` are admin-only: an unrestricted trail query reveals what every user in
 * the tenant did, including on projects the caller has no access to.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { requireProjectAccessTrpc } from "./project-access";
import {
  getAuditTrailStats,
  getEntityHistory,
  getProjectAuditTrail,
  listAuditTrail,
} from "./audit-trail";
import { AUDIT_ENTITY_TYPES } from "@shared/domain/phase4-taxonomy";

const isoDateTime = z.string().datetime({ offset: true }).or(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be ISO date or date-time"),
);

function requireTenant(tenantId: string | null | undefined): string {
  if (!tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tenant in session. The audit trail is tenant-scoped.",
    });
  }
  return tenantId;
}

export const auditTrailRouter = router({
  list: adminProcedure
    .input(
      z.object({
        entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
        entityId: z.string().uuid().optional(),
        entityKey: z.string().max(200).optional(),
        action: z.string().max(100).optional(),
        userId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
        from: isoDateTime.optional(),
        to: isoDateTime.optional(),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      return listAuditTrail({
        tenantId: requireTenant(ctx.tenantId),
        entityType: input.entityType,
        entityId: input.entityId,
        entityKey: input.entityKey,
        action: input.action,
        userId: input.userId,
        projectId: input.projectId,
        from: input.from,
        to: input.to,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * History of one entity, oldest first.
   *
   * Available to any tenant member: the practical use is "who changed this price and when",
   * asked by the person holding the invoice, and hiding that behind admin makes the trail
   * useless in exactly the moment it is needed.
   */
  getEntity: protectedProcedure
    .input(
      z.object({
        entityType: z.enum(AUDIT_ENTITY_TYPES),
        entityId: z.string().uuid(),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getEntityHistory({
        tenantId: requireTenant(ctx.tenantId),
        entityType: input.entityType,
        entityId: input.entityId,
        limit: input.limit,
      });
    }),

  getProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
    )
    .query(async ({ input, ctx }) => {
      // The project guard applies on top of the tenant scope: project history is project data.
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");

      return getProjectAuditTrail({
        tenantId: requireTenant(ctx.tenantId),
        projectId: input.projectId,
        limit: input.limit,
      });
    }),

  getStats: adminProcedure
    .input(
      z
        .object({ from: isoDateTime.optional(), to: isoDateTime.optional() })
        .default({}),
    )
    .query(async ({ input, ctx }) => {
      return getAuditTrailStats({
        tenantId: requireTenant(ctx.tenantId),
        from: input.from,
        to: input.to,
      });
    }),
});
