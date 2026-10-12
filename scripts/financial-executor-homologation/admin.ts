/** Offline-reviewed administrative candidate. Caller owns/attests the DB connection.
 * No env, connection factory, Auth, RBAC bootstrap, SQL installer or runtime import.
 * Mutations require a separately confirmed target, source and protected manifest.
 */
import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logAudit } from "../../server/audit";
import {
  canonical,
  hash,
  fail,
  parseCalculatorHomologationManifest,
  planCalculatorHomologation,
  CATALOG_SHA256,
  LOGIN_ROLE,
  OPERATIONS,
  SYNTHETIC_IDS as I,
  type CalculatorHomologationManifest,
} from "./contract";
import { fixturePlan, type FixtureRow } from "./fixture";
import {
  assertCalculatorBoundary as boundary,
  withCalculatorOwnerMaintenance,
} from "./boundary";
import {
  requireCurrentCalculatorCredential,
  type CalculatorCredentialReference,
} from "./credential-receipt";
import {
  type Tx,
  type Row,
  type Snapshot,
  query,
  role,
  operator,
  binding,
  receipt,
  checkedAudit,
  auditedInsert,
  completed,
  verifyPrepared,
  locked,
  requireOpenWindow,
  prefix,
  receiptTable,
} from "./admin-internal";
export async function preflightCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorHomologationManifest(value);
  return locked(db, m, async tx => {
    await boundary(tx);
    await operator(tx, m);
    return {
      ...planCalculatorHomologation(m),
      status: "preflight_passed" as const,
    };
  });
}
export async function prepareCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorHomologationManifest(value);
  return locked(db, m, async (tx, actor) => {
    const b = await binding(tx);
    if (b && !b.is_active) fail("TERMINAL");
    await boundary(tx);
    const existing = await receipt(tx, m, "prepare");
    if (existing) {
      await verifyPrepared(tx, m);
      return {
        ...planCalculatorHomologation(m),
        status: "replayed" as const,
        receiptId: existing.id,
      };
    }
    if (b) fail("COLLISION");
    const login = await role(tx);
    if (login.rolcanlogin) fail("LOGIN_ALREADY_OPEN");
    if (
      (
        await query(
          tx,
          sql`SELECT pid FROM pg_stat_activity WHERE usename=${LOGIN_ROLE}`
        )
      ).length
    )
      fail("EXISTING_SESSIONS");
    const prerequisites = await operator(tx, m);
    const [clock] = await query(tx, sql`SELECT transaction_timestamp() AS at`);
    const at = new Date(clock.at).toISOString(),
      plan = fixturePlan(m, at, prerequisites.settings),
      rows: Snapshot[] = [];
    for (const e of plan.rows) rows.push(await auditedInsert(tx, m, actor, e));
    rows.push(
      await auditedInsert(tx, m, actor, {
        table: "structr_financial.principal_bindings",
        row: {
          id: I.binding,
          session_role: LOGIN_ROLE,
          subject: m.operator.subject,
          actor_id: m.operator.actorId,
          tenant_id: m.operator.tenantId,
          operations: OPERATIONS,
        },
      })
    );
    const [digest] = await query(
      tx,
      sql`SELECT encode(sha256(convert_to(${JSON.stringify(plan.manifest)}::jsonb::text,'UTF8')),'hex') AS hash`
    );
    const event = {
      contractVersion: "calculator-fixture-v1",
      bindingId: I.binding,
      tenantId: m.operator.tenantId,
      actorId: m.operator.actorId,
      fixtureId: I.fixture,
      projectId: I.project,
      intakeFormId: I.intake,
      clientId: I.client,
      manifestHash: digest.hash,
      manifest: plan.manifest,
    };
    // The frozen SQL contract requires this provenance projection attributed to O.
    // The separate row/operation audits record the true administrative session.
    const provenance = await checkedAudit(tx, {
      userId: m.operator.actorId,
      action: "financial.calculator.fixture.create",
      tableName: "calculator_fixtures",
      recordId: I.fixture,
      before: null,
      after: event,
    });
    rows.push(
      await auditedInsert(tx, m, actor, {
        table: "structr_financial.calculator_fixtures",
        row: {
          id: I.fixture,
          binding_id: I.binding,
          tenant_id: m.operator.tenantId,
          actor_id: m.operator.actorId,
          project_id: I.project,
          intake_form_id: I.intake,
          client_id: I.client,
          manifest: plan.manifest,
          manifest_hash: digest.hash,
          provenance_audit_id: provenance,
        },
      })
    );
    const id = await completed(tx, m, actor, "prepare", null, {
      at,
      rows,
      prerequisites,
      role: login,
    });
    await verifyPrepared(tx, m);
    return {
      ...planCalculatorHomologation(m),
      status: "prepared" as const,
      receiptId: id,
    };
  });
}
export async function openCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown,
  expectedCredential?: CalculatorCredentialReference
) {
  const m = parseCalculatorHomologationManifest(value);
  return locked(db, m, async (tx, actor) => {
    if ((await binding(tx))?.is_active === false) fail("TERMINAL");
    await boundary(tx);
    await verifyPrepared(tx, m);
    await requireOpenWindow(tx, m);
    const credential = await requireCurrentCalculatorCredential(
      tx,
      m,
      expectedCredential
    );
    const before = await role(tx),
      previous = await receipt(tx, m, "open");
    if (previous) {
      if (
        canonical(previous.new_values.state.role) !== canonical(before) ||
        canonical(previous.new_values.state.credential) !==
          canonical(credential)
      )
        fail("STATE_DRIFT");
      await requireOpenWindow(tx, m);
      return {
        ...planCalculatorHomologation(m),
        status: "replayed" as const,
        receiptId: previous.id,
      };
    }
    if (before.rolcanlogin) fail("LOGIN_ALREADY_OPEN");
    if (
      (
        await query(
          tx,
          sql`SELECT pid FROM pg_stat_activity WHERE usename=${LOGIN_ROLE}`
        )
      ).length
    )
      fail("EXISTING_SESSIONS");
    // A strict ISO date is the sole interpolated DDL literal. The role is fixed.
    await tx.execute(
      sql.raw(
        `ALTER ROLE structr_calculator_login_v1 LOGIN CONNECTION LIMIT 2 VALID UNTIL '${new Date(m.window.closesAt).toISOString()}'`
      )
    );
    const after = await role(tx);
    if (
      !after.rolcanlogin ||
      after.rolconnlimit !== 2 ||
      Date.parse(after.rolvaliduntil) !== Date.parse(m.window.closesAt)
    )
      fail("ROLE_TRANSITION");
    const receiptId = await completed(
      tx,
      m,
      actor,
      "open",
      { role: before, credential },
      { role: after, credential }
    );
    // Include time spent waiting on DDL/audit locks in the activation decision.
    // This is the final database read before the transaction can commit.
    await requireOpenWindow(tx, m);
    return {
      ...planCalculatorHomologation(m),
      status: "opened" as const,
      receiptId,
    };
  });
}
/** W1 is a durable binding-only revocation. W2 may now prove authorization refusal
 * over an existing connection before EXECUTE/LOGIN/session transport cleanup. */
