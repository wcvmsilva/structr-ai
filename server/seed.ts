import { seedScopeRules } from "./scope-db";
import { seedCharlestonZones } from "./geo-db";
import { seedRemodelTemplates } from "./remodel-db";
import { createOverrideRule } from "./geo-override-db";
import { COASTAL_OVERRIDE_SEED_RULES } from "../shared/geo-override-seed";
import { ALL_SCOPE_RULES } from "../shared/scope-rules-seed";
import { ALL_REMODEL_TEMPLATES } from "../shared/remodel-templates-seed";

/**
 * G3a-1 — geo zones are TENANT-OWNED commercial policy, so the bootstrap seed must be told
 * WHICH tenant it is seeding. It is not allowed to guess.
 *
 * Previously `seedCharlestonZones()` took no tenant, wrote `tenant_id = NULL` rows, and
 * used a global zone-name check — so the seed manufactured unowned commercial policy and,
 * once GCHI existed, silently created nothing for anybody else.
 *
 * `SEED_TENANT_ID` is an APPROVED operational contract for this bootstrap path. It was
 * introduced rather than reused because the repository had no pre-existing explicit tenant
 * contract for headless seeding: `DEV_TENANT_ID` is documented in .env.example as the
 * dev-auth caller tenant, not a seed target, and `pnpm seed` is not dev-only — reusing it
 * would couple bootstrap data ownership to an auth bypass knob.
 *
 * The seed fails loudly rather than inferring the default (GCHI) tenant. Inferring it is
 * exactly the NULL-ownership inference this program forbids (ADR-001 Invariant 7).
 *
 * Scope: this contract covers server/seed.ts only. scripts/seed-geo-zones.mjs is a separate
 * operational path and remains G3a-3 work.
 */
function requireSeedTenantId(): string {
  const tenantId = process.env.SEED_TENANT_ID?.trim();
  if (!tenantId) {
    console.error(
      "❌ SEED_TENANT_ID is not set.\n" +
        "   Geo zones are tenant-owned commercial policy (modifiers, contingency, profit\n" +
        "   floor), so the seed must be told which tenant owns what it creates. It will not\n" +
        "   guess, and it will not fall back to the default tenant.\n" +
        "   Set SEED_TENANT_ID to an existing tenants.id (a plain UUID) and re-run.",
    );
    process.exit(1);
  }
  return tenantId;
}

async function main() {
  console.log("🌱 Starting Database Seeding...");

  try {
    const adminUserId = "1"; // Assuming user 1 is admin for seeding
    const adminOpenId = "system_seed";
    const seedTenantId = requireSeedTenantId();

    console.log(`1. Seeding Charleston Geo Zones into tenant ${seedTenantId}...`);
    const charlestonCount = await seedCharlestonZones(seedTenantId, adminUserId);
    console.log(`   ✅ Seeded ${charlestonCount} Charleston zones`);

    console.log("2. Seeding Scope Rules...");
    const rulesCount = await seedScopeRules(ALL_SCOPE_RULES as any[], adminUserId);
    console.log(`   ✅ Seeded ${rulesCount} scope rules`);

    console.log("3. Seeding Remodel Templates...");
    const templates = ALL_REMODEL_TEMPLATES.map(t => ({
      ...t,
      components: (t as any).components,
    })) as any[];
    const templateIds: any = await seedRemodelTemplates(templates, adminUserId);
    console.log(`   ✅ Seeded ${templateIds.created + templateIds.updated} remodel templates`);

    console.log("4. Seeding Coastal Overrides...");
    const existingCoastal = await import("./geo-override-db").then(m => 
      m.listOverrideRules({ activeOnly: false })
    );
    if (existingCoastal.length === 0) {
      let overrideCount = 0;
      for (const rule of COASTAL_OVERRIDE_SEED_RULES) {
        await createOverrideRule(
          {
            zone: rule.zone,
            trade: rule.trade,
            finishLevel: rule.finishLevel,
            originalAssemblyId: rule.originalAssemblyId,
            replacementAssemblyId: rule.replacementAssemblyId,
            overrideType: rule.overrideType,
            reasonTemplate: rule.reasonTemplate,
            isActive: rule.active,
          },
          adminOpenId
        );
        overrideCount++;
      }
      console.log(`   ✅ Seeded ${overrideCount} coastal overrides`);
    } else {
      console.log(`   ⚠️ Skipped coastal overrides (already has ${existingCoastal.length} rules)`);
    }

    console.log("✨ Seeding Complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

main();
