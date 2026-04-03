import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { logAudit } from "./audit";
import {
  getUserPermissions, hasPermission, listRoles,
  listPermissions, getRoleWithPermissions, assignRoleToUser
} from "./rbac";

export const rbacRouter = router({
  /** List all roles */
  listRoles: adminProcedure.query(() => listRoles()),

  /** List all permissions */
  listPermissions: adminProcedure.query(() => listPermissions()),

  /** Get role with its permissions */
  getRoleWithPermissions: adminProcedure
    .input(z.object({ roleId: z.string() }))
    .query(async ({ input }) => {
      const result = await getRoleWithPermissions(input.roleId);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Role ${input.roleId} not found` });
      }
      return result;
    }),

  /** Assign a role to a user */
  assignRole: adminProcedure
    .input(z.object({
      userId: z.string(),
      roleId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      await assignRoleToUser(input.userId, input.roleId);
      logAudit({
        userId: ctx.user.id,
        action: "rbac.assignRole",
        tableName: "users",
        recordId: String(input.userId),
        before: null,
        after: { roleId: input.roleId },
      });
      return { success: true } as const;
    }),

  /** Get current user's permissions */
  myPermissions: protectedProcedure.query(async ({ ctx }) => {
    const perms = await getUserPermissions(ctx.user.id);
    return Array.from(perms);
  }),

  /** Check if current user has a specific permission */
  checkPermission: protectedProcedure
    .input(z.object({
      resource: z.string(),
      action: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const allowed = await hasPermission(ctx.user.id, input.resource, input.action);
      return { allowed };
    }),
});
