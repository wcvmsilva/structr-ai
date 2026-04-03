import { seedScopeRules } from "./scope-db";
import { seedCharlestonZones } from "./geo-db";
import { seedRemodelTemplates } from "./remodel-db";
import { createOverrideRule } from "./geo-override-db";
import { COASTAL_OVERRIDE_SEED_RULES } from "../shared/geo-override-seed";
import { ALL_SCOPE_RULES } from "../shared/scope-rules-seed";
import { ALL_REMODEL_TEMPLATES } from "../shared/remodel-templates-seed";

async function main() {
  console.log("🌱 Starting Database Seeding...");

  try {
    const adminUserId = "1"; // Assuming user 1 is admin for seeding
    const adminOpenId = "system_seed";

    console.log("1. Seeding Charleston Geo Zones...");
    const charlestonCount = await seedCharlestonZones(adminUserId);
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
