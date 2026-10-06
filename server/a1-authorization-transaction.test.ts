import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import type { A1AuthorizationOptions, AuthTransaction } from './auth-transaction';

const database = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('./db', () => database);

import { requireProjectAccess, requireProjectAccessTrpc } from './project-access';
import { clearPermissionCache, getUserPermissions, hasPermission } from './rbac';

const ACTOR = '10000000-0000-4000-8000-000000000001';
const OWNER = '10000000-0000-4000-8000-000000000002';
const TENANT = '20000000-0000-4000-8000-000000000001';
const OTHER_TENANT = '20000000-0000-4000-8000-000000000002';
const PROJECT = '30000000-0000-4000-8000-000000000001';
const ROLE = '40000000-0000-4000-8000-000000000001';
const PERMISSION = '50000000-0000-4000-8000-000000000001';
const GRANT = '60000000-0000-4000-8000-000000000001';
const MEMBER = '70000000-0000-4000-8000-000000000001';
type Row = Record<string, unknown>;
type WireCall = { query: string; params: unknown[] };

/**
 * Replace only the postgres wire, retaining real Drizzle selection, SQL generation
 * and result mapping. This bounded fixture supports these guards' equality/IN
 * selects; it does not simulate PostgreSQL locks or prove concurrent behavior.
 */
function wireFixture() {
  const rows: Record<string, Row[]> = {
    projects: [{ id: PROJECT, tenant_id: TENANT, owner_user_id: OWNER, deleted_at: null }],
    profiles: [{ id: ACTOR, tenant_id: TENANT, role: 'reviewer', is_active: true }],
    project_members: [],
    roles: [{ id: ROLE, name: 'reviewer' }],
    role_permissions: [{ id: GRANT, role_id: ROLE, permission_id: PERMISSION }],
    permissions: [{ id: PERMISSION, resource: 'project', action: 'approve' }],
  };
  const calls: WireCall[] = [];
  let failure: Error | undefined;
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]) {
      calls.push({ query, params });
      return {
        async values() {
          if (failure) throw failure;
          const table = / from "([^"]+)"/.exec(query)?.[1];
          if (!table || !rows[table]) throw new Error(`Unexpected fixture query: ${query}`);
          let candidates = rows[table].map(row => ({ [table]: row }));
          if (query.includes('inner join "permissions"')) {
            candidates = candidates.flatMap(candidate => rows.permissions
              .filter(permission => permission.id === candidate.role_permissions.permission_id)
              .map(permission => ({ ...candidate, permissions: permission })));
          }
          const where = query.split(' where ')[1]?.split(/ order by | limit | for /)[0] ?? '';
          for (const match of where.matchAll(/"([^"]+)"\."([^"]+)" = \$(\d+)/g)) {
            candidates = candidates.filter(candidate => candidate[match[1]]?.[match[2]] === params[Number(match[3]) - 1]);
          }
          for (const match of where.matchAll(/"([^"]+)"\."([^"]+)" in \(([^)]+)\)/g)) {
            const ids = [...match[3].matchAll(/\$(\d+)/g)].map(index => params[Number(index[1]) - 1]);
            candidates = candidates.filter(candidate => ids.includes(candidate[match[1]]?.[match[2]]));
          }
          const selected = query.slice('select '.length, query.indexOf(' from ')).split(', ');
          return candidates.map(candidate => selected.map(field => {
            const parts = [...field.matchAll(/"([^"]+)"/g)].map(match => match[1]);
            return parts.length === 2 ? candidate[parts[0]]?.[parts[1]] : candidate[table]?.[parts[0]];
          }));
        },
      };
    },
  };
  const db = drizzle(client as unknown as postgres.Sql);
  return { rows, calls, db, fail(error: Error) { failure = error; } };
}

let tx: ReturnType<typeof wireFixture>;
let legacy: ReturnType<typeof wireFixture>;
let options: A1AuthorizationOptions;
function member(overrides: Row = {}) {
  return { id: MEMBER, tenant_id: TENANT, project_id: PROJECT, user_id: ACTOR,
    project_role: 'estimator', permissions: [], is_active: true, ...overrides };
}
function authorize(permission: 'read' | 'write' | 'approve' | 'delete' = 'approve') {
  return requireProjectAccess(PROJECT, ACTOR, permission, options);
}

