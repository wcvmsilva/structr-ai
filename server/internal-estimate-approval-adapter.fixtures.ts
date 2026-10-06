/** Entirely synthetic persisted-row fixtures. Unused nullable columns are explicit null. */
import { getTableColumns } from "drizzle-orm";
import {
  estimateDrafts,
  projects,
  clients,
  tenants,
  profiles,
  geoZones,
  tenantSettings,
  scopeDrafts,
} from "../drizzle/schema";
import type { InternalApprovalRows } from "./internal-estimate-approval-adapter";
import { approvalIds as id } from "./internal-estimate-approval-engine.fixtures";
const at = new Date("2026-09-01T12:00:00.000Z");
function empty(table: Parameters<typeof getTableColumns>[0]) {
  return Object.fromEntries(
    Object.keys(getTableColumns(table)).map(key => [key, null])
  );
}
export const approvalContext = {
  tenantId: id.tenant,
  actorId: id.actor,
  confirmedCurrencyCode: "USD" as const,
};
export function approvalRows(): InternalApprovalRows {
  const at = new Date("2026-09-01T12:00:00.000Z");
  const inputAddress = {
    address: "1 Synthetic Lane",
    city: "Synthetic City",
    state: "SC",
    zipCode: "00000",
    county: "Synthetic County",
  };
  return {
    draft: {
      ...empty(estimateDrafts),
      id: id.draft,
      tenantId: id.tenant,
      projectId: id.project,
      clientId: id.client,
      createdBy: id.actor,
      status: "draft",
      source: "assembly_calculator",
      version: 1,
      createdAt: at,
      updatedAt: at,
      pricingSchemaVersion: "1.0",
      channel: "direct",
      bundleName: "Synthetic assembly",
      notes: "Reviewed notes",
      subtotalPrice: "100.00",
      subtotalCost: "40.00",
      finalTotalPrice: "100.00",
      discountAmount: "0.00",
      discountApplied: false,
      assemblyCount: 1,
      lineItems: [
        {
          costGroupName: "Cabinetry & Millwork",
          costItemName: "Synthetic shelf",
          description: "Synthetic component",
          quantity: 2,
          unit: "EA",
          unitCostSnapshot: "20.00",
          unitPriceSnapshot: 50,
          lineTotalCost: 40,
          lineTotalPrice: 100,
          assemblyId: id.assembly,
          costCode: "12-100",
          taxable: true,
        },
      ],
      assemblySelections: [
        {
          assemblyId: id.assembly,
          assemblyName: "Synthetic assembly",
          assemblyCode: "SYN-1",
          category: "Synthetic",
          quantity: 2,
          unitCost: 20,
          unitPrice: 50,
          extendedCost: 40,
          extendedPrice: 100,
        },
      ],
    },
    project: {
      ...empty(projects),
      id: id.project,
      tenantId: id.tenant,
      clientId: id.client,
      name: "Synthetic project",
      channel: "premium",
      geoRiskClass: "coastal",
      address: inputAddress.address,
      city: inputAddress.city,
      state: inputAddress.state,
      zip: inputAddress.zipCode,
      county: inputAddress.county,
      latitude: "32.7500000",
      longitude: "-79.9000000",
      geocodeConfidence: "high",
      geocodeSource: "google_maps",
      geocodedAddress: "1 Synthetic Lane, Synthetic City",
      geocodedAt: at,
      zone: "Synthetic coastal zone",
      createdAt: at,
      updatedAt: at,
      zoneModifierSnapshot: {
        zoneId: id.zone,
        zoneName: "Synthetic coastal zone",
        laborModifier: 1.1,
        materialModifier: 1.05,
        logisticsModifier: 1,
        contingencyPct: 5,
        minProfitShieldPct: 42,
        coastalExposureLevel: "moderate",
        capturedAt: at.toISOString(),
        reviewEvidence: {
          version: "project-geocode-review-v1",
          projectId: id.project,
          tenantId: id.tenant,
          inputAddress,
          geocodedAt: at.toISOString(),
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
            zoneId: id.zone,
            method: "coordinates",
            confidence: "high",
          },
        },
      },
    },
    client: {
      ...empty(clients),
      id: id.client,
      tenantId: id.tenant,
      isActive: true,
      createdAt: at,
      updatedAt: at,
    },
    tenant: {
      ...empty(tenants),
      id: id.tenant,
      isActive: true,
      createdAt: at,
      updatedAt: at,
    },
    profile: {
      ...empty(profiles),
      id: id.actor,
      tenantId: id.tenant,
      isActive: true,
      createdAt: at,
      updatedAt: at,
    },
    zone: {
      ...empty(geoZones),
      id: id.zone,
      tenantId: id.tenant,
      isActive: true,
      name: "Synthetic coastal zone",
      zoneName: "Synthetic coastal zone",
      costMultiplier: "1.10",
      laborModifier: "1.10",
      materialModifier: "1.05",
      logisticsModifier: "1",
      contingencyPct: "5",
      minProfitShieldPct: "42",
      coastalExposureLevel: "moderate",
      createdAt: at,
      updatedAt: at,
    },
    settings: null,
    scopeDraft: null,
  } as InternalApprovalRows;
}
export function approvalSettings() {
  return {
    ...empty(tenantSettings),
    id: id.settings,
    tenantId: id.tenant,
    updatedAt: at,
    createdAt: at,
    profitShieldOverrides: {},
    geoFloorOverrides: {},
  } as NonNullable<InternalApprovalRows["settings"]>;
}
export function approvalScope() {
  return {
    ...empty(scopeDrafts),
    id: "a1000000-0000-4000-8000-000000000099",
    tenantId: id.tenant,
    projectId: id.project,
  } as NonNullable<InternalApprovalRows["scopeDraft"]>;
}
