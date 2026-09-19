/** Offline review preparation only: no database, network, classifier or migration execution. */
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const uuid = z.uuid().transform(value => value.toLowerCase());
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const base = { id: uuid, rowSha256: digest };
function table<T extends z.ZodType>(row: T) {
  return z.strictObject({ observed: z.boolean(), rows: z.array(row) })
    .refine(value => value.observed || value.rows.length === 0);
}
const snapshotSchema = z.strictObject({
  version: z.literal(1), observedAt: z.iso.datetime(),
  consistency: z.literal("single_statement"), scope: z.literal("collector_visible_rows"),
  rowHashAlgorithm: z.literal("postgres_jsonb_text_sha256"),
  tables: z.strictObject({
    tenants: table(z.strictObject(base)),
    assemblies: table(z.strictObject({ ...base, tenantStamp: uuid.nullable(), defaultUnitId: uuid.nullable() })),
    cost_codes: table(z.strictObject({ ...base, tenantStamp: uuid.nullable(), parentId: uuid.nullable(), defaultCostTypeId: uuid.nullable(), defaultUnitId: uuid.nullable() })),
    cost_types: table(z.strictObject({ ...base, isTaxable: z.boolean(), taxable: z.boolean().nullable(), isTimeTrackable: z.boolean(), timeTrackable: z.boolean().nullable() })),
    units: table(z.strictObject(base)),
    assembly_items: table(z.strictObject({ ...base, assemblyId: uuid, costCodeId: uuid, costTypeId: uuid, unitId: uuid, priceBookItemReference: uuid.nullable() })),
    cost_code_pricing_history: table(z.strictObject({ ...base, costCodeId: uuid, unitId: uuid.nullable() })),
    crew_velocity: table(z.strictObject({ ...base, costCodeId: uuid, unitId: uuid })),
  }),
});
type Snapshot = z.infer<typeof snapshotSchema>;
const labelsSchema = z.strictObject({
  version: z.literal(1), observedAt: z.iso.datetime(),
  rows: z.array(z.strictObject({ ...base, label: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]*$/) })),
});

/** Optional names make the private review usable; matching a name NEVER decides ownership or settings. */
export function buildCostTypeOwnerReview(input: unknown, labelsInput: unknown) {
  buildCatalogOwnershipReadiness(input); // Validate the complete metadata envelope and unique row identities first.
  const snapshot = snapshotSchema.parse(input);
  const parsedLabels = labelsSchema.safeParse(labelsInput);
  const invalid = () => { throw new Error("Cost type labels do not match the catalog review snapshot"); };
  if (!parsedLabels.success || !snapshot.tables.cost_types.observed) return invalid();
  const labels = parsedLabels.data;
  const conflicted = snapshot.tables.cost_types.rows.filter(row => row.taxable !== row.isTaxable || row.timeTrackable !== row.isTimeTrackable)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Date(labels.observedAt).getTime() < new Date(snapshot.observedAt).getTime()
    || labels.rows.length !== conflicted.length || new Set(labels.rows.map(row => row.id)).size !== labels.rows.length) return invalid();
  const labelsById = new Map(labels.rows.map(row => [row.id, row]));
  return conflicted.map(row => {
    const label = labelsById.get(row.id);
    if (!label || label.rowSha256 !== row.rowSha256) return invalid();
    const conflicts: Array<{ fieldA: string; valueA: boolean; fieldB: string; valueB: boolean | null;
      question: string; authorizedValue: null; sourceEvidenceReference: null }> = [];
    if (row.isTaxable !== row.taxable) conflicts.push({ fieldA: "isTaxable", valueA: row.isTaxable,
      fieldB: "taxable", valueB: row.taxable, question: "Should this cost type be marked taxable?", authorizedValue: null, sourceEvidenceReference: null });
    if (row.isTimeTrackable !== row.timeTrackable) conflicts.push({ fieldA: "isTimeTrackable", valueA: row.isTimeTrackable,
      fieldB: "timeTrackable", valueB: row.timeTrackable, question: "Should this cost type track time?", authorizedValue: null, sourceEvidenceReference: null });
    return { rowId: row.id, rowSha256: row.rowSha256, label: label.label, conflicts,
      reviewer: null, status: "pending_owner_review", mutationAllowed: false };
  });
}
type TableName = keyof Snapshot["tables"];
const tables = ["tenants", "assemblies", "cost_codes", "cost_types", "units", "assembly_items", "cost_code_pricing_history", "crew_velocity"] as const;
const catalogTables: readonly TableName[] = ["assemblies", "cost_codes", "cost_types", "units"];
const evidence = "exact_id_and_full_row_hash_with_verified_source_or_audited_attestation";
type Finding = { code: string; table: TableName; rowId?: string; field?: string; targetTable?: TableName; targetId?: string };
type Relationship = { sourceTable: TableName; sourceId: string; field: string; targetTable: TableName; targetId: string | null;
  status: "null_reference" | "target_observed" | "target_not_in_snapshot" | "target_table_unobserved" };