export async function deactivateCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorHomologationManifest(value);
  return locked(db, m, async (tx, actor) => {
    await verifyPrepared(tx, m, { allowTerminal: true, checkSources: false });
    const before = await binding(tx),
      previous = await receipt(tx, m, "deactivate");
    if (previous) {
      if (
        before?.is_active ||
        canonical(before) !== canonical(previous.new_values.state.binding)
      )
        fail("CLOSURE_DRIFT");
      return {
        ...planCalculatorHomologation(m),
        status: "deactivated" as const,
        receiptId: previous.id,
        bindingTerminal: true as const,
      };
    }
    if (!before?.is_active) fail("CLOSURE_DRIFT");
    await tx.execute(
      sql`UPDATE structr_financial.principal_bindings SET is_active=false,updated_at=clock_timestamp() WHERE id=${I.binding}::uuid`
    );
    const after = await binding(tx);
    if (
      !after ||
      after.is_active ||
      canonical({
        ...after,
        is_active: before.is_active,
        updated_at: before.updated_at,
      }) !== canonical(before)
    )
      fail("CLOSURE_DRIFT");
    const receiptId = await completed(
      tx,
      m,
      actor,
      "deactivate",
      { binding: before },
      { binding: after }
    );
    return {
      ...planCalculatorHomologation(m),
      status: "deactivated" as const,
      receiptId,
      bindingTerminal: true as const,
    };
  });
}
async function nominalExecute(tx: Tx) {
  return query(
    tx,
    sql`SELECT p.oid::regprocedure::text AS routine,has_function_privilege(${LOGIN_ROLE},p.oid,'EXECUTE') AS allowed FROM pg_proc p WHERE p.oid=ANY(ARRAY['structr_financial.calculator_context_v1(jsonb)'::regprocedure::oid,'structr_financial.calculator_snapshot_v1(jsonb)'::regprocedure::oid,'structr_financial.calculator_create_v1(jsonb,jsonb)'::regprocedure::oid,'structr_financial.calculator_recover_v1(jsonb)'::regprocedure::oid]) ORDER BY p.oid::regprocedure::text`
  );
}
async function maintenanceMemberships(tx: Tx) {
  return query(
    tx,
    sql`SELECT r.rolname,m.member::regrole::text AS member,m.grantor::regrole::text AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('structr_calculator_login_v1','structr_calculator_read_owner_v1','structr_calculator_write_owner_v1') ORDER BY r.rolname,m.member::regrole::text,m.grantor::regrole::text`
  );
}
/** Close durably first. Session cleanup can be retried after a lost reply/failure.
 * VALID UNTIL limits password authentication only; it does not terminate sessions.
 * Withdrawal deliberately remains available after O/RBAC/catalog drift.
 */
