import { approvalRows, approvalContext } from "./internal-estimate-approval-adapter.fixtures";
// Explicit wire contract, independently stated in the implementation plan.
const fields = {
  draft: "id tenantId projectId clientId version createdAt pricingSchemaVersion source estimateId intakeFormId bundleId supersedesId changeOrderOf bundleName notes subtotalPrice discountApplied discountAmount finalTotalPrice subtotalCost lineItems assemblySelections pricingSnapshot draftData commercialChannel channel zone finishLevel region trade coastalModifier scopeDraftId assemblyCount status supersededBy approvedAt approvedBy lockedAt",
  project: "id tenantId clientId deletedAt commercialChannel channel geoRiskClass address city state zip county latitude longitude geocodedAt geocodeConfidence geocodeSource geocodedAddress zone zoneModifierSnapshot",
  client: "id tenantId isActive deletedAt", tenant: "id isActive", profile: "id tenantId isActive",
  zone: "id tenantId isActive zoneName name coastalExposureLevel costMultiplier laborModifier materialModifier logisticsModifier contingencyPct minProfitShieldPct",
  settings: "id tenantId updatedAt profitShieldOverrides geoFloorOverrides", scopeDraft: "id projectId tenantId",
} as const;
export function authenticatedReviewEnvelope(): any {
  const original = approvalRows();
  const rows = Object.fromEntries(Object.entries(fields).map(([name, names]) => {
    const row = original[name as keyof typeof original];
    return [name, row === null ? null : Object.fromEntries(names.split(" ").map(key => [key, (row as any)[key]]))];
  }));
  return JSON.parse(JSON.stringify({
    version: "structr-authenticated-review-v1",
    context: { actorId: approvalContext.actorId, tenantId: approvalContext.tenantId }, rows,
    approvalEvidence: { snapshots: [], approvals: [], revocations: [], authors: [], sourceMatches: null },
  }));
}
