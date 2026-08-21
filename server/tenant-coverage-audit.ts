/**
 * structr.ai — PHASE 4 Tenant Coverage Audit (MT-004)
 *
 * Contract: docs/phase4-contract.md §5
 *
 * An executable audit of multi-tenant readiness. It answers one question with evidence rather
 * than opinion: **if a second GC were onboarded tomorrow, where would their data leak?**
 *
 * Three checks, all static analysis over the repository itself, so the answer cannot rot:
 *
 *   1. `auditSchemaTenantCoverage` — which business tables carry `tenant_id`, and which do not.
 *   2. `auditQueryTenantScoping` — which `*-db.ts` modules query tenant-scoped tables without
 *      going through `tenant-scope.ts`.
 *   3. `auditRouterTenantContext` — which routers expose data without reading `ctx.tenantId` or
 *      delegating to a guard.
 *
 * The audit is deliberately allowed to report known, accepted gaps (see `ACCEPTED_GLOBAL_TABLES`)
 * rather than pretending the codebase is finished. A truthful list of five gaps is worth more
 * than a green check that hides them: the first is a plan, the second is a surprise during a
 * customer's first month.
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

// ══════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Tables that are legitimately global (platform-level reference data, not customer data).
 * Everything else must be tenant-scoped or it is reported as a finding.
 */
export const ACCEPTED_GLOBAL_TABLES: readonly string[] = [
  "tenants",
  "profiles",
  "sessions",
  "cost_types",
  "units",
  "system_settings",
  "workflow_runs",
  "audit_logs", // legacy pre-tenant trail, kept read-only as history
  "__drizzle_migrations",
] as const;

/**
 * Business tables that MUST be tenant-scoped for the platform to be resellable.
 * Ordered by how much damage a leak would cause.
 */
export const CRITICAL_TENANT_TABLES: readonly string[] = [
  "projects",
  "leads",
  "clients",
  "estimate_drafts",
  "estimate_items",
  "scope_drafts",
  "cost_codes",
  "assemblies",
  "project_cost_actuals",
  "field_tasks",
  "daily_logs",
  "project_closeouts",
  "subcontractors",
  "change_orders",
  "calibration_events",
  "calibration_reports",
  "price_adjustments",
  "scope_completeness_scores",
  "scope_checklist_patterns",
  "tenant_settings",
  "audit_log",
  "analytics_snapshots",
] as const;

export interface CoverageFinding {
  severity: "block" | "warn" | "info";
  category: "schema" | "query" | "router";
  target: string;
  message: string;
}

export interface CoverageReport {
  /** True when no `block` finding exists. */
  ready: boolean;
  checkedAt: string;
  totals: {
    tablesChecked: number;
    tenantScopedTables: number;
    globalTables: number;
    dbModulesChecked: number;
    routersChecked: number;
    blockFindings: number;
    warnFindings: number;
  };
  findings: CoverageFinding[];
  summary: string;
}

function repoRoot(): string {
  // The audit runs from the project root in both dev and test.
  return process.cwd();
}

