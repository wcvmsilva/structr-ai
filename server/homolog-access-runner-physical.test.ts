import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    async function inputs(value: ReturnType<typeof manifest>) {
      const manifestFile = join(directory, `${value.operationId}.json`),
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
        }),
        { mode: 0o600 }
      );
      return ["apply", manifestFile, connectionFile];
    }
    async function apply(value: ReturnType<typeof manifest>) {
      const connection = await cluster.connect(`runner-${randomUUID()}`);
      intercepted.connection = connection;
      return {
        connection,
        pending: runner.runHomologAccess(await inputs(value)),
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
      const actual =
        await vi.importActual<typeof import("postgres")>("postgres");
      cluster = await startAppPrincipalPostgres(actual.default);
      const migrations = new URL("../drizzle/", import.meta.url);
      const journal = JSON.parse(
        await readFile(new URL("meta/_journal.json", migrations), "utf8")
      );
      for (const { tag } of journal.entries.filter(
        (entry: { tag: string }) => Number(entry.tag.slice(0, 4)) <= 14
      ))
        await cluster.observer.sql.begin(tx =>
          readFile(new URL(`${tag}.sql`, migrations), "utf8").then(source =>
            tx.unsafe(source)
          )
        );
      await cluster.observer.sql.unsafe(
        "GRANT SELECT,INSERT ON public.tenants,public.profiles,public.audit_logs TO app_runtime; GRANT UPDATE(id) ON public.tenants,public.profiles,public.audit_logs TO app_runtime"
      );
      directory = await mkdtemp(
        "/private/tmp/structr-homolog-runner-physical-"
      );
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
  }
);
