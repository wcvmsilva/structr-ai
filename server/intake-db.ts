/**
 * structr.ai — Intake Domain DB Helpers (Sprint 10)
 *
 * Provides:
 *   - createIntakeForm(data, userId)
 *   - getIntakeFormById(id)
 *   - listIntakeForms(opts)
 *   - updateIntakeForm(id, data, userId)
 *   - updateIntakeStatus(id, status, userId)
 *   - getIntakeFormsByProject(projectId)
 *   - getIntakeFormsByClient(clientId)
 *   - getIntakeStats()
 *
 * Schema: intake_forms has only: id (uuid), leadId, projectId, status, formData (jsonb), createdAt, updatedAt
 * All detail fields (channel, serviceType, area, finishLevel, condition, notes, rawPayload, clientId) go into formData.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { intakeForms, type IntakeForm } from "../drizzle/schema";

// ── Types ──

export interface CreateIntakeInput {
  projectId?: string | null;
  leadId?: string | null;
  clientId?: string | null;
  channel?: "direct" | "insurance" | "commercial";
  serviceType?: string | null;
  area?: string | null;
  finishLevel?: "standard" | "premium" | "luxury";
  condition?: string | null;
  notes?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface UpdateIntakeInput {
  projectId?: string | null;
  leadId?: string | null;
  clientId?: string | null;
  channel?: "direct" | "insurance" | "commercial";
  serviceType?: string | null;
  area?: string | null;
  finishLevel?: "standard" | "premium" | "luxury";
  condition?: string | null;
  notes?: string | null;
  rawPayload?: Record<string, unknown>;
  parsedScope?: Record<string, unknown> | null;
  confidenceScore?: string | null;
  status?: string;
}

export interface ListIntakeOpts {
  status?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

// ── Valid status transitions ──
const INTAKE_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["parsing"],
  parsing: ["parsed", "draft"],
  parsed: ["reviewed"],
  reviewed: ["converted"],
  converted: [],
};

// ── Helpers ──

/**
 * Create a new intake form.
 * Packs channel, serviceType, area, finishLevel, condition, notes, rawPayload, clientId into formData jsonb.
 * Only passes id (auto), leadId, projectId, status, formData to the insert.
 */
export async function createIntakeForm(
  data: CreateIntakeInput,
  userId?: string | null,
): Promise<IntakeForm> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Build formData jsonb from all detail fields
  const formData: Record<string, unknown> = {
    channel: data.channel ?? "direct",
    serviceType: data.serviceType ?? null,
    area: data.area ?? null,
    finishLevel: data.finishLevel ?? "standard",
    condition: data.condition ?? null,
    notes: data.notes ?? null,
    rawPayload: data.rawPayload,
  };

  // Include clientId in formData if provided
  if (data.clientId !== undefined) {
    formData.clientId = data.clientId;
  }

  const result = await db
    .insert(intakeForms)
    .values({
      leadId: data.leadId ?? null,
      projectId: data.projectId ?? null,
      status: "draft",
      formData,
    })
    .returning();

  return result[0];
}

/**
 * Get intake form by id (string uuid).
 * Merges formData fields back into returned object for backward compatibility.
 */
export async function getIntakeFormById(id: string): Promise<(IntakeForm & Record<string, unknown>) | null> {
  const db = await getDb();
  if (!db) return null;

  const items = await db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.id, id))
    .limit(1);

  const form = items[0];
  if (!form) return null;

  // Merge formData into returned object for backward compatibility
  const merged = { ...form };
  if (form.formData && typeof form.formData === "object") {
    Object.assign(merged, form.formData);
  }

  return merged;
}

/**
 * List intake forms with optional filtering.
 * Can filter by status and projectId only (other fields are in formData).
 * Merges formData fields into returned items for backward compatibility.
 */
