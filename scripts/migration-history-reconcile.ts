/** Offline evidence tool: never connects to a database or executes migration SQL. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const epoch = z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value => Number.isSafeInteger(Number(value)));
const journalSchema = z.strictObject({
  version: z.string().regex(/^\d+$/),
  dialect: z.literal("postgresql"),
  entries: z.array(z.strictObject({
    idx: z.number().int().nonnegative(),
    version: z.string().regex(/^\d+$/),
    when: z.number().int().positive().refine(Number.isSafeInteger),
    tag: z.string().regex(/^\d{4}_[a-zA-Z0-9_]+$/),
    breakpoints: z.boolean(),
  })).min(1),
});
const snapshotSchema = z.strictObject({
  version: z.literal(1),
  observedAt: z.iso.datetime(),
  drizzle: z.strictObject({
    available: z.boolean(),
    rows: z.array(z.strictObject({ createdAt: epoch, hash: digest })),
  }),
  supabase: z.strictObject({
    available: z.boolean(),
    rows: z.array(z.strictObject({
      version: z.string().regex(/^[0-9]{1,32}$/),
      statementHashes: z.array(digest),
    })),
  }),
}).refine(value => (value.drizzle.available || value.drizzle.rows.length === 0)
  && (value.supabase.available || value.supabase.rows.length === 0));

export interface LocalMigrationManifest {
  journalSha256: string;
  migrations: Array<{ tag: string; createdAt: string; sha256: string }>;
  supplementarySqlFiles: string[];
}

function readRegularFile(path: string): Buffer {
  if (!lstatSync(path).isFile()) throw new Error("Expected a regular file");
  return readFileSync(path);
}

/** SQL hashes are byte identities. No stripping comments, joining statements or rewriting line endings. */
export function loadLocalMigrationManifest(repositoryRoot: string): LocalMigrationManifest {
  try {
    const directory = join(repositoryRoot, "drizzle");
    const journalBytes = readRegularFile(join(directory, "meta/_journal.json"));
    const journal = journalSchema.parse(JSON.parse(journalBytes.toString("utf8")));
    if (journal.entries.some((entry, index) => entry.idx !== index)
      || new Set(journal.entries.map(entry => entry.tag)).size !== journal.entries.length
      || new Set(journal.entries.map(entry => entry.when)).size !== journal.entries.length) {
      throw new Error("Journal identities must be unique and ordered");
    }
    const migrations = journal.entries.map(entry => ({
      tag: entry.tag,
      createdAt: String(entry.when),
      sha256: sha256(readRegularFile(join(directory, `${entry.tag}.sql`))),
    }));
    const journalFiles = new Set(migrations.map(entry => `${entry.tag}.sql`));
    return {
      journalSha256: sha256(journalBytes),
      migrations,
      supplementarySqlFiles: readdirSync(directory).filter(name => name.endsWith(".sql") && !journalFiles.has(name)).sort(),
    };
  } catch {
    // Avoid filesystem paths, invalid JSON contents or submitted metadata in error output.
    throw new Error("Invalid local migration manifest");
  }
}

function duplicateValues(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts).filter(([, count]) => count > 1).map(([value]) => value).sort();
}

