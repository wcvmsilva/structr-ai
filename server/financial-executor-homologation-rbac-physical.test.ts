import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  startAppPrincipalPostgres,
  type AppPrincipalCluster,
} from "./test-support/app-principal-postgres";
import {
  applyCalculatorRbac,
  withdrawCalculatorRbac,
} from "../scripts/financial-executor-homologation-rbac";
const fixed = {
  permission: "c8310000-0000-4000-8000-000000000001",
  role: "c8310000-0000-4000-8000-000000000002",
  edge: "c8310000-0000-4000-8000-000000000003",
};
describe.skipIf(process.env.APP_PRINCIPAL_LAB !== "1")(
  "Calculator RBAC real owned PG17 transaction candidate",
  () => {
    let cluster: AppPrincipalCluster, m: any;
    const raw = () => cluster.observer.sql;
    const apply = () => applyCalculatorRbac(cluster.observer.db, m);
    const withdraw = () => withdrawCalculatorRbac(cluster.observer.db, m);
    beforeAll(async () => {
      cluster = await startAppPrincipalPostgres(postgres);
      const root = new URL("../drizzle/", import.meta.url);
      const journal = JSON.parse(
        await readFile(new URL("meta/_journal.json", root), "utf8")
      );
      for (const { tag } of journal.entries.filter(
        (e: any) => Number(e.tag.slice(0, 4)) <= 14
      )) {
        const source = await readFile(new URL(`${tag}.sql`, root), "utf8");
        await raw().begin(tx => tx.unsafe(source));
      }
      // All fixture DDL is confined to the owned Unix-socket cluster.
    }, 90000);
    afterAll(async () => {
      await cluster?.stop();
    }, 20000);
    beforeEach(async () => {
      await raw().unsafe(
        "DELETE FROM public.audit_logs; DELETE FROM public.role_permissions; DELETE FROM public.roles; DELETE FROM public.permissions; DELETE FROM public.profiles; DELETE FROM public.tenants"
      );
      m = {
        version: "calculator-homologation-rbac-v1",
        operationId: randomUUID(),
        sourceCommit: "9fb9f6564b44945aa894341b3dea73d929fd3d2b",
        expectedDatabase: "postgres",
        expectedPrincipal: "app_principal_runner",
        operator: {
          subject: randomUUID(),
          actorId: randomUUID(),
          tenantId: randomUUID(),
          originalRole: "user",
        },
        nominalRole: "calculator_pilot_operator_v1",
        permissionMode: "create-absent",
        ids: fixed,
        window: {
          opensAt: new Date(Date.now() - 60000).toISOString(),
          closesAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };
      await raw()`INSERT INTO public.tenants(id,name,slug,is_active) VALUES(${m.operator.tenantId},'Synthetic RBAC tenant',${"rbac-" + m.operationId},true)`;
      await raw()`INSERT INTO public.profiles(id,tenant_id,external_open_id,role,is_active,full_name) VALUES(${m.operator.actorId},${m.operator.tenantId},${m.operator.subject},'user',true,'Unchanged name')`;
    });
    async function state() {
      const [row] =
        await raw()`SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p) profiles,(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM tenants t) tenants,(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM roles r) roles,(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM permissions p) permissions,(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM role_permissions e) edges,(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_logs a) audits`;
      return row;
    }
    it("compensates a committed RBAC transaction whose response was lost without reapplying it", async () => {
      const { prepareCalculatorPilot } = await import(
        "../scripts/financial-executor-homologation/orchestration"
      );
      const { originalRole, ...operator } = m.operator;
      const fixture = {
        version: "calculator-homologation-v1",
        operationId: randomUUID(),
        sourceCommit: m.sourceCommit,
        expectedDatabase: m.expectedDatabase,
        expectedPrincipal: m.expectedPrincipal,
        operator,
        window: m.window,
      };
      const db = cluster.observer.db;
      let first = true;
      const lost = {
        execute: db.execute.bind(db),
        transaction: async (fn: any, options: any) => {
          const result = await db.transaction(fn, options);
          if (first) {
            first = false;
            throw Object.assign(new Error("LOST_COMMIT_REPLY"), {
              code: "08006",
            });
          }
          return result;
        },
      } as typeof db;
      expect(
        await prepareCalculatorPilot(lost, { fixture, rbac: m })
      ).toMatchObject({ status: "compensated", rbacRestored: true });
      expect((await raw()`SELECT role FROM profiles`)[0].role).toBe("user");
      expect(
        await raw()`SELECT 1 FROM audit_logs WHERE action='financial.calculator.rbac.apply.completed'`
      ).toHaveLength(1);
      expect(
        await raw()`SELECT 1 FROM audit_logs WHERE action='financial.calculator.rbac.withdraw.completed'`
      ).toHaveLength(1);
    });
    it("bounds receipt evidence waits on a real conflicting row lock before financial closure", async () => {
      const { withdrawCalculatorPilot } = await import(
        "../scripts/financial-executor-homologation/orchestration"
      );
      await apply();
      const { originalRole, ...operator } = m.operator;
      const fixture = {
        version: "calculator-homologation-v1",
        operationId: randomUUID(),
        sourceCommit: m.sourceCommit,
        expectedDatabase: m.expectedDatabase,
        expectedPrincipal: m.expectedPrincipal,
        operator,
        window: m.window,
      };
      await raw().unsafe(
        "GRANT SELECT,UPDATE ON public.audit_logs TO app_runtime"
      );
      const blocker = await cluster.connect("receipt-locker", "app_runtime");
      let release!: () => void, locked!: () => void;
      const hold = new Promise<void>(resolve => {
          release = resolve;
        }),
        ready = new Promise<void>(resolve => {
          locked = resolve;
        });
      const blocking = blocker.sql.begin(async tx => {
        await tx`SELECT id FROM audit_logs WHERE action='financial.calculator.rbac.apply.completed' FOR UPDATE`;
        locked();
        await hold;
      });
      await ready;
      await raw().unsafe("SET statement_timeout=0; SET lock_timeout=0");
      const started = performance.now();
      const attempt = withdrawCalculatorPilot(cluster.observer.db, {
        fixture,
        rbac: m,
      }).then(
        value => ({ value, error: null }),
        error => ({ value: null, error })
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        attempt,
        new Promise<null>(resolve => {
          timer = setTimeout(() => resolve(null), 6500);
        }),
      ]);
      clearTimeout(timer);
      const elapsed = performance.now() - started;
      release();
      await blocking;
      await attempt;
      expect(outcome).not.toBeNull();
      expect(outcome?.error?.cause ?? outcome?.error).toMatchObject({
        code: "55P03",
      });
      expect(elapsed).toBeLessThan(6500);
      expect((await raw()`SELECT role FROM profiles`)[0].role).toBe(
        m.nominalRole
      );
    }, 15000);
    it("creates only one permission/role/edge and changes O atomically with exact before/readback audit", async () => {
      const before = await state();
      const result = await apply();
      expect(result).toMatchObject({
        status: "applied",
        operationId: m.operationId,
        hostedReady: false,
      });
      const after = await state();
      expect(after.tenants).toEqual(before.tenants);
      expect(after.profiles).toHaveLength(1);
      expect(after.profiles[0]).toEqual({
        ...before.profiles[0],
        role: m.nominalRole,
      });
      expect(after.permissions).toHaveLength(1);
      expect(after.permissions[0]).toMatchObject({
        id: fixed.permission,
        resource: "estimate",
        action: "create",
      });
      expect(after.roles[0]).toMatchObject({
        id: fixed.role,
        name: m.nominalRole,
        is_system: false,
      });
      expect(after.edges[0]).toMatchObject({
        id: fixed.edge,
        role_id: fixed.role,
        permission_id: fixed.permission,
      });
      expect(after.audits).toHaveLength(5);
      const audit = after.audits.find(
        (a: any) => a.action === "financial.calculator.rbac.profile.assign"
      );
      expect(audit.old_values).toEqual(before.profiles[0]);
      expect(audit.new_values.row).toEqual(after.profiles[0]);
    });
    it("same operation and payload replays without duplicate DML/audit", async () => {
      await apply();
      const before = await state();
      expect(await apply()).toMatchObject({
        status: "replayed",
        phase: "apply",
      });
      expect(await state()).toEqual(before);
    });
    it("rejects same operation with changed source hash without writes", async () => {
      await apply();
      const before = await state();
      m.sourceCommit = "a".repeat(40);
      await expect(apply()).rejects.toThrow(
        "CALCULATOR_RBAC_OPERATION_CONFLICT"
      );
      expect(await state()).toEqual(before);
    });
    it("withdraws via role CAS and removes only its grant; definitions and all historical audits remain", async () => {
      const before = await state();
      await apply();
      const active = await state();
      expect(await withdraw()).toMatchObject({
        status: "withdrawn",
        phase: "withdraw",
      });
      const after = await state();
      expect(after.profiles).toEqual(before.profiles);
      expect(after.tenants).toEqual(before.tenants);
      expect(after.roles).toEqual(active.roles);
      expect(after.permissions).toEqual(active.permissions);
      expect(after.edges).toBeNull();
      expect(after.audits).toHaveLength(8);
      const frozen = await state();
      expect(await withdraw()).toMatchObject({
        status: "replayed",
        phase: "withdraw",
      });
      expect(await state()).toEqual(frozen);
      await expect(apply()).rejects.toThrow("CALCULATOR_RBAC_TERMINAL");
      expect(await state()).toEqual(frozen);
    });
    it.each([
      "permission",
      "permission-id",
      "role",
      "role-id",
      "edge",
      "other-assignee",
      "subject",
      "tenant",
      "inactive-profile",
      "inactive-tenant",
      "role-not-user",
      "principal",
      "database",
      "expired",
      "early",
    ] as const)("refuses %s conflict without mutation", async kind => {
      if (kind === "permission")
        await raw()`INSERT INTO permissions(id,resource,action) VALUES(${randomUUID()},'estimate','create')`;
      if (kind === "permission-id")
        await raw()`INSERT INTO permissions(id,resource,action) VALUES(${fixed.permission},'other','create')`;
      if (kind === "role")
        await raw()`INSERT INTO roles(id,name) VALUES(${randomUUID()},${m.nominalRole})`;
      if (kind === "role-id")
        await raw()`INSERT INTO roles(id,name) VALUES(${fixed.role},'foreign')`;
      if (kind === "edge") {
        const r = randomUUID(),
          p = randomUUID();
        await raw()`INSERT INTO roles(id,name) VALUES(${r},'foreign')`;
        await raw()`INSERT INTO permissions(id,resource,action) VALUES(${p},'foreign','read')`;
        await raw()`INSERT INTO role_permissions(id,role_id,permission_id) VALUES(${fixed.edge},${r},${p})`;
      }
      if (kind === "other-assignee")
        await raw()`INSERT INTO profiles(id,tenant_id,role,is_active) VALUES(${randomUUID()},${m.operator.tenantId},${m.nominalRole},false)`;
      if (kind === "subject")
        await raw()`UPDATE profiles SET external_open_id=${randomUUID()} WHERE id=${m.operator.actorId}`;
      if (kind === "tenant") {
        m.operator.tenantId = randomUUID();
      }
      if (kind === "inactive-profile")
        await raw()`UPDATE profiles SET is_active=false WHERE id=${m.operator.actorId}`;
      if (kind === "inactive-tenant")
        await raw()`UPDATE tenants SET is_active=false WHERE id=${m.operator.tenantId}`;
      if (kind === "role-not-user")
        await raw()`UPDATE profiles SET role='admin' WHERE id=${m.operator.actorId}`;
      if (kind === "principal") m.expectedPrincipal = "wrong_principal";
      if (kind === "database") m.expectedDatabase = "foreign";
      if (kind === "expired")
        m.window = {
          opensAt: new Date(Date.now() - 120000).toISOString(),
          closesAt: new Date(Date.now() - 60000).toISOString(),
        };
      if (kind === "early")
        m.window = {
          opensAt: new Date(Date.now() + 60000).toISOString(),
          closesAt: new Date(Date.now() + 120000).toISOString(),
        };
      const before = await state();
      await expect(apply()).rejects.toThrow(/CALCULATOR_RBAC_/);
      expect(await state()).toEqual(before);
    });
    it.each([
      "profile-cas",
      "extra-edge",
      "other-assignee",
      "receipt-corrupt",
      "audit-missing",
    ] as const)(
      "withdraw refuses %s and preserves current state",
      async kind => {
        await apply();
        if (kind === "profile-cas")
          await raw()`UPDATE profiles SET role='independent-role' WHERE id=${m.operator.actorId}`;
        if (kind === "extra-edge") {
          const p = randomUUID();
          await raw()`INSERT INTO permissions(id,resource,action) VALUES(${p},'project','approve')`;
          await raw()`INSERT INTO role_permissions(role_id,permission_id) VALUES(${fixed.role},${p})`;
        }
        if (kind === "other-assignee")
          await raw()`INSERT INTO profiles(id,tenant_id,role,is_active) VALUES(${randomUUID()},${m.operator.tenantId},${m.nominalRole},true)`;
        if (kind === "receipt-corrupt")
          await raw()`UPDATE audit_logs SET new_values=jsonb_set(new_values,'{manifestHash}','"wrong"') WHERE action='financial.calculator.rbac.apply.completed'`;
        if (kind === "audit-missing")
          await raw()`DELETE FROM audit_logs WHERE action='financial.calculator.rbac.permission.create'`;
        const before = await state();
        await expect(withdraw()).rejects.toThrow(/CALCULATOR_RBAC_/);
        expect(await state()).toEqual(before);
      }
    );
    it.each(["raise", "suppress", "alter"] as const)(
      "audit %s rolls back all mutations",
      async kind => {
        const effect =
          kind === "raise"
            ? "RAISE EXCEPTION 'private-data-must-not-leak'"
            : kind === "suppress"
              ? "RETURN NULL"
              : "NEW.new_values:=jsonb_set(NEW.new_values,'{manifestHash}','\"corrupt\"')";
        await raw().unsafe(
          `CREATE FUNCTION public.rbac_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='financial.calculator.rbac.apply.completed' THEN ${effect}; END IF; RETURN NEW; END $$; CREATE TRIGGER rbac_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.rbac_test_audit()`
        );
        try {
          const before = await state();
          await expect(apply()).rejects.toThrow(/CALCULATOR_RBAC_/);
          expect(await state()).toEqual(before);
        } finally {
          await raw().unsafe(
            "DROP TRIGGER rbac_test_audit ON audit_logs;DROP FUNCTION public.rbac_test_audit()"
          );
        }
      }
    );
    it("late withdrawal is allowed with the original expired manifest", async () => {
      m.window.closesAt = new Date(Date.now() + 1200).toISOString();
      await apply();
      await new Promise(resolve => setTimeout(resolve, 1300));
      expect(await withdraw()).toMatchObject({ status: "withdrawn" });
    });
    it("unrelated profile edits survive the reducing role CAS", async () => {
      await apply();
      await raw()`UPDATE profiles SET full_name='Changed independently' WHERE id=${m.operator.actorId}`;
      expect(await withdraw()).toMatchObject({ status: "withdrawn" });
      expect((await state()).profiles[0]).toMatchObject({
        role: "user",
        full_name: "Changed independently",
      });
    });
    it.each(["receipt", "mutation"] as const)(
      "rejects added %s fields instead of silently accepting altered audit evidence",
      async kind => {
        await apply();
        if (kind === "receipt")
          await raw()`UPDATE audit_logs SET new_values=new_values||'{"unreviewed":true}'::jsonb WHERE action='financial.calculator.rbac.apply.completed'`;
        else
          await raw()`UPDATE audit_logs SET new_values=jsonb_set(new_values,'{mutations,0,unreviewed}','true'::jsonb) WHERE action='financial.calculator.rbac.apply.completed'`;
        const before = await state();
        await expect(apply()).rejects.toThrow(
          "CALCULATOR_RBAC_OPERATION_CONFLICT"
        );
        expect(await state()).toEqual(before);
      }
    );
    it("withdrawal audit failure rolls back both profile restoration and grant deletion", async () => {
      await apply();
      await raw().unsafe(
        "CREATE FUNCTION public.rbac_test_withdraw_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='financial.calculator.rbac.withdraw.completed' THEN RAISE EXCEPTION 'private-admin-detail'; END IF; RETURN NEW; END $$; CREATE TRIGGER rbac_test_withdraw_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.rbac_test_withdraw_audit()"
      );
      try {
        const before = await state();
        await expect(withdraw()).rejects.toThrow("CALCULATOR_RBAC_FAILED");
        expect(await state()).toEqual(before);
      } finally {
        await raw().unsafe(
          "DROP TRIGGER rbac_test_withdraw_audit ON audit_logs;DROP FUNCTION public.rbac_test_withdraw_audit()"
        );
      }
    });
    it("detects profile readback changes and rolls back all preceding definition audits", async () => {
      await raw().unsafe(
        "CREATE FUNCTION public.rbac_test_profile_drift() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.full_name:='unexpected'; RETURN NEW; END $$; CREATE TRIGGER rbac_test_profile_drift BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION public.rbac_test_profile_drift()"
      );
      try {
        const before = await state();
        await expect(apply()).rejects.toThrow("CALCULATOR_RBAC_STATE_DRIFT");
        expect(await state()).toEqual(before);
      } finally {
        await raw().unsafe(
          "DROP TRIGGER rbac_test_profile_drift ON profiles;DROP FUNCTION public.rbac_test_profile_drift()"
        );
      }
    });
    it("two real connections cannot duplicate definitions or receipt and explicit replay reconciles the result", async () => {
      await raw().unsafe(
        "GRANT USAGE ON SCHEMA public TO app_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles,public.tenants,public.permissions,public.roles,public.role_permissions,public.audit_logs TO app_runtime"
      );
      const first = await cluster.connect("rbac-concurrent-a"),
        second = await cluster.connect("rbac-concurrent-b");
      expect(first.pid).not.toBe(second.pid);
      m.expectedPrincipal = "app_runtime";
      const results = await Promise.allSettled([
        applyCalculatorRbac(first.db, m),
        applyCalculatorRbac(second.db, m),
      ]);
      expect(
        results.filter(r => r.status === "fulfilled").length
      ).toBeGreaterThanOrEqual(1);
      const after = await state();
      expect(after.roles).toHaveLength(1);
      expect(after.permissions).toHaveLength(1);
      expect(after.edges).toHaveLength(1);
      expect(after.audits).toHaveLength(5);
      expect(await applyCalculatorRbac(first.db, m)).toMatchObject({
        status: "replayed",
      });
      expect(await state()).toEqual(after);
    });

    it("pins the audit relation despite a caller search path shadowing public.audit_logs", async () => {
      await raw().unsafe(
        "CREATE SCHEMA rbac_shadow; CREATE TABLE rbac_shadow.audit_logs (LIKE public.audit_logs INCLUDING ALL); SET search_path TO rbac_shadow,public"
      );
      try {
        expect(await apply()).toMatchObject({ status: "applied" });
        const [counts] =
          await raw()`SELECT (SELECT count(*)::int FROM public.audit_logs) AS actual,(SELECT count(*)::int FROM rbac_shadow.audit_logs) AS shadow`;
        expect(counts).toEqual({ actual: 5, shadow: 0 });
      } finally {
        await raw().unsafe(
          "SET search_path TO public; DROP SCHEMA rbac_shadow CASCADE"
        );
      }
    });
    it("rolls back when the approved apply window expires while a statement waits", async () => {
      m.window.closesAt = new Date(Date.now() + 500).toISOString();
      await raw().unsafe(
        "CREATE FUNCTION public.rbac_test_wait() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$; CREATE TRIGGER rbac_test_wait BEFORE INSERT ON permissions FOR EACH ROW EXECUTE FUNCTION public.rbac_test_wait()"
      );
      try {
        const before = await state();
        await expect(apply()).rejects.toThrow("CALCULATOR_RBAC_WINDOW_CLOSED");
        expect(await state()).toEqual(before);
      } finally {
        await raw().unsafe(
          "DROP TRIGGER rbac_test_wait ON permissions;DROP FUNCTION public.rbac_test_wait()"
        );
      }
    });
    it("refuses withdrawal after an unknown state field was added to its original receipt", async () => {
      await apply();
      await raw()`UPDATE audit_logs SET new_values=jsonb_set(new_values,'{state,unreviewed}','true'::jsonb) WHERE action='financial.calculator.rbac.apply.completed'`;
      const before = await state();
      await expect(withdraw()).rejects.toThrow(
        "CALCULATOR_RBAC_OPERATION_CONFLICT"
      );
      expect(await state()).toEqual(before);
    });
  }
);
