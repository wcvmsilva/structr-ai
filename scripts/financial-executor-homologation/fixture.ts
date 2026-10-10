/** Exact synthetic A/B/C row plan; caller cannot supply rows, prices or shared IDs. */
import { round2 } from "../../shared/utils/math";
import {
  CHANNEL_MIN_MARGIN_PCT,
  PROFIT_SHIELD_PCT,
} from "../../shared/constants/profit-shield";
import {
  ASSEMBLIES,
  SYNTHETIC_IDS as I,
  type CalculatorHomologationManifest,
} from "./contract";
export type FixtureRow = {
  table: string;
  row: Record<string, unknown> & { id: string };
};
export function fixturePlan(
  m: CalculatorHomologationManifest,
  at: string,
  settings: { id: string; updated_at: string }
) {
  const tenant = m.operator.tenantId,
    actor = m.operator.actorId,
    floor = PROFIT_SHIELD_PCT.COASTAL_MIN_GP;
  const evidence = {
    version: "project-geocode-review-v1",
    projectId: I.project,
    tenantId: tenant,
    inputAddress: {
      address: "1 Synthetic Lane",
      city: "Synthetic City",
      state: "SC",
      zipCode: "00000",
      county: "Synthetic County",
    },
    geocodedAt: at,
    geocode: {
      success: true,
      latitude: 32.75,
      longitude: -79.9,
      formattedAddress: "1 Synthetic Lane, Synthetic City",
      confidence: "high",
      source: "google_maps",
      withinServiceRadius: true,
    },
    zoneDetection: {
      zoneId: I.zone,
      method: "coordinates",
      confidence: "high",
    },
  };
  const zoneSnapshot = {
    zoneId: I.zone,
    zoneName: "ADR003 synthetic coastal zone",
    laborModifier: 1,
    materialModifier: 1,
    logisticsModifier: 1,
    contingencyPct: 0,
    minProfitShieldPct: floor,
    coastalExposureLevel: "moderate",
    capturedAt: at,
    reviewEvidence: evidence,
  };
  const rows: FixtureRow[] = [
    {
      table: "clients",
      row: {
        id: I.client,
        tenant_id: tenant,
        name: "ADR003 synthetic client",
        is_active: true,
      },
    },
    {
      table: "geo_zones",
      row: {
        id: I.zone,
        tenant_id: tenant,
        name: "ADR003 synthetic coastal zone",
        zone_name: "ADR003 synthetic coastal zone",
        is_active: true,
        coastal_exposure_level: "moderate",
        cost_multiplier: "1",
        labor_modifier: "1",
        material_modifier: "1",
        logistics_modifier: "1",
        contingency_pct: "0",
        min_profit_shield_pct: String(floor),
      },
    },
    {
      table: "projects",
      row: {
        id: I.project,
        tenant_id: tenant,
        client_id: I.client,
        owner_user_id: actor,
        name: "ADR003 synthetic financial project",
        project_type: "repair",
        channel: "direct",
        geo_risk_class: "coastal",
        address: "1 Synthetic Lane",
        city: "Synthetic City",
        state: "SC",
        zip: "00000",
        county: "Synthetic County",
        latitude: "32.75",
        longitude: "-79.9",
        geocoded_at: at,
        geocode_confidence: "high",
        geocode_source: "google_maps",
        geocoded_address: "1 Synthetic Lane, Synthetic City",
        zone: "ADR003 synthetic coastal zone",
        zone_modifier_snapshot: zoneSnapshot,
      },
    },
    {
      table: "intake_forms",
      row: {
        id: I.intake,
        tenant_id: tenant,
        project_id: I.project,
        status: "draft",
        form_data: {
          serviceType: "repair",
          finishLevel: "standard",
          channel: "direct",
        },
      },
    },
    {
      table: "cost_types",
      row: { id: I.type, name: "ADR003 synthetic material", is_active: true },
    },
    {
      table: "units",
      row: {
        id: I.unit,
        name: "ADR003 synthetic each",
        abbreviation: "C8EA",
        is_active: true,
      },
    },
    ...ASSEMBLIES.flatMap(a => [
      {
        table: "cost_codes",
        row: {
          id: a.codeId,
          tenant_id: tenant,
          code: `ADR003-${a.label}`,
          name: `ADR003 synthetic code ${a.label}`,
          default_cost_type_id: I.type,
          default_unit_id: I.unit,
          is_active: true,
        },
      },
      {
        table: "cost_code_pricing_history",
        row: {
          id: a.priceId,
          cost_code_id: a.codeId,
          unit_id: I.unit,
          unit_cost: a.cost,
          unit_price: a.price,
          source: "synthetic_audited_fixture",
          effective_date: "2026-10-01",
          expiration_date: null,
          is_active: true,
        },
      },
      {
        table: "assemblies",
        row: {
          id: a.id,
          tenant_id: tenant,
          name: `ADR003 synthetic ${a.label}`,
          code: `ADR003-${a.label}`,
          category: "Synthetic",
          trade: null,
          default_unit_id: I.unit,
          base_unit_qty: "1",
          waste_factor: "0",
          coastal_modifier: "1",
          region: "charleston_sc",
          finish_level: "standard",
          is_active: true,
        },
      },
      {
        table: "assembly_items",
        row: {
          id: a.itemId,
          assembly_id: a.id,
          cost_code_id: a.codeId,
          cost_type_id: I.type,
          unit_id: I.unit,
          description: `ADR003 synthetic component ${a.label}`,
          default_qty_per_unit: "1",
          waste_factor: "0",
          component_type: "material",
          unit_cost_override: null,
          is_optional: false,
          sort_order: 1,
        },
      },
    ]),
  ];
  const manifest = {
    contractVersion: "calculator-fixture-v1",
    assemblyIds: ASSEMBLIES.map(a => a.id),
    costCodeIds: ASSEMBLIES.map(a => a.codeId),
    costTypeIds: [I.type],
    unitIds: [I.unit],
    sharedSourceClassification: "fixture_shared_types_units",
    dimensionSource: "fixture_explicit_unit_dimensions",
    context: {
      channel: "direct",
      finishLevel: "standard",
      region: "charleston_sc",
      currency: "USD",
      dimensions: {
        wasteFactor: 1,
        coastalModifier: 1,
        channelCostMultiplier: 1,
        channelPriceMultiplier: 1,
        finishMultiplier: 1,
        regionalCostModifier: 1,
        regionalLaborModifier: 1,
        regionalMaterialModifier: 1,
      },
    },
    policyContext: {
      version: "internal-approval-policy-v1",
      evaluatorVersion: "phase2-channel-geo-plus-tenant-exact-v1",
      commercialChannel: "premium",
      channelBasis: "draft.channel_mapping",
      channelRawValue: "direct",
      geoRiskClass: "coastal",
      riskBasis: "project_at_internal_review",
      projectGeo: {
        zone: "ADR003 synthetic coastal zone",
        zoneId: I.zone,
        zoneTenantId: tenant,
        zoneSnapshotCapturedAt: at,
        geocodedAt: at,
        geocodeConfidence: "high",
        geocodeSource: "google_maps",
        coastalExposureLevel: "moderate",
        riskResolutionBasis: "zone_exposure",
        persistedProjectRiskClass: "coastal",
        costMultiplier: "1",
        zoneMinFloorPct: String(floor),
        warningCodes: ["geo.coastal_exposure"],
      },
      tenantSettings: {
        settingsId: settings.id,
        settingsUpdatedAt: new Date(settings.updated_at).toISOString(),
        channelOverridePct: null,
        geoOverridePct: null,
      },
      floors: {
        channelBasePct: String(CHANNEL_MIN_MARGIN_PCT.premium),
        geoBasePct: String(floor),
        effectiveFloorPct: String(floor),
        globalWarningPct: String(PROFIT_SHIELD_PCT.GLOBAL_MIN_GP),
        individualWarningPct: String(
          round2(PROFIT_SHIELD_PCT.INDIVIDUAL_WARNING_GP)
        ),
        floorKind: "margin",
      },
    },
    costTypeClassifications: {
      [I.type]: {
        name: "ADR003 synthetic material",
        componentType: "material",
      },
    },
    zoneSnapshot,
  };
  return { rows, manifest };
}