export async function withdrawCalculatorHomologation(
  db: PostgresJsDatabase,
  value: unknown
) {
  const m = parseCalculatorHomologationManifest(value);
  await deactivateCalculatorHomologation(db, m);
  const closure = await locked(db, m, async (tx, actor) => {
    await verifyPrepared(tx, m, { allowTerminal: true, checkSources: false });
    const b = await binding(tx),
      before = await role(tx),
      executeBefore = await nominalExecute(tx),
      membershipsBefore = await maintenanceMemberships(tx),
      previous = await receipt(tx, m, "withdraw");
    if (previous) {
      if (
        before.rolcanlogin ||
        b?.is_active ||
        executeBefore.some(r => r.allowed) ||
        canonical(previous.new_values.state.maintenance.after) !==
          canonical(membershipsBefore) ||
        canonical(previous.new_values.state.binding) !== canonical(b) ||
        canonical(previous.new_values.state.role) !== canonical(before) ||
        canonical(previous.new_values.state.execute) !==
          canonical(executeBefore)
      )
        fail("CLOSURE_DRIFT");
      return { receiptId: previous.id };
    }
    await tx.execute(
      sql.raw("ALTER ROLE structr_calculator_login_v1 NOLOGIN PASSWORD NULL")
    );
    const maintenance = {
      before: membershipsBefore,
      during: [] as Row[],
      after: [] as Row[],
    };
    await withCalculatorOwnerMaintenance(tx, async () => {
      maintenance.during = await maintenanceMemberships(tx);
      await tx.execute(
        sql.raw(
          "REVOKE EXECUTE ON FUNCTION structr_financial.calculator_context_v1(jsonb),structr_financial.calculator_snapshot_v1(jsonb),structr_financial.calculator_create_v1(jsonb,jsonb),structr_financial.calculator_recover_v1(jsonb) FROM structr_calculator_login_v1"
        )
      );
    });
    maintenance.after = await maintenanceMemberships(tx);
    const after = {
      binding: await binding(tx),
      role: await role(tx),
      execute: await nominalExecute(tx),
      passwordCleared: true,
      maintenance,
    };
    if (
      after.binding?.is_active ||
      after.role.rolcanlogin ||
      after.execute.length !== 4 ||
      after.execute.some(r => r.allowed)
    )
      fail("CLOSURE_DRIFT");
    return {
      receiptId: await completed(
        tx,
        m,
        actor,
        "withdraw",
        {
          binding: b,
          role: before,
          execute: executeBefore,
          memberships: membershipsBefore,
        },
        after
      ),
    };
  });
  try {
    const attempt = await locked(db, m, async (tx, actor) => {
      // Re-read after obtaining the lock: a prior withdrawal may have completed
      // between this call's durable closure and session-cleanup phase.
      const sessions = await query(
        tx,
        sql`SELECT pid,backend_start::text AS "backendStart" FROM pg_stat_activity WHERE usename=${LOGIN_ROLE} AND pid<>pg_backend_pid() ORDER BY pid`
      );
      const pending = await query(
        tx,
        sql`SELECT a.id,a.user_id,a.table_name,a.old_values,a.new_values FROM public.audit_logs a WHERE a.action=${prefix + "withdraw.sessions.requested"} AND a.record_id=${m.operationId} AND NOT EXISTS(SELECT 1 FROM public.audit_logs done WHERE done.action=${prefix + "withdraw.sessions.completed"} AND done.record_id=${m.operationId} AND done.new_values->>'requestAuditId'=a.id::text) ORDER BY a.created_at FOR SHARE`
      );
      if (pending.length) {
        const p = pending[0];
        if (
          p.user_id !== null ||
          p.table_name !== receiptTable ||
          p.old_values !== null ||
          p.new_values.operationId !== m.operationId ||
          p.new_values.manifestHash !== hash(m) ||
          p.new_values.closureReceiptId !== closure.receiptId ||
          canonical(p.new_values.administrativeActor) !== canonical(actor) ||
          !Array.isArray(p.new_values.sessions) ||
          p.new_values.afterHash !== hash(p.new_values.sessions) ||
          p.new_values.sessions.some(
            (s: Row) =>
              !Number.isSafeInteger(s.pid) ||
              s.pid <= 0 ||
              typeof s.backendStart !== "string" ||
              !Number.isFinite(Date.parse(s.backendStart))
          )
        )
          fail("EVIDENCE");
        return { id: p.id, sessions: p.new_values.sessions as Row[] };
      }
      if (!sessions.length) return null;
      if (
        sessions.some(
          s =>
            !Number.isSafeInteger(s.pid) ||
            s.pid <= 0 ||
            typeof s.backendStart !== "string" ||
            !Number.isFinite(Date.parse(s.backendStart))
        )
      )
        fail("SESSION_IDENTITY_UNAVAILABLE");
      const id = await checkedAudit(tx, {
        userId: null,
        action: prefix + "withdraw.sessions.requested",
        tableName: receiptTable,
        recordId: m.operationId,
        before: null,
        after: {
          operationId: m.operationId,
          manifestHash: hash(m),
          administrativeActor: actor,
          sessions,
          closureReceiptId: closure.receiptId,
          afterHash: hash(sessions),
        },
      });
      return { id, sessions };
    });
    if (attempt) {
      for (const session of attempt.sessions)
        await query(
          db,
          sql`SELECT pg_terminate_backend(pid,1000) AS terminated FROM pg_stat_activity WHERE usename=${LOGIN_ROLE} AND pid=${session.pid} AND backend_start=${session.backendStart}::timestamptz AND pid<>pg_backend_pid()`
        );
    }
    const remaining = await query(
      db,
      sql`SELECT pid,backend_start::text AS "backendStart" FROM pg_stat_activity WHERE usename=${LOGIN_ROLE} ORDER BY pid`
    );
    if (attempt)
      await locked(db, m, async (tx, actor) => {
        const done = await query(
          tx,
          sql`SELECT to_jsonb(a.*) AS row FROM public.audit_logs a WHERE action=${prefix + "withdraw.sessions.completed"} AND record_id=${m.operationId} AND new_values->>'requestAuditId'=${attempt.id} FOR SHARE`
        );
        if (done.length > 1) fail("EVIDENCE");
        if (done.length) {
          const a = done[0].row,
            v = a.new_values;
          if (
            a.user_id !== null ||
            a.table_name !== receiptTable ||
            v.manifestHash !== hash(m) ||
            canonical(v.administrativeActor) !== canonical(actor) ||
            v.beforeHash !== hash(attempt.sessions) ||
            v.afterHash !== hash(v.remainingSessions) ||
            canonical(a.old_values) !==
              canonical({ sessions: attempt.sessions })
          )
            fail("EVIDENCE");
          return;
        }
        await checkedAudit(tx, {
          userId: null,
          action: prefix + "withdraw.sessions.completed",
          tableName: receiptTable,
          recordId: m.operationId,
          before: { sessions: attempt.sessions },
          after: {
            operationId: m.operationId,
            manifestHash: hash(m),
            administrativeActor: actor,
            requestAuditId: attempt.id,
            remainingSessions: remaining,
            beforeHash: hash(attempt.sessions),
            afterHash: hash(remaining),
          },
        });
      });
    return {
      ...planCalculatorHomologation(m),
      ...closure,
      status:
        remaining.length === 0
          ? ("withdrawn" as const)
          : ("cleanup_pending" as const),
      bindingTerminal: true,
      loginClosed: true,
      remainingSessions: remaining.length,
      cleanupReason: remaining.length ? ("sessions_remaining" as const) : null,
    };
  } catch (error) {
    return {
      ...planCalculatorHomologation(m),
      ...closure,
      status: "cleanup_pending" as const,
      bindingTerminal: true,
      loginClosed: true,
      remainingSessions: null,
      cleanupReason:
        error instanceof Error &&
        error.message === "CALCULATOR_HOMOLOGATION_SESSION_IDENTITY_UNAVAILABLE"
          ? ("session_identity_unavailable" as const)
          : ("session_cleanup_failed" as const),
    };
  }
}
