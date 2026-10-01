#!/usr/bin/env node
/**
 * Real multi-process concurrency worker for the A1 export physical foundation.
 * Spawned as a GENUINE separate OS process (never a same-process second connection)
 * by server/a1-export-physical.test.ts, against the SAME disposable lab cluster.
 *
 * Shells out to the real `psql` binary rather than using the `postgres` npm driver
 * — a fresh `postgres()` connection in a brand-new separate process was OBSERVED
 * (one attempt failed with a spurious ck_jte_a1_manifest_mirror rejection against
 * genuinely matching data; a separately-issued, literal psql invocation against the
 * same live data succeeded) to behave differently on a fresh connection's first few
 * queries. That is the full extent of what is established: one attempt failed and
 * another, via a different client/protocol path, passed. The cause is NOT isolated
 * to the driver — MICHAEL-A1-EXPORT-PHYSICAL-V2-QA-AND-COMPLETION.md correctly
 * rejected the earlier "confirmed driver bug" framing (a failure in one client and
 * success via a different protocol path do not by themselves isolate the cause).
 * psql is used as the working path for this worker; no lateral investigation of the
 * driver is undertaken here.
 *
 * Usage: node a1-export-physical-concurrency-worker.mjs <role> <paramsFile>
 *   role = "insert-ready" | "first-download" | "revoke" | "supersede"
 *   paramsFile = path to a JSON file with the connection config and row data.
 *
 * V4 protocol (MICHAEL-A1-EXPORT-PHYSICAL-V3-QA-AND-COMPLETION.md §2): no GUC/sleep
 * hook in the product (the V3 hook in jobtread_export_a1_check_final_v1 has been
 * removed from the migration entirely), and no pre-lock taken by this worker on
 * behalf of the product. Instead, psql is driven INTERACTIVELY (progressive
 * stdin/stdout, never a single `-f` script) through exactly these steps, uniformly
 * for every role:
 *   1. BEGIN, echo this backend's own pid.
 *   2. Send the role's real write statement(s) — emits a "write_sent" event the
 *      instant the statement is WRITTEN (not once it completes), because a write
 *      that touches estimate_drafts (revoke's UPDATE, supersede's INSERT+UPDATE)
 *      can itself block right here on a real row lock another real transaction
 *      already holds — the orchestrating test needs to know the statement is
 *      in flight, not wait for a completion that may not arrive until released.
 *   3. SET CONSTRAINTS ALL IMMEDIATE — forces every deferred constraint trigger
 *      this transaction owes (this migration's jobtread_export_a1_check_final_v1
 *      for export roles; 0007's internal_approval_check_final_v1 for revoke/
 *      supersede) to run NOW instead of at COMMIT, while the transaction is still
 *      open. This is what gives the real FOR UPDATE lock an observable, held
 *      window — using ONLY a standard SQL command, never an instrumented trigger.
 *      Emits "set_constraints_sent" the instant it is written (same reasoning as
 *      step 2: THIS is where an export role's own FOR UPDATE actually blocks).
 *   4. On success: emit "deferred_checks_done" and WAIT for a literal "RELEASE\n"
 *      line on THIS WORKER'S OWN stdin (written by the orchestrating test when it
 *      is ready) — the harness controls how long the real transaction stays open,
 *      never a sleep. On failure: parse the constraint name, ROLLBACK, emit
 *      "rejected", done.
 *   5. On RELEASE: COMMIT, emit "committed", done.
 * Every step's completion is detected via a unique `\echo` sentinel read from
 * psql's own stdout, correlated against psql's stderr accumulated since the
 * previous sentinel — never a sleep-then-assume.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [, , role, paramsFile] = process.argv;
const params = JSON.parse(readFileSync(paramsFile, "utf8"));
const PG_BIN = process.env.A1_PG_BIN ?? "/usr/local/bin";
const SHORT_TIMEOUT_MS = 5000; // steps that must never genuinely block (BEGIN, echo pid, ROLLBACK/COMMIT)
const BLOCKING_TIMEOUT_MS = 15000; // a safety net only — it bounds a hang, it is never the proof of serialization
const RELEASE_TIMEOUT_MS = 30000; // bounds how long this transaction waits for the orchestrator's RELEASE before rolling back on its own

function emit(obj) {
  process.stdout.write(JSON.stringify({ ...obj, at: new Date().toISOString() }) + "\n");
}
function q(value) {
  if (value === null || value === undefined) return "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let psql = null;
let stdoutBuf = "", stderrBuf = "";
let exitPromise = null;

function startPsql() {
  psql = spawn(`${PG_BIN}/psql`, [
    "-h", params.socketDirectory, "-U", params.user, "-d", params.database,
    "-X", "-q", "--no-psqlrc",
  ], { stdio: ["pipe", "pipe", "pipe"] });
  emit({ event: "psql_spawned", pid: psql.pid });
  exitPromise = new Promise(resolve => {
    psql.on("exit", (code, signal) => resolve({ code, signal }));
    psql.on("error", error => { emit({ event: "spawn_error", error: String(error?.stack ?? error) }); resolve({ code: null, signal: null, spawnError: String(error) }); });
  });
  psql.stdout.on("data", d => { stdoutBuf += d; });
  psql.stderr.on("data", d => { stderrBuf += d; });
}

/** Writes one line to psql's stdin, then a unique sentinel \echo right after it,
 * and waits for that sentinel to appear on stdout — returning whatever stderr
 * accumulated in between (empty string = the preceding statement succeeded). */
