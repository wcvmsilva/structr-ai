/** Owned PostgreSQL only; no remote connection or credentials. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  startAdr002Postgrest,
  type Adr002Postgrest,
} from "./test-support/adr002-postgrest";
import {
  seedContinuation,
  physicalRows,
  evidenceHash,
} from "./test-support/homolog-continuation-fixtures";
import { auditLogs } from "../drizzle/schema";
import * as proof from "../scripts/homolog-read-proof";
const enabled =
  process.env.HOMOLOG_IDENTITY_CONTINUATION_PHYSICAL === "1" &&
  process.env.ADR002_PHYSICAL === "1";
describe.skipIf(!enabled)(
  "bounded continuation on physical PostgreSQL",
  { timeout: 30000 },
  () => {
    let lab: Adr002Postgrest;
    beforeAll(async () => {
      lab = await startAdr002Postgrest({
        applyMinimumReads: true,
        applyIntakeFormation: true,
      });
    }, 90000);
    afterAll(async () => {
      if (lab) {
        const d = lab.cluster.directory;
        await lab.stop();
        await expect(access(d)).rejects.toMatchObject({ code: "ENOENT" });
      }
    }, 30000);
    it("accepts the exact closed predecessor plus two audited formations and preserves them on replay/withdrawal", async () => {
      const m = await seedContinuation(lab),
        before = await physicalRows(lab, auditLogs, "audit_logs"),
        db = lab.cluster.observer.db;
      await expect(
        proof.reactivateHomologIdentityContinuation(db, m)
      ).resolves.toMatchObject({ status: "reactivated" });
      await expect(
        proof.reactivateHomologIdentityContinuation(db, m)
      ).resolves.toMatchObject({ status: "replayed" });
      expect(await physicalRows(lab, auditLogs, "audit_logs")).toHaveLength(
        before.length + 6
      );
      await expect(
        proof.withdrawHomologIdentityContinuation(db, m)
      ).resolves.toMatchObject({ status: "withdrawn" });
      await expect(
        proof.withdrawHomologIdentityContinuation(db, m)
      ).resolves.toMatchObject({ status: "replayed" });
      const after = await physicalRows(lab, auditLogs, "audit_logs");
      expect(after.filter(r => before.some(b => b.id === r.id))).toEqual(
        before
      );
      expect(after).toHaveLength(before.length + 12);
      await expect(
        proof.reactivateHomologIdentityContinuation(db, m)
      ).rejects.toThrow("HOMOLOG_CONTINUATION_WITHDRAWN");
    });
    it.each([
      "receipt",
      "state hash",
      "history hash",
      "history count",
      "current microsecond",
      "physical microsecond",
      "optional field",
      "extra intake",
      "missing audit",
      "changed audit metadata",
      "changed snapshot",
      "predecessor receipt",
    ])("refuses %s without any identity or audit write", async kind => {
      const m = await seedContinuation(lab),
        f = m.formations[0],
        p = m.priorReadProof.identity.profiles.A1.id;
      if (kind === "receipt")
        m.predecessor.withdrawalReceiptHash = "b".repeat(64);
      if (kind === "state hash")
        m.predecessor.withdrawnStateHash = "b".repeat(64);
      if (kind === "history hash") m.auditHistory.hash = "b".repeat(64);
      if (kind === "history count") m.auditHistory.count++;
      if (kind === "current microsecond")
        await lab.sql`UPDATE profiles SET updated_at=updated_at+interval '1 microsecond' WHERE id=${p}`;
      if (kind === "physical microsecond")
        await lab.sql`UPDATE intake_forms SET updated_at=updated_at+interval '1 microsecond' WHERE id=${f.intakeFormId}`;
      if (kind === "optional field")
        await lab.sql`UPDATE clients SET notes='unaudited drift' WHERE id=${f.clientId}`;
      if (kind === "extra intake")
        await lab.sql`INSERT INTO intake_forms(tenant_id,project_id,status,form_data) VALUES(${m.priorReadProof.identity.tenants.A.id},${f.projectId},'draft','{}')`;
      if (kind === "missing audit")
        await lab.sql`DELETE FROM audit_logs WHERE id=${f.audits[0].id}`;
      if (kind === "changed audit metadata")
        await lab.sql`UPDATE audit_logs SET created_at=created_at+interval '1 microsecond' WHERE id=${f.audits[0].id}`;
      if (kind === "changed snapshot")
        await lab.sql`UPDATE audit_logs SET new_values=new_values||'{"notes":"drift"}'::jsonb WHERE id=${f.audits[0].id}`;
      if (kind === "predecessor receipt")
        await lab.sql`UPDATE audit_logs SET new_values=jsonb_set(new_values,'{executorId}','"wrong"') WHERE record_id=${m.predecessor.manifest.withdrawalOperationId}`;
      const before =
          await lab.sql`SELECT to_jsonb(p) AS row FROM profiles p ORDER BY id`,
        logs = await physicalRows(lab, auditLogs, "audit_logs");
      await expect(
        proof.reactivateHomologIdentityContinuation(lab.cluster.observer.db, m)
      ).rejects.toThrow(/HOMOLOG_(CONTINUATION|CYCLE)_/);
      expect(
        await lab.sql`SELECT to_jsonb(p) AS row FROM profiles p ORDER BY id`
      ).toEqual(before);
      expect(await physicalRows(lab, auditLogs, "audit_logs")).toEqual(logs);
    });
    it("refuses changed full audit evidence even when a supplied history digest is updated", async () => {
      const m = await seedContinuation(lab),
        f = m.formations[0];
      await lab.sql`UPDATE audit_logs SET old_values='{}' WHERE id=${f.audits[0].id}`;
      const logs = await physicalRows(lab, auditLogs, "audit_logs");
      m.auditHistory.hash = evidenceHash(logs);
      f.audits[0].hash = evidenceHash(logs.find(r => r.id === f.audits[0].id));
      await expect(
        proof.reactivateHomologIdentityContinuation(lab.cluster.observer.db, m)
      ).rejects.toThrow("HOMOLOG_CONTINUATION_STATE_DRIFT");
    });
    it("requires IF1 audit timestamps to match its atomic physical creation even if supplied hashes agree", async () => {
      const m = await seedContinuation(lab),
        f = m.formations[0];
      await lab.sql`UPDATE audit_logs SET created_at=created_at+interval '1 microsecond' WHERE id=${f.audits[0].id}`;
      const logs = await physicalRows(lab, auditLogs, "audit_logs");
      m.auditHistory.hash = evidenceHash(logs);
      f.audits[0].hash = evidenceHash(logs.find(r => r.id === f.audits[0].id));
      await expect(
        proof.reactivateHomologIdentityContinuation(lab.cluster.observer.db, m)
      ).rejects.toThrow("HOMOLOG_CONTINUATION_STATE_DRIFT");
    });
    it("refuses an executor whose issuer SELECT is filtered by private RLS", async () => {
      const m = await seedContinuation(lab),
        other = await lab.connectSupervisor();
      const names = [
        "tenants",
        "profiles",
        "clients",
        "projects",
        "estimate_drafts",
        "project_members",
        "audit_logs",
        "intake_forms",
      ];
      await lab.sql.unsafe(
        "GRANT CREATE ON SCHEMA public TO app_runtime; GRANT USAGE ON SCHEMA structr_private TO app_runtime; GRANT SELECT,UPDATE(id) ON structr_private.authenticated_boundary_config TO app_runtime"
      );
      for (const name of names)
        await lab.sql.unsafe(`ALTER TABLE public.${name} OWNER TO app_runtime`);
      try {
        await other`SET ROLE app_runtime`;
        expect(
          await other`SELECT id FROM structr_private.authenticated_boundary_config`
        ).toHaveLength(0);
        await expect(
          proof.reactivateHomologIdentityContinuation(drizzle(other), m)
        ).rejects.toThrow("HOMOLOG_CONTINUATION_FAILED");
      } finally {
        await other`RESET ROLE`;
        for (const name of names)
          await lab.sql.unsafe(
            `ALTER TABLE public.${name} OWNER TO app_principal_runner`
          );
        await lab.sql.unsafe(
          "REVOKE CREATE ON SCHEMA public FROM app_runtime; REVOKE ALL ON structr_private.authenticated_boundary_config FROM app_runtime; REVOKE USAGE ON SCHEMA structr_private FROM app_runtime"
        );
        await other.end();
      }
    });
    it.each([false, true])(
      "rolls back all five identity updates after %s deferred audit corruption",
      async deferred => {
        const m = await seedContinuation(lab),
          before = await physicalRows(lab, auditLogs, "audit_logs");
        await lab.sql
          .unsafe(`CREATE FUNCTION public.continuation_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='homolog.identity-continuation.reactivate.completed' THEN UPDATE intake_forms SET form_data=form_data||'{"unexpected":true}' WHERE id='${m.formations[0].intakeFormId}'; END IF; RETURN NEW; END $$;
      ${deferred ? "CREATE CONSTRAINT TRIGGER continuation_fault AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED" : "CREATE TRIGGER continuation_fault AFTER INSERT ON audit_logs"} FOR EACH ROW EXECUTE FUNCTION public.continuation_fault()`);
        try {
          await expect(
            proof.reactivateHomologIdentityContinuation(
              lab.cluster.observer.db,
              m
            )
          ).rejects.toThrow("HOMOLOG_CONTINUATION_STATE_DRIFT");
          expect(await physicalRows(lab, auditLogs, "audit_logs")).toEqual(
            before
          );
          expect(
            (
              await lab.sql`SELECT is_active FROM profiles WHERE id=${m.priorReadProof.identity.profiles.A1.id}`
            )[0].is_active
          ).toBe(false);
        } finally {
          await lab.sql.unsafe(
            "DROP TRIGGER continuation_fault ON audit_logs; DROP FUNCTION public.continuation_fault()"
          );
        }
      }
    );
    it("rolls back a deferred seventh audit hidden under the future withdrawal operation", async () => {
      const m = await seedContinuation(lab),
        before = await physicalRows(lab, auditLogs, "audit_logs");
      await lab.sql
        .unsafe(`CREATE FUNCTION public.continuation_extra() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='homolog.identity-continuation.reactivate.completed' THEN INSERT INTO audit_logs(action,table_name,record_id,new_values) VALUES('spurious','homolog_identity_continuation','${m.withdrawalOperationId}','{"operationId":"${m.withdrawalOperationId}"}'); END IF; RETURN NEW; END $$;
      CREATE CONSTRAINT TRIGGER continuation_extra AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.continuation_extra()`);
      try {
        await expect(
          proof.reactivateHomologIdentityContinuation(
            lab.cluster.observer.db,
            m
          )
        ).rejects.toThrow("HOMOLOG_CONTINUATION_STATE_DRIFT");
        expect(await physicalRows(lab, auditLogs, "audit_logs")).toEqual(
          before
        );
        expect(
          (
            await lab.sql`SELECT is_active FROM profiles WHERE id=${m.priorReadProof.identity.profiles.A1.id}`
          )[0].is_active
        ).toBe(false);
      } finally {
        await lab.sql.unsafe(
          "DROP TRIGGER continuation_extra ON audit_logs; DROP FUNCTION public.continuation_extra()"
        );
      }
    });
    it.each(["40001", "40P01"])(
      "retries complete transactions only on %s",
      async code => {
        const m = await seedContinuation(lab),
          before = await physicalRows(lab, auditLogs, "audit_logs");
        await lab.sql.unsafe(
          `CREATE SEQUENCE public.continuation_seen; CREATE FUNCTION public.continuation_retry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='homolog.identity-continuation.reactivate.completed' AND nextval('public.continuation_seen')<3 THEN RAISE EXCEPTION 'retry' USING ERRCODE='${code}'; END IF; RETURN NEW; END $$; CREATE TRIGGER continuation_retry AFTER INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.continuation_retry()`
        );
        try {
          await expect(
            proof.reactivateHomologIdentityContinuation(
              lab.cluster.observer.db,
              m
            )
          ).resolves.toMatchObject({ status: "reactivated" });
          expect(await physicalRows(lab, auditLogs, "audit_logs")).toHaveLength(
            before.length + 6
          );
          expect(
            (
              await lab.sql`SELECT last_value::int AS value FROM continuation_seen`
            )[0].value
          ).toBe(3);
        } finally {
          await lab.sql.unsafe(
            "DROP TRIGGER continuation_retry ON audit_logs; DROP FUNCTION public.continuation_retry(); DROP SEQUENCE public.continuation_seen"
          );
        }
      }
    );
  }
);
