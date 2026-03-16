/**
 * structr.ai v9 — RBAC Module
 *
 * Provides:
 *   - getUserPermissions(userId)  → Set<"resource:action">
 *   - hasPermission(userId, resource, action) → boolean
 *   - listRoles() / listPermissions()
 *   - assignRoleToUser(userId, roleId)
 *   - RBAC middleware for tRPC (requirePermission)
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import {
  roles,
  permissions,
  rolePermissions,
  users,
  type Role,
  type Permission,
} from "../drizzle/schema";

// ── Cache (per-request in practice, but avoids repeated DB hits within a single request chain) ──
const permissionCache = new Map<number, { perms: Set<string>; ts: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Get all permissions for a user as a Set of "resource:action" strings.
 * Uses the role_id FK on the users table → role_permissions → permissions chain.
 */
export async function getUserPermissions(userId: number): Promise<Set<string>> {
  // Check cache
  const cached = permissionCache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.perms;
  }

  const db = await getDb();
  if (!db) return new Set();

  // Get user's role_id
  const [user] = await db.select({ roleId: users.roleId, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return new Set();

  // Fallback: if roleId is null, resolve from the legacy enum role field
  let effectiveRoleId = user.roleId;
  if (!effectiveRoleId && user.role) {
    const [roleRow] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, user.role)).limit(1);
    effectiveRoleId = roleRow?.id ?? null;
  }

  if (!effectiveRoleId) return new Set();

  // Join role_permissions → permissions
  const rows = await db
    .select({
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, effectiveRoleId));

  const perms = new Set(rows.map(r => `${r.resource}:${r.action}`));

  // Cache
  permissionCache.set(userId, { perms, ts: Date.now() });

  return perms;
}

/**
 * Check if a user has a specific permission.
 */
export async function hasPermission(userId: number, resource: string, action: string): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return perms.has(`${resource}:${action}`);
}

/**
 * Clear the permission cache for a user (call after role change).
 */
export function clearPermissionCache(userId: number): void {
  permissionCache.delete(userId);
}

/**
 * List all roles.
 */
export async function listRoles(): Promise<Role[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(roles);
}

/**
 * List all permissions.
 */
export async function listPermissions(): Promise<Permission[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(permissions);
}

/**
 * Get role with its permissions.
 */
export async function getRoleWithPermissions(roleId: number): Promise<{ role: Role; permissions: Permission[] } | null> {
  const db = await getDb();
  if (!db) return null;

  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) return null;

  const perms = await db
    .select({
      id: permissions.id,
      resource: permissions.resource,
      action: permissions.action,
      description: permissions.description,
      createdAt: permissions.createdAt,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId));

  return { role, permissions: perms };
}

/**
 * Assign a role to a user (updates both roleId and legacy role enum).
 */
export async function assignRoleToUser(userId: number, roleId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get the role name for the legacy enum field
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw new Error(`Role ${roleId} not found`);

  // Map role name to the enum values
  const validEnumValues = ["user", "admin", "estimator", "reviewer"] as const;
  const enumValue = validEnumValues.includes(role.name as any) ? role.name : "user";

  await db.update(users).set({
    roleId: roleId,
    role: enumValue as any,
  }).where(eq(users.id, userId));

  // Clear cache
  clearPermissionCache(userId);
}

/**
 * Get permissions for a specific role by role name.
 */
export async function getPermissionsForRole(roleName: string): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];

  const [role] = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
  if (!role) return [];

  const rows = await db
    .select({
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, role.id));

  return rows.map(r => `${r.resource}:${r.action}`);
}
