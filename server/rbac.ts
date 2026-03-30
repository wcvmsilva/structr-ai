/**
 * structr.ai v9 — RBAC Module
 *
 * Provides:
 *   - getUserPermissions(userId)  → Set<"resource:action">
 *   - hasPermission(userId, resource, action) → boolean
 *   - listRoles() / listPermissions()
 *   - assignRoleToUser(userId, roleName)
 *   - RBAC middleware for tRPC (requirePermission)
 *
 * NOTE: The profiles table has no roleId FK. Instead, roles are stored as a text field.
 * Resolution: Get user's role field → lookup matching role by name → join rolePermissions → permissions
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
const permissionCache = new Map<string, { perms: Set<string>; ts: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Get all permissions for a user as a Set of "resource:action" strings.
 * Resolves via user.role (text) → roles table by name → rolePermissions → permissions
 */
export async function getUserPermissions(userId: string): Promise<Set<string>> {
  // Check cache
  const cached = permissionCache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.perms;
  }

  const db = await getDb();
  if (!db) return new Set();

  // Get user's role (text field)
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.role) return new Set();

  // Look up role by name to get its ID
  const [roleRow] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, user.role))
    .limit(1);

  if (!roleRow) return new Set();

  // Join rolePermissions → permissions to get all permissions for this role
  const rows = await db
    .select({
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleRow.id));

  const perms = new Set(rows.map(r => `${r.resource}:${r.action}`));

  // Cache
  permissionCache.set(userId, { perms, ts: Date.now() });

  return perms;
}

/**
 * Check if a user has a specific permission.
 */
export async function hasPermission(
  userId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return perms.has(`${resource}:${action}`);
}

/**
 * Clear the permission cache for a user (call after role change).
 */
export function clearPermissionCache(userId: string): void {
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
 * Get role with its permissions by role ID.
 */
export async function getRoleWithPermissions(
  roleId: string
): Promise<{ role: Role; permissions: Permission[] } | null> {
  const db = await getDb();
  if (!db) return null;

  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);

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
 * Assign a role to a user by role name.
 * Since profiles.role is a text field (not an FK), we just update it with the role name.
 */
export async function assignRoleToUser(
  userId: string,
  roleName: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Verify the role exists
  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, roleName))
    .limit(1);

  if (!role) throw new Error(`Role '${roleName}' not found`);

  // Update user's role field with the role name
  await db
    .update(users)
    .set({
      role: roleName,
    })
    .where(eq(users.id, userId));

  // Clear cache
  clearPermissionCache(userId);
}

/**
 * Get permissions for a specific role by role name.
 */
export async function getPermissionsForRole(roleName: string): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];

  const [role] = await db
    .select()
    .from(roles)
    .where(eq(roles.name, roleName))
    .limit(1);

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
