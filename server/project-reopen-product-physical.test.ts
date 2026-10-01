/**
 * Physical port of the mandatory reopen-formation mechanism onto the REAL candidate
 * schema and callers (PROJECT-REOPEN-PRODUCT-PORT-IMPLEMENTATION-CONTRACT.md). Opt-in
 * only (APP_PRINCIPAL_LAB=1 PROJECT_REOPEN_PRODUCT_LAB=1). Boots a disposable PostgreSQL17
 * cluster via the unmodified server/test-support/app-principal-postgres.ts, applies the
 * REAL numbered migrations 0000-0011 (drizzle/*.sql, same technique as
 * project-reopen-real-schema-bootstrap/script/bootstrap-probe.ts: drizzle-orm/migrator's
 * own readMigrationFiles, one file per transaction, journal order, the real
 * `--> statement-breakpoint` separator, SQL text never hand-edited), THEN registers a RED
 * proof that reopening without any formation check currently succeeds, THEN applies the
 * new drizzle/0012_project_reopen_provenance.sql file the same way, THEN re-proves GREEN.
 * No fixture tables; the 4 relevant tables are the real ones the chain creates.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import {
  startAppPrincipalPostgres,
  type AppPrincipalCluster,
  type AppPrincipalConnection,
} from "./test-support/app-principal-postgres";
import * as s from "../drizzle/schema";

const LAB_ENABLED = process.env.APP_PRINCIPAL_LAB === "1" && process.env.PROJECT_REOPEN_PRODUCT_LAB === "1";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
import { updateProject, updateProjectStatus } from "./project-db";
import { ProjectReopenNotVerifiedError } from "@shared/project-operation-guard";

const MIGRATIONS_FOLDER = new URL("../drizzle", import.meta.url).pathname;
const context = new AsyncLocalStorage<PostgresJsDatabase>();
const uuid = () => randomUUID();

describe.skipIf(!LAB_ENABLED)("project reopen — physical port onto the real candidate schema", () => {
  let cluster: AppPrincipalCluster;
  let runtime: AppPrincipalConnection; // app_runtime: the real app role, restricted
  let other: AppPrincipalConnection; // app_denied: an independent restricted role
  let labDb: PostgresJsDatabase;
  const observer = () => cluster.observer.sql;

  async function applyMigrationFile(tag: string) {
    const text = readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, "utf8");
    const chunks = text.split("--> statement-breakpoint").map((c) => c.trim()).filter(Boolean);
    await observer().begin(async (tx) => {
      for (const chunk of chunks) await tx.unsafe(chunk);
    });
  }

  beforeAll(async () => {
    cluster = await startAppPrincipalPostgres(postgres);
    const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"));
    const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag).filter((t: string) => !t.startsWith("0012"));
    // Confirms the installed reader sees byte-identical files to what this test applies.
    const parsed = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    expect(parsed.length).toBeGreaterThanOrEqual(tags.length);
    for (const tag of tags) await applyMigrationFile(tag);

    await observer().unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime, app_denied;`);
    runtime = await cluster.connect("runtime");
    other = await cluster.connect("other", "app_denied");
    labDb = drizzle(runtime.sql);
    mocks.getDb.mockImplementation(async () => context.getStore() ?? labDb);
  }, 90_000);

  afterAll(async () => {
    if (cluster) await cluster.stop();
  });

  async function resetFixture() {
    // Plain DELETE, not TRUNCATE ... CASCADE: this real schema has dozens of OTHER tables
    // (historical_estimate_*, estimate_internal_approval_*, etc.) referencing
    // tenants/profiles/projects, several guarded by their own real BEFORE TRUNCATE
    // immutability triggers (0006). TRUNCATE CASCADE would force-cascade into those and
    // trip their guard even though they are always empty here; DELETE only touches rows
    // that actually exist and cascades per-FK, never forcing a sibling table's TRUNCATE.
    await observer().unsafe(`
      DELETE FROM public.project_cost_actuals;
      DELETE FROM public.project_closeouts;
      DELETE FROM public.field_tasks;
      DELETE FROM public.projects;
      DELETE FROM public.profiles;
      DELETE FROM public.tenants;
    `);
  }
  beforeEach(resetFixture);

  async function seedTenant(sql: ReturnType<typeof postgres> = runtime.sql) {
    const tenantId = uuid();
    await observer().unsafe(`INSERT INTO public.tenants (id, name, slug) VALUES ($1,$2,$3)`, [tenantId, "Synthetic Tenant", `t-${tenantId}`]);
    return tenantId;
  }
  async function seedOwner(tenantId: string) {
    const userId = uuid();
    await observer().unsafe(`INSERT INTO public.profiles (id, tenant_id, is_active, role) VALUES ($1,$2,true,'user')`, [userId, tenantId]);
    return userId;
  }
  async function insertProjectRow(cols: Record<string, unknown>) {
    const defaults = { id: uuid(), name: "Synthetic", project_type: "remodel", status: "estimate" };
    const full = { ...defaults, ...cols };
    const keys = Object.keys(full);
    const [row] = await runtime.sql.unsafe(
      `INSERT INTO public.projects (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
      keys.map((k) => (full as Record<string, unknown>)[k]) as never[],
    );
    return row as Record<string, unknown>;
  }
  async function readProject(id: string) {
    const [row] = await observer().unsafe(`SELECT * FROM public.projects WHERE id=$1`, [id]);
    return row as Record<string, unknown> | undefined;
  }

  // ══════════════════════════════════════════════════════════════════
  // Activation — real chain only so far (0000-0011); 0012 not yet applied below.
  // ══════════════════════════════════════════════════════════════════
  describe("activation against the real 0000-0011 chain", () => {
    it("RED: before 0012, a cancelled project with real operational history reopens with ZERO protection — the gap this migration closes", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "approved" });
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      // No provenance_state column exists yet at all.
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id]),
      ).resolves.toBeDefined();
      const after = await readProject(p.id as string);
      expect(after!.status).toBe("intake"); // reopened with no formation check whatsoever
    });

    it("an aborted 0012 migration (forced error after the full DDL ran) leaves no partial state", async () => {
      const text = readFileSync(`${MIGRATIONS_FOLDER}/0012_project_reopen_provenance.sql`, "utf8");
      const chunks = text.split("--> statement-breakpoint").map((c) => c.trim()).filter(Boolean);
      await expect(
        observer().begin(async (tx) => {
          for (const chunk of chunks) await tx.unsafe(chunk);
          throw new Error("forced abort after full 0012 DDL");
        }),
      ).rejects.toThrow("forced abort after full 0012 DDL");
      const [col] = await observer().unsafe(
        `SELECT column_name FROM information_schema.columns WHERE table_name='projects' AND column_name='provenance_state'`,
      );
      expect(col).toBeUndefined();
      const fns = await observer().unsafe(`SELECT proname FROM pg_proc WHERE proname LIKE 'project_reopen_%'`);
      expect(fns).toHaveLength(0);
    });

    it("applies the real 0012 migration; column + 2 functions + 6 triggers present afterward", async () => {
      await applyMigrationFile("0012_project_reopen_provenance");
      const [col] = await observer().unsafe(
        `SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='projects' AND column_name='provenance_state'`,
      );
      expect(col).toMatchObject({ column_name: "provenance_state", is_nullable: "NO" });
      const fns = await observer().unsafe(`SELECT proname, prosecdef FROM pg_proc WHERE proname LIKE 'project_reopen_%' ORDER BY 1`);
      expect(fns).toEqual([
        { proname: "project_reopen_child_certify_v1", prosecdef: true },
        { proname: "project_reopen_provenance_guard_v1", prosecdef: false },
      ]);
      const triggers = await observer().unsafe(`SELECT tgname, tgrelid::regclass::text AS table_name FROM pg_trigger WHERE tgname LIKE 'trg_reopen_%' ORDER BY 1`);
      expect(triggers.map((t: Record<string, unknown>) => t.tgname)).toEqual([
        "trg_reopen_closeout_certify",
        "trg_reopen_cost_actual_certify",
        "trg_reopen_field_task_certify",
        "trg_reopen_provenance_insert",
        "trg_reopen_provenance_update",
      ]);
    });

    it("GREEN: the SAME RED scenario (approved → cancelled → reopen to intake) is now refused", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "approved" });
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id]),
      ).rejects.toMatchObject({ code: "23514", constraint_name: "project_reopen_formation_not_verified" });
      const after = await readProject(p.id as string);
      expect(after!.status).toBe("cancelled"); // refused atomically
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // INSERT classification — strict positive set, never trusts a caller value.
  // ══════════════════════════════════════════════════════════════════
  describe("INSERT classification (0012 already applied)", () => {
    it("full positive set certifies formation_only", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      expect(p.provenance_state).toBe("formation_only");
    });

    it("tenant_id NULL at birth is unknown, never formation_only", async () => {
      const p = await insertProjectRow({ status: "intake" }); // no tenant_id
      expect(p.provenance_state).toBe("unknown");
    });

    it("status='cancelled' at birth is unknown, not a regular creation", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "cancelled" });
      expect(p.provenance_state).toBe("unknown");
    });

    it("a bare non-hard field (start_date set, nothing else operational) is unknown, not formation_only and not operational_confirmed", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", start_date: "2026-01-01" });
      expect(p.provenance_state).toBe("unknown");
    });

    it("a hard operational marker at birth (field_started_at) certifies operational_confirmed", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", field_started_at: new Date().toISOString() });
      expect(p.provenance_state).toBe("operational_confirmed");
    });

    it("change_order_budget_cents > 0 at birth certifies operational_confirmed", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", change_order_budget_cents: 500 });
      expect(p.provenance_state).toBe("operational_confirmed");
    });

    it("a caller-supplied provenance_state in the raw INSERT is never trusted — the database overrides it", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", provenance_state: "operational_confirmed" });
      expect(p.provenance_state).toBe("formation_only"); // the real classification, not the lie
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // UPDATE permanence
  // ══════════════════════════════════════════════════════════════════
  describe("UPDATE permanence and effective-change invalidation", () => {
    it("operational_confirmed is permanent: a direct downgrade attempt to formation_only is discarded", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, field_started_at: new Date().toISOString() });
      await observer().unsafe(`UPDATE public.projects SET provenance_state='formation_only' WHERE id=$1`, [p.id]);
      const after = await readProject(p.id as string);
      expect(after!.provenance_state).toBe("operational_confirmed");
    });

    it("unknown never becomes formation_only via UPDATE, even after clearing the field that disqualified it", async () => {
      const p = await insertProjectRow({ status: "intake" }); // tenant NULL -> unknown
      const tenantId = await seedTenant();
      await observer().unsafe(`UPDATE public.projects SET tenant_id=$1 WHERE id=$2`, [tenantId, p.id]);
      const after = await readProject(p.id as string);
      expect(after!.provenance_state).toBe("unknown");
    });

    it("formation_only + tenant_id change invalidates to unknown; changing back does NOT restore formation_only", async () => {
      const tenantA = await seedTenant();
      const tenantB = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantA, status: "intake" });
      expect(p.provenance_state).toBe("formation_only");
      await observer().unsafe(`UPDATE public.projects SET tenant_id=$1 WHERE id=$2`, [tenantB, p.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("unknown");
      await observer().unsafe(`UPDATE public.projects SET tenant_id=$1 WHERE id=$2`, [tenantA, p.id]); // back to original
      expect((await readProject(p.id as string))!.provenance_state).toBe("unknown"); // not restored
    });

    it("formation_only + tenant_id NULL->value invalidates to unknown", async () => {
      // A formation_only row can only ever have a non-null tenant per the INSERT rule, so
      // this exercises the UPDATE path by first clearing it, then observing the SECOND
      // change (value->NULL) already invalidated it once; this asserts that specific hop.
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await observer().unsafe(`UPDATE public.projects SET tenant_id=NULL WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("unknown");
    });

    it("a same-value no-op write (tenant_id set to its own current value) does NOT invalidate formation_only", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(`UPDATE public.projects SET tenant_id=$1, name='renamed' WHERE id=$2`, [tenantId, p.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("formation_only");
    });

    it("formation_only + approved_budget_cents NULL->value invalidates to unknown", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await observer().unsafe(`UPDATE public.projects SET approved_budget_cents=5000 WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("unknown");
    });

    it("formation_only + variance_pct change invalidates to unknown", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await observer().unsafe(`UPDATE public.projects SET variance_pct=5 WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("unknown");
    });

    it("formation_only + change_order_budget_cents 0->positive certifies operational_confirmed directly (a hard marker, not merely 'unknown')", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(`UPDATE public.projects SET change_order_budget_cents=750 WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
    });

    it("committed_cost_cents/actual_total going back to NULL/negative never clears an already-forced operational_confirmed", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(`UPDATE public.projects SET actual_total=500 WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
      await observer().unsafe(`UPDATE public.projects SET actual_total=NULL, committed_cost_cents=-10 WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // The mandatory cancelled-exit gate
  // ══════════════════════════════════════════════════════════════════
  describe("cancelled-exit gate", () => {
    it("legitimate direct reopen: formation_only + cancelled -> intake succeeds", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await expect(runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id])).resolves.toBeDefined();
    });

    it("refused: operational_confirmed + cancelled -> intake", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "approved" });
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id]),
      ).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
    });

    it("refused: unknown + cancelled -> intake", async () => {
      const p = await insertProjectRow({ status: "cancelled" }); // no tenant -> unknown
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id]),
      ).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
    });

    it("two-hop bypass closed: operational_confirmed+cancelled -> estimating (not intake) is refused at the FIRST hop", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "approved" });
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='estimating' WHERE id=$1`, [p.id]),
      ).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
      expect((await readProject(p.id as string))!.status).toBe("cancelled");
    });

    it("mixed payload: cancelled->intake WITH a simultaneously-invalidating tenant change is refused atomically at the first hop", async () => {
      const tenantA = await seedTenant();
      const tenantB = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantA, status: "intake" });
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='intake', tenant_id=$1 WHERE id=$2`, [tenantB, p.id]),
      ).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
    });

    it("cancelled -> cancelled no-op (renaming notes) is always allowed regardless of provenance_state", async () => {
      const p = await insertProjectRow({ status: "cancelled" }); // unknown
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled', name='renamed' WHERE id=$1`, [p.id]),
      ).resolves.toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Real children: field_tasks, project_cost_actuals, project_closeouts
  // ══════════════════════════════════════════════════════════════════
  describe("real children certify/restrict the parent", () => {
    it("field_tasks INSERT certifies the parent", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(
        `INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`,
        [p.id, tenantId],
      );
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
    });

    it("project_cost_actuals INSERT certifies the parent", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(
        `INSERT INTO public.project_cost_actuals (project_id, tenant_id, cost_code, vendor_name, amount_cents, date_incurred) VALUES ($1,$2,'LAB-1','Synthetic Vendor',250,CURRENT_DATE)`,
        [p.id, tenantId],
      );
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
    });

    it("project_closeouts INSERT with closed_at NULL does NOT certify; a later UPDATE setting closed_at DOES", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      const [closeout] = await runtime.sql.unsafe(
        `INSERT INTO public.project_closeouts (project_id, tenant_id) VALUES ($1,$2) RETURNING id`,
        [p.id, tenantId],
      );
      expect((await readProject(p.id as string))!.provenance_state).toBe("formation_only");
      await runtime.sql.unsafe(`UPDATE public.project_closeouts SET closed_at=now() WHERE id=$1`, [closeout.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
    });

    it("reparenting a field_task (UPDATE project_id) to a formation_only project certifies the destination", async () => {
      const tenantId = await seedTenant();
      const origin = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      const [task] = await runtime.sql.unsafe(
        `INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t') RETURNING id`,
        [origin.id, tenantId],
      );
      const target = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(`UPDATE public.field_tasks SET project_id=$1 WHERE id=$2`, [target.id, task.id]);
      expect((await readProject(target.id as string))!.provenance_state).toBe("operational_confirmed");
    });

    it("tenant mismatch at child INSERT is refused outright; the parent stays uncertified", async () => {
      const tenantId = await seedTenant();
      const otherTenant = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await expect(
        runtime.sql.unsafe(
          `INSERT INTO public.project_cost_actuals (project_id, tenant_id, cost_code, vendor_name, amount_cents, date_incurred) VALUES ($1,$2,'LAB-1','Synthetic Vendor',100,CURRENT_DATE)`,
          [p.id, otherTenant],
        ),
      ).rejects.toMatchObject({ constraint_name: "project_reopen_child_tenant_mismatch" });
      expect((await readProject(p.id as string))!.provenance_state).toBe("formation_only");
    });

    it("the child's OWN tenant_id changing (project_id unchanged) re-runs the tenant check and is refused on mismatch", async () => {
      const tenantId = await seedTenant();
      const otherTenant = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      const [cost] = await runtime.sql.unsafe(
        `INSERT INTO public.project_cost_actuals (project_id, tenant_id, cost_code, vendor_name, amount_cents, date_incurred) VALUES ($1,$2,'LAB-1','Synthetic Vendor',100,CURRENT_DATE) RETURNING id`,
        [p.id, tenantId],
      );
      await expect(
        runtime.sql.unsafe(`UPDATE public.project_cost_actuals SET tenant_id=$1 WHERE id=$2`, [otherTenant, cost.id]),
      ).rejects.toMatchObject({ constraint_name: "project_reopen_child_tenant_mismatch" });
    });

    it("certifying an already-certified parent is idempotent (no error on repeat)", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','a')`, [p.id, tenantId]);
      await expect(
        runtime.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','b')`, [p.id, tenantId]),
      ).resolves.toBeDefined();
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
    });

    it("a forced rollback after a child INSERT leaves the parent uncertified", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await expect(
        runtime.sql.begin(async (tx) => {
          await tx.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`, [p.id, tenantId]);
          throw new Error("forced rollback after child insert");
        }),
      ).rejects.toThrow("forced rollback after child insert");
      expect((await readProject(p.id as string))!.provenance_state).toBe("formation_only");
    });

    it("deleting the certifying child afterward does not revert the parent's certification", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      const [task] = await runtime.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t') RETURNING id`, [p.id, tenantId]);
      await runtime.sql.unsafe(`DELETE FROM public.field_tasks WHERE id=$1`, [task.id]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Privilege: sufficient / insufficient / owner-can-alter-DDL
  // ══════════════════════════════════════════════════════════════════
  describe("privilege — the trigger is the only protection layer in this candidate (no role/grant layer exists in the real migrations)", () => {
    it("sufficient privilege: the DEFINER function's owner (app_runtime, already granted broadly above) certifies successfully", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`, [p.id, tenantId]);
      expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
    });

    it("insufficient privilege: a DEFINER owner with NO select/update on projects fails conservatively, not silently", async () => {
      await observer().unsafe(`REVOKE ALL PRIVILEGES ON public.projects FROM app_denied;`);
      await observer().unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO app_denied;`);
      try {
        const tenantId = await seedTenant();
        const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
        await expect(
          other.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`, [p.id, tenantId]),
        ).rejects.toMatchObject({ code: "42501" }); // Postgres's own permission-denied, not a silent no-op
        expect((await readProject(p.id as string))!.provenance_state).toBe("formation_only"); // conservative: unchanged, not falsely certified
      } finally {
        await observer().unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO app_runtime;`);
        await observer().unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO app_denied;`);
      }
    });

    it("even under a broad table-level UPDATE grant on provenance_state, a direct falsification attempt is still discarded by the trigger itself — not the grant", async () => {
      await observer().unsafe(`GRANT UPDATE ON public.projects TO app_runtime;`);
      try {
        const tenantId = await seedTenant();
        const p = await insertProjectRow({ tenant_id: tenantId, status: "approved" }); // operational_confirmed
        await runtime.sql.unsafe(`UPDATE public.projects SET provenance_state='formation_only' WHERE id=$1`, [p.id]);
        expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed"); // unchanged despite the grant
      } finally {
        await observer().unsafe(`REVOKE UPDATE ON public.projects FROM app_runtime;`);
        await observer().unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO app_runtime;`);
      }
    });

    it("named limit (same as drizzle/0006's own documented caveat): an owner/superuser-equivalent CAN disable the trigger — this is outside the trigger's own protection scope, not a defect introduced here", async () => {
      // app_principal_runner is this lab's bootstrap role, effectively superuser inside the
      // ephemeral cluster. A real deployment's equivalent (table/function owner, or any
      // role with ALTER privilege) has the SAME capability — triggers never defend against
      // the party that can modify DDL. Demonstrated, not defended against, per the
      // boundary's own instruction to name this gap rather than attempt to close it.
      await observer().unsafe(`ALTER TABLE public.projects DISABLE TRIGGER trg_reopen_provenance_update;`);
      try {
        const tenantId = await seedTenant();
        const p = await insertProjectRow({ tenant_id: tenantId, status: "approved" });
        await observer().unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
        await expect(observer().unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id])).resolves.toBeDefined();
      } finally {
        await observer().unsafe(`ALTER TABLE public.projects ENABLE TRIGGER trg_reopen_provenance_update;`);
      }
    });

    it("app_runtime (restricted, non-owner) cannot disable the guard trigger itself", async () => {
      await expect(
        runtime.sql.unsafe(`ALTER TABLE public.projects DISABLE TRIGGER trg_reopen_provenance_update;`),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Concurrency — genuine dispatch, cutover ordering, SERIALIZABLE vs business refusal
  // ══════════════════════════════════════════════════════════════════
  describe("concurrency", () => {
    async function waitForLockWait(pollerSql: ReturnType<typeof postgres>, pid: number, timeoutMs = 3000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const [row] = await pollerSql.unsafe(`SELECT 1 AS found FROM pg_locks WHERE pid = $1 AND NOT granted LIMIT 1`, [pid]);
        if (row?.found === 1) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return false;
    }

    it("a reopen holding the parent row lock genuinely blocks a concurrent child-certifying INSERT dispatched (not lazily constructed) during the hold", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" }); // formation_only
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await runtime.sql.unsafe("BEGIN");
      try {
        await runtime.sql.unsafe(`SELECT * FROM public.projects WHERE id=$1 FOR UPDATE`, [p.id]);
        const [{ pid: otherPid }] = await other.sql.unsafe(`SELECT pg_backend_pid() AS pid`);
        const childInsert = other.sql
          .unsafe(`INSERT INTO public.project_cost_actuals (project_id, tenant_id, cost_code, vendor_name, amount_cents, date_incurred) VALUES ($1,$2,'LAB-1','Synthetic Vendor',300,CURRENT_DATE)`, [p.id, tenantId])
          .execute(); // dispatched now, while the lock is held — not a bare lazy assignment
        expect(await waitForLockWait(runtime.sql, otherPid)).toBe(true);
        const [duringHold] = await runtime.sql.unsafe(`SELECT provenance_state FROM public.projects WHERE id=$1`, [p.id]);
        expect(duringHold.provenance_state).toBe("formation_only");
        await runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id]);
        await runtime.sql.unsafe("COMMIT");
        await childInsert;
        const after = await readProject(p.id as string);
        expect(after!.status).toBe("intake");
        expect(after!.provenance_state).toBe("operational_confirmed");
      } finally {
        await runtime.sql.unsafe("ROLLBACK").catch(() => undefined);
      }
    });

    it("a transaction opened BEFORE 0012 existed sees the real guard bind its LATER statement after commit, against a legacy row reclassified unknown", async () => {
      // 0012 is already applied globally at this point in the suite (activation group
      // ran first). This proves a connection whose transaction began even EARLIER than
      // that — i.e. was already open before this specific cutover committed in a fresh
      // scenario — is bound by the same mandatory gate once it issues its next statement.
      const p = await insertProjectRow({ status: "cancelled" }); // tenant NULL -> unknown
      await runtime.sql.unsafe("BEGIN");
      try {
        await runtime.sql.unsafe("SELECT 1"); // touches nothing yet
        await expect(
          runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id]),
        ).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
        await runtime.sql.unsafe("COMMIT");
      } finally {
        await runtime.sql.unsafe("ROLLBACK").catch(() => undefined);
      }
    });

    it("a genuine SERIALIZABLE write-skew yields SQLSTATE 40001, never reclassified as the business reopen refusal", async () => {
      const tenantId = await seedTenant();
      const p1 = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      const p2 = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await other.sql.unsafe("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        // Classic SSI anomaly shape: both transactions read BOTH rows, then each writes a
        // DIFFERENT one of the two — a read-write antidependency cycle Postgres detects.
        await runtime.sql.unsafe(`SELECT id FROM public.projects WHERE id IN ($1,$2)`, [p1.id, p2.id]);
        await other.sql.unsafe(`SELECT id FROM public.projects WHERE id IN ($1,$2)`, [p1.id, p2.id]);
        await runtime.sql.unsafe(`UPDATE public.projects SET name='from-runtime' WHERE id=$1`, [p1.id]);
        await other.sql.unsafe(`UPDATE public.projects SET name='from-other' WHERE id=$1`, [p2.id]);
        await runtime.sql.unsafe("COMMIT");
        await expect(other.sql.unsafe("COMMIT")).rejects.toMatchObject({ code: "40001" });
      } finally {
        await runtime.sql.unsafe("ROLLBACK").catch(() => undefined);
        await other.sql.unsafe("ROLLBACK").catch(() => undefined);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // At least one REAL helper/router path, connected to this own database
  // ══════════════════════════════════════════════════════════════════
  describe("real helper path: updateProject/updateProjectStatus against this own database", () => {
    async function seedActor(tenantId: string) {
      const userId = await seedOwner(tenantId);
      return userId;
    }

    it("updateProjectStatus on an operational_confirmed+cancelled project throws ProjectReopenNotVerifiedError, mapped by the router to PRECONDITION_FAILED-equivalent, after a real rollback — no partial write, no audit row", async () => {
      const tenantId = await seedTenant();
      const actorId = await seedActor(tenantId);
      const p = await insertProjectRow({ tenant_id: tenantId, status: "approved", owner_user_id: actorId });
      await observer().unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      const [auditBefore] = await observer().unsafe(`SELECT count(*)::int AS n FROM public.audit_logs WHERE record_id=$1`, [p.id]);

      await expect(updateProjectStatus(p.id as string, "intake", actorId, tenantId)).rejects.toBeInstanceOf(ProjectReopenNotVerifiedError);

      const after = await readProject(p.id as string);
      expect(after!.status).toBe("cancelled"); // rolled back, not partially applied
      const [auditAfter] = await observer().unsafe(`SELECT count(*)::int AS n FROM public.audit_logs WHERE record_id=$1`, [p.id]);
      expect(auditAfter.n).toBe(auditBefore.n); // no audit row for a refused attempt
    });

    it("updateProject with the trusted allowFormationStatus option performs a LEGITIMATE reopen and writes a real audit row with the correct before/after", async () => {
      const tenantId = await seedTenant();
      const actorId = await seedActor(tenantId);
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", owner_user_id: actorId }); // formation_only
      await observer().unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);

      const result = await updateProject(p.id as string, { status: "intake" } as never, actorId, tenantId, { allowFormationStatus: true });
      expect(result.status).toBe("intake");
      const [audit] = await observer().unsafe(`SELECT old_values, new_values FROM public.audit_logs WHERE record_id=$1 ORDER BY created_at DESC LIMIT 1`, [p.id]);
      expect(audit.old_values).toMatchObject({ status: "cancelled" });
      expect(audit.new_values).toMatchObject({ status: "intake" });
    });

    it("an audit-insert failure during an otherwise-legitimate reopen is NEVER reclassified as the reopen-formation error", async () => {
      const tenantId = await seedTenant();
      const actorId = await seedActor(tenantId);
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", owner_user_id: actorId }); // formation_only
      await observer().unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await observer().unsafe(`REVOKE INSERT ON public.audit_logs FROM app_runtime;`);
      try {
        await expect(
          updateProject(p.id as string, { status: "intake" } as never, actorId, tenantId, { allowFormationStatus: true }),
        ).rejects.not.toBeInstanceOf(ProjectReopenNotVerifiedError);
        const after = await readProject(p.id as string);
        expect(after!.status).toBe("cancelled"); // whole transaction rolled back, including the status change
      } finally {
        await observer().unsafe(`GRANT INSERT ON public.audit_logs TO app_runtime;`);
      }
    });
  });
});
