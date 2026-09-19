import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalogOwnershipReadiness, buildCostTypeOwnerReview, runCatalogOwnershipReadinessCli } from "../scripts/catalog-ownership-readiness";

const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const row = (n: number) => ({ id: id(n), rowSha256: n.toString(16).padStart(64, "0") });
const observed = <T,>(rows: T[]) => ({ observed: true, rows });
function snapshot(): any {
  return {
    version: 1, observedAt: "2026-09-19T14:00:00.000Z", consistency: "single_statement",
    scope: "collector_visible_rows", rowHashAlgorithm: "postgres_jsonb_text_sha256",
    tables: {
      tenants: observed([row(1)]),
      assemblies: observed([{ ...row(2), tenantStamp: id(1), defaultUnitId: id(5) }]),
      cost_codes: observed([{ ...row(3), tenantStamp: id(1), parentId: null, defaultCostTypeId: id(4), defaultUnitId: id(5) }]),
      cost_types: observed([{ ...row(4), isTaxable: false, taxable: false, isTimeTrackable: true, timeTrackable: true }]),
      units: observed([row(5)]),
      assembly_items: observed([{ ...row(6), assemblyId: id(2), costCodeId: id(3), costTypeId: id(4), unitId: id(5), priceBookItemReference: null }]),
      cost_code_pricing_history: observed([{ ...row(7), costCodeId: id(3), unitId: id(5) }]),
      crew_velocity: observed([{ ...row(8), costCodeId: id(3), unitId: id(5) }]),
    },
  };
}
const roots: string[] = [];
const repo = fileURLToPath(new URL("../", import.meta.url));
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("catalog ownership review input, never ownership authority", () => {
  it("resolves only exact references and leaves all four legacy definitions unclassified", () => {
    const result = buildCatalogOwnershipReadiness(snapshot());
    expect(result.summary).toMatchObject({ catalogRows: 4, platformCanonicalAssignments: 0, tenantOwnershipAssignments: 0, readyForCutover: false, databaseMutationPerformed: false });
    expect(result.reviewRows.filter((r: any) => r.kind === "catalog_definition")).toHaveLength(4);
    expect(result.reviewRows.every((r: any) => r.provenanceAssessment === "not_assessed_from_metadata")).toBe(true);
    expect(result.reviewRows.filter((r: any) => r.kind === "catalog_definition").every((r: any) => r.provisionalDisposition === "unclassified")).toBe(true);
    expect(result.relationships.filter((r: any) => r.status === "target_observed")).toHaveLength(13);
    expect(result.summary.findingCounts).toEqual({});
  });
  it.each([null, id(1)])("does not promote a null/stamped tenant value (%s) into provenance", stamp => {
    const input = snapshot(); input.tables.assemblies.rows[0].tenantStamp = stamp;
    const result = buildCatalogOwnershipReadiness(input);
    expect(result.reviewRows.find((r: any) => r.table === "assemblies")).toMatchObject({ assignedTenantId: null, provisionalDisposition: "unclassified", tenantStamp: stamp });
    expect(result.summary.ownershipEvidenceVerified).toBe(false);
  });
  it("does not invent tenant ownership for children even with two linked stamped parents", () => {
    const result = buildCatalogOwnershipReadiness(snapshot());
    expect(result.reviewRows.find((r: any) => r.table === "assembly_items")).toMatchObject({ assignedTenantId: null, provisionalDisposition: "unresolved_dependent_contract" });
    expect(result.reviewRows.find((r: any) => r.table === "crew_velocity")).toMatchObject({ provisionalDisposition: "unresolved_dependent_contract" });
  });
  it("retains the original row hash and distinguishes metadata from evidence of origin", () => {
    const result = buildCatalogOwnershipReadiness(snapshot());
    expect(result.reviewRows.find((r: any) => r.table === "units")).toMatchObject({ rowSha256: row(5).rowSha256, requiredEvidence: ["exact_id_and_full_row_hash_with_verified_source_or_audited_attestation"] });
    expect(result.summary.collectorVisibilityVerified).toBe(false);
    expect(result.summary.fullDependencyGraphCovered).toBe(false);
    expect(result.summary.quarantineEnforcedInDatabase).toBe(false);
  });
  it.each([
    ["assemblies", "defaultUnitId", "units"], ["cost_codes", "parentId", "cost_codes"],
    ["cost_codes", "defaultCostTypeId", "cost_types"], ["cost_codes", "defaultUnitId", "units"],
    ["assembly_items", "assemblyId", "assemblies"], ["assembly_items", "costCodeId", "cost_codes"],
    ["assembly_items", "costTypeId", "cost_types"], ["assembly_items", "unitId", "units"],
    ["cost_code_pricing_history", "costCodeId", "cost_codes"], ["cost_code_pricing_history", "unitId", "units"],
    ["crew_velocity", "costCodeId", "cost_codes"], ["crew_velocity", "unitId", "units"],
    ["assemblies", "tenantStamp", "tenants"], ["cost_codes", "tenantStamp", "tenants"],
  ])("reports an exact missing target for %s.%s without guessing", (table, field, targetTable) => {
    const input = snapshot(); input.tables[table].rows[0][field] = id(99);
    const result = buildCatalogOwnershipReadiness(input);
    expect(result.relationships).toContainEqual(expect.objectContaining({ sourceTable: table, field, targetTable, targetId: id(99), status: "target_not_in_snapshot" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "REFERENCE_TARGET_NOT_IN_SNAPSHOT", table, rowId: input.tables[table].rows[0].id, field }));
  });
  it("distinguishes an unobserved table from an observed empty table", () => {
    const input = snapshot(); input.tables.units = { observed: false, rows: [] };
    const result = buildCatalogOwnershipReadiness(input);
    expect(result.summary.unobservedTables).toEqual(["units"]);
    expect(result.relationships.filter((r: any) => r.targetTable === "units").every((r: any) => r.status === "target_table_unobserved")).toBe(true);
    expect(result.findings.some((r: any) => r.code === "REFERENCE_TARGET_NOT_IN_SNAPSHOT" && r.targetTable === "units")).toBe(false);
  });
  it("never fills a missing price unit from the cost code default", () => {
    const input = snapshot(); input.tables.cost_code_pricing_history.rows[0].unitId = null;
    const result = buildCatalogOwnershipReadiness(input);
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "PRICE_UNIT_EVIDENCE_REQUIRED", table: "cost_code_pricing_history", rowId: id(7) }));
    expect(result.relationships).toContainEqual(expect.objectContaining({ sourceId: id(7), field: "unitId", targetId: null, status: "null_reference" }));
  });
  it.each([["taxable", true], ["taxable", null], ["timeTrackable", false], ["timeTrackable", null]])("requires explicit reconciliation of %s=%s", (field, value) => {
    const input = snapshot(); input.tables.cost_types.rows[0][field] = value;
    const result = buildCatalogOwnershipReadiness(input);
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "COMMERCIAL_BOOLEAN_RECONCILIATION_REQUIRED", field }));
  });
  it("reports cross-stamp references without calling either stamp the owner", () => {
    const input = snapshot(); input.tables.tenants.rows.push(row(9)); input.tables.cost_codes.rows[0].tenantStamp = id(9);
    const result = buildCatalogOwnershipReadiness(input);
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "LINKED_TENANT_STAMPS_DIFFER", table: "assembly_items", rowId: id(6) }));
    expect(result.summary.tenantOwnershipAssignments).toBe(0);
  });
  it("does not reinterpret legacy priceBookItem UUID as code/pricing identity", () => {
    const input = snapshot(); input.tables.assembly_items.rows[0].priceBookItemReference = id(3);
    const result = buildCatalogOwnershipReadiness(input);
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "LEGACY_PRICE_BOOK_REFERENCE_UNRESOLVED", rowId: id(6) }));
    expect(result.relationships.some((r: any) => r.field === "priceBookItemReference")).toBe(false);
  });
  it("produces deterministic private packet identities regardless of row array order", () => {
    const input = snapshot(); input.tables.units.rows.push(row(10));
    const first = buildCatalogOwnershipReadiness(input);
    input.tables.units.rows.reverse();
    expect(buildCatalogOwnershipReadiness(input)).toEqual(first);
    input.tables.units.rows[0].rowSha256 = "f".repeat(64);
    expect(buildCatalogOwnershipReadiness(input).summary.snapshotSha256).not.toBe(first.summary.snapshotSha256);
  });
  it.each([
    ["version", (s: any) => { s.version = 2; }],
    ["raw customer content", (s: any) => { s.tables.assemblies.rows[0].name = "SECRET_CUSTOMER"; }],
    ["missing table", (s: any) => { delete s.tables.crew_velocity; }],
    ["unknown table", (s: any) => { s.tables.clients = observed([]); }],
    ["invalid uuid", (s: any) => { s.tables.units.rows[0].id = "not-a-uuid"; }],
    ["invalid hash", (s: any) => { s.tables.units.rows[0].rowSha256 = "short"; }],
    ["duplicate id", (s: any) => { s.tables.units.rows.push({ ...s.tables.units.rows[0] }); }],
    ["unobserved with rows", (s: any) => { s.tables.units.observed = false; }],
    ["missing typed field", (s: any) => { delete s.tables.assemblies.rows[0].tenantStamp; }],
    ["mixed snapshots", (s: any) => { s.consistency = "multiple_queries"; }],
    ["claim database completeness", (s: any) => { s.scope = "all_database_rows"; }],
    ["ownership decision injection", (s: any) => { s.tables.units.rows[0].ownership = "platform_canonical"; }],
  ])("rejects %s with a content-free error", (_name, mutate) => {
    const input = snapshot(); mutate(input);
    expect(() => buildCatalogOwnershipReadiness(input)).toThrow("Invalid catalog metadata snapshot");
  });
});