function readIfExists(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function listFiles(dir: string, suffix: string): string[] {
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith(suffix))
      .sort();
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════
// 1. SCHEMA COVERAGE
// ══════════════════════════════════════════════════════════════════════

export interface SchemaTableInfo {
  table: string;
  exportName: string;
  hasTenantId: boolean;
  isAcceptedGlobal: boolean;
  isCritical: boolean;
}

/**
 * Parse `drizzle/schema.ts` and report tenant coverage per table.
 *
 * Static parsing rather than database introspection on purpose: the audit must run in CI, in a
 * test, and on a laptop with no database, because that is when a missing `tenant_id` is cheap to
 * fix. By the time the table has customer rows in it, it is not.
 */
export function auditSchemaTenantCoverage(
  schemaSource?: string,
): { tables: SchemaTableInfo[]; findings: CoverageFinding[] } {
  const source =
    schemaSource ?? readIfExists(join(repoRoot(), "drizzle", "schema.ts")) ?? "";

  const tables: SchemaTableInfo[] = [];
  const findings: CoverageFinding[] = [];

  // Match: export const foo = pgTable("foo_table", { ... });
  const tableRegex = /export const (\w+) = pgTable\(\s*"([^"]+)"\s*,\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = tableRegex.exec(source)) !== null) {
    const exportName = match[1];
    const table = match[2];
    const bodyStart = match.index + match[0].length;

    // Read forward to the next `export const` (or end of file) and inspect that slice.
    const nextExport = source.indexOf("\nexport const ", bodyStart);
    const body = source.slice(bodyStart, nextExport === -1 ? source.length : nextExport);

    const hasTenantId = /tenantId:\s*uuid\("tenant_id"\)/.test(body);
    const isAcceptedGlobal = ACCEPTED_GLOBAL_TABLES.includes(table);
    const isCritical = CRITICAL_TENANT_TABLES.includes(table);

    tables.push({ table, exportName, hasTenantId, isAcceptedGlobal, isCritical });

    if (!hasTenantId && isCritical) {
      findings.push({
        severity: "block",
        category: "schema",
        target: table,
        message: `Critical business table "${table}" has no tenant_id. A second tenant would read this data.`,
      });
    } else if (!hasTenantId && !isAcceptedGlobal) {
      findings.push({
        severity: "warn",
        category: "schema",
        target: table,
        message: `Table "${table}" has no tenant_id and is not on the accepted-global list. Confirm it holds no customer data.`,
      });
    }
  }

  return { tables, findings };
}

// ══════════════════════════════════════════════════════════════════════
// 2. QUERY SCOPING
// ══════════════════════════════════════════════════════════════════════

/**
 * Modules known to query tenant-scoped tables without tenant filtering.
 *
 * This list is the honest inventory of the Phase 4 baseline: these helpers predate tenant
 * scoping and are called by paths where the tenant is enforced one level up (route guard or
 * project access). They are recorded as `info` so the count cannot silently grow — a new module
 * appearing in the audit output is a regression, an already-listed one is scheduled work.
 */
export const KNOWN_UNSCOPED_MODULES: readonly string[] = [
  // Catalog and price-book helpers: reference data, tenant enforced by the calling router.
  "pricing-db.ts",
  "queries.ts",
  "bundles-db.ts",
  "geo-db.ts",
  "assembly-db.ts",
  // Commercial pipeline modules from Phase 2: tenant enforced by the route guard and by
  // project-access resolvers. Scheduled to move onto tenantWhere() in Phase 5.
  //
  // Graduated — these now scope every query themselves, so a regression must fail the
  // audit as `block` rather than be excused as `info`:
  //   client-db.ts    tenantWhere()/withTenant() on every query and insert
  //   lead-db.ts      leadScopeWhere()/assertLeadInScope() via server/lead-access.ts
  //   pipeline-db.ts  tenantWhere()/tenantFilter() on the reads, assertSameTenant()
  //                   before every conversion write
  "previsit-db.ts",
  "scope-db.ts",
  "scope-review-db.ts",
  "estimate-version-db.ts",
  "field-launch-db.ts",
  "jobtread-export-db.ts",
] as const;

export function auditQueryTenantScoping(
  serverDir?: string,
): { modulesChecked: number; findings: CoverageFinding[] } {
  const dir = serverDir ?? join(repoRoot(), "server");
  const files = listFiles(dir, "-db.ts").concat(
    existsSync(join(dir, "queries.ts")) ? ["queries.ts"] : [],
  );

  const findings: CoverageFinding[] = [];
  let modulesChecked = 0;

  for (const file of files) {
    const source = readIfExists(join(dir, file));
    if (!source) continue;
    modulesChecked += 1;

    // Does the module touch a critical tenant table at all?
    const touchesCritical = CRITICAL_TENANT_TABLES.some(t => {
      const camel = t.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      return source.includes(`from(${camel})`) || source.includes(`into(${camel})`);
    });
    if (!touchesCritical) continue;

    const usesTenantScope =
      source.includes("tenant-scope") ||
      source.includes("tenantWhere") ||
      source.includes("tenantFilter") ||
      source.includes("withTenant") ||
      source.includes("assertSameTenant") ||
      // server/lead-access.ts is a tenant-scoping chokepoint in its own right: its
      // predicates are built on tenantFilter(), so a module that routes its queries
      // through it is scoped even though it never imports tenant-scope directly.
      source.includes("lead-access") ||
      source.includes("leadScopeWhere") ||
      source.includes("assertLeadInScope");

    if (usesTenantScope) continue;

    const known = KNOWN_UNSCOPED_MODULES.includes(file);
    findings.push({
      severity: known ? "info" : "block",
      category: "query",
      target: file,
      message: known
        ? `${file} queries tenant-scoped tables without tenant filtering (known baseline gap; tenant is enforced by the calling guard).`
        : `${file} queries tenant-scoped tables without importing tenant-scope. Add tenantWhere()/withTenant() before this ships.`,
    });
  }

  return { modulesChecked, findings };
}

