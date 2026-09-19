import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { getTableColumns, getTableName } from "drizzle-orm";
import { access } from "node:fs/promises";
import {
  leads,
  leadActivities,
  deals,
  projects,
  profiles,
  auditLogs,
} from "../drizzle/schema";
import {
  startAppPrincipalPostgres,
  type AppPrincipalCluster,
} from "./test-support/app-principal-postgres";
import type { LeadScope } from "./lead-access";

const binding = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db", () => ({
  getDb: async () => binding.db,
  getRawClient: () => null,
}));
import * as leadDb from "./lead-db";
import {
  getFullPipelineState,
  getPipelineOverviewData,
  orchestrateLeadConversion,
} from "./pipeline-db";
import { leadRouter } from "./lead-router";

const id = (n: number) =>
  `ad190000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = id(1),
  B = id(2),
  USER = id(3),
  OTHER_USER = id(4),
  LEAD = id(5),
  FOREIGN = id(6),
  TEAM = id(7),
  DEAL = id(8);
const scope: LeadScope = { userId: USER, tenantId: A, via: "tenant" };

describe.skipIf(process.env.APP_PRINCIPAL_LAB !== "1")(
  "application principal — owned PostgreSQL compatibility",
  () => {
    let cluster: AppPrincipalCluster;
    let app: Awaited<ReturnType<AppPrincipalCluster["connect"]>>;
    let denied: Awaited<ReturnType<AppPrincipalCluster["connect"]>>;
    const observer = () => cluster.observer.sql;
    beforeAll(async () => {
      cluster = await startAppPrincipalPostgres(postgres);
      // Explicit lab DDL: only physical columns, UUID defaults and primary keys needed
      // by these real helpers. This is not a restore, migration or production RLS model.
      for (const table of [
        leads,
        leadActivities,
        deals,
        projects,
        profiles,
        auditLogs,
      ]) {
        const columns = Object.values(getTableColumns(table)).map(column => {
          const suffix =
            column.name === "id"
              ? " PRIMARY KEY DEFAULT gen_random_uuid()"
              : ["created_at", "updated_at"].includes(column.name)
                ? " DEFAULT now()"
                : "";
          return `"${column.name}" ${column.getSQLType()}${suffix}`;
        });
        await observer().unsafe(
          `CREATE TABLE public."${getTableName(table)}" (${columns.join(",")})`
        );
      }
      await observer().unsafe(`
      GRANT SELECT ON public.leads,public.lead_activities,public.deals,public.projects,public.profiles TO app_runtime;
      GRANT INSERT ON public.lead_activities,public.audit_logs TO app_runtime;
      GRANT SELECT ON public.audit_logs TO app_runtime;
    `);
      app = await cluster.connect("runtime");
      denied = await cluster.connect("denied", "app_denied");
      const [role] =
        await app.sql`SELECT current_user, session_user, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit FROM pg_roles WHERE rolname=current_user`;
      console.log("APP_PRINCIPAL_ROLE", JSON.stringify(role));
    }, 60_000);
    beforeEach(async () => {
      vi.stubEnv("TENANT_STRICT", "true");
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("SCHEMA_DIAGNOSTICS", "true");
      binding.db = app.db;
      await observer().unsafe(
        "ALTER TABLE public.leads DISABLE ROW LEVEL SECURITY; GRANT INSERT ON public.audit_logs TO app_runtime; TRUNCATE public.leads,public.lead_activities,public.deals,public.projects,public.profiles,public.audit_logs"
      );
      await observer()`INSERT INTO public.profiles(id,tenant_id,role,is_active,full_name) VALUES(${USER},${A},'admin',true,'Synthetic A'),(${OTHER_USER},${B},'user',true,'Synthetic B')`;
      await observer()`INSERT INTO public.leads(id,tenant_id,owner_user_id,name,status) VALUES(${LEAD},${A},${USER},'Synthetic A','new'),(${TEAM},${A},${OTHER_USER},'Synthetic teammate','qualified'),(${FOREIGN},${B},${OTHER_USER},'Synthetic B','new')`;
      await observer()`INSERT INTO public.lead_activities(lead_id,activity_type,description) VALUES(${LEAD},'note','Synthetic A note'),(${FOREIGN},'note','Synthetic B note')`;
      await observer()`INSERT INTO public.deals(id,tenant_id,lead_id,name,stage,value) VALUES(${DEAL},${A},${LEAD},'Synthetic deal A','discovery',10),(${id(9)},${B},${FOREIGN},'Synthetic deal B','won',99)`;
      await observer()`INSERT INTO public.projects(id,tenant_id,name,status) VALUES(${id(10)},${A},'Synthetic project A','intake'),(${id(11)},${B},'Synthetic project B','intake')`;
    });
    afterAll(async () => {
      binding.db = null;
      vi.unstubAllEnvs();
      if (cluster) {
        await cluster.stop();
        await expect(access(cluster.directory)).rejects.toMatchObject({
          code: "ENOENT",
        });
        console.log(
          "APP_PRINCIPAL_CLEANUP",
          "owned cluster stopped and removed"
        );
      }
    }, 20_000);
    it("uses an unprivileged non-owner login with no memberships", async () => {
      const [role] =
        await app.sql`SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit FROM pg_roles WHERE rolname=current_user`;
      expect(role).toEqual({
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolinherit: false,
      });
      expect(
        await app.sql`SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)`
      ).toHaveLength(0);
      expect(
        await app.sql`SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`
      ).toHaveLength(0);
    });
    it.each([
      "SET ROLE postgres",
      "SET ROLE app_principal_runner",
      "CREATE TABLE public.forbidden(id int)",
      "DELETE FROM public.leads",
      "UPDATE public.profiles SET role='admin'",
    ])("refuses privilege beyond the recipe: %s", async command => {
      await expect(app.sql.unsafe(command)).rejects.toMatchObject({
        code: "42501",
      });
    });
    it("cannot delegate table privileges without grant option", async () => {
      // PostgreSQL emits a warning rather than an error for this unsuccessful GRANT.
      await app.sql.unsafe("GRANT SELECT ON public.leads TO app_denied");
      const [permission] =
        await observer()`SELECT has_table_privilege('app_denied','public.leads','SELECT') AS allowed`;
      expect(permission.allowed).toBe(false);
      await expect(
        denied.sql`SELECT * FROM public.leads`
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("lists only the authoritative tenant without switching roles", async () => {
      expect((await leadDb.listLeads(scope)).map(row => row.id).sort()).toEqual(
        [LEAD, TEAM].sort()
      );
    });
    it("preserves optional owner narrowing", async () => {
      expect(
        (await leadDb.listLeads({ ...scope, via: "owner" })).map(row => row.id)
      ).toEqual([LEAD]);
    });
    it("reads own lead and refuses foreign lead under the same login", async () => {
      await expect(leadDb.getLeadById(LEAD, scope)).resolves.toMatchObject({
        id: LEAD,
      });
      await expect(leadDb.getLeadById(FOREIGN, scope)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
    it("searches with tenant predicates executed by PostgreSQL", async () => {
      expect(
        (await leadDb.searchLeads("Synthetic", scope)).map(row => row.id).sort()
      ).toEqual([LEAD, TEAM].sort());
    });
    it("scopes both aggregate queries", async () => {
      const result = await leadDb.getLeadStats(scope);
      expect(Number(result.total)).toBe(2);
      expect(Number(result.byStatus.new)).toBe(1);
      expect(Number(result.byStatus.qualified)).toBe(1);
    });
    it("reads own activities but never returns foreign activity text", async () => {
      expect(
        (await leadDb.getLeadActivities(LEAD, scope)).map(
          row => row.description
        )
      ).toEqual(["Synthetic A note"]);
      expect(await leadDb.getLeadActivities(FOREIGN, scope)).toEqual([]);
    });
    it("records own activity with durable audit on the same transaction", async () => {
      const result = await leadDb.addLeadActivity(
        {
          leadId: LEAD,
          activityType: "note",
          description: "Synthetic new note",
        },
        scope
      );
      expect(
        await observer()`SELECT id FROM public.lead_activities WHERE id=${result}`
      ).toHaveLength(1);
      const [audit] =
        await observer()`SELECT user_id,record_id,new_values FROM public.audit_logs WHERE action='lead.activity_created'`;
      expect(audit).toMatchObject({
        user_id: USER,
        record_id: result,
        new_values: { leadId: LEAD, description: "Synthetic new note" },
      });
    });
    it("refuses foreign activity insertion with no side effects", async () => {
      await expect(
        leadDb.addLeadActivity(
          { leadId: FOREIGN, activityType: "note", description: "No write" },
          scope
        )
      ).rejects.toThrow("Lead not found");
      expect(
        await observer()`SELECT id FROM public.lead_activities WHERE description='No write'`
      ).toHaveLength(0);
    });
    it("rolls back the activity if audit INSERT permission is absent", async () => {
      await observer().unsafe(
        "REVOKE INSERT ON public.audit_logs FROM app_runtime"
      );
      await expect(
        leadDb.addLeadActivity(
          { leadId: LEAD, activityType: "note", description: "Must rollback" },
          scope
        )
      ).rejects.toMatchObject({
        cause: {
          code: "42501",
          message: "permission denied for table audit_logs",
        },
      });
      expect(
        await observer()`SELECT id FROM public.lead_activities WHERE description='Must rollback'`
      ).toHaveLength(0);
    });
    it("rejects missing actor instead of using payload owner as authentication", async () => {
      await expect(
        leadDb.createLead({
          name: "No actor",
          tenantId: A,
          ownerUserId: USER,
        } as any)
      ).rejects.toMatchObject({ code: "PROFILE_NOT_ALLOWED" });
    });
    it.each(["create", "update", "pipeline"] as const)(
      "records the unresolved authenticated-role boundary for %s without a privileged retry",
      async operation => {
        const action =
          operation === "create"
            ? () =>
                leadDb.createLead(
                  {
                    name: "Blocked writer",
                    tenantId: A,
                    ownerUserId: USER,
                  } as any,
                  USER
                )
            : operation === "update"
              ? () =>
                  leadDb.updateLead(LEAD, { notes: "Blocked writer" }, scope)
              : () => orchestrateLeadConversion(LEAD, USER, A);
        await expect(action()).rejects.toMatchObject({
          cause: {
            code: "42501",
            message: 'permission denied to set role "authenticated"',
          },
        });
        expect(
          await observer()`SELECT id FROM public.leads WHERE name='Blocked writer' OR notes='Blocked writer'`
        ).toHaveLength(0);
        const [identity] = await app.sql`SELECT current_user, session_user`;
        expect(identity).toEqual({
          current_user: "app_runtime",
          session_user: "app_runtime",
        });
      }
    );
    it("reads pipeline state and aggregate only inside the tenant", async () => {
      await expect(getFullPipelineState(DEAL, A)).resolves.toMatchObject({
        deal: { id: DEAL },
        lead: { id: LEAD },
      });
      expect(await getFullPipelineState(id(9), A)).toBeNull();
      expect((await getPipelineOverviewData(A)).summary).toMatchObject({
        totalLeads: 2,
        totalDeals: 1,
        totalProjects: 1,
      });
    });
    it("performs opt-in diagnostic catalog reads without privilege elevation", async () => {
      const result = await leadRouter
        .createCaller({
          user: { id: USER, tenantId: A, role: "admin" },
          tenantId: A,
          req: {},
          res: {},
        } as any)
        .diagSchema();
      expect(result).toMatchObject({
        schemaDiagnostics: "enabled",
        profilesSample: [{ id: USER }],
      });
    });
    it("fails closed on missing table grants", async () => {
      binding.db = denied.db;
      await expect(leadDb.listLeads(scope)).rejects.toThrow();
    });
    it("does not bypass RLS when policies deny every row", async () => {
      await observer().unsafe(
        "ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY"
      );
      expect(await leadDb.listLeads(scope)).toEqual([]);
      await expect(
        leadDb.addLeadActivity(
          { leadId: LEAD, activityType: "note", description: "RLS blocked" },
          scope
        )
      ).rejects.toThrow("Lead not found");
    });
  }
);
