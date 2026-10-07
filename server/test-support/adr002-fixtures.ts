/** Synthetic local fixture only; never a claim of provider/geocoder or hosted Auth acceptance. */
import { randomUUID } from "node:crypto";
import * as s from "../../drizzle/schema";
import { createEstimateDraftFromCalculator } from "../estimate-db";
import { createProjectGeocodeReviewEvidence } from "../project-geocode-review-evidence";
import type { GeoZoneData } from "../../shared/geo-engine";
import type { Adr002Postgrest } from "./adr002-postgrest";

export type LabIdentity = { id: string; sub: string; session: string; tenant: string };

export async function seedAdr002Identity(lab: Adr002Postgrest, tenant: string, role = "user"): Promise<LabIdentity> {
  const identity = { id: randomUUID(), sub: randomUUID(), session: randomUUID(), tenant };
  await lab.sql`INSERT INTO auth.users(id,aud,role,is_anonymous) VALUES(${identity.sub},'authenticated','authenticated',false)`;
  await lab.sql`INSERT INTO auth.sessions(id,user_id,not_after) VALUES(${identity.session},${identity.sub},now()+interval '30 minutes')`;
  await lab.sql`INSERT INTO public.profiles(id,tenant_id,external_open_id,full_name,role,is_active,login_method)
    VALUES(${identity.id},${tenant},${identity.sub},'Synthetic ADR002 operator',${role},true,'supabase:email')`;
  return identity;
}

export async function seedAdr002Fixture(lab: Adr002Postgrest) {
  const db = lab.cluster.observer.db;
  const tenant = randomUUID(), otherTenant = randomUUID();
  for (const id of [tenant, otherTenant]) {
    await db.insert(s.tenants).values({ id, name: "Synthetic ADR002 tenant", slug: `adr002-${id}`, isActive: true });
  }
  const owner = await seedAdr002Identity(lab, tenant);
  const a1 = await seedAdr002Identity(lab, tenant);
  const a2 = await seedAdr002Identity(lab, tenant);
  const b1 = await seedAdr002Identity(lab, otherTenant, "admin");
  const clientId = randomUUID(), projectId = randomUUID(), zoneId = randomUUID(), assemblyId = randomUUID();
  await db.insert(s.clients).values({ id: clientId, tenantId: tenant, name: "Synthetic ADR002 client", isActive: true });
  const zone: GeoZoneData = {
    id: zoneId, zoneName: "Synthetic coastal zone", county: "Synthetic County", zipCodes: ["00000"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05,
    logisticsModifier: 1, contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
  await db.insert(s.geoZones).values({
    id: zoneId, tenantId: tenant, name: zone.zoneName, zoneName: zone.zoneName,
    isActive: true, coastalExposureLevel: "moderate", costMultiplier: "1.10",
    laborModifier: "1.10", materialModifier: "1.05", logisticsModifier: "1",
    contingencyPct: "5", minProfitShieldPct: "42",
  });
  const at = new Date("2026-09-01T12:00:00.123Z");
  const inputAddress = { address: "1 Synthetic Lane", city: "Synthetic City", state: "SC", zipCode: "00000", county: "Synthetic County" };
  const reviewEvidence = createProjectGeocodeReviewEvidence({
    projectId, tenantId: tenant, inputAddress, geocodedAt: at,
    geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Synthetic Lane, Synthetic City",
      confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null,
      placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
    zoneDetection: { zone, method: "coordinates", confidence: "high" },
  });
  await db.insert(s.projects).values({
    id: projectId, tenantId: tenant, clientId, ownerUserId: owner.id,
    name: "Synthetic ADR002 project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
    address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode,
    county: inputAddress.county, latitude: "32.7500000", longitude: "-79.9000000",
    geocodeConfidence: "high", geocodeSource: "google_maps", geocodedAddress: "1 Synthetic Lane, Synthetic City",
    geocodedAt: at, zone: zone.zoneName,
    zoneModifierSnapshot: { zoneId, zoneName: zone.zoneName, laborModifier: 1.1, materialModifier: 1.05,
      logisticsModifier: 1, contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate",
      capturedAt: at.toISOString(), reviewEvidence },
  });
  await db.insert(s.projectMembers).values([
    { tenantId: tenant, projectId, userId: a1.id, projectRole: "estimator", permissions: [], isActive: true },
    { tenantId: tenant, projectId, userId: a2.id, projectRole: "viewer", permissions: [], isActive: true },
  ]);
  // The existing audited writer forms valid calculated lineage. Its getDb is
  // redirected by the test solely to this supervisor-owned fixture connection.
  const draft = await createEstimateDraftFromCalculator({
    bundleName: "Synthetic ADR002 calculated scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: [{ costGroupName: "Cabinetry & Millwork", costItemName: "Synthetic shelf", description: "Synthetic component",
      quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40,
      lineTotalPrice: 100, assemblyId, costCode: "12-100", taxable: true }],
    assemblySelections: [{ assemblyId, assemblyName: "Synthetic assembly", assemblyCode: "SYN-ADR002", category: "Synthetic",
      quantity: 2, unitCost: 20, unitPrice: 50, extendedCost: 40, extendedPrice: 100 }],
    subtotalCost: "40.00", subtotalPrice: "100.00", grossProfit: "60.00", grossProfitPct: "60",
    finalTotalPrice: "100.00", assemblyCount: 1, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Synthetic original notes", projectId, clientId: null, source: "assembly_calculator", metadata: null,
  }, owner.id, tenant);
  return { tenant, otherTenant, owner, a1, a2, b1, clientId, projectId, zoneId, assemblyId, draft };
}