/** Ledger identity comparison, NOT schema equivalence, provenance approval or permission to replay. */
export function reconcileMigrationHistory(local: LocalMigrationManifest, input: unknown) {
  const parsed = input == null ? null : snapshotSchema.safeParse(input);
  if (parsed && !parsed.success) throw new Error("Invalid migration ledger snapshot");
  const snapshot = parsed?.success ? parsed.data : null;
  const drizzleRows = snapshot?.drizzle.rows ?? [];
  const supabaseRows = snapshot?.supabase.rows ?? [];
  const drizzleAvailable = snapshot?.drizzle.available ?? false;
  const supabaseAvailable = snapshot?.supabase.available ?? false;
  const duplicateCreatedAt = duplicateValues(drizzleRows.map(row => row.createdAt));
  const duplicateVersions = duplicateValues(supabaseRows.map(row => row.version));
  const matchedLocalTags: string[] = [];
  const missingLocalTags: string[] = [];
  const conflictingLocalTags: string[] = [];
  if (drizzleAvailable) {
    for (const migration of local.migrations) {
      const sameTime = drizzleRows.filter(row => row.createdAt === migration.createdAt);
      if (sameTime.some(row => row.hash === migration.sha256)) matchedLocalTags.push(migration.tag);
      else missingLocalTags.push(migration.tag);
      if (sameTime.some(row => row.hash !== migration.sha256)) conflictingLocalTags.push(migration.tag);
    }
  }
  const expectedPairs = new Set(local.migrations.map(row => `${row.createdAt}:${row.sha256}`));
  const unexpectedRowCount = drizzleRows.filter(row => !expectedPairs.has(`${row.createdAt}:${row.hash}`)).length;
  const mismatch = missingLocalTags.length > 0 || conflictingLocalTags.length > 0 || duplicateCreatedAt.length > 0 || unexpectedRowCount > 0;
  const statementHashes = supabaseRows.flatMap(row => row.statementHashes);
  const statementSet = new Set(statementHashes);
  const localHashes = new Set(local.migrations.map(row => row.sha256));
  return {
    version: 1,
    observedAt: snapshot?.observedAt ?? null,
    local,
    drizzleIdentity: !drizzleAvailable ? "UNAVAILABLE" : mismatch ? "MISMATCH" : "MATCH",
    // Completeness means the requested metadata exists and has no duplicate identity keys;
    // it does not mean the history agrees or that schema/data/policy verification has passed.
    evidenceComplete: drizzleAvailable && supabaseAvailable && duplicateCreatedAt.length === 0 && duplicateVersions.length === 0,
    drizzle: { available: drizzleAvailable, rowCount: drizzleRows.length, matchedLocalTags, missingLocalTags, conflictingLocalTags, duplicateCreatedAt, unexpectedRowCount },
    supabase: {
      available: supabaseAvailable,
      versionCount: supabaseRows.length,
      duplicateVersions,
      statementCount: statementHashes.length,
      distinctStatementHashCount: statementSet.size,
      versionsWithoutStatements: supabaseRows.filter(row => row.statementHashes.length === 0).length,
      localStatementMatchTags: local.migrations.filter(row => statementSet.has(row.sha256)).map(row => row.tag),
      unmappedStatementCount: statementHashes.filter(value => !localHashes.has(value)).length,
    },
    schemaEffectsVerified: false,
    migrationExecutionAllowed: false,
    limitations: [
      "SQL byte matches do not prove execution, schema equivalence, transaction success, ownership or least privilege.",
      "Supabase statement matches are informational; separate statements are never concatenated or treated as Drizzle ledger entries.",
      "Unmapped statements may be valid independent migrations; this tool does not classify their effects.",
      "Ledger completeness and reported observation time are supplied by the collector and cannot be authenticated offline.",
      "Replay, ledger backfill, baseline adoption and production changes require a separately verified reconciliation and recovery plan.",
    ],
  };
}

/** Exit 0 = matching Drizzle identities with both ledgers observed, NEVER deployment approval. */
export function runMigrationHistoryCli(args: string[]): number {
  try {
    if (args.length !== 0 && !(args.length === 2 && args[0] === "--snapshot")) {
      throw new Error("Unsupported arguments");
    }
    const root = fileURLToPath(new URL("../", import.meta.url));
    const local = loadLocalMigrationManifest(root);
    const snapshot = args.length ? JSON.parse(readRegularFile(resolve(args[1])).toString("utf8")) : null;
    const report = reconcileMigrationHistory(local, snapshot);
    console.log(JSON.stringify(report, null, 2));
    if (!report.evidenceComplete) return 2;
    return report.drizzleIdentity === "MATCH" ? 0 : 1;
  } catch {
    console.error("Migration history input rejected; expected a local journal and a sanitized v1 ledger snapshot. No database was contacted.");
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runMigrationHistoryCli(process.argv.slice(2));
}
