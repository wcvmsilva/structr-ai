/** Synthetic test data only. No customer, production identity, or authority. */
export const approvalIds = {
  tenant: "a1000000-0000-4000-8000-000000000001",
  project: "a1000000-0000-4000-8000-000000000002",
  client: "a1000000-0000-4000-8000-000000000003",
  draft: "a1000000-0000-4000-8000-000000000004",
  actor: "a1000000-0000-4000-8000-000000000005",
  assembly: "a1000000-0000-4000-8000-000000000006",
  zone: "a1000000-0000-4000-8000-000000000007",
  request: "a1000000-0000-4000-8000-000000000008",
  approval: "a1000000-0000-4000-8000-000000000009",
  settings: "a1000000-0000-4000-8000-000000000010",
};
export function makeInternalApprovalReviewInput() {
  return {
    identity: { tenantId: approvalIds.tenant, projectId: approvalIds.project, clientId: approvalIds.client, estimateDraftId: approvalIds.draft, draftVersion: 1 },
    origin: { source: "assembly_calculator", sourceCreatedAt: "2026-09-01T12:00:00.000Z", pricingSchemaVersion: "1.0", estimateId: null, intakeFormId: null, bundleId: null, supersedesId: null, changeOrderOf: null, lineageBasis: "verified_calculated_chain" },
    presentation: { bundleName: "Synthetic assembly", reviewedNotes: "Reviewed text — café" },
    financials: { currencyCode: "USD", currencyBasis: "approver_confirmation", subtotalPriceMinor: "10000", discountApplied: false, discountMinor: "0", finalPriceMinor: "10000", estimatedCostMinor: "4000" },
    lines: [{ lineKey: "line:1", ordinal: 1, costGroupName: "Cabinetry & Millwork", costItemName: "Synthetic shelf", description: "Synthetic component", quantity: "2", unit: "EA", unitCostSnapshot: "20", unitPriceSnapshot: "50", lineTotalCostMinor: "4000", lineTotalPriceMinor: "10000", assemblyId: approvalIds.assembly, costCode: "12-100", taxable: null,
      csvClassification: { classificationVersion: "jobtread-s20.1-classification-h1-8550e842-v1", costType: "Materials", normalizedUnit: "Each", costCode: "12-100", costTypeSource: "classifyCostType_v1", unitSource: "normalizeUnit_v1", costCodeSource: "stored" } }],
    assemblySelections: [{ selectionKey: "selection:1", ordinal: 1, assemblyId: approvalIds.assembly, assemblyName: "Synthetic assembly", assemblyCode: "SYN-1", category: "Synthetic", quantity: "2", unitCost: "20", unitPrice: "50", extendedCostMinor: "4000", extendedPriceMinor: "10000" }],
    pricingContext: { pricingChannel: "direct", finishLevel: "standard", region: "synthetic", zone: null, trade: null, coastalModifier: null, storedCommercialChannel: null, storedGeoRiskClass: null, storedRiskBasis: "unknown" },
    policyContext: {
      version: "internal-approval-policy-v1", evaluatorVersion: "phase2-channel-geo-plus-tenant-exact-v1", commercialChannel: "premium", channelBasis: "draft.channel_mapping", channelRawValue: "direct", geoRiskClass: "coastal", riskBasis: "project_at_internal_review",
      projectGeo: { zone: "Synthetic coastal zone", zoneId: approvalIds.zone, zoneTenantId: approvalIds.tenant, zoneSnapshotCapturedAt: "2026-09-01T12:00:00.000Z", geocodedAt: "2026-09-01T12:00:00.000Z", geocodeConfidence: "high", geocodeSource: "google_maps", coastalExposureLevel: "moderate", riskResolutionBasis: "zone_exposure", persistedProjectRiskClass: "coastal", costMultiplier: "1.1", zoneMinFloorPct: "42", warningCodes: ["geo.coastal_exposure"] },
      tenantSettings: { settingsId: null, settingsUpdatedAt: null, channelOverridePct: null, geoOverridePct: null },
      floors: { channelBasePct: "28", geoBasePct: "42", effectiveFloorPct: "42", globalWarningPct: "35", individualWarningPct: "28", floorKind: "margin" },
    },
    scopeReference: { association: "none", scopeDraftId: null, reviewSnapshotId: null },
  };
}

/** Literal assembly of the documented envelope, independent of the engine. */
export function makeInternalApprovalSnapshot() {
  const { pricingContext, policyContext, ...rest } = makeInternalApprovalReviewInput();
  return { version: "internal-approval-snapshot-v1", ...rest, commercialContext: { pricingContext, policyContext } };
}
