#!/usr/bin/env node
/**
 * Real multi-process concurrency worker for the A1 export physical foundation.
 * Spawned as a GENUINE separate OS process (never a same-process second connection)
 * by server/a1-export-physical.test.ts, against the SAME disposable lab cluster.
 *
 * Shells out to the real `psql` binary (matching the mission runner's own proven
 * pattern) rather than using the `postgres` npm driver for the write itself — a
 * fresh `postgres()` connection in a brand-new separate process was independently
 * confirmed (same literal data, verified byte-for-byte in pure JS AND re-verified
 * via a literal, unparameterized psql script that succeeds) to intermittently bind
 * one or more parameters incorrectly on its very first non-trivial query, causing a
 * spurious ck_jte_a1_manifest_mirror rejection with genuinely matching data. psql
 * has no such issue since it never goes through that driver's parameter-binding
 * path at all.
 *
 * Usage: node a1-export-physical-concurrency-worker.mjs <role> <paramsFile>
 *   role = "lock-and-insert-ready" | "lock-and-revoke" | "lock-and-first-download"
 *   paramsFile = path to a JSON file with the connection config and row data.
 *
 * Protocol (the real, observable barrier — never a client-side sleep used as proof):
 *   1. Run one psql script (one session = one implicit transaction across the file).
 *   2. SELECT * FROM estimate_drafts WHERE id = :draft_id FOR UPDATE.
 *      Whichever process's session reaches this first genuinely holds the row lock;
 *      the other's identical SELECT physically blocks inside Postgres until the
 *      first commits — real lock contention, not a timing assumption.
 *   3. \echo {"event":"lock_acquired",...} — psql flushes this to stdout the moment
 *      it reaches this line, i.e. only after the preceding FOR UPDATE actually
 *      returned. This is the signal the orchestrating test waits on (via readline)
 *      before spawning the SECOND worker, making the intended winner deterministic
 *      without masking the real blocking behavior of the actual database lock.
 *   4. SELECT pg_sleep(1) — a SERVER-SIDE delay held WHILE the lock is held, solely
 *      to widen the race window so the second process's block is unambiguously real
 *      and measurable; the serialization itself still comes from the row lock, not
 *      from this delay's duration being treated as proof.
 *   5. Perform the role's real write; the script's implicit COMMIT on clean exit (or
 *      ROLLBACK on error, since ON_ERROR_STOP is set) finalizes it.
 *   6. Print {"event":"committed"|"rejected",...} based on psql's real exit code.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , role, paramsFile] = process.argv;
const params = JSON.parse(readFileSync(paramsFile, "utf8"));
const PG_BIN = process.env.A1_PG_BIN ?? "/usr/local/bin";

function emit(obj) {
  process.stdout.write(JSON.stringify({ ...obj, at: new Date().toISOString() }) + "\n");
}
function q(value) {
  if (value === null || value === undefined) return "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function buildScript() {
  const m = params.manifest;
  const lines = [
    "\\set ON_ERROR_STOP on",
    "\\set VERBOSITY verbose",
    "BEGIN;",
    `SELECT * FROM estimate_drafts WHERE id = ${q(params.draftId)} FOR UPDATE;`,
    `\\echo {"event":"lock_acquired"}`,
    "SELECT pg_sleep(1);",
  ];
  if (role === "lock-and-insert-ready") {
    const approvedMinor = m.validation.reconciliation.approvedTotalMinor;
    lines.push(`
      INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash)
      VALUES (${q(params.exportRowId)}, ${q(params.tenantId)}, ${q(params.projectId)}, ${q(params.draftId)}, 'approved_for_download', ${q(params.actorId)}, 'internal-estimate-export-v1', 'json', 'preflight', ${q(m.checkedAt)}, ${q(JSON.stringify(m))}::jsonb, ${q(JSON.stringify(m.validation))}::jsonb, 'matched', ${q(approvedMinor)}, ${q(approvedMinor)}, '0', ${q(params.clientId)}, ${q(params.approvalId)}, ${q(params.snapshotId)}, ${q(params.contentHash)}, 'internal-estimate-json-v1', ${q(m.representation.generatedAt)}, 10, ${q(m.representation.artifactHash)});
    `);
  } else if (role === "lock-and-revoke") {
    lines.push(`UPDATE estimate_drafts SET status = 'internal_approval_revoked', updated_at = now() WHERE id = ${q(params.draftId)};`);
    lines.push(`
      INSERT INTO estimate_internal_approval_revocations (id, tenant_id, project_id, client_id, estimate_draft_id, approval_id, request_id, request_hash, revoked_by, reason, contract_version)
      VALUES (${q(params.revocationId)}, ${q(params.tenantId)}, ${q(params.projectId)}, ${q(params.clientId)}, ${q(params.draftId)}, ${q(params.approvalId)}, ${q(params.requestId)}, ${q(params.requestHash)}, ${q(params.actorId)}, ${q(params.reason)}, 'internal-approval-revocation-v1');
    `);
  } else if (role === "lock-and-first-download") {
    lines.push(`UPDATE jobtread_exports SET status = 'downloaded', downloaded_by = ${q(params.downloaderId)}, downloaded_at = ${q(params.downloadedAt)}, updated_at = ${q(params.downloadedAt)} WHERE id = ${q(params.exportRowId)};`);
  } else {
    throw new Error(`Unknown role: ${role}`);
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "a1-export-physical-worker-script-"));
  const scriptFile = join(dir, "script.sql");
  writeFileSync(scriptFile, buildScript());

  const child = spawn(`${PG_BIN}/psql`, [
    "-h", params.socketDirectory, "-U", params.user, "-d", params.database,
    "-v", "ON_ERROR_STOP=1", "-f", scriptFile,
  ]);
  let stdout = "", stderr = "";
  // Real-time: psql flushes each \echo as soon as that script line executes — this
  // readline interface sees "lock_acquired" the instant the real FOR UPDATE above it
  // actually returns, not after the whole script (including the later pg_sleep(1)
  // and write) finishes. This is what lets the orchestrator spawn the SECOND worker
  // only once the first genuinely holds the lock.
  const rl = createInterface({ input: child.stdout });
  rl.on("line", line => {
    stdout += line + "\n";
    if (line.includes('"event":"lock_acquired"')) {
      try { emit(JSON.parse(line)); } catch { emit({ event: "lock_acquired" }); }
    }
  });
  child.stderr.on("data", d => { stderr += d; });

  const code = await new Promise(resolve => child.on("exit", resolve));
  rl.close();
  rmSync(dir, { recursive: true, force: true });

  if (code === 0) {
    emit({ event: "committed" });
  } else {
    const constraintMatch = stderr.match(/violates check constraint "([^"]+)"/) || stderr.match(/violates foreign key constraint "([^"]+)"/) || stderr.match(/CONSTRAINT NAME:\s+(\S+)/i);
    emit({ event: "rejected", error: stderr.trim().slice(0, 4000), constraint_name: constraintMatch ? constraintMatch[1] : null });
  }
}

main();
