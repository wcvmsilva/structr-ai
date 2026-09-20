import { eq } from "drizzle-orm";
import { bundles, estimates, intakeForms } from "../drizzle/schema";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";
import type { AuthTransaction } from "./auth-transaction";

export type InternalEstimateReferenceOrigin = {
  estimateId: string | null;
  bundleId: string | null;
  intakeFormId: string | null;
};
export type InternalEstimateReferenceContext = {
  tenantId: string;
  projectId: string;
  clientId: string;
};

function unresolved(): never {
  throw new InternalApprovalError("INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
}

// Core §1 matches PostgreSQL UUIDs without imposing version/variant restrictions.
// Matches the Core UUID grammar; do not replace this with version-restricted z.uuid().
function uuid(value: unknown): string {
  if (typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    || value === "00000000-0000-0000-0000-000000000000") unresolved();
  return value;
}

/** Read only the declared own data fields, leaving additional context untouched. */
function dataField(object: unknown, key: string): unknown {
  if (typeof object !== "object" || object === null || Array.isArray(object)) unresolved();
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (!field || !Object.hasOwn(field, "value")) unresolved();
  return field.value;
}
function nullableUuid(value: unknown): string | null {
  return value === null ? null : uuid(value);
}

function validateIntakeClaims(value: unknown, projectId: string, clientId: string): void {
  if (value === null) return;
  if (typeof value !== "object" || Array.isArray(value)) unresolved();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) unresolved();
  for (const [key, expected] of [["projectId", projectId], ["clientId", clientId]]) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field) continue;
    if (!Object.hasOwn(field, "value")) unresolved();
    if (field.value !== null && uuid(field.value) !== expected) unresolved();
  }
}

/**
 * Validate reviewed provenance within the caller's existing transaction.
 * The caller owns SERIALIZABLE isolation, current ACL/context/lineage and replay
 * ordering. This helper confers no authority and performs no writes or repricing.
 */
export async function assertInternalEstimateReferences(
  tx: AuthTransaction,
  origin: InternalEstimateReferenceOrigin,
  context: InternalEstimateReferenceContext,
): Promise<void> {
  // Validate every input before querying, including context when all refs are null.
  const estimateId = nullableUuid(dataField(origin, "estimateId"));
  const bundleId = nullableUuid(dataField(origin, "bundleId"));
  const intakeFormId = nullableUuid(dataField(origin, "intakeFormId"));
  const tenantId = uuid(dataField(context, "tenantId"));
  const projectId = uuid(dataField(context, "projectId"));
  const clientId = uuid(dataField(context, "clientId"));

  // The order and SHARE locks are common to preview and new-copy validation.
  if (estimateId !== null) {
    const found = await tx.select({ id: estimates.id, tenantId: estimates.tenantId, projectId: estimates.projectId })
      .from(estimates).where(eq(estimates.id, estimateId)).for("share");
    if (found.length !== 1 || found[0].id !== estimateId
      || found[0].tenantId !== tenantId || found[0].projectId !== projectId) unresolved();
  }
  if (bundleId !== null) {
    const found = await tx.select({ id: bundles.id, tenantId: bundles.tenantId })
      .from(bundles).where(eq(bundles.id, bundleId)).for("share");
    // Inactive provenance remains valid; catalog dates/items/prices are not inputs.
    if (found.length !== 1 || found[0].id !== bundleId || found[0].tenantId !== tenantId) unresolved();
  }
  if (intakeFormId !== null) {
    const found = await tx.select({ id: intakeForms.id, tenantId: intakeForms.tenantId, projectId: intakeForms.projectId, formData: intakeForms.formData })
      .from(intakeForms).where(eq(intakeForms.id, intakeFormId)).for("share");
    if (found.length !== 1 || found[0].id !== intakeFormId
      || found[0].tenantId !== tenantId || found[0].projectId !== projectId) unresolved();
    validateIntakeClaims(found[0].formData, projectId, clientId);
  }
}
