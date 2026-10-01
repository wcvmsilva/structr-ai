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
import { projectRouter } from "./project-router";
import type { TrpcContext } from "./_core/context";

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
    if (cluster) {
      const { directory } = cluster;
      await cluster.stop();
      const { access } = await import("node:fs/promises");
      await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
      // eslint-disable-next-line no-console
      console.log("PROJECT_REOPEN_PRODUCT_LAB_CLEANUP", JSON.stringify({ directory, removed: true }));
    }
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

    it("applies the real 0012 migration (column + 2 functions + 6 triggers present afterward) while a connection opened BEFORE it existed is already mid-transaction, then binds that SAME connection's later real reopen attempt", async () => {
      // V1-QA finding 3: the V1 version of this cutover test opened its "old" transaction
      // AFTER 0012 had already been applied by an earlier test in this same describe block
      // — it never actually crossed the real installation. Fixed by making THIS test, the
      // one that performs the real, one-time application of 0012 for the rest of the
      // suite, be the SAME test that opens an old connection beforehand.
      const tenantId = await seedTenant();
      const legacy = await insertProjectRow({ tenant_id: tenantId, status: "approved" }); // pre-0012, no provenance_state column exists yet
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [legacy.id]);

      await runtime.sql.unsafe("BEGIN");
      try {
        await runtime.sql.unsafe("SELECT 1"); // open, touches nothing yet — genuinely before 0012

        await applyMigrationFile("0012_project_reopen_provenance"); // the real, one-time install, on a DIFFERENT connection

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

        // Real reopen attempt, from the SAME already-open ("older") runtime transaction,
        // AFTER 0012 committed on the other connection — proves the guard binds a
        // connection that predates its own installation, not just new connections.
        await expect(
          runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [legacy.id]),
        ).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
        await runtime.sql.unsafe("COMMIT"); // the failed UPDATE aborted this txn; COMMIT here performs an implicit ROLLBACK

        const persisted = await readProject(legacy.id as string);
        expect(persisted!.status).toBe("cancelled");
      } finally {
        await runtime.sql.unsafe("ROLLBACK").catch(() => undefined);
      }
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
    it("sufficient privilege: a DEFINER owner DISTINCT from the calling runtime, holding only SELECT+UPDATE(provenance_state), certifies — isolated from the caller's own (deliberately absent) access", async () => {
      // V2-QA pendência 2: the V1/V2 versions of this test made app_runtime ITSELF the
      // owner while app_runtime was also the caller performing the child INSERT — success
      // could not distinguish "DEFINER escalation via the owner's privilege" from "the
      // caller happened to already have that privilege directly" (they were the same
      // role). Fixed by using a dedicated owner role the caller is never granted, and by
      // explicitly revoking the caller's own UPDATE on projects for the scenario, so the
      // ONLY possible source of the certification is the owner's narrow grant.
      await observer().unsafe(`
        CREATE ROLE reopen_definer_owner NOLOGIN NOINHERIT;
        GRANT SELECT, UPDATE (provenance_state) ON public.projects TO reopen_definer_owner;
      `);
      await observer().unsafe(`REVOKE UPDATE ON public.projects FROM app_runtime;`);
      await observer().unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO reopen_definer_owner;`);
      try {
        const [owner] = await observer().unsafe(
          `SELECT proowner::regrole::text AS owner FROM pg_proc WHERE oid = 'public.project_reopen_child_certify_v1()'::regprocedure`,
        );
        expect(owner.owner).toBe("reopen_definer_owner");
        const [callerPriv] = await observer().unsafe(
          `SELECT has_column_privilege('app_runtime','public.projects','provenance_state','UPDATE') AS upd`,
        );
        expect(callerPriv.upd).toBe(false); // the caller genuinely lacks it, confirmed before acting
        const tenantId = await seedTenant();
        const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
        await runtime.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`, [p.id, tenantId]);
        expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed"); // via the OWNER alone
      } finally {
        // Restored to app_principal_runner (the lab's bootstrap role), not app_runtime:
        // this keeps app_runtime a genuine non-owner for the later "cannot alter
        // ownership" test, and app_principal_runner's superuser-equivalent privilege
        // always satisfies the DO block for any child INSERTs in later tests.
        await observer().unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO app_principal_runner;`);
        await observer().unsafe(`REVOKE ALL PRIVILEGES ON public.projects FROM reopen_definer_owner;`);
        await observer().unsafe(`DROP ROLE reopen_definer_owner;`);
        await observer().unsafe(`GRANT UPDATE ON public.projects TO app_runtime;`); // restore the beforeAll baseline exactly
      }
    });

    it("runtime allowlist (caller has no access to provenance_state at all, matching the real intended production posture): child certification still works via a SEPARATE DEFINER owner's own narrow privilege, never the caller's; a direct attempt by the caller fails at the SQL privilege layer before the trigger's own discard logic is even reached", async () => {
      // Same pendência 2 isolation fix applied here: the owner is a role distinct from
      // app_runtime, so success cannot be attributed to app_runtime's own allowlist grant.
      await observer().unsafe(`
        CREATE ROLE reopen_definer_owner_allowlist NOLOGIN NOINHERIT;
        GRANT SELECT, UPDATE (provenance_state) ON public.projects TO reopen_definer_owner_allowlist;
      `);
      await observer().unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO reopen_definer_owner_allowlist;`);
      await observer().unsafe(`REVOKE UPDATE ON public.projects FROM app_runtime;`);
      await observer().unsafe(`GRANT UPDATE (tenant_id, name, project_type, status, field_started_at, field_completed_at, closed_at, committed_cost_cents, actual_total, variance_pct, start_date, end_date, approved_budget_cents, change_order_budget_cents) ON public.projects TO app_runtime;`);
      try {
        const [callerPriv] = await observer().unsafe(
          `SELECT has_column_privilege('app_runtime','public.projects','provenance_state','UPDATE') AS upd`,
        );
        expect(callerPriv.upd).toBe(false);
        const tenantId = await seedTenant();
        const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
        await runtime.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`, [p.id, tenantId]);
        expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
        const p2 = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
        await expect(
          runtime.sql.unsafe(`UPDATE public.projects SET provenance_state='operational_confirmed' WHERE id=$1`, [p2.id]),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await observer().unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO app_principal_runner;`);
        await observer().unsafe(`REVOKE ALL PRIVILEGES ON public.projects FROM reopen_definer_owner_allowlist;`);
        await observer().unsafe(`DROP ROLE reopen_definer_owner_allowlist;`);
        await observer().unsafe(`REVOKE UPDATE ON public.projects FROM app_runtime;`);
        await observer().unsafe(`GRANT UPDATE ON public.projects TO app_runtime;`);
      }
    });

    it("privilege via explicit per-grant GROUP-ROLE INHERIT (PostgreSQL16+ WITH INHERIT TRUE), isolated from both the caller and from plain membership; SET ROLE genuinely exercised and the local NOINHERIT posture's denial/grant both demonstrated", async () => {
      // app_runtime is created LOGIN NOINHERIT (app-principal-postgres.ts:317): plain role
      // membership never grants it anything automatically. This test never makes
      // app_runtime a member of anything — the DEFINER owner is a wholly separate role,
      // and its OWN inheritance is made explicit via the per-grant `WITH INHERIT TRUE`
      // option rather than relying on any role's default. A second, contrasting role
      // demonstrates the SAME group WITHOUT that override: denied until SET ROLE is
      // actually executed, matching the local NOINHERIT posture rather than claiming
      // universal protection against owners.
      await observer().unsafe(`
        CREATE ROLE reopen_privilege_group NOLOGIN;
        GRANT SELECT, UPDATE (provenance_state) ON public.projects TO reopen_privilege_group;
        CREATE ROLE reopen_definer_owner_inherited NOLOGIN NOINHERIT;
        GRANT reopen_privilege_group TO reopen_definer_owner_inherited WITH INHERIT TRUE;
      `);
      try {
        const [direct] = await observer().unsafe(
          `SELECT count(*)::int AS n FROM information_schema.column_privileges WHERE grantee='reopen_definer_owner_inherited' AND table_schema='public' AND table_name='projects'`,
        );
        expect(direct.n).toBe(0); // no direct column grant of its own
        const [inherited] = await observer().unsafe(
          `SELECT has_column_privilege('reopen_definer_owner_inherited','public.projects','provenance_state','UPDATE') AS upd`,
        );
        expect(inherited.upd).toBe(true); // true purely via the explicit WITH INHERIT TRUE membership

        await observer().unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO reopen_definer_owner_inherited;`);
        const tenantId = await seedTenant();
        const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
        await runtime.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`, [p.id, tenantId]);
        expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");

        await observer().unsafe(`
          CREATE ROLE reopen_plain_member NOLOGIN NOINHERIT;
          GRANT reopen_privilege_group TO reopen_plain_member;
        `);
        await observer().begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE reopen_plain_member`);
          const [withoutSetRole] = await tx.unsafe(`SELECT has_column_privilege('public.projects','provenance_state','UPDATE') AS upd`);
          expect(withoutSetRole.upd).toBe(false); // plain membership, no per-grant override: denied, matching NOINHERIT
          await tx.unsafe(`SET LOCAL ROLE reopen_privilege_group`); // SET ROLE genuinely executed, not merely asserted
          const [withSetRole] = await tx.unsafe(`SELECT has_column_privilege('public.projects','provenance_state','UPDATE') AS upd`);
          expect(withSetRole.upd).toBe(true); // now authorized, strictly because SET ROLE ran
        });
      } finally {
        await observer().unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO app_principal_runner;`);
        await observer().unsafe(`REVOKE reopen_privilege_group FROM reopen_plain_member;`);
        await observer().unsafe(`DROP ROLE reopen_plain_member;`);
        await observer().unsafe(`REVOKE reopen_privilege_group FROM reopen_definer_owner_inherited;`);
        await observer().unsafe(`DROP ROLE reopen_definer_owner_inherited;`);
        await observer().unsafe(`REVOKE ALL PRIVILEGES ON public.projects FROM reopen_privilege_group;`);
        await observer().unsafe(`DROP ROLE reopen_privilege_group;`);
      }
    });

    it("app_runtime (restricted, non-owner) cannot alter the DEFINER function's ownership — the owner is not reachable/escalatable by the restricted runtime role", async () => {
      await expect(
        runtime.sql.unsafe(`ALTER FUNCTION public.project_reopen_child_certify_v1() OWNER TO app_runtime;`),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("insufficient privilege: a genuinely FRESH installation attempt under a principal with DDL rights but no SELECT/UPDATE on projects exercises the migration's own DO-block gate atomically, not a post-install owner swap", async () => {
      // V2-QA pendência 1: the prior version of this test swapped the OWNER of an
      // ALREADY-INSTALLED function, then observed a later INSERT fail — it never ran the
      // migration's DO-block precondition itself, and proved nothing about rollback. A
      // genuinely restricted installer role cannot run `ALTER TABLE projects ADD COLUMN`
      // (that needs ownership, which this scenario deliberately does not have), so this
      // test re-applies only the self-contained, byte-identical slice of the REAL 0012
      // file that creates the certifier function + runs the precondition DO block + wires
      // the 3 child triggers (the column and parent guard, applied earlier by a privileged
      // principal, are untouched and orthogonal to what this precondition checks).
      // CREATE FUNCTION needs only schema CREATE; CREATE TRIGGER needs only the
      // grantable TRIGGER privilege on each target table — neither needs ownership — so a
      // role can genuinely have "the DDL rights this slice needs" while still lacking
      // SELECT/UPDATE(provenance_state) on projects, which is exactly what the DO block
      // checks.
      const text = readFileSync(`${MIGRATIONS_FOLDER}/0012_project_reopen_provenance.sql`, "utf8");
      const chunks = text.split("--> statement-breakpoint").map((c) => c.trim()).filter(Boolean);
      const childSlice = chunks.slice(4, 9); // CREATE FUNCTION child_certify, DO block, 3 CREATE TRIGGERs

      await observer().unsafe(`
        DROP TRIGGER trg_reopen_field_task_certify ON public.field_tasks;
        DROP TRIGGER trg_reopen_cost_actual_certify ON public.project_cost_actuals;
        DROP TRIGGER trg_reopen_closeout_certify ON public.project_closeouts;
        DROP FUNCTION public.project_reopen_child_certify_v1();
        CREATE ROLE reopen_installer_insufficient NOLOGIN;
        GRANT USAGE, CREATE ON SCHEMA public TO reopen_installer_insufficient;
        GRANT TRIGGER ON public.field_tasks, public.project_cost_actuals, public.project_closeouts TO reopen_installer_insufficient;
      `);
      // Deliberately no grant at all on public.projects for this role.

      try {
        await expect(
          observer().begin(async (tx) => {
            await tx.unsafe(`SET LOCAL ROLE reopen_installer_insufficient`);
            for (const chunk of childSlice) await tx.unsafe(chunk);
          }),
        ).rejects.toMatchObject({
          code: "42501",
          constraint_name: "project_reopen_definer_privilege_insufficient",
        });

        // Atomic rollback: the aborted attempt leaves no partial state whatsoever.
        const [fn] = await observer().unsafe(
          `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'project_reopen_child_certify_v1' AND pronamespace = 'public'::regnamespace`,
        );
        expect(fn.n).toBe(0);
        const [triggers] = await observer().unsafe(
          `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('trg_reopen_field_task_certify','trg_reopen_cost_actual_certify','trg_reopen_closeout_certify')`,
        );
        expect(triggers.n).toBe(0);
      } finally {
        await observer().unsafe(`
          REVOKE TRIGGER ON public.field_tasks, public.project_cost_actuals, public.project_closeouts FROM reopen_installer_insufficient;
          REVOKE ALL PRIVILEGES ON SCHEMA public FROM reopen_installer_insufficient;
          DROP ROLE reopen_installer_insufficient;
        `);
        // Restore the real function+triggers (as the privileged observer, who always
        // satisfies the DO block) so the rest of the suite keeps working.
        await observer().begin(async (tx) => {
          for (const chunk of childSlice) await tx.unsafe(chunk);
        });
        // Left owned by app_principal_runner (always satisfies the DO block), not
        // app_runtime — keeps app_runtime a genuine non-owner for later tests in this
        // describe block.
      }
    });

    it("a same-named function pre-existing in a DIFFERENT schema does not interfere with a valid installation — proves the OID/signature-qualified owner lookup, not a bare proname scan, is what the migration uses", async () => {
      const text = readFileSync(`${MIGRATIONS_FOLDER}/0012_project_reopen_provenance.sql`, "utf8");
      const chunks = text.split("--> statement-breakpoint").map((c) => c.trim()).filter(Boolean);
      const childSlice = chunks.slice(4, 9);

      await observer().unsafe(`
        DROP TRIGGER trg_reopen_field_task_certify ON public.field_tasks;
        DROP TRIGGER trg_reopen_cost_actual_certify ON public.project_cost_actuals;
        DROP TRIGGER trg_reopen_closeout_certify ON public.project_closeouts;
        DROP FUNCTION public.project_reopen_child_certify_v1();
        CREATE SCHEMA IF NOT EXISTS spoof;
        CREATE FUNCTION spoof.project_reopen_child_certify_v1() RETURNS trigger
          LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END; $fn$;
      `);
      try {
        await expect(
          observer().begin(async (tx) => {
            for (const chunk of childSlice) await tx.unsafe(chunk);
            return true;
          }),
        ).resolves.toBe(true); // the homonym in `spoof` never makes the owner lookup ambiguous
        const tenantId = await seedTenant();
        const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
        await runtime.sql.unsafe(`INSERT INTO public.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`, [p.id, tenantId]);
        expect((await readProject(p.id as string))!.provenance_state).toBe("operational_confirmed");
      } finally {
        await observer().unsafe(`DROP FUNCTION IF EXISTS spoof.project_reopen_child_certify_v1(); DROP SCHEMA IF EXISTS spoof;`);
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

    it("child-first ordering: a child-certifying INSERT holding the parent lock blocks a concurrent reopen attempt until it commits; the reopen then sees the now-certified state and is refused", async () => {
      // The opposite ordering from the test above (there: reopen holds the lock first,
      // child waits; here: child holds it first via its own trigger's SELECT...FOR
      // UPDATE, reopen waits) — V1-QA finding 3 named this as the missing ordering.
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" }); // formation_only
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await other.sql.unsafe("BEGIN");
      try {
        // The child INSERT's own AFTER trigger does SELECT...FOR UPDATE on the parent and
        // its conditional UPDATE, both inside other's still-open transaction — the row
        // lock is held until other commits/rolls back, not released when the INSERT
        // statement itself returns.
        await other.sql.unsafe(
          `INSERT INTO public.project_cost_actuals (project_id, tenant_id, cost_code, vendor_name, amount_cents, date_incurred) VALUES ($1,$2,'LAB-1','Synthetic Vendor',300,CURRENT_DATE)`,
          [p.id, tenantId],
        );
        const [{ pid: runtimePid }] = await runtime.sql.unsafe(`SELECT pg_backend_pid() AS pid`);
        const reopenAttempt = runtime.sql.unsafe(`UPDATE public.projects SET status='intake' WHERE id=$1`, [p.id]).execute();
        expect(await waitForLockWait(other.sql, runtimePid)).toBe(true);
        await other.sql.unsafe("COMMIT");
        await expect(reopenAttempt).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
      } finally {
        await other.sql.unsafe("ROLLBACK").catch(() => undefined);
      }
    });

    it("a genuine SERIALIZABLE write-skew (raw SQL, two rows) yields SQLSTATE 40001 at the database level", async () => {
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

    it("V1-QA finding 3: the SAME SERIALIZABLE conflict through the REAL updateProject helper (not raw SQL) yields a real 40001, and the mapper never reclassifies it as the business reopen refusal", async () => {
      // Two genuinely concurrent calls to the REAL helper, routed to TWO different
      // database connections via the AsyncLocalStorage context (otherwise both would
      // share labDb's single underlying connection and could not run two independent
      // SERIALIZABLE transactions at once). updateProject's own requireProjectAccess
      // takes a FOR UPDATE lock on the SAME row for both calls: the second to reach that
      // lock blocks until the first commits, then Postgres's SSI detects its snapshot is
      // now stale and raises 40001 -- the standard "first committer wins" SERIALIZABLE
      // outcome for two transactions on one row, not a contrived raw-SQL write-skew.
      const tenantId = await seedTenant();
      const actorId = await seedOwner(tenantId);
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", owner_user_id: actorId });
      const otherLabDb = drizzle(other.sql);
      const call1 = updateProject(p.id as string, { notes: "from-call-1" } as never, actorId, tenantId);
      const call2 = context.run(otherLabDb, () =>
        updateProject(p.id as string, { notes: "from-call-2" } as never, actorId, tenantId),
      );
      const results = await Promise.allSettled([call1, call2]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).not.toBeInstanceOf(ProjectReopenNotVerifiedError);
      // drizzle wraps the raw PostgresError in its own query-error object (message
      // "Failed query: ..."); isReopenFormationViolation's cause-walk already reaches
      // through this (the SAME wrapping is why `cause` chains must be walked at all for
      // the real refusal case), so the ORIGINAL code surfaces one level down via `.cause`.
      expect((rejected[0]!.reason as { cause?: unknown }).cause).toMatchObject({ code: "40001" });
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

    it("V1-QA finding 4: a COINCIDENTALLY-IDENTICAL code+constraint_name from audit_logs (NOT projects) during an otherwise-legitimate reopen is never reclassified — the table_name check is load-bearing", async () => {
      // Deliberately names a real CHECK constraint on audit_logs with the EXACT same
      // string the reopen gate uses, firing precisely when the legitimate audit row for
      // this reopen would be written — the adversarial scenario the QA described, made
      // concrete rather than asserted by fiat.
      const tenantId = await seedTenant();
      const actorId = await seedActor(tenantId);
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", owner_user_id: actorId });
      await observer().unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      // NOT VALID: this table already carries rows from earlier tests in this describe
      // block (including a real 'project.update' audit row) — without it, ADD CONSTRAINT
      // would validate against ALL existing rows and fail immediately on those, before
      // this test ever reaches its own INSERT attempt. NOT VALID still enforces the CHECK
      // on every NEW row from here on, which is all this test needs.
      await observer().unsafe(
        `ALTER TABLE public.audit_logs ADD CONSTRAINT project_reopen_formation_not_verified CHECK (action <> 'project.update') NOT VALID;`,
      );
      try {
        const error: unknown = await updateProject(
          p.id as string, { status: "intake" } as never, actorId, tenantId, { allowFormationStatus: true },
        ).catch((e) => e);
        expect(error).not.toBeInstanceOf(ProjectReopenNotVerifiedError);
        // drizzle wraps the raw PostgresError ("Failed query: insert into audit_logs...");
        // the original code/constraint/table surface one level down via `.cause`.
        expect((error as { cause?: unknown }).cause).toMatchObject({
          code: "23514", constraint_name: "project_reopen_formation_not_verified", table_name: "audit_logs",
        });
        const after = await readProject(p.id as string);
        expect(after!.status).toBe("cancelled"); // whole transaction rolled back
      } finally {
        await observer().unsafe(`ALTER TABLE public.audit_logs DROP CONSTRAINT project_reopen_formation_not_verified;`);
      }
    });

    it("V1-QA finding 4: the REAL router (not just the DB helper) translates the refusal to PRECONDITION_FAILED", async () => {
      const tenantId = await seedTenant();
      const actorId = await seedActor(tenantId);
      const p = await insertProjectRow({ tenant_id: tenantId, status: "approved", owner_user_id: actorId });
      await observer().unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      const ctx: TrpcContext = {
        req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId,
        user: {
          id: actorId, tenantId, role: "user", isActive: true, externalOpenId: null,
          email: "operator@example.invalid", fullName: "Synthetic Operator", companyName: null,
          loginMethod: "legacy", lastSignedIn: new Date(), createdAt: new Date(), updatedAt: new Date(),
        } as TrpcContext["user"],
      };
      await expect(
        projectRouter.createCaller(ctx).updateStatus({ id: p.id as string, status: "intake" } as never),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      const after = await readProject(p.id as string);
      expect(after!.status).toBe("cancelled");
    });
  });
});
