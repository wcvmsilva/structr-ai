/** Actual production entry function and real audited helpers on one owned PG17 lab.
 * Never reads external credentials, URLs or provider configuration. */
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { startFinancialCalculatorBoundary } from "./test-support/financial-calculator-boundary";
import { provisionSyntheticCalculatorCredential } from "./test-support/calculator-credential";
import { parseCalculatorHomologationManifest } from "../scripts/financial-executor-homologation/contract";
const enabled = process.env.FINANCIAL_CALCULATOR_HOMOLOGATION_PHYSICAL === "1";
describe.skipIf(!enabled)(
  "owned operational CLI routing and committed withdrawal",
  () => {
    it("prepares, verifies, opens an explicit generation, deactivates and fully withdraws in fresh processes", async () => {
      const lab = await startFinancialCalculatorBoundary({
        credentialProof: true,
      });
      const scratch = await mkdtemp(
        join(await realpath(tmpdir()), "calculator-operation-journey-")
      );
      try {
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
        const admin = await lab.cluster.connect(
          "operation-journey-admin",
          "postgres"
        );
        for (const name of [
          "0020_closed_financial_calculator_boundary",
          "0021_financial_calculator_lifecycle",
        ]) {
          const source = await readFile(
            new URL(`../drizzle/${name}.sql`, import.meta.url),
            "utf8"
          );
          await admin.sql.begin(tx => tx.unsafe(source));
        }
        const fixture = parseCalculatorHomologationManifest({
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
            closesAt: new Date(Date.now() + 600000).toISOString(),
          },
        });
        const manifest = {
          fixture,
          rbac: {
            ...fixture,
            version: "calculator-homologation-rbac-v1",
            operationId: "c8000000-0000-4000-8000-000000000002",
            operator: { ...fixture.operator, originalRole: "user" },
            nominalRole: "calculator_pilot_operator_v1",
            permissionMode: "create-absent",
            ids: {
              permission: "c8310000-0000-4000-8000-000000000001",
              role: "c8310000-0000-4000-8000-000000000002",
              edge: "c8310000-0000-4000-8000-000000000003",
            },
          },
        };
        await lab.admin`INSERT INTO tenants(id,name,slug,timezone) VALUES(${fixture.operator.tenantId},'Synthetic operation tenant','operation-lab','America/New_York')`;
        await lab.admin`INSERT INTO profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${fixture.operator.actorId},${fixture.operator.tenantId},${fixture.operator.subject},'user',true)`;
        await lab.admin`INSERT INTO tenant_settings(id,tenant_id,profit_shield_overrides,geo_floor_overrides) VALUES('c9000000-0000-4000-8000-000000000006',${fixture.operator.tenantId},'{}','{}')`;
        const [{ nonce }] =
          await lab.admin`SELECT current_setting('app_principal_lab.nonce') AS nonce`;
        let ordinal = 0;
        async function run(operation: string, extra = {}) {
          const path = join(scratch, `command-${++ordinal}.json`),
            events = join(scratch, `events-${ordinal}.jsonl`);
          await writeFile(
            path,
            JSON.stringify({
              operation,
              manifest: operation === "preflight" ? fixture : manifest,
              ...extra,
              adminSecretFile: "/private/not-a-real-secret",
              caFile: "/private/not-a-real-ca",
              admissionExpiresAt: new Date(Date.now() + 60000).toISOString(),
              target: {
                host: "db.synthetic.supabase.co",
                port: 5432,
                database: "postgres",
                principal: "postgres",
                caSha256: "b".repeat(64),
              },
            }),
            { mode: 0o600 }
          );
          const child = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              fileURLToPath(
                new URL(
                  "./test-support/calculator-operation-process.ts",
                  import.meta.url
                )
              ),
              path,
              events,
              "physical",
              lab.cluster.directory,
              nonce,
            ],
            {
              cwd: fileURLToPath(new URL("../", import.meta.url)),
              env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" },
              stdio: ["ignore", "pipe", "pipe"],
            }
          );
          let stdout = "",
            stderr = "";
          child.stdout.on("data", data => {
            stdout += data;
          });
          child.stderr.on("data", data => {
            stderr += data;
          });
          const code = await new Promise<number | null>(resolve => {
            const timer = setTimeout(() => child.kill("SIGKILL"), 50000);
            child.once("close", value => {
              clearTimeout(timer);
              resolve(value);
            });
          });
          expect(stderr).toBe("");
          expect(code, stdout).toBe(0);
          expect(
            (await readFile(events, "utf8"))
              .trim()
              .split("\n")
              .map(line => JSON.parse(line).phase)
          ).toEqual(["connection", "close"]);
          const result = JSON.parse(stdout);
          expect(result.operation).toBe(operation);
          expect(result.operationId).toBe(fixture.operationId);
          expect(result.hostedReady).toBe(false);
          expect(stdout).not.toContain(fixture.operator.subject);
          return result;
        }
        const prepared = await run("prepare");
        expect(prepared.status).toBe("prepared");
        expect(
          (
            await lab.admin`SELECT role FROM profiles WHERE id=${fixture.operator.actorId}`
          )[0].role
        ).toBe("calculator_pilot_operator_v1");
        const before = (
          await lab.admin`SELECT count(*)::integer AS n FROM audit_logs`
        )[0].n;
        expect((await run("preflight")).status).toBe("preflight_passed");
        expect(
          (await lab.admin`SELECT count(*)::integer AS n FROM audit_logs`)[0].n
        ).toBe(before);
        const provisioned = await provisionSyntheticCalculatorCredential(
          admin.db,
          fixture
        );
        const opened = await run("open", {
          credential: {
            receiptId: provisioned.receiptId,
            generationId: provisioned.generationId,
          },
        });
        expect(opened.status).toBe("opened");
        expect(
          (
            await lab.admin`SELECT rolcanlogin FROM pg_roles WHERE rolname='structr_calculator_login_v1'`
          )[0].rolcanlogin
        ).toBe(true);
        const deactivated = await run("deactivate");
        expect(deactivated.status).toBe("deactivated");
        expect(
          (
            await lab.admin`SELECT is_active FROM structr_financial.principal_bindings`
          )[0].is_active
        ).toBe(false);
        const withdrawn = await run("withdraw");
        expect(withdrawn).toMatchObject({
          status: "withdrawn",
          rbacRestored: true,
          financial: {
            loginClosed: true,
            remainingSessions: 0,
            cleanupReason: null,
          },
        });
        expect(
          (
            await lab.admin`SELECT role FROM profiles WHERE id=${fixture.operator.actorId}`
          )[0].role
        ).toBe("user");
        expect(
          (
            await lab.admin`SELECT rolcanlogin,rolpassword IS NULL AS password_absent FROM pg_authid WHERE rolname='structr_calculator_login_v1'`
          )[0]
        ).toEqual({ rolcanlogin: false, password_absent: true });
        const actions = (
          await lab.admin`SELECT action FROM audit_logs WHERE action LIKE 'financial.homologation.%'`
        ).map(row => row.action);
        expect(actions).toContain("financial.homologation.prepare.completed");
        expect(actions).toContain("financial.homologation.open.completed");
        expect(actions).toContain(
          "financial.homologation.deactivate.completed"
        );
        expect(actions).toContain("financial.homologation.withdraw.completed");
      } finally {
        await lab.stop();
        await rm(scratch, { recursive: true, force: true });
      }
    }, 180000);
  }
);
