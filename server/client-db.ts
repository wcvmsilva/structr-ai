/**
 * structr.ai — Client Domain DB Helpers (Sprint 10)
 *
 * Provides:
 *   - createClient(data, userId)
 *   - getClientById(id)
 *   - listClients(opts)
 *   - updateClient(id, data, userId)
 *   - deleteClient(id, userId)   → soft delete (sets isActive to false)
 *   - searchClients(query)
 *   - getClientStats()
 *
 * Schema: id(uuid), name, email, phone, company, address, city, state, zip, notes, isActive, createdAt, updatedAt
 */

import { eq, and, desc, sql, like, or } from "drizzle-orm";
import { getDb } from "./db";
import { clients, type Client, type InsertClient } from "../drizzle/schema";
import { logAudit } from "./audit";

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
  notes?: string | null;
}

export interface ListClientsOpts {
  search?: string;
  limit?: number;
  offset?: number;
}

// ── Helpers ──

/**
 * Combine firstName + lastName into a single name field
 */
function combineName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

/**
 * Combine address fields into a structured JSON string for notes
 */
function buildAddressNotesPrefix(data: CreateClientInput | UpdateClientInput): string | null {
  const billing = {
    line1: data.billingAddressLine1 ?? undefined,
    line2: data.billingAddressLine2 ?? undefined,
    city: data.billingCity ?? undefined,
    state: data.billingState ?? undefined,
    zip: data.billingZip ?? undefined,
  };
  const shipping = {
    line1: data.shippingAddressLine1 ?? undefined,
    line2: data.shippingAddressLine2 ?? undefined,
    city: data.shippingCity ?? undefined,
    state: data.shippingState ?? undefined,
    zip: data.shippingZip ?? undefined,
  };

  const hasAny = Object.values(billing).some(v => v) || Object.values(shipping).some(v => v);
  if (!hasAny) return null;

  const addressData: Record<string, any> = {};
  if (Object.values(billing).some(v => v)) {
    addressData.billing = billing;
  }
  if (Object.values(shipping).some(v => v)) {
    addressData.shipping = shipping;
  }

  return JSON.stringify(addressData);
}

export async function createClient(
  data: CreateClientInput,
  userId?: string | null,
): Promise<Client> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const name = combineName(data.firstName, data.lastName);
  const addressPrefix = buildAddressNotesPrefix(data);
  const combinedNotes = [addressPrefix, data.notes ?? ""].filter(Boolean).join("\n");

  const result = await db
    .insert(clients)
    .values({
      name,
      email: data.email ?? null,
      phone: data.phone ?? null,
      company: data.companyName ?? null,
      address: data.address ?? null,
      city: data.city ?? "Charleston",
      state: data.state ?? "SC",
      zip: data.zip ?? null,
      notes: combinedNotes || null,
      isActive: true,
    })
    .returning();

  const client = result[0];
  if (!client) throw new Error("Failed to create client");

  // Audit
  logAudit({
    userId: userId ?? null,
    action: "client.create",
    tableName: "clients",
    recordId: client.id,
    before: null,
    after: client,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return client;
}

export async function getClientById(id: string): Promise<Client | null> {
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

  const conditions = [eq(clients.isActive, true)];

  // Search by name, email, company, phone
  if (opts?.search) {
    const term = `%${opts.search}%`;
    conditions.push(
      or(
        like(clients.name, term),
        like(clients.email, term),
        like(clients.company, term),
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
  id: string,
  data: UpdateClientInput,
  userId?: string | null,
): Promise<Client> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get before snapshot
  const [before] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!before) throw new Error(`Client ${id} not found`);
  if (!before.isActive) throw new Error(`Client ${id} is inactive`);

  // Build update object — only include provided fields
  const updateData: Record<string, unknown> = {};

  // Combine firstName/lastName if provided
  if (data.firstName !== undefined || data.lastName !== undefined) {
    const firstName = data.firstName ?? before.name?.split(" ")[0] ?? "";
    const lastName = data.lastName ?? before.name?.split(" ").slice(1).join(" ") ?? "";
    updateData.name = combineName(firstName, lastName);
  }

  if (data.companyName !== undefined) updateData.company = data.companyName;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.city !== undefined) updateData.city = data.city;
  if (data.state !== undefined) updateData.state = data.state;
  if (data.zip !== undefined) updateData.zip = data.zip;

  // Handle notes and address fields
  if (
    data.billingAddressLine1 !== undefined ||
    data.billingAddressLine2 !== undefined ||
    data.billingCity !== undefined ||
    data.billingState !== undefined ||
    data.billingZip !== undefined ||
    data.shippingAddressLine1 !== undefined ||
    data.shippingAddressLine2 !== undefined ||
    data.shippingCity !== undefined ||
    data.shippingState !== undefined ||
    data.shippingZip !== undefined ||
    data.notes !== undefined
  ) {
    const addressPrefix = buildAddressNotesPrefix(data);
    const plainNotes = data.notes ?? (before.notes ? before.notes.split("\n").slice(-1)[0] : "");
    updateData.notes = [addressPrefix, plainNotes].filter(Boolean).join("\n") || null;
  }

  await db.update(clients).set(updateData).where(eq(clients.id, id));

  const [after] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!after) throw new Error(`Failed to retrieve updated client ${id}`);

  // Audit
  logAudit({
    userId: userId ?? null,
    action: "client.update",
    tableName: "clients",
    recordId: id,
    before,
    after,
  }).catch((err) => console.error("[Audit] write failed:", err.message));

  return after;
}

export async function deleteClient(
  id: string,
  userId?: string | null,
): Promise<{ success: true }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [before] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!before) throw new Error(`Client ${id} not found`);

  await db
    .update(clients)
    .set({ isActive: false })
    .where(eq(clients.id, id));

  // Audit
  logAudit({
    userId: userId ?? null,
    action: "client.delete",
    tableName: "clients",
    recordId: id,
    before,
    after: { isActive: false },
  }).catch((err) => console.error("[Audit] write failed:", err.message));

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
        eq(clients.isActive, true),
        or(
          like(clients.name, term),
          like(clients.email, term),
          like(clients.company, term),
          like(clients.phone, term),
        )!,
      ),
    )
    .orderBy(clients.name)
    .limit(20);
}

export async function getClientStats(): Promise<{
  total: number;
  active: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, active: 0 };

  const [totalResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(clients);

  const [activeResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(clients)
    .where(eq(clients.isActive, true));

  return {
    total: totalResult?.count ?? 0,
    active: activeResult?.count ?? 0,
  };
}
