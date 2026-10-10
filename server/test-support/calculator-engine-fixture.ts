/** Isolated, synthetic T2 data. These records confer no database authority. */
export const calculatorId = (n: number) => `c3000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const calculatorIds = { tenant: calculatorId(1), actor: calculatorId(2), binding: calculatorId(3), project: calculatorId(4), intake: calculatorId(5), client: calculatorId(6), fixture: calculatorId(7), audit: calculatorId(8), unit: calculatorId(9), type: calculatorId(10), settings: calculatorId(11), zone: calculatorId(12), request: calculatorId(13), a: calculatorId(101), b: calculatorId(102), c: calculatorId(103) };
export function calculatorCommand(assemblies = [{ assemblyId: calculatorIds.a, quantity: 1 }]) {
  return { contractVersion: "calculator-v1", operation: "calculator.calculate", projectId: calculatorIds.project, intakeFormId: calculatorIds.intake, assemblies };
}
export function calculatorSnapshot() {
  const i = calculatorIds;
  const inputs = [{ id: i.a, name: "A", cost: "40.00", price: "100.00" }, { id: i.b, name: "B", cost: "60.00", price: "90.00" }, { id: i.c, name: "C", cost: "0.01", price: "0.01" }];
  return {
    contractVersion: "calculator-v1", engineVersion: "calculator-canonical-engines-v1",
    authority: { bindingId: i.binding, actorId: i.actor, tenantId: i.tenant },
    project: { id: i.project, tenantId: i.tenant, clientId: i.client, isActive: true, revision: "project-r1" },
    intake: { id: i.intake, tenantId: i.tenant, projectId: i.project, isActive: true, revision: "intake-r1" },
    client: { id: i.client, tenantId: i.tenant, isActive: true, revision: "client-r1" },
    capturedAt: "2026-10-10T16:00:00.000Z", evaluationDate: "2026-10-10", timeZone: "America/New_York",
    manifest: { id: i.fixture, revision: "fixture-r1", auditId: i.audit, isActive: true, assemblyIds: inputs.map(v => v.id), costCodeIds: inputs.map((_, n) => calculatorId(201 + n)), costTypeIds: [i.type], unitIds: [i.unit], sharedSourceClassification: "fixture_shared_types_units", dimensionSource: "fixture_explicit_unit_dimensions" },
    context: { channel: "direct", finishLevel: "standard", region: "charleston_sc", currency: "USD", dimensions: { wasteFactor: 1, coastalModifier: 1, channelCostMultiplier: 1, channelPriceMultiplier: 1, finishMultiplier: 1, regionalCostModifier: 1, regionalLaborModifier: 1, regionalMaterialModifier: 1 } },
    policyContext: {
      version: "internal-approval-policy-v1", evaluatorVersion: "phase2-channel-geo-plus-tenant-exact-v1", commercialChannel: "premium", channelBasis: "draft.channel_mapping", channelRawValue: "direct", geoRiskClass: "coastal", riskBasis: "project_at_internal_review",
      projectGeo: { zone: "Synthetic coastal zone", zoneId: i.zone, zoneTenantId: i.tenant, zoneSnapshotCapturedAt: "2026-10-01T12:00:00.000Z", geocodedAt: "2026-10-01T12:00:00.000Z", geocodeConfidence: "high", geocodeSource: "google_maps", coastalExposureLevel: "moderate", riskResolutionBasis: "zone_exposure", persistedProjectRiskClass: "coastal", costMultiplier: "1", zoneMinFloorPct: "42", warningCodes: ["geo.coastal_exposure"] },
      tenantSettings: { settingsId: i.settings, settingsUpdatedAt: "2026-10-01T12:00:00.000Z", channelOverridePct: null, geoOverridePct: null },
      floors: { channelBasePct: "28", geoBasePct: "42", effectiveFloorPct: "42", globalWarningPct: "35", individualWarningPct: "28", floorKind: "margin" },
    },
    assemblies: inputs.map((v, n) => ({ id: v.id, tenantId: i.tenant, name: v.name, code: `SYN-${v.name}`, category: "Synthetic", trade: null, isActive: true, revision: "assembly-r1", defaultUnitId: i.unit, baseUnitQty: "1", wasteFactor: "1", coastalModifier: "1", region: "charleston_sc", finishLevel: "standard", components: [{ id: calculatorId(301 + n), assemblyId: v.id, costCodeId: calculatorId(201 + n), costTypeId: i.type, unitId: i.unit, description: `Synthetic component ${v.name}`, quantity: "1", wasteFactor: "1", componentType: "material", unitCostOverride: null, isOptional: false, sortOrder: 1, revision: "bom-r1" }] })),
    costCodes: inputs.map((v, n) => ({ id: calculatorId(201 + n), tenantId: i.tenant, code: `12-${n + 1}`, name: `Synthetic code ${v.name}`, defaultCostTypeId: i.type, defaultUnitId: i.unit, isActive: true, revision: "code-r1" })),
    costTypes: [{ id: i.type, componentType: "material", isActive: true, revision: "type-r1" }],
    units: [{ id: i.unit, abbreviation: "EA", isActive: true, revision: "unit-r1" }],
    prices: inputs.map((v, n) => ({ id: calculatorId(401 + n), costCodeId: calculatorId(201 + n), unitId: i.unit, unitCost: v.cost, unitPrice: v.price, source: "synthetic_audited_fixture", effectiveDate: "2026-10-01", expirationDate: null as string | null, isActive: true, revision: "price-r1" })),
  };
}