const edges: Partial<Record<TableName, Array<[string, TableName]>>> = {
  assemblies: [["tenantStamp", "tenants"], ["defaultUnitId", "units"]],
  cost_codes: [["tenantStamp", "tenants"], ["parentId", "cost_codes"], ["defaultCostTypeId", "cost_types"], ["defaultUnitId", "units"]],
  assembly_items: [["assemblyId", "assemblies"], ["costCodeId", "cost_codes"], ["costTypeId", "cost_types"], ["unitId", "units"]],
  cost_code_pricing_history: [["costCodeId", "cost_codes"], ["unitId", "units"]],
  crew_velocity: [["costCodeId", "cost_codes"], ["unitId", "units"]],
};

/** Whole-row hashes are supplied by the collector, not independently authenticated here. */
export function buildCatalogOwnershipReadiness(input: unknown) {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid catalog metadata snapshot");
  const snapshot = parsed.data;
  for (const name of tables) {
    const rows = snapshot.tables[name].rows;
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Invalid catalog metadata snapshot");
    rows.sort((a, b) => a.id.localeCompare(b.id));
  }
  const snapshotSha256 = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const ids = new Map(tables.map(name => [name, new Set(snapshot.tables[name].rows.map(row => row.id))]));
  const relationships: Relationship[] = [];
  const findings: Finding[] = [];
  for (const name of tables) {
    if (!snapshot.tables[name].observed) findings.push({ code: "TABLE_NOT_OBSERVED", table: name });
    for (const row of snapshot.tables[name].rows) {
      for (const [field, targetTable] of edges[name] ?? []) {
        const targetId = (row as Record<string, unknown>)[field] as string | null;
        const status: Relationship["status"] = targetId === null ? "null_reference"
          : !snapshot.tables[targetTable].observed ? "target_table_unobserved"
          : ids.get(targetTable)!.has(targetId) ? "target_observed" : "target_not_in_snapshot";
        relationships.push({ sourceTable: name, sourceId: row.id, field, targetTable, targetId, status });
        if (status === "target_not_in_snapshot") findings.push({ code: "REFERENCE_TARGET_NOT_IN_SNAPSHOT", table: name, rowId: row.id, field, targetTable, targetId: targetId! });
      }
    }
  }
  for (const row of snapshot.tables.cost_types.rows) {
    for (const [field, original] of [["taxable", "isTaxable"], ["timeTrackable", "isTimeTrackable"]] as const) {
      if (row[field] !== row[original]) findings.push({ code: "COMMERCIAL_BOOLEAN_RECONCILIATION_REQUIRED", table: "cost_types", rowId: row.id, field });
    }
  }
  for (const row of snapshot.tables.cost_code_pricing_history.rows) {
    if (row.unitId === null) findings.push({ code: "PRICE_UNIT_EVIDENCE_REQUIRED", table: "cost_code_pricing_history", rowId: row.id, field: "unitId" });
  }
  const assemblies = new Map(snapshot.tables.assemblies.rows.map(row => [row.id, row]));
  const codes = new Map(snapshot.tables.cost_codes.rows.map(row => [row.id, row]));
  for (const row of snapshot.tables.assembly_items.rows) {
    const assemblyStamp = assemblies.get(row.assemblyId)?.tenantStamp;
    const codeStamp = codes.get(row.costCodeId)?.tenantStamp;
    if (assemblyStamp && codeStamp && assemblyStamp !== codeStamp) findings.push({ code: "LINKED_TENANT_STAMPS_DIFFER", table: "assembly_items", rowId: row.id });
    if (row.priceBookItemReference !== null) findings.push({ code: "LEGACY_PRICE_BOOK_REFERENCE_UNRESOLVED", table: "assembly_items", rowId: row.id, field: "priceBookItemReference" });
  }
  for (const row of snapshot.tables.cost_codes.rows) {
    const parentStamp = row.parentId ? codes.get(row.parentId)?.tenantStamp : null;
    if (row.tenantStamp && parentStamp && row.tenantStamp !== parentStamp) findings.push({ code: "LINKED_TENANT_STAMPS_DIFFER", table: "cost_codes", rowId: row.id, field: "parentId" });
  }
  const reviewRows = tables.filter(name => name !== "tenants").flatMap(name => snapshot.tables[name].rows.map(row => ({
    table: name, rowId: row.id, rowSha256: row.rowSha256,
    kind: catalogTables.includes(name) ? "catalog_definition" : "dependent_record",
    provisionalDisposition: catalogTables.includes(name) ? "unclassified" : "unresolved_dependent_contract",
    provenanceAssessment: "not_assessed_from_metadata",
    assignedTenantId: null,
    tenantStamp: "tenantStamp" in row ? row.tenantStamp : null,
    metadata: row,
    requiredEvidence: catalogTables.includes(name) ? [evidence]
      : ["verified_source_and_approved_parent_ownership_and_exact_relationships"],
    findingCodes: findings.filter(finding => finding.table === name && finding.rowId === row.id).map(finding => finding.code),
  })));
  const findingCounts: Record<string, number> = {};
  for (const finding of findings) findingCounts[finding.code] = (findingCounts[finding.code] ?? 0) + 1;
  return {
    summary: {
      version: 1, observedAt: snapshot.observedAt, snapshotSha256,
      tableCounts: Object.fromEntries(tables.map(name => [name, snapshot.tables[name].observed ? snapshot.tables[name].rows.length : null])),
      unobservedTables: tables.filter(name => !snapshot.tables[name].observed),
      catalogRows: reviewRows.filter(row => row.kind === "catalog_definition").length,
      dependentRows: reviewRows.filter(row => row.kind === "dependent_record").length,
      observedReferenceCount: relationships.filter(row => row.status === "target_observed").length,
      findingCounts,
      platformCanonicalAssignments: 0, tenantOwnershipAssignments: 0,
      ownershipEvidenceVerified: false, collectorVisibilityVerified: false,
      fullDependencyGraphCovered: false, quarantineEnforcedInDatabase: false,
      databaseMutationPerformed: false, readyForCutover: false,
      limitations: [
        "Only collector-visible rows in these eight tables are covered; missing targets are not proven database orphans.",
        "Collection time, single-statement consistency and full-row hashes are collector assertions, not independently authenticated offline.",
        "Origin evidence has not been assessed; missing metadata evidence does not mean the source is unknown or nonexistent.",
        "Tenant stamps and matching UUID links are structural facts only. They never assign ownership or canonical status.",
        "Unclassified is a review disposition only; this tool does not enforce quarantine or implement the G4b ledger/cutover.",
        "This is not the complete dependency graph, a migration manifest, an approved post-state or release approval.",
      ],
    },
    reviewRows, relationships, findings,
  };
}