describe("offline CLI private output boundary", () => {
  function fixture() {
    // A clean checkout has no ignored tmp directory; fixtures own its creation.
    mkdirSync(join(repo, "tmp"), { recursive: true, mode: 0o700 });
    const root = mkdtempSync(join(repo, "tmp/catalog-review-test-")); roots.push(root);
    const input = join(root, "snapshot.json"); writeFileSync(input, JSON.stringify(snapshot()));
    return { root, input, packet: join(root, "packet.json") };
  }
  const output = () => ({ log: vi.spyOn(console, "log").mockImplementation(() => {}), error: vi.spyOn(console, "error").mockImplementation(() => {}) });
  it("prints aggregates without row IDs/hashes and exits 1 because ownership remains unresolved", () => {
    const { input } = fixture(); const { log } = output();
    expect(runCatalogOwnershipReadinessCli(["--snapshot", input])).toBe(1);
    const printed = log.mock.calls.flat().join(" ");
    expect(printed).not.toContain(id(1)); expect(printed).not.toContain(row(5).rowSha256);
    expect(JSON.parse(printed)).toMatchObject({ catalogRows: 4, readyForCutover: false });
  });
  it("writes an exclusive owner-only packet under repository tmp only when requested", () => {
    const { input, packet } = fixture(); output();
    expect(runCatalogOwnershipReadinessCli(["--snapshot", input, "--private-packet", packet])).toBe(1);
    expect(statSync(packet).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(packet, "utf8")).reviewRows).toHaveLength(7);
  });
  it("refuses overwrite, external output, symlink input and content-bearing malformed input", () => {
    const { root, input, packet } = fixture(); const { error } = output();
    writeFileSync(packet, "preserve");
    expect(runCatalogOwnershipReadinessCli(["--snapshot", input, "--private-packet", packet])).toBe(2);
    expect(readFileSync(packet, "utf8")).toBe("preserve");
    expect(runCatalogOwnershipReadinessCli(["--snapshot", input, "--private-packet", join(repo, "public/packet.json")])).toBe(2);
    symlinkSync(input, join(root, "link.json"));
    expect(runCatalogOwnershipReadinessCli(["--snapshot", join(root, "link.json")])).toBe(2);
    writeFileSync(input, '{"SECRET_CUSTOMER":');
    expect(runCatalogOwnershipReadinessCli(["--snapshot", input])).toBe(2);
    expect(error.mock.calls.flat().join(" ")).not.toContain("SECRET_CUSTOMER");
    expect(error.mock.calls.flat().join(" ")).not.toContain(root);
  });
  it("rejects unsupported CLI arguments without reading an input", () => {
    output(); expect(runCatalogOwnershipReadinessCli([])).toBe(2);
    expect(runCatalogOwnershipReadinessCli(["--apply", "yes"])).toBe(2);
  });
  it("attaches matched labels only to the private packet, never stdout", () => {
    const { root, input, packet } = fixture(); const source = snapshot(); source.tables.cost_types.rows[0].taxable = true;
    writeFileSync(input, JSON.stringify(source));
    const labels = join(root, "labels.json");
    writeFileSync(labels, JSON.stringify({ version: 1, observedAt: source.observedAt, rows: [{ ...row(4), label: "PRIVATE_REVIEW_LABEL" }] }));
    const { log } = output();
    expect(runCatalogOwnershipReadinessCli(["--snapshot", input, "--private-packet", packet, "--cost-type-labels", labels])).toBe(1);
    expect(JSON.parse(readFileSync(packet, "utf8")).ownerReview[0].label).toBe("PRIVATE_REVIEW_LABEL");
    expect(log.mock.calls.flat().join(" ")).not.toContain("PRIVATE_REVIEW_LABEL");
  });
  it("rejects labels without an explicit private packet output", () => {
    const { input } = fixture(); output();
    expect(runCatalogOwnershipReadinessCli(["--snapshot", input, "--cost-type-labels", input])).toBe(2);
  });
});