// ══════════════════════════════════════════════════════════════════════
// 3. ROUTER CONTEXT
// ══════════════════════════════════════════════════════════════════════

/** Routers that legitimately expose no tenant-scoped data. */
export const TENANT_EXEMPT_ROUTERS: readonly string[] = [
  "auth-router.ts",
  "health-router.ts",
  "taxonomy-router.ts",
] as const;

export function auditRouterTenantContext(
  serverDir?: string,
): { routersChecked: number; findings: CoverageFinding[] } {
  const dir = serverDir ?? join(repoRoot(), "server");
  const files = listFiles(dir, "-router.ts");

  const findings: CoverageFinding[] = [];
  let routersChecked = 0;

  for (const file of files) {
    if (TENANT_EXEMPT_ROUTERS.includes(file)) continue;
    const source = readIfExists(join(dir, file));
    if (!source) continue;
    routersChecked += 1;

    const readsTenant =
      source.includes("ctx.tenantId") ||
      source.includes("tenantId: ctx") ||
      source.includes("project-access") ||
      source.includes("requireProjectAccess") ||
      source.includes("requireEntityAccess");

    if (!readsTenant) {
      findings.push({
        severity: "warn",
        category: "router",
        target: file,
        message: `${file} neither reads ctx.tenantId nor delegates to a project-access guard. Verify it exposes no tenant data.`,
      });
    }
  }

  return { routersChecked, findings };
}

// ══════════════════════════════════════════════════════════════════════
// FULL REPORT
// ══════════════════════════════════════════════════════════════════════

/**
 * Run the full multi-tenant readiness audit.
 *
 * `ready` is false while any `block` finding exists. It is intended to be asserted in CI: the
 * moment someone adds a business table without `tenant_id`, the build should say so.
 */
export function runTenantCoverageAudit(options: {
  checkedAt: string;
  schemaSource?: string;
  serverDir?: string;
} = { checkedAt: new Date().toISOString() }): CoverageReport {
  const schema = auditSchemaTenantCoverage(options.schemaSource);
  const queries = auditQueryTenantScoping(options.serverDir);
  const routers = auditRouterTenantContext(options.serverDir);

  const findings = [...schema.findings, ...queries.findings, ...routers.findings];
  const blockFindings = findings.filter(f => f.severity === "block").length;
  const warnFindings = findings.filter(f => f.severity === "warn").length;

  const tenantScopedTables = schema.tables.filter(t => t.hasTenantId).length;
  const globalTables = schema.tables.length - tenantScopedTables;

  const criticalMissing = schema.tables.filter(t => t.isCritical && !t.hasTenantId);

  const summary = blockFindings
    ? `NOT READY for a second tenant: ${blockFindings} blocking finding(s). ` +
      (criticalMissing.length
        ? `Critical tables without tenant_id: ${criticalMissing.map(t => t.table).join(", ")}.`
        : "See findings for unscoped query modules.")
    : `Multi-tenant ready: ${tenantScopedTables} of ${schema.tables.length} tables are tenant-scoped, ` +
      `${globalTables} are platform-global. ${warnFindings} warning(s) to review, ` +
      `${findings.filter(f => f.severity === "info").length} known baseline gap(s) tracked.`;

  return {
    ready: blockFindings === 0,
    checkedAt: options.checkedAt,
    totals: {
      tablesChecked: schema.tables.length,
      tenantScopedTables,
      globalTables,
      dbModulesChecked: queries.modulesChecked,
      routersChecked: routers.routersChecked,
      blockFindings,
      warnFindings,
    },
    findings,
    summary,
  };
}
