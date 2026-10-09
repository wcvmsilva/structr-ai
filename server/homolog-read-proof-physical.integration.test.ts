/** Owned socket-only PostgreSQL. No Auth rows, provider calls, signing key or hosted acceptance. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  startAppPrincipalPostgres,
  type AppPrincipalCluster,
} from "./test-support/app-principal-postgres";
import { bootstrapHomologAccess } from "../scripts/homolog-access-bootstrap";
import {
  provisionHomologReadProof,
  withdrawHomologReadProof,
} from "../scripts/homolog-read-proof";
import { decodeAuthenticatedEstimateDraftRead } from "./authenticated-estimate-draft-read";
import { buildAuthenticatedInternalApprovalRecord } from "./authenticated-internal-approval-record";

function manifest() {
  const operationId = randomUUID();
  return {
    version: "structr-homolog-read-proof-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    operationId,
    withdrawalOperationId: randomUUID(),
    sourceCommit: "b".repeat(40),
    identity: {
      version: "structr-homolog-identities-v1",
      projectRef: "wmspwegbqtzamkhxhusg",
      operationId: randomUUID(),
      sourceCommit: "a".repeat(40),
      tenants: {
        A: { id: randomUUID(), slug: `homolog-access-a-${operationId}` },
        B: { id: randomUUID(), slug: `homolog-access-b-${operationId}` },
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
  };
}
type Manifest = ReturnType<typeof manifest>;
const enabled =
  process.env.APP_PRINCIPAL_LAB === "1" &&
  process.env.HOMOLOG_READ_PROOF_PHYSICAL === "1";
describe.skipIf(!enabled)(
  "homolog read-proof transactions on owned PostgreSQL 0000–0017",
  () => {
    let cluster: AppPrincipalCluster;
    const raw = () => cluster.observer.sql;
    const db = () => cluster.observer.db;
    beforeAll(async () => {
      cluster = await startAppPrincipalPostgres(postgres);
      await raw().unsafe(
        "CREATE ROLE anon NOLOGIN NOBYPASSRLS; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT anon,authenticated TO authenticator WITH INHERIT FALSE,SET TRUE"
      );
      const migrations = new URL("../drizzle/", import.meta.url);
      const journal = JSON.parse(
        await readFile(new URL("meta/_journal.json", migrations), "utf8")
      );
      for (const { tag } of journal.entries.filter(
        (e: { tag: string }) => Number(e.tag.slice(0, 4)) <= 17
      )) {
        if (tag.startsWith("0015"))
          await raw().unsafe(`
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator,service_role;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator,service_role;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator,service_role;
        REVOKE USAGE ON SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
      `);
        const source = await readFile(
          new URL(`${tag}.sql`, migrations),
          "utf8"
        );
        await raw().begin(tx => tx.unsafe(source));
      }
      await raw()`INSERT INTO structr_private.authenticated_boundary_config(id,issuer,audience) VALUES(true,'https://read-proof-lab.invalid/auth/v1','authenticated')`;
    }, 90_000);
    afterAll(async () => {
      if (!cluster) return;
      const directory = cluster.directory;
      await cluster.stop();
      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
      console.log(
        "HOMOLOG_READ_PROOF_CLEANUP",
        JSON.stringify({ directory, removed: true })
      );
    }, 20_000);
    async function seed() {
      const m = manifest();
      await bootstrapHomologAccess(db(), m.identity);
      return m;
    }
    async function counts(m: Manifest) {
      const [row] = await raw()`SELECT
      (SELECT count(*)::int FROM clients WHERE id=${m.fixture.clientId}) AS clients,
      (SELECT count(*)::int FROM projects WHERE id=${m.fixture.projectId}) AS projects,
      (SELECT count(*)::int FROM estimate_drafts WHERE id=${m.fixture.draftId}) AS drafts,
      (SELECT count(*)::int FROM project_members WHERE id=${m.fixture.membershipId}) AS members,
      (SELECT count(*)::int FROM audit_logs WHERE new_values->>'operationId'=${m.operationId}) AS audits,
      (SELECT count(*)::int FROM audit_logs WHERE new_values->>'operationId'=${m.withdrawalOperationId}) AS "withdrawalAudits"`;
      return row;
    }
    const none = {
      clients: 0,
      projects: 0,
      drafts: 0,
      members: 0,
      audits: 0,
      withdrawalAudits: 0,
    };
    const created = {
      clients: 1,
      projects: 1,
      drafts: 1,
      members: 1,
      audits: 5,
      withdrawalAudits: 0,
    };
    async function withAuditTrigger(
      body: string,
      run: () => Promise<void>,
      timing = "BEFORE"
    ) {
      await raw()
        .unsafe(`CREATE FUNCTION public.read_proof_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$;
      ${timing === "DEFERRED" ? "CREATE CONSTRAINT TRIGGER read_proof_test_fault AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED" : `CREATE TRIGGER read_proof_test_fault ${timing} INSERT ON audit_logs`} FOR EACH ROW EXECUTE FUNCTION public.read_proof_test_fault()`);
      try {
        await run();
      } finally {
        await raw().unsafe(
          "DROP TRIGGER read_proof_test_fault ON audit_logs; DROP FUNCTION public.read_proof_test_fault()"
        );
      }
    }
    async function identityActive(m: Manifest) {
      const [row] = await raw()`SELECT
      (SELECT count(*)::int FROM profiles WHERE id=ANY(${Object.values(m.identity.profiles).map(p => p.id)}::uuid[]) AND is_active) AS profiles,
      (SELECT count(*)::int FROM tenants WHERE id=ANY(${Object.values(m.identity.tenants).map(t => t.id)}::uuid[]) AND is_active) AS tenants`;
      return row;
    }
    // This intentionally exercises only SQL projection/decoder compatibility. It does
    // not authenticate a JWT or create any Auth user/session and is not a hosted proof.
    async function localProjection(
      name: string,
      m: Manifest,
      alias: "A1" | "A2" | "B1"
    ) {
      return raw().begin("isolation level serializable", async tx => {
        const now = Math.floor(Date.now() / 1000);
        await tx.unsafe(
          "SET LOCAL SESSION AUTHORIZATION authenticator; SET LOCAL ROLE authenticated"
        );
        await tx.unsafe("SELECT set_config('request.method','POST',true),set_config('request.jwt.claims',$1,true)", [JSON.stringify(
          {
            iss: "https://read-proof-lab.invalid/auth/v1",
            aud: "authenticated",
            role: "authenticated",
            is_anonymous: false,
            sub: m.identity.profiles[alias].providerSubject,
            session_id: randomUUID(),
            iat: now,
            exp: now + 600,
          }
        )]);
        const [row] = await tx.unsafe(
          `SELECT public.${name}($1::jsonb) AS value`,
          [JSON.stringify({ id: m.fixture.draftId })]
        );
        return row.value;
      });
    }

    it("creates only C/P/D/M and five exact audits, with no Auth schema", async () => {
      const m = await seed();
      expect(await provisionHomologReadProof(db(), m)).toMatchObject({
        status: "created",
        createRows: 4,
        authVerified: false,
        databaseTargetVerified: false,
      });
      expect(await counts(m)).toEqual(created);
      expect(
        await raw()`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='auth'`
      ).toEqual([{ n: 0 }]);
    });
    it("preserves truthful null finances/geography and lets the real project trigger classify provenance", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      const [p] =
        await raw()`SELECT owner_user_id,client_id,status,project_type,provenance_state,city,state,channel,geocoded_at,committed_cost_cents,change_order_budget_cents FROM projects WHERE id=${m.fixture.projectId}`;
      expect(p).toEqual({
        owner_user_id: m.identity.profiles.A1.id,
        client_id: m.fixture.clientId,
        status: "estimate",
        project_type: "repair",
        provenance_state: "formation_only",
        city: null,
        state: null,
        channel: null,
        geocoded_at: null,
        committed_cost_cents: 0,
        change_order_budget_cents: 0,
      });
      const [d] =
        await raw()`SELECT source,created_by,subtotal_cost,final_total_price,pricing_snapshot,profit_shield_passed,line_items,assembly_selections FROM estimate_drafts WHERE id=${m.fixture.draftId}`;
      expect(d).toEqual({
        source: null,
        created_by: null,
        subtotal_cost: null,
        final_total_price: null,
        pricing_snapshot: null,
        profit_shield_passed: null,
        line_items: [],
        assembly_selections: [],
      });
    });
    it.each(["A1", "A2"] as const)(
      "the exact minimal fixture is accepted by both existing SQL projections and decoders for %s",
      async alias => {
        const m = await seed();
        await provisionHomologReadProof(db(), m);
        const identity = {
          actorId: m.identity.profiles[alias].id,
          tenantId: m.identity.tenants.A.id,
        };
        const detail = await localProjection(
          "structr_estimate_draft_read_v1",
          m,
          alias
        );
        expect(
          decodeAuthenticatedEstimateDraftRead(
            detail,
            { id: m.fixture.draftId },
            identity
          )
        ).toMatchObject({
          id: m.fixture.draftId,
          source: null,
          finalTotalPrice: null,
          historicalImportId: null,
        });
        const record = await localProjection(
          "structr_internal_approval_record_v1",
          m,
          alias
        );
        expect(
          await buildAuthenticatedInternalApprovalRecord(
            record,
            { id: m.fixture.draftId },
            identity
          )
        ).toEqual({
          state: "none",
          approval: null,
          snapshot: null,
          revocation: null,
        });
      }
    );
    it("keeps the local SQL cross-tenant errors distinct", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      await expect(
        localProjection("structr_estimate_draft_read_v1", m, "B1")
      ).rejects.toMatchObject({ code: "P0001", message: "FORBIDDEN" });
      await expect(
        localProjection("structr_internal_approval_record_v1", m, "B1")
      ).rejects.toMatchObject({ code: "P0001", message: "NOT_FOUND" });
    });
    it("attributes administrative creation to the observed principal and never to A1", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      const logs =
        await raw()`SELECT user_id,old_values,new_values FROM audit_logs WHERE new_values->>'operationId'=${m.operationId}`;
      expect(logs).toHaveLength(5);
      expect(logs.every(r => r.user_id === null && r.old_values === null)).toBe(
        true
      );
      expect(
        logs.find(r => r.new_values.administrativeActor)?.new_values
          .administrativeActor
      ).toEqual({
        kind: "database-principal",
        currentUser: "app_principal_runner",
        sessionUser: "app_principal_runner",
      });
    });
    it("replays creation exactly without adding audit rows", async () => {
      const m = await seed(),
        first = await provisionHomologReadProof(db(), m);
      expect(await provisionHomologReadProof(db(), structuredClone(m))).toEqual(
        { ...first, status: "replayed" }
      );
      expect(await counts(m)).toEqual(created);
    });
    it("does not provision identities when the bootstrap is absent", async () => {
      const m = manifest();
      await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_IDENTITY_CONFLICT"
      );
      expect(await counts(m)).toEqual(none);
      expect(await identityActive(m)).toEqual({ profiles: 0, tenants: 0 });
    });
    it.each(["inactive", "mapping", "tenant", "microsecond"])(
      "refuses %s drift of bootstrap state before business creation",
      async kind => {
        const m = await seed();
        if (kind === "inactive")
          await raw()`UPDATE profiles SET is_active=false WHERE id=${m.identity.profiles.A2.id}`;
        if (kind === "mapping")
          await raw()`UPDATE profiles SET external_open_id=${randomUUID()} WHERE id=${m.identity.profiles.A2.id}`;
        if (kind === "tenant")
          await raw()`UPDATE profiles SET tenant_id=${m.identity.tenants.B.id} WHERE id=${m.identity.profiles.A2.id}`;
        if (kind === "microsecond")
          await raw()`UPDATE tenants SET updated_at=updated_at+interval '1 microsecond' WHERE id=${m.identity.tenants.A.id}`;
        await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
          "HOMOLOG_READ_IDENTITY_CONFLICT"
        );
        expect(await counts(m)).toEqual(none);
      }
    );
    it("requires all bootstrap row audits, not only its completion receipt", async () => {
      const m = await seed();
      await raw()`DELETE FROM audit_logs WHERE new_values->>'operationId'=${m.identity.operationId} AND action='homolog.identity.profile.create' AND record_id=${m.identity.profiles.A2.id}`;
      await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_IDENTITY_CONFLICT"
      );
      expect(await counts(m)).toEqual(none);
    });
    it("refuses pre-existing client collision without adopting it", async () => {
      const m = await seed();
      await raw()`INSERT INTO clients(id,tenant_id,name) VALUES(${m.fixture.clientId},${m.identity.tenants.B.id},'Foreign existing client')`;
      await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_COLLISION"
      );
      expect(await counts(m)).toEqual({ ...none, clients: 1 });
    });
    it("rejects changed manifest under an existing operation id", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      m.sourceCommit = "c".repeat(40);
      await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_OPERATION_CONFLICT"
      );
      expect(await counts(m)).toEqual(created);
    });
    it.each(["money", "microsecond", "viewer"])(
      "refuses replay after %s business drift",
      async kind => {
        const m = await seed();
        await provisionHomologReadProof(db(), m);
        if (kind === "money")
          await raw()`UPDATE estimate_drafts SET final_total_price=123 WHERE id=${m.fixture.draftId}`;
        if (kind === "microsecond")
          await raw()`UPDATE clients SET updated_at=updated_at+interval '1 microsecond' WHERE id=${m.fixture.clientId}`;
        if (kind === "viewer")
          await raw()`UPDATE project_members SET project_role='manager' WHERE id=${m.fixture.membershipId}`;
        await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
          "HOMOLOG_READ_STATE_DRIFT"
        );
      }
    );
    it.each(["raise", "suppress", "alter"])(
      "rolls back all four creations if final receipt is %s",
      async kind => {
        const m = await seed();
        const fault =
          kind === "raise"
            ? "RAISE EXCEPTION 'SECRET_DRIVER_DETAIL';"
            : kind === "suppress"
              ? "RETURN NULL;"
              : "NEW.new_values:=jsonb_set(NEW.new_values,'{manifestHash}','\"bad\"');";
        await withAuditTrigger(
          `IF NEW.action='homolog.read-proof.create.completed' THEN ${fault} END IF;`,
          async () => {
            await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
              /^HOMOLOG_READ_/
            );
            expect(await counts(m)).toEqual(none);
          }
        );
      }
    );
    it("rechecks business state after the receipt trigger changes an earlier row", async () => {
      const m = await seed();
      await withAuditTrigger(
        `IF NEW.action='homolog.read-proof.create.completed' THEN UPDATE public.clients SET name='Late forged client' WHERE id='${m.fixture.clientId}'; END IF;`,
        async () => {
          await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
            "HOMOLOG_READ_STATE_DRIFT"
          );
          expect(await counts(m)).toEqual(none);
        },
        "AFTER"
      );
    });
    it("rechecks all earlier audits after insertion of the receipt", async () => {
      const m = await seed();
      await withAuditTrigger(
        `IF NEW.action='homolog.read-proof.create.completed' THEN UPDATE public.audit_logs SET new_values='{}' WHERE action='homolog.read-proof.clients.create' AND record_id='${m.fixture.clientId}'; END IF;`,
        async () => {
          await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
            "HOMOLOG_READ_OPERATION_CONFLICT"
          );
          expect(await counts(m)).toEqual(none);
        },
        "AFTER"
      );
    });
    it.each(["row", "receipt"])("rejects altered %s audit timestamps before creation commits", async kind => {
      const m = await seed();
      const action = kind === "row" ? "homolog.read-proof.clients.create" : "homolog.read-proof.create.completed";
      await withAuditTrigger(`IF NEW.action='${action}' THEN NEW.created_at:=NEW.created_at+interval '1 microsecond'; END IF;`, async () => {
        await expect(provisionHomologReadProof(db(), m)).rejects.toThrow("HOMOLOG_READ_OPERATION_CONFLICT");
        expect(await counts(m)).toEqual(none);
      });
    });
    it.each(["row", "receipt"])("rejects %s audit timestamp drift on replay", async kind => {
      const m = await seed(); await provisionHomologReadProof(db(), m);
      const action = kind === "row" ? "homolog.read-proof.clients.create" : "homolog.read-proof.create.completed";
      await raw()`UPDATE audit_logs SET created_at=created_at+interval '1 microsecond' WHERE new_values->>'operationId'=${m.operationId} AND action=${action}`;
      await expect(provisionHomologReadProof(db(), m)).rejects.toThrow("HOMOLOG_READ_OPERATION_CONFLICT");
    });
    it("rejects an inconsistent historical bootstrap audit clock before creation", async () => {
      const m = await seed();
      await raw()`UPDATE audit_logs SET created_at=created_at+interval '1 microsecond' WHERE record_id=${m.identity.profiles.A1.id} AND action='homolog.identity.profile.create'`;
      await expect(provisionHomologReadProof(db(), m)).rejects.toThrow("HOMOLOG_READ_IDENTITY_CONFLICT");
      expect(await counts(m)).toEqual(none);
    });
    it("preserves inherited bootstrap audit identities against later replacement", async () => {
      const m = await seed(); await provisionHomologReadProof(db(), m);
      await raw()`UPDATE audit_logs SET id=${randomUUID()} WHERE record_id=${m.identity.profiles.A1.id} AND action='homolog.identity.profile.create'`;
      await expect(provisionHomologReadProof(db(), m)).rejects.toThrow("HOMOLOG_READ_OPERATION_CONFLICT");
    });
    it("rejects replacement of an earlier audit ID after the completion receipt was written", async () => {
      const m = await seed();
      await withAuditTrigger(`IF NEW.action='homolog.read-proof.create.completed' THEN UPDATE public.audit_logs SET id='${randomUUID()}' WHERE action='homolog.read-proof.clients.create' AND record_id='${m.fixture.clientId}'; END IF;`, async () => {
        await expect(provisionHomologReadProof(db(), m)).rejects.toThrow("HOMOLOG_READ_OPERATION_CONFLICT");
        expect(await counts(m)).toEqual(none);
      }, "AFTER");
    });
    it("flushes deferred constraint triggers before the final business readback", async () => {
      const m = await seed();
      await withAuditTrigger(`IF NEW.action='homolog.read-proof.create.completed' THEN UPDATE public.clients SET name='Deferred forged client' WHERE id='${m.fixture.clientId}'; END IF;`, async () => {
        await expect(provisionHomologReadProof(db(), m)).rejects.toThrow("HOMOLOG_READ_STATE_DRIFT");
        expect(await counts(m)).toEqual(none);
      }, "DEFERRED");
    });
    it("compares receipt actor with the independently observed principal rather than trusting a modified receipt", async () => {
      const m = await seed();
      await withAuditTrigger(
        "IF NEW.action='homolog.read-proof.create.completed' THEN NEW.new_values:=jsonb_set(NEW.new_values,'{administrativeActor,currentUser}','\"forged_principal\"'); END IF;",
        async () => {
          await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
            "HOMOLOG_READ_OPERATION_CONFLICT"
          );
          expect(await counts(m)).toEqual(none);
        }
      );
    });
    it("does not retry an ordinary audit error and never exposes its driver message", async () => {
      const m = await seed();
      await raw().unsafe("CREATE SEQUENCE public.read_proof_attempts");
      try {
        await withAuditTrigger(
          "IF NEW.action='homolog.read-proof.create.completed' THEN PERFORM nextval('public.read_proof_attempts'); RAISE EXCEPTION 'SECRET_DRIVER_DETAIL'; END IF;",
          async () => {
            await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
              "HOMOLOG_READ_FAILED"
            );
            expect(await counts(m)).toEqual(none);
            expect(
              await raw().unsafe(
                "SELECT last_value::int AS n FROM public.read_proof_attempts"
              )
            ).toEqual([{ n: 1 }]);
          }
        );
      } finally {
        await raw().unsafe("DROP SEQUENCE public.read_proof_attempts");
      }
    });
    it("serializes simultaneous creation on separate physical database connections", async () => {
      const m = await seed();
      await raw().unsafe(
        "ALTER ROLE app_runtime BYPASSRLS; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO app_runtime"
      );
      const other = await cluster.connect("read-proof-concurrent");
      const results = await Promise.all([
        provisionHomologReadProof(db(), m),
        provisionHomologReadProof(other.db, m),
      ]);
      expect(results.map(r => r.status).sort()).toEqual([
        "created",
        "replayed",
      ]);
      expect(await counts(m)).toEqual(created);
    });
    it.each(["40001", "40P01"])(
      "retries the entire atomic operation for SQLSTATE %s only",
      async state => {
        const m = await seed();
        await raw().unsafe("CREATE SEQUENCE public.read_proof_attempts");
        try {
          await withAuditTrigger(
            `IF NEW.action='homolog.read-proof.create.completed' AND nextval('public.read_proof_attempts')=1 THEN RAISE EXCEPTION 'transient' USING ERRCODE='${state}'; END IF;`,
            async () => {
              expect(await provisionHomologReadProof(db(), m)).toMatchObject({
                status: "created",
              });
              expect(await counts(m)).toEqual(created);
              expect(
                await raw().unsafe(
                  "SELECT last_value::int AS n FROM public.read_proof_attempts"
                )
              ).toEqual([{ n: 2 }]);
            }
          );
        } finally {
          await raw().unsafe("DROP SEQUENCE public.read_proof_attempts");
        }
      }
    );
    it("bounds repeated serialization failures to three complete attempts", async () => {
      const m = await seed();
      await raw().unsafe("CREATE SEQUENCE public.read_proof_attempts");
      try {
        await withAuditTrigger(
          "IF NEW.action='homolog.read-proof.create.completed' THEN PERFORM nextval('public.read_proof_attempts'); RAISE EXCEPTION 'SECRET_DRIVER_DETAIL' USING ERRCODE='40001'; END IF;",
          async () => {
            await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
              "HOMOLOG_READ_FAILED"
            );
            expect(await counts(m)).toEqual(none);
            expect(
              await raw().unsafe(
                "SELECT last_value::int AS n FROM public.read_proof_attempts"
              )
            ).toEqual([{ n: 3 }]);
          }
        );
      } finally {
        await raw().unsafe("DROP SEQUENCE public.read_proof_attempts");
      }
    });
    it("cannot withdraw a fixture that was never created", async () => {
      const m = await seed();
      await expect(withdrawHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_OPERATION_CONFLICT"
      );
      expect(await identityActive(m)).toEqual({ profiles: 3, tenants: 2 });
    });
    it("withdraws only the proven synthetic profiles and tenants, preserving business rows, issuer, operator and all earlier evidence", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      const operatorTenant = randomUUID(),
        operator = randomUUID();
      await raw()`INSERT INTO tenants(id,name,slug) VALUES(${operatorTenant},'Untouched operator tenant',${`operator-${operatorTenant}`})`;
      await raw()`INSERT INTO profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${operator},${operatorTenant},${randomUUID()},'user',true)`;
      const before =
        await raw()`SELECT to_jsonb(p) AS profile,to_jsonb(t) AS tenant,(SELECT to_jsonb(c) FROM structr_private.authenticated_boundary_config c) AS issuer FROM profiles p JOIN tenants t ON t.id=p.tenant_id WHERE p.id=${operator}`;
      expect(await withdrawHomologReadProof(db(), m)).toMatchObject({
        status: "withdrawn",
      });
      expect(await identityActive(m)).toEqual({ profiles: 0, tenants: 0 });
      expect(await counts(m)).toEqual({ ...created, withdrawalAudits: 6 });
      expect(
        await raw()`SELECT to_jsonb(p) AS profile,to_jsonb(t) AS tenant,(SELECT to_jsonb(c) FROM structr_private.authenticated_boundary_config c) AS issuer FROM profiles p JOIN tenants t ON t.id=p.tenant_id WHERE p.id=${operator}`
      ).toEqual(before);
      const logs =
        await raw()`SELECT user_id,old_values,new_values FROM audit_logs WHERE new_values->>'operationId'=${m.withdrawalOperationId}`;
      expect(logs).toHaveLength(6);
      expect(logs.every(r => r.user_id === null)).toBe(true);
      expect(logs.filter(r => r.old_values?.isActive === true)).toHaveLength(5);
    });
    it("replays withdrawal without changing its before snapshots or adding audits", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      const first = await withdrawHomologReadProof(db(), m);
      const before =
        await raw()`SELECT to_jsonb(a) AS row FROM audit_logs a WHERE new_values->>'operationId'=${m.withdrawalOperationId} ORDER BY id`;
      expect(await withdrawHomologReadProof(db(), m)).toEqual({
        ...first,
        status: "replayed",
      });
      expect(
        await raw()`SELECT to_jsonb(a) AS row FROM audit_logs a WHERE new_values->>'operationId'=${m.withdrawalOperationId} ORDER BY id`
      ).toEqual(before);
    });
    it("does not resurrect a withdrawn fixture through create replay", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      await withdrawHomologReadProof(db(), m);
      await expect(provisionHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_WITHDRAWN"
      );
      expect(await identityActive(m)).toEqual({ profiles: 0, tenants: 0 });
    });
    it("refuses withdrawal after any business drift", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      await raw()`UPDATE clients SET notes='Changed' WHERE id=${m.fixture.clientId}`;
      await expect(withdrawHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_STATE_DRIFT"
      );
      expect(await identityActive(m)).toEqual({ profiles: 3, tenants: 2 });
    });
    it("rolls back all deactivations if the withdrawal receipt timestamp is altered", async () => {
      const m = await seed(); await provisionHomologReadProof(db(), m);
      await withAuditTrigger("IF NEW.action='homolog.read-proof.withdraw.completed' THEN NEW.created_at:=NEW.created_at+interval '1 microsecond'; END IF;", async () => {
        await expect(withdrawHomologReadProof(db(), m)).rejects.toThrow("HOMOLOG_READ_OPERATION_CONFLICT");
        expect(await identityActive(m)).toEqual({ profiles: 3, tenants: 2 }); expect(await counts(m)).toEqual(created);
      });
    });
    it("rolls back all five deactivations if withdrawal audit fails", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      await withAuditTrigger(
        "IF NEW.action='homolog.read-proof.withdraw.completed' THEN RAISE EXCEPTION 'SECRET_DRIVER_DETAIL'; END IF;",
        async () => {
          await expect(withdrawHomologReadProof(db(), m)).rejects.toThrow(
            "HOMOLOG_READ_FAILED"
          );
          expect(await identityActive(m)).toEqual({ profiles: 3, tenants: 2 });
          expect(await counts(m)).toEqual(created);
        }
      );
    });
    it("detects reactivation rather than treating it as a valid withdrawal replay", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      await withdrawHomologReadProof(db(), m);
      await raw()`UPDATE profiles SET is_active=true WHERE id=${m.identity.profiles.A1.id}`;
      await expect(withdrawHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_STATE_DRIFT"
      );
    });
    it("refuses withdrawal when an unrelated operator has been added to the synthetic tenant", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      const operator = randomUUID();
      await raw()`INSERT INTO profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${operator},${m.identity.tenants.A.id},${randomUUID()},'user',true)`;
      await expect(withdrawHomologReadProof(db(), m)).rejects.toThrow(
        "HOMOLOG_READ_STATE_DRIFT"
      );
      expect(await identityActive(m)).toEqual({ profiles: 3, tenants: 2 });
      expect(
        await raw()`SELECT is_active FROM profiles WHERE id=${operator}`
      ).toEqual([{ is_active: true }]);
    });
    it("the existing SQL boundary denies the withdrawn synthetic profile even with an unexpired local claims fixture", async () => {
      const m = await seed();
      await provisionHomologReadProof(db(), m);
      await withdrawHomologReadProof(db(), m);
      await expect(
        localProjection("structr_estimate_draft_read_v1", m, "A1")
      ).rejects.toMatchObject({ code: "42501", message: "FORBIDDEN" });
    });
  }
);
