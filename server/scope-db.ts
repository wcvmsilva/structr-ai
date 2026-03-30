/**
 * structr.ai — Scope Builder DB Helpers
 * Sprint 12: Scope Builder Engine
 *
 * DB helpers for scope_rules CRUD, scope_drafts lifecycle, and scope_draft_items.
 * All mutations log to audit trail.
 * NO pricing logic — scope only.
 */

import { eq, and, sql, desc, asc } from "drizzle-orm";
import { getDb } from "./db";
import {
  scopeRules,
  scopeDrafts,
  scopeDraftItems,
  type ScopeRule,
  type InsertScopeRule,
  type ScopeDraft,
  type InsertScopeDraft,
  type ScopeDraftItem,
  type InsertScopeDraftItem,
} from "../drizzle/schema";
import { logAudit } from "./audit";

// ══════════════════════════════════════════════════════════════════════
// SCOPE RULES — CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a new scope rule.
 */
export async function createScopeRule(
  data: Omit<InsertScopeRule, "id" | "createdAt" | "updatedAt">,
  userId?: number
): Promise<ScopeRule | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(scopeRules).values(data).returning({ id: scopeRules.id });
  const [rule] = await db.select().from(scopeRules).where(eq(scopeRules.id, result.id)).limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "scope_rule.create",
    tableName: "scope_rules",
    recordId: rule.id,
    after: rule,
  });

  return rule;
}

/**
 * Get a scope rule by ID.
 */
export async function getScopeRuleById(id: string): Promise<ScopeRule | null> {
  const db = await getDb();
  if (!db) return null;

  const [rule] = await db.select().from(scopeRules).where(eq(scopeRules.id, id)).limit(1);
  return rule ?? null;
}

/**
 * Get a scope rule by rule_code.
 */
export async function getScopeRuleByCode(ruleCode: string): Promise<ScopeRule | null> {
  const db = await getDb();
  if (!db) return null;

  const [rule] = await db.select().from(scopeRules).where(eq(scopeRules.ruleCode, ruleCode)).limit(1);
  return rule ?? null;
}

/**
 * List scope rules with optional filters.
 */
export async function listScopeRules(opts?: {
  serviceType?: string;
  finishLevel?: string;
  zone?: string;
  channel?: string;
  activeOnly?: boolean;
}): Promise<ScopeRule[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (opts?.activeOnly !== false) {
    conditions.push(eq(scopeRules.isActive, true));
  }
  if (opts?.serviceType) {
    conditions.push(eq(scopeRules.serviceType, opts.serviceType));
  }
  if (opts?.finishLevel) {
    conditions.push(eq(scopeRules.finishLevel, opts.finishLevel as any));
  }
  if (opts?.zone) {
    conditions.push(eq(scopeRules.zone, opts.zone));
  }
  if (opts?.channel) {
    conditions.push(eq(scopeRules.channel, opts.channel as any));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let query = db.select().from(scopeRules).orderBy(asc(scopeRules.priority), asc(scopeRules.ruleCode));
  if (whereClause) {
    query = query.where(whereClause) as typeof query;
  }

  return await query;
}

/**
 * Load all active scope rules for the engine.
 * Returns rules sorted by priority (lower = higher priority).
 */
export async function loadActiveRulesForEngine(): Promise<ScopeRule[]> {
  return listScopeRules({ activeOnly: true });
}

/**
 * Update a scope rule.
 */
export async function updateScopeRule(
  id: number,
  data: Partial<Omit<InsertScopeRule, "id" | "createdAt" | "updatedAt">>,
  userId?: number
): Promise<ScopeRule | null> {
  const db = await getDb();
  if (!db) return null;

  const [before] = await db.select().from(scopeRules).where(eq(scopeRules.id, id)).limit(1);
  if (!before) return null;

  await db.update(scopeRules).set(data).where(eq(scopeRules.id, id));

  const [after] = await db.select().from(scopeRules).where(eq(scopeRules.id, id)).limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "scope_rule.update",
    tableName: "scope_rules",
    recordId: id,
    before,
    after,
  });

  return after;
}

