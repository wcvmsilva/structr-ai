/**
 * GCHI Command Center v9 — RBAC Seed Script
 * Seeds: roles, permissions, role_permissions
 *
 * Roles:
 *   admin       — full access
 *   estimator   — catalog, bundles, estimates, presets
 *   reviewer    — read-only + approve/reject estimates
 *   viewer      — read-only access
 *
 * Run: node seed-rbac.mjs
 */

import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 5 });

// ── 1. Seed Roles ──────────────────────────────────────────────
const ROLES = [
  { name: "admin",     description: "Full system access — owner and super-admins",  is_system: true },
  { name: "estimator", description: "Create/edit bundles, estimates, and presets",   is_system: true },
  { name: "reviewer",  description: "Read-only + approve/reject estimates",          is_system: true },
  { name: "viewer",    description: "Read-only access to all data",                  is_system: true },
];

console.log("Seeding roles...");
for (const role of ROLES) {
  await sql`
    INSERT INTO roles (name, description, is_system)
     VALUES (${role.name}, ${role.description}, ${role.is_system})
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, is_system = EXCLUDED.is_system
  `;
}
console.log(`  ✓ ${ROLES.length} roles seeded`);

// ── 2. Seed Permissions ────────────────────────────────────────
const PERMISSIONS = [
  // Catalog
  { resource: "catalog", action: "read",   description: "View catalog items" },
  { resource: "catalog", action: "write",  description: "Create/edit catalog items" },
  { resource: "catalog", action: "delete", description: "Delete catalog items" },
  // Bundles
  { resource: "bundle", action: "read",    description: "View bundles" },
  { resource: "bundle", action: "write",   description: "Create/edit bundles" },
  { resource: "bundle", action: "delete",  description: "Delete bundles" },
  // Presets
  { resource: "preset", action: "read",    description: "View preset bundles" },
  { resource: "preset", action: "write",   description: "Create/edit presets" },
  { resource: "preset", action: "delete",  description: "Delete presets" },
  // Estimates
  { resource: "estimate", action: "read",    description: "View estimates and drafts" },
  { resource: "estimate", action: "write",   description: "Create/edit estimates" },
  { resource: "estimate", action: "approve", description: "Approve/reject estimates" },
  { resource: "estimate", action: "delete",  description: "Delete estimates" },
  // Clients
  { resource: "client", action: "read",   description: "View clients" },
  { resource: "client", action: "write",  description: "Create/edit clients" },
  { resource: "client", action: "delete", description: "Delete clients" },
  // Projects
  { resource: "project", action: "read",   description: "View projects" },
  { resource: "project", action: "write",  description: "Create/edit projects" },
  { resource: "project", action: "delete", description: "Delete projects" },
  // Assemblies
  { resource: "assembly", action: "read",   description: "View assemblies and BOM" },
  { resource: "assembly", action: "write",  description: "Create/edit assemblies" },
  { resource: "assembly", action: "delete", description: "Delete assemblies" },
  // Price Book
  { resource: "pricebook", action: "read",   description: "View price book items" },
  { resource: "pricebook", action: "write",  description: "Create/edit price book items" },
  { resource: "pricebook", action: "delete", description: "Delete price book items" },
  // Intake
  { resource: "intake", action: "read",   description: "View intake forms" },
  { resource: "intake", action: "write",  description: "Create/process intake forms" },
  // Users / RBAC
  { resource: "user", action: "read",   description: "View users" },
  { resource: "user", action: "write",  description: "Create/edit users and assign roles" },
  { resource: "user", action: "delete", description: "Deactivate users" },
  // Audit
  { resource: "audit", action: "read", description: "View audit logs" },
  // Settings
  { resource: "settings", action: "read",  description: "View system settings" },
  { resource: "settings", action: "write", description: "Modify system settings" },
];

console.log("Seeding permissions...");
for (const perm of PERMISSIONS) {
  await sql`
    INSERT INTO permissions (resource, action, description)
     SELECT ${perm.resource}, ${perm.action}, ${perm.description}
     WHERE NOT EXISTS (
       SELECT 1 FROM permissions WHERE resource = ${perm.resource} AND action = ${perm.action}
     )
  `;
}
console.log(`  ✓ ${PERMISSIONS.length} permissions seeded`);

// ── 3. Seed Role-Permission Mappings ───────────────────────────

// Fetch IDs
const roleRows = await sql`SELECT id, name FROM roles`;
const roleMap = Object.fromEntries(roleRows.map(r => [r.name, r.id]));

const permRows = await sql`SELECT id, resource, action FROM permissions`;
const permMap = Object.fromEntries(permRows.map(p => [`${p.resource}:${p.action}`, p.id]));

// Define role → permission mappings
const ROLE_PERMS = {
  admin: Object.keys(permMap), // All permissions
  estimator: [
    "catalog:read",
    "bundle:read", "bundle:write", "bundle:delete",
    "preset:read", "preset:write",
    "estimate:read", "estimate:write",
    "client:read", "client:write",
    "project:read", "project:write",
    "assembly:read",
    "pricebook:read",
    "intake:read", "intake:write",
  ],
  reviewer: [
    "catalog:read",
    "bundle:read",
    "preset:read",
    "estimate:read", "estimate:approve",
    "client:read",
    "project:read",
    "assembly:read",
    "pricebook:read",
    "intake:read",
    "audit:read",
  ],
  viewer: [
    "catalog:read",
    "bundle:read",
    "preset:read",
    "estimate:read",
    "client:read",
    "project:read",
    "assembly:read",
    "pricebook:read",
    "intake:read",
  ],
};

console.log("Seeding role_permissions...");
let mappingCount = 0;
for (const [roleName, permKeys] of Object.entries(ROLE_PERMS)) {
  const roleId = roleMap[roleName];
  if (!roleId) { console.warn(`  ⚠ Role "${roleName}" not found, skipping`); continue; }

  for (const key of permKeys) {
    const permId = permMap[key];
    if (!permId) { console.warn(`  ⚠ Permission "${key}" not found, skipping`); continue; }

    await sql`
      INSERT INTO role_permissions (role_id, permission_id)
       SELECT ${roleId}, ${permId}
       WHERE NOT EXISTS (
         SELECT 1 FROM role_permissions WHERE role_id = ${roleId} AND permission_id = ${permId}
       )
    `;
    mappingCount++;
  }
}
console.log(`  ✓ ${mappingCount} role_permission mappings seeded`);

// ── 4. Link existing admin user to admin role ──────────────────
const adminRoleId = roleMap["admin"];
if (adminRoleId) {
  await sql`
    UPDATE users SET role_id = ${adminRoleId} WHERE role = 'admin' AND (role_id IS NULL OR role_id != ${adminRoleId})
  `;
  console.log(`  ✓ Linked existing admin users to admin role (role_id=${adminRoleId})`);
}

// ── Summary ────────────────────────────────────────────────────
const finalRoles = await sql`SELECT COUNT(*) as c FROM roles`;
const finalPerms = await sql`SELECT COUNT(*) as c FROM permissions`;
const finalRP = await sql`SELECT COUNT(*) as c FROM role_permissions`;
console.log(`\n=== RBAC Seed Complete ===`);
console.log(`Roles: ${finalRoles[0].c}`);
console.log(`Permissions: ${finalPerms[0].c}`);
console.log(`Role-Permission mappings: ${finalRP[0].c}`);

await sql.end();
process.exit(0);
