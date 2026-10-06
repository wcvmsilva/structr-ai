import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { tenantProcedure, router } from "./_core/trpc";
import { requireProjectAccessTrpc } from "./project-access";
import { HISTORICAL_SOURCE_KINDS } from "@shared/domain/taxonomy";
import { normalizeHistoricalSourceKind } from "@shared/domain/normalization";
import { HistoricalEstimateError } from "@shared/historical-estimate-engine";
import { recordHistoricalSource, importHistoricalEstimate, getHistoricalSource, getHistoricalImport, listHistoricalSources } from "./historical-estimate-db";

const id = z.string().uuid();
const text = (max: number) => z.string().max(max).nullable();
// Bounds precede the database: PostgreSQL numeric(scale) otherwise rounds silently.
const money = z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/, "Use a nonnegative decimal with at most two decimal places.").nullable();
const quantity = z.string().regex(/^\d{1,14}(?:\.\d{1,6})?$/, "Use at most fourteen integer and six decimal digits.").nullable();
const raw = text(256);
const rawTotals = z.object({ version: z.literal("historical-raw-totals-v1"), subtotal: raw, discount: raw, tax: raw, total: raw, estimatedCost: raw }).strict();
const rawValues = z.object({ version: z.literal("historical-raw-line-v1"), quantity: raw, unitPrice: raw, unitEstimatedCost: raw, linePrice: raw, lineEstimatedCost: raw, taxable: raw, externalCode: raw }).strict();
const rawSelectedTotals = z.object({ version: z.literal("historical-raw-selected-v1"), total: raw, estimatedCost: raw }).strict();
const sourceLine = z.object({
  sourceLineKey: z.string().min(1).max(128), ordinal: z.number().int().min(0), description: text(5000),
  quantity, unit: text(128), unitPrice: quantity, unitEstimatedCost: quantity, linePrice: money, lineEstimatedCost: money,
  externalCodeSystem: text(128), externalCode: text(128), taxable: z.boolean().nullable(), rawValues,
}).strict();
export const historicalSourceSchema = z.object({
  requestId: id, projectId: id, clientId: id,
  sourceKind: z.preprocess(value => typeof value === "string" ? normalizeHistoricalSourceKind(value) : value, z.enum(HISTORICAL_SOURCE_KINDS)),
  sourceLabel: z.string().trim().min(1).max(255), currencyCode: z.literal("USD").nullable(), sourceFileId: id.nullable(),
  declaredSubtotal: money, declaredDiscount: money, declaredTax: money, declaredTotal: money, declaredEstimatedCost: money,
  commercialTermsText: text(5000), rawTotals, lines: z.array(sourceLine).min(1).max(1000),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.lines.map(line => line.sourceLineKey)).size !== input.lines.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "Each source line needs a distinct key." });
  if (new Set(input.lines.map(line => line.ordinal)).size !== input.lines.length) ctx.addIssue({ code: "custom", path: ["lines"], message: "Each source line needs a distinct position." });
  if (input.sourceKind === "file_extract" && !input.sourceFileId) ctx.addIssue({ code: "custom", path: ["sourceFileId"], message: "File extraction requires an authorized project file." });
});
export const historicalSelectionSchema = z.object({
  requestId: id, sourceId: id, projectId: id, clientId: id, selectedLineIds: z.array(id).min(1).max(1000),
  declaredSelectedTotal: money, declaredSelectedEstimatedCost: money, rawSelectedTotals,
  reportedApprovalAt: z.string().datetime({ offset: true }).nullable(), reportedApprovalNote: text(5000),
  priorImportId: id.nullable(), expectedRevision: z.number().int().min(1).nullable(),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.selectedLineIds).size !== input.selectedLineIds.length) ctx.addIssue({ code: "custom", path: ["selectedLineIds"], message: "Select each line once." });
  if ((input.priorImportId === null) !== (input.expectedRevision === null)) ctx.addIssue({ code: "custom", path: ["priorImportId"], message: "A revision requires its predecessor and expected revision together." });
});

export function mapHistoricalError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof HistoricalEstimateError) {
    const code = error.code.includes("FORBIDDEN") || error.code.includes("MISMATCH") ? "FORBIDDEN"
      : error.code.includes("NOT_FOUND") ? "NOT_FOUND"
      : error.code.includes("CONFLICT") || error.code.includes("ALREADY_RECORDED") ? "CONFLICT"
      : error.code === "HISTORICAL_AUTHORITY_NOT_AVAILABLE" || error.code === "HISTORICAL_SOURCE_IMMUTABLE" ? "PRECONDITION_FAILED"
      : "BAD_REQUEST";
    throw new TRPCError({ code, message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Historical estimate operation failed." });
}
async function execute<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { return mapHistoricalError(error); }
}

// Mounted in the existing estimate router, not a parallel calculator endpoint.
export const historicalImportProcedure = tenantProcedure.input(historicalSelectionSchema).mutation(({ input, ctx }) =>
  execute(async () => {
    await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");
    return importHistoricalEstimate(input, ctx.user.id, ctx.tenantId);
  }));
export const historicalEstimateRouter = router({
  recordSource: tenantProcedure.input(historicalSourceSchema).mutation(({ input, ctx }) => execute(async () => {
    await requireProjectAccessTrpc(input.projectId, ctx.user.id, "write");
    return recordHistoricalSource(input, ctx.user.id, ctx.tenantId);
  })),
  getSource: tenantProcedure.input(z.object({ sourceId: id }).strict()).query(({ input, ctx }) => execute(() => getHistoricalSource(input.sourceId, ctx.user.id, ctx.tenantId))),
  getImport: tenantProcedure.input(z.object({ importId: id }).strict()).query(({ input, ctx }) => execute(() => getHistoricalImport(input.importId, ctx.user.id, ctx.tenantId))),
  listSources: tenantProcedure.input(z.object({ projectId: id, limit: z.number().int().min(1).max(100).optional(), cursor: z.object({ createdAt: z.string().datetime({ offset: true }), id }).strict().optional() }).strict())
    .query(({ input, ctx }) => execute(async () => {
      await requireProjectAccessTrpc(input.projectId, ctx.user.id, "read");
      return listHistoricalSources(input, ctx.user.id, ctx.tenantId);
    })),
});
