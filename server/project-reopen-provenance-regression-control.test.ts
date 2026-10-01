/**
 * Focal regression control for MICHAEL-PROJECT-REOPEN-PRODUCT-PORT-V1-QA.md findings 1
 * and 2. Each describe block provisions its OWN fresh disposable PostgreSQL17 cluster,
 * applies the REAL 0000-0011 migration chain (same technique as
 * project-reopen-product-physical.test.ts — drizzle-orm/migrator's own reader, one file
 * per transaction, journal order), then applies ONE specific 0012 variant: the frozen V1
 * text (server/test-support/project-reopen-0012-v1-reference.sql, byte-identical to commit
 * 8f46889f — preserved, not rewritten) for the RED half, and the real, currently-fixed
 * drizzle/0012_project_reopen_provenance.sql for the GREEN half. Isolates the migration
 * text as the only variable between the two runs for both findings.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  startAppPrincipalPostgres,
  type AppPrincipalCluster,
  type AppPrincipalConnection,
} from "./test-support/app-principal-postgres";

const LAB_ENABLED = process.env.APP_PRINCIPAL_LAB === "1" && process.env.PROJECT_REOPEN_PRODUCT_LAB === "1";
// V3-QA pendência B: the normal lab command must exit 0 with every candidate case GREEN.
// The historical RED reproduction against the frozen V1 text is real and preserved
// (not masked, not skipped-into-passing), but is only registered under this SEPARATE,
// explicit opt-in — a distinct command run on purpose to reproduce the known V1
// failures, never folded into the regression command developers/CI run normally.
const REPRODUCE_V1_RED = process.env.PROJECT_REOPEN_REPRODUCE_V1_RED === "1";
const MIGRATIONS_FOLDER = new URL("../drizzle", import.meta.url).pathname;
const V1_REFERENCE_0012 = new URL("./test-support/project-reopen-0012-v1-reference.sql", import.meta.url).pathname;
const uuid = () => randomUUID();

function runRegressionControl(label: string, variant0012Path: string, expectCostBypassRefused: boolean, expectRelidSpoofRefused: boolean) {
  describe(`${label} (0012 variant: ${variant0012Path.endsWith("v1-reference.sql") ? "V1 (frozen, buggy)" : "current (fixed)"})`, () => {
    let cluster: AppPrincipalCluster;
    let runtime: AppPrincipalConnection;
    const observer = () => cluster.observer.sql;

    async function applyMigrationFile(tag: string) {
      const text = readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, "utf8");
      const chunks = text.split("--> statement-breakpoint").map((c) => c.trim()).filter(Boolean);
      await observer().begin(async (tx) => {
        for (const chunk of chunks) await tx.unsafe(chunk);
      });
    }
    async function applyVariant() {
      const text = readFileSync(variant0012Path, "utf8");
      const chunks = text.split("--> statement-breakpoint").map((c) => c.trim()).filter(Boolean);
      await observer().begin(async (tx) => {
        for (const chunk of chunks) await tx.unsafe(chunk);
      });
    }

    beforeAll(async () => {
      cluster = await startAppPrincipalPostgres(postgres);
      const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"));
      const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag).filter((t: string) => !t.startsWith("0012"));
      for (const tag of tags) await applyMigrationFile(tag);
      await applyVariant();
      await observer().unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime, app_denied;`);
      runtime = await cluster.connect("runtime");
    }, 90_000);

    afterAll(async () => {
      if (cluster) {
        const { directory } = cluster;
        await cluster.stop();
        const { access } = await import("node:fs/promises");
        await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
        // eslint-disable-next-line no-console
        console.log("PROJECT_REOPEN_REGRESSION_CONTROL_CLEANUP", JSON.stringify({ directory, removed: true }));
      }
    });

    beforeEach(async () => {
      await observer().unsafe(`
        DELETE FROM public.project_cost_actuals;
        DELETE FROM public.project_closeouts;
        DELETE FROM public.field_tasks;
        DELETE FROM public.projects;
        DELETE FROM public.profiles;
        DELETE FROM public.tenants;
      `);
    });

    async function seedTenant() {
      const tenantId = uuid();
      await observer().unsafe(`INSERT INTO public.tenants (id, name, slug) VALUES ($1,$2,$3)`, [tenantId, "Synthetic Tenant", `t-${tenantId}`]);
      return tenantId;
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

    it("finding 1 — NULL/negative change_order_budget_cents on a formation_only+cancelled row, in the SAME statement as the reopen", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" }); // formation_only
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      const attempt = runtime.sql.unsafe(`UPDATE public.projects SET status='intake', change_order_budget_cents=NULL WHERE id=$1`, [p.id]);
      if (expectCostBypassRefused) {
        await expect(attempt).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
        expect((await readProject(p.id as string))!.status).toBe("cancelled");
      } else {
        await expect(attempt).resolves.toBeDefined();
        expect((await readProject(p.id as string))!.status).toBe("intake"); // the V1 bypass, reproduced
      }
    });

    it("finding 1 — committed_cost_cents set negative on a formation_only row, then restored to 0, never restores eligibility once invalidated (fixed variant only; V1 never invalidated at all)", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await observer().unsafe(`UPDATE public.projects SET committed_cost_cents=-5 WHERE id=$1`, [p.id]);
      const afterNegative = await readProject(p.id as string);
      if (expectCostBypassRefused) {
        expect(afterNegative!.provenance_state).toBe("unknown");
      } else {
        expect(afterNegative!.provenance_state).toBe("formation_only"); // V1 bug: negative never invalidated
      }
      await observer().unsafe(`UPDATE public.projects SET committed_cost_cents=0 WHERE id=$1`, [p.id]);
      const afterRestore = await readProject(p.id as string);
      if (expectCostBypassRefused) {
        expect(afterRestore!.provenance_state).toBe("unknown"); // not restored
      } else {
        expect(afterRestore!.provenance_state).toBe("formation_only");
      }
    });

    it("finding 2 — a same-named relation in a different schema, with the certifying trigger attached, must not certify the real parent", async () => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" }); // formation_only
      await observer().unsafe(`
        CREATE SCHEMA IF NOT EXISTS spoof;
        GRANT USAGE ON SCHEMA spoof TO app_runtime, app_denied;
        CREATE TABLE spoof.field_tasks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid,
          project_id uuid NOT NULL,
          task_type text, title text
        );
        GRANT SELECT, INSERT, UPDATE, DELETE ON spoof.field_tasks TO app_runtime, app_denied;
        CREATE TRIGGER trg_reopen_field_task_certify AFTER INSERT ON spoof.field_tasks
          FOR EACH ROW EXECUTE FUNCTION public.project_reopen_child_certify_v1();
      `);
      try {
        await runtime.sql.unsafe(
          `INSERT INTO spoof.field_tasks (project_id, tenant_id, task_type, title) VALUES ($1,$2,'inspection','t')`,
          [p.id, tenantId],
        );
        const after = await readProject(p.id as string);
        if (expectRelidSpoofRefused) {
          expect(after!.provenance_state).toBe("formation_only"); // untouched — the spoof relation was never public.field_tasks
        } else {
          expect(after!.provenance_state).toBe("operational_confirmed"); // the V1 bug: bare name match certified it anyway
        }
      } finally {
        await observer().unsafe(`DROP SCHEMA spoof CASCADE;`);
      }
    });
  });
}

describe.skipIf(!LAB_ENABLED)("project reopen — focal regression control (V1-QA findings 1 and 2)", () => {
  runRegressionControl("RED: V1 as delivered", V1_REFERENCE_0012, false, false);
  runRegressionControl("GREEN: current fixed migration", `${MIGRATIONS_FOLDER}/0012_project_reopen_provenance.sql`, true, true);
});

/**
 * V2-QA pendência 3 — added in V3, executed now, never represented as preceding the V2
 * commit. `runRegressionControl` above is a valid differential control, but its two sides
 * assert OPPOSITE expectations via `expectCostBypassRefused`/`expectRelidSpoofRefused` —
 * the assertion itself is parameterized, not fixed, so it does not satisfy "the SAME
 * assertion genuinely failing against V1 and passing against the candidate." This runner
 * uses ONE literal, unparameterized assertion body (`.not.toBe("formation_only")` /
 * `.rejects.toMatchObject(...)`) against both variants: it fails for real against the
 * frozen V1 reference (preserved, unmodified) and passes for real against the current
 * file. Also completes the cost matrix the V1-QA named as still open: NULL explicit at
 * birth for EACH cost field (not just one), zero->NULL and zero->negative at UPDATE for
 * EACH field (the existing control above only covers NULL for change_order_budget_cents
 * and negative for committed_cost_cents), confirms return-to-zero never restores formation
 * for every covered combination, and a mixed payload combining a cost-field change with a
 * reopen attempt in the same statement, refused integrally.
 */
