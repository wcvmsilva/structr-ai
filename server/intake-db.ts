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
 */

import { eq, and, isNull, desc, sql, like, or } from "drizzle-orm";
import { getDb } from "./db";
import { intakeForms, type IntakeForm, type InsertIntakeForm } from "../drizzle/schema";
import { logAudit } from "./audit";
import { randomUUID } from "crypto";

// ── Types ──

export interface CreateIntakeInput {
  projectId?: number | null;
  clientId?: number | null;
  channel?: "direct" | "insurance" | "commercial";
  serviceType?: string | null;
  area?: string | null;
  finishLevel?: "standard" | "premium" | "luxury";
  condition?: string | null;
  notes?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface UpdateIntakeInput {
  projectId?: number | null;
  clientId?: number | null;
  channel?: "direct" | "insurance" | "commercial";
  serviceType?: string | null;
  area?: string | null;
  finishLevel?: "standard" | "premium" | "luxury";
  condition?: string | null;
  notes?: string | null;
  rawPayload?: Record<string, unknown>;
  parsedScope?: Record<string, unknown> | null;
  confidenceScore?: string | null;
}

export interface ListIntakeOpts {
  status?: string;
  channel?: string;
  projectId?: number;
  clientId?: number;
  serviceType?: string;
  limit?: number;
  offset?: number;
}

// ── Valid status transitions ──
const INTAKE_STATUS_TRANSITIONS: Record<string, string[]> = {
  received: ["parsing"],
  parsing: ["parsed", "received"],
  parsed: ["reviewed"],
  reviewed: ["converted"],
  converted: [],
};

// ── Helpers ──

export async function createIntakeForm(
  data: CreateIntakeInput,
  userId?: number | null,
): Promise<IntakeForm> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const uuid = randomUUID();

  const [result] = await db.insert(intakeForms).values({
    uuid,
    projectId: data.projectId ?? null,
    clientId: data.clientId ?? null,
    channel: data.channel ?? "direct",
    serviceType: data.serviceType ?? null,
    area: data.area ?? null,
    finishLevel: data.finishLevel ?? "standard",
    condition: data.condition ?? null,
    notes: data.notes ?? null,
    rawPayload: data.rawPayload,
    status: "received",
    createdBy: userId ?? null,
  }).$returningId();

  const [form] = await db.select().from(intakeForms).where(eq(intakeForms.id, result.id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "intake.create",
    tableName: "intake_forms",
    recordId: form.id,
    before: null,
    after: form,
  }).catch(() => {});

  return form;
}

export async function getIntakeFormById(id: number): Promise<IntakeForm | null> {
  const db = await getDb();
  if (!db) return null;

  const [form] = await db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.id, id))
    .limit(1);

  return form ?? null;
}

export async function listIntakeForms(opts?: ListIntakeOpts): Promise<{
  items: IntakeForm[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  if (opts?.status) {
    conditions.push(eq(intakeForms.status, opts.status as any));
  }

  if (opts?.channel) {
    conditions.push(eq(intakeForms.channel, opts.channel as any));
  }

  if (opts?.projectId) {
    conditions.push(eq(intakeForms.projectId, opts.projectId));
  }

  if (opts?.clientId) {
    conditions.push(eq(intakeForms.clientId, opts.clientId));
  }

  if (opts?.serviceType) {
    conditions.push(eq(intakeForms.serviceType, opts.serviceType));
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

  return { items, total };
}

export async function updateIntakeForm(
  id: number,
  data: UpdateIntakeInput,
  userId?: number | null,
): Promise<IntakeForm> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(intakeForms).where(eq(intakeForms.id, id)).limit(1);
  if (!before) throw new Error(`Intake form ${id} not found`);

  const updateData: Record<string, unknown> = {};
  if (data.projectId !== undefined) updateData.projectId = data.projectId;
  if (data.clientId !== undefined) updateData.clientId = data.clientId;
  if (data.channel !== undefined) updateData.channel = data.channel;
  if (data.serviceType !== undefined) updateData.serviceType = data.serviceType;
  if (data.area !== undefined) updateData.area = data.area;
  if (data.finishLevel !== undefined) updateData.finishLevel = data.finishLevel;
  if (data.condition !== undefined) updateData.condition = data.condition;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.rawPayload !== undefined) updateData.rawPayload = data.rawPayload;
  if (data.parsedScope !== undefined) updateData.parsedScope = data.parsedScope;
  if (data.confidenceScore !== undefined) updateData.confidenceScore = data.confidenceScore;
  updateData.updatedBy = userId ?? null;

  await db.update(intakeForms).set(updateData).where(eq(intakeForms.id, id));

  const [after] = await db.select().from(intakeForms).where(eq(intakeForms.id, id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "intake.update",
    tableName: "intake_forms",
    recordId: id,
    before,
    after,
  }).catch(() => {});

  return after;
}

export async function updateIntakeStatus(
  id: number,
  newStatus: string,
  userId?: number | null,
): Promise<IntakeForm> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [form] = await db.select().from(intakeForms).where(eq(intakeForms.id, id)).limit(1);
  if (!form) throw new Error(`Intake form ${id} not found`);

  const currentStatus = form.status;
  const allowed = INTAKE_STATUS_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid intake status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(", ") || "none"}`,
    );
  }

  await db
    .update(intakeForms)
    .set({ status: newStatus as any, updatedBy: userId ?? null })
    .where(eq(intakeForms.id, id));

  const [after] = await db.select().from(intakeForms).where(eq(intakeForms.id, id)).limit(1);

  logAudit({
    userId: userId ?? null,
    action: "intake.status_change",
    tableName: "intake_forms",
    recordId: id,
    before: { status: currentStatus },
    after: { status: newStatus },
  }).catch(() => {});

  return after;
}

export async function getIntakeFormsByProject(projectId: number): Promise<IntakeForm[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.projectId, projectId))
    .orderBy(desc(intakeForms.createdAt));
}

export async function getIntakeFormsByClient(clientId: number): Promise<IntakeForm[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.clientId, clientId))
    .orderBy(desc(intakeForms.createdAt));
}

export async function getIntakeStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  byServiceType: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, byStatus: {}, byChannel: {}, byServiceType: {} };

  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(intakeForms);

  const statusRows = await db
    .select({ status: intakeForms.status, count: sql<number>`COUNT(*)` })
    .from(intakeForms)
    .groupBy(intakeForms.status);

  const channelRows = await db
    .select({ channel: intakeForms.channel, count: sql<number>`COUNT(*)` })
    .from(intakeForms)
    .groupBy(intakeForms.channel);

  const serviceRows = await db
    .select({ serviceType: intakeForms.serviceType, count: sql<number>`COUNT(*)` })
    .from(intakeForms)
    .groupBy(intakeForms.serviceType);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.count;

  const byChannel: Record<string, number> = {};
  for (const r of channelRows) byChannel[r.channel ?? "unknown"] = r.count;

  const byServiceType: Record<string, number> = {};
  for (const r of serviceRows) byServiceType[r.serviceType ?? "unknown"] = r.count;

  return {
    total: totalResult?.count ?? 0,
    byStatus,
    byChannel,
    byServiceType,
  };
}

/** Export valid status transitions for testing */
export { INTAKE_STATUS_TRANSITIONS };
