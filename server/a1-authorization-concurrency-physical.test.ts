/**
 * Real A1 authorization on two connections to an explicitly owned local lab.
 * No production URL, global pool, seeded production grant or application owner
 * claim is used. A synthetic draft note stands for a write after authorization;
 * it makes the transaction read/write without manufacturing commercial approval.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import postgres from 'postgres';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { estimateDrafts, projects } from '../drizzle/schema';
import type { AuthTransaction } from './auth-transaction';

// A bug that falls back to getDb must fail this test, not consult any environment
// connection. Project/RBAC/Drizzle implementations themselves remain real.
vi.mock('./db', () => ({ getDb: vi.fn(() => { throw new Error('Global pool forbidden in physical A1 authorization'); }) }));
import { requireProjectAccess } from './project-access';
import { getDb } from './db';
import { withInternalApprovalTransaction } from './internal-estimate-approval-db';

const labConfig = process.env.A1_TRANSACTION_PHYSICAL_CONFIG;
const waitBudgetMs = 4_000;
let first: ReturnType<typeof postgres> | undefined, second: ReturnType<typeof postgres> | undefined;
let firstDb: PostgresJsDatabase, secondDb: PostgresJsDatabase;
let firstPid: number, secondPid: number;
let fixture: { tenant: string; actor: string; otherActor: string; client: string; project: string; otherProject: string; draft: string; role: string; grant: string; permission: string } | undefined;
const createdPermissions = new Set<string>();

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
function outcome<T>(promise: PromiseLike<T>): Promise<Outcome<T>> {
  return Promise.resolve(promise).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
}
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(done => { release = done; });
  return { promise, release };
}
function signal<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>(done => { resolveValue = done; });
  return { promise, resolve: resolveValue };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), waitBudgetMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function ready<T>(event: Promise<T>, task: Promise<Outcome<unknown>>): Promise<T> {
  return bounded(Promise.race([event, task.then(result => {
    if (!result.ok) throw result.error;
    throw new Error('Transaction ended before reaching its test barrier');
  })]), 'transaction barrier');
}
function errorCode(error: unknown): string | undefined {
  for (let depth = 0; depth < 5 && error && typeof error === 'object'; depth++) {
    const current = error as { code?: unknown; cause?: unknown };
    if (typeof current.code === 'string') return current.code;
    error = current.cause;
  }
  return undefined;
}
function ids() {
  if (!fixture) throw new Error('Synthetic authorization fixture is missing');
  return fixture;
}
async function waitForBlocker(observer: AuthTransaction, waiter: number, blocker: number) {
  const deadline = Date.now() + waitBudgetMs;
  while (Date.now() < deadline) {
    const [row] = await observer.execute<{ blockers: number[] }>(sql`select pg_blocking_pids(${waiter}) as blockers`);
    if (row?.blockers.includes(blocker)) return;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error(`No physical lock edge ${waiter} -> ${blocker} was observed`);
}
// A rekey of user_id alone had no parent FK wait before migration 0008. Capture
// that unsafe completion as behavior, rather than misclassifying it as a timeout.
async function waitForBlockerOrCompletion(observer: AuthTransaction, task: Promise<Outcome<unknown>>) {
  let finished = false;
  void task.then(() => { finished = true; });
  const deadline = Date.now() + waitBudgetMs;
  while (Date.now() < deadline) {
    const [row] = await observer.execute<{ blockers: number[] }>(sql`select pg_blocking_pids(${firstPid}) as blockers`);
    if (finished || row?.blockers.includes(secondPid)) return;
    await new Promise(done => setTimeout(done, 20));
  }
  throw new Error('Neither authorization completion nor its parent lock wait was observed');
}

/** The same locator → project UPDATE → draft UPDATE order used by the A1 writer. */
async function lockWriterRows(tx: AuthTransaction) {
  const f = ids();
  const [locator] = await tx.select({ projectId: estimateDrafts.projectId }).from(estimateDrafts)
    .where(and(eq(estimateDrafts.id, f.draft), eq(estimateDrafts.tenantId, f.tenant))).limit(1);
  if (locator?.projectId !== f.project) throw new Error('Fixture locator changed');
  await tx.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, f.project), eq(projects.tenantId, f.tenant))).for('update');
  await tx.select({ id: estimateDrafts.id }).from(estimateDrafts)
    .where(and(eq(estimateDrafts.id, f.draft), eq(estimateDrafts.tenantId, f.tenant))).for('update');
}
async function authorize(tx: AuthTransaction) {
  const f = ids();
  return requireProjectAccess(f.project, f.actor, 'approve', { mode: 'a1', transaction: tx, expectedTenantId: f.tenant });
}
function freshAuthorization() {
  return firstDb.transaction(async tx => { await lockWriterRows(tx); return authorize(tx); }, { isolationLevel: 'serializable' });
}
async function insertRestrictiveMember(tx: AuthTransaction) {
  const f = ids();
  await tx.execute(sql`insert into public.project_members(id,tenant_id,project_id,user_id,project_role,permissions,is_active)
    values (${randomUUID()},${f.tenant},${f.project},${f.actor},'viewer','[]'::jsonb,true)`);
}
async function writeAuthorizedMarker(tx: AuthTransaction, marker: string) {
  await tx.update(estimateDrafts).set({ notes: marker }).where(eq(estimateDrafts.id, ids().draft));
}

