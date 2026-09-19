import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalMigrationManifest, reconcileMigrationHistory, runMigrationHistoryCli } from "../scripts/migration-history-reconcile";

const roots: string[] = [];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const sql = "CREATE TABLE example (id integer);\n";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "migration-identity-"));
  roots.push(root);
  mkdirSync(join(root, "drizzle/meta"), { recursive: true });
  const journal = { version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: 1780000000000, tag: "0000_example", breakpoints: true }] };
  writeFileSync(join(root, "drizzle/meta/_journal.json"), JSON.stringify(journal));
  writeFileSync(join(root, "drizzle/0000_example.sql"), sql);
  return { root, journal };
}
function snapshot() {
  return {
    version: 1,
    observedAt: "2026-09-19T01:00:00.000Z",
    drizzle: { available: true, rows: [{ createdAt: "1780000000000", hash: hash(sql) }] },
    supabase: { available: true, rows: [{ version: "20260919010000", statementHashes: [hash(sql)] }] },
  };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("local migration identities", () => {
  it("hashes exact SQL bytes and journal bytes without interpreting SQL", () => {
    const { root } = fixture();
    const result = loadLocalMigrationManifest(root);
    expect(result.journalSha256).toBe(createHash("sha256").update(readFileSync(join(root, "drizzle/meta/_journal.json"))).digest("hex"));
    expect(result.migrations).toEqual([{ tag: "0000_example", createdAt: "1780000000000", sha256: hash(sql) }]);
  });
  it("does not normalize whitespace into a false identity", () => {
    const { root } = fixture();
    const before = loadLocalMigrationManifest(root);
    writeFileSync(join(root, "drizzle/0000_example.sql"), sql.replace("\n", "\r\n"));
    expect(loadLocalMigrationManifest(root).migrations[0].sha256).not.toBe(before.migrations[0].sha256);
  });
  it("inventories SQL outside the journal separately, without granting migration identity", () => {
    const { root } = fixture();
    writeFileSync(join(root, "drizzle/sync-columns.sql"), "SELECT 1;");
    const result = loadLocalMigrationManifest(root);
    expect(result.migrations).toHaveLength(1);
    expect(result.supplementarySqlFiles).toEqual(["sync-columns.sql"]);
  });
  it.each([
    ["wrong dialect", (j: any) => { j.dialect = "mysql"; }],
    ["empty journal", (j: any) => { j.entries = []; }],
    ["path traversal", (j: any) => { j.entries[0].tag = "../private"; }],
    ["noncontiguous index", (j: any) => { j.entries[0].idx = 1; }],
    ["unsafe timestamp", (j: any) => { j.entries[0].when = Number.MAX_SAFE_INTEGER + 1; }],
    ["duplicate tag", (j: any) => { j.entries.push({ ...j.entries[0], idx: 1, when: 1780000000001 }); }],
    ["duplicate timestamp", (j: any) => { j.entries.push({ ...j.entries[0], idx: 1, tag: "0001_example" }); }],
  ])("rejects %s before returning a partial manifest", (_name, mutate) => {
    const { root, journal } = fixture();
    mutate(journal);
    writeFileSync(join(root, "drizzle/meta/_journal.json"), JSON.stringify(journal));
    expect(() => loadLocalMigrationManifest(root)).toThrow("Invalid local migration manifest");
  });
  it("rejects missing SQL instead of reducing the expected migration count", () => {
    const { root } = fixture();
    rmSync(join(root, "drizzle/0000_example.sql"));
    expect(() => loadLocalMigrationManifest(root)).toThrow("Invalid local migration manifest");
  });
  it("does not follow a migration symlink to other local files", () => {
    const { root } = fixture();
    const path = join(root, "drizzle/0000_example.sql");
    rmSync(path);
    symlinkSync(join(root, "drizzle/meta/_journal.json"), path);
    expect(() => loadLocalMigrationManifest(root)).toThrow("Invalid local migration manifest");
  });
});

describe("migration history command contract", () => {
  function output() {
    return { log: vi.spyOn(console, "log").mockImplementation(() => {}), error: vi.spyOn(console, "error").mockImplementation(() => {}) };
  }
  function snapshotFile(input: unknown) {
    const { root } = fixture();
    const path = join(root, "snapshot.json");
    writeFileSync(path, JSON.stringify(input));
    return path;
  }
  it("emits the seven expected identities and exit 2 when no environment evidence was supplied", () => {
    const { log, error } = output();
    expect(runMigrationHistoryCli([])).toBe(2);
    const report = JSON.parse(log.mock.calls[0][0]);
    expect(report.local.migrations).toHaveLength(7);
    expect(report.drizzleIdentity).toBe("UNAVAILABLE");
    expect(error).not.toHaveBeenCalled();
  });
  it("returns exit 1 for a valid snapshot whose observed ledger is empty", () => {
    const { log } = output();
    const input = snapshot(); input.drizzle.rows = [];
    expect(runMigrationHistoryCli(["--snapshot", snapshotFile(input)])).toBe(1);
    expect(JSON.parse(log.mock.calls[0][0]).drizzle.missingLocalTags).toHaveLength(7);
  });
  it("returns exit 0 solely for exact Drizzle pairs with both ledgers observed, without migration approval", () => {
    const { log } = output();
    const local = loadLocalMigrationManifest(fileURLToPath(new URL("../", import.meta.url)));
    const input = snapshot();
    input.drizzle.rows = local.migrations.map(row => ({ createdAt: row.createdAt, hash: row.sha256 }));
    expect(runMigrationHistoryCli(["--snapshot", snapshotFile(input)])).toBe(0);
    expect(JSON.parse(log.mock.calls[0][0]).migrationExecutionAllowed).toBe(false);
  });
  it("rejects arbitrary arguments without printing argument contents", () => {
    const { log, error } = output();
    expect(runMigrationHistoryCli(["PRIVATE_SENTINEL"])).toBe(2);
    expect(log).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join(" ")).not.toContain("PRIVATE_SENTINEL");
  });
  it("rejects malformed input without printing filesystem paths or submitted fields", () => {
    const { log, error } = output();
    const path = snapshotFile({ token: "PRIVATE_SENTINEL" });
    expect(runMigrationHistoryCli(["--snapshot", path])).toBe(2);
    expect(log).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join(" ")).not.toContain("PRIVATE_SENTINEL");
    expect(error.mock.calls.flat().join(" ")).not.toContain(path);
  });
  it("does not silently succeed when a snapshot file is missing", () => {
    const { log } = output();
    expect(runMigrationHistoryCli(["--snapshot", join(fixture().root, "missing.json")])).toBe(2);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("offline ledger comparison", () => {
  function compare(input: unknown = snapshot()) { return reconcileMigrationHistory(loadLocalMigrationManifest(fixture().root), input); }
  it("matches only the exact created_at/hash pair, without granting deployment or replay", () => {
    const result = compare();
    expect(result.drizzleIdentity).toBe("MATCH");
    expect(result.drizzle.matchedLocalTags).toEqual(["0000_example"]);
    expect(result.supabase.localStatementMatchTags).toEqual(["0000_example"]);
    expect(result.migrationExecutionAllowed).toBe(false);
    expect(result.schemaEffectsVerified).toBe(false);
  });
  it("treats the observed empty Drizzle ledger as a discrepancy, not unavailable evidence", () => {
    const input = snapshot(); input.drizzle.rows = [];
    const result = compare(input);
    expect(result.drizzleIdentity).toBe("MISMATCH");
    expect(result.drizzle.missingLocalTags).toEqual(["0000_example"]);
    expect(result.drizzle.available).toBe(true);
    expect(result.supabase.localStatementMatchTags).toEqual(["0000_example"]);
  });
  it("does not substitute a matching Supabase statement for missing Drizzle identity", () => {
    const input = snapshot(); input.drizzle.rows = [];
    expect(compare(input).drizzleIdentity).toBe("MISMATCH");
  });
  it("distinguishes unavailable ledger from empty ledger", () => {
    const input = snapshot(); input.drizzle = { available: false, rows: [] };
    const result = compare(input);
    expect(result.drizzleIdentity).toBe("UNAVAILABLE");
    expect(result.drizzle.missingLocalTags).toEqual([]);
    expect(result.evidenceComplete).toBe(false);
  });
  it("does not hide missing Supabase evidence when Drizzle pairs match", () => {
    const input = snapshot(); input.supabase = { available: false, rows: [] };
    const result = compare(input);
    expect(result.drizzleIdentity).toBe("MATCH");
    expect(result.evidenceComplete).toBe(false);
  });
  it("reports missing snapshot as incomplete, without assuming empty ledgers", () => {
    const result = compare(null);
    expect(result.drizzleIdentity).toBe("UNAVAILABLE");
    expect(result.observedAt).toBe(null);
    expect(result.evidenceComplete).toBe(false);
  });
  it("detects a changed SQL hash under the same timestamp", () => {
    const input = snapshot(); input.drizzle.rows[0].hash = hash("different");
    expect(compare(input).drizzle.conflictingLocalTags).toEqual(["0000_example"]);
    expect(compare(input).drizzleIdentity).toBe("MISMATCH");
  });
  it("does not match the same hash under a different timestamp", () => {
    const input = snapshot(); input.drizzle.rows[0].createdAt = "1780000000001";
    const result = compare(input);
    expect(result.drizzle.missingLocalTags).toEqual(["0000_example"]);
    expect(result.drizzle.unexpectedRowCount).toBe(1);
  });
  it("does not hide a duplicate exact Drizzle row", () => {
    const input = snapshot(); input.drizzle.rows.push({ ...input.drizzle.rows[0] });
    const result = compare(input);
    expect(result.drizzle.duplicateCreatedAt).toEqual(["1780000000000"]);
    expect(result.drizzleIdentity).toBe("MISMATCH");
  });
  it("detects unexpected ledger entries even if every local identity is present", () => {
    const input = snapshot(); input.drizzle.rows.push({ createdAt: "1780000000001", hash: hash("unknown") });
    expect(compare(input).drizzle.unexpectedRowCount).toBe(1);
    expect(compare(input).drizzleIdentity).toBe("MISMATCH");
  });
  it("identifies duplicate Supabase versions without pretending a rollback or corruption", () => {
    const input = snapshot(); input.supabase.rows.push({ ...input.supabase.rows[0] });
    const result = compare(input);
    expect(result.supabase.duplicateVersions).toEqual(["20260919010000"]);
    expect(result.evidenceComplete).toBe(false);
  });
  it("counts unmapped statements and empty versions as unresolved provenance", () => {
    const input = snapshot();
    input.supabase.rows.push({ version: "20260919010001", statementHashes: [hash("other"), hash("other")] }, { version: "20260919010002", statementHashes: [] });
    const result = compare(input);
    expect(result.supabase.statementCount).toBe(3);
    expect(result.supabase.distinctStatementHashCount).toBe(2);
    expect(result.supabase.unmappedStatementCount).toBe(2);
    expect(result.supabase.versionsWithoutStatements).toBe(1);
    expect(result.migrationExecutionAllowed).toBe(false);
  });
  it("does not concatenate separate Supabase statements into invented whole-file identity", () => {
    const input = snapshot(); input.supabase.rows[0].statementHashes = [hash("CREATE TABLE "), hash("example (id integer);\n")];
    expect(compare(input).supabase.localStatementMatchTags).toEqual([]);
  });
  it.each([
    ["unknown fields", (s: any) => { s.connectionUrl = "PRIVATE_SENTINEL"; }],
    ["raw statements", (s: any) => { s.supabase.rows[0].statements = ["PRIVATE_SENTINEL"]; }],
    ["malformed hash", (s: any) => { s.drizzle.rows[0].hash = "PRIVATE_SENTINEL"; }],
    ["invalid timestamp", (s: any) => { s.drizzle.rows[0].createdAt = "not-an-integer"; }],
    ["numeric timestamp", (s: any) => { s.drizzle.rows[0].createdAt = 1780000000000; }],
    ["invalid observation date", (s: any) => { s.observedAt = "yesterday"; }],
    ["unknown format version", (s: any) => { s.version = 2; }],
    ["rows under unavailable ledger", (s: any) => { s.drizzle.available = false; }],
  ])("rejects %s with a constant error that contains no submitted values", (_name, mutate) => {
    const input = snapshot(); mutate(input);
    expect(() => compare(input)).toThrow(/^Invalid migration ledger snapshot$/);
  });
  it("reconciles the actual repository's seven-file journal as a bounded identity inventory", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const local = loadLocalMigrationManifest(root);
    expect(local.migrations.map(row => row.tag)).toEqual([
      "0000_strong_jean_grey", "0001_phase1_identity_tenant", "0002_phase2_previsit_estimate", "0003_phase3_field_actuals", "0004_phase4_learning_multitenant",
      "0005_historical_estimate_capture",
      "0006_historical_estimate_acl_hardening",
    ]);
    expect(local.supplementarySqlFiles).toEqual(["sync-new-columns.sql"]);
    expect(reconcileMigrationHistory(local, { ...snapshot(), drizzle: { available: true, rows: [] }, supabase: { available: true, rows: [] } }).drizzle.missingLocalTags).toHaveLength(7);
  });
});
