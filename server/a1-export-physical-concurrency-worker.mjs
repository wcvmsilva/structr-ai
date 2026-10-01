#!/usr/bin/env node
/**
 * Real multi-process concurrency worker for the A1 export physical foundation.
 * Spawned as a GENUINE separate OS process (never a same-process second connection)
 * by server/a1-export-physical.test.ts, against the SAME disposable lab cluster.
 *
 * Shells out to the real `psql` binary (matching the mission runner's own proven
 * pattern) rather than using the `postgres` npm driver for the write itself — a
 * fresh `postgres()` connection in a brand-new separate process was independently
 * observed (same literal data, verified byte-for-byte in pure JS AND re-verified via
 * a literal, unparameterized psql script that succeeds) to intermittently bind one or
 * more parameters incorrectly on its very first non-trivial query, causing a spurious
 * ck_jte_a1_manifest_mirror rejection with genuinely matching data. This is described
 * as an OBSERVATION with a working psql-based WORKAROUND, not a proven postgres.js
 * driver bug — MICHAEL-A1-EXPORT-PHYSICAL-V2-QA-AND-COMPLETION.md found the earlier
 * "confirmed driver bug" framing unsupported (a failure in one client and success via
 * a different client/protocol path does not by itself isolate causation).
 *
 * Usage: node a1-export-physical-concurrency-worker.mjs <role> <paramsFile>
 *   role = "lock-and-insert-ready" | "lock-and-revoke" | "lock-and-first-download"
 *   paramsFile = path to a JSON file with the connection config and row data.
 *
 * V3 redesign (MICHAEL-A1-EXPORT-PHYSICAL-V2-QA-AND-COMPLETION.md's concurrency-
 * discriminant finding): V2's script took its OWN `SELECT ... FOR UPDATE` on the
 * draft row as the very first statement in EVERY role, before the role's real write.
 * That pre-lock — not the export trigger's (jobtread_export_a1_check_final_v1) own
 * deferred `FOR UPDATE` — was what actually serialized the two workers, so the
 * "proof" would have passed identically even if the trigger stopped taking its own
 * lock. This version takes NO pre-lock at all: each role's script only (a) echoes its
 * own backend PID right after BEGIN, (b) sets a test-only GUC
 * (a1_test.widen_export_lock_window — a documented no-op outside a test that opts in)
 * so THIS trigger's own FOR UPDATE, once it fires inside COMMIT (the trigger is a
 * DEFERRED constraint trigger — it only runs at COMMIT, not at the INSERT/UPDATE
 * statement itself), holds the row lock for ~1s instead of releasing immediately, (c)
 * performs the role's real write, (d) echoes just before issuing COMMIT. The
 * orchestrating test (not this file) proves the lock is real by polling pg_locks for
 * the FIRST worker's own backend PID (via psql, never the postgres.js driver) to
 * observe it actually HOLDING the tuple lock, then polling for the SECOND worker's
 * PID to observe it genuinely WAITING on that same lock — a real signal from
 * Postgres's own lock tables, not a sleep-then-compare-timestamps inference.
 *
 * This two-sided proof only works for "insert/first-download WINS the race": only
 * jobtread_export_a1_check_final_v1 (this migration's own trigger) has the widen
 * hook, since it is the one piece of code this round owns. Revoke's own deferred
 * trigger (0007's internal_approval_check_final_v1, already-accepted shared
 * infrastructure from an earlier round) is deliberately NOT modified to add an
 * equivalent widen hook — so "revoke WINS" is proved as genuine sequential
 * precedence (revoke's commit fully finishes before the insert/first-download worker
 * is even spawned, through two still-genuinely-separate OS processes) rather than as
 * true concurrent lock contention. This asymmetry is a real, named, bounded limit of
 * this round — not a hidden gap — see the test file's own scope comment.
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
    "SELECT pg_backend_pid() AS pid \\gset",
    "\\echo {\"event\":\"started\",\"pid\": " + ":pid}",
    // Harmless no-op for roles whose write never reaches jobtread_export_a1_check_
    // final_v1 (lock-and-revoke) — only meaningful for the two roles this trigger
    // actually fires for (INSERT, and the one legal first-download UPDATE).
    "SET a1_test.widen_export_lock_window = 'on';",
  ];
  if (role === "lock-and-insert-ready") {
    const approvedMinor = m.validation.reconciliation.approvedTotalMinor;
    const rowCount = Array.isArray(m.lineKeys) ? m.lineKeys.length : 0;
    lines.push(`
      INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count)
      VALUES (${q(params.exportRowId)}, ${q(params.tenantId)}, ${q(params.projectId)}, ${q(params.draftId)}, 'approved_for_download', ${q(params.actorId)}, 'internal-estimate-export-v1', 'json', 'preflight', ${q(m.checkedAt)}, ${q(JSON.stringify(m))}::jsonb, ${q(JSON.stringify(m.validation))}::jsonb, 'matched', ${q(approvedMinor)}, ${q(approvedMinor)}, '0', ${q(params.clientId)}, ${q(params.approvalId)}, ${q(params.snapshotId)}, ${q(params.contentHash)}, 'internal-estimate-json-v1', ${q(m.representation.generatedAt)}, 10, ${q(m.representation.artifactHash)}, ${rowCount});
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
  lines.push("\\echo {\"event\":\"issuing_commit\"}");
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
  let stderr = "";
  // Real-time: psql flushes each \echo as soon as that script line executes.
  const rl = createInterface({ input: child.stdout });
  rl.on("line", line => {
    if (line.includes('"event":"started"') || line.includes('"event":"issuing_commit"')) {
      try { emit(JSON.parse(line)); } catch { /* non-JSON stdout noise, ignored */ }
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
