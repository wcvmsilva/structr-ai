/** Real owned PostgreSQL/PostgREST only; no hosted Auth or remote connection. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID as cryptoRandomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  startAdr002Postgrest,
  type Adr002Postgrest,
} from "./test-support/adr002-postgrest";
import {
  formationCommand,
  seedFormationIdentity,
} from "./test-support/adr002-intake-formation-fixtures";
import { bootstrapHomologAccess } from "../scripts/homolog-access-bootstrap";
import * as proof from "../scripts/homolog-read-proof";

const enabled =
  process.env.HOMOLOG_IDENTITY_CYCLE_PHYSICAL === "1" &&
  process.env.ADR002_PHYSICAL === "1";
const randomUUID = (): string => cryptoRandomUUID();
function manifest() {
  const op = randomUUID();
  return {
    version: "structr-homolog-identity-cycle-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    sourceCommit: "c".repeat(40),
    reactivationOperationId: randomUUID(),
    withdrawalOperationId: randomUUID(),
    priorReadProof: {
      version: "structr-homolog-read-proof-v1",
      projectRef: "wmspwegbqtzamkhxhusg",
      sourceCommit: "ed64270954cef16b617f29a8c05c74801dea5b2c",
      operationId: randomUUID(),
      withdrawalOperationId: randomUUID(),
      identity: {
        version: "structr-homolog-identities-v1",
        projectRef: "wmspwegbqtzamkhxhusg",
        sourceCommit: "8e349d472f5b16494350b1dd26ccc039a9580d21",
        operationId: op,
        tenants: {
          A: { id: randomUUID(), slug: `homolog-access-a-${op}` },
          B: { id: randomUUID(), slug: `homolog-access-b-${op}` },
        },
        profiles: {
          A1: {
            id: randomUUID(),
            providerSubject: randomUUID(),
            tenant: "A",
            role: "user",
          },
          A2: {
            id: randomUUID(),
            providerSubject: randomUUID(),
            tenant: "A",
            role: "user",
          },
          B1: {
            id: randomUUID(),
            providerSubject: randomUUID(),
            tenant: "B",
            role: "user",
          },
        },
      },
      fixture: {
        clientId: randomUUID(),
        projectId: randomUUID(),
        draftId: randomUUID(),
        membershipId: randomUUID(),
      },
    },
  };
}
type Manifest = ReturnType<typeof manifest>;
describe.skipIf(!enabled)(
  "nominal identity cycle on owned PostgreSQL with IF-1",
  { timeout: 30000 },
  () => {
    let lab: Adr002Postgrest,
      operator: Awaited<ReturnType<typeof seedFormationIdentity>>;
    const db = () => lab.cluster.observer.db;
    const reactivate = (m: Manifest) =>
      Promise.resolve().then(() =>
        proof.reactivateHomologReadProofIdentities(db(), m)
      );
    const withdraw = (m: Manifest) =>
      Promise.resolve().then(() =>
        proof.withdrawHomologReadProofIdentities(db(), m)
      );
    beforeAll(async () => {
      lab = await startAdr002Postgrest({
        applyMinimumReads: true,
        applyIntakeFormation: true,
      });
      operator = await seedFormationIdentity(lab, "admin");
    }, 90000);
    afterAll(async () => {
      if (!lab) return;
      const directory = lab.cluster.directory;
      await lab.stop();
      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    }, 30000);
    async function seed(withdrawn = true) {
      const m = manifest();
      await bootstrapHomologAccess(db(), m.priorReadProof.identity);
      await proof.provisionHomologReadProof(db(), m.priorReadProof);
      if (withdrawn)
        await proof.withdrawHomologReadProof(db(), m.priorReadProof);
      return m;
    }
    async function identities(m: Manifest) {
      return lab.sql`SELECT 'tenants' AS kind,to_jsonb(t) AS row FROM tenants t WHERE id=ANY(${Object.values(m.priorReadProof.identity.tenants).map(t => t.id)}::uuid[])
      UNION ALL SELECT 'profiles',to_jsonb(p) FROM profiles p WHERE id=ANY(${Object.values(m.priorReadProof.identity.profiles).map(p => p.id)}::uuid[]) ORDER BY kind,row`;
    }
    async function history(m: Manifest) {
      return lab.sql`SELECT to_jsonb(a) AS row FROM audit_logs a WHERE new_values->>'operationId'=ANY(${[m.priorReadProof.identity.operationId, m.priorReadProof.operationId, m.priorReadProof.withdrawalOperationId]}::text[]) ORDER BY id`;
    }
    async function evidence(op: string) {
      return lab.sql`SELECT to_jsonb(a) AS row FROM audit_logs a WHERE new_values->>'operationId'=${op} OR record_id=${op} ORDER BY id`;
    }
    async function preserved(m: Manifest) {
      return lab.sql`SELECT 'clients' AS kind,to_jsonb(c) AS row FROM clients c WHERE id=${m.priorReadProof.fixture.clientId}
      UNION ALL SELECT 'projects',to_jsonb(p) FROM projects p WHERE id=${m.priorReadProof.fixture.projectId}
      UNION ALL SELECT 'drafts',to_jsonb(d) FROM estimate_drafts d WHERE id=${m.priorReadProof.fixture.draftId}
      UNION ALL SELECT 'membership',to_jsonb(p) FROM project_members p WHERE id=${m.priorReadProof.fixture.membershipId}
      UNION ALL SELECT 'operator',to_jsonb(p) FROM profiles p WHERE id=${operator.id}
      UNION ALL SELECT 'operator_tenant',to_jsonb(t) FROM tenants t WHERE id=${operator.tenant}
      UNION ALL SELECT 'issuer',to_jsonb(c) FROM structr_private.authenticated_boundary_config c ORDER BY kind`;
    }
    async function fault(
      body: string,
      run: () => Promise<void>,
      deferred = false,
      expectedCalls = 1
    ) {
      await lab.sql.unsafe(`CREATE SEQUENCE public.cycle_fault_seen;
      CREATE FUNCTION public.cycle_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$;
      ${deferred ? "CREATE CONSTRAINT TRIGGER cycle_fault AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED" : "CREATE TRIGGER cycle_fault AFTER INSERT ON audit_logs"} FOR EACH ROW EXECUTE FUNCTION public.cycle_fault()`);
      try {
        await run();
        expect(
          await lab.sql`SELECT last_value::int AS calls,is_called FROM public.cycle_fault_seen`
        ).toEqual([{ calls: expectedCalls, is_called: true }]);
      } finally {
        await lab.sql.unsafe(
          "DROP TRIGGER cycle_fault ON audit_logs; DROP FUNCTION public.cycle_fault(); DROP SEQUENCE public.cycle_fault_seen"
        );
      }
    }
    it("reactivates only the five historical identities with six durable audits and preserves O and history", async () => {
      const m = await seed(),
        before = await identities(m),
        old = await history(m),
        keep = await preserved(m);
      await expect(reactivate(m)).resolves.toMatchObject({
        status: "reactivated",
        reactivateRows: 5,
        reactivateAudits: 6,
        authVerified: false,
        databaseTargetVerified: false,
      });
      const after = await identities(m),
        audits = await evidence(m.reactivationOperationId);
      expect(before).toHaveLength(5);
      expect(after).toHaveLength(5);
      expect(audits).toHaveLength(6);
      after.forEach((r, i) => {
        expect(before[i].row.is_active).toBe(false);
        expect(r.row.is_active).toBe(true);
        expect(r.row.updated_at).not.toBe(before[i].row.updated_at);
        expect({
          ...r.row,
          is_active: false,
          updated_at: before[i].row.updated_at,
        }).toEqual(before[i].row);
      });
      expect(audits.every(a => a.row.user_id === null)).toBe(true);
      expect(audits.filter(a => a.row.old_values !== null)).toHaveLength(5);
      expect(await history(m)).toEqual(old);
      expect(await preserved(m)).toEqual(keep);
    });
    it("replays reactivation without replacing rows or audit IDs", async () => {
      const m = await seed();
      await reactivate(m);
      const before = await identities(m),
        logs = await evidence(m.reactivationOperationId);
      await expect(reactivate(m)).resolves.toMatchObject({
        status: "replayed",
      });
      expect(await identities(m)).toEqual(before);
      expect(await evidence(m.reactivationOperationId)).toEqual(logs);
    });
    it("refuses reactivation when the prior withdrawal never completed", async () => {
      const m = await seed(false),
        before = await identities(m);
      await expect(reactivate(m)).rejects.toThrow(
        /HOMOLOG_(READ|CYCLE)_OPERATION_CONFLICT/
      );
      expect(await identities(m)).toEqual(before);
      expect(await evidence(m.reactivationOperationId)).toEqual([]);
    });
    it("refuses substituting the human operator into the historical target manifest", async () => {
      const m = await seed(),
        keep = await preserved(m);
      m.priorReadProof.identity.profiles.A1.id = operator.id;
      await expect(reactivate(m)).rejects.toThrow(
        "HOMOLOG_READ_IDENTITY_CONFLICT"
      );
      expect(await preserved(m)).toEqual(keep);
      expect(await evidence(m.reactivationOperationId)).toEqual([]);
    });
    it("refuses a one-microsecond change to the withdrawn identity state", async () => {
      const m = await seed();
      await lab.sql`UPDATE profiles SET updated_at=updated_at+interval '1 microsecond' WHERE id=${m.priorReadProof.identity.profiles.A1.id}`;
      const before = await identities(m);
      await expect(reactivate(m)).rejects.toThrow("HOMOLOG_CYCLE_STATE_DRIFT");
      expect(await identities(m)).toEqual(before);
      expect(await evidence(m.reactivationOperationId)).toEqual([]);
    });
    it("refuses an extra profile in either nominal tenant", async () => {
      const m = await seed();
      await lab.sql`INSERT INTO profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${randomUUID()},${m.priorReadProof.identity.tenants.B.id},${randomUUID()},'user',true)`;
      await expect(reactivate(m)).rejects.toThrow("HOMOLOG_CYCLE_STATE_DRIFT");
      expect((await identities(m)).every(r => r.row.is_active === false)).toBe(
        true
      );
    });
    it("binds every historical audit ID and timestamp in the new receipt", async () => {
      const m = await seed();
      await reactivate(m);
      await lab.sql`UPDATE audit_logs SET id=${randomUUID()} WHERE action='homolog.read-proof.withdraw.completed' AND record_id=${m.priorReadProof.withdrawalOperationId}`;
      await expect(reactivate(m)).rejects.toThrow(
        "HOMOLOG_CYCLE_OPERATION_CONFLICT"
      );
      expect(await evidence(m.reactivationOperationId)).toHaveLength(6);
    });
    it.each(["reactivate", "withdraw"] as const)(
      "rolls back all five %s updates when the final receipt audit fails",
      async mode => {
        const m = await seed();
        if (mode === "withdraw") await reactivate(m);
        const before = await identities(m),
          old = await history(m),
          keep = await preserved(m);
        await fault(
          `IF NEW.action='homolog.identity-cycle.${mode}.completed' THEN PERFORM nextval('public.cycle_fault_seen'); RAISE EXCEPTION 'PRIVATE_DRIVER_SENTINEL'; END IF;`,
          async () => {
            await expect(
              mode === "reactivate" ? reactivate(m) : withdraw(m)
            ).rejects.toThrow("HOMOLOG_CYCLE_FAILED");
            expect(await identities(m)).toEqual(before);
            expect(await history(m)).toEqual(old);
            expect(await preserved(m)).toEqual(keep);
            expect(
              await evidence(
                mode === "reactivate"
                  ? m.reactivationOperationId
                  : m.withdrawalOperationId
              )
            ).toEqual([]);
          }
        );
      }
    );
    it("rolls back a deferred trigger changing an identity after receipt insertion", async () => {
      const m = await seed(),
        before = await identities(m);
      await fault(
        `IF NEW.action='homolog.identity-cycle.reactivate.completed' THEN PERFORM nextval('public.cycle_fault_seen'); UPDATE profiles SET updated_at=updated_at+interval '1 microsecond' WHERE id='${m.priorReadProof.identity.profiles.A2.id}'; END IF;`,
        async () => {
          await expect(reactivate(m)).rejects.toThrow(
            "HOMOLOG_CYCLE_STATE_DRIFT"
          );
          expect(await identities(m)).toEqual(before);
          expect(await evidence(m.reactivationOperationId)).toEqual([]);
        },
        true
      );
    });
    it("rolls back a trigger replacing the new receipt physical ID", async () => {
      const m = await seed(),
        before = await identities(m);
      await fault(
        "IF NEW.action='homolog.identity-cycle.reactivate.completed' THEN PERFORM nextval('public.cycle_fault_seen'); UPDATE audit_logs SET id=gen_random_uuid() WHERE id=NEW.id; END IF;",
        async () => {
          await expect(reactivate(m)).rejects.toThrow(
            "HOMOLOG_CYCLE_OPERATION_CONFLICT"
          );
          expect(await identities(m)).toEqual(before);
          expect(await evidence(m.reactivationOperationId)).toEqual([]);
        }
      );
    });
    it.each(["40001", "40P01"])(
      "retries the complete cycle after transient SQLSTATE %s without duplicate audits",
      async state => {
        const m = await seed(),
          old = await history(m);
        await fault(
          `IF NEW.action='homolog.identity-cycle.reactivate.completed' AND nextval('public.cycle_fault_seen')=1 THEN RAISE EXCEPTION 'PRIVATE_DRIVER_SENTINEL' USING ERRCODE='${state}'; END IF;`,
          async () => {
            await expect(reactivate(m)).resolves.toMatchObject({
              status: "reactivated",
            });
            expect(await evidence(m.reactivationOperationId)).toHaveLength(6);
            expect(
              (await identities(m)).every(r => r.row.is_active === true)
            ).toBe(true);
            expect(await history(m)).toEqual(old);
          },
          false,
          2
        );
      }
    );
    it("bounds repeated serialization failures to three attempts with complete rollback", async () => {
      const m = await seed(),
        before = await identities(m),
        old = await history(m);
      await fault(
        "IF NEW.action='homolog.identity-cycle.reactivate.completed' THEN PERFORM nextval('public.cycle_fault_seen'); RAISE EXCEPTION 'PRIVATE_DRIVER_SENTINEL' USING ERRCODE='40001'; END IF;",
        async () => {
          await expect(reactivate(m)).rejects.toThrow("HOMOLOG_CYCLE_FAILED");
          expect(await identities(m)).toEqual(before);
          expect(await evidence(m.reactivationOperationId)).toEqual([]);
          expect(await history(m)).toEqual(old);
        },
        false,
        3
      );
    });
    it("withdraws the reactivated identities with six new audits and replays without duplication", async () => {
      const m = await seed();
      await reactivate(m);
      const old = await history(m),
        activation = await evidence(m.reactivationOperationId),
        keep = await preserved(m);
      await expect(withdraw(m)).resolves.toMatchObject({
        status: "withdrawn",
        withdrawRows: 5,
        withdrawAudits: 6,
      });
      const before = await identities(m),
        logs = await evidence(m.withdrawalOperationId);
      expect(before.every(r => r.row.is_active === false)).toBe(true);
      expect(logs).toHaveLength(6);
      await expect(withdraw(m)).resolves.toMatchObject({ status: "replayed" });
      expect(await identities(m)).toEqual(before);
      expect(await evidence(m.withdrawalOperationId)).toEqual(logs);
      expect(await history(m)).toEqual(old);
      expect(await evidence(m.reactivationOperationId)).toEqual(activation);
      expect(await preserved(m)).toEqual(keep);
    });
    it("refuses reactivation after the new withdrawal instead of silently resurrecting authority", async () => {
      const m = await seed();
      await reactivate(m);
      await withdraw(m);
      const before = await identities(m),
        logs = await evidence(m.reactivationOperationId);
      await expect(reactivate(m)).rejects.toThrow("HOMOLOG_CYCLE_WITHDRAWN");
      expect(await identities(m)).toEqual(before);
      expect(await evidence(m.reactivationOperationId)).toEqual(logs);
    });
    it("refuses withdrawal without the new reactivation evidence", async () => {
      const m = await seed();
      await expect(withdraw(m)).rejects.toThrow(
        "HOMOLOG_CYCLE_OPERATION_CONFLICT"
      );
      expect(await evidence(m.withdrawalOperationId)).toEqual([]);
    });
    it("serializes concurrent reactivation on separate real connections", async () => {
      const m = await seed(),
        other = await lab.connectSupervisor();
      const results = await Promise.all([
        reactivate(m),
        Promise.resolve().then(() =>
          proof.reactivateHomologReadProofIdentities(drizzle(other), m)
        ),
      ]);
      expect(results.map(r => r.status).sort()).toEqual([
        "reactivated",
        "replayed",
      ]);
      expect(await evidence(m.reactivationOperationId)).toHaveLength(6);
    });
    it("coexists with real IF-1 formation, preserves its three rows/audits and revokes the same valid bearer", async () => {
      const m = await seed();
      await reactivate(m);
      const actor = {
        id: m.priorReadProof.identity.profiles.A1.id,
        tenant: m.priorReadProof.identity.tenants.A.id,
        sub: m.priorReadProof.identity.profiles.A1.providerSubject,
        session: randomUUID(),
      };
      const token = await lab.token({
        sub: actor.sub,
        session_id: actor.session,
      });
      const command = formationCommand(actor),
        preimage = JSON.stringify(command);
      const formed = await lab.rpc("structr_intake_create_v1", token, {
        preimage,
      });
      expect(formed.status).toBe(200);
      expect(
        (await lab.rpc("structr_intake_create_v1", token, { preimage })).body
      ).toEqual(formed.body);
      const [row] =
        await lab.sql`SELECT client_id FROM projects WHERE id=${formed.body.intake.projectId}`;
      const formationIds = [
        row.client_id,
        formed.body.intake.projectId,
        command.requestId,
      ];
      async function formedRows() {
        return lab.sql`SELECT 'client' AS kind,to_jsonb(c) AS row FROM clients c WHERE id=${row.client_id}
        UNION ALL SELECT 'project',to_jsonb(p) FROM projects p WHERE id=${formed.body.intake.projectId}
        UNION ALL SELECT 'intake',to_jsonb(i) FROM intake_forms i WHERE id=${command.requestId}
        UNION ALL SELECT 'audit',to_jsonb(a) FROM audit_logs a WHERE record_id=ANY(${formationIds}::uuid[]) ORDER BY kind,row`;
      }
      const before = await formedRows(),
        keep = await preserved(m),
        old = await history(m);
      expect(before).toHaveLength(6);
      await expect(
        proof.withdrawHomologReadProof(db(), m.priorReadProof)
      ).rejects.toThrow("HOMOLOG_READ_STATE_DRIFT");
      await withdraw(m);
      expect(await formedRows()).toEqual(before);
      expect(await preserved(m)).toEqual(keep);
      expect(await history(m)).toEqual(old);
      const claims = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString()
      );
      expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(
        (await lab.rpc("structr_authenticated_session_v1", token)).status
      ).toBe(403);
      expect(
        (await lab.rpc("structr_intake_create_v1", token, { preimage })).status
      ).toBe(403);
      expect(
        (
          await lab.rpc("structr_intake_create_v1", token, {
            preimage: JSON.stringify(formationCommand(actor)),
          })
        ).status
      ).toBe(403);
      expect(await formedRows()).toEqual(before);
      await expect(withdraw(m)).resolves.toMatchObject({ status: "replayed" });
    });
  }
);
