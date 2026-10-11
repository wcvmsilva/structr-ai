import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  startFinancialCalculatorBoundary,
  boundarySource,
  setupCalculatorLifecycleFixture,
} from "./test-support/financial-calculator-boundary";
import { sql } from "drizzle-orm";
import { withCalculatorOwnerMaintenance } from "../scripts/financial-executor-homologation/boundary";
import { inspectCalculatorCompatibility } from "../scripts/financial-executor-homologation/compatibility";
const enabled =
  process.env.FINANCIAL_CALCULATOR_HOSTED_COMPATIBILITY_PHYSICAL === "1";
const root = new URL("../", import.meta.url);
describe.skipIf(!enabled)("Calculator managed provider closure", () => {
  let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>;
  beforeAll(async () => {
    lab = await startFinancialCalculatorBoundary();
  }, 60000);
  afterAll(async () => lab?.stop(), 30000);
  it("collects complete exact metadata without changing the database", async () => {
    const rows = await lab.admin.begin("read only", async tx => {
      const source = await readFile(
        new URL(
          "scripts/financial-executor-homologation/compatibility-inspect.sql",
          root
        ),
        "utf8"
      );
      await tx.unsafe("SET LOCAL search_path=pg_catalog");
      return tx.unsafe(source.slice(source.indexOf(";") + 1));
    });
    expect(rows[0].observation.objects).toHaveLength(1047);
    expect(rows[0].observation.extension).toMatchObject({
      name: "pgcrypto",
      version: "1.3",
      namespace: "public",
    });
    expect(rows[0].observation.extension.members).toHaveLength(36);
    expect(
      rows[0].observation.surface.some(
        (r: any) => r.identity === "database:postgres"
      )
    ).toBe(true);
  });
  it("connects as the real non-superuser maintenance principal", async () => {
    await lab.admin.unsafe("ALTER ROLE postgres LOGIN CREATEROLE BYPASSRLS");
    const installer = await lab.cluster.connect(
      "managed-installer",
      "postgres" as any
    );
    expect(
      await installer.sql`SELECT current_user,session_user,rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user`
    ).toEqual([
      {
        current_user: "postgres",
        session_user: "postgres",
        rolsuper: false,
        rolcreaterole: true,
      },
    ]);
  });
  it.each([
    "0020_closed_financial_calculator_boundary",
    "0021_financial_calculator_lifecycle",
  ])(
    "refuses %s managed PUBLIC routines without partial installation",
    async migration => {
      const rollback = new Error("rollback fixture");
      await expect(
        lab.admin.begin(async tx => {
          if (migration.startsWith("0021"))
            await tx.unsafe(await boundarySource());
          await tx.unsafe(
            "CREATE SCHEMA extensions; REVOKE ALL ON SCHEMA extensions FROM PUBLIC; ALTER EXTENSION pgcrypto SET SCHEMA extensions; CREATE FUNCTION extensions.provider_probe() RETURNS integer LANGUAGE sql RETURN 1"
          );
          await expect(
            tx.savepoint(async nested =>
              nested.unsafe(
                await readFile(
                  new URL(`drizzle/${migration}.sql`, root),
                  "utf8"
                )
              )
            )
          ).rejects.toMatchObject({
            code: "42501",
            message: "FINANCIAL_PUBLIC_PRIVILEGE_PREFLIGHT",
          });
          const [state] =
            await tx`SELECT to_regprocedure('structr_financial.authorize_v1(jsonb)') IS NOT NULL AS lifecycle,to_regnamespace('structr_financial') IS NOT NULL AS foundation`;
          expect(state).toEqual({
            lifecycle: false,
            foundation: migration.startsWith("0021"),
          });
          throw rollback;
        })
      ).rejects.toBe(rollback);
    }
  );
  it.each([
    "0020_closed_financial_calculator_boundary",
    "0021_financial_calculator_lifecycle",
  ])(
    "refuses %s PUBLIC CREATE in literal user schema pgoutside",
    async migration => {
      const rollback = new Error("rollback fixture");
      await expect(
        lab.admin.begin(async tx => {
          if (migration.startsWith("0021"))
            await tx.unsafe(await boundarySource());
          await tx.unsafe(
            "CREATE SCHEMA pgoutside; GRANT CREATE ON SCHEMA pgoutside TO PUBLIC"
          );
          await expect(
            tx.savepoint(async nested =>
              nested.unsafe(
                await readFile(
                  new URL(`drizzle/${migration}.sql`, root),
                  "utf8"
                )
              )
            )
          ).rejects.toMatchObject({
            code: "42501",
            message: "FINANCIAL_SCHEMA_CREATION_PREFLIGHT",
          });
          throw rollback;
        })
      ).rejects.toBe(rollback);
    }
  );

  it("accepts only an actual pg_depend-proven relocation of the exact extension members", async () => {
    const rollback = new Error("rollback relocation");
    await expect(
      lab.admin.begin(async tx => {
        const source = await readFile(
          new URL(
            "scripts/financial-executor-homologation/compatibility-inspect.sql",
            root
          ),
          "utf8"
        );
        await tx.unsafe("SET LOCAL search_path=pg_catalog");
        const [{ observation: baseline }] = await tx.unsafe(
          source.slice(source.indexOf(";") + 1)
        );
        await tx.unsafe(
          "CREATE SCHEMA extensions; REVOKE ALL ON SCHEMA extensions FROM PUBLIC; ALTER EXTENSION pgcrypto SET SCHEMA extensions"
        );
        const [{ observation: relocated }] = await tx.unsafe(
          source.slice(source.indexOf(";") + 1)
        );
        // Isolate namespace projection; surface ACL/schema changes are a separate exact review.
        baseline.surface = [];
        relocated.surface = [];
        baseline.unresolved = [];
        relocated.unresolved = [];
        const manifest = {
          version: "calculator-compatibility-manifest-v1",
          state: "reviewed-local-candidate",
          observation: baseline,
        };
        const before = inspectCalculatorCompatibility(baseline, manifest),
          after = inspectCalculatorCompatibility(relocated, manifest);
        expect(after).toEqual(before);
        expect(after.status).toBe("compatible");
        throw rollback;
      })
    ).rejects.toBe(rollback);
  });
  it("installs both candidates atomically as the real non-superuser postgres", async () => {
    // Isolated cluster only: make the same nominal principal own application objects.
    await lab.admin.unsafe(
      await readFile(
        new URL(
          "server/test-support/financial-calculator-boundary/managed-provider-fixture.sql",
          root
        ),
        "utf8"
      )
    );
    const installer = await lab.cluster.connect(
      "non-superuser-install",
      "postgres"
    );
    const inspection = await readFile(
      new URL(
        "scripts/financial-executor-homologation/compatibility-inspect.sql",
        root
      ),
      "utf8"
    );
    const observed = await installer.sql.begin("read only", async tx => {
      await tx.unsafe("SET LOCAL search_path=pg_catalog");
      return tx.unsafe(inspection.slice(inspection.indexOf(";") + 1));
    });
    const managedSource = await readFile(
      new URL(
        "scripts/financial-executor-homologation/managed-catalog.sql",
        root
      ),
      "utf8"
    );
    const expectedManaged =
      "bebf2a74fa50d8f3faa54cb45175f167c39f2c8e06a16c233fab1cd8d177f704";
    expect(await installer.sql.unsafe(managedSource)).toEqual([
      { encode: expectedManaged },
    ]);
    expect(
      observed[0].observation.surface
        .filter((r: any) =>
          r.identity.startsWith("default:provider_fixture_owner:")
        )
        .map((r: any) => r.identity)
        .sort()
    ).toEqual([
      "default:provider_fixture_owner:provider_fixture:f",
      "default:provider_fixture_owner:public:S",
      "default:provider_fixture_owner:public:f",
      "default:provider_fixture_owner:public:r",
      "default:provider_fixture_owner:structr_private:f",
    ]);
    await installer.sql.begin(async tx => {
      const foundation = await boundarySource(),
        cut = foundation.indexOf("DO $closed_postflight$");
      await tx.unsafe(foundation.slice(0, cut));
      await tx.unsafe(foundation.slice(cut));
      const lifecycle = await readFile(
          new URL("drizzle/0021_financial_calculator_lifecycle.sql", root),
          "utf8"
        ),
        post = lifecycle.lastIndexOf("DO $postflight$");
      await tx.unsafe(lifecycle.slice(0, post));

      await tx.unsafe(lifecycle.slice(post));
    });
    expect(await installer.sql.unsafe(managedSource)).toEqual([
      { encode: expectedManaged },
    ]);
    const [closed] =
      await installer.sql`SELECT count(*)::int AS count FROM pg_roles WHERE rolname LIKE 'structr_calculator_%' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls`;
    expect(closed.count).toBe(3);
    const edges =
      await installer.sql`SELECT m.admin_option,m.inherit_option,m.set_option,m.member::regrole::text AS member FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname LIKE 'structr_calculator_%' ORDER BY r.rolname`;
    expect(edges).toEqual(
      Array.from({ length: 3 }, () => ({
        admin_option: true,
        inherit_option: false,
        set_option: false,
        member: "postgres",
      }))
    );
    await installer.sql.unsafe(
      "ALTER ROLE structr_calculator_login_v1 LOGIN VALID UNTIL '2000-01-01'; ALTER ROLE structr_calculator_login_v1 NOLOGIN PASSWORD NULL"
    );
  });

  it("denies actual managed view SELECT, primitives and SET ROLE as the real login", async () => {
    const caller = await lab.connectLogin();
    const [latent] =
      await caller.sql`SELECT has_table_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='extensions' AND c.relname='pg_stat_statements'),'SELECT') AS latent,has_schema_privilege(current_user,'extensions','USAGE') AS usage`;
    expect(latent).toEqual({ latent: true, usage: false });
    for (const command of [
      "SELECT * FROM extensions.pg_stat_statements",
      "SELECT * FROM extensions.pg_stat_statements_info",
      "SELECT extensions.digest('x','sha256')",
      "SELECT * FROM public.cost_codes",
      "SET ROLE structr_calculator_read_owner_v1",
      "CREATE TEMP TABLE denied(id integer)",
    ]) {
      await expect(caller.sql.unsafe(command)).rejects.toMatchObject({
        code: "42501",
      });
    }
  });
  it("refuses an existing login session once its finite opening window has expired", async () => {
    const fixture = await setupCalculatorLifecycleFixture(lab),
      caller = await lab.connectLogin();
    await caller.sql.begin("isolation level serializable", async tx => {
      await tx`SELECT structr_financial.calculator_context_v1(${JSON.stringify(fixture.contextCommand)}::jsonb)`;
    });
    await lab.admin.unsafe(
      "ALTER ROLE structr_calculator_login_v1 VALID UNTIL '2000-01-01'"
    );
    await expect(
      caller.sql.begin(
        "isolation level serializable",
        async tx =>
          tx`SELECT structr_financial.calculator_context_v1(${JSON.stringify(fixture.contextCommand)}::jsonb)`
      )
    ).rejects.toMatchObject({ code: "42501", message: "FORBIDDEN" });
  });

  it("temporarily supplies exact owner authority for non-superuser withdrawal and removes it", async () => {
    const installer = await lab.cluster.connect(
      "maintenance-withdraw",
      "postgres"
    );
    await installer.db.transaction(
      async tx => {
        await withCalculatorOwnerMaintenance(tx, async () => {
          await tx.execute(
            sql.raw(
              "REVOKE EXECUTE ON FUNCTION structr_financial.calculator_context_v1(jsonb),structr_financial.calculator_snapshot_v1(jsonb),structr_financial.calculator_create_v1(jsonb,jsonb),structr_financial.calculator_recover_v1(jsonb) FROM structr_calculator_login_v1"
            )
          );
        });
      },
      { isolationLevel: "serializable" }
    );
    const [state] =
      await installer.sql`SELECT has_function_privilege('structr_calculator_login_v1','structr_financial.calculator_context_v1(jsonb)','EXECUTE') AS execute,pg_has_role('postgres','structr_calculator_read_owner_v1','USAGE') AS inherits,pg_has_role('postgres','structr_calculator_read_owner_v1','SET') AS can_set`;
    expect(state).toEqual({ execute: false, inherits: false, can_set: false });
  });
});