describe("private cost-type labels are matched by UUID and full-row hash only", () => {
  function fixture() {
    const input = snapshot(); input.tables.cost_types.rows[0].timeTrackable = false;
    const labels: any = { version: 1, observedAt: input.observedAt, rows: [{ ...row(4), label: "Synthetic type for review" }] };
    return { input, labels };
  }
  it("makes the exact conflict understandable without choosing an authoritative value", () => {
    const { input, labels } = fixture();
    expect(buildCostTypeOwnerReview(input, labels)).toEqual([expect.objectContaining({
      rowId: id(4), rowSha256: row(4).rowSha256, label: "Synthetic type for review",
      conflicts: [{ fieldA: "isTimeTrackable", valueA: true, fieldB: "timeTrackable", valueB: false,
        question: "Should this cost type track time?", authorizedValue: null, sourceEvidenceReference: null }],
      reviewer: null, status: "pending_owner_review", mutationAllowed: false,
    })]);
  });
  it("keeps two independent questions if the same row has both flag conflicts", () => {
    const { input, labels } = fixture(); input.tables.cost_types.rows[0].taxable = true;
    expect(buildCostTypeOwnerReview(input, labels)[0].conflicts).toHaveLength(2);
  });
  it("does not infer a setting from a familiar label", () => {
    const { input, labels } = fixture(); labels.rows[0].label = "Labor";
    expect(buildCostTypeOwnerReview(input, labels)[0].conflicts[0].authorizedValue).toBeNull();
  });
  it.each([
    ["different row hash", (s: any) => { s.rows[0].rowSha256 = "f".repeat(64); }],
    ["different row UUID", (s: any) => { s.rows[0].id = id(90); }],
    ["missing affected row", (s: any) => { s.rows = []; }],
    ["duplicate affected row", (s: any) => { s.rows.push({ ...s.rows[0] }); }],
    ["unaffected extra row", (s: any) => { s.rows.push({ ...row(90), label: "Other" }); }],
    ["embedded secret field", (s: any) => { s.rows[0].token = "secret"; }],
    ["control characters", (s: any) => { s.rows[0].label = "label\ncontrols"; }],
    ["overlong label", (s: any) => { s.rows[0].label = "x".repeat(201); }],
    ["invalid version", (s: any) => { s.version = 2; }],
  ])("rejects %s before attaching names to the packet", (_name, mutate) => {
    const { input, labels } = fixture(); mutate(labels);
    expect(() => buildCostTypeOwnerReview(input, labels)).toThrow("Cost type labels do not match the catalog review snapshot");
  });
  it("rejects label collection older than the metadata snapshot", () => {
    const { input, labels } = fixture(); labels.observedAt = "2020-01-01T00:00:00.000Z";
    expect(() => buildCostTypeOwnerReview(input, labels)).toThrow("Cost type labels do not match the catalog review snapshot");
  });
  it("permits an empty exact set when no cost-type flag conflicts were observed", () => {
    const input = snapshot();
    expect(buildCostTypeOwnerReview(input, { version: 1, observedAt: input.observedAt, rows: [] })).toEqual([]);
  });
});
