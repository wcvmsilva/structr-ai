/**
 * Issue Report Router — Sprint 20
 * Allows users to report pricing mismatches, missing assemblies, wrong multipliers, etc.
 * Reports are tied to a specific entity (estimate_draft, scope_draft, assembly, price_book_item).
 */
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { systemIssueReports } from "../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { logAudit } from "./audit";

const ISSUE_CATEGORIES = [
  "pricing_mismatch",
  "missing_assembly",
  "wrong_multiplier",
  "scope_error",
  "ui_bug",
  "data_integrity",
  "other",
] as const;

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["open", "acknowledged", "investigating", "resolved", "dismissed"] as const;

export const issueReportRouter = router({
  /** Create a new issue report */
  create: protectedProcedure
    .input(
      z.object({
        entityType: z.string().min(1).max(64),
        entityId: z.number().int().positive(),
        issueCategory: z.enum(ISSUE_CATEGORIES),
        severity: z.enum(SEVERITIES).default("medium"),
        title: z.string().min(3).max(255),
        description: z.string().min(10),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [result] = await db.insert(systemIssueReports).values({
        reportedBy: ctx.user.id,
        entityType: input.entityType,
        entityId: input.entityId,
        issueCategory: input.issueCategory,
        severity: input.severity,
        title: input.title,
        description: input.description,
        metadata: input.metadata ?? null,
      });

      const insertId = result.insertId;

      await logAudit({
        userId: ctx.user.id,
        action: "issue_reported",
        tableName: input.entityType,
        recordId: input.entityId,
        before: null,
        after: {
          issueId: insertId,
          category: input.issueCategory,
          severity: input.severity,
          title: input.title,
        },
      });

      return { id: insertId, status: "open" as const };
    }),

  /** List issue reports with optional filters */
  list: protectedProcedure
    .input(
      z.object({
        entityType: z.string().optional(),
        entityId: z.number().int().optional(),
        status: z.enum(STATUSES).optional(),
        issueCategory: z.enum(ISSUE_CATEGORIES).optional(),
        severity: z.enum(SEVERITIES).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0, page: input.page, pageSize: input.pageSize };
      const conditions = [];
      if (input.entityType) conditions.push(eq(systemIssueReports.type, input.entityType));
      if (input.entityId) conditions.push(eq((systemIssueReports as any).entityId, input.entityId));
      if (input.status) conditions.push(eq(systemIssueReports.status, input.status));
      if (input.issueCategory) conditions.push(eq(systemIssueReports.issueCategory, input.issueCategory));
      if (input.severity) conditions.push(eq(systemIssueReports.severity, input.severity));

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (input.page - 1) * input.pageSize;

      const [items, countResult] = await Promise.all([
        db
          .select()
          .from(systemIssueReports)
          .where(where)
          .orderBy(desc(systemIssueReports.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(systemIssueReports)
          .where(where),
      ]);

      return {
        items,
        total: countResult[0]?.count ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /** Get a single issue report by ID */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [report] = await db
        .select()
        .from(systemIssueReports)
        .where(eq(systemIssueReports.id, input.id))
        .limit(1);
      return report ?? null;
    }),

  /** Update issue report status (acknowledge, investigate, resolve, dismiss) */
  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(STATUSES),
        resolutionNotes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [existing] = await db
        .select()
        .from(systemIssueReports)
        .where(eq(systemIssueReports.id, input.id))
        .limit(1);

      if (!existing) {
        throw new Error("Issue report not found");
      }

      const updateData: Record<string, unknown> = {
        status: input.status,
      };

      if (input.status === "resolved" || input.status === "dismissed") {
        updateData.resolvedBy = ctx.user.id;
        updateData.resolvedAt = new Date();
      }

      if (input.resolutionNotes) {
        updateData.resolutionNotes = input.resolutionNotes;
      }

      await db
        .update(systemIssueReports)
        .set(updateData as Record<string, unknown>)
        .where(eq(systemIssueReports.id, input.id));

      await logAudit({
        userId: ctx.user.id,
        action: "issue_status_updated",
        tableName: "system_issue_reports",
        recordId: input.id,
        before: { status: existing.status },
        after: { status: input.status, resolutionNotes: input.resolutionNotes },
      });

      return { id: input.id, status: input.status };
    }),

  /** Get issue stats (counts by status, category, severity) */
  stats: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { byStatus: [], byCategory: [], bySeverity: [] };
    const [byStatus, byCategory, bySeverity] = await Promise.all([
      db
        .select({
          status: systemIssueReports.status,
          count: sql<number>`COUNT(*)`,
        })
        .from(systemIssueReports)
        .groupBy(systemIssueReports.status),
      db
        .select({
          category: systemIssueReports.issueCategory,
          count: sql<number>`COUNT(*)`,
        })
        .from(systemIssueReports)
        .groupBy(systemIssueReports.issueCategory),
      db
        .select({
          severity: systemIssueReports.severity,
          count: sql<number>`COUNT(*)`,
        })
        .from(systemIssueReports)
        .groupBy(systemIssueReports.severity),
    ]);

    return { byStatus, byCategory, bySeverity };
  }),
});
