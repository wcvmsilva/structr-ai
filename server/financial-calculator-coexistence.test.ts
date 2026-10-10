/** SQL compatibility after 0020/21. Claims are a local fixture, not an HTTP/JWT proof. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { startFinancialCalculatorBoundary } from "./test-support/financial-calculator-boundary";
import { formationCommand } from "./test-support/adr002-intake-formation-fixtures";

describe.skipIf(process.env.FINANCIAL_CALCULATOR_LIFECYCLE_PHYSICAL !== "1")(
  "IF-1/SWR-1 coexist after the closed Calculator installation",
  () => {
    let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>;
    const actor = {
      id: randomUUID(),
      tenant: randomUUID(),
      sub: randomUUID(),
      session: randomUUID(),
    };
    const input = formationCommand(actor);
    let formed: { id: string; projectId: string };
    beforeAll(async () => {
      lab = await startFinancialCalculatorBoundary();
      await lab.install();
      await lab.admin.begin(async tx =>
        tx.unsafe(
          await readFile(
            new URL(
              "../drizzle/0021_financial_calculator_lifecycle.sql",
              import.meta.url
            ),
            "utf8"
          )
        )
      );
      await lab.admin`insert into structr_private.authenticated_boundary_config(id,issuer,audience) values(true,'https://coexistence.example.invalid/auth/v1','authenticated')`;
      await lab.admin`insert into public.tenants(id,name,slug) values(${actor.tenant},'Synthetic coexistence tenant',${`coexistence-${actor.tenant}`})`;
      await lab.admin`insert into public.profiles(id,tenant_id,external_open_id,role,is_active) values(${actor.id},${actor.tenant},${actor.sub},'admin',true)`;
    }, 30000);
    afterAll(async () => lab?.stop());
    const boundary = async () => {
      const [r] =
        await lab.admin`select has_function_privilege('authenticated','public.structr_intake_create_v1(text)','EXECUTE') as intake,
      has_function_privilege('authenticated','public.structr_scope_workspace_read_v1(jsonb)','EXECUTE') as scope,
      has_function_privilege('authenticated','structr_financial.calculator_create_v1(jsonb,jsonb)','EXECUTE') as financial,
      (select rolcanlogin from pg_roles where rolname='structr_calculator_login_v1') as login`;
      return r;
    };
    async function rpc(which: "intake" | "scope", value: unknown) {
      return lab.admin.begin(
        "isolation level serializable read write",
        async tx => {
          // Grants exist only in this disposable transaction and are revoked before commit.
          const signatures =
            which === "intake"
              ? [
                  "public.structr_intake_create_v1(text)",
                  "structr_private.intake_create_v1(text)",
                ]
              : [
                  "public.structr_scope_workspace_read_v1(jsonb)",
                  "structr_private.scope_workspace_read_v1(jsonb)",
                ];
          for (const signature of signatures)
            await tx.unsafe(
              `grant execute on function ${signature} to authenticated`
            );
          await tx.unsafe(
            "set local session authorization authenticator; set local role authenticated"
          );
          const now = Math.floor(Date.now() / 1000),
            claims = {
              sub: actor.sub,
              session_id: actor.session,
              role: "authenticated",
              iss: "https://coexistence.example.invalid/auth/v1",
              aud: "authenticated",
              is_anonymous: false,
              iat: now,
              exp: now + 300,
            };
          await tx.unsafe(
            "select set_config('request.jwt.claims',$1,true),set_config('request.method','POST',true)",
            [JSON.stringify(claims)]
          );
          const identity = await tx.unsafe(
            "select session_user,current_user,current_setting('transaction_isolation') as isolation"
          );
          expect(identity[0]).toEqual({
            session_user: "authenticator",
            current_user: "authenticated",
            isolation: "serializable",
          });
          const rows = await tx.unsafe(
            which === "intake"
              ? "select public.structr_intake_create_v1($1::text) as result"
              : "select public.structr_scope_workspace_read_v1($1::jsonb) as result",
            [JSON.stringify(value)]
          );
          await tx.unsafe(
            "set local role none; set local session authorization default"
          );
          for (const signature of signatures)
            await tx.unsafe(
              `revoke execute on function ${signature} from authenticated`
            );
          return rows[0].result;
        }
      );
    }
    it("IF-1 still commits one formation with three complete audits and exact replay", async () => {
      expect(await boundary()).toEqual({
        intake: false,
        scope: false,
        financial: false,
        login: false,
      });
      const result = await rpc("intake", input);
      formed = result.intake;
      expect(result.context).toEqual({
        actorId: actor.id,
        tenantId: actor.tenant,
      });
      const [actual] =
        await lab.admin`select (select count(*) from public.clients)::int as clients,(select count(*) from public.projects)::int as projects,(select count(*) from public.intake_forms)::int as intakes,(select count(*) from public.audit_logs)::int as audits`;
      expect(actual).toEqual({
        clients: 1,
        projects: 1,
        intakes: 1,
        audits: 3,
      });
      const audits =
        await lab.admin`select user_id,old_values,new_values,record_id from public.audit_logs order by id`;
      for (const audit of audits) {
        expect(audit.user_id).toBe(actor.id);
        expect(audit.old_values).toBe(null);
        expect(audit.new_values.id).toBe(audit.record_id);
        expect(audit.new_values.tenantId).toBe(actor.tenant);
      }
      expect(await rpc("intake", input)).toEqual(result);
      expect(
        (await lab.admin`select count(*)::int as n from public.audit_logs`)[0].n
      ).toBe(3);
      expect(await boundary()).toEqual({
        intake: false,
        scope: false,
        financial: false,
        login: false,
      });
    });
    it("SWR-1 still reads the formed pair without business or audit writes", async () => {
      const before =
        await lab.admin`select to_jsonb(p) as row from public.projects p union all select to_jsonb(i) from public.intake_forms i union all select to_jsonb(a) from public.audit_logs a`;
      const result = await rpc("scope", {
        projectId: formed.projectId,
        intakeFormId: formed.id,
      });
      expect(result.context).toEqual({
        actorId: actor.id,
        tenantId: actor.tenant,
      });
      expect(result.project.id).toBe(formed.projectId);
      expect(result.intake.id).toBe(formed.id);
      expect(result.scopes).toEqual({ state: "notLoaded" });
      expect(result.catalog).toEqual({ state: "notLoaded" });
      const after =
        await lab.admin`select to_jsonb(p) as row from public.projects p union all select to_jsonb(i) from public.intake_forms i union all select to_jsonb(a) from public.audit_logs a`;
      expect(after).toEqual(before);
      expect(await boundary()).toEqual({
        intake: false,
        scope: false,
        financial: false,
        login: false,
      });
    });
  }
);
