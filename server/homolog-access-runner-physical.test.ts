import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { rootCertificates } from "node:tls";
import { bootstrapHomologAccess } from "../scripts/homolog-access-bootstrap";
import {
  provisionHomologReadProof,
  withdrawHomologReadProof,
} from "../scripts/homolog-read-proof";
import {
  startAppPrincipalPostgres,
  type AppPrincipalCluster,
  type AppPrincipalConnection,
} from "./test-support/app-principal-postgres";

const intercepted = vi.hoisted(() => ({
  connection: undefined as AppPrincipalConnection | undefined,
  options: undefined as any,
}));
// Only the external connection boundary is replaced. Queries, Drizzle, bootstrap,
// audit writes, transaction failures, readbacks and client shutdown remain real.
vi.mock("postgres", async importOriginal => {
  const actual = await importOriginal<typeof import("postgres")>();
  return {
    ...actual,
    default: (options: unknown) => {
      if (!intercepted.connection)
        throw new Error("PRIVATE_CONNECTION_DETAILS_MUST_NOT_LEAK");
      intercepted.options = options;
      return intercepted.connection.sql;
    },
  };
});
const physical =
  process.env.APP_PRINCIPAL_LAB === "1" &&
  process.env.HOMOLOG_BOOTSTRAP_PHYSICAL === "1";
