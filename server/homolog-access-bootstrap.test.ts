import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";
import {
  bootstrapHomologAccess,
  parseHomologAccessManifest,
  planHomologAccess,
} from "../scripts/homolog-access-bootstrap";
import { renderHomologAccessSql } from "../scripts/homolog-access-bootstrap-sql";
import {
  startAppPrincipalPostgres,
  type AppPrincipalCluster,
  type AppPrincipalConnection,
} from "./test-support/app-principal-postgres";

const repository = fileURLToPath(new URL("../", import.meta.url));
const entry = fileURLToPath(
  new URL("../scripts/homolog-access-bootstrap.ts", import.meta.url)
);
const ownedDirectories: string[] = [];
function manifest() {
  const operationId = randomUUID();
  return {
    version: "structr-homolog-identities-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    operationId,
    sourceCommit: "f08a7f0f028d11fe4433beb4340ba57e851a6a7d",
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
async function inputFile(value: unknown) {
  const directory = await mkdtemp(join(tmpdir(), "structr-homolog-manifest-"));
  ownedDirectories.push(directory);
  const path = join(directory, "manifest.json");
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}
const invoke = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: repository,
    encoding: "utf8",
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production" },
    timeout: 10_000,
  });
afterAll(async () => {
  for (const directory of ownedDirectories)
    await rm(directory, { recursive: true, force: true });
});

