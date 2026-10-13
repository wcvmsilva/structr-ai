import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { startFinancialCalculatorBoundary } from "./test-support/financial-calculator-boundary";
const state = vi.hoisted(() => ({ plan: {} as any, audit: "normal" }));
vi.mock(
  "../docs/security/financial-executor/database-temp-containment-plan.json",
  () => ({ default: state.plan })
);
vi.mock("./audit", async importOriginal => {
  const original = await importOriginal<typeof import("./audit")>();
  return {
    ...original,
    logAudit: async (...args: Parameters<typeof original.logAudit>) => {
      if (state.audit === "throw") throw new Error("OWNED_AUDIT_FAILURE");
      if (state.audit === "suppress") return null;
      if (state.audit === "alter")
        args[0] = { ...args[0], after: { altered: true } };
      return original.logAudit(...args);
    },
  };
});
import { applyCalculatorDatabaseTempContainment } from "../scripts/financial-executor-homologation/temp-containment";
import {
  installCalculatorBoundary,
  recoverCalculatorBoundaryInstall,
} from "../scripts/financial-executor-homologation/installer";
const root = new URL("../", import.meta.url);
const enabled = process.env.FINANCIAL_CALCULATOR_INSTALL_PHYSICAL === "1";
vi.setConfig({ testTimeout: 30000 });
const copy = <T>(v: T): T => structuredClone(v);
describe.skipIf(!enabled)(
  "Audited Calculator installation in owned PG17.11",
  () => {
    let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>,
      installer: Awaited<
        ReturnType<
          Awaited<
            ReturnType<typeof startFinancialCalculatorBoundary>
          >["cluster"]["connect"]
        >
      >,
      m: any,
      receipt: any;
    beforeAll(async () => {
      lab = await startFinancialCalculatorBoundary();
      await lab.admin.unsafe(
        await readFile(
          new URL(
            "server/test-support/financial-calculator-boundary/managed-provider-fixture.sql",
            root
          ),
          "utf8"
        )
      );
      const approved = JSON.parse(
        await readFile(
          new URL(
            "docs/security/financial-executor/database-temp-containment-plan.json",
            root
          ),
          "utf8"
        )
      );
      for (const name of approved.recipients) {
        const [r] = await lab.admin`SELECT to_regrole(${name}) AS role`;
        if (!r.role) await lab.admin.unsafe(`CREATE ROLE "${name}" NOLOGIN`);
      }
      await lab.admin.unsafe(
        "GRANT TEMPORARY ON DATABASE postgres TO PUBLIC,app_runtime,app_denied,dashboard_user,supabase_admin"
      );
      installer = await lab.cluster.connect("audited-installer", "postgres");
      const collector = await readFile(
        new URL(
          "scripts/financial-executor-homologation/compatibility-inspect.sql",
          root
        ),
        "utf8"
      );
      const [{ observation }] = await installer.sql.begin(
        "read only",
        async tx => {
          await tx.unsafe("SET LOCAL search_path=pg_catalog");
          return tx.unsafe(collector.slice(collector.indexOf(";") + 1));
        }
      );
      const before = observation.surface
        .filter(
          (r: any) =>
            r.identity === "database:postgres" ||
            /^(role|membership|effective-database):/.test(r.identity)
        )
        .map(({ identity, definition }: any) => ({ identity, definition }))
        .sort((a: any, b: any) =>
          Buffer.compare(Buffer.from(a.identity), Buffer.from(b.identity))
        );
      const d = before.find(
        (r: any) => r.identity === "database:postgres"
      ).definition;
      d.acl.sort();
      d.effectiveAcl.sort();
      const after = copy(before),
        a = after.find(
          (r: any) => r.identity === "database:postgres"
        ).definition;
      a.acl[a.acl.indexOf("=Tc/postgres")] = "=c/postgres";
      for (const name of approved.recipients)
        if (!a.acl.some((v: string) => v.startsWith(name + "=")))
          a.acl.push(name + "=T/postgres");
      a.acl.sort();
      a.effectiveAcl = [...a.acl];
      // Adapt only the frozen provider metadata fixture to this disposable cluster.
      // The installer does not receive a bypass; the real containment helper later audits it.
      let localAfter: any;
      await installer.sql
        .begin(async tx => {
          await tx.unsafe(
            await readFile(
              new URL(
                "scripts/financial-executor-homologation/database-temp-containment.sql",
                root
              ),
              "utf8"
            )
          );
          await tx.unsafe("SET LOCAL search_path=pg_catalog");
          const [{ observation: applied }] = await tx.unsafe(
            collector.slice(collector.indexOf(";") + 1)
          );
          localAfter = applied.surface
            .filter(
              (r: any) =>
                r.identity === "database:postgres" ||
                /^(role|membership|effective-database):/.test(r.identity)
            )
            .map(({ identity, definition }: any) => ({ identity, definition }))
            .sort((x: any, y: any) =>
              Buffer.compare(Buffer.from(x.identity), Buffer.from(y.identity))
            );
          const dbAcl = localAfter.find(
            (r: any) => r.identity === "database:postgres"
          ).definition;
          dbAcl.acl.sort();
          dbAcl.effectiveAcl.sort();
          throw new Error("OWNED_SNAPSHOT_ROLLBACK");
        })
        .catch(e => {
          if (e.message !== "OWNED_SNAPSHOT_ROLLBACK") throw e;
        });
      Object.assign(state.plan, approved, { before, after: localAfter });
      const tempId = await applyCalculatorDatabaseTempContainment(
        installer.db,
        "d8300000-0000-4000-8000-000000000003"
      );
      m = {
        version: "calculator-install-v1",
        operationId: "d8300000-0000-4000-8000-000000000001",
        sourceCommit: "56a723770aa2a60b588b6d8ab37b96414c72d619",
        sourcePinsSha256:
          "8eb116952a6ffe5d8e08df6c790ec89bd23f30d6c7be307e31c2f40d8d3d5669",
        expectedDatabase: "postgres",
        expectedPrincipal: "postgres",
        tempContainmentAuditId: tempId,
        artifacts: {
          foundationSha256:
            "a74b4d933bafe92c23ddaf3d5aee3487ce0e2197b03d10ae434280a268294d54",
          lifecycleSha256:
            "87a09f22a4e433a75f2f01973b3ee903a0a1f9dd7ef0f0706860c5b8fe988c61",
        },
      };
    }, 60000);
    afterAll(async () => {
      state.audit = "normal";
      await lab?.stop();
    }, 30000);
    async function absent() {
      const [r] =
        await installer.sql`SELECT to_regnamespace('structr_financial') IS NULL AS absent,(SELECT count(*)::int FROM pg_roles WHERE rolname LIKE 'structr_calculator_%') AS roles,(SELECT count(*)::int FROM public.audit_logs WHERE record_id=${m.operationId}::uuid) AS receipts`;
      expect(r).toEqual({ absent: true, roles: 0, receipts: 0 });
    }
    it("does not treat missing receipt as rollback or replay permission", async () => {
      expect(await recoverCalculatorBoundaryInstall(installer.db, m)).toEqual({
        status: "not_observed",
        operationId: m.operationId,
      });
      await absent();
    });
    it("refuses a missing TEMP receipt before DDL", async () => {
      await expect(
        installCalculatorBoundary(installer.db, {
          ...m,
          tempContainmentAuditId: "d8300000-0000-4000-8000-000000000099",
        })
      ).rejects.toThrow("CALCULATOR_INSTALL_TEMP_RECEIPT");
      await absent();
    });
    it.each(["throw", "suppress", "alter"])(
      "rolls both migrations back when audit is %s",
      async mode => {
        state.audit = mode;
        try {
          await expect(
            installCalculatorBoundary(installer.db, m)
          ).rejects.toThrow(
            (
              {
                throw: "OWNED_AUDIT_FAILURE",
                suppress: "CALCULATOR_INSTALL_AUDIT_MISSING",
                alter: "CALCULATOR_INSTALL_AUDIT_INVALID",
              } as Record<string, string>
            )[mode]
          );
        } finally {
          state.audit = "normal";
        }
        await absent();
      }
    );
    it("rolls foundation back on a later migration execution failure", async () => {
      const dialect = new PgDialect();
      let foundationObserved = false;
      const db = new Proxy(installer.db, {
        get(target, key, receiver) {
          if (key !== "transaction") return Reflect.get(target, key, receiver);
          return (fn: any, config: any) =>
            target.transaction(
              async tx =>
                fn(
                  new Proxy(tx, {
                    get(t, k, r) {
                      if (k !== "execute") return Reflect.get(t, k, r);
                      return async (query: any) => {
                        const command = dialect.sqlToQuery(query).sql;
                        if (
                          command.startsWith("-- ADR-003 Calculator lifecycle")
                        ) {
                          const [v] = await tx.execute(
                            sql`SELECT to_regnamespace('structr_financial') IS NOT NULL AS present`
                          );
                          foundationObserved = (v as any).present;
                          throw new Error("OWNED_LIFECYCLE_EXECUTION_FAILURE");
                        }
                        return tx.execute(query);
                      };
                    },
                  })
                ),
              config
            );
        },
      });
      await expect(installCalculatorBoundary(db, m)).rejects.toThrow(
        "OWNED_LIFECYCLE_EXECUTION_FAILURE"
      );
      expect(foundationObserved).toBe(true);
      await absent();
    });
    it("installs closed roles and exact lifecycle with a durable complete audit", async () => {
      receipt = await installCalculatorBoundary(installer.db, m);
      expect(receipt).toMatchObject({
        status: "committed",
        operationId: m.operationId,
      });
      const roles =
        await installer.sql`SELECT rolname,rolcanlogin,rolinherit,rolbypassrls FROM pg_roles WHERE rolname LIKE 'structr_calculator_%' ORDER BY rolname`;
      expect(roles).toEqual(
        [
          "structr_calculator_login_v1",
          "structr_calculator_read_owner_v1",
          "structr_calculator_write_owner_v1",
        ].map(rolname => ({
          rolname,
          rolcanlogin: false,
          rolinherit: false,
          rolbypassrls: false,
        }))
      );
      const [a] =
        await installer.sql`SELECT user_id,action,table_name,record_id,old_values,new_values FROM public.audit_logs WHERE id=${receipt.receiptId}::uuid`;
      expect(a).toMatchObject({
        user_id: null,
        action: "financial.homologation.install.completed",
        table_name: "calculator_installation",
        record_id: m.operationId,
        new_values: {
          manifest: m,
          administrativeActor: {
            currentUser: "postgres",
            sessionUser: "postgres",
            database: "postgres",
            version: "170011",
          },
        },
      });
      expect(a.old_values.applicationHash).toBe(
        "45bf03ac2fac16724469de89f6a6d26effcf8919972406f99f6196fb2f2a9774"
      );
      expect(a.new_values.snapshot.applicationHash).toBe(
        "75332da1e1b8d1492d1a99c702de39ddc8950c57f0c85c5726d11bed7d5acb2c"
      );
    });
    it("recovers the exact receipt in a read-only transaction and refuses writer replay", async () => {
      expect(await recoverCalculatorBoundaryInstall(installer.db, m)).toEqual({
        ...receipt,
        currentMatchesInstalledSnapshot: true,
      });
      await expect(installCalculatorBoundary(installer.db, m)).rejects.toThrow(
        "CALCULATOR_INSTALL_ALREADY_OBSERVED"
      );
      await expect(
        recoverCalculatorBoundaryInstall(installer.db, {
          ...m,
          sourceCommit: "0".repeat(40),
        })
      ).rejects.toThrow("CALCULATOR_INSTALL_RECEIPT_INVALID");
      const [{ n }] =
        await installer.sql`SELECT count(*)::int AS n FROM public.audit_logs WHERE record_id=${m.operationId}::uuid`;
      expect(n).toBe(1);
    });
    it.each(["role", "membership", "unknown-field", "managed-hash"])(
      "refuses altered complete receipt snapshots: %s",
      async change => {
        const [original] =
          await installer.sql`SELECT old_values,new_values FROM public.audit_logs WHERE id=${receipt.receiptId}::uuid`;
        const altered = copy(original.new_values),
          alteredBefore = copy(original.old_values);
        if (change === "role") altered.snapshot.roles[0].rolname = "postgres";
        if (change === "membership")
          altered.snapshot.memberships[0].rolname = "postgres";
        if (change === "unknown-field") altered.snapshot.unreviewed = true;
        if (change === "managed-hash") {
          altered.snapshot.managedHash = "0".repeat(64);
          alteredBefore.managedHash = "0".repeat(64);
        }
        await installer.sql`UPDATE public.audit_logs SET old_values=${JSON.stringify(alteredBefore)}::jsonb,new_values=${JSON.stringify(altered)}::jsonb WHERE id=${receipt.receiptId}::uuid`;
        try {
          await expect(
            recoverCalculatorBoundaryInstall(installer.db, m)
          ).rejects.toThrow("CALCULATOR_INSTALL_RECEIPT_INVALID");
        } finally {
          await installer.sql`UPDATE public.audit_logs SET old_values=${JSON.stringify(original.old_values)}::jsonb,new_values=${JSON.stringify(original.new_values)}::jsonb WHERE id=${receipt.receiptId}::uuid`;
        }
      }
    );
    it("reconciles using a physically read-only snapshot", async () => {
      let observed = "";
      const db = new Proxy(installer.db, {
        get(target, key, receiver) {
          if (key !== "transaction") return Reflect.get(target, key, receiver);
          return (fn: any, config: any) =>
            target.transaction(async tx => {
              const [r] = await tx.execute(
                sql`SELECT current_setting('transaction_read_only') AS read_only`
              );
              observed = (r as any).read_only;
              return fn(tx);
            }, config);
        },
      });
      expect(await recoverCalculatorBoundaryInstall(db, m)).toMatchObject({
        status: "committed",
      });
      expect(observed).toBe("on");
    });
    it("reports changed current state without rewriting historical receipt", async () => {
      await lab.admin.unsafe(
        "ALTER ROLE structr_calculator_login_v1 CONNECTION LIMIT 1"
      );
      expect(await recoverCalculatorBoundaryInstall(installer.db, m)).toEqual({
        ...receipt,
        currentMatchesInstalledSnapshot: false,
      });
    });
  }
);
