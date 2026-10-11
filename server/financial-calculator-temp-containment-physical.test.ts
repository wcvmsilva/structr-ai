import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { startFinancialCalculatorBoundary } from "./test-support/financial-calculator-boundary";
const { plan } = vi.hoisted(() => ({ plan: {} as any }));
vi.mock(
  "../docs/security/financial-executor/database-temp-containment-plan.json",
  () => ({ default: plan })
);
import { applyCalculatorDatabaseTempContainment } from "../scripts/financial-executor-homologation/temp-containment";
const root = new URL("../", import.meta.url),
  enabled =
    process.env.FINANCIAL_CALCULATOR_HOSTED_COMPATIBILITY_PHYSICAL === "1";
const sort = (x: any) =>
  x.sort((a: any, b: any) =>
    Buffer.compare(Buffer.from(a.identity), Buffer.from(b.identity))
  );
describe.skipIf(!enabled)("Exact TEMP containment transaction", () => {
  let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>,
    installer: any;
  beforeAll(async () => {
    lab = await startFinancialCalculatorBoundary();
    const approved = JSON.parse(
      await readFile(
        new URL(
          "docs/security/financial-executor/database-temp-containment-plan.json",
          root
        ),
        "utf8"
      )
    );
    for (const name of approved.recipients) {
      const [r] = await lab.admin`SELECT to_regrole(${name}) AS role`;
      if (!r.role) await lab.admin.unsafe(`CREATE ROLE "${name}" NOLOGIN`);
    }
    await lab.admin.unsafe(
      "ALTER ROLE postgres LOGIN CREATEROLE BYPASSRLS; ALTER DATABASE postgres OWNER TO postgres; GRANT ALL ON public.audit_logs TO postgres; GRANT TEMPORARY ON DATABASE postgres TO PUBLIC,app_runtime,app_denied,dashboard_user,supabase_admin"
    );
    installer = await lab.cluster.connect("temp-maintenance", "postgres");
    const source = await readFile(
      new URL(
        "scripts/financial-executor-homologation/compatibility-inspect.sql",
        root
      ),
      "utf8"
    );
    const [{ observation }] = await lab.admin.begin("read only", async tx => {
      await tx.unsafe("SET LOCAL search_path=pg_catalog");
      return tx.unsafe(source.slice(source.indexOf(";") + 1));
    });
    const before = sort(
      observation.surface
        .filter(
          (r: any) =>
            r.identity === "database:postgres" ||
            /^(role|membership|effective-database):/.test(r.identity)
        )
        .map(({ identity, definition }: any) => ({ identity, definition }))
    );
    const d = before.find(
      (r: any) => r.identity === "database:postgres"
    ).definition;
    d.acl.sort();
    d.effectiveAcl.sort();
    const after = structuredClone(before),
      a = after.find((r: any) => r.identity === "database:postgres").definition;
    a.acl[a.acl.indexOf("=Tc/postgres")] = "=c/postgres";
    for (const name of approved.recipients.filter(
      (n: string) =>
        !["postgres", "dashboard_user", "supabase_admin"].includes(n)
    )) {
      const old = a.acl.find((s: string) => s.startsWith(name + "="));
      if (!old) a.acl.push(name + "=T/postgres");
    }
    // Local synthetic existing recipients have no dashboard/supabase-admin owner
    // authority, so give these prior explicit TEMP before taking exact snapshots.
    a.acl.sort();
    a.effectiveAcl = [...a.acl];
    Object.assign(plan, approved, { before, after });
  }, 60000);
  afterAll(async () => lab?.stop(), 30000);
  it("refuses an audit failure and rolls the database ACL back exactly", async () => {
    await lab.admin.unsafe(
      "CREATE FUNCTION public.reject_temp_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEMP_AUDIT_REJECTED'; END $$; CREATE TRIGGER reject_temp_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.reject_temp_audit()"
    );
    const before =
      await lab.admin`SELECT datacl::text FROM pg_database WHERE datname='postgres'`;
    await expect(
      applyCalculatorDatabaseTempContainment(
        installer.db,
        "00000000-0000-4000-8000-000000000091"
      )
    ).rejects.toMatchObject({ cause: { message: "TEMP_AUDIT_REJECTED" } });
    expect(
      await lab.admin`SELECT datacl::text FROM pg_database WHERE datname='postgres'`
    ).toEqual(before);
    await lab.admin.unsafe(
      "DROP TRIGGER reject_temp_audit ON public.audit_logs; DROP FUNCTION public.reject_temp_audit()"
    );
  });
  it("preserves approved recipient privileges, removes PUBLIC TEMP and writes verified audit evidence", async () => {
    const id = await applyCalculatorDatabaseTempContainment(
      installer.db,
      "00000000-0000-4000-8000-000000000092"
    );
    const [audit] =
      await lab.admin`SELECT old_values,new_values FROM public.audit_logs WHERE id=${id}::uuid`;
    expect(audit.old_values.snapshot).toEqual(plan.before);
    expect(audit.new_values.snapshot).toEqual(plan.after);
    await lab.admin.unsafe(
      "CREATE ROLE structr_calculator_login_v1 NOLOGIN NOINHERIT"
    );
    const [finance] =
      await lab.admin`SELECT has_database_privilege('structr_calculator_login_v1','postgres','TEMPORARY') AS temp`;
    expect(finance.temp).toBe(false);
    await expect(
      applyCalculatorDatabaseTempContainment(
        installer.db,
        "00000000-0000-4000-8000-000000000093"
      )
    ).rejects.toThrow("TEMP_BEFORE_DRIFT");
  });
});