function runFocalRedGreen(label: string, variant0012Path: string) {
  describe(`${label} (0012 variant: ${variant0012Path.endsWith("v1-reference.sql") ? "V1 (frozen, buggy)" : "current (fixed)"})`, () => {
    let cluster: AppPrincipalCluster;
    let runtime: AppPrincipalConnection;
    const observer = () => cluster.observer.sql;

    async function applyMigrationFile(tag: string) {
      const text = readFileSync(`${MIGRATIONS_FOLDER}/${tag}.sql`, "utf8");
      const chunks = text.split("--> statement-breakpoint").map((c) => c.trim()).filter(Boolean);
      await observer().begin(async (tx) => {
        for (const chunk of chunks) await tx.unsafe(chunk);
      });
    }
    async function applyVariant() {
      const text = readFileSync(variant0012Path, "utf8");
      const chunks = text.split("--> statement-breakpoint").map((c) => c.trim()).filter(Boolean);
      await observer().begin(async (tx) => {
        for (const chunk of chunks) await tx.unsafe(chunk);
      });
    }

    beforeAll(async () => {
      cluster = await startAppPrincipalPostgres(postgres);
      const journal = JSON.parse(readFileSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"));
      const tags: string[] = journal.entries.map((e: { tag: string }) => e.tag).filter((t: string) => !t.startsWith("0012"));
      for (const tag of tags) await applyMigrationFile(tag);
      await applyVariant();
      await observer().unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime, app_denied;`);
      runtime = await cluster.connect("runtime");
    }, 90_000);

    afterAll(async () => {
      if (cluster) {
        const { directory } = cluster;
        await cluster.stop();
        const { access } = await import("node:fs/promises");
        await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
        // eslint-disable-next-line no-console
        console.log("PROJECT_REOPEN_FOCAL_REDGREEN_CLEANUP", JSON.stringify({ directory, removed: true }));
      }
    });

    beforeEach(async () => {
      await observer().unsafe(`
        DELETE FROM public.project_cost_actuals;
        DELETE FROM public.project_closeouts;
        DELETE FROM public.field_tasks;
        DELETE FROM public.projects;
        DELETE FROM public.profiles;
        DELETE FROM public.tenants;
      `);
    });

    async function seedTenant() {
      const tenantId = uuid();
      await observer().unsafe(`INSERT INTO public.tenants (id, name, slug) VALUES ($1,$2,$3)`, [tenantId, "Synthetic Tenant", `t-${tenantId}`]);
      return tenantId;
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

    const COST_FIELDS = ["committed_cost_cents", "change_order_budget_cents"] as const;

    it.each(COST_FIELDS)("birth: %s explicit NULL (the other cost field literally 0, rest of positive set intact) is never formation_only", async (field) => {
      const tenantId = await seedTenant();
      const otherField = field === "committed_cost_cents" ? "change_order_budget_cents" : "committed_cost_cents";
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake", [field]: null, [otherField]: 0 });
      expect(p.provenance_state).not.toBe("formation_only");
    });

    it.each(COST_FIELDS)("update: %s 0->NULL on a formation_only row invalidates to unknown; restoring to 0 afterward does not restore formation", async (field) => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await observer().unsafe(`UPDATE public.projects SET ${field}=NULL WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).not.toBe("formation_only");
      await observer().unsafe(`UPDATE public.projects SET ${field}=0 WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).not.toBe("formation_only");
    });

    it.each(COST_FIELDS)("update: %s 0->negative on a formation_only row invalidates to unknown; restoring to 0 afterward does not restore formation", async (field) => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await observer().unsafe(`UPDATE public.projects SET ${field}=-5 WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).not.toBe("formation_only");
      await observer().unsafe(`UPDATE public.projects SET ${field}=0 WHERE id=$1`, [p.id]);
      expect((await readProject(p.id as string))!.provenance_state).not.toBe("formation_only");
    });

    it.each(COST_FIELDS)("mixed: cancelled->intake reopen combined with %s going NULL in the SAME statement is refused integrally", async (field) => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" }); // formation_only
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='intake', ${field}=NULL WHERE id=$1`, [p.id]),
      ).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
      expect((await readProject(p.id as string))!.status).toBe("cancelled");
    });

    it.each(COST_FIELDS)("mixed: cancelled->intake reopen combined with %s going negative in the SAME statement is refused integrally", async (field) => {
      const tenantId = await seedTenant();
      const p = await insertProjectRow({ tenant_id: tenantId, status: "intake" });
      await runtime.sql.unsafe(`UPDATE public.projects SET status='cancelled' WHERE id=$1`, [p.id]);
      await expect(
        runtime.sql.unsafe(`UPDATE public.projects SET status='intake', ${field}=-5 WHERE id=$1`, [p.id]),
      ).rejects.toMatchObject({ constraint_name: "project_reopen_formation_not_verified" });
      expect((await readProject(p.id as string))!.status).toBe("cancelled");
    });
  });
}

describe.skipIf(!LAB_ENABLED)("project reopen — focal RED/GREEN with a SINGLE fixed security assertion (V2-QA pendência 3, added in V3)", () => {
  // Opt-in only: APP_PRINCIPAL_LAB=1 PROJECT_REOPEN_PRODUCT_LAB=1 PROJECT_REOPEN_REPRODUCE_V1_RED=1.
  // Registered as its own nested describe (not merely an `it.skipIf` per test) so an
  // unselected run reports these as skipped, not silently absent, and the assertion bodies
  // below are byte-identical to what ran when PROJECT_REOPEN_REPRODUCE_V1_RED was set —
  // nothing here is weakened or turned into a no-op to make the normal command pass.
  describe.skipIf(!REPRODUCE_V1_RED)("historical RED reproduction against the frozen V1 text (explicit opt-in; expected to fail — exit 1 is the correct, known result)", () => {
    runFocalRedGreen("RED (genuine, behavioral): V1 as delivered", V1_REFERENCE_0012);
  });
  runFocalRedGreen("GREEN: current fixed migration", `${MIGRATIONS_FOLDER}/0012_project_reopen_provenance.sql`);
});
