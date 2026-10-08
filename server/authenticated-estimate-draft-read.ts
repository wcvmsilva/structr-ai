/** The general detail read preserves the physical row, without A1 eligibility rules. */
import { z } from "zod";
import type { EstimateDraft } from "../drizzle/schema";
import { ADR002_PROTOCOL } from "../shared/domain/taxonomy";
import { AuthenticatedDataApiError } from "./authenticated-data-api";
import {
  authenticatedIdentitySchema,
  authenticatedTimestampSchema,
} from "./authenticated-internal-approval-review";
import { assertPlainData } from "./project-geocode-review-evidence";

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const nullableUuid = uuid.nullable(),
  text = z.string().nullable();
const integer = z.number().int().safe(),
  timestamp = authenticatedTimestampSchema;
const json = z.unknown().refine(value => value !== undefined);
const commandSchema = z
  .object({
    id: z
      .string()
      .uuid()
      .transform(value => value.toLowerCase()),
  })
  .strict();
const draftSchema = z
  .object({
    id: uuid,
    tenantId: nullableUuid,
    estimateId: nullableUuid,
    projectId: uuid,
    status: z.string(),
    source: text,
    draftData: json,
    bundleName: text,
    zone: text,
    finishLevel: text,
    trade: text,
    pricingSchemaVersion: text,
    channel: text,
    region: text,
    createdBy: nullableUuid,
    coastalModifier: text,
    subtotalPrice: text,
    subtotalCost: text,
    finalTotalPrice: text,
    discountApplied: z.boolean().nullable(),
    discountAmount: text,
    grossProfit: text,
    grossProfitPct: text,
    profitShieldPassed: z.boolean().nullable(),
    profitShieldMinPct: text,
    assemblySelections: json,
    lineItems: json,
    intakeFormId: nullableUuid,
    warningsJson: json,
    scopeDraftId: nullableUuid,
    notes: text,
    metadata: json,
    bundleId: nullableUuid,
    clientId: nullableUuid,
    assemblyCount: integer.nullable(),
    approvedBy: nullableUuid,
    approvedAt: timestamp.nullable(),
    rejectedBy: nullableUuid,
    rejectedAt: timestamp.nullable(),
    rejectionReason: text,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: integer,
    supersededBy: nullableUuid,
    supersedesId: nullableUuid,
    lockedAt: timestamp.nullable(),
    changeOrderOf: nullableUuid,
    changeOrderReason: text,
    commercialChannel: text,
    profitShieldFloorPct: text,
    profitShieldEvaluation: json,
    pricingSnapshot: json,
    a1VersionRequestId: nullableUuid,
    a1VersionRequestHash: text,
  })
  .strict();
const envelopeSchema = z
  .object({
    version: z.literal(ADR002_PROTOCOL.estimateRead),
    context: authenticatedIdentitySchema,
    draft: draftSchema,
    historicalImportId: nullableUuid,
  })
  .strict();

export function decodeAuthenticatedEstimateDraftRead(
  raw: unknown,
  command: unknown,
  expectedIdentity: unknown
): EstimateDraft & { historicalImportId: string | null } {
  try {
    assertPlainData(command);
  } catch {
    throw new AuthenticatedDataApiError("invalid_request");
  }
  const input = commandSchema.safeParse(command);
  if (!input.success) throw new AuthenticatedDataApiError("invalid_request");
  try {
    assertPlainData(raw);
    assertPlainData(expectedIdentity);
  } catch {
    throw new AuthenticatedDataApiError("unavailable");
  }
  const expected = authenticatedIdentitySchema.safeParse(expectedIdentity),
    parsed = envelopeSchema.safeParse(raw);
  if (
    !expected.success ||
    !parsed.success ||
    parsed.data.context.actorId !== expected.data.actorId ||
    parsed.data.context.tenantId !== expected.data.tenantId ||
    parsed.data.draft.id !== input.data.id
  )
    throw new AuthenticatedDataApiError("unavailable");
  // The RPC authorizes the project's tenant. General reads historically do not bind
  // nullable draft.tenantId to that tenant; imposing A1's stronger rule would regress them.
  return {
    ...parsed.data.draft,
    historicalImportId: parsed.data.historicalImportId,
  };
}
