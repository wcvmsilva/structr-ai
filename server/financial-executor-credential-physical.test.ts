import { startOwnedCredentialProcess } from "./test-support/calculator-credential-runner";
/** Every secret, role, CSV log and approval in this file is owned and synthetic. */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { hash } from "../scripts/financial-executor-homologation/contract";
import { startFinancialCalculatorBoundary } from "./test-support/financial-calculator-boundary";
import {
  syntheticCredentialManifest,
  syntheticCredentialArtifact,
} from "./test-support/calculator-credential";
import {
  prepareCalculatorHomologation,
  openCalculatorHomologation,
  withdrawCalculatorHomologation,
} from "../scripts/financial-executor-homologation/admin";
import * as credentials from "../scripts/financial-executor-homologation/credential";
const enabled = process.env.FINANCIAL_CALCULATOR_HOMOLOGATION_PHYSICAL === "1";
describe.skipIf(!enabled)(
  "audited synthetic credential lifecycle on owned PG17 NOSUPERUSER",
  () => {
    let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>,
      db: PostgresJsDatabase,
      fixture: any,
      m: any,
      owned: Awaited<ReturnType<typeof syntheticCredentialArtifact>>,
      reference: any,
      adminConnection: any,
      nonce: string,
      replacement: Awaited<ReturnType<typeof syntheticCredentialArtifact>>;
    beforeAll(async () => {
      lab = await startFinancialCalculatorBoundary({ credentialProof: true });
      const provider = await readFile(
        new URL(
          "./test-support/financial-calculator-boundary/managed-provider-fixture.sql",
          import.meta.url
        ),
        "utf8"
      );
      await lab.admin.unsafe(
        provider.slice(
          0,
          provider.indexOf("END $fixture$;") + "END $fixture$;".length
        )
      );
      const admin = await lab.cluster.connect("credential-admin", "postgres");
      adminConnection = admin;
      db = admin.db;
      for (const migration of [
        "0020_closed_financial_calculator_boundary",
        "0021_financial_calculator_lifecycle",
      ])
        await admin.sql.begin(tx =>
          tx.unsafe(readFileSyncMigration(migration))
        );
      fixture = {
        version: "calculator-homologation-v1",
        operationId: "c8000000-0000-4000-8000-000000000001",
        sourceCommit: "a".repeat(40),
        expectedDatabase: "postgres",
        expectedPrincipal: "postgres",
        operator: {
          subject: "c9000000-0000-4000-8000-000000000001",
          actorId: "c9000000-0000-4000-8000-000000000002",
          tenantId: "c9000000-0000-4000-8000-000000000003",
        },
        window: {
          opensAt: new Date(Date.now() - 60000).toISOString(),
          closesAt: new Date(Date.now() + 3600000).toISOString(),
        },
      };
      await lab.admin`INSERT INTO tenants(id,name,slug,timezone) VALUES(${fixture.operator.tenantId},'Synthetic credential tenant','credential-lab','America/New_York')`;
      await lab.admin`INSERT INTO profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${fixture.operator.actorId},${fixture.operator.tenantId},${fixture.operator.subject},'credential_operator',true)`;
      await lab.admin`INSERT INTO roles(id,name) VALUES('c9000000-0000-4000-8000-000000000004','credential_operator')`;
      await lab.admin`INSERT INTO permissions(id,resource,action) VALUES('c9000000-0000-4000-8000-000000000005','estimate','create')`;
      await lab.admin`INSERT INTO role_permissions(role_id,permission_id) VALUES('c9000000-0000-4000-8000-000000000004','c9000000-0000-4000-8000-000000000005')`;
      await lab.admin`INSERT INTO tenant_settings(id,tenant_id,profit_shield_overrides,geo_floor_overrides) VALUES('c9000000-0000-4000-8000-000000000006',${fixture.operator.tenantId},'{}','{}')`;
      await prepareCalculatorHomologation(db, fixture);
      nonce = (
        await lab.admin`SELECT current_setting('app_principal_lab.nonce') AS nonce`
      )[0].nonce;
      m = syntheticCredentialManifest(fixture);
      owned = await syntheticCredentialArtifact(m);
    }, 90000);
    afterAll(async () => {
      await replacement?.cleanup();
      await owned?.cleanup();
      await lab?.stop();
    }, 30000);
    it("requires credential evidence in the existing opening helper", async () => {
      await expect(openCalculatorHomologation(db, fixture)).rejects.toThrow(
        "CREDENTIAL_REQUIRED"
      );
      expect(
        (
          await lab.admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
        )[0].rolcanlogin
      ).toBe(false);
    });
    it("recovery reports not observed without assigning a password or receipt", async () => {
      expect(await credentials.recoverCalculatorCredential(db, m)).toEqual({
        status: "not_observed",
        operationId: m.metadata.operationId,
        generationId: m.metadata.generationId,
      });
      expect(
        await lab.admin`SELECT 1 FROM audit_logs WHERE action LIKE 'financial.homologation.credential.%'`
      ).toHaveLength(0);
    });
    it("refuses artifact metadata differing from the authorized manifest", async () => {
      await expect(
        credentials.provisionCalculatorCredential(
          db,
          {
            ...m,
            metadata: { ...m.metadata, sourcePinsSha256: "e".repeat(64) },
          },
          owned.plan
        )
      ).rejects.toThrow("CREDENTIAL_ARTIFACT_MISMATCH");
    });
    it("rolls back password assignment when audit storage fails and redacts driver fields", async () => {
      const broken = {
        transaction: (fn: any, options: any) =>
          db.transaction(
            tx =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === "insert")
                      return () => {
                        throw Object.assign(
                          new Error("private driver contents"),
                          {
                            query: "secret",
                            params: ["secret"],
                            cause: new Error("secret"),
                          }
                        );
                      };
                    const v = Reflect.get(t, p);
                    return typeof v === "function" ? v.bind(t) : v;
                  },
                })
              ),
            options
          ),
      } as PostgresJsDatabase;
      await expect(
        credentials.provisionCalculatorCredential(broken, m, owned.plan)
      ).rejects.toThrow("CREDENTIAL_OPERATION_FAILED");
      expect(
        (
          await lab.admin`SELECT rolpassword IS NULL AS empty FROM pg_authid WHERE rolname='structr_calculator_login_v1'`
        )[0].empty
      ).toBe(true);
      expect(
        await credentials.recoverCalculatorCredential(db, m)
      ).toMatchObject({ status: "not_observed" });
    });
    it("provisions exactly one receipt while retaining NOLOGIN and a private verifier", async () => {
      const process = await startOwnedCredentialProcess(
        {
          operation: "provision",
          manifest: m,
          artifactPlan: owned.plan,
          adminSecretFile: "/private/tmp/unused-owned-admin",
          caFile: "/private/tmp/unused-owned-ca",
        },
        { directory: lab.cluster.directory, nonce }
      );
      const result = await process.completed;
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      reference = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
      expect(reference).toMatchObject({
        status: "committed",
        operationId: m.metadata.operationId,
        generationId: m.metadata.generationId,
      });
      expect(
        (
          await lab.admin`SELECT rolcanlogin,rolpassword LIKE 'SCRAM-SHA-256$4096:%' AS scram FROM pg_authid WHERE rolname='structr_calculator_login_v1'`
        )[0]
      ).toEqual({ rolcanlogin: false, scram: true });
      const publicRows =
        await lab.admin`SELECT old_values,new_values FROM audit_logs WHERE action LIKE 'financial.homologation.credential.%'`;
      expect(publicRows).toHaveLength(1);
      await owned.artifact.withSecret(secret => {
        expect(JSON.stringify([reference, publicRows])).not.toContain(
          secret.password
        );
        expect(JSON.stringify([reference, publicRows])).not.toContain(
          secret.verifier
        );
      });
    }, 15000);
    it("recovery verifies the committed receipt without repeating ALTER or adding audits", async () => {
      const before =
        await lab.admin`SELECT rolpassword FROM pg_authid WHERE rolname='structr_calculator_login_v1'`;
      expect(await credentials.recoverCalculatorCredential(db, m)).toEqual(
        reference
      );
      const after =
        await lab.admin`SELECT rolpassword FROM pg_authid WHERE rolname='structr_calculator_login_v1'`;
      expect(after[0].rolpassword === before[0].rolpassword).toBe(true);
      expect(
        await lab.admin`SELECT 1 FROM audit_logs WHERE action LIKE 'financial.homologation.credential.%'`
      ).toHaveLength(1);
    });
    it("refuses provision replay instead of resending the verifier", async () => {
      await expect(
        credentials.provisionCalculatorCredential(db, m, owned.plan)
      ).rejects.toThrow("CREDENTIAL_ALREADY_OBSERVED");
    });
    it("replaces the closed generation with an exact predecessor and retains both receipts", async () => {
      const next = syntheticCredentialManifest(fixture, reference.receiptId);
      replacement = await syntheticCredentialArtifact(next);
      const oldReference = reference;
      reference = await credentials.replaceClosedCalculatorCredential(
        db,
        next,
        replacement.plan
      );
      expect(reference.generationId).not.toBe(oldReference.generationId);
      expect(await credentials.recoverCalculatorCredential(db, m)).toEqual(
        oldReference
      );
      expect(
        await lab.admin`SELECT 1 FROM audit_logs WHERE action LIKE 'financial.homologation.credential.%'`
      ).toHaveLength(2);
      await expect(
        openCalculatorHomologation(db, fixture, oldReference)
      ).rejects.toThrow("CREDENTIAL_STALE");
    });
    it.each(["operation", "generation"])(
      "rejects %s IDs reused across identifier classes",
      async kind => {
        const next = syntheticCredentialManifest(fixture, reference.receiptId);
        if (kind === "operation")
          next.metadata.operationId = m.metadata.generationId;
        else next.metadata.generationId = m.metadata.operationId;
        const candidate = await syntheticCredentialArtifact(next);
        try {
          await expect(
            db.transaction(
              async tx => {
                const scoped = {
                  transaction: (fn: any) => fn(tx),
                } as PostgresJsDatabase;
                await expect(
                  credentials.replaceClosedCalculatorCredential(
                    scoped,
                    next,
                    candidate.plan
                  )
                ).rejects.toThrow("CREDENTIAL_IDENTIFIERS_REUSED");
                throw new Error("OWNED_TEST_ROLLBACK");
              },
              { isolationLevel: "serializable" }
            )
          ).rejects.toThrow("OWNED_TEST_ROLLBACK");
        } finally {
          await candidate.cleanup();
        }
      }
    );
    it.each(["suppressed", "corrupted"])(
      "rolls back a replacement when its actual SQL audit is %s",
      async kind => {
        const next = syntheticCredentialManifest(fixture, reference.receiptId),
          candidate = await syntheticCredentialArtifact(next);
        const [before] =
          await lab.admin`SELECT rolpassword FROM pg_authid WHERE rolname='structr_calculator_login_v1'`;
        const broken = {
          transaction: (fn: any, options: any) =>
            db.transaction(
              tx =>
                fn(
                  new Proxy(tx, {
                    get(t, p) {
                      if (p === "execute")
                        return async (q: any) => {
                          const result = await t.execute(q);
                          if (
                            new PgDialect()
                              .sqlToQuery(q)
                              .sql.startsWith(
                                "CALL pg_temp.calculator_set_password_v1"
                              )
                          ) {
                            await t.execute(
                              sql.raw(
                                `CREATE FUNCTION pg_temp.credential_audit_injection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${kind === "suppressed" ? "RETURN NULL;" : "NEW.new_values := '{}'::jsonb; RETURN NEW;"} END $$; CREATE TRIGGER credential_audit_injection BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.credential_audit_injection()`
                              )
                            );
                          }
                          return result;
                        };
                      const v = Reflect.get(t, p);
                      return typeof v === "function" ? v.bind(t) : v;
                    },
                  })
                ),
              options
            ),
        } as PostgresJsDatabase;
        try {
          await expect(
            credentials.replaceClosedCalculatorCredential(
              broken,
              next,
              candidate.plan
            )
          ).rejects.toThrow(
            kind === "corrupted"
              ? "AUDIT_MISMATCH"
              : "CREDENTIAL_OPERATION_FAILED"
          );
          const [after] =
            await lab.admin`SELECT rolpassword FROM pg_authid WHERE rolname='structr_calculator_login_v1'`;
          expect(after.rolpassword === before.rolpassword).toBe(true);
          expect(
            await credentials.recoverCalculatorCredential(db, next)
          ).toMatchObject({ status: "not_observed" });
        } finally {
          await candidate.cleanup();
        }
      }
    );
    it("rejects a valid-hash fork of the credential history before opening", async () => {
      const [initial] =
        await lab.admin`SELECT new_values,old_values FROM audit_logs WHERE action='financial.homologation.credential.provision.completed'`;
      const v = structuredClone(initial.new_values),
        id = randomUUID();
      v.manifest.metadata.operationId = randomUUID();
      v.manifest.metadata.generationId = randomUUID();
      v.state.generationId = v.manifest.metadata.generationId;
      v.manifestHash = hash(v.manifest);
      v.afterHash = hash(v.state);
      await lab.admin`INSERT INTO audit_logs(id,user_id,action,table_name,record_id,old_values,new_values) VALUES(${id},NULL,'financial.homologation.credential.provision.completed','calculator_credential',${v.manifest.metadata.operationId},${JSON.stringify(initial.old_values)}::jsonb,${JSON.stringify(v)}::jsonb)`;
      try {
        await expect(
          openCalculatorHomologation(db, fixture, reference)
        ).rejects.toThrow("CREDENTIAL_CHAIN");
      } finally {
        await lab.admin`DELETE FROM audit_logs WHERE id=${id}`;
      }
    });
    it("rejects damaged current receipt hashes before opening", async () => {
      const [prior] =
        await lab.admin`SELECT new_values FROM audit_logs WHERE id=${reference.receiptId}`;
      await lab.admin`UPDATE audit_logs SET new_values=jsonb_set(new_values,'{afterHash}',to_jsonb(repeat('0',64))) WHERE id=${reference.receiptId}`;
      try {
        await expect(
          openCalculatorHomologation(db, fixture, reference)
        ).rejects.toThrow("CREDENTIAL_EVIDENCE");
      } finally {
        await lab.admin`UPDATE audit_logs SET new_values=${JSON.stringify(prior.new_values)}::jsonb WHERE id=${reference.receiptId}`;
      }
    });
    it("refuses stale replacement predecessors without changing the current password", async () => {
      const next = syntheticCredentialManifest(fixture, randomUUID()),
        candidate = await syntheticCredentialArtifact(next);
      try {
        await expect(
          credentials.replaceClosedCalculatorCredential(
            db,
            next,
            candidate.plan
          )
        ).rejects.toThrow("CREDENTIAL_STALE");
      } finally {
        await candidate.cleanup();
      }
    });
    it("requires the same exact destination for replacement", async () => {
      const next = syntheticCredentialManifest(fixture, reference.receiptId);
      next.metadata.executorPreview.projectId = "prj_other";
      const candidate = await syntheticCredentialArtifact(next);
      try {
        await expect(
          credentials.replaceClosedCalculatorCredential(
            db,
            next,
            candidate.plan
          )
        ).rejects.toThrow("CREDENTIAL_DESTINATION_MISMATCH");
      } finally {
        await candidate.cleanup();
      }
    });
    it("serializes competing replacements from fresh processes into one receipt", async () => {
      const candidates = await Promise.all(
        [0, 1].map(async () => {
          const manifest = syntheticCredentialManifest(
            fixture,
            reference.receiptId
          );
          return {
            manifest,
            artifact: await syntheticCredentialArtifact(manifest),
          };
        })
      );
      let retained = -1;
      try {
        const children = await Promise.all(
          candidates.map(candidate =>
            startOwnedCredentialProcess(
              {
                operation: "replace",
                manifest: candidate.manifest,
                artifactPlan: candidate.artifact.plan,
                adminSecretFile: "/private/tmp/unused-owned-admin",
                caFile: "/private/tmp/unused-owned-ca",
              },
              { directory: lab.cluster.directory, nonce }
            )
          )
        );
        const outcomes = await Promise.all(
          children.map(child => child.completed)
        );
        expect(outcomes.map(result => result.code).sort()).toEqual([0, 70]);
        retained = outcomes.findIndex(result => result.code === 0);
        const refused = 1 - retained;
        expect(outcomes.every(result => result.stderr === "")).toBe(true);
        expect(outcomes[refused].stdout.trim().split("\n").at(-1)).toBe(
          '{"status":"uncertain"}'
        );
        reference = JSON.parse(
          outcomes[retained].stdout.trim().split("\n").at(-1)!
        );
        expect(
          await credentials.recoverCalculatorCredential(
            db,
            candidates[retained].manifest
          )
        ).toEqual(reference);
        expect(
          await credentials.recoverCalculatorCredential(
            db,
            candidates[refused].manifest
          )
        ).toMatchObject({ status: "not_observed" });
        expect(
          await lab.admin`SELECT 1 FROM audit_logs WHERE action LIKE 'financial.homologation.credential.%'`
        ).toHaveLength(3);
        await replacement.cleanup();
        replacement = candidates[retained].artifact;
      } finally {
        await Promise.all(
          candidates
            .filter((_, i) => i !== retained)
            .map(candidate => candidate.artifact.cleanup())
        );
      }
    }, 20000);
    it("documents the native CSV lock/FATAL verifier residual using boolean evidence only", async () => {
      const next = syntheticCredentialManifest(fixture, reference.receiptId),
        candidate = await syntheticCredentialArtifact(next);
      const control = await lab.cluster.connect(
        "native-log-controller",
        "postgres"
      );

      let release!: () => void, observed!: () => void;
      const barrier = new Promise<void>(resolve => (release = resolve)),
        seen = new Promise<void>(resolve => (observed = resolve));
      const holder = lab.admin
        .begin(async tx => {
          await tx.unsafe(
            "ALTER ROLE structr_calculator_login_v1 CONNECTION LIMIT -1"
          );
          observed();
          await barrier;
          throw new Error("OWNED_LOCK_ROLLBACK");
        })
        .catch(error => {
          if (error.message !== "OWNED_LOCK_ROLLBACK") throw error;
        });
      await seen;
      const process = await startOwnedCredentialProcess(
        {
          operation: "replace",
          manifest: next,
          artifactPlan: candidate.plan,
          adminSecretFile: "/private/tmp/unused-owned-admin",
          caFile: "/private/tmp/unused-owned-ca",
        },
        { directory: lab.cluster.directory, nonce }
      );
      const backend = { pid: await process.pid },
        pending = process.completed;
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const [state] =
            await control.sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${backend.pid}`;
          if (state?.wait_event_type === "Lock") {
            waiting = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        expect(waiting).toBe(true);
        // Permit native log_lock_waits to emit the inner DDL context before termination.
        await new Promise(resolve => setTimeout(resolve, 250));
        expect(
          (
            await control.sql`SELECT pg_terminate_backend(${backend.pid}) AS terminated`
          )[0].terminated
        ).toBe(true);
        const outcome = await pending;
        expect(outcome.code).toBe(70);
        expect(outcome.stderr).toBe("");
        expect(outcome.stdout.trim().split("\n").at(-1)).toBe(
          '{"status":"uncertain"}'
        );
        let evidence = { verifierLogged: false, plaintextLogged: false };
        await candidate.artifact.withSecret(async secret => {
          for (let attempt = 0; attempt < 20; attempt++) {
            const directory = lab.cluster.directory + "/data/log",
              files = (await readdir(directory)).filter(name =>
                name.endsWith(".csv")
              );
            const log = (
              await Promise.all(
                files.map(name => readFile(directory + "/" + name, "utf8"))
              )
            ).join("\n");
            evidence = {
              verifierLogged: log.includes(secret.verifier),
              plaintextLogged: log.includes(secret.password),
            };
            if (evidence.verifierLogged) break;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        });
        expect(evidence).toEqual({
          verifierLogged: true,
          plaintextLogged: false,
        });
      } finally {
        release();
        await holder;
        await pending;
        await candidate.cleanup();
      }
      // A FATAL result discards the administrative pool; recovery owns a fresh handle.
      await adminConnection.sql.end({ timeout: 1 });
      adminConnection = await lab.cluster.connect(
        "credential-recovery",
        "postgres"
      );
      db = adminConnection.db;
      const recovery = await startOwnedCredentialProcess(
        {
          operation: "recover",
          manifest: next,
          admissionExpiresAt: new Date(Date.now() + 60000).toISOString(),
          adminSecretFile: "/private/tmp/unused-owned-admin",
          caFile: "/private/tmp/unused-owned-ca",
        },
        { directory: lab.cluster.directory, nonce }
      );
      const recovered = await recovery.completed;
      expect(recovered.code).toBe(0);
      expect(recovered.stderr).toBe("");
      expect(
        JSON.parse(recovered.stdout.trim().split("\n").at(-1)!)
      ).toMatchObject({
        status: "not_observed",
        operationId: next.metadata.operationId,
        generationId: next.metadata.generationId,
      });
    }, 30000);
    it("rejects stale explicit generation before opening", async () => {
      await expect(
        openCalculatorHomologation(db, fixture, {
          ...reference,
          generationId: "c8100000-0000-4000-8000-000000000099",
        })
      ).rejects.toThrow("CREDENTIAL_STALE");
    });
    it("binds the credential reference into the actual open audit", async () => {
      expect(
        await openCalculatorHomologation(db, fixture, reference)
      ).toMatchObject({ status: "opened" });
      const [r] =
        await lab.admin`SELECT new_values FROM audit_logs WHERE action='financial.homologation.open.completed'`;
      expect(r.new_values.state.credential).toEqual({
        receiptId: reference.receiptId,
        generationId: reference.generationId,
      });
    });
    async function connectPassword(password: string) {
      const [settings] =
        await lab.admin`SELECT current_setting('unix_socket_directories') AS socket,current_setting('port') AS port`;
      expect(settings.socket.startsWith(lab.cluster.directory + "/")).toBe(
        true
      );
      const client = postgres({
        host: settings.socket,
        port: Number(settings.port),
        database: "postgres",
        user: "structr_calculator_login_v1",
        password,
        ssl: false,
        max: 1,
        prepare: false,
        connect_timeout: 2,
        onnotice: () => undefined,
      });
      try {
        return await client`SELECT current_user AS role,session_user AS session`;
      } finally {
        await client.end({ timeout: 1 });
      }
    }
    it("rejects wrong passwords with actual SCRAM authentication", async () => {
      await expect(
        connectPassword("synthetic-wrong-password")
      ).rejects.toMatchObject({ code: "28P01" });
    });
    it("authenticates the new password while the previous closed generation fails", async () => {
      await replacement.artifact.withSecret(async secret =>
        expect(await connectPassword(secret.password)).toEqual([
          {
            role: "structr_calculator_login_v1",
            session: "structr_calculator_login_v1",
          },
        ])
      );
      await owned.artifact.withSecret(async secret => {
        let code;
        try {
          await connectPassword(secret.password);
        } catch (error: any) {
          code = error.code;
        }
        expect(code).toBe("28P01");
      });
    });
    it("forbids replacement after the first opening", async () => {
      const next = syntheticCredentialManifest(fixture, reference.receiptId),
        artifact = await syntheticCredentialArtifact(next);
      try {
        await expect(
          credentials.replaceClosedCalculatorCredential(db, next, artifact.plan)
        ).rejects.toThrow("CREDENTIAL_PREVIOUSLY_OPENED");
      } finally {
        await artifact.cleanup();
      }
    });
    it("terminal withdrawal clears the password and refuses revival", async () => {
      expect(await withdrawCalculatorHomologation(db, fixture)).toMatchObject({
        bindingTerminal: true,
        loginClosed: true,
      });
      expect(
        (
          await lab.admin`SELECT rolcanlogin,rolpassword IS NULL AS empty FROM pg_authid WHERE rolname='structr_calculator_login_v1'`
        )[0]
      ).toEqual({ rolcanlogin: false, empty: true });
      await expect(
        credentials.provisionCalculatorCredential(db, m, owned.plan)
      ).rejects.toThrow("TERMINAL");
    });
  }
);
import { readFileSync } from "node:fs";
function readFileSyncMigration(name: string) {
  return readFileSync(
    new URL(`../drizzle/${name}.sql`, import.meta.url),
    "utf8"
  );
}

// Reusing original closesAt for process admission makes an uncertain commit
// unrecoverable after pilot expiry. A fresh process may read its receipt only.
describe.skipIf(!enabled)(
  "expired pilot receipt recovery through the production runner",
  () => {
    it("recovers a committed receipt after pilot expiry without modifying the role, binding, window or audits", async () => {
      const shortLab = await startFinancialCalculatorBoundary({
        credentialProof: true,
      });
      let artifact:
        | Awaited<ReturnType<typeof syntheticCredentialArtifact>>
        | undefined;
      try {
        const provider = await readFile(
          new URL(
            "./test-support/financial-calculator-boundary/managed-provider-fixture.sql",
            import.meta.url
          ),
          "utf8"
        );
        await shortLab.admin.unsafe(
          provider.slice(
            0,
            provider.indexOf("END $fixture$;") + "END $fixture$;".length
          )
        );
        const admin = await shortLab.cluster.connect(
          "expired-pilot-admin",
          "postgres"
        );
        for (const migration of [
          "0020_closed_financial_calculator_boundary",
          "0021_financial_calculator_lifecycle",
        ])
          await admin.sql.begin(tx =>
            tx.unsafe(readFileSyncMigration(migration))
          );
        let shortFixture: any;
        shortFixture = {
          version: "calculator-homologation-v1",
          operationId: "c8000000-0000-4000-8000-000000000001",
          sourceCommit: "a".repeat(40),
          expectedDatabase: "postgres",
          expectedPrincipal: "postgres",
          operator: {
            subject: "c9000000-0000-4000-8000-000000000001",
            actorId: "c9000000-0000-4000-8000-000000000002",
            tenantId: "c9000000-0000-4000-8000-000000000003",
          },
          window: {
            opensAt: new Date(Date.now() - 60000).toISOString(),
            closesAt: new Date(Date.now() + 5000).toISOString(),
          },
        };
        await shortLab.admin`INSERT INTO tenants(id,name,slug,timezone) VALUES(${shortFixture.operator.tenantId},'Synthetic credential tenant','credential-lab','America/New_York')`;
        await shortLab.admin`INSERT INTO profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${shortFixture.operator.actorId},${shortFixture.operator.tenantId},${shortFixture.operator.subject},'credential_operator',true)`;
        await shortLab.admin`INSERT INTO roles(id,name) VALUES('c9000000-0000-4000-8000-000000000004','credential_operator')`;
        await shortLab.admin`INSERT INTO permissions(id,resource,action) VALUES('c9000000-0000-4000-8000-000000000005','estimate','create')`;
        await shortLab.admin`INSERT INTO role_permissions(role_id,permission_id) VALUES('c9000000-0000-4000-8000-000000000004','c9000000-0000-4000-8000-000000000005')`;
        await shortLab.admin`INSERT INTO tenant_settings(id,tenant_id,profit_shield_overrides,geo_floor_overrides) VALUES('c9000000-0000-4000-8000-000000000006',${shortFixture.operator.tenantId},'{}','{}')`;

        await prepareCalculatorHomologation(admin.db, shortFixture);
        const manifest = syntheticCredentialManifest(shortFixture);
        artifact = await syntheticCredentialArtifact(manifest);
        const reference = await credentials.provisionCalculatorCredential(
          admin.db,
          manifest,
          artifact.plan
        );
        const nonce = (
          await shortLab.admin`SELECT current_setting('app_principal_lab.nonce') AS nonce`
        )[0].nonce;
        const state = async () => ({
          bindings:
            await shortLab.admin`SELECT to_jsonb(b.*) AS row FROM structr_financial.principal_bindings b`,
          fixtures:
            await shortLab.admin`SELECT to_jsonb(f.*) AS row FROM structr_financial.calculator_fixtures f`,
          role: await shortLab.admin`SELECT to_jsonb(r.*) AS row FROM pg_roles r WHERE rolname='structr_calculator_login_v1'`,
          audits:
            await shortLab.admin`SELECT to_jsonb(a.*) AS row FROM audit_logs a ORDER BY id`,
        });
        const before = await state();
        const [passwordBefore] =
          await shortLab.admin`SELECT rolpassword FROM pg_authid WHERE rolname='structr_calculator_login_v1'`;
        const remaining = Date.parse(shortFixture.window.closesAt) - Date.now();
        if (remaining > 0)
          await new Promise(resolve => setTimeout(resolve, remaining + 50));
        expect(Date.parse(shortFixture.window.closesAt)).toBeLessThan(
          Date.now()
        );
        const child = await startOwnedCredentialProcess(
          {
            operation: "recover",
            manifest,
            admissionExpiresAt: new Date(Date.now() + 60000).toISOString(),
            adminSecretFile: "/private/tmp/unused-owned-admin",
            caFile: "/private/tmp/unused-owned-ca",
          },
          { directory: shortLab.cluster.directory, nonce }
        );
        const result = await child.completed;
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout.trim().split("\n").at(-1)!)).toEqual(
          reference
        );
        expect(await state()).toEqual(before);
        const [passwordAfter] =
          await shortLab.admin`SELECT rolpassword FROM pg_authid WHERE rolname='structr_calculator_login_v1'`;
        expect(passwordAfter.rolpassword === passwordBefore.rolpassword).toBe(
          true
        );
      } finally {
        await artifact?.cleanup();
        await shortLab.stop();
      }
    }, 30000);
  }
);
