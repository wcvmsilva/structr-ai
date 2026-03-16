/**
 * structr.ai — Client Domain DB Helpers (Sprint 10)
 *
 * Provides:
 *   - createClient(data, userId)
 *   - getClientById(id)
 *   - listClients(opts)
 *   - updateClient(id, data, userId)
 *   - deleteClient(id, userId)   → soft delete
 *   - searchClients(query)
 *   - getClientStats()
 */

import { eq, and, isNull, desc, sql, like, or } from "drizzle-orm";
import { getDb } from "./db";
import { clients, type Client, type InsertClient } from "../drizzle/schema";
import { logAudit } from "./audit";
import { randomUUID } from "crypto";

// ── Types ──

export interface CreateClientInput {
  firstName: string;
  lastName: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  billingAddressLine1?: string | null;
  billingAddressLine2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
  shippingAddressLine1?: string | null;
  shippingAddressLine2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingZip?: string | null;
  channel?: "direct" | "insurance" | "commercial";
  source?: string | null;
  notes?: string | null;
}

export interface UpdateClientInput {
  firstName?: string;
  lastName?: string;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  billingAddressLine1?: string | null;
  billingAddressLine2?: string | null;
  billingCity?: string | null;
  billingState?: string | null;
  billingZip?: string | null;
  shippingAddressLine1?: string | null;
  shippingAddressLine2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingZip?: string | null;
  channel?: "direct" | "insurance" | "commercial";
  source?: string | null;
  notes?: string | null;
}

export interface ListClientsOpts {
  search?: string;
  channel?: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

// ── Helpers ──

export async function createClient(
  data: CreateClientInput,
  userId?: number | null,
): Promise<Client> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const uuid = randomUUID();

  const [result] = await db.insert(clients).values({
    uuid,
    firstName: data.firstName,
    lastName: data.lastName,
    companyName: data.companyName ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    address: data.address ?? null,
    city: data.city ?? "Charleston",
    state: data.state ?? "SC",
    zip: data.zip ?? null,
    county: data.county ?? null,
    billingAddressLine1: data.billingAddressLine1 ?? null,
    billingAddressLine2: data.billingAddressLine2 ?? null,
    billingCity: data.billingCity ?? null,
    billingState: data.billingState ?? null,
    billingZip: data.billingZip ?? null,
    shippingAddressLine1: data.shippingAddressLine1 ?? null,
    shippingAddressLine2: data.shippingAddressLine2 ?? null,
    shippingCity: data.shippingCity ?? null,
    shippingState: data.shippingState ?? null,
    shippingZip: data.shippingZip ?? null,
    channel: data.channel ?? "direct",
    source: data.source ?? null,
    notes: data.notes ?? null,
    isActive: true,
    createdBy: userId ?? null,
  }).$returningId();

  const [client] = await db.select().from(clients).where(eq(clients.id, result.id)).limit(1);

  // Audit
  logAudit({
    userId: userId ?? null,
    action: "client.create",
    tableName: "clients",
    recordId: client.id,
    before: null,
    after: client,
  }).catch(() => {});

  return client;
}

export async function getClientById(id: number): Promise<Client | null> {
  const db = await getDb();
  if (!db) return null;

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);

  return client ?? null;
}

