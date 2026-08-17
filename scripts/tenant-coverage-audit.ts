/**
 * structr.ai — PHASE 4 tenant coverage audit runner (MT-004)
 *
 * Usage: pnpm audit:tenant
 *
 * Exits non-zero when any blocking finding exists, so the check can gate a release.
 */

import { runTenantCoverageAudit } from "../server/tenant-coverage-audit";

const report = runTenantCoverageAudit({ checkedAt: new Date().toISOString() });

console.log("");
console.log("═".repeat(78));
console.log("  structr.ai — MULTI-TENANT READINESS AUDIT (Phase 4, MT-004)");
console.log("═".repeat(78));
console.log("");
console.log(`  Checked at:            ${report.checkedAt}`);
console.log(`  Tables inspected:      ${report.totals.tablesChecked}`);
console.log(`  Tenant-scoped tables:  ${report.totals.tenantScopedTables}`);
console.log(`  Platform-global:       ${report.totals.globalTables}`);
console.log(`  DB modules inspected:  ${report.totals.dbModulesChecked}`);
console.log(`  Routers inspected:     ${report.totals.routersChecked}`);
console.log("");

const groups: Array<["block" | "warn" | "info", string]> = [
  ["block", "BLOCKING"],
  ["warn", "WARNINGS"],
  ["info", "KNOWN GAPS (tracked)"],
];

for (const [severity, label] of groups) {
  const items = report.findings.filter(f => f.severity === severity);
  if (items.length === 0) continue;
  console.log(`  ${label} (${items.length})`);
  console.log("  " + "-".repeat(74));
  for (const f of items) {
    console.log(`    [${f.category}] ${f.target}`);
    console.log(`        ${f.message}`);
  }
  console.log("");
}

console.log("  " + report.summary);
console.log("");
console.log("═".repeat(78));
console.log("");

process.exit(report.ready ? 0 : 1);