const repository = fileURLToPath(new URL("../", import.meta.url));
const sourceFiles = [
  "scripts/homolog-access-runner.ts",
  "scripts/homolog-access-bootstrap.ts",
  "scripts/homolog-access-bootstrap-sql.ts",
  "scripts/homolog-read-proof.ts",
  "server/audit.ts",
  "drizzle/schema.ts",
  "shared/domain/taxonomy.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];
const gitEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

describe.skipIf(!physical)(
  "homolog runner through actual owned PostgreSQL",
  { timeout: 20000 },
  () => {
    let cluster: AppPrincipalCluster,
      directory: string,
      fixture: string,
      sourceCommit: string;
    let runner: typeof import("../scripts/homolog-access-runner");
    function git(args: string[]) {
      const result = spawnSync(
        "/usr/bin/git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "core.fsmonitor=false",
          ...args,
        ],
        { cwd: fixture, env: gitEnv, encoding: "utf8", timeout: 10000 }
      );
      if (result.status !== 0) throw new Error("Runner fixture Git failed");
      return result.stdout.trim();
    }
    function manifest() {
      const operationId = randomUUID();
      return {
        version: "structr-homolog-identities-v1",
        projectRef: "wmspwegbqtzamkhxhusg",
        operationId,
        sourceCommit,
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
      };
    }
    async function inputs(value: object, mode = "apply") {
      const manifestFile = join(directory, `${randomUUID()}.json`),
        connectionFile = join(directory, `${randomUUID()}.json`);
      await writeFile(manifestFile, JSON.stringify(value), { mode: 0o600 });
      await writeFile(
        connectionFile,
        JSON.stringify({
          version: "structr-homolog-admin-connection-v1",
          projectRef: "wmspwegbqtzamkhxhusg",
          host: "db.wmspwegbqtzamkhxhusg.supabase.co",
          port: 5432,
          database: "postgres",
          user: "postgres",
          password: "PHYSICAL_TEST_PASSWORD_NOT_A_CREDENTIAL",
          caCertificate: rootCertificates[0],
        }),
        { mode: 0o600 }
      );
      return [mode, manifestFile, connectionFile];
    }
    async function apply(value: object, mode = "apply") {
      const connection = await cluster.connect(`runner-${randomUUID()}`);
      intercepted.connection = connection;
      return {
        connection,
        pending: runner.runHomologAccess(await inputs(value, mode)),
      };
    }
    async function counts(value: ReturnType<typeof manifest>) {
      const [result] = await cluster.observer.sql`SELECT
      (SELECT count(*)::int FROM tenants WHERE id=ANY(${Object.values(value.tenants).map(row => row.id)}::uuid[])) AS tenants,
      (SELECT count(*)::int FROM profiles WHERE id=ANY(${Object.values(value.profiles).map(row => row.id)}::uuid[])) AS profiles,
      (SELECT count(*)::int FROM audit_logs WHERE new_values->>'operationId'=${value.operationId}) AS audits`;
      return result;
    }
    beforeAll(async () => {
      const actual = await vi.importActual<{
        default: typeof import("postgres");
      }>("postgres");
      cluster = await startAppPrincipalPostgres(actual.default);
      await cluster.observer.sql.unsafe(
        "CREATE ROLE anon NOLOGIN NOBYPASSRLS; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT anon,authenticated TO authenticator WITH INHERIT FALSE,SET TRUE"
      );
      const migrations = new URL("../drizzle/", import.meta.url);
      const journal = JSON.parse(
        await readFile(new URL("meta/_journal.json", migrations), "utf8")
      );
      for (const { tag } of journal.entries.filter(
        (entry: { tag: string }) => Number(entry.tag.slice(0, 4)) <= 17
      )) {
        if (tag.startsWith("0015"))
          await cluster.observer.sql.unsafe(`
            REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator,service_role;
            REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator,service_role;
            REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,authenticator,service_role;
            REVOKE USAGE ON SCHEMA public FROM PUBLIC,anon,authenticated,authenticator;
          `);
        await cluster.observer.sql.begin(tx =>
          readFile(new URL(`${tag}.sql`, migrations), "utf8").then(source =>
            tx.unsafe(source)
          )
        );
      }
      await cluster.observer.sql.unsafe(
        "ALTER ROLE app_runtime BYPASSRLS; GRANT SELECT,INSERT,UPDATE ON public.tenants,public.profiles,public.clients,public.projects,public.estimate_drafts,public.project_members,public.audit_logs TO app_runtime"
      );
      // The real deferred draft trigger reads these even for an empty draft.
      await cluster.observer.sql.unsafe(
        "GRANT SELECT ON public.estimate_internal_approval_snapshots,public.estimate_internal_approvals,public.estimate_internal_approval_revocations TO app_runtime"
      );
      directory = await mkdtemp(
        join(tmpdir(), "structr-homolog-runner-physical-")
      );
      directory = await realpath(directory);
      fixture = join(directory, "repository");
      await mkdir(fixture);
      for (const file of sourceFiles) {
        await mkdir(dirname(join(fixture, file)), { recursive: true });
        await copyFile(join(repository, file), join(fixture, file));
      }
      await symlink(
        join(repository, "node_modules"),
        join(fixture, "node_modules")
      );
      git(["init", "--quiet"]);
      git(["add", "--", ...sourceFiles]);
      git([
        "-c",
        "user.name=Runner Fixture",
        "-c",
        "user.email=runner@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "physical fixture",
      ]);
      sourceCommit = git(["rev-parse", "HEAD"]);
      runner = await import(
        /* @vite-ignore */ join(fixture, "scripts/homolog-access-runner.ts")
      );
    }, 90_000);
    afterAll(async () => {
      if (cluster) {
        const owned = cluster.directory;
        await cluster.stop();
        await expect(access(owned)).rejects.toMatchObject({ code: "ENOENT" });
      }
      if (directory) await rm(directory, { recursive: true, force: true });
    }, 20_000);
    it("creates exactly two tenants, three user profiles and six real audits, then closes its connection", async () => {
      const value = manifest(),
        execution = await apply(value);
      await expect(execution.pending).resolves.toMatchObject({
        status: "created",
        databaseTargetVerified: true,
        sourceVerified: true,
        authVerified: false,
      });
      expect(await counts(value)).toEqual({
        tenants: 2,
        profiles: 3,
        audits: 6,
      });
      const rows = await cluster.observer
        .sql`SELECT tenant_id,role FROM profiles WHERE id=ANY(${Object.values(value.profiles).map(row => row.id)}::uuid[]) ORDER BY tenant_id`;
      expect(
        rows.filter(row => row.tenant_id === value.tenants.A.id)
      ).toHaveLength(2);
      expect(
        rows.filter(row => row.tenant_id === value.tenants.B.id)
      ).toHaveLength(1);
      expect(rows.map(row => row.role)).toEqual(["user", "user", "user"]);
      await expect(execution.connection.sql`SELECT 1`).rejects.toMatchObject({
        code: "CONNECTION_ENDED",
      });
    });
    it("configures one fixed destination with certificate and hostname verification, independent of PG environment", async () => {
      const value = manifest();
      vi.stubEnv("PGHOST", "wrong-host.invalid");
      vi.stubEnv("PGPASSWORD", "do-not-use-this");
      vi.stubEnv("PGSSL", "false");
      try {
        const execution = await apply(value);
        await execution.pending;
        const options = intercepted.options;
        expect(options).toMatchObject({
          host: "db.wmspwegbqtzamkhxhusg.supabase.co",
          port: 5432,
          database: "postgres",
          user: "postgres",
          password: "PHYSICAL_TEST_PASSWORD_NOT_A_CREDENTIAL",
          max: 1,
          prepare: false,
          debug: false,
          target_session_attrs: "read-write",
          ssl: {
            rejectUnauthorized: true,
            servername: "db.wmspwegbqtzamkhxhusg.supabase.co",
            ca: rootCertificates[0],
          },
        });
        const matchingCert = {
          subjectaltname: "DNS:db.wmspwegbqtzamkhxhusg.supabase.co",
          subject: { CN: "unused" },
        };
        expect(
          options.ssl.checkServerIdentity(
            "db.wmspwegbqtzamkhxhusg.supabase.co",
            matchingCert
          )
        ).toBeUndefined();
        expect(
          options.ssl.checkServerIdentity("wrong-host.invalid", matchingCert)
        ).toBeInstanceOf(Error);
        expect(
          options.ssl.checkServerIdentity(
            "db.wmspwegbqtzamkhxhusg.supabase.co",
            { ...matchingCert, subjectaltname: "DNS:wrong-host.invalid" }
          )
        ).toBeInstanceOf(Error);
      } finally {
        vi.unstubAllEnvs();
      }
    });
    it("replays the same manifest without duplicate identities or audits", async () => {
      const value = manifest();
      await (
        await apply(value)
      ).pending;
      await expect((await apply(value)).pending).resolves.toMatchObject({
        status: "replayed",
      });
      expect(await counts(value)).toEqual({
        tenants: 2,
        profiles: 3,
        audits: 6,
      });
    });
    it("rolls back the entire bootstrap after a late real audit failure and closes the failed connection", async () => {
      const value = manifest();
      await cluster.observer.sql.unsafe(
        "CREATE FUNCTION public.runner_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='homolog.identity.bootstrap.completed' THEN RAISE EXCEPTION 'PRIVATE_DRIVER_DETAIL'; END IF; RETURN NEW; END $$; CREATE TRIGGER runner_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.runner_audit_failure()"
      );
      try {
        const execution = await apply(value);
        await expect(execution.pending).rejects.toThrow(
          "HOMOLOG_BOOTSTRAP_FAILED"
        );
        expect(await counts(value)).toEqual({
          tenants: 0,
          profiles: 0,
          audits: 0,
        });
        await expect(execution.connection.sql`SELECT 1`).rejects.toMatchObject({
          code: "CONNECTION_ENDED",
        });
      } finally {
        await cluster.observer.sql.unsafe(
          "DROP TRIGGER runner_audit_failure ON audit_logs; DROP FUNCTION public.runner_audit_failure()"
        );
      }
    });
    it("preserves existing evidence when exact replay detects drift", async () => {
      const value = manifest();
      await (
        await apply(value)
      ).pending;
      await cluster.observer
        .sql`UPDATE profiles SET is_active=false WHERE id=${value.profiles.A1.id}`;
      await expect((await apply(value)).pending).rejects.toThrow(
        "HOMOLOG_STATE_DRIFT"
      );
      expect(await counts(value)).toEqual({
        tenants: 2,
        profiles: 3,
        audits: 6,
      });
    });
    it("returns a fixed code when opening the administrative connection fails", async () => {
      intercepted.connection = undefined;
      const result = runner
        .runHomologAccess(await inputs(manifest()))
        .catch(error => runner.homologRunnerErrorCode(error));
      await expect(result).resolves.toBe("HOMOLOG_RUNNER_FAILED");
    });

    async function seedReadProof() {
      const identity = {
        ...manifest(),
        sourceCommit: "8e349d472f5b16494350b1dd26ccc039a9580d21",
      };
      await bootstrapHomologAccess(cluster.observer.db, identity);
      return {
        version: "structr-homolog-read-proof-v1",
        projectRef: "wmspwegbqtzamkhxhusg",
        sourceCommit,
        operationId: randomUUID(),
        withdrawalOperationId: randomUUID(),
        identity,
        fixture: {
          clientId: randomUUID(),
          projectId: randomUUID(),
          draftId: randomUUID(),
          membershipId: randomUUID(),
        },
      };
    }
    type Proof = Awaited<ReturnType<typeof seedReadProof>>;
    async function seedIdentityCycle() {
      const priorReadProof = {
        ...(await seedReadProof()),
        sourceCommit: "ed64270954cef16b617f29a8c05c74801dea5b2c",
      };
      await provisionHomologReadProof(cluster.observer.db, priorReadProof);
      await withdrawHomologReadProof(cluster.observer.db, priorReadProof);
      return {
        version: "structr-homolog-identity-cycle-v1",
        projectRef: "wmspwegbqtzamkhxhusg",
        sourceCommit,
        reactivationOperationId: randomUUID(),
        withdrawalOperationId: randomUUID(),
        priorReadProof,
      };
    }
    it("dispatches a complete nominal identity cycle using the verified handle and closes every connection", async () => {
      const value = await seedIdentityCycle(),
        prior = value.priorReadProof;
      const original = [
        await audits(prior.identity.operationId),
        await audits(prior.operationId),
        await audits(prior.withdrawalOperationId),
      ];
      for (const [mode, status, tenants, profiles] of [
        ["identity-cycle-reactivate", "reactivated", 2, 3],
        ["identity-cycle-reactivate", "replayed", 2, 3],
        ["identity-cycle-withdraw", "withdrawn", 0, 0],
        ["identity-cycle-withdraw", "replayed", 0, 0],
      ] as const) {
        const execution = await apply(value, mode);
        const result = await execution.pending;
        expect(result).toMatchObject({
          status,
          sourceCommit,
          sourceVerified: true,
          databaseTargetVerified: true,
          authVerified: false,
        });
        expect(JSON.stringify(result)).not.toContain(
          prior.identity.profiles.A1.providerSubject
        );
        expect(await active(prior)).toEqual({ tenants, profiles });
        await expect(execution.connection.sql`SELECT 1`).rejects.toMatchObject({
          code: "CONNECTION_ENDED",
        });
      }
      expect(await audits(value.reactivationOperationId)).toHaveLength(6);
      expect(await audits(value.withdrawalOperationId)).toHaveLength(6);
      expect([
        await audits(prior.identity.operationId),
        await audits(prior.operationId),
        await audits(prior.withdrawalOperationId),
      ]).toEqual(original);
      const failed = await apply(value, "identity-cycle-reactivate");
      await expect(failed.pending).rejects.toThrow("HOMOLOG_CYCLE_WITHDRAWN");
      await expect(failed.connection.sql`SELECT 1`).rejects.toMatchObject({
        code: "CONNECTION_ENDED",
      });
    });
    it.each(["reactivate", "withdraw"] as const)(
      "sanitizes a late identity-cycle %s failure and closes the failed real connection",
      async mode => {
        const value = await seedIdentityCycle();
        if (mode === "withdraw")
          await (
            await apply(value, "identity-cycle-reactivate")
          ).pending;
        const before = await active(value.priorReadProof);
        await cluster.observer.sql.unsafe(
          `CREATE FUNCTION public.runner_cycle_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='homolog.identity-cycle.${mode}.completed' THEN RAISE EXCEPTION 'PRIVATE_DRIVER_DETAIL'; END IF; RETURN NEW; END $$; CREATE TRIGGER runner_cycle_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.runner_cycle_failure()`
        );
        try {
          const execution = await apply(value, `identity-cycle-${mode}`);
          await expect(
            execution.pending.catch(error =>
              runner.homologRunnerErrorCode(error)
            )
          ).resolves.toBe("HOMOLOG_CYCLE_FAILED");
          expect(await active(value.priorReadProof)).toEqual(before);
          expect(
            await audits(
              mode === "reactivate"
                ? value.reactivationOperationId
                : value.withdrawalOperationId
            )
          ).toEqual([]);
          await expect(
            execution.connection.sql`SELECT 1`
          ).rejects.toMatchObject({ code: "CONNECTION_ENDED" });
        } finally {
          await cluster.observer.sql.unsafe(
            "DROP TRIGGER runner_cycle_failure ON audit_logs; DROP FUNCTION public.runner_cycle_failure()"
          );
        }
      }
    );
    const created = {
      clients: 1,
      projects: 1,
      drafts: 1,
      members: 1,
      audits: 5,
      withdrawalAudits: 0,
    };
    const empty = {
      clients: 0,
      projects: 0,
      drafts: 0,
      members: 0,
      audits: 0,
      withdrawalAudits: 0,
    };
    async function proofCounts(value: Proof) {
      const [result] = await cluster.observer.sql`SELECT
        (SELECT count(*)::int FROM clients WHERE id=${value.fixture.clientId}) AS clients,
        (SELECT count(*)::int FROM projects WHERE id=${value.fixture.projectId}) AS projects,
        (SELECT count(*)::int FROM estimate_drafts WHERE id=${value.fixture.draftId}) AS drafts,
        (SELECT count(*)::int FROM project_members WHERE id=${value.fixture.membershipId}) AS members,
        (SELECT count(*)::int FROM audit_logs WHERE new_values->>'operationId'=${value.operationId}) AS audits,
        (SELECT count(*)::int FROM audit_logs WHERE new_values->>'operationId'=${value.withdrawalOperationId}) AS "withdrawalAudits"`;
      return result;
    }
    async function audits(operationId: string) {
      return cluster.observer
        .sql`SELECT to_jsonb(a) AS row FROM audit_logs a WHERE new_values->>'operationId'=${operationId} ORDER BY id`;
    }
    async function active(value: Proof) {
      const [result] = await cluster.observer.sql`SELECT
        (SELECT count(*)::int FROM tenants WHERE id=ANY(${Object.values(value.identity.tenants).map(t => t.id)}::uuid[]) AND is_active) AS tenants,
        (SELECT count(*)::int FROM profiles WHERE id=ANY(${Object.values(value.identity.profiles).map(p => p.id)}::uuid[]) AND is_active) AS profiles`;
      return result;
    }
    async function business(value: Proof) {
      return cluster.observer
        .sql`SELECT 'clients' AS kind,to_jsonb(c) AS row FROM clients c WHERE id=${value.fixture.clientId}
        UNION ALL SELECT 'projects',to_jsonb(p) FROM projects p WHERE id=${value.fixture.projectId}
        UNION ALL SELECT 'drafts',to_jsonb(d) FROM estimate_drafts d WHERE id=${value.fixture.draftId}
        UNION ALL SELECT 'members',to_jsonb(m) FROM project_members m WHERE id=${value.fixture.membershipId} ORDER BY kind`;
    }
    async function auditFailure(
      operation: "create" | "withdraw",
      run: () => Promise<void>
    ) {
      await cluster.observer.sql.unsafe(
        `CREATE SEQUENCE public.runner_read_failure_seen;
        GRANT USAGE ON SEQUENCE public.runner_read_failure_seen TO app_runtime;
        CREATE FUNCTION public.runner_read_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='homolog.read-proof.${operation}.completed' THEN PERFORM nextval('public.runner_read_failure_seen'); RAISE EXCEPTION 'PRIVATE_DRIVER_DETAIL'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER runner_read_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.runner_read_failure()`
      );
      try {
        await run();
        // Sequence increments survive rollback and prove the late receipt was reached.
        expect(
          await cluster.observer
            .sql`SELECT last_value::int AS calls,is_called FROM public.runner_read_failure_seen`
        ).toEqual([{ calls: 1, is_called: true }]);
      } finally {
        await cluster.observer.sql.unsafe(
          "DROP TRIGGER runner_read_failure ON audit_logs; DROP FUNCTION public.runner_read_failure(); DROP SEQUENCE public.runner_read_failure_seen"
        );
      }
    }
    it("creates the read-proof through the verified handle while preserving historical bootstrap evidence", async () => {
      const value = await seedReadProof(),
        before = await audits(value.identity.operationId);
      const execution = await apply(value, "read-proof-create");
      const result = await execution.pending;
      expect(result).toMatchObject({
        status: "created",
        sourceCommit,
        createRows: 4,
        createAudits: 5,
        sourceVerified: true,
        databaseTargetVerified: true,
        targetVerification: "direct-host-verified-tls",
        authVerified: false,
      });
      expect(await proofCounts(value)).toEqual(created);
      expect(await audits(value.identity.operationId)).toEqual(before);
      const [receipt] = await cluster.observer
        .sql`SELECT new_values->'manifest' AS manifest,new_values->'administrativeActor' AS actor FROM audit_logs WHERE record_id=${value.operationId}`;
      expect(receipt.manifest).toEqual(value);
      expect(receipt.actor).toEqual({
        kind: "database-principal",
        currentUser: "app_runtime",
        sessionUser: "app_runtime",
      });
      expect(intercepted.options).toMatchObject({
        max: 1,
        host: "db.wmspwegbqtzamkhxhusg.supabase.co",
        ssl: {
          rejectUnauthorized: true,
          servername: "db.wmspwegbqtzamkhxhusg.supabase.co",
          ca: rootCertificates[0],
        },
      });
      expect(JSON.stringify(result)).not.toContain(
        value.identity.profiles.A1.providerSubject
      );
      await expect(execution.connection.sql`SELECT 1`).rejects.toMatchObject({
        code: "CONNECTION_ENDED",
      });
    });
    it("replays read-proof creation with the same four rows and five audit records", async () => {
      const value = await seedReadProof();
      await (
        await apply(value, "read-proof-create")
      ).pending;
      const before = await audits(value.operationId),
        rows = await business(value);
      await expect(
        (await apply(value, "read-proof-create")).pending
      ).resolves.toMatchObject({ status: "replayed" });
      expect(await proofCounts(value)).toEqual(created);
      expect(await audits(value.operationId)).toEqual(before);
      expect(await business(value)).toEqual(rows);
    });
    it("refuses a changed historical bootstrap commit without creating fixture rows", async () => {
      const value = await seedReadProof(),
        before = await audits(value.identity.operationId);
      value.identity.sourceCommit = sourceCommit;
      const execution = await apply(value, "read-proof-create");
      await expect(execution.pending).rejects.toThrow(
        "HOMOLOG_READ_IDENTITY_CONFLICT"
      );
      expect(await proofCounts(value)).toEqual(empty);
      expect(await audits(value.identity.operationId)).toEqual(before);
      await expect(execution.connection.sql`SELECT 1`).rejects.toMatchObject({
        code: "CONNECTION_ENDED",
      });
    });
    it("rolls back read-proof creation after a late audit failure and sanitizes the error", async () => {
      const value = await seedReadProof(),
        before = await audits(value.identity.operationId);
      await auditFailure("create", async () => {
        const execution = await apply(value, "read-proof-create");
        await expect(execution.pending).rejects.toThrow("HOMOLOG_READ_FAILED");
        expect(await proofCounts(value)).toEqual(empty);
        expect(await audits(value.identity.operationId)).toEqual(before);
        await expect(execution.connection.sql`SELECT 1`).rejects.toMatchObject({
          code: "CONNECTION_ENDED",
        });
      });
    });
    it("withdraws exactly five identities with six audits while retaining business rows and historical evidence", async () => {
      const value = await seedReadProof();
      await (
        await apply(value, "read-proof-create")
      ).pending;
      const bootstrap = await audits(value.identity.operationId),
        creation = await audits(value.operationId),
        rows = await business(value);
      const execution = await apply(value, "read-proof-withdraw");
      await expect(execution.pending).resolves.toMatchObject({
        status: "withdrawn",
        withdrawRows: 5,
        withdrawAudits: 6,
        databaseTargetVerified: true,
        authVerified: false,
      });
      expect(await proofCounts(value)).toEqual({
        ...created,
        withdrawalAudits: 6,
      });
      expect(await active(value)).toEqual({ tenants: 0, profiles: 0 });
      expect(await business(value)).toEqual(rows);
      expect(await audits(value.identity.operationId)).toEqual(bootstrap);
      expect(await audits(value.operationId)).toEqual(creation);
      await expect(execution.connection.sql`SELECT 1`).rejects.toMatchObject({
        code: "CONNECTION_ENDED",
      });
    });
    it("replays withdrawal without replacing its six audit records", async () => {
      const value = await seedReadProof();
      await (
        await apply(value, "read-proof-create")
      ).pending;
      await (
        await apply(value, "read-proof-withdraw")
      ).pending;
      const before = await audits(value.withdrawalOperationId);
      await expect(
        (await apply(value, "read-proof-withdraw")).pending
      ).resolves.toMatchObject({ status: "replayed" });
      expect(await proofCounts(value)).toEqual({
        ...created,
        withdrawalAudits: 6,
      });
      expect(await audits(value.withdrawalOperationId)).toEqual(before);
    });
    it("refuses creation after withdrawal without reactivating identities", async () => {
      const value = await seedReadProof();
      await (
        await apply(value, "read-proof-create")
      ).pending;
      await (
        await apply(value, "read-proof-withdraw")
      ).pending;
      await expect(
        (await apply(value, "read-proof-create")).pending
      ).rejects.toThrow("HOMOLOG_READ_WITHDRAWN");
      expect(await active(value)).toEqual({ tenants: 0, profiles: 0 });
      expect(await proofCounts(value)).toEqual({
        ...created,
        withdrawalAudits: 6,
      });
    });
    it("rolls back all deactivations after a late withdrawal audit failure", async () => {
      const value = await seedReadProof();
      await (
        await apply(value, "read-proof-create")
      ).pending;
      await auditFailure("withdraw", async () => {
        const execution = await apply(value, "read-proof-withdraw");
        await expect(execution.pending).rejects.toThrow("HOMOLOG_READ_FAILED");
        expect(await proofCounts(value)).toEqual(created);
        expect(await active(value)).toEqual({ tenants: 2, profiles: 3 });
        await expect(execution.connection.sql`SELECT 1`).rejects.toMatchObject({
          code: "CONNECTION_ENDED",
        });
      });
    });
    it("refuses withdrawal without a creation receipt", async () => {
      const value = await seedReadProof();
      await expect(
        (await apply(value, "read-proof-withdraw")).pending
      ).rejects.toThrow("HOMOLOG_READ_OPERATION_CONFLICT");
      expect(await proofCounts(value)).toEqual(empty);
      expect(await active(value)).toEqual({ tenants: 2, profiles: 3 });
    });
    it("refuses fixture drift during withdrawal without deactivating identities", async () => {
      const value = await seedReadProof();
      await (
        await apply(value, "read-proof-create")
      ).pending;
      await cluster.observer
        .sql`UPDATE project_members SET is_active=false WHERE id=${value.fixture.membershipId}`;
      await expect(
        (await apply(value, "read-proof-withdraw")).pending
      ).rejects.toThrow("HOMOLOG_READ_STATE_DRIFT");
      expect(await proofCounts(value)).toEqual(created);
      expect(await active(value)).toEqual({ tenants: 2, profiles: 3 });
    });
    it("refuses an operation ID colliding with an existing row", async () => {
      const value = await seedReadProof();
      await cluster.observer
        .sql`INSERT INTO tenants(id,name,slug) VALUES(${value.operationId},'Synthetic collision',${`collision-${value.operationId}`})`;
      await expect(
        (await apply(value, "read-proof-create")).pending
      ).rejects.toThrow("HOMOLOG_READ_COLLISION");
      expect(await proofCounts(value)).toEqual(empty);
    });
  }
);
