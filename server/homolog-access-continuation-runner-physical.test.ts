/** Administrative dispatcher through an owned PostgreSQL/PostgREST fixture; no hosted target. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { auditLogs, clients, projects, intakeForms } from "../drizzle/schema";
import {
  startAdr002Postgrest,
  type Adr002Postgrest,
} from "./test-support/adr002-postgrest";
import {
  physicalRows,
  seedContinuation,
} from "./test-support/homolog-continuation-fixtures";

const intercepted = vi.hoisted(() => ({
  client: undefined as ReturnType<typeof postgres> | undefined,
}));
vi.mock("postgres", async importOriginal => {
  const actual = await importOriginal<{ default: typeof postgres }>();
  return {
    ...actual,
    default: (options: Record<string, unknown>) => {
      // Only the runner's hosted boundary is redirected. The harness still owns
      // and validates its real Unix-socket connections; no external connection runs.
      if (options.host === "db.wmspwegbqtzamkhxhusg.supabase.co") {
        if (!intercepted.client) throw new Error("NO_OWNED_RUNNER_CONNECTION");
        return intercepted.client;
      }
      if (
        typeof options.host === "string" &&
        /^\/private\/tmp\/structr-app-principal-pg-[^/]+\/socket$/.test(
          options.host
        ) &&
        options.port === 55443 &&
        options.ssl === false
      )
        return actual.default(options);
      throw new Error("RUNNER_TEST_REFUSES_UNOWNED_DESTINATION");
    },
  };
});

const enabled =
  process.env.HOMOLOG_CONTINUATION_RUNNER_PHYSICAL === "1" &&
  process.env.ADR002_PHYSICAL === "1";
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

describe.skipIf(!enabled)(
  "continuation runner through an owned IF-1 history",
  { timeout: 30000 },
  () => {
    let lab: Adr002Postgrest,
      directory: string,
      fixture: string,
      sourceCommit: string;
    let runner: typeof import("../scripts/homolog-access-runner");
    type Manifest = Awaited<ReturnType<typeof seedContinuation>>;
    beforeAll(async () => {
      lab = await startAdr002Postgrest({
        applyMinimumReads: true,
        applyIntakeFormation: true,
      });
      directory = await realpath(
        await mkdtemp(join(tmpdir(), "structr-continuation-runner-"))
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
      const git = (args: string[]) => {
        const result = spawnSync(
          "/usr/bin/git",
          [
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            ...args,
          ],
          {
            cwd: fixture,
            env: gitEnv,
            encoding: "utf8",
            timeout: 10000,
          }
        );
        if (result.status !== 0)
          throw new Error("Continuation fixture Git failed");
        return result.stdout.trim();
      };
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
        "continuation test fixture",
      ]);
      sourceCommit = git(["rev-parse", "HEAD"]);
      runner = await import(
        /* @vite-ignore */ join(fixture, "scripts/homolog-access-runner.ts")
      );
    }, 90000);
    afterAll(async () => {
      if (lab) {
        const owned = lab.cluster.directory;
        await lab.stop();
        await expect(access(owned)).rejects.toMatchObject({ code: "ENOENT" });
      }
      if (directory) await rm(directory, { recursive: true, force: true });
    }, 30000);
    async function execute(value: Manifest, mode: string) {
      const manifest = join(directory, `${randomUUID()}.json`),
        config = join(directory, `${randomUUID()}.json`);
      await writeFile(manifest, JSON.stringify(value), { mode: 0o600 });
      await writeFile(
        config,
        JSON.stringify({
          version: "structr-homolog-admin-connection-v1",
          projectRef: "wmspwegbqtzamkhxhusg",
          host: "db.wmspwegbqtzamkhxhusg.supabase.co",
          port: 5432,
          database: "postgres",
          user: "postgres",
          password: "SYNTHETIC_RUNNER_VALUE_NOT_A_CREDENTIAL",
        }),
        { mode: 0o600 }
      );
      const connection = await lab.connectSupervisor();
      intercepted.client = connection;
      return {
        connection,
        pending: runner.runHomologAccess([mode, manifest, config]),
      };
    }
    async function identities(value: Manifest) {
      const identity = value.priorReadProof.identity;
      return lab.sql`SELECT 'tenants' AS kind,to_jsonb(t) AS row FROM tenants t WHERE id=ANY(${Object.values(identity.tenants).map(t => t.id)}::uuid[])
      UNION ALL SELECT 'profiles',to_jsonb(p) FROM profiles p WHERE id=ANY(${Object.values(identity.profiles).map(p => p.id)}::uuid[]) ORDER BY kind,row`;
    }
    async function business() {
      return {
        clients: await physicalRows(lab, clients, "clients"),
        projects: await physicalRows(lab, projects, "projects"),
        intakes: await physicalRows(lab, intakeForms, "intake_forms"),
      };
    }
    it("dispatches reactivation and withdrawal with replay, unchanged IF-1 evidence and closed connections", async () => {
      const value = { ...(await seedContinuation(lab)), sourceCommit };
      const before = await physicalRows(lab, auditLogs, "audit_logs"),
        keep = await business();
      for (const [mode, status, active] of [
        ["continuation-reactivate", "reactivated", true],
        ["continuation-reactivate", "replayed", true],
        ["continuation-withdraw", "withdrawn", false],
        ["continuation-withdraw", "replayed", false],
      ] as const) {
        const execution = await execute(value, mode);
        const result = await execution.pending;
        expect(result).toMatchObject({
          status,
          sourceCommit,
          sourceVerified: true,
          databaseTargetVerified: true,
          authVerified: false,
        });
        expect(JSON.stringify(result)).not.toContain(
          value.priorReadProof.identity.profiles.A1.providerSubject
        );
        const state = await identities(value);
        expect(state).toHaveLength(5);
        expect(state.every(r => r.row.is_active === active)).toBe(true);
        await expect(execution.connection`SELECT 1`).rejects.toMatchObject({
          code: "CONNECTION_ENDED",
        });
      }
      expect(await business()).toEqual(keep);
      const after = await physicalRows(lab, auditLogs, "audit_logs");
      expect(
        after.filter(row => before.some(old => old.id === row.id))
      ).toEqual(before);
      expect(after).toHaveLength(before.length + 12);
      const rejected = await execute(value, "continuation-reactivate");
      await expect(rejected.pending).rejects.toThrow(
        "HOMOLOG_CONTINUATION_WITHDRAWN"
      );
      await expect(rejected.connection`SELECT 1`).rejects.toMatchObject({
        code: "CONNECTION_ENDED",
      });
    });
    it("sanitizes a real late audit failure, rolls back and closes the continuation connection", async () => {
      const value = { ...(await seedContinuation(lab)), sourceCommit };
      const before = await identities(value),
        logs = await physicalRows(lab, auditLogs, "audit_logs"),
        keep = await business();
      await lab.sql
        .unsafe(`CREATE SEQUENCE public.continuation_runner_failure_seen;
      CREATE FUNCTION public.continuation_runner_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action='homolog.identity-continuation.reactivate.completed' THEN
          PERFORM nextval('public.continuation_runner_failure_seen'); RAISE EXCEPTION 'PRIVATE_DRIVER_DETAIL';
        END IF; RETURN NEW; END $$;
      CREATE TRIGGER continuation_runner_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.continuation_runner_failure()`);
      try {
        const execution = await execute(value, "continuation-reactivate");
        await expect(
          execution.pending.catch(error => runner.homologRunnerErrorCode(error))
        ).resolves.toBe("HOMOLOG_CONTINUATION_FAILED");
        expect(
          await lab.sql`SELECT last_value::int AS calls,is_called FROM public.continuation_runner_failure_seen`
        ).toEqual([{ calls: 1, is_called: true }]);
        expect(await identities(value)).toEqual(before);
        expect(await business()).toEqual(keep);
        expect(await physicalRows(lab, auditLogs, "audit_logs")).toEqual(logs);
        await expect(execution.connection`SELECT 1`).rejects.toMatchObject({
          code: "CONNECTION_ENDED",
        });
      } finally {
        await lab.sql.unsafe(
          "DROP TRIGGER continuation_runner_failure ON audit_logs; DROP FUNCTION public.continuation_runner_failure(); DROP SEQUENCE public.continuation_runner_failure_seen"
        );
      }
    });
  }
);
