/** Owned disposable PostgreSQL only; real admin transactions and nominal SQL identity. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { startFinancialCalculatorBoundary } from "./test-support/financial-calculator-boundary";
import { SYNTHETIC_IDS as I } from "../scripts/financial-executor-homologation/contract";
import {
  prepareCalculatorPilot,
  openCalculatorPilot,
  deactivateCalculatorPilot,
  withdrawCalculatorPilot,
} from "../scripts/financial-executor-homologation/orchestration";
import {
  signedExecutorAuthFixture,
  executorTestConfig,
} from "./test-support/financial-executor-auth";
import { createExecutorTransactionRunner } from "../services/financial-executor/src/transaction";
const enabled = process.env.FINANCIAL_CALCULATOR_HOMOLOGATION_PHYSICAL === "1";
describe.skipIf(!enabled)(
  "paired Calculator administration on owned PG17",
  () => {
    let lab:
      | Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>
      | undefined;
    let sharedAuthority = false;
    afterEach(async () => {
      if (sharedAuthority) return;
      await lab?.stop();
      lab = undefined;
    }, 30000);
    async function setup(nonSuper = false) {
      lab = await startFinancialCalculatorBoundary();
      let administrative = lab.cluster.observer;
      if (nonSuper) {
        const source = await readFile(
          new URL(
            "./test-support/financial-calculator-boundary/managed-provider-fixture.sql",
            import.meta.url
          ),
          "utf8"
        );
        await lab.admin.unsafe(
          source.slice(
            0,
            source.indexOf("END $fixture$;") + "END $fixture$;".length
          )
        );
        administrative = await lab.cluster.connect(
          "coordinator-maintenance",
          "postgres"
        );
        await administrative.sql.begin(async tx =>
          tx.unsafe(
            await readFile(
              new URL(
                "../drizzle/0020_closed_financial_calculator_boundary.sql",
                import.meta.url
              ),
              "utf8"
            )
          )
        );
      } else await lab.install();
      await administrative.sql.begin(async tx =>
        tx.unsafe(
          await readFile(
            new URL(
              "../drizzle/0021_financial_calculator_lifecycle.sql",
              import.meta.url
            ),
            "utf8"
          )
        )
      );
      const fixture = {
        version: "calculator-homologation-v1",
        operationId: "c8000000-0000-4000-8000-000000000001",
        sourceCommit: "a".repeat(40),
        expectedDatabase: "postgres",
        expectedPrincipal: nonSuper ? "postgres" : "app_principal_runner",
        operator: {
          subject: executorTestConfig.auth.operatorSubject,
          actorId: executorTestConfig.auth.actorId,
          tenantId: executorTestConfig.auth.tenantId,
        },
        window: {
          opensAt: new Date(Date.now() - 60000).toISOString(),
          closesAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };
      const m = {
        fixture,
        rbac: {
          ...fixture,
          version: "calculator-homologation-rbac-v1",
          operationId: "c8000000-0000-4000-8000-000000000002",
          operator: { ...fixture.operator, originalRole: "user" },
          nominalRole: "calculator_pilot_operator_v1",
          permissionMode: "create-absent",
          ids: {
            permission: "c8310000-0000-4000-8000-000000000001",
            role: "c8310000-0000-4000-8000-000000000002",
            edge: "c8310000-0000-4000-8000-000000000003",
          },
        },
      };
      await lab.admin`INSERT INTO tenants(id,name,slug,timezone) VALUES(${fixture.operator.tenantId},'Synthetic paired tenant','paired','America/New_York')`;
      await lab.admin`INSERT INTO profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${fixture.operator.actorId},${fixture.operator.tenantId},${fixture.operator.subject},'user',true)`;
      await lab.admin`INSERT INTO tenant_settings(id,tenant_id,profit_shield_overrides,geo_floor_overrides) VALUES('c9000000-0000-4000-8000-000000000006',${fixture.operator.tenantId},'{}','{}')`;
      return {
        m,
        db: administrative.db,
        admin: lab.admin,
        cluster: lab.cluster,
      };
    }
    function broken(
      db: PostgresJsDatabase,
      predicate: (action: string) => boolean
    ) {
      return {
        transaction: (fn: any, options: any) =>
          db.transaction(
            tx =>
              fn(
                new Proxy(tx, {
                  get(target, p) {
                    if (p === "insert")
                      return (...args: any[]) => {
                        const builder = (target.insert as any)(...args);
                        return new Proxy(builder, {
                          get(b, k) {
                            if (k === "values")
                              return (value: any) => {
                                if (predicate(value.action))
                                  throw new Error("INJECTED_AUDIT_FAILURE");
                                return b.values(value);
                              };
                            return Reflect.get(b, k);
                          },
                        });
                      };
                    const v = Reflect.get(target, p);
                    return typeof v === "function" ? v.bind(target) : v;
                  },
                })
              ),
            options
          ),
        execute: db.execute.bind(db),
      } as PostgresJsDatabase;
    }
    it("commits paired receipts, enforces two sessions, proves W2 authorization with valid bearer, then restores RBAC terminally", async () => {
      const { m, db, admin, cluster } = await setup();
      const prepared = await prepareCalculatorPilot(db, m);
      expect(prepared.status).toBe("prepared");
      expect(prepared.receipts.fixture).toMatch(/^[0-9a-f-]{36}$/);
      expect(prepared.receipts.rbac).toMatch(/^[0-9a-f-]{36}$/);
      expect((await prepareCalculatorPilot(db, m)).receipts).toEqual(
        prepared.receipts
      );
      expect((await openCalculatorPilot(db, m)).status).toBe("opened");
      const [audit] =
        await admin`SELECT old_values,new_values FROM audit_logs WHERE action='financial.homologation.open.completed'`;
      expect(audit.old_values.role.rolconnlimit).toBe(-1);
      expect(audit.new_values.state.role.rolconnlimit).toBe(2);
      const one = await cluster.connect(
        "coordinator-one",
        "structr_calculator_login_v1"
      );
      await cluster.connect("coordinator-two", "structr_calculator_login_v1");
      await expect(
        cluster.connect("coordinator-third", "structr_calculator_login_v1")
      ).rejects.toMatchObject({ code: "53300" });
      const auth = await signedExecutorAuthFixture({
        nowMs: Date.now,
        expiresAtMs: Date.now() + 600000,
      });
      const runner = createExecutorTransactionRunner(executorTestConfig, {
        database: one.db,
        nowMs: Date.now,
      });
      const command = {
        contractVersion: "calculator-v1",
        operation: "calculator.context",
        projectId: I.project,
        intakeFormId: I.intake,
      };
      expect(
        await runner.run(
          await auth.authenticator.authenticate(auth.request),
          command,
          async () => "authorized"
        )
      ).toBe("authorized");
      expect(await deactivateCalculatorPilot(db, m)).toMatchObject({
        status: "deactivated",
        bindingTerminal: true,
      });
      const [phase] =
        await admin`SELECT (SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1') login,has_function_privilege('structr_calculator_login_v1','structr_financial.calculator_context_v1(jsonb)','EXECUTE') executable,(SELECT count(*)::int FROM pg_stat_activity WHERE usename='structr_calculator_login_v1') sessions`;
      expect(phase).toEqual({ login: true, executable: true, sessions: 2 });
      // Reauthenticate the SAME still-valid bearer. Existing connection reaches authorize_v1.
      const verified = await auth.authenticator.authenticate(auth.request);
      await expect(
        runner.run(verified, command, async () => "unexpected")
      ).rejects.toMatchObject({
        code: "FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH",
      });
      for (const op of [
        "calculator.context",
        "calculator.calculate",
        "calculator.create",
        "calculator.recover",
      ]) {
        const c = {
          ...command,
          operation: op,
          ...(["calculator.calculate", "calculator.create"].includes(op)
            ? { assemblies: [{ assemblyId: I.a, quantity: 1 }] }
            : {}),
          ...(["calculator.create", "calculator.recover"].includes(op)
            ? { requestId: "c9000000-0000-4000-8000-000000000088" }
            : {}),
          ...(op === "calculator.create"
            ? {
                expectedSourceHash: "a".repeat(64),
                expectedCalculationHash: "b".repeat(64),
              }
            : {}),
        };
        const routine =
          op === "calculator.context"
            ? "calculator_context_v1"
            : op === "calculator.calculate"
              ? "calculator_snapshot_v1"
              : op === "calculator.create"
                ? "calculator_create_v1"
                : "calculator_recover_v1";
        let refusal: any;
        try {
          await one.db.transaction(
            tx =>
              tx.execute(
                sql.raw(
                  `SELECT structr_financial.${routine}('${JSON.stringify(c)}'::jsonb${op === "calculator.create" ? ",'{}'::jsonb" : ""})`
                )
              ),
            { isolationLevel: "serializable" }
          );
        } catch (e) {
          refusal = (e as any).cause ?? e;
        }
        expect(refusal).toMatchObject({ code: "42501", message: "FORBIDDEN" });
      }
      const result = await withdrawCalculatorPilot(db, m);
      expect(result).toMatchObject({
        status: "withdrawn",
        rbacRestored: true,
        financial: {
          bindingTerminal: true,
          loginClosed: true,
          remainingSessions: 0,
        },
      });
      expect(
        (
          await admin`SELECT role FROM profiles WHERE id=${m.fixture.operator.actorId}`
        )[0].role
      ).toBe("user");
      expect(await admin`SELECT 1 FROM roles WHERE name='user'`).toHaveLength(
        0
      );
      expect(await admin`SELECT 1 FROM role_permissions`).toHaveLength(0);
      for (const name of [
        "calculator_context_v1(jsonb)",
        "calculator_snapshot_v1(jsonb)",
        "calculator_create_v1(jsonb,jsonb)",
        "calculator_recover_v1(jsonb)",
      ])
        expect(
          (
            await admin`SELECT has_function_privilege('structr_calculator_login_v1',${"structr_financial." + name},'EXECUTE') allowed`
          )[0].allowed
        ).toBe(false);
      await expect(
        cluster.connect("coordinator-after", "structr_calculator_login_v1")
      ).rejects.toMatchObject({ code: "28000" });
      const before = await admin`SELECT count(*)::int n FROM audit_logs`;
      expect((await withdrawCalculatorPilot(db, m)).status).toBe("withdrawn");
      expect(await admin`SELECT count(*)::int n FROM audit_logs`).toEqual(
        before
      );
      await expect(openCalculatorPilot(db, m)).rejects.toThrow("TERMINAL");
    }, 90000);
    it("compensates committed RBAC after fixture audit failure without inventing a fixture transaction commit", async () => {
      const { m, db, admin } = await setup();
      const r = await prepareCalculatorPilot(
        broken(db, a => a === "financial.homologation.prepare.row"),
        m
      );
      expect(r).toMatchObject({ status: "compensated", rbacRestored: true });
      expect(
        await admin`SELECT 1 FROM structr_financial.principal_bindings`
      ).toHaveLength(0);
      expect((await admin`SELECT role FROM profiles`)[0].role).toBe("user");
      expect(
        await admin`SELECT action FROM audit_logs WHERE action='financial.calculator.rbac.withdraw.completed'`
      ).toHaveLength(1);
    }, 90000);
    it("preserves durable closure on RBAC authority drift and permits idempotent cleanup after reviewed repair", async () => {
      const { m, db, admin } = await setup();
      await prepareCalculatorPilot(db, m);
      await openCalculatorPilot(db, m);
      await admin`UPDATE profiles SET role='foreign_role' WHERE id=${m.fixture.operator.actorId}`;
      expect(await withdrawCalculatorPilot(db, m)).toMatchObject({
        status: "cleanup_pending",
        rbacRestored: false,
        financial: { bindingTerminal: true, loginClosed: true },
      });
      expect((await admin`SELECT role FROM profiles`)[0].role).toBe(
        "foreign_role"
      );
      await admin`UPDATE profiles SET role='calculator_pilot_operator_v1' WHERE id=${m.fixture.operator.actorId}`;
      expect((await withdrawCalculatorPilot(db, m)).status).toBe("withdrawn");
    }, 90000);
    it("rolls back deactivation on suppressed audit, and compensates failed activation after committed fixture", async () => {
      const { m, db, admin } = await setup();
      await prepareCalculatorPilot(db, m);
      await expect(
        deactivateCalculatorPilot(
          broken(db, a => a === "financial.homologation.deactivate.completed"),
          m
        )
      ).rejects.toThrow("INJECTED_AUDIT_FAILURE");
      expect(
        (
          await admin`SELECT is_active FROM structr_financial.principal_bindings`
        )[0].is_active
      ).toBe(true);
      expect(
        await openCalculatorPilot(
          broken(db, a => a === "financial.homologation.open.completed"),
          m
        )
      ).toMatchObject({
        status: "compensated",
        rbacRestored: true,
        financial: { bindingTerminal: true, loginClosed: true },
      });
      expect(
        (
          await admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(false);
    }, 90000);
    it("compensates pre-open RBAC drift instead of leaving the prepared binding active", async () => {
      const { m, db, admin } = await setup();
      await prepareCalculatorPilot(db, m);
      await admin`UPDATE profiles SET role='foreign_role' WHERE id=${m.fixture.operator.actorId}`;
      expect(await openCalculatorPilot(db, m)).toMatchObject({
        status: "cleanup_pending",
        rbacRestored: false,
        financial: { bindingTerminal: true, loginClosed: true },
      });
    }, 90000);
    it("retries session cleanup without repeating deactivation or restoring financial authority", async () => {
      const { m, db, admin, cluster } = await setup();
      await prepareCalculatorPilot(db, m);
      await openCalculatorPilot(db, m);
      const live = await cluster.connect(
        "cleanup-survivor",
        "structr_calculator_login_v1"
      );
      const unavailable = {
        transaction: db.transaction.bind(db),
        execute: () => {
          throw new Error("TERMINATION_UNAVAILABLE");
        },
      } as unknown as PostgresJsDatabase;
      expect(await withdrawCalculatorPilot(unavailable, m)).toMatchObject({
        status: "cleanup_pending",
        rbacRestored: true,
        financial: { bindingTerminal: true, loginClosed: true },
      });
      expect(
        await admin`SELECT 1 FROM pg_stat_activity WHERE pid=${live.pid}`
      ).toHaveLength(1);
      expect((await withdrawCalculatorPilot(db, m)).status).toBe("withdrawn");
      expect(
        await admin`SELECT 1 FROM pg_stat_activity WHERE pid=${live.pid}`
      ).toHaveLength(0);
      for (const action of [
        "financial.homologation.deactivate.completed",
        "financial.homologation.withdraw.completed",
        "financial.calculator.rbac.withdraw.completed",
      ])
        expect(
          await admin`SELECT 1 FROM audit_logs WHERE action=${action}`
        ).toHaveLength(1);
    }, 90000);
    it("refuses a corrupted paired receipt without opening LOGIN", async () => {
      const { m, db, admin } = await setup();
      await prepareCalculatorPilot(db, m);
      await admin`UPDATE audit_logs SET new_values=jsonb_set(new_values,'{manifestHash}',to_jsonb(repeat('0',64))) WHERE action='financial.calculator.rbac.apply.completed'`;
      await expect(openCalculatorPilot(db, m)).rejects.toThrow("EVIDENCE");
      expect(
        (
          await admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(false);
    }, 90000);
    it("does not call missing preparation evidence a completed withdrawal after financial opening", async () => {
      const { m, db, admin } = await setup();
      await prepareCalculatorPilot(db, m);
      await openCalculatorPilot(db, m);
      await admin`DELETE FROM audit_logs WHERE action='financial.homologation.prepare.completed' AND record_id=${m.fixture.operationId}`;
      expect(await withdrawCalculatorPilot(db, m)).toMatchObject({
        status: "cleanup_pending",
        rbacRestored: false,
        financial: null,
      });
      expect(
        (
          await admin`SELECT is_active FROM structr_financial.principal_bindings WHERE id=${I.binding}`
        )[0].is_active
      ).toBe(true);
      expect(
        (
          await admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(true);
      expect(
        (
          await admin`SELECT role FROM profiles WHERE id=${m.fixture.operator.actorId}`
        )[0].role
      ).toBe("calculator_pilot_operator_v1");
      expect(
        await admin`SELECT 1 FROM audit_logs WHERE action='financial.calculator.rbac.withdraw.completed'`
      ).toHaveLength(0);
    }, 90000);
    it("withdraws as actual non-super postgres with audited transient owner membership and rollback", async () => {
      const { m, db, admin, cluster } = await setup(true);
      expect(
        (
          await db.execute(
            sql`SELECT session_user::text AS session,current_user::text AS current,rolsuper FROM pg_roles WHERE rolname=current_user`
          )
        )[0]
      ).toEqual({ session: "postgres", current: "postgres", rolsuper: false });
      expect((await prepareCalculatorPilot(db, m)).status).toBe("prepared");
      expect((await openCalculatorPilot(db, m)).status).toBe("opened");
      await cluster.connect(
        "non-super-withdraw-live",
        "structr_calculator_login_v1"
      );
      const memberships = () =>
        admin`SELECT roleid::regrole::text AS role,member::regrole::text AS member,grantor::regrole::text AS grantor,admin_option,inherit_option,set_option FROM pg_auth_members WHERE roleid IN ('structr_calculator_login_v1'::regrole,'structr_calculator_read_owner_v1'::regrole,'structr_calculator_write_owner_v1'::regrole) ORDER BY roleid,member,grantor`;
      const before = await memberships();
      expect(before).toHaveLength(3);
      await expect(
        withdrawCalculatorPilot(
          broken(db, a => a === "financial.homologation.withdraw.completed"),
          m
        )
      ).rejects.toThrow("INJECTED_AUDIT_FAILURE");
      expect(await memberships()).toEqual(before);
      expect(
        (
          await admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(true);
      expect(
        (
          await admin`SELECT has_function_privilege('structr_calculator_login_v1','structr_financial.calculator_context_v1(jsonb)','EXECUTE') AS allowed`
        )[0].allowed
      ).toBe(true);
      expect(await withdrawCalculatorPilot(db, m)).toMatchObject({
        status: "withdrawn",
        rbacRestored: true,
        financial: {
          bindingTerminal: true,
          loginClosed: true,
          remainingSessions: 0,
        },
      });
      expect(await memberships()).toEqual(before);
      const [receipt] =
        await admin`SELECT new_values FROM audit_logs WHERE action='financial.homologation.withdraw.completed'`;
      const evidence = receipt.new_values.state.maintenance;
      expect(evidence.before).toHaveLength(3);
      expect(evidence.during).toHaveLength(5);
      expect(evidence.after).toEqual(evidence.before);
      expect(
        evidence.during.filter((row: any) => row.grantor === "postgres")
      ).toHaveLength(2);
      expect(
        evidence.during
          .filter((row: any) => row.grantor === "postgres")
          .every(
            (row: any) =>
              row.inherit_option &&
              !row.set_option &&
              !row.admin_option &&
              row.member === "postgres"
          )
      ).toBe(true);
      expect(
        await admin`SELECT 1 FROM pg_stat_activity WHERE usename='structr_calculator_login_v1'`
      ).toHaveLength(0);
    }, 90000);
    it("does not persist an unusable cleanup intent when session start visibility is unavailable", async () => {
      const { m, db, admin, cluster } = await setup(true);
      await prepareCalculatorPilot(db, m);
      await openCalculatorPilot(db, m);
      await cluster.connect(
        "hidden-session-start",
        "structr_calculator_login_v1"
      );
      await admin.unsafe("REVOKE pg_monitor FROM postgres");
      const [hidden] = await db.execute(
        sql`SELECT backend_start FROM pg_stat_activity WHERE usename='structr_calculator_login_v1'`
      );
      expect(hidden.backend_start).toBeNull();
      expect(await withdrawCalculatorPilot(db, m)).toMatchObject({
        status: "cleanup_pending",
        financial: {
          bindingTerminal: true,
          loginClosed: true,
          cleanupReason: "session_identity_unavailable",
        },
      });
      expect(
        await admin`SELECT 1 FROM audit_logs WHERE action='financial.homologation.withdraw.sessions.requested'`
      ).toHaveLength(0);
      await admin.unsafe(
        "GRANT pg_monitor TO postgres WITH ADMIN TRUE,INHERIT TRUE,SET TRUE"
      );
      expect(await withdrawCalculatorPilot(db, m)).toMatchObject({
        status: "withdrawn",
        financial: { remainingSessions: 0 },
      });
    }, 90000);
    describe("actual nominal authorization after coordinated preparation", () => {
      let prepared: Awaited<ReturnType<typeof setup>>,
        caller: Awaited<
          ReturnType<Awaited<ReturnType<typeof setup>>["cluster"]["connect"]>
        >;
      const other = "c9200000-0000-4000-8000-000000000001",
        foreignTenant = "c9200000-0000-4000-8000-000000000002",
        otherPermission = "c9200000-0000-4000-8000-000000000003";
      beforeAll(async () => {
        sharedAuthority = true;
        prepared = await setup();
        const { admin, m, db, cluster } = prepared;
        await admin`INSERT INTO tenants(id,name,slug,timezone) VALUES(${foreignTenant},'Other synthetic tenant','other-authority','America/New_York')`;
        await admin`INSERT INTO profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${other},${m.fixture.operator.tenantId},'c9200000-0000-4000-8000-000000000004','user',true)`;
        await admin`INSERT INTO permissions(id,resource,action) VALUES(${otherPermission},'project','read')`;
        expect((await prepareCalculatorPilot(db, m)).status).toBe("prepared");
        await openCalculatorPilot(db, m);
        caller = await cluster.connect(
          "paired-authority",
          "structr_calculator_login_v1"
        );
      }, 90000);
      afterAll(async () => {
        await lab?.stop();
        lab = undefined;
        sharedAuthority = false;
      }, 30000);
      async function context() {
        return caller.db.transaction(
          tx =>
            tx.execute(
              sql`SELECT structr_financial.calculator_context_v1(${JSON.stringify({ contractVersion: "calculator-v1", operation: "calculator.context", projectId: I.project, intakeFormId: I.intake })}::jsonb) AS result`
            ),
          { isolationLevel: "serializable" }
        );
      }
      it.each([
        "malformed permission evidence",
        "contradictory tenant evidence",
      ])(
        "denies membership with %s even for the synthetic owner",
        async kind => {
          const { admin, m } = prepared,
            id = "c9200000-0000-4000-8000-000000000099";
          await admin`INSERT INTO project_members(id,tenant_id,project_id,user_id,project_role,permissions,is_active) VALUES(${id},${kind === "contradictory tenant evidence" ? foreignTenant : m.fixture.operator.tenantId},${I.project},${m.fixture.operator.actorId},'viewer',${kind === "malformed permission evidence" ? "{}" : "[]"}::jsonb,false)`;
          try {
            let failure: any;
            try {
              await context();
            } catch (e) {
              failure = (e as any).cause ?? e;
            }
            expect(failure).toMatchObject({
              code: "42501",
              message: "FORBIDDEN",
            });
          } finally {
            await admin`DELETE FROM project_members WHERE id=${id}`;
          }
          expect((await context())[0].result).toMatchObject({
            projectId: I.project,
            intakeFormId: I.intake,
          });
        }
      );
      it("retains existing owner authority despite an inactive read-only membership", async () => {
        const { admin, m } = prepared,
          id = "c9200000-0000-4000-8000-000000000099";
        await admin`INSERT INTO project_members(id,tenant_id,project_id,user_id,project_role,permissions,is_active) VALUES(${id},${m.fixture.operator.tenantId},${I.project},${m.fixture.operator.actorId},'viewer','["read"]'::jsonb,false)`;
        try {
          expect((await context())[0].result).toMatchObject({
            projectId: I.project,
            intakeFormId: I.intake,
          });
        } finally {
          await admin`DELETE FROM project_members WHERE id=${id}`;
        }
      });
      it("refuses a valid JWT from another nominal-role assignee against the actual O binding", async () => {
        const { admin } = prepared;
        await admin`UPDATE profiles SET role='calculator_pilot_operator_v1' WHERE id=${other}`;
        try {
          const config = {
            ...executorTestConfig,
            auth: {
              ...executorTestConfig.auth,
              operatorSubject: "c9200000-0000-4000-8000-000000000004",
              actorId: other,
            },
          };
          const auth = await signedExecutorAuthFixture({
            config,
            nowMs: Date.now,
          });
          const runner = createExecutorTransactionRunner(config, {
            database: caller.db,
            nowMs: Date.now,
          });
          await expect(
            runner.run(
              auth.operator,
              {
                contractVersion: "calculator-v1",
                operation: "calculator.context",
                projectId: I.project,
                intakeFormId: I.intake,
              },
              async () => "unexpected"
            )
          ).rejects.toMatchObject({
            code: "FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH",
          });
        } finally {
          await admin`UPDATE profiles SET role='user' WHERE id=${other}`;
        }
        expect((await context())[0].result).toMatchObject({
          projectId: I.project,
          intakeFormId: I.intake,
        });
      });
    });
  }
);
