/**
 * structr.ai — PHASE 4 Demo Tenant Seed
 *
 * Usage: pnpm seed:demo
 *
 * Creates the smallest honest multi-tenant fixture: one coastal GC tenant with its own settings,
 * feature flags and onboarding state. It deliberately does NOT manufacture a price book or mark
 * onboarding as complete. A demo that can price work before its cost codes and margin floors are
 * verified would demonstrate the exact failure Phase 4 is meant to prevent.
 *
 * Idempotency:
 *   - existing `demo-coastal-gc` tenant → no business data overwritten;
 *   - missing `tenant_settings` on that tenant → default governed settings created;
 *   - new tenant → provisioned through the same service production uses.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { tenants } from "../drizzle/schema";
import {
  getOrCreateTenantSettings,
  getOnboardingProgress,
  provisionTenant,
} from "../server/tenant-settings-db";

const DEMO_SLUG = "demo-coastal-gc";
const SYSTEM_SEED_ACTOR_ID = "00000000-0000-0000-0000-000000000004";

async function main(): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error(
      "DATABASE_URL is required for pnpm seed:demo. The demo tenant is database fixture data, not an in-memory mock.",
    );
  }

  const [existing] = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      onboardingStatus: tenants.onboardingStatus,
      isDemo: tenants.isDemo,
    })
    .from(tenants)
    .where(eq(tenants.slug, DEMO_SLUG))
    .limit(1);

  let tenantId: string;
  let created = false;

  if (existing) {
    tenantId = existing.id;
    await getOrCreateTenantSettings({ tenantId, actorId: SYSTEM_SEED_ACTOR_ID });
    console.log(`[Phase 4 seed] Demo tenant already exists: ${existing.name} (${tenantId}).`);
  } else {
    const result = await provisionTenant({
      name: "Demo Coastal GC",
      slug: DEMO_SLUG,
      legalName: "Demo Coastal GC, LLC",
      geoRegion: "charleston_sc",
      defaultGeoRiskClass: "coastal",
      defaultCommercialChannel: "premium",
      // Undefined intentionally uses the governed default feature set and dependency closure.
      requestedFlags: null,
      isDemo: true,
      actorId: SYSTEM_SEED_ACTOR_ID,
    });
    tenantId = result.tenantId;
    created = true;
    console.log(`[Phase 4 seed] Created demo tenant ${DEMO_SLUG} (${tenantId}).`);
  }

  const onboarding = await getOnboardingProgress(tenantId);

  console.log("[Phase 4 seed] Tenant fixture is ready.");
  console.log(
    `[Phase 4 seed] onboarding=${onboarding.status}; canOperate=${onboarding.canOperate}; ` +
      `next=${onboarding.nextStep ?? "none"}.`,
  );
  console.log(
    "[Phase 4 seed] Intentional state: no production price book, no fabricated actuals, and no auto-applied pricing. " +
      "Complete onboarding in the app before using the tenant for commercial estimates.",
  );

  if (!created) {
    console.log("[Phase 4 seed] Idempotent re-run completed; existing tenant configuration was not overwritten.");
  }
}

main().catch(error => {
  console.error("[Phase 4 seed] Failed:", error);
  process.exitCode = 1;
});