/**
 * Deactivate a scope rule (soft delete).
 */
export async function deactivateScopeRule(id: string, userId?: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [before] = await db.select().from(scopeRules).where(eq(scopeRules.id, id)).limit(1);
  if (!before) return false;

  await db.update(scopeRules).set({ active: false }).where(eq(scopeRules.id, id));

  await logAudit({
    userId: userId ?? null,
    action: "scope_rule.deactivate",
    tableName: "scope_rules",
    recordId: id,
    before,
    after: { ...before, active: false },
  });

  return true;
}

/**
 * Reactivate a scope rule.
 */
export async function reactivateScopeRule(id: string, userId?: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db.update(scopeRules).set({ active: true }).where(eq(scopeRules.id, id));

  await logAudit({
    userId: userId ?? null,
    action: "scope_rule.reactivate",
    tableName: "scope_rules",
    recordId: id,
  });

  return true;
}

/**
 * Get scope rule statistics.
 */
export async function getScopeRuleStats(): Promise<{
  totalRules: number;
  activeRules: number;
  rulesByServiceType: Record<string, number>;
  rulesByFinishLevel: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { totalRules: 0, activeRules: 0, rulesByServiceType: {}, rulesByFinishLevel: {} };

  const [counts] = await db.select({
    totalRules: sql<number>`COUNT(*)`,
    activeRules: sql<number>`SUM(CASE WHEN ${scopeRules.isActive} = 1 THEN 1 ELSE 0 END)`,
  }).from(scopeRules);

  const serviceTypeRows = await db.select({
    serviceType: scopeRules.serviceType,
    count: sql<number>`COUNT(*)`,
  }).from(scopeRules).where(eq(scopeRules.isActive, true)).groupBy(scopeRules.serviceType);

  const finishLevelRows = await db.select({
    finishLevel: scopeRules.finishLevel,
    count: sql<number>`COUNT(*)`,
  }).from(scopeRules).where(eq(scopeRules.isActive, true)).groupBy(scopeRules.finishLevel);

  const rulesByServiceType: Record<string, number> = {};
  for (const row of serviceTypeRows) {
    rulesByServiceType[row.serviceType] = row.count;
  }

  const rulesByFinishLevel: Record<string, number> = {};
  for (const row of finishLevelRows) {
    if (row.finishLevel) rulesByFinishLevel[row.finishLevel] = row.count;
  }

  return {
    totalRules: counts?.totalRules ?? 0,
    activeRules: counts?.activeRules ?? 0,
    rulesByServiceType,
    rulesByFinishLevel,
  };
}

// ══════════════════════════════════════════════════════════════════════
// SCOPE DRAFTS — LIFECYCLE
// ══════════════════════════════════════════════════════════════════════

/**
 * Create a new scope draft.
 */
export async function createScopeDraft(
  data: Omit<InsertScopeDraft, "id" | "createdAt" | "updatedAt">,
  userId?: number
): Promise<ScopeDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [result] = await db.insert(scopeDrafts).values({
    ...data,
    createdBy: userId ?? data.createdBy ?? null,
  }).returning({ id: scopeDrafts.id });

  const [draft] = await db.select().from(scopeDrafts).where(eq(scopeDrafts.id, result.id)).limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "scope_draft.create",
    tableName: "scope_drafts",
    recordId: draft.id,
    after: draft,
  });

  return draft;
}

/**
 * Get a scope draft by ID.
 */
export async function getScopeDraftById(id: string): Promise<ScopeDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [draft] = await db.select().from(scopeDrafts).where(eq(scopeDrafts.id, id)).limit(1);
  return draft ?? null;
}

/**
 * List scope drafts for a project.
 */
export async function listScopeDraftsForProject(projectId: string): Promise<ScopeDraft[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(scopeDrafts)
    .where(eq(scopeDrafts.projectId, projectId))
    .orderBy(desc(scopeDrafts.createdAt));
}