describe.skipIf(!labConfig)('A1 authorization physical transaction ordering', () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL) throw new Error('Unset DATABASE_URL before running the socket-only authorization laboratory');
    const config = JSON.parse(await readFile(labConfig!, 'utf8')) as {
      directory: string; dataDirectory: string; socketDirectory: string; database: string; user: string; port: number;
    };
    const directory = await realpath(config.directory);
    if (!directory.startsWith('/private/tmp/structr-a1-') || directory !== resolve(config.directory)
      || config.database !== 'a1_test' || config.user !== 'a1_lab'
      || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Not an owned A1 laboratory configuration');
    const dataDirectory = await realpath(config.dataDirectory), socketDirectory = await realpath(config.socketDirectory);
    if (!dataDirectory.startsWith(directory + sep) || !socketDirectory.startsWith(directory + sep)
      || dataDirectory !== resolve(config.dataDirectory) || socketDirectory !== resolve(config.socketDirectory)) throw new Error('A1 laboratory paths escape the owned directory');
    const options = { host: socketDirectory, database: config.database, username: config.user, port: config.port,
      ssl: false as const, max: 1, prepare: false, connect_timeout: 3 };
    first = postgres(options); second = postgres(options);
    for (const connection of [first, second]) {
      const [identity] = await connection`select current_database() as database,current_user as username,
        current_setting('data_directory') as data_directory,current_setting('unix_socket_directories') as socket_directories,
        current_setting('listen_addresses') as listen_addresses,current_setting('port') as port,inet_server_addr() as server_address`;
      if (identity.database !== config.database || identity.username !== config.user
        || await realpath(identity.data_directory) !== dataDirectory || identity.socket_directories !== socketDirectory
        || identity.listen_addresses !== '' || Number(identity.port) !== config.port || identity.server_address !== null) throw new Error('A1 server identity does not match the owned socket-only laboratory');
      await connection`set statement_timeout = '10s'`;
      await connection`set lock_timeout = '8s'`;
      await connection`set idle_in_transaction_session_timeout = '15s'`;
    }
    const [fk] = await first`select exists (
      select 1 from pg_constraint c where c.conrelid='public.project_members'::regclass
        and c.confrelid='public.projects'::regclass and c.contype='f' and c.convalidated
        and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='project_id')]
        and exists(select 1 from pg_trigger t where t.tgconstraint=c.oid)
        and not exists(select 1 from pg_trigger t where t.tgconstraint=c.oid and t.tgenabled not in ('O','A'))
      ) as enabled,current_setting('session_replication_role') as replication_role`;
    if (fk.enabled !== true || fk.replication_role !== 'origin') throw new Error('Physical project membership FK protection is not active');
    firstPid = Number((await first`select pg_backend_pid() as pid`)[0].pid);
    secondPid = Number((await second`select pg_backend_pid() as pid`)[0].pid);
    if (!firstPid || !secondPid || firstPid === secondPid) throw new Error('Expected two distinct physical PostgreSQL connections');
    firstDb = drizzle(first); secondDb = drizzle(second);
  }, 20_000);

  beforeEach(async () => {
    const connection = first!;
    const f = { tenant: randomUUID(), actor: randomUUID(), otherActor: randomUUID(), client: randomUUID(), project: randomUUID(), otherProject: randomUUID(),
      draft: randomUUID(), role: randomUUID(), grant: randomUUID(), permission: '' };
    fixture = f;
    const roleName = `a1-auth-fixture-${f.role}`;
    const candidatePermission = randomUUID();
    const created = await connection`insert into public.permissions(id,resource,action)
      values (${candidatePermission},'project','approve') on conflict(resource,action) do nothing returning id`;
    if (created.length) createdPermissions.add(candidatePermission);
    f.permission = String((await connection`select id from public.permissions where resource='project' and action='approve'`)[0].id);
    await connection`insert into public.roles(id,name,is_system) values (${f.role},${roleName},false)`;
    await connection`insert into public.role_permissions(id,role_id,permission_id) values (${f.grant},${f.role},${f.permission})`;
    await connection`insert into public.tenants(id,name,slug) values (${f.tenant},'Synthetic authorization laboratory',${'a1-auth-' + f.tenant})`;
    await connection`insert into public.profiles(id,tenant_id,is_active,role) values (${f.actor},${f.tenant},true,${roleName})`;
    await connection`insert into public.profiles(id,tenant_id,is_active,role) values (${f.otherActor},${f.tenant},true,${roleName})`;
    await connection`insert into public.clients(id,tenant_id,name) values (${f.client},${f.tenant},'Synthetic authorization client')`;
    // No owner shortcut: the actor's only approve grant initially is tenant RBAC.
    await connection`insert into public.projects(id,tenant_id,client_id,owner_user_id,name,project_type)
      values (${f.project},${f.tenant},${f.client},null,'Synthetic authorization project','repair')`;
    await connection`insert into public.projects(id,tenant_id,client_id,owner_user_id,name,project_type)
      values (${f.otherProject},${f.tenant},${f.client},null,'Unrelated synthetic authorization project','repair')`;
    await connection`insert into public.estimate_drafts(id,tenant_id,project_id,client_id,created_by,status,source,version)
      values (${f.draft},${f.tenant},${f.project},${f.client},${f.actor},'draft','assembly_calculator',1)`;
  });

  afterEach(async () => {
    if (!first || !fixture) return;
    const f = fixture; fixture = undefined;
    // Only UUIDs created by this test are removed. No TRUNCATE or shared role change.
    await first`delete from public.project_members where project_id in (${f.project},${f.otherProject}) and user_id in (${f.actor},${f.otherActor})`;
    await first`delete from public.estimate_drafts where id=${f.draft}`;
    await first`delete from public.projects where id in (${f.project},${f.otherProject})`;
    await first`delete from public.clients where id=${f.client}`;
    await first`delete from public.profiles where id in (${f.actor},${f.otherActor})`;
    await first`delete from public.tenants where id=${f.tenant}`;
    await first`delete from public.role_permissions where role_id=${f.role}`;
    await first`delete from public.roles where id=${f.role}`;
    vi.mocked(getDb).mockClear();
  });
  afterAll(async () => {
    try {
      if (first) for (const id of createdPermissions) await first`delete from public.permissions p where p.id=${id}
        and not exists(select 1 from public.role_permissions r where r.permission_id=p.id)`;
    } finally { await Promise.all([first?.end({ timeout: 2 }), second?.end({ timeout: 2 })]); }
  });

  it('holds an existing RBAC grant against concurrent revocation until the authorized transaction ends', async () => {
    const f = ids(), release = latch(), locked = signal<AuthTransaction>();
    const decision = outcome(firstDb.transaction(async tx => {
      await lockWriterRows(tx);
      const access = await authorize(tx);
      await writeAuthorizedMarker(tx, 'Synthetic action before grant withdrawal');
      locked.resolve(tx); await release.promise;
      return access;
    }, { isolationLevel: 'serializable' }));
    let withdrawal: Promise<Outcome<unknown>> | undefined;
    try {
      const holder = await ready(locked.promise, decision);
      withdrawal = outcome(secondDb.transaction(async tx => {
        await tx.execute(sql`delete from public.role_permissions where id=${f.grant}`);
      }));
      await waitForBlocker(holder, secondPid, firstPid);
    } finally { release.release(); await Promise.all([decision, withdrawal]); }
    expect(await decision).toMatchObject({ ok: true, value: { via: 'tenant_rbac' } });
    expect(await withdrawal).toMatchObject({ ok: true });
    const next = await outcome(freshAuthorization());
    expect(next.ok).toBe(false);
    if (!next.ok) expect(errorCode(next.error)).toBe('FORBIDDEN');
  }, 20_000);

  it('refuses authorization when the RBAC grant was revoked before its snapshot', async () => {
    await second!`delete from public.role_permissions where id=${ids().grant}`;
    const result = await outcome(freshAuthorization());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(errorCode(result.error)).toBe('FORBIDDEN');
    expect((await first!`select notes from public.estimate_drafts where id=${ids().draft}`)[0].notes).toBeNull();
  }, 20_000);

  it('holds a new restrictive membership behind the project FK while authorization owns FOR UPDATE', async () => {
    const release = latch(), locked = signal<AuthTransaction>();
    const decision = outcome(firstDb.transaction(async tx => {
      await lockWriterRows(tx);
      const access = await authorize(tx);
      await writeAuthorizedMarker(tx, 'Synthetic action before new membership');
      locked.resolve(tx); await release.promise;
      return access;
    }, { isolationLevel: 'serializable' }));
    let membership: Promise<Outcome<unknown>> | undefined;
    try {
      const holder = await ready(locked.promise, decision);
      membership = outcome(secondDb.transaction(tx => insertRestrictiveMember(tx)));
      await waitForBlocker(holder, secondPid, firstPid);
    } finally { release.release(); await Promise.all([decision, membership]); }
    expect(await decision).toMatchObject({ ok: true, value: { via: 'tenant_rbac' } });
    expect(await membership).toMatchObject({ ok: true });
    const next = await outcome(freshAuthorization());
    expect(next.ok).toBe(false);
    if (!next.ok) expect(errorCode(next.error)).toBe('FORBIDDEN');
  }, 20_000);

  it('does not commit RBAC authority after waiting behind an already-inserted restrictive membership', async () => {
    const release = latch(), inserted = signal<AuthTransaction>();
    const membership = outcome(secondDb.transaction(async tx => {
      await insertRestrictiveMember(tx); // INSERT holds the actual project FK KEY SHARE.
      inserted.resolve(tx); await release.promise;
    }));
    let decision: Promise<Outcome<{ via: string; snapshot: string; membersVisible: number }>> | undefined;
    try {
      const inserter = await ready(inserted.promise, membership);
      decision = outcome(firstDb.transaction(async tx => {
        // Locator fixes the SERIALIZABLE snapshot before membership commits.
        // FOR UPDATE must then wait on that INSERT's FK lock. A row lock alone
        // must not be assumed to refresh the snapshot or create an SSI cycle.
        await lockWriterRows(tx);
        const [observed] = await tx.execute<{ snapshot: string; members_visible: number }>(sql`
          select pg_current_snapshot()::text as snapshot,
            (select count(*)::int from public.project_members where project_id=${ids().project} and user_id=${ids().actor}) as members_visible`);
        const access = await authorize(tx);
        await writeAuthorizedMarker(tx, 'UNSAFE: authority committed after restrictive membership');
        return { via: access.via, snapshot: observed.snapshot, membersVisible: observed.members_visible };
      }, { isolationLevel: 'serializable' }));
      await waitForBlocker(inserter, firstPid, secondPid);
    } finally { release.release(); await Promise.all([membership, decision]); }
    expect(await membership).toMatchObject({ ok: true });
    if (!decision) throw new Error('Authorization transaction did not start');
    const result = await decision;
    const [stored] = await first!`select notes,(select count(*)::int from public.project_members
      where project_id=${ids().project} and user_id=${ids().actor}) as members_committed
      from public.estimate_drafts where id=${ids().draft}`;
    const fresh = await outcome(freshAuthorization());
    expect(fresh.ok).toBe(false);
    if (!fresh.ok) expect(errorCode(fresh.error)).toBe('FORBIDDEN');
    const diagnostic = JSON.stringify({ authorizationCommitted: result.ok,
      transaction: result.ok ? result.value : { code: errorCode(result.error) },
      membersCommitted: stored.members_committed, committedMarker: stored.notes });
    expect(result.ok, `Opposite-order authorization evidence: ${diagnostic}`).toBe(false);
    if (!result.ok) expect(['FORBIDDEN', '40001', '40P01']).toContain(errorCode(result.error));
    expect(stored.notes).toBeNull();
  }, 20_000);

  it.each(['project_id', 'user_id'] as const)('rejects stale RBAC authority after a membership rekeys its %s into the predicate', async key => {
    const f = ids(), memberId = randomUUID(), release = latch(), rekeyed = signal<AuthTransaction>();
    await first!`insert into public.project_members(id,tenant_id,project_id,user_id,project_role,permissions,is_active)
      values (${memberId},${f.tenant},${key === 'project_id' ? f.otherProject : f.project},
        ${key === 'user_id' ? f.otherActor : f.actor},'viewer','[]'::jsonb,true)`;
    const membership = outcome(secondDb.transaction(async tx => {
      if (key === 'project_id') await tx.execute(sql`update public.project_members set project_id=${f.project} where id=${memberId}`);
      else await tx.execute(sql`update public.project_members set user_id=${f.actor} where id=${memberId}`);
      rekeyed.resolve(tx); await release.promise;
    }));
    let decision: Promise<Outcome<unknown>> | undefined;
    try {
      const holder = await ready(rekeyed.promise, membership);
      decision = outcome(firstDb.transaction(async tx => {
        await lockWriterRows(tx);
        const access = await authorize(tx);
        await writeAuthorizedMarker(tx, 'UNSAFE: authority committed after membership rekey');
        return access;
      }, { isolationLevel: 'serializable' }));
      await waitForBlockerOrCompletion(holder, decision);
    } finally { release.release(); await Promise.all([membership, decision]); }
    expect(await membership).toMatchObject({ ok: true });
    if (!decision) throw new Error('Authorization transaction did not start');
    const result = await decision;
    expect(result.ok, `Stale authorization after ${key} rekey committed`).toBe(false);
    if (!result.ok) expect(errorCode(result.error)).toBe('40001');
    expect((await first!`select notes from public.estimate_drafts where id=${f.draft}`)[0].notes).toBeNull();
    const fresh = await outcome(freshAuthorization());
    expect(fresh.ok).toBe(false);
    if (!fresh.ok) expect(errorCode(fresh.error)).toBe('FORBIDDEN');
  }, 20_000);

  it('retries the complete coordinator operation after a real parent version conflict, then denies the new restriction', async () => {
    const f = ids(), release = latch(), inserted = signal<AuthTransaction>();
    const membership = outcome(secondDb.transaction(async tx => {
      await insertRestrictiveMember(tx);
      inserted.resolve(tx); await release.promise;
    }));
    let decision: Promise<Outcome<unknown>> | undefined;
    let attempts = 0;
    const snapshots: string[] = [], attemptCodes: string[] = [];
    try {
      const holder = await ready(inserted.promise, membership);
      // Only the outer coordinator may resolve getDb, once. The real guard must
      // still use its passed transaction; another getDb call retains the trap.
      vi.mocked(getDb).mockResolvedValueOnce(firstDb);
      decision = outcome(withInternalApprovalTransaction(async tx => {
        attempts++;
        snapshots.push((await tx.execute<{ snapshot: string }>(sql`select pg_current_snapshot()::text as snapshot`))[0].snapshot);
        try {
          await lockWriterRows(tx);
          const access = await authorize(tx);
          await writeAuthorizedMarker(tx, 'UNSAFE: stale coordinator authorization');
          return access;
        } catch (error) { attemptCodes.push(errorCode(error) ?? 'unknown'); throw error; }
      }));
      await waitForBlocker(holder, firstPid, secondPid);
    } finally { release.release(); await Promise.all([membership, decision]); }
    expect(await membership).toMatchObject({ ok: true });
    if (!decision) throw new Error('Coordinator operation did not start');
    expect(await decision).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(attempts).toBe(2);
    expect(attemptCodes).toEqual(['40001', 'FORBIDDEN']);
    expect(new Set(snapshots).size).toBe(2);
    expect(getDb).toHaveBeenCalledTimes(1);
    expect((await first!`select notes from public.estimate_drafts where id=${f.draft}`)[0].notes).toBeNull();
  }, 20_000);

  it('allows authority after the pending membership and its parent version are rolled back', async () => {
    const f = ids(), release = latch(), inserted = signal<AuthTransaction>();
    const rollback = new Error('Synthetic membership rollback');
    const [before] = await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`;
    const membership = outcome(secondDb.transaction(async tx => {
      await insertRestrictiveMember(tx);
      inserted.resolve(tx); await release.promise; throw rollback;
    }));
    let decision: Promise<Outcome<unknown>> | undefined;
    try {
      const holder = await ready(inserted.promise, membership);
      decision = outcome(firstDb.transaction(async tx => {
        await lockWriterRows(tx);
        const access = await authorize(tx);
        await writeAuthorizedMarker(tx, 'Synthetic action after membership rollback');
        return access;
      }, { isolationLevel: 'serializable' }));
      await waitForBlocker(holder, firstPid, secondPid);
    } finally { release.release(); await Promise.all([membership, decision]); }
    expect(await membership).toEqual({ ok: false, error: rollback });
    expect(await decision).toMatchObject({ ok: true, value: { via: 'tenant_rbac' } });
    expect((await first!`select count(*)::int as count from public.project_members where project_id=${f.project}`)[0].count).toBe(0);
    expect((await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`)[0]).toEqual(before);
  }, 20_000);

  it('creates only an MVCC version on insert and leaves every visible project value unchanged', async () => {
    const f = ids();
    const [before] = await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`;
    await secondDb.transaction(tx => insertRestrictiveMember(tx));
    const [after] = await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`;
    expect(after.visible).toEqual(before.visible);
    expect(after.version).not.toBe(before.version);
  }, 20_000);

  it('does not create a parent version for an unchanged key, permission change, status change, tenant change or deletion', async () => {
    const f = ids();
    await firstDb.transaction(tx => insertRestrictiveMember(tx));
    const [before] = await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`;
    await second!`update public.project_members set project_id=project_id,user_id=user_id where project_id=${f.project}`;
    await second!`update public.project_members set permissions='["read"]'::jsonb where project_id=${f.project}`;
    await second!`update public.project_members set is_active=false where project_id=${f.project}`;
    await second!`update public.project_members set tenant_id=null where project_id=${f.project}`;
    await second!`delete from public.project_members where project_id=${f.project}`;
    expect((await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`)[0]).toEqual(before);
  }, 20_000);

  it('rolls back the parent version when a membership insert fails its unique constraint', async () => {
    const f = ids();
    await firstDb.transaction(tx => insertRestrictiveMember(tx));
    const [before] = await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`;
    const duplicate = await outcome(secondDb.transaction(tx => insertRestrictiveMember(tx)));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(errorCode(duplicate.error)).toBe('23505');
    expect((await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`)[0]).toEqual(before);
  }, 20_000);

  it.each(['permission', 'status', 'tenant', 'delete'] as const)('holds existing membership against concurrent %s withdrawal until the authorized transaction ends', async change => {
    const f = ids(), memberId = randomUUID(), release = latch(), locked = signal<AuthTransaction>();
    await first!`delete from public.role_permissions where id=${f.grant}`;
    await first!`insert into public.project_members(id,tenant_id,project_id,user_id,project_role,permissions,is_active)
      values (${memberId},${f.tenant},${f.project},${f.actor},'viewer','["approve"]'::jsonb,true)`;
    const decision = outcome(firstDb.transaction(async tx => {
      await lockWriterRows(tx);
      const access = await authorize(tx);
      await writeAuthorizedMarker(tx, 'Synthetic action before membership withdrawal');
      locked.resolve(tx); await release.promise;
      return access;
    }, { isolationLevel: 'serializable' }));
    let withdrawal: Promise<Outcome<unknown>> | undefined;
    try {
      const holder = await ready(locked.promise, decision);
      withdrawal = outcome(secondDb.transaction(async tx => {
        if (change === 'permission') await tx.execute(sql`update public.project_members set permissions='[]'::jsonb where id=${memberId}`);
        if (change === 'status') await tx.execute(sql`update public.project_members set is_active=false where id=${memberId}`);
        if (change === 'tenant') await tx.execute(sql`update public.project_members set tenant_id=null where id=${memberId}`);
        if (change === 'delete') await tx.execute(sql`delete from public.project_members where id=${memberId}`);
      }));
      await waitForBlocker(holder, secondPid, firstPid);
    } finally { release.release(); await Promise.all([decision, withdrawal]); }
    expect(await decision).toMatchObject({ ok: true, value: { via: 'member' } });
    expect(await withdrawal).toMatchObject({ ok: true });
    const next = await outcome(freshAuthorization());
    expect(next.ok).toBe(false);
    if (!next.ok) expect(errorCode(next.error)).toBe('FORBIDDEN');
  }, 20_000);

  it('does not block ordinary membership insertion on another project', async () => {
    const f = ids(), release = latch(), locked = signal<AuthTransaction>();
    const decision = outcome(firstDb.transaction(async tx => {
      await lockWriterRows(tx);
      const access = await authorize(tx);
      locked.resolve(tx); await release.promise;
      return access;
    }, { isolationLevel: 'serializable' }));
    let membership: Promise<Outcome<unknown>> | undefined;
    try {
      await ready(locked.promise, decision);
      membership = outcome(second!`insert into public.project_members(id,tenant_id,project_id,user_id,project_role,permissions,is_active)
        values (${randomUUID()},${f.tenant},${f.otherProject},${f.actor},'viewer','[]'::jsonb,true)`);
      expect(await bounded(membership, 'unrelated project membership commit')).toMatchObject({ ok: true });
    } finally { release.release(); await Promise.all([decision, membership]); }
    expect(await decision).toMatchObject({ ok: true, value: { via: 'tenant_rbac' } });
  }, 20_000);

  it('fails the membership insert without project UPDATE privilege and leaves no synthetic role or grant', async () => {
    const f = ids(), roleName = 'a1_acl_' + randomUUID().replaceAll('-', '_');
    const rollback = new Error('Rollback all synthetic ACL fixture DDL');
    let insertSucceeded = false, insertError: unknown;
    const [before] = await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`;
    const result = await outcome(firstDb.transaction(async tx => {
      await tx.execute(sql.raw(`create role ${roleName} nologin nosuperuser nobypassrls nocreaterole nocreatedb noinherit`));
      await tx.execute(sql.raw(`grant usage on schema public to ${roleName}`));
      await tx.execute(sql.raw(`grant select on public.projects to ${roleName}`));
      await tx.execute(sql.raw(`grant insert on public.project_members to ${roleName}`));
      await tx.execute(sql.raw(`set local role ${roleName}`));
      const [rights] = await tx.execute<{ can_insert: boolean; can_update: boolean }>(sql`
        select has_table_privilege(current_user,'public.project_members','INSERT') as can_insert,
          has_table_privilege(current_user,'public.projects','UPDATE') as can_update`);
      expect(rights).toEqual({ can_insert: true, can_update: false });
      try { await insertRestrictiveMember(tx); insertSucceeded = true; }
      catch (error) { insertError = error; }
      throw rollback;
    }));
    expect(result).toEqual({ ok: false, error: rollback });
    expect((await first!`select count(*)::int as count from pg_roles where rolname=${roleName}`)[0].count).toBe(0);
    expect((await first!`select count(*)::int as count from public.project_members where project_id=${f.project}`)[0].count).toBe(0);
    expect((await first!`select xmin::text as version,to_jsonb(p) as visible from public.projects p where id=${f.project}`)[0]).toEqual(before);
    expect(insertSucceeded).toBe(false);
    expect(errorCode(insertError)).toBe('42501');
  }, 20_000);

  it('installs an enabled before-row invoker trigger with a fixed search path', async () => {
    const rows = await first!`select t.tgtype::int as kind,t.tgenabled as enabled,p.prosecdef as definer,p.proconfig as config
      from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid='public.project_members'::regclass and t.tgname='a1_membership_parent_version'`;
    expect(rows).toHaveLength(1);
    // ROW(1) | BEFORE(2) | INSERT(4) | UPDATE(16); no DELETE or TRUNCATE.
    expect(rows[0]).toEqual({ kind: 23, enabled: 'O', definer: false, config: ['search_path=pg_catalog'] });
  }, 20_000);
});
