/**
 * structr.ai — Drawing Router
 * TakeOff V1: Drawing Upload / Revision Management
 *
 * Handles file upload, revision tracking, and drawing metadata.
 * Uses existing storage proxy (storagePut/storageGet) for file persistence.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import {
  createProjectDrawing,
  getProjectDrawingById,
  listDrawingsByProject,
  listActiveDrawingsByProject,
  setActiveRevision,
  deleteProjectDrawing,
  createRevisionSnapshot,
  listRevisionSnapshots,
} from "./drawing-db";
import { storagePut } from "./storage";

const ALLOWED_FILE_TYPES = ["pdf", "png", "jpg", "jpeg", "tiff"] as const;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/** S4: Validate file magic bytes match the declared file type */
function validateFileMagic(buffer: Buffer, declaredType: string): boolean {
  if (buffer.length < 4) return false;

  const magicMap: Record<string, (b: Buffer) => boolean> = {
    pdf: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
    png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47, // .PNG
    jpg: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
    jpeg: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
    tiff: (b) => (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4D && b[1] === 0x4D), // II or MM
  };

  const check = magicMap[declaredType];
  return check ? check(buffer) : true; // unknown types pass through
}

export const drawingRouter = router({
  /**
   * Upload a drawing file and register it against a project.
   * File is sent as base64-encoded string (V1 simplicity).
   */
  upload: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      fileName: z.string().min(1).max(255),
      fileType: z.enum(ALLOWED_FILE_TYPES),
      fileBase64: z.string().min(1),
      revisionLabel: z.string().max(10).default("A"),
      sheetLabel: z.string().max(20).optional(),
      sheetType: z.enum(["floor_plan", "elevation", "section", "detail", "site", "other"]).optional(),
      notes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;

      // Decode and validate file size
      const fileBuffer = Buffer.from(input.fileBase64, "base64");
      if (fileBuffer.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File is empty" });
      }
      if (fileBuffer.length > MAX_FILE_SIZE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        });
      }

      // S4: Validate file magic bytes match declared fileType
      const magicValid = validateFileMagic(fileBuffer, input.fileType);
      if (!magicValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `File content does not match declared type "${input.fileType}". Upload the correct file format.`,
        });
      }

      // Upload to storage
      const storageKey = `drawings/${input.projectId}/${Date.now()}-${input.fileName}`;
      const contentType =
        input.fileType === "pdf" ? "application/pdf"
        : input.fileType === "tiff" ? "image/tiff"
        : `image/${input.fileType === "jpg" ? "jpeg" : input.fileType}`;

      const storageResult = await storagePut(storageKey, fileBuffer, contentType);

      // Create drawing record
      const drawing = await createProjectDrawing({
        projectId: input.projectId,
        fileName: input.fileName,
        fileType: input.fileType,
        storagePath: storageResult.key,
        fileSizeBytes: fileBuffer.length,
        revisionLabel: input.revisionLabel,
        sheetLabel: input.sheetLabel,
        sheetType: input.sheetType,
        notes: input.notes,
        isActiveRevision: true,
        uploadedBy: userId,
      }, userId);

      if (!drawing) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save drawing record" });
      }

      return drawing;
    }),

  /** List all drawings for a project */
  listByProject: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      activeOnly: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      if (input.activeOnly) {
        return listActiveDrawingsByProject(input.projectId);
      }
      return listDrawingsByProject(input.projectId);
    }),

  /** Get a single drawing by ID */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const drawing = await getProjectDrawingById(input.id);
      if (!drawing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Drawing not found" });
      }
      return drawing;
    }),

  /** Set which drawing revision is active for a project */
  setActiveRevision: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      drawingId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await setActiveRevision(input.projectId, input.drawingId, ctx.user!.id);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Drawing not found or does not belong to project" });
      }
      return result;
    }),

  /** Delete a drawing */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const deleted = await deleteProjectDrawing(input.id, ctx.user!.id);
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Drawing not found" });
      }
      return { success: true };
    }),

  /** Create a revision snapshot (freeze current drawing set) */
  createSnapshot: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      revisionLabel: z.string().min(1).max(10),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user!.id;

      // Get active drawings for snapshot
      const activeDrawings = await listActiveDrawingsByProject(input.projectId);
      if (activeDrawings.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No active drawings to snapshot" });
      }

      const snapshot = await createRevisionSnapshot({
        projectId: input.projectId,
        revisionLabel: input.revisionLabel,
        drawingIds: activeDrawings.map((d) => d.id),
        snapshotData: {
          drawings: activeDrawings.map((d) => ({
            id: d.id,
            fileName: d.fileName,
            sheetLabel: d.sheetLabel,
            sheetType: d.sheetType,
            revisionLabel: d.revisionLabel,
          })),
          snapshotAt: new Date().toISOString(),
        },
        createdBy: userId,
      }, userId);

      if (!snapshot) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create snapshot" });
      }

      return snapshot;
    }),

  /** List revision snapshots for a project */
  listSnapshots: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      return listRevisionSnapshots(input.projectId);
    }),
});