/**
 * Update scope draft status.
 */
export async function updateScopeDraftStatus(
  id: number,
  status: "draft" | "under_review" | "approved" | "rejected" | "converted",
  userId?: number
): Promise<ScopeDraft | null> {
  const db = await getDb();
  if (!db) return null;

  const [before] = await db.select().from(scopeDrafts).where(eq(scopeDrafts.id, id)).limit(1);
  if (!before) return null;

  await db.update(scopeDrafts).set({ status, updatedBy: userId ?? null }).where(eq(scopeDrafts.id, id));

  const [after] = await db.select().from(scopeDrafts).where(eq(scopeDrafts.id, id)).limit(1);

  await logAudit({
    userId: userId ?? null,
    action: "scope_draft.status_change",
    tableName: "scope_drafts",
    recordId: id,
    before: { status: before.status },
    after: { status },
  });

  return after;
}

// ══════════════════════════════════════════════════════════════════════
// SCOPE DRAFT ITEMS — CRUD
// ══════════════════════════════════════════════════════════════════════

/**
 * Add items to a scope draft (batch insert).
 */
export async function addScopeDraftItems(
  items: Omit<InsertScopeDraftItem, "id" | "createdAt">[]
): Promise<number> {
  const db = await getDb();
  if (!db || items.length === 0) return 0;

  await db.insert(scopeDraftItems).values(items);

  return items.length;
}

/**
 * Get all items for a scope draft.
 */
export async function getScopeDraftItems(scopeDraftId: string): Promise<ScopeDraftItem[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(scopeDraftItems)
    .where(eq(scopeDraftItems.scopeDraftId, scopeDraftId))
    .orderBy(asc(scopeDraftItems.sortOrder));
}

/**
 * Remove a single item from a scope draft.
 */
export async function removeScopeDraftItem(id: string, userId?: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [item] = await db.select().from(scopeDraftItems).where(eq(scopeDraftItems.id, id)).limit(1);
  if (!item) return false;

  await db.delete(scopeDraftItems).where(eq(scopeDraftItems.id, id));

  await logAudit({
    userId: userId ?? null,
    action: "scope_draft_item.remove",
    tableName: "scope_draft_items",
    recordId: id,
    before: item,
  });

  return true;
}

/**
 * Clear all items from a scope draft (for regeneration).
 */
export async function clearScopeDraftItems(scopeDraftId: string, userId?: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const existing = await getScopeDraftItems(scopeDraftId);

  await db.delete(scopeDraftItems).where(eq(scopeDraftItems.scopeDraftId, scopeDraftId));

  if (existing.length > 0) {
    await logAudit({
      userId: userId ?? null,
      action: "scope_draft_items.clear",
      tableName: "scope_draft_items",
      recordId: scopeDraftId,
      before: { itemCount: existing.length, items: existing.map(i => i.id) },
    });
  }

  return existing.length;
}

/**
 * Get a full scope draft with items.
 */
export async function getScopeDraftWithItems(id: string): Promise<{
  draft: ScopeDraft;
  items: ScopeDraftItem[];
} | null> {
  const draft = await getScopeDraftById(id);
  if (!draft) return null;

  const items = await getScopeDraftItems(id);

  return { draft, items };
}

// ══════════════════════════════════════════════════════════════════════
// SEED HELPERS
// ══════════════════════════════════════════════════════════════════════

/**
 * Seed scope rules from an array of rule definitions.
 * Skips rules that already exist (by rule_code).
 * Returns the number of rules created.
 */
export async function seedScopeRules(
  rules: Omit<InsertScopeRule, "id" | "createdAt" | "updatedAt">[],
  userId?: number
): Promise<number> {
  let created = 0;

  for (const ruleData of rules) {
    const existing = await getScopeRuleByCode(ruleData.ruleCode);
    if (existing) continue;

    await createScopeRule(ruleData, userId);
    created++;
  }

  return created;
}