export async function listIntakeForms(opts?: ListIntakeOpts): Promise<{
  items: (IntakeForm & Record<string, unknown>)[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  if (opts?.status) {
    conditions.push(eq(intakeForms.status, opts.status));
  }

  if (opts?.projectId) {
    conditions.push(eq(intakeForms.projectId, opts.projectId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(intakeForms)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let query = db
    .select()
    .from(intakeForms)
    .orderBy(desc(intakeForms.createdAt))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const items = await query;

  // Merge formData into each item for backward compatibility
  const merged = items.map((item) => {
    const result = { ...item };
    if (item.formData && typeof item.formData === "object") {
      Object.assign(result, item.formData);
    }
    return result;
  });

  return { items: merged, total };
}

/**
 * Update an intake form (id is string).
 * Updates status and/or formData. Merges new data into existing formData.
 */
export async function updateIntakeForm(
  id: string,
  data: UpdateIntakeInput,
  userId?: string | null,
): Promise<IntakeForm & Record<string, unknown>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const items = await db.select().from(intakeForms).where(eq(intakeForms.id, id)).limit(1);
  const before = items[0];
  if (!before) throw new Error(`Intake form ${id} not found`);

  // Build updateData for the database
  const updateData: Record<string, unknown> = {};

  // Only update status if provided
  if (data.status !== undefined) {
    updateData.status = data.status;
  }

  // Merge formData: keep existing, override with new values
  const existingFormData = (before.formData && typeof before.formData === "object")
    ? (before.formData as Record<string, unknown>)
    : {};

  const newFormData = { ...existingFormData };

  // Only include fields that were explicitly provided
  if (data.projectId !== undefined) newFormData.projectId = data.projectId;
  if (data.leadId !== undefined) newFormData.leadId = data.leadId;
  if (data.clientId !== undefined) newFormData.clientId = data.clientId;
  if (data.channel !== undefined) newFormData.channel = data.channel;
  if (data.serviceType !== undefined) newFormData.serviceType = data.serviceType;
  if (data.area !== undefined) newFormData.area = data.area;
  if (data.finishLevel !== undefined) newFormData.finishLevel = data.finishLevel;
  if (data.condition !== undefined) newFormData.condition = data.condition;
  if (data.notes !== undefined) newFormData.notes = data.notes;
  if (data.rawPayload !== undefined) newFormData.rawPayload = data.rawPayload;
  if (data.parsedScope !== undefined) newFormData.parsedScope = data.parsedScope;
  if (data.confidenceScore !== undefined) newFormData.confidenceScore = data.confidenceScore;

  updateData.formData = newFormData;

  const results = await db
    .update(intakeForms)
    .set(updateData)
    .where(eq(intakeForms.id, id))
    .returning();

  const after = results[0];
  if (!after) throw new Error(`Failed to update intake form ${id}`);

  // Merge formData into returned object for backward compatibility
  const merged = { ...after };
  if (after.formData && typeof after.formData === "object") {
    Object.assign(merged, after.formData);
  }

  return merged;
}

/**
 * Update only the status of an intake form (id is string).
 * Validates status transitions.
 */
export async function updateIntakeStatus(
  id: string,
  newStatus: string,
  userId?: string | null,
): Promise<IntakeForm & Record<string, unknown>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const items = await db.select().from(intakeForms).where(eq(intakeForms.id, id)).limit(1);
  const form = items[0];
  if (!form) throw new Error(`Intake form ${id} not found`);

  const currentStatus = form.status;
  const allowed = INTAKE_STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid intake status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(", ") || "none"}`,
    );
  }

  const results = await db
    .update(intakeForms)
    .set({ status: newStatus })
    .where(eq(intakeForms.id, id))
    .returning();

  const after = results[0];
  if (!after) throw new Error(`Failed to update status for intake form ${id}`);

  // Merge formData into returned object for backward compatibility
  const merged = { ...after };
  if (after.formData && typeof after.formData === "object") {
    Object.assign(merged, after.formData);
  }

  return merged;
}

/**
 * Get all intake forms for a project (projectId is string).
 */
export async function getIntakeFormsByProject(projectId: string): Promise<(IntakeForm & Record<string, unknown>)[]> {
  const db = await getDb();
  if (!db) return [];

  const items = await db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.projectId, projectId))
    .orderBy(desc(intakeForms.createdAt));

  // Merge formData into each item for backward compatibility
  return items.map((item) => {
    const result = { ...item };
    if (item.formData && typeof item.formData === "object") {
      Object.assign(result, item.formData);
    }
    return result;
  });
}

/**
 * Get all intake forms for a client by filtering formData.
 * Since clientId is stored in formData (not a column), we fetch all and filter in memory.
 */
export async function getIntakeFormsByClient(clientId: string): Promise<(IntakeForm & Record<string, unknown>)[]> {
  const db = await getDb();
  if (!db) return [];

  const items = await db
    .select()
    .from(intakeForms)
    .orderBy(desc(intakeForms.createdAt));

  // Merge formData and filter by clientId
  const merged = items.map((item) => {
    const result = { ...item };
    if (item.formData && typeof item.formData === "object") {
      Object.assign(result, item.formData);
    }
    return result;
  });

  return merged.filter((item) => (item.formData as Record<string, unknown>)?.clientId === clientId);
}

/**
 * Get intake statistics.
 * Only groups by status (other fields are in formData, harder to group in SQL).
 */
export async function getIntakeStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, byStatus: {} };

  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(intakeForms);

  const statusRows = await db
    .select({ status: intakeForms.status, count: sql<number>`COUNT(*)` })
    .from(intakeForms)
    .groupBy(intakeForms.status);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) {
    byStatus[r.status] = r.count;
  }

  return {
    total: totalResult?.count ?? 0,
    byStatus,
  };
}

/** Export valid status transitions for testing */
export { INTAKE_STATUS_TRANSITIONS };