beforeEach(() => {
  clearPermissionCache(ACTOR);
  database.getDb.mockReset();
  vi.stubEnv('TENANT_STRICT', 'false');
  tx = wireFixture();
  legacy = wireFixture();
  database.getDb.mockResolvedValue(legacy.db);
  options = { mode: 'a1', transaction: tx.db as unknown as AuthTransaction, expectedTenantId: TENANT };
});
afterEach(() => vi.unstubAllEnvs());

describe('A1 authorization retains the caller transaction', () => {
  it('grants through the provided transaction even when the global pool is unavailable', async () => {
    database.getDb.mockResolvedValue(null);
    await expect(authorize()).resolves.toMatchObject({ via: 'tenant_rbac', tenantId: TENANT });
    expect(database.getDb).not.toHaveBeenCalled();
    expect(tx.calls.length).toBeGreaterThan(0);
  });

  it('reads changed grants on its transaction rather than the global connection', async () => {
    tx.rows.role_permissions = [];
    await expect(authorize()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it('does not reuse a warmed legacy permission cache after grant removal', async () => {
    expect(await hasPermission(ACTOR, 'project', 'approve')).toBe(true);
    tx.rows.role_permissions = [];
    database.getDb.mockClear();
    expect(await hasPermission(ACTOR, 'project', 'approve', options)).toBe(false);
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it('does not populate legacy cache with a transaction-only grant', async () => {
    expect(await hasPermission(ACTOR, 'project', 'approve', options)).toBe(true);
    legacy.rows.role_permissions = [];
    expect(await hasPermission(ACTOR, 'project', 'approve')).toBe(false);
  });

  it('does not overwrite a warmed legacy cache with a different transaction grant', async () => {
    expect(await getUserPermissions(ACTOR)).toEqual(new Set(['project:approve']));
    tx.rows.permissions[0].action = 'read';
    expect(await getUserPermissions(ACTOR, options)).toEqual(new Set(['project:read']));
    expect(await getUserPermissions(ACTOR)).toEqual(new Set(['project:approve']));
  });

  it('keeps transaction exceptions available to the whole-command retry', async () => {
    const conflict = Object.assign(new Error('serialization conflict'), { code: '40001' });
    tx.fail(conflict);
    await expect(authorize()).rejects.toMatchObject({ cause: conflict });
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it('retains transaction authorization through the tRPC wrapper', async () => {
    tx.rows.profiles[0].is_active = false;
    await expect(requireProjectAccessTrpc(PROJECT, ACTOR, 'approve', options)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(database.getDb).not.toHaveBeenCalled();
  });
});

describe('A1 identity and existing policy precedence', () => {
  it.each([
    ['project tenant NULL', 'projects', 'tenant_id', null],
    ['project tenant changed', 'projects', 'tenant_id', OTHER_TENANT],
    ['project deleted', 'projects', 'deleted_at', '2026-09-20T00:00:00.000Z'],
    ['profile tenant NULL', 'profiles', 'tenant_id', null],
    ['profile tenant changed', 'profiles', 'tenant_id', OTHER_TENANT],
    ['profile inactive', 'profiles', 'is_active', false],
  ] as const)('refuses %s even for an admin', async (_name, table, key, value) => {
    tx.rows.profiles[0].role = 'admin';
    tx.rows[table][0][key] = value;
    await expect(authorize()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses missing expected tenant instead of relaxing to legacy mode', async () => {
    options.expectedTenantId = '';
    await expect(authorize()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it('rejects a missing transaction without opening a secondary connection', async () => {
    options.transaction = undefined as unknown as AuthTransaction;
    await expect(authorize()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(database.getDb).not.toHaveBeenCalled();
  });

  it.each(['projects', 'profiles'])('refuses a missing %s row', async table => {
    tx.rows[table] = [];
    await expect(authorize()).rejects.toMatchObject({ code: table === 'projects' ? 'NOT_FOUND' : 'FORBIDDEN' });
  });

  it.each(['admin', 'owner'] as const)('preserves %s precedence over a restrictive membership', async via => {
    if (via === 'admin') tx.rows.profiles[0].role = 'admin';
    else tx.rows.projects[0].owner_user_id = ACTOR;
    tx.rows.project_members = [member({ project_role: 'viewer' })];
    database.getDb.mockResolvedValue(null);
    await expect(authorize()).resolves.toMatchObject({ via });
    expect(tx.calls.some(call => call.query.includes('from "project_members"'))).toBe(false);
  });

  it('an active viewer still denies approve when tenant RBAC grants it', async () => {
    tx.rows.project_members = [member({ project_role: 'viewer' })];
    await expect(authorize()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(tx.calls.some(call => call.query.includes('from "roles"'))).toBe(false);
  });

  it.each([null, OTHER_TENANT])('refuses membership tenant %s even when inactive', async tenantId => {
    tx.rows.project_members = [member({ tenant_id: tenantId, is_active: false })];
    await expect(authorize()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows existing RBAC fallback for an inactive same-tenant membership', async () => {
    tx.rows.project_members = [member({ is_active: false, project_role: 'viewer' })];
    database.getDb.mockResolvedValue(null);
    await expect(authorize()).resolves.toMatchObject({ via: 'tenant_rbac' });
  });

  it('honors normalized explicit membership permissions', async () => {
    tx.rows.project_members = [member({ project_role: 'viewer', permissions: ['approve', 'unknown', 12] })];
    database.getDb.mockResolvedValue(null);
    await expect(authorize()).resolves.toMatchObject({ via: 'member', permissions: ['read', 'approve'] });
  });

  it.each(['read', 'write', 'approve', 'delete'] as const)('uses project:%s rather than an unrelated estimate grant', async action => {
    tx.rows.permissions = [
      { id: PERMISSION, resource: 'estimate', action },
    ];
    await expect(authorize(action)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    clearPermissionCache(ACTOR);
    tx.rows.permissions[0].resource = 'project';
    await expect(authorize(action)).resolves.toMatchObject({ via: 'tenant_rbac', permissions: [action] });
  });

  it.each(['roles', 'role_permissions', 'permissions'])('missing %s is no grant, never unenforced allow', async table => {
    tx.rows[table] = [];
    await expect(authorize()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each([
    ['tenant_id', OTHER_TENANT], ['tenant_id', null], ['is_active', false], ['role', null],
  ] as const)('RBAC itself refuses invalid profile %s=%s in transaction mode', async (key, value) => {
    tx.rows.profiles[0][key] = value;
    expect(await getUserPermissions(ACTOR, options)).toEqual(new Set());
    expect(database.getDb).not.toHaveBeenCalled();
  });
});

describe('lock-bearing authorization queries', () => {
  it('retains project lock and all RBAC evidence locks in stable table/ID order', async () => {
    await authorize();
    const queries = tx.calls.map(call => call.query);
    expect(queries[0]).toMatch(/from "projects".*for update$/);
    expect(queries.filter(query => query.includes('from "profiles"'))).toHaveLength(2);
    expect(queries.filter(query => query.includes('from "profiles"')).every(query => /for share$/.test(query))).toBe(true);
    expect(queries.find(query => query.includes('from "project_members"'))).toMatch(/for share$/);
    expect(queries.find(query => query.includes('from "roles"'))).toMatch(/for share$/);
    expect(queries.find(query => query.includes('from "role_permissions"'))).toMatch(/order by "role_permissions"\."id" asc for share$/);
    expect(queries.find(query => query.includes('from "permissions"'))).toMatch(/order by "permissions"\."id" asc for share$/);
    expect(queries.findIndex(query => query.includes('from "role_permissions"')))
      .toBeLessThan(queries.findIndex(query => query.includes('from "permissions"')));
  });

  it('locks the active membership that is the permission evidence', async () => {
    tx.rows.project_members = [member()];
    await expect(authorize()).resolves.toMatchObject({ via: 'member' });
    const call = tx.calls.find(entry => entry.query.includes('from "project_members"'));
    expect(call?.query).toMatch(/for share$/);
    expect(call?.params).toEqual(expect.arrayContaining([PROJECT, ACTOR]));
  });
});

describe('legacy callers remain compatible', () => {
  it('retains legacy tenant-NULL project access while strict rollout is off', async () => {
    legacy.rows.projects[0].tenant_id = null;
    legacy.rows.profiles[0].role = 'admin';
    await expect(requireProjectAccess(PROJECT, ACTOR, 'approve')).resolves.toMatchObject({ via: 'admin', tenantId: null });
    expect(legacy.calls.every(call => !/for (share|update)/.test(call.query))).toBe(true);
  });

  it('retains legacy membership without tenant and existing cache behavior', async () => {
    legacy.rows.project_members = [member({ tenant_id: null })];
    await expect(requireProjectAccess(PROJECT, ACTOR, 'approve')).resolves.toMatchObject({ via: 'member' });
    expect(await hasPermission(ACTOR, 'project', 'approve')).toBe(true);
    legacy.rows.role_permissions = [];
    expect(await hasPermission(ACTOR, 'project', 'approve')).toBe(true);
  });
});