function readSnapshot(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("Invalid file");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}

/** stdout is aggregate-only. Detailed packets are exclusive 0600 files in this repo's ignored tmp tree. */
export function runCatalogOwnershipReadinessCli(args: string[]): number {
  try {
    if (![2, 4, 6].includes(args.length) || args[0] !== "--snapshot"
      || (args.length >= 4 && args[2] !== "--private-packet")
      || (args.length === 6 && args[4] !== "--cost-type-labels")) throw new Error("Invalid arguments");
    const snapshot = readSnapshot(resolve(args[1]));
    const report = { ...buildCatalogOwnershipReadiness(snapshot),
      ...(args.length === 6 ? { ownerReview: buildCostTypeOwnerReview(snapshot, readSnapshot(resolve(args[5]))) } : {}) };
    if (args.length >= 4) {
      const root = realpathSync(fileURLToPath(new URL("../tmp", import.meta.url)));
      const requested = resolve(args[3]);
      const target = join(realpathSync(dirname(requested)), requested.slice(dirname(requested).length + 1));
      const child = relative(root, target);
      if (!child || child === ".." || child.startsWith("../") || isAbsolute(child)) throw new Error("Nonprivate output");
      writeFileSync(target, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    }
    console.log(JSON.stringify(report.summary, null, 2));
    return 1; // Successfully prepared review input; unresolved ownership NEVER yields a readiness success.
  } catch {
    console.error("Catalog review input rejected. Expected sanitized v1 metadata; private output must be a new file under repository tmp. No database was contacted.");
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCatalogOwnershipReadinessCli(process.argv.slice(2));
}
