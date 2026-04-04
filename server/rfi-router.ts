/**
 * structr.ai — RFI Candidates Router
 * TakeOff V1: Items needing clarification before scope finalization
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import {
  createRfiCandidate,
  getRfiCandidateById,
  listRfiCandidatesByProject,
  listRfiCandidatesByScopeSource,
  listOpenRfisByProject,
  resolveRfiCandidate,
  dismissRfiCandidate,
  promoteRfiCandidate,
} from "./rfi-db";
import { RFI_CATEGORIES } from "@shared/drawing-intake-types";

export const rfiRouter = router({
  /** Create an RFI candidate */
  create: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      scopeSourceId: z.string().uuid().optional(),
      drawingId: z.string().uuid().optional(),
      category: z.enum(RFI_CATEGORIES),
      question: z.string().min(1).max(2000),
      context: z.string().max(2000).optional(),
      suggestedAnswer: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const rfi = await createRfiCandidate({
        projectId: input.projectId,
        scopeSourceId: input.scopeSourceId,
        drawingId: input.drawingId,
        category: input.category,
        question: input.question,
        context: input.context,
        suggestedAnswer: input.suggestedAnswer,
        status: "open",
        createdBy: ctx.user!.id,
      }, ctx.user!.id);

      if (!rfi) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create RFI" });
      }

      return rfi;
    }),

  /** Get an RFI by ID */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const rfi = await getRfiCandidateById(input.id);
      if (!rfi) {
        throw new TRPCError({ code: "NOT_FOUND", message: "RFI not found" });
      }
      return rfi;
    }),

  /** List RFIs for a project */
  listByProject: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      openOnly: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      if (input.openOnly) {
        return listOpenRfisByProject(input.projectId);
      }
      return listRfiCandidatesByProject(input.projectId);
    }),

  /** List RFIs for a specific scope source */
  listByScopeSource: protectedProcedure
    .input(z.object({ scopeSourceId: z.string().uuid() }))
    .query(async ({ input }) => {
      return listRfiCandidatesByScopeSource(input.scopeSourceId);
    }),

  /** Resolve an RFI with an answer */
  resolve: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      resolution: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      const rfi = await getRfiCandidateById(input.id);
      if (!rfi) {
        throw new TRPCError({ code: "NOT_FOUND", message: "RFI not found" });
      }
      if (rfi.status !== "open") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `RFI is already "${rfi.status}"` });
      }

      const resolved = await resolveRfiCandidate(input.id, input.resolution, ctx.user!.id);
      if (!resolved) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to resolve RFI" });
      }
      return resolved;
    }),

  /** Dismiss an RFI (not relevant) */
  dismiss: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const rfi = await getRfiCandidateById(input.id);
      if (!rfi) {
        throw new TRPCError({ code: "NOT_FOUND", message: "RFI not found" });
      }
      if (rfi.status !== "open") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `RFI is already "${rfi.status}"` });
      }

      const dismissed = await dismissRfiCandidate(input.id, ctx.user!.id);
      if (!dismissed) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to dismiss RFI" });
      }
      return dismissed;
    }),

  /** Promote an RFI to a full project RFI (escalation) */
  promote: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const rfi = await getRfiCandidateById(input.id);
      if (!rfi) {
        throw new TRPCError({ code: "NOT_FOUND", message: "RFI not found" });
      }
      if (rfi.status !== "open") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `RFI is already "${rfi.status}"` });
      }

      const promoted = await promoteRfiCandidate(input.id, ctx.user!.id);
      if (!promoted) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to promote RFI" });
      }
      return promoted;
    }),
});
