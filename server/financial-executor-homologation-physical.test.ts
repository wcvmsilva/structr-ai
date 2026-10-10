/** Real owned PG17 only. No hosted manifest, credential or network destination. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { startFinancialCalculatorBoundary } from "./test-support/financial-calculator-boundary";
import {
  SYNTHETIC_IDS as I,
  planCalculatorHomologation,
} from "../scripts/financial-executor-homologation/contract";
import {
  preflightCalculatorHomologation as preflight,
  prepareCalculatorHomologation as prepare,
  openCalculatorHomologation as open,
  withdrawCalculatorHomologation as withdraw,
} from "../scripts/financial-executor-homologation/admin";
import {
  buildCalculatorResult,
  calculatorSnapshotSchema,
} from "../shared/financial-calculator-engine";
const enabled = process.env.FINANCIAL_CALCULATOR_HOMOLOGATION_PHYSICAL === "1";
describe.skipIf(!enabled)(
  "audited T8 administration on real PostgreSQL17",
  () => {
    let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>,
      db: PostgresJsDatabase,
      m: any,
      caller: Awaited<
        ReturnType<
          Awaited<
            ReturnType<typeof startFinancialCalculatorBoundary>
          >["cluster"]["connect"]
        >
      >;
    beforeAll(async () => {
      lab = await startFinancialCalculatorBoundary();
      await lab.install();
      await lab.admin.begin(async tx => {
        await tx.unsafe(
          await readFile(
            new URL(
              "../drizzle/0021_financial_calculator_lifecycle.sql",
              import.meta.url
            ),
            "utf8"
          )
        );
      });
      db = lab.cluster.observer.db;
      m = {
        version: "calculator-homologation-v1",
        operationId: "c8000000-0000-4000-8000-000000000001",
        sourceCommit: "9fb9f656" + "0".repeat(32),
        expectedDatabase: "postgres",
        expectedPrincipal: "app_principal_runner",
        operator: {
          subject: "c9000000-0000-4000-8000-000000000001",
          actorId: "c9000000-0000-4000-8000-000000000002",
          tenantId: "c9000000-0000-4000-8000-000000000003",
        },
        window: {
          opensAt: new Date(Date.now() - 30000).toISOString(),
          closesAt: new Date(Date.now() + 30 * 60000).toISOString(),
        },
      };
      await lab.admin`INSERT INTO public.tenants(id,name,slug,timezone) VALUES(${m.operator.tenantId},'Existing synthetic tenant','t8-existing','America/New_York')`;
      await lab.admin`INSERT INTO public.profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${m.operator.actorId},${m.operator.tenantId},${m.operator.subject},'t8_operator',true)`;
      await lab.admin`INSERT INTO public.roles(id,name) VALUES('c9000000-0000-4000-8000-000000000004','t8_operator')`;
      await lab.admin`INSERT INTO public.permissions(id,resource,action) VALUES('c9000000-0000-4000-8000-000000000005','estimate','create')`;
      await lab.admin`INSERT INTO public.role_permissions(role_id,permission_id) VALUES('c9000000-0000-4000-8000-000000000004','c9000000-0000-4000-8000-000000000005')`;
      await lab.admin`INSERT INTO public.tenant_settings(id,tenant_id,profit_shield_overrides,geo_floor_overrides) VALUES('c9000000-0000-4000-8000-000000000006',${m.operator.tenantId},'{}','{}')`;
    }, 90000);
    afterAll(async () => {
      await lab?.stop();
    }, 30000);
    async function counts() {
      const [r] =
        await lab.admin`SELECT (SELECT count(*)::int FROM structr_financial.principal_bindings) bindings,(SELECT count(*)::int FROM structr_financial.calculator_fixtures) fixtures,(SELECT count(*)::int FROM public.audit_logs) audits,(SELECT count(*)::int FROM public.projects) projects`;
      return r;
    }
    async function changed(
      before: string,
      after: string,
      fn: () => Promise<void>
    ) {
      await lab.admin.unsafe(before);
      try {
        await fn();
      } finally {
        await lab.admin.unsafe(after);
      }
    }
    it("preflights final approved catalog without any persistent mutation or activation", async () => {
      const before = await counts();
      expect(await preflight(db, m)).toMatchObject({
        status: "preflight_passed",
        catalogSha256: planCalculatorHomologation(m).catalogSha256,
        hostedReady: false,
      });
      expect(await counts()).toEqual(before);
      expect(
        (
          await lab.admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(false);
    });
    it("refuses mismatched administrative session identity", async () => {
      await expect(
        preflight(db, { ...m, expectedPrincipal: "postgres" })
      ).rejects.toThrow("PRINCIPAL_MISMATCH");
    });
    it("refuses missing O without provisioning or remapping it", async () => {
      const before = await counts();
      await expect(
        prepare(db, {
          ...m,
          operator: {
            ...m.operator,
            actorId: "c9000000-0000-4000-8000-000000000099",
          },
        })
      ).rejects.toThrow("OPERATOR");
      expect(await counts()).toEqual(before);
    });
    it("refuses O without estimate:create and leaves RBAC intact", async () => {
      await changed(
        "UPDATE public.profiles SET role='user'",
        "UPDATE public.profiles SET role='t8_operator'",
        async () => {
          await expect(prepare(db, m)).rejects.toThrow("OPERATOR");
          expect(
            await lab.admin`SELECT 1 FROM public.roles WHERE name='user'`
          ).toHaveLength(0);
        }
      );
    });
    it("refuses inactive O", async () => {
      await changed(
        "UPDATE public.profiles SET is_active=false",
        "UPDATE public.profiles SET is_active=true",
        async () => {
          await expect(preflight(db, m)).rejects.toThrow("OPERATOR");
        }
      );
    });
    it("refuses unknown tenant override policy instead of repairing it", async () => {
      await changed(
        `UPDATE public.tenant_settings SET profit_shield_overrides='{"premium":45}'`,
        `UPDATE public.tenant_settings SET profit_shield_overrides='{}'`,
        async () => {
          await expect(prepare(db, m)).rejects.toThrow("SETTINGS");
        }
      );
    });
    it.each([
      [
        "PUBLIC temporary",
        "GRANT TEMPORARY ON DATABASE postgres TO PUBLIC",
        "REVOKE TEMPORARY ON DATABASE postgres FROM PUBLIC",
      ],
      [
        "managed function NULL ACL",
        "CREATE SCHEMA managed_t8; CREATE FUNCTION managed_t8.exposed() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
        "DROP SCHEMA managed_t8 CASCADE",
      ],
      [
        "nonowner default ACL",
        "ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon",
        "ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM anon",
      ],
      [
        "login outside grants",
        "CREATE SCHEMA outside_t8; CREATE TABLE outside_t8.leak(id int); GRANT SELECT ON outside_t8.leak TO structr_calculator_login_v1",
        "DROP SCHEMA outside_t8 CASCADE",
      ],
      [
        "non-system pg name",
        "CREATE SCHEMA pgoutside; CREATE FUNCTION pgoutside.exposed() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",
        "DROP SCHEMA pgoutside CASCADE",
      ],
      [
        "role inheritance",
        "ALTER ROLE structr_calculator_login_v1 INHERIT",
        "ALTER ROLE structr_calculator_login_v1 NOINHERIT",
      ],
      [
        "role membership",
        "GRANT structr_calculator_login_v1 TO app_denied",
        "REVOKE structr_calculator_login_v1 FROM app_denied",
      ],
      [
        "catalog drift",
        "ALTER TABLE public.clients ADD COLUMN t8_drift text",
        "ALTER TABLE public.clients DROP COLUMN t8_drift",
      ],
    ] as const)("refuses %s without auto-repair", async (_, before, after) => {
      await changed(before, after, async () => {
        const state = await counts();
        await expect(prepare(db, m)).rejects.toThrow(
          "CALCULATOR_HOMOLOGATION_"
        );
        expect(await counts()).toEqual(state);
      });
    });
    it("cannot open before an audited preparation", async () => {
      await expect(open(db, m)).rejects.toThrow("NOT_PREPARED");
    });
    it("rolls back already inserted fixture rows when audit insertion fails", async () => {
      const before = await counts();
      const broken = {
        transaction: (callback: any, options: any) =>
          db.transaction(
            tx =>
              callback(
                new Proxy(tx, {
                  get(target, property) {
                    if (property === "insert")
                      return () => {
                        throw new Error("AUDIT_STORAGE_FAILURE");
                      };
                    const v = Reflect.get(target, property);
                    return typeof v === "function" ? v.bind(target) : v;
                  },
                })
              ),
            options
          ),
      } as PostgresJsDatabase;
      await expect(prepare(broken, m)).rejects.toThrow("AUDIT_STORAGE_FAILURE");
      expect(await counts()).toEqual(before);
    });
    it.each(["future", "expired"] as const)(
      "refuses %s activation window even with valid preparation",
      async kind => {
        await expect(
          db.transaction(
            async tx => {
              const shifted = {
                ...m,
                window:
                  kind === "future"
                    ? {
                        opensAt: new Date(Date.now() + 3600000).toISOString(),
                        closesAt: new Date(Date.now() + 5400000).toISOString(),
                      }
                    : {
                        opensAt: new Date(Date.now() - 3600000).toISOString(),
                        closesAt: new Date(Date.now() - 1800000).toISOString(),
                      },
              };
              const scoped = {
                transaction: (fn: any) => fn(tx),
              } as PostgresJsDatabase;
              await prepare(scoped, shifted);
              await expect(open(scoped, shifted)).rejects.toThrow("WINDOW");
              throw new Error("ROLLBACK_TEST");
            },
            { isolationLevel: "serializable" }
          )
        ).rejects.toThrow("ROLLBACK_TEST");
        expect(await counts()).toMatchObject({
          bindings: 0,
          fixtures: 0,
          projects: 0,
        });
      }
    );
    it("rolls back activation if its window expires during the role transition", async () => {
      await expect(
        db.transaction(
          async tx => {
            const windowed = {
              ...m,
              window: {
                opensAt: new Date(Date.now() - 60000).toISOString(),
                closesAt: new Date(Date.now() + 5000).toISOString(),
              },
            };
            const scoped = {
              transaction: (fn: any) => fn(tx),
            } as PostgresJsDatabase;
            await prepare(scoped, windowed);
            let crossed = false;
            const delayed = {
              transaction: (fn: any) =>
                fn(
                  new Proxy(tx, {
                    get(target, property) {
                      if (property === "execute")
                        return async (q: any) => {
                          const result = await target.execute(q);
                          if (
                            new PgDialect()
                              .sqlToQuery(q)
                              .sql.startsWith(
                                "ALTER ROLE structr_calculator_login_v1 LOGIN"
                              )
                          ) {
                            expect(Date.now()).toBeLessThan(
                              Date.parse(windowed.window.closesAt)
                            );
                            await new Promise(resolve =>
                              setTimeout(
                                resolve,
                                Date.parse(windowed.window.closesAt) -
                                  Date.now() +
                                  25
                              )
                            );
                            crossed = true;
                          }
                          return result;
                        };
                      const value = Reflect.get(target, property);
                      return typeof value === "function"
                        ? value.bind(target)
                        : value;
                    },
                  })
                ),
            } as PostgresJsDatabase;
            await expect(open(delayed, windowed)).rejects.toThrow("WINDOW");
            expect(crossed).toBe(true);
            throw new Error("ROLLBACK_TEST");
          },
          { isolationLevel: "serializable" }
        )
      ).rejects.toThrow("ROLLBACK_TEST");
      expect(
        (
          await lab.admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(false);
      expect(await counts()).toMatchObject({
        bindings: 0,
        fixtures: 0,
        projects: 0,
      });
    }, 15000);
    it("prepares fixed A/B/C with real administrative before/after evidence and NOLOGIN", async () => {
      const before = await counts();
      const [owned] =
        await lab.admin`SELECT current_setting('unix_socket_directories') AS socket,current_setting('port') AS port,current_setting('app_principal_lab.nonce') AS nonce`;
      expect(owned.socket.startsWith(lab.cluster.directory + "/")).toBe(true);
      const second = postgres({
        host: owned.socket,
        port: Number(owned.port),
        database: "postgres",
        user: "app_principal_runner",
        password: randomUUID(),
        ssl: false,
        prepare: false,
        max: 1,
        onnotice: () => undefined,
      });
      let concurrent;
      try {
        const [identity] =
          await second`SELECT current_user AS role,session_user AS session,inet_server_addr() AS address,current_setting('app_principal_lab.nonce') AS nonce`;
        expect(identity).toEqual({
          role: "app_principal_runner",
          session: "app_principal_runner",
          address: null,
          nonce: owned.nonce,
        });
        concurrent = await Promise.all([
          prepare(db, m),
          prepare(drizzle(second), m),
        ]);
      } finally {
        await second.end({ timeout: 1 });
      }
      expect(concurrent.map(r => r.status).sort()).toEqual([
        "prepared",
        "replayed",
      ]);
      expect(concurrent.map(r => r.manifestHash)).toEqual([
        planCalculatorHomologation(m).manifestHash,
        planCalculatorHomologation(m).manifestHash,
      ]);
      expect(await counts()).toMatchObject({
        bindings: 1,
        fixtures: 1,
        projects: 1,
        audits: before.audits + 22,
      });
      const rows =
        await lab.admin`SELECT user_id,old_values,new_values FROM public.audit_logs WHERE action='financial.homologation.prepare.row'`;
      expect(rows).toHaveLength(20);
      for (const r of rows) {
        expect(r.user_id).toBeNull();
        expect(r.old_values).toBeNull();
        expect(r.new_values).toMatchObject({
          administrativeActor: {
            sessionUser: "app_principal_runner",
            currentUser: "app_principal_runner",
          },
          manifestHash: planCalculatorHomologation(m).manifestHash,
        });
        expect(r.new_values.afterHash).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(
        (
          await lab.admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(false);
    });
    it("replays preparation exactly without duplicate rows/audits", async () => {
      const before = await counts();
      expect(await prepare(db, m)).toMatchObject({ status: "replayed" });
      expect(await counts()).toEqual(before);
    });
    it("refuses operation identity reuse with a different source", async () => {
      await expect(
        prepare(db, { ...m, sourceCommit: "a".repeat(40) })
      ).rejects.toThrow("EVIDENCE");
    });
    it("refuses lost per-row audit evidence", async () => {
      const rows =
        await lab.admin`SELECT id,new_values FROM public.audit_logs WHERE action='financial.homologation.prepare.row' LIMIT 1`;
      await lab.admin`UPDATE public.audit_logs SET new_values='{}' WHERE id=${rows[0].id}`;
      try {
        await expect(open(db, m)).rejects.toThrow("EVIDENCE");
      } finally {
        await lab.admin`UPDATE public.audit_logs SET new_values=${JSON.stringify(rows[0].new_values)}::jsonb WHERE id=${rows[0].id}`;
      }
    });
    it("refuses damaged SQL fixture provenance before activation", async () => {
      const [row] =
        await lab.admin`SELECT a.id,a.new_values FROM public.audit_logs a JOIN structr_financial.calculator_fixtures f ON f.provenance_audit_id=a.id`;
      await lab.admin`UPDATE public.audit_logs SET new_values='{}' WHERE id=${row.id}`;
      try {
        await expect(open(db, m)).rejects.toThrow("PROVENANCE");
      } finally {
        await lab.admin`UPDATE public.audit_logs SET new_values=${JSON.stringify(row.new_values)}::jsonb WHERE id=${row.id}`;
      }
    });
    it("refuses corrupt before-state hashes in the operation receipt", async () => {
      const [row] =
        await lab.admin`SELECT id FROM public.audit_logs WHERE action='financial.homologation.prepare.completed'`;
      await lab.admin`UPDATE public.audit_logs SET old_values='{"tampered":true}' WHERE id=${row.id}`;
      try {
        await expect(open(db, m)).rejects.toThrow("EVIDENCE");
      } finally {
        await lab.admin`UPDATE public.audit_logs SET old_values=NULL WHERE id=${row.id}`;
      }
    });
    it("refuses source row drift before activation", async () => {
      await lab.admin`UPDATE public.clients SET name='drift' WHERE id=${I.client}`;
      try {
        await expect(open(db, m)).rejects.toThrow("STATE_DRIFT");
      } finally {
        await lab.admin`UPDATE public.clients SET name='ADR003 synthetic client' WHERE id=${I.client}`;
      }
    });
    it("rolls back LOGIN when its transition audit cannot persist", async () => {
      const broken = {
        transaction: (callback: any, options: any) =>
          db.transaction(
            tx =>
              callback(
                new Proxy(tx, {
                  get(target, property) {
                    if (property === "insert")
                      return () => {
                        throw new Error("AUDIT_STORAGE_FAILURE");
                      };
                    const v = Reflect.get(target, property);
                    return typeof v === "function" ? v.bind(target) : v;
                  },
                })
              ),
            options
          ),
      } as PostgresJsDatabase;
      await expect(open(broken, m)).rejects.toThrow("AUDIT_STORAGE_FAILURE");
      expect(
        (
          await lab.admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(false);
    });
    it("opens only the nominal role within the manifest window and audits role attributes", async () => {
      expect(await open(db, m)).toMatchObject({ status: "opened" });
      const [r] =
        await lab.admin`SELECT rolcanlogin,rolvaliduntil FROM pg_roles WHERE rolname='structr_calculator_login_v1'`;
      expect(r.rolcanlogin).toBe(true);
      expect(new Date(r.rolvaliduntil).toISOString()).toBe(m.window.closesAt);
      const [a] =
        await lab.admin`SELECT old_values,new_values FROM public.audit_logs WHERE action='financial.homologation.open.completed'`;
      expect(a.old_values.role.rolcanlogin).toBe(false);
      expect(a.new_values.state.role.rolcanlogin).toBe(true);
    });
    it("replays open without duplicate audit or extending the window", async () => {
      const before = await counts();
      expect(await open(db, m)).toMatchObject({ status: "replayed" });
      expect(await counts()).toEqual(before);
    });
    it("actual nominal LOGIN can load complete A/B/C snapshots and calculate canonical results", async () => {
      caller = await lab.cluster.connect(
        "t8-nominal",
        "structr_calculator_login_v1"
      );
      for (const [assemblyId, total] of [
        [I.a, "10000"],
        [I.b, "9000"],
        [I.c, "1"],
      ] as const) {
        const command = {
          contractVersion: "calculator-v1",
          operation: "calculator.calculate",
          projectId: I.project,
          intakeFormId: I.intake,
          assemblies: [{ assemblyId, quantity: 1 }],
        };
        const result = await caller.db.transaction(
          async tx => {
            const [r] = await tx.execute(
              sql`SELECT structr_financial.calculator_snapshot_v1(${JSON.stringify(command)}::jsonb) AS result`
            );
            return buildCalculatorResult(
              calculatorSnapshotSchema.parse((r.result as any).snapshot),
              command
            );
          },
          { isolationLevel: "serializable" }
        );
        expect(result).toMatchObject({ financials: { priceMinor: total } });
      }
    });
    it("SET ROLE through the administrator cannot impersonate the nominal session", async () => {
      await expect(
        db.transaction(
          async tx => {
            await tx.execute(
              sql.raw("SET LOCAL ROLE structr_calculator_login_v1")
            );
            await tx.execute(
              sql`SELECT structr_financial.calculator_context_v1(${JSON.stringify({ contractVersion: "calculator-v1", operation: "calculator.context", projectId: I.project, intakeFormId: I.intake })}::jsonb)`
            );
          },
          { isolationLevel: "serializable" }
        )
      ).rejects.toBeDefined();
    });
    it("closes durably even when session termination fails and marks cleanup pending", async () => {
      let executeCalls = 0;
      const failing = {
        transaction: (callback: any, options: any) =>
          db.transaction(callback, options),
        execute: (q: any) => {
          executeCalls++;
          if (executeCalls === 1) throw new Error("TERMINATION_UNAVAILABLE");
          return db.execute(q);
        },
      } as unknown as PostgresJsDatabase;
      expect(await withdraw(failing, m)).toMatchObject({
        status: "cleanup_pending",
        bindingTerminal: true,
        loginClosed: true,
      });
      expect(
        (
          await lab.admin`SELECT is_active FROM structr_financial.principal_bindings WHERE id=${I.binding}`
        )[0].is_active
      ).toBe(false);
      expect(
        (
          await lab.admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(false);
    });
    it("refuses a tampered pending session-cleanup intent", async () => {
      const [row] =
        await lab.admin`SELECT id,new_values FROM public.audit_logs WHERE action='financial.homologation.withdraw.sessions.requested'`;
      await lab.admin`UPDATE public.audit_logs SET new_values=jsonb_set(new_values,'{afterHash}',to_jsonb(repeat('0',64))) WHERE id=${row.id}`;
      try {
        expect(await withdraw(db, m)).toMatchObject({
          status: "cleanup_pending",
        });
        expect(
          await lab.admin`SELECT pid FROM pg_stat_activity WHERE pid=${caller.pid}`
        ).toHaveLength(1);
      } finally {
        await lab.admin`UPDATE public.audit_logs SET new_values=${JSON.stringify(row.new_values)}::jsonb WHERE id=${row.id}`;
      }
    });
    it("retries remaining sessions after closure while retaining unrelated administrator sessions", async () => {
      const [owned] =
        await lab.admin`SELECT current_setting('unix_socket_directories') AS socket,current_setting('port') AS port,current_setting('app_principal_lab.nonce') AS nonce`;
      expect(owned.socket.startsWith(lab.cluster.directory + "/")).toBe(true);
      const second = postgres({
        host: owned.socket,
        port: Number(owned.port),
        database: "postgres",
        user: "app_principal_runner",
        password: randomUUID(),
        ssl: false,
        prepare: false,
        max: 1,
        onnotice: () => undefined,
      });
      try {
        const [identity] =
          await second`SELECT current_user AS role,session_user AS session,inet_server_addr() AS address,current_setting('app_principal_lab.nonce') AS nonce`;
        expect(identity).toEqual({
          role: "app_principal_runner",
          session: "app_principal_runner",
          address: null,
          nonce: owned.nonce,
        });
        const secondDb = drizzle(second);
        let release!: () => void, observed!: () => void;
        const barrier = new Promise<void>(resolve => {
            release = resolve;
          }),
          seen = new Promise<void>(resolve => {
            observed = resolve;
          });
        let firstExternal = true;
        const delayed = {
          transaction: secondDb.transaction.bind(secondDb),
          execute: async (q: any) => {
            const result = await secondDb.execute(q);
            if (firstExternal) {
              firstExternal = false;
              observed();
              await barrier;
            }
            return result;
          },
        } as PostgresJsDatabase;
        const pending = withdraw(delayed, m);
        await seen;
        const first = await withdraw(db, m);
        release();
        const results = [first, await pending];
        for (const r of results)
          expect(r).toMatchObject({
            status: "withdrawn",
            bindingTerminal: true,
            loginClosed: true,
            remainingSessions: 0,
          });
      } finally {
        await second.end({ timeout: 1 });
      }
      expect(
        await lab.admin`SELECT pid FROM pg_stat_activity WHERE pid=${lab.cluster.observer.pid}`
      ).toHaveLength(1);
      expect(
        await lab.admin`SELECT pid FROM pg_stat_activity WHERE usename='structr_calculator_login_v1'`
      ).toHaveLength(0);
      const logs =
        await lab.admin`SELECT action,new_values FROM public.audit_logs WHERE action LIKE 'financial.homologation.withdraw.sessions.%' ORDER BY created_at`;
      expect(logs.map(r => r.action)).toEqual([
        "financial.homologation.withdraw.sessions.requested",
        "financial.homologation.withdraw.sessions.completed",
      ]);
      expect(logs[0].new_values.sessions.map((s: any) => s.pid)).toContain(
        caller.pid
      );
      expect(logs[1].new_values.remainingSessions).toEqual([]);
    });
    it("withdrawal is idempotent and retains immutable fixture history", async () => {
      const before = await counts();
      expect(await withdraw(db, m)).toMatchObject({
        status: "withdrawn",
        remainingSessions: 0,
      });
      expect(await counts()).toEqual(before);
      expect(before.fixtures).toBe(1);
    });
    it("terminal binding cannot be reopened, rebound or prepared again", async () => {
      await expect(open(db, m)).rejects.toThrow("TERMINAL");
      await expect(prepare(db, m)).rejects.toThrow("TERMINAL");
      await expect(
        lab.admin`UPDATE structr_financial.principal_bindings SET is_active=true WHERE id=${I.binding}`
      ).rejects.toMatchObject({ code: "23514" });
    });
  }
);