describe.skipIf(!enabled)(
  "Managed compatibility refuses catalog and authority drift atomically",
  () => {
    let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>;
    beforeAll(async () => {
      lab = await startFinancialCalculatorBoundary();
      await lab.admin.unsafe(
        await readFile(
          new URL(
            "server/test-support/financial-calculator-boundary/managed-provider-fixture.sql",
            root
          ),
          "utf8"
        )
      );
    }, 60000);
    afterAll(async () => lab?.stop(), 30000);
    it("refuses a local-profile hash after the harness superuser identity is changed despite a caller marker", async () => {
      const rollback = new Error("rollback spoofed harness");
      await expect(
        lab.admin.begin(async tx => {
          await tx.unsafe(
            "SELECT set_config('calculator.owned_lab','true',true); GRANT postgres TO app_principal_runner WITH SET TRUE; UPDATE pg_authid SET rolsuper=false WHERE rolname='app_principal_runner'; SET LOCAL ROLE postgres"
          );
          await expect(
            tx.savepoint(async nested => nested.unsafe(await boundarySource()))
          ).rejects.toMatchObject({
            code: "42501",
            message: "FINANCIAL_PUBLIC_PRIVILEGE_PREFLIGHT",
          });
          throw rollback;
        })
      ).rejects.toBe(rollback);
    });
    it.each([
      ["foundation", "public", "FUNCTIONS", "EXECUTE"],
      ["foundation", "public", "TABLES", "SELECT"],
      ["foundation", "public", "SEQUENCES", "USAGE"],
      ["foundation", "structr_private", "FUNCTIONS", "EXECUTE"],
      ["lifecycle", "public", "FUNCTIONS", "EXECUTE"],
      ["lifecycle", "structr_private", "FUNCTIONS", "EXECUTE"],
      ["lifecycle", "structr_financial", "FUNCTIONS", "EXECUTE"],
      ["preflight", "public", "FUNCTIONS", "EXECUTE"],
      ["preflight", "structr_private", "FUNCTIONS", "EXECUTE"],
      ["preflight", "structr_financial", "FUNCTIONS", "EXECUTE"],
    ] as const)(
      "%s refuses unapproved nonmigrator default in %s on %s",
      async (phase, schema, kind, privilege) => {
        const rollback = new Error("rollback default counterproof");
        await expect(
          lab.admin.begin(async tx => {
            if (phase !== "foundation") {
              await tx.unsafe("SET LOCAL SESSION AUTHORIZATION postgres");
              await tx.unsafe(await boundarySource());
              await tx.unsafe("RESET SESSION AUTHORIZATION");
            }
            const lifecycle = await readFile(
              new URL("drizzle/0021_financial_calculator_lifecycle.sql", root),
              "utf8"
            );
            if (phase === "preflight") {
              await tx.unsafe("SET LOCAL SESSION AUTHORIZATION postgres");
              await tx.unsafe(lifecycle);
              await tx.unsafe("RESET SESSION AUTHORIZATION");
            }
            await tx.unsafe(
              `ALTER DEFAULT PRIVILEGES FOR ROLE provider_fixture_owner IN SCHEMA ${schema} GRANT ${privilege} ON ${kind} TO authenticated`
            );
            const candidate =
              phase === "foundation"
                ? await boundarySource()
                : phase === "lifecycle"
                  ? lifecycle
                  : await readFile(
                      new URL(
                        "scripts/financial-executor-homologation/preflight.sql",
                        root
                      ),
                      "utf8"
                    );
            await tx.unsafe("SET LOCAL SESSION AUTHORIZATION postgres");
            expect(
              await tx`SELECT current_user,session_user,rolsuper FROM pg_roles WHERE rolname=current_user`
            ).toEqual([
              {
                current_user: "postgres",
                session_user: "postgres",
                rolsuper: false,
              },
            ]);
            await expect(
              tx.savepoint(nested => nested.unsafe(candidate))
            ).rejects.toMatchObject({ code: "42501" });
            throw rollback;
          })
        ).rejects.toBe(rollback);
        const [partial] =
          await lab.admin`SELECT to_regnamespace('structr_financial') IS NOT NULL AS schema,to_regrole('structr_calculator_login_v1') IS NOT NULL AS login`;
        expect(partial).toEqual({ schema: false, login: false });
      }
    );
    it.each([
      [
        "pgcrypto missing member",
        false,
        "ALTER EXTENSION pgcrypto DROP FUNCTION extensions.gen_random_uuid()",
      ],
      [
        "pgcrypto additional member",
        false,
        "CREATE FUNCTION extensions.unapproved_member() RETURNS integer LANGUAGE sql RETURN 1; ALTER EXTENSION pgcrypto ADD FUNCTION extensions.unapproved_member()",
      ],
      [
        "pgcrypto version",
        false,
        "UPDATE pg_extension SET extversion='1.4' WHERE extname='pgcrypto'",
      ],
      [
        "pgcrypto definition",
        false,
        "CREATE OR REPLACE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql RETURN NULL::uuid",
      ],
      [
        "managed schema USAGE to PUBLIC",
        false,
        "GRANT USAGE ON SCHEMA extensions TO PUBLIC",
      ],
      [
        "managed NULL ACL routine addition",
        false,
        "CREATE FUNCTION provider_fixture.unapproved() RETURNS integer LANGUAGE sql RETURN 2",
      ],
      [
        "authorized definer bridge",
        false,
        "CREATE FUNCTION public.bridge() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog RETURN (SELECT userid FROM extensions.pg_stat_statements LIMIT 1); REVOKE ALL ON FUNCTION public.bridge() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.bridge() TO authenticated",
      ],
      [
        "managed default widened",
        false,
        "ALTER DEFAULT PRIVILEGES FOR ROLE provider_fixture_owner IN SCHEMA provider_fixture GRANT EXECUTE ON FUNCTIONS TO anon",
      ],
      [
        "global installer default",
        false,
        "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO authenticated",
      ],
      [
        "managed column grant",
        false,
        "GRANT SELECT(userid) ON extensions.pg_stat_statements TO PUBLIC",
      ],
      [
        "managed sequence grant",
        false,
        "CREATE SEQUENCE extensions.unapproved_sequence; GRANT USAGE ON SEQUENCE extensions.unapproved_sequence TO PUBLIC",
      ],
      [
        "runtime SET membership",
        true,
        "GRANT structr_calculator_read_owner_v1 TO structr_calculator_login_v1 WITH INHERIT FALSE,SET TRUE",
      ],
      [
        "incoming unauthorized admin",
        true,
        "GRANT structr_calculator_read_owner_v1 TO authenticated WITH ADMIN TRUE,INHERIT FALSE,SET FALSE",
      ],
      [
        "financial TEMP",
        true,
        "GRANT TEMPORARY ON DATABASE postgres TO structr_calculator_login_v1",
      ],
      [
        "owner table ownership",
        true,
        "ALTER TABLE public.cost_codes OWNER TO structr_calculator_read_owner_v1",
      ],
      [
        "shared authority RLS",
        true,
        "ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY",
      ],
      [
        "constraint trigger drift",
        true,
        "ALTER TABLE public.estimate_drafts DISABLE TRIGGER a1_draft_final",
      ],
      [
        "financial managed USAGE",
        true,
        "GRANT USAGE ON SCHEMA extensions TO structr_calculator_login_v1",
      ],
    ] as const)(
      "refuses %s and leaves no foundation or lifecycle",
      async (_name, afterFoundation, drift) => {
        await expect(
          lab.admin.begin(async tx => {
            if (afterFoundation) {
              await tx.unsafe("SET LOCAL SESSION AUTHORIZATION postgres");
              await tx.unsafe(await boundarySource());
              await tx.unsafe("RESET SESSION AUTHORIZATION");
            }
            await tx.unsafe(drift);
            await tx.unsafe("SET LOCAL SESSION AUTHORIZATION postgres");
            if (!afterFoundation) await tx.unsafe(await boundarySource());
            await tx.unsafe(
              await readFile(
                new URL(
                  "drizzle/0021_financial_calculator_lifecycle.sql",
                  root
                ),
                "utf8"
              )
            );
          })
        ).rejects.toMatchObject({ code: "42501" });
        const [partial] =
          await lab.admin`SELECT to_regnamespace('structr_financial') IS NOT NULL AS schema,to_regrole('structr_calculator_login_v1') IS NOT NULL AS login`;
        expect(partial).toEqual({ schema: false, login: false });
      }
    );
  }
);