describe("homolog identity bootstrap manifest and offline CLI", () => {
  it("plans exactly two organizations and three users without asserting Auth or remote database verification", () => {
    const value = manifest();
    expect(parseHomologAccessManifest(value)).toEqual(value);
    const plan = planHomologAccess(value);
    expect(plan).toMatchObject({
      status: "planned",
      operationId: value.operationId,
      tenants: 2,
      profiles: 3,
      authVerified: false,
      databaseTargetVerified: false,
    });
    expect(plan.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    for (const profile of Object.values(value.profiles))
      expect(JSON.stringify(plan)).not.toContain(profile.providerSubject);
  });
  it("canonicalizes object key order while binding each supplied subject and source reference", () => {
    const value = manifest();
    const original = planHomologAccess(value)?.manifestHash;
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    const ordered = Object.fromEntries(Object.entries(value).reverse());
    expect(planHomologAccess(ordered).manifestHash).toBe(original);
    const changed = structuredClone(value);
    changed.profiles.A2.providerSubject = randomUUID();
    expect(planHomologAccess(changed).manifestHash).not.toBe(original);
    changed.sourceCommit = "a".repeat(40);
    expect(planHomologAccess(changed).manifestHash).not.toBe(
      planHomologAccess(value).manifestHash
    );
  });
  it.each([
    [
      "foreign project",
      (m: any) => {
        m.projectRef = "other-project";
      },
    ],
    [
      "credentials",
      (m: any) => {
        m.serviceRoleKey = "secret-value-must-not-leak";
      },
    ],
    [
      "nested extra",
      (m: any) => {
        m.profiles.A1.email = "person@example.test";
      },
    ],
    [
      "admin",
      (m: any) => {
        m.profiles.B1.role = "admin";
      },
    ],
    [
      "tenant mismatch",
      (m: any) => {
        m.profiles.A2.tenant = "B";
      },
    ],
    [
      "missing actor",
      (m: any) => {
        delete m.profiles.A2;
      },
    ],
    [
      "extra actor",
      (m: any) => {
        m.profiles.C1 = structuredClone(m.profiles.A1);
      },
    ],
    [
      "null UUID",
      (m: any) => {
        m.profiles.A1.id = "00000000-0000-0000-0000-000000000000";
      },
    ],
    [
      "internal identity reused",
      (m: any) => {
        m.profiles.A1.id = m.tenants.A.id;
      },
    ],
    [
      "provider equals internal",
      (m: any) => {
        m.profiles.A1.providerSubject = m.profiles.A2.id;
      },
    ],
    [
      "provider reused",
      (m: any) => {
        m.profiles.B1.providerSubject = m.profiles.A2.providerSubject;
      },
    ],
    [
      "slug reused",
      (m: any) => {
        m.tenants.B.slug = m.tenants.A.slug;
      },
    ],
    [
      "non synthetic slug",
      (m: any) => {
        m.tenants.A.slug = "gchi";
      },
    ],
    [
      "invalid source",
      (m: any) => {
        m.sourceCommit = "main";
      },
    ],
  ])("rejects %s before producing a plan", (_label, change) => {
    const value = manifest();
    change(value);
    expect(() => planHomologAccess(value)).toThrow("HOMOLOG_MANIFEST_INVALID");
  });
  it("imports the shared audit API in production without configuring a database or starting the app", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "await import('./server/audit.ts'); process.stdout.write('loaded')",
      ],
      {
        cwd: repository,
        encoding: "utf8",
        env: { PATH: "/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production" },
        timeout: 10_000,
      }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("loaded");
  });
  it.each(["validate", "plan"])(
    "runs %s offline in a production environment without credentials",
    async mode => {
      const value = manifest(),
        file = await inputFile(value);
      const result = invoke([mode, file]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: mode === "plan" ? "planned" : "valid",
        tenants: 2,
        profiles: 3,
      });
      expect(result.stderr).toBe("");
      expect(await readFile(file, "utf8")).toBe(JSON.stringify(value));
      expect(result.stdout).not.toContain(value.profiles.A1.providerSubject);
    }
  );
  it("refuses an apply command without reading or executing the manifest", async () => {
    const result = invoke(["apply", "/does/not/exist"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("HOMOLOG_CLI_USAGE");
  });
  it("reports a missing file without printing the supplied path", () => {
    const result = invoke([
      "plan",
      "/private/no-secret-value-here/missing.json",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("HOMOLOG_MANIFEST_UNREADABLE");
    expect(result.stderr).not.toContain("no-secret-value-here");
  });
  it("does not echo unknown manifest credentials or parse diagnostics", async () => {
    const result = invoke([
      "plan",
      await inputFile({ ...manifest(), password: "never-print-this" }),
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("HOMOLOG_MANIFEST_INVALID");
    expect(result.stderr).not.toContain("never-print-this");
  });
  it("renders a separately identified SQL executor with a body hash that is not self-referential", () => {
    const value = manifest(),
      result = renderHomologAccessSql(value);
    expect(result.executorId).toBe("structr-homolog-identities-sql-v1");
    expect(result.executorHash).toBe(
      createHash("sha256").update(result.body).digest("hex")
    );
    expect(result.body).not.toContain(result.executorHash);
    expect(result.sql).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE;");
    expect(result.sql).toContain(result.executorHash);
    expect(result.manifestHash).toBe(planHomologAccess(value).manifestHash);
  });
  it("emits SQL offline without modifying the private input file", async () => {
    const value = manifest(),
      file = await inputFile(value),
      result = invoke(["sql", file]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE;");
    expect(await readFile(file, "utf8")).toBe(JSON.stringify(value));
  });
});

const physical =
  process.env.APP_PRINCIPAL_LAB === "1" &&
  process.env.HOMOLOG_BOOTSTRAP_PHYSICAL === "1";
for (const executor of ["drizzle", "sql"] as const)
  describe.skipIf(!physical)(
    `homolog bootstrap real owned PostgreSQL transactions: ${executor}`,
    () => {
      let cluster: AppPrincipalCluster;
      const database = () => cluster.observer.db;
      const raw = () => cluster.observer.sql;
      async function apply(
        value: unknown,
        connection: AppPrincipalConnection = cluster.observer
      ) {
        if (executor === "drizzle")
          return bootstrapHomologAccess(connection.db, value);
        const rendered = renderHomologAccessSql(value);
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const results = await connection.sql.unsafe(rendered.sql);
            return results.flat().find((row: any) => row.bootstrap_result)
              ?.bootstrap_result;
          } catch (error) {
            await connection.sql.unsafe("ROLLBACK");
            if (
              ["40001", "40P01"].includes(
                (error as { code?: string }).code ?? ""
              ) &&
              attempt < 2
            )
              continue;
            throw new Error((error as Error).message);
          }
        }
      }
      beforeAll(async () => {
        cluster = await startAppPrincipalPostgres(postgres);
        const migrations = new URL("../drizzle/", import.meta.url);
        const journal = JSON.parse(
          await readFile(new URL("meta/_journal.json", migrations), "utf8")
        );
        for (const { tag } of journal.entries.filter(
          (e: { tag: string }) => Number(e.tag.slice(0, 4)) <= 14
        )) {
          const source = await readFile(
            new URL(`${tag}.sql`, migrations),
            "utf8"
          );
          await raw().begin(tx => tx.unsafe(source));
        }
      }, 90_000);
      afterAll(async () => {
        if (!cluster) return;
        const directory = cluster.directory,
          pid = cluster.observer.pid;
        await cluster.stop();
        await expect(access(directory)).rejects.toMatchObject({
          code: "ENOENT",
        });
        console.log(
          "HOMOLOG_BOOTSTRAP_CLEANUP",
          JSON.stringify({ directory, pid, removed: true })
        );
      }, 20_000);
      async function counts(value: ReturnType<typeof manifest>) {
        const ids = [value.tenants.A.id, value.tenants.B.id];
        const profiles = Object.values(value.profiles).map(p => p.id);
        const [result] = await raw()`SELECT
      (SELECT count(*)::int FROM tenants WHERE id=ANY(${ids}::uuid[])) AS tenants,
      (SELECT count(*)::int FROM profiles WHERE id=ANY(${profiles}::uuid[])) AS profiles,
      (SELECT count(*)::int FROM audit_logs WHERE new_values->>'operationId'=${value.operationId}) AS audits`;
        return result;
      }
      it("creates two distinct tenants, three least-privilege profiles and six durable audit rows", async () => {
        const value = manifest();
        const result = await apply(value);
        expect(result).toMatchObject({
          status: "created",
          operationId: value.operationId,
          tenants: 2,
          profiles: 3,
        });
        expect(await counts(value)).toEqual({
          tenants: 2,
          profiles: 3,
          audits: 6,
        });
        const rows =
          await raw()`SELECT id,tenant_id,external_open_id,role,is_active,email,login_method,last_signed_in FROM profiles
      WHERE id=ANY(${Object.values(value.profiles).map(p => p.id)}::uuid[]) ORDER BY external_open_id`;
        expect(rows).toEqual(
          Object.values(value.profiles)
            .map(p => ({
              id: p.id,
              tenant_id: value.tenants[p.tenant as "A" | "B"].id,
              external_open_id: p.providerSubject,
              role: "user",
              is_active: true,
              email: null,
              login_method: null,
              last_signed_in: null,
            }))
            .sort((a, b) =>
              a.external_open_id.localeCompare(b.external_open_id)
            )
        );
        expect(
          await raw()`SELECT count(*)::int AS auth_schemas FROM pg_namespace WHERE nspname='auth'`
        ).toEqual([{ auth_schemas: 0 }]);
        expect(
          await raw()`SELECT count(*)::int AS projects FROM projects`
        ).toEqual([{ projects: 0 }]);
      });
      it("attributes bootstrap to the observed administrative principal without impersonating the new A1 profile", async () => {
        const value = manifest();
        await apply(value);
        const logs =
          await raw()`SELECT user_id,action,new_values FROM audit_logs WHERE new_values->>'operationId'=${value.operationId}`;
        expect(logs).toHaveLength(6);
        expect(logs.map(row => row.user_id)).toEqual([
          null,
          null,
          null,
          null,
          null,
          null,
        ]);
        const receipt = logs.find(
          row => row.action === "homolog.identity.bootstrap.completed"
        );
        expect(receipt?.new_values.administrativeActor).toEqual({
          kind: "database-principal",
          currentUser: "app_principal_runner",
          sessionUser: "app_principal_runner",
        });
        expect(receipt?.new_values.manifest.profiles.A1.id).toBe(
          value.profiles.A1.id
        );
      });
      it("replays an exact operation without creating more rows or audit evidence", async () => {
        const value = manifest();
        const first = await apply(value);
        const result = await apply(
          Object.fromEntries(Object.entries(value).reverse())
        );
        expect(result).toEqual({ ...first, status: "replayed" });
        expect(await counts(value)).toEqual({
          tenants: 2,
          profiles: 3,
          audits: 6,
        });
      });
      it("rejects changed input for a completed operation", async () => {
        const value = manifest();
        await apply(value);
        value.profiles.A1.providerSubject = randomUUID();
        await expect(apply(value)).rejects.toThrow(
          "HOMOLOG_OPERATION_CONFLICT"
        );
        expect(await counts(value)).toEqual({
          tenants: 2,
          profiles: 3,
          audits: 6,
        });
      });
      it.each([
        "id",
        "slug",
        "subject",
        "profileId",
        "tenant-to-profile",
        "profile-to-tenant",
        "subject-to-profile",
        "profile-to-subject",
      ])(
        "rejects an existing %s before creating any bootstrap records",
        async kind => {
          const existing = manifest();
          await apply(existing);
          const value = manifest();
          if (kind === "id") value.tenants.A.id = existing.tenants.A.id;
          if (kind === "slug") value.tenants.A.slug = existing.tenants.A.slug;
          if (kind === "subject")
            value.profiles.A1.providerSubject =
              existing.profiles.A1.providerSubject;
          if (kind === "profileId")
            value.profiles.A1.id = existing.profiles.A1.id;
          if (kind === "tenant-to-profile")
            value.tenants.A.id = existing.profiles.A1.id;
          if (kind === "profile-to-tenant")
            value.profiles.A1.id = existing.tenants.A.id;
          if (kind === "subject-to-profile")
            value.profiles.A1.providerSubject = existing.profiles.A1.id;
          if (kind === "profile-to-subject")
            value.profiles.A1.id = existing.profiles.A1.providerSubject;
          const before = await counts(value);
          await expect(apply(value)).rejects.toThrow(
            "HOMOLOG_IDENTITY_COLLISION"
          );
          expect(await counts(value)).toEqual(before);
        }
      );
      it.each([
        "profile",
        "tenant",
        "mapping",
        "timestamp",
        "microsecond",
        "missing",
      ])("refuses replay after %s drift", async kind => {
        const value = manifest();
        await apply(value);
        if (kind === "profile")
          await raw()`UPDATE profiles SET is_active=false WHERE id=${value.profiles.A2.id}`;
        if (kind === "tenant")
          await raw()`UPDATE tenants SET settings='{"changed":true}'::jsonb WHERE id=${value.tenants.B.id}`;
        if (kind === "mapping")
          await raw()`UPDATE profiles SET external_open_id=${randomUUID()} WHERE id=${value.profiles.B1.id}`;
        if (kind === "timestamp")
          await raw()`UPDATE profiles SET updated_at=updated_at+interval '1 second' WHERE id=${value.profiles.A1.id}`;
        if (kind === "microsecond")
          await raw()`UPDATE profiles SET updated_at=updated_at+interval '1 microsecond' WHERE id=${value.profiles.A1.id}`;
        if (kind === "missing")
          await raw()`DELETE FROM profiles WHERE id=${value.profiles.A2.id}`;
        await expect(apply(value)).rejects.toThrow("HOMOLOG_STATE_DRIFT");
      });
      it("refuses a preexisting operation receipt without complete evidence", async () => {
        const value = manifest();
        await raw()`INSERT INTO audit_logs(action,table_name,record_id,new_values)
      VALUES('homolog.identity.bootstrap.completed','homolog_identity_bootstrap',${value.operationId},${JSON.stringify({ operationId: value.operationId })}::jsonb)`;
        await expect(apply(value)).rejects.toThrow(
          "HOMOLOG_OPERATION_CONFLICT"
        );
        expect(await counts(value)).toEqual({
          tenants: 0,
          profiles: 0,
          audits: 1,
        });
      });
      it("rolls back all identities and preceding audits when the final durable audit fails", async () => {
        const value = manifest();
        await raw().unsafe(
          "CREATE FUNCTION public.homolog_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='homolog.identity.bootstrap.completed' THEN RAISE EXCEPTION 'PRIVATE_DRIVER_DETAIL'; END IF; RETURN NEW; END $$; CREATE TRIGGER homolog_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.homolog_test_audit_failure()"
        );
        try {
          await expect(apply(value)).rejects.toThrow(
            "HOMOLOG_BOOTSTRAP_FAILED"
          );
          expect(await counts(value)).toEqual({
            tenants: 0,
            profiles: 0,
            audits: 0,
          });
        } finally {
          await raw().unsafe(
            "DROP TRIGGER homolog_test_audit_failure ON audit_logs; DROP FUNCTION public.homolog_test_audit_failure()"
          );
        }
      });
      it("rolls back if the database changes the final audit receipt instead of retaining exact evidence", async () => {
        const value = manifest();
        await raw().unsafe(
          "CREATE FUNCTION public.homolog_test_audit_corrupt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='homolog.identity.bootstrap.completed' THEN NEW.new_values := jsonb_set(NEW.new_values,'{manifestHash}','\"changed\"'); END IF; RETURN NEW; END $$; CREATE TRIGGER homolog_test_audit_corrupt BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.homolog_test_audit_corrupt()"
        );
        try {
          await expect(apply(value)).rejects.toThrow(
            "HOMOLOG_OPERATION_CONFLICT"
          );
          expect(await counts(value)).toEqual({
            tenants: 0,
            profiles: 0,
            audits: 0,
          });
        } finally {
          await raw().unsafe(
            "DROP TRIGGER homolog_test_audit_corrupt ON audit_logs; DROP FUNCTION public.homolog_test_audit_corrupt()"
          );
        }
      });
      it("uses SERIALIZABLE for actual inserts and propagates a failed row readback atomically", async () => {
        const value = manifest();
        await raw().unsafe(
          "CREATE FUNCTION public.homolog_test_profile_readback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('transaction_isolation')<>'serializable' THEN RAISE EXCEPTION 'WRONG_ISOLATION'; END IF; NEW.role:='admin'; RETURN NEW; END $$; CREATE TRIGGER homolog_test_profile_readback BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION public.homolog_test_profile_readback()"
        );
        try {
          await expect(apply(value)).rejects.toThrow("HOMOLOG_STATE_DRIFT");
          expect(await counts(value)).toEqual({
            tenants: 0,
            profiles: 0,
            audits: 0,
          });
        } finally {
          await raw().unsafe(
            "DROP TRIGGER homolog_test_profile_readback ON profiles; DROP FUNCTION public.homolog_test_profile_readback()"
          );
        }
      });
      it("replays the other executor's receipt without duplicate writes", async () => {
        const value = manifest();
        if (executor === "sql") await bootstrapHomologAccess(database(), value);
        else await raw().unsafe(renderHomologAccessSql(value).sql);
        expect(await apply(value)).toMatchObject({ status: "replayed" });
        expect(await counts(value)).toEqual({
          tenants: 2,
          profiles: 3,
          audits: 6,
        });
      });
      it("serializes competing connections for one operation and retries the complete transaction", async () => {
        const value = manifest();
        await raw().unsafe(
          "GRANT SELECT,INSERT ON public.tenants,public.profiles,public.audit_logs TO app_runtime; GRANT UPDATE(id) ON public.tenants,public.profiles,public.audit_logs TO app_runtime"
        );
        const first = await cluster.connect("bootstrap-race-first"),
          second = await cluster.connect("bootstrap-race-second");
        let pending: Promise<unknown>[] = [];
        await raw().begin(async tx => {
          await tx`SELECT pg_advisory_xact_lock(731014,hashtext(${value.operationId}))`;
          pending = [apply(value, first), apply(value, second)];
          // Attach handlers while the competing transactions wait, preventing an
          // unhandled rejection if setup fails before the main allSettled call.
          for (const promise of pending) void promise.catch(() => undefined);
          let waiting = 0;
          for (let i = 0; i < 100; i++) {
            const [row] =
              await tx`SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE pid=ANY(${[first.pid, second.pid]}::int[]) AND wait_event='advisory'`;
            waiting = row.waiting;
            if (waiting === 2) break;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          expect(waiting).toBe(2);
        });
        const results = (await Promise.all(pending)) as Array<{
          status: string;
        }>;
        expect(results.map(r => r.status).sort()).toEqual([
          "created",
          "replayed",
        ]);
        expect(await counts(value)).toEqual({
          tenants: 2,
          profiles: 3,
          audits: 6,
        });
      });
    }
  );