export async function listClients(opts?: ListClientsOpts): Promise<{
  items: Client[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { items: [], total: 0 };

  const conditions = [];

  // Exclude soft-deleted by default
  if (!opts?.includeDeleted) {
    conditions.push(isNull(clients.deletedAt));
  }

  // Filter by channel
  if (opts?.channel) {
    conditions.push(eq(clients.channel, opts.channel as any));
  }

  // Search by name, email, company, phone
  if (opts?.search) {
    const term = `%${opts.search}%`;
    conditions.push(
      or(
        like(clients.firstName, term),
        like(clients.lastName, term),
        like(clients.email, term),
        like(clients.companyName, term),
        like(clients.phone, term),
      )!,
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(clients)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  // Paginated results
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  let query = db
    .select()
    .from(clients)
    .orderBy(desc(clients.createdAt))
    .limit(limit)
    .offset(offset);

  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  const items = await query;

  return { items, total };
}

export async function updateClient(
  id: number,
  data: UpdateClientInput,
  userId?: number | null,
): Promise<Client> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get before snapshot
  const [before] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!before) throw new Error(`Client ${id} not found`);
  if (before.deletedAt) throw new Error(`Client ${id} has been deleted`);

  // Build update object — only include provided fields
  const updateData: Record<string, unknown> = {};
  if (data.firstName !== undefined) updateData.firstName = data.firstName;
  if (data.lastName !== undefined) updateData.lastName = data.lastName;
  if (data.companyName !== undefined) updateData.companyName = data.companyName;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.zip !== undefined) updateData.zip = data.zip;
  if (data.county !== undefined) updateData.county = data.county;
  if (data.billingAddressLine1 !== undefined) updateData.billingAddressLine1 = data.billingAddressLine1;
  if (data.billingAddressLine2 !== undefined) updateData.billingAddressLine2 = data.billingAddressLine2;
  if (data.billingCity !== undefined) updateData.billingCity = data.billingCity;
  if (data.billingState !== undefined) updateData.billingState = data.billingState;
  if (data.billingZip !== undefined) updateData.billingZip = data.billingZip;
  if (data.shippingAddressLine1 !== undefined) updateData.shippingAddressLine1 = data.shippingAddressLine1;
  if (data.shippingAddressLine2 !== undefined) updateData.shippingAddressLine2 = data.shippingAddressLine2;
  if (data.shippingCity !== undefined) updateData.shippingCity = data.shippingCity;
  if (data.shippingState !== undefined) updateData.shippingState = data.shippingState;
  if (data.shippingZip !== undefined) updateData.shippingZip = data.shippingZip;
  if (data.channel !== undefined) updateData.channel = data.channel;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.notes !== undefined) updateData.notes = data.notes;
  updateData.updatedBy = userId ?? null;

  await db.update(clients).set(updateData).where(eq(clients.id, id));

  const [after] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);

  // Audit
  logAudit({
    userId: userId ?? null,
    action: "client.update",
    tableName: "clients",
    recordId: id,
    before,
    after,
  }).catch(() => {});

  return after;
}

export async function deleteClient(
  id: number,
  userId?: number | null,
): Promise<{ success: true }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!before) throw new Error(`Client ${id} not found`);

  await db
    .update(clients)
    .set({ deletedAt: new Date(), isActive: false, updatedBy: userId ?? null })
    .where(eq(clients.id, id));

  // Audit
  logAudit({
    userId: userId ?? null,
    action: "client.delete",
    tableName: "clients",
    recordId: id,
    before,
    after: { deletedAt: new Date(), isActive: false },
  }).catch(() => {});

  return { success: true };
}

export async function searchClients(query: string): Promise<Client[]> {
  const db = await getDb();
  if (!db) return [];

  const term = `%${query}%`;

  return db
    .select()
    .from(clients)
    .where(
      and(
        isNull(clients.deletedAt),
        or(
          like(clients.firstName, term),
          like(clients.lastName, term),
          like(clients.email, term),
          like(clients.companyName, term),
        )!,
      ),
    )
    .orderBy(clients.lastName, clients.firstName)
    .limit(20);
}

export async function getClientStats(): Promise<{
  total: number;
  active: number;
  byChannel: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, active: 0, byChannel: {} };

  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(clients)
    .where(isNull(clients.deletedAt));

  const [activeResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(clients)
    .where(and(isNull(clients.deletedAt), eq(clients.isActive, true)));

  const channelRows = await db
    .select({
      channel: clients.channel,
      count: sql<number>`COUNT(*)`,
    })
    .from(clients)
    .where(isNull(clients.deletedAt))
    .groupBy(clients.channel);

  const byChannel: Record<string, number> = {};
  for (const row of channelRows) {
    byChannel[row.channel] = row.count;
  }

  return {
    total: totalResult?.count ?? 0,
    active: activeResult?.count ?? 0,
    byChannel,
  };
}
