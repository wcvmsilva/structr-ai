import { z } from "zod";
import { router, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { listAuditLogs, getAuditLogById } from "./audit";

export const auditRouter = router({
  /** List audit logs with filters and pagination */
  list: adminProcedure
    .input(z.object({
      userId: z.number().optional(),
      tableName: z.string().optional(),
      action: z.string().optional(),
      recordId: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(({ input }) => listAuditLogs(input ?? undefined)),

  /** Get a single audit log entry by ID */
  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const log = await getAuditLogById(input.id);
      if (!log) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Audit log ${input.id} not found` });
      }
      return log;
    }),
});
