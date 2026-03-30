/**
 * structr.ai — Remodel Engine DB Helpers
 * Sprint 13: Remodel Workflow Coordinator
 *
 * DB helpers for remodel_templates CRUD.
 * All mutations log to audit trail.
 * NO pricing logic — workflow coordination only.
 */
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { getDb } from "./db";
import {
  remodelTemplates,
  type RemodelTemplate,
  type InsertRemodelTemplate,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// REMODEL TEMPLATES — CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a new remodel template.
 */
export async function createRemodelTemplate(
  data: Omit<InsertRemodelTemplate, "id" | "createdAt" | "updatedAt">,
  userId?: number
): Promise<RemodelTemplate | null> {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.insert(remodelTemplates).values(data).returning({ id: remodelTemplates.id });
  const [template] = await db
    .select()
    .from(remodelTemplates)
    .where(eq(remodelTemplates.id, result.id))
    .limit(1);
  await logAudit({
    userId: userId ?? null,
    action: "remodel_template.create",
    tableName: "remodel_templates",
    recordId: template.id,
    after: template,
  });
  return template;
}

/**
 * Get a remodel template by ID.
 */
export async function getRemodelTemplateById(
  id: number
): Promise<RemodelTemplate | null> {
  const db = await getDb();
  if (!db) return null;
  const [template] = await db
    .select()
    .from(remodelTemplates)
    .where(eq(remodelTemplates.id, id))
    .limit(1);
  return template ?? null;
}

/**
 * List all active remodel templates, optionally filtered by serviceType.
 */
export async function listRemodelTemplates(opts?: {
  serviceType?: string;
  finishLevel?: string;
  activeOnly?: boolean;
}): Promise<RemodelTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (opts?.activeOnly !== false) {
    conditions.push(eq(remodelTemplates.isActive, true));
  }
  if (opts?.serviceType) {
    conditions.push(eq(remodelTemplates.serviceType, opts.serviceType as any));
  }
  if (opts?.finishLevel) {
    conditions.push(eq(remodelTemplates.finishLevel, opts.finishLevel as any));
  }

  const query = conditions.length > 0
    ? db.select().from(remodelTemplates).where(and(...conditions))
    : db.select().from(remodelTemplates);

  return await query.orderBy(asc(remodelTemplates.serviceType), asc(remodelTemplates.name));
}

/**
 * Update a remodel template.
 */
export async function updateRemodelTemplate(
  id: number,
  data: Partial<Omit<InsertRemodelTemplate, "id" | "createdAt" | "updatedAt">>,
  userId?: number
): Promise<RemodelTemplate | null> {
  const db = await getDb();
  if (!db) return null;

  // Capture before state
  const [before] = await db
    .select()
    .from(remodelTemplates)
    .where(eq(remodelTemplates.id, id))
    .limit(1);
  if (!before) return null;

  await db
    .update(remodelTemplates)
    .set(data)
    .where(eq(remodelTemplates.id, id));

  const [after] = await db
    .select()
    .from(remodelTemplates)
    .where(eq(remodelTemplates.id, id))
    .limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "remodel_template.update",
    tableName: "remodel_templates",
    recordId: id,
    before,
    after,
  });

  return after;
}

/**
 * Deactivate a remodel template (soft delete).
 */
export async function deactivateRemodelTemplate(
  id: number,
  userId?: number
): Promise<RemodelTemplate | null> {
  return updateRemodelTemplate(id, { isActive: false }, userId);
}

/**
 * Reactivate a deactivated remodel template.
 */
export async function reactivateRemodelTemplate(
  id: number,
  userId?: number
): Promise<RemodelTemplate | null> {
  return updateRemodelTemplate(id, { isActive: true }, userId);
}

/**
 * Seed remodel templates from a list of template data.
 * Uses upsert logic: if a template with the same name and serviceType exists, update it.
 */
export async function seedRemodelTemplates(
  templates: Omit<InsertRemodelTemplate, "id" | "createdAt" | "updatedAt">[],
  userId?: number
): Promise<{ created: number; updated: number }> {
  const db = await getDb();
  if (!db) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;

  for (const tmpl of templates) {
    // Check if template exists by name + serviceType
    const [existing] = await db
      .select()
      .from(remodelTemplates)
      .where(
        and(
          eq(remodelTemplates.name, tmpl.name),
          eq(remodelTemplates.serviceType, tmpl.serviceType as any)
        )
      )
      .limit(1);

    if (existing) {
      await updateRemodelTemplate(existing.id, tmpl, userId);
      updated++;
    } else {
      await createRemodelTemplate(tmpl, userId);
      created++;
    }
  }

  return { created, updated };
}

/**
 * Get template count by service type.
 */
export async function getRemodelTemplateCountByServiceType(): Promise<
  { serviceType: string; count: number }[]
> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      serviceType: remodelTemplates.serviceType,
      count: sql<number>`COUNT(*)`,
    })
    .from(remodelTemplates)
    .where(eq(remodelTemplates.isActive, true))
    .groupBy(remodelTemplates.serviceType);

  return rows.map(r => ({
    serviceType: r.serviceType,
    count: Number(r.count),
  }));
}