async function sendAndWait(sql, label, timeoutMs) {
  const marker = `__A1_WORKER_MARKER_${label}_${Math.random().toString(36).slice(2)}__`;
  stderrBuf = "";
  psql.stdin.write(sql + "\n");
  psql.stdin.write(`\\echo ${marker}\n`);
  const deadline = Date.now() + timeoutMs;
  while (!stdoutBuf.includes(marker)) {
    if (psql.exitCode !== null || psql.killed) throw new Error(`psql exited before marker ${label} arrived`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for marker ${label} after ${timeoutMs}ms`);
    await sleep(15);
  }
  const idx = stdoutBuf.indexOf(marker);
  stdoutBuf = stdoutBuf.slice(idx + marker.length);
  return stderrBuf;
}
function parseConstraint(stderrText) {
  const m = stderrText.match(/violates check constraint "([^"]+)"/) || stderrText.match(/violates foreign key constraint "([^"]+)"/) || stderrText.match(/CONSTRAINT NAME:\s+(\S+)/i) || stderrText.match(/ERROR:\s+([A-Z0-9_]+)\b/);
  return m ? m[1] : null;
}
function waitForExit(timeoutMs) {
  return Promise.race([
    exitPromise,
    sleep(timeoutMs).then(() => { throw new Error(`psql did not exit within ${timeoutMs}ms of stdin close`); }),
  ]);
}
/** V5 fix (MICHAEL-A1-EXPORT-PHYSICAL-V4-QA-AND-COMPLETION.md §4): the V4 version
 * called psql.kill("SIGKILL") in a .catch() and then fell straight through to
 * process.exit() without ever waiting to see whether the SIGKILL actually landed
 * — no confirmation, happy-path only. This waits (bounded) for the real exit
 * after stdin.end(), escalates to SIGKILL only if still not exited, waits
 * (bounded) again for THAT exit, and returns false — never throws, never
 * silently assumes success — when neither wait ever confirms the exit. */
async function terminatePsqlAndWait() {
  try { psql.stdin.end(); } catch { /* already ended/closed */ }
  try {
    await waitForExit(SHORT_TIMEOUT_MS);
    return true;
  } catch { /* fall through to SIGKILL escalation below */ }
  try { psql.kill("SIGKILL"); } catch (e) { emit({ event: "psql_termination_failed", error: String(e) }); return false; }
  try {
    await waitForExit(SHORT_TIMEOUT_MS);
    return true;
  } catch {
    emit({ event: "psql_termination_failed", error: "psql not confirmed exited after SIGKILL" });
    return false;
  }
}

function writeStatementsFor() {
  const m = params.manifest;
  if (role === "insert-ready") {
    const approvedMinor = m?.validation?.reconciliation?.approvedTotalMinor;
    const rowCount = Array.isArray(m?.lineKeys) ? m.lineKeys.length : 0;
    return [`
      INSERT INTO jobtread_exports (id, tenant_id, project_id, estimate_draft_id, status, requested_by, artifact_contract_version, artifact_format, attempt_kind, checked_at, manifest, validation_report, reconciliation_status, approved_total_cents, exported_total_cents, difference_cents, client_id, internal_approval_id, internal_snapshot_id, approved_content_hash, renderer_version, generated_at, artifact_byte_length, artifact_hash, row_count, estimate_version, contract_version, block_reason, skill_id, skill_version, csv_hash, created_at, updated_at)
      VALUES (${q(params.exportRowId)}, ${q(params.tenantId)}, ${q(params.projectId)}, ${q(params.draftId)}, 'approved_for_download', ${q(params.actorId)}, 'internal-estimate-export-v1', 'json', 'preflight', ${q(m.checkedAt)}, ${q(JSON.stringify(m))}::jsonb, ${q(JSON.stringify(m.validation))}::jsonb, 'matched', ${q(approvedMinor)}, ${q(approvedMinor)}, '0', ${q(params.clientId)}, ${q(params.approvalId)}, ${q(params.snapshotId)}, ${q(params.contentHash)}, 'internal-estimate-json-v1', ${q(m.representation.generatedAt)}, 10, ${q(m.representation.artifactHash)}, ${rowCount}, ${q(m.context.estimateVersion)}, 'internal-estimate-export-v1', NULL, 'structr-internal-estimate-export', '1.0.0', NULL, ${q(m.checkedAt)}, ${q(m.checkedAt)});
    `];
  }
  if (role === "first-download") {
    return [`UPDATE jobtread_exports SET status = 'downloaded', downloaded_by = ${q(params.downloaderId)}, downloaded_at = ${q(params.downloadedAt)}, updated_at = ${q(params.downloadedAt)} WHERE id = ${q(params.exportRowId)};`];
  }
  if (role === "revoke") {
    return [
      `UPDATE estimate_drafts SET status = 'internal_approval_revoked', updated_at = now() WHERE id = ${q(params.draftId)};`,
      `INSERT INTO estimate_internal_approval_revocations (id, tenant_id, project_id, client_id, estimate_draft_id, approval_id, request_id, request_hash, revoked_by, reason, contract_version)
       VALUES (${q(params.revocationId)}, ${q(params.tenantId)}, ${q(params.projectId)}, ${q(params.clientId)}, ${q(params.draftId)}, ${q(params.approvalId)}, ${q(params.requestId)}, ${q(params.requestHash)}, ${q(params.actorId)}, ${q(params.reason)}, 'internal-approval-revocation-v1');`,
    ];
  }
  if (role === "supersede") {
    // A real, valid cloned sibling row — not a hand-typed row claiming to satisfy
    // the lineage/backpointer checks. to_jsonb(row) || overrides, then
    // jsonb_populate_record, lets Postgres itself do every column's real type
    // coercion (jsonb sub-columns included) rather than re-deriving column types
    // in this script. status is forced to 'draft' (structr_guard_approved_estimate
    // forbids a FRESH insert claiming an already-reviewed status) and the
    // approval/lock/rejection fields are cleared to match a genuinely new,
    // not-yet-reviewed version draft.
    return [`
      INSERT INTO estimate_drafts
      SELECT * FROM jsonb_populate_record(null::estimate_drafts,
        (to_jsonb((SELECT t FROM estimate_drafts t WHERE t.id = ${q(params.parentId)}))
          || jsonb_build_object(
               'id', ${q(params.childId)}::text, 'version', ${Number(params.parentVersion) + 1},
               'source', 'version', 'supersedes_id', ${q(params.parentId)}::text,
               'a1_version_request_id', ${q(params.requestId)}::text, 'a1_version_request_hash', ${q(params.requestHash)}::text,
               'created_by', ${q(params.actorId)}::text, 'superseded_by', null,
               'status', 'draft', 'approved_by', null, 'approved_at', null,
               'rejected_by', null, 'rejected_at', null, 'rejection_reason', null, 'locked_at', null,
               'created_at', now(), 'updated_at', now()
             )
        )
      );`,
      `UPDATE estimate_drafts SET superseded_by = ${q(params.childId)}, updated_at = now() WHERE id = ${q(params.parentId)};`,
    ];
  }
  throw new Error(`Unknown role: ${role}`);
}

async function main() {
  startPsql();
  try {
    // Verbose errors so a RAISE EXCEPTION ... USING CONSTRAINT='x' surfaces its
    // CONSTRAINT NAME on stderr — parseConstraint() below depends on this.
    await sendAndWait("\\set VERBOSITY verbose", "verbosity", SHORT_TIMEOUT_MS);
    await sendAndWait("BEGIN;", "begin", SHORT_TIMEOUT_MS);
    const pidErr = await sendAndWait("SELECT pg_backend_pid() AS a1_worker_pid \\gset", "getpid", SHORT_TIMEOUT_MS);
    if (pidErr.trim()) throw new Error(`failed to read backend pid: ${pidErr}`);
    psql.stdin.write("\\echo {\"event\":\"started\",\"pid\": :a1_worker_pid}\n");
    // The pid line above is its own, separately-recognizable JSON line on stdout —
    // read it directly rather than through the generic marker mechanism.
    const pidDeadline = Date.now() + SHORT_TIMEOUT_MS;
    let startedEvent = null;
    while (!startedEvent) {
      const m = stdoutBuf.match(/\{"event":"started","pid":\s*(\d+)\}/);
      if (m) { startedEvent = Number(m[1]); stdoutBuf = stdoutBuf.slice(stdoutBuf.indexOf(m[0]) + m[0].length); break; }
      if (Date.now() > pidDeadline) throw new Error("timed out reading started pid");
      await sleep(15);
    }
    emit({ event: "started", pid: startedEvent });

    const statements = writeStatementsFor();
    for (let i = 0; i < statements.length; i++) {
      emit({ event: "write_sent", index: i, total: statements.length });
      const err = await sendAndWait(statements[i], `write${i}`, BLOCKING_TIMEOUT_MS);
      if (err.trim()) {
        const constraint = parseConstraint(err);
        emit({ event: "write_failed", index: i, error: err.trim().slice(0, 4000), constraint_name: constraint });
        await sendAndWait("ROLLBACK;", "rollback", SHORT_TIMEOUT_MS).catch(() => {});
        emit({ event: "rejected", constraint_name: constraint, error: err.trim().slice(0, 4000) });
        const exited = await terminatePsqlAndWait();
        process.exit(exited ? 0 : 1); // never rely on natural event-loop drain to exit this process
      }
    }
    emit({ event: "write_done" });

    emit({ event: "set_constraints_sent" });
    const deferredErr = await sendAndWait("SET CONSTRAINTS ALL IMMEDIATE;", "deferred", BLOCKING_TIMEOUT_MS);
    if (deferredErr.trim()) {
      const constraint = parseConstraint(deferredErr);
      emit({ event: "deferred_checks_failed", error: deferredErr.trim().slice(0, 4000), constraint_name: constraint });
      await sendAndWait("ROLLBACK;", "rollback", SHORT_TIMEOUT_MS).catch(() => {});
      emit({ event: "rejected", constraint_name: constraint, error: deferredErr.trim().slice(0, 4000) });
      const exited = await terminatePsqlAndWait();
      process.exit(exited ? 0 : 1);
    }
    emit({ event: "deferred_checks_done" });

    // The harness — never a sleep — controls exactly how long this transaction
    // stays open from here, by writing one literal "RELEASE" line to this
    // worker's OWN stdin whenever it has finished observing the real, held lock.
    // V5 fix (§4): the V4 version only handled the "RELEASE" line, with no bound
    // at all — a cancellation or a hung orchestrator would hold this transaction
    // (and its real lock) open forever. Bounded via RELEASE_TIMEOUT_MS below.
    // Cancellation is handled by the SIGTERM handler at the bottom of this file
    // (a real, reliable signal) rather than by watching this readline's own
    // "close" event for stdin EOF — that was tried and reverted: in the real
    // three-process chain this worker actually runs under (runner → vitest pool
    // worker → this script), readline's "close" on `process.stdin` was observed
    // firing spuriously (~200ms in, stdin otherwise reporting healthy/open)
    // well before the parent's real "RELEASE" write ever arrived, which is not
    // safe to treat as a genuine EOF signal in this environment.
    const released = await new Promise(resolve => {
      const rl = createInterface({ input: process.stdin });
      const timer = setTimeout(() => { rl.close(); resolve("timeout"); }, RELEASE_TIMEOUT_MS);
      rl.on("line", line => { if (line.trim() === "RELEASE") { clearTimeout(timer); rl.close(); resolve("released"); } });
    });
    if (released !== "released") {
      emit({ event: "release_not_received", reason: released });
      await sendAndWait("ROLLBACK;", "rollback", SHORT_TIMEOUT_MS).catch(() => {});
      emit({ event: "rejected", constraint_name: null, error: `worker cancelled: RELEASE never received (${released})` });
      const exited = await terminatePsqlAndWait();
      process.exit(exited ? 0 : 1);
    }

    const commitErr = await sendAndWait("COMMIT;", "commit", SHORT_TIMEOUT_MS);
    if (commitErr.trim()) {
      emit({ event: "rejected", constraint_name: parseConstraint(commitErr), error: commitErr.trim().slice(0, 4000) });
    } else {
      emit({ event: "committed" });
    }
    const exited = await terminatePsqlAndWait(); // readline above can otherwise keep this process's event loop alive indefinitely
    process.exit(exited ? 0 : 1);
  } catch (error) {
    emit({ event: "worker_error", error: String(error?.stack ?? error) });
    try { psql.stdin.write("ROLLBACK;\n"); } catch { /* best effort */ }
    const exited = await terminatePsqlAndWait();
    process.exit(exited ? 1 : 1);
  }
}

// V5 fix (§4): "Caminhos de sinal não coordenam explicitamente seu psql" — the V4
// worker had no signal handling of its own, so a SIGTERM/SIGKILL from the
// orchestrator (e.g. killIfAlive) killed this process abruptly without ever
// rolling back or confirming its OWN psql child's exit, risking an orphaned
// backend holding its transaction open. SIGTERM now rolls back and confirms
// psql's exit before this process exits; a SIGKILL sent directly to this
// process cannot be intercepted (same as any process) — the orchestrator's own
// ownership-scoped cleanup of the lab cluster remains the final backstop.
process.on("SIGTERM", async () => {
  emit({ event: "worker_signalled", signal: "SIGTERM" });
  try { if (psql && psql.exitCode === null) { try { psql.stdin.write("ROLLBACK;\n"); } catch { /* best effort */ } await terminatePsqlAndWait(); } }
  finally { process.exit(1); }
});

main();
