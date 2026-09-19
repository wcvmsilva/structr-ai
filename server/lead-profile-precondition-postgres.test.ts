import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { access } from "node:fs/promises";
import type postgres from "postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Profile } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { startProfileAclPostgres, type ProfileAclCluster, type ProfileAclConnection } from "./test-support/profile-acl-postgres";
import { initializeProfileAclFixture, resetProfileAclFixture, PROFILE_ACL_IDS as ids } from "./test-support/profile-acl-fixture";
import { applyProfileAclTreatment, readProfileAclState, profileAclDigest } from "./test-support/profile-acl-treatment";

const bound = vi.hoisted(() => ({ db: null as PostgresJsDatabase | null, failure: null as Error | null }));
vi.mock("./db", () => ({ getDb: async () => {
  if (bound.failure) throw bound.failure;
  return bound.db;
}, getRawClient: () => { throw new Error("Default raw client forbidden in owned laboratory"); } }));
vi.mock("dotenv", () => ({ config: () => ({}), default: { config: () => ({}) } }));
vi.mock("dotenv/config", () => ({}));
vi.mock("postgres", () => ({ default: () => { throw new Error("Use owned PostgreSQL factory only"); } }));

// Keep profile preconditions/writers REAL in both baseline and candidate. Only
// commercial duplicate/read/write boundaries are doubles: this is not a full
// PostgreSQL lead conversion or lead persistence test.
vi.mock("./lead-db", async importOriginal => ({
  ...await importOriginal<typeof import("./lead-db")>(),
  listLeads: vi.fn(async () => []),
  createLead: vi.fn(),
}));
import { leadRouter } from "./lead-router";
import * as leadDb from "./lead-db";
import { resolveProfileForSupabaseIdentity } from "./_core/auth/supabase-auth";

function profile(id: string, tenantId: string | null = ids.tenantA, role = "user"): Profile {
  return { id, tenantId, role, externalOpenId: id, fullName: "Synthetic Operator", companyName: "Lab",
    email: "operator@example.invalid", loginMethod: "lab", isActive: true,
    lastSignedIn: null, createdAt: new Date("2000-01-01T00:00:00Z"), updatedAt: new Date("2000-01-01T00:00:00Z") };
}

const identity = (sub: string) => ({ sub, email: null, fullName: null, provider: "lab", role: "authenticated", expiresAtMs: null, claims: { sub } });

describe.skipIf(process.env.PROFILE_ACL_LAB !== "1")("lead profile precondition — real PostgreSQL", () => {
  let cluster: ProfileAclCluster;
  let unprivileged: ProfileAclConnection;
  let initialState: Awaited<ReturnType<typeof readProfileAclState>>;
  const snapshot = async () => Array.from(await cluster.observer.sql`SELECT * FROM public.profiles ORDER BY id`);
  const caller = (user: Profile | null, tenantId: string | null = user?.tenantId ?? null) => leadRouter.createCaller({
    user, tenantId, req: {}, res: {},
  } as TrpcContext);
  const businessInput = { firstName: "Synthetic", lastName: "Lead" };
  const denied = async (user: Profile, tenantId = user.tenantId!, code = "FORBIDDEN") => {
    const before = await snapshot();
    let error: unknown;
    try { await caller(user, tenantId).create(businessInput); } catch (caught) { error = caught; }
    const after = await snapshot();
    // Log before asserting: on baseline the persisted admin row is evidence even
    // though the denial expectation fails. Synthetic IDs only, no real profiles.
    console.log("LEAD_PROFILE_OBSERVATION", JSON.stringify({
      actor: user.id, beforeCount: before.length, afterCount: after.length,
      beforeRole: before.find(row => row.id === user.id)?.role ?? null,
      afterRole: after.find(row => row.id === user.id)?.role ?? null,
      errorCode: (error as { code?: string } | undefined)?.code ?? null,
      duplicateCalls: vi.mocked(leadDb.listLeads).mock.calls.length,
      insertCalls: vi.mocked(leadDb.createLead).mock.calls.length,
    }));
    expect(error).toMatchObject({ code });
    expect(after).toEqual(before);
    expect(leadDb.listLeads).not.toHaveBeenCalled();
    expect(leadDb.createLead).not.toHaveBeenCalled();
    return error;
  };

  beforeAll(async () => {
    const actual = await vi.importActual<{ default: typeof postgres }>("postgres");
    cluster = await startProfileAclPostgres(actual.default);
    await initializeProfileAclFixture(cluster.observer.sql);
    await applyProfileAclTreatment(cluster);
    unprivileged = await cluster.connect("read-error-control");
    bound.db = cluster.observer.db;
    initialState = await readProfileAclState(cluster);
    const [runtime] = await cluster.observer.sql`SELECT version(), current_user, inet_server_addr(), current_setting('listen_addresses') AS listeners`;
    console.log("LEAD_PROFILE_RUNTIME", JSON.stringify(runtime));
    console.log("LEAD_PROFILE_ACL_DIGEST", profileAclDigest(initialState));
  }, 60_000);
  beforeEach(async () => {
    await resetProfileAclFixture(cluster.observer.sql);
    bound.db = cluster.observer.db;
    bound.failure = null;
    vi.mocked(leadDb.listLeads).mockClear();
    vi.mocked(leadDb.listLeads).mockResolvedValue([]);
    vi.mocked(leadDb.createLead).mockReset();
    vi.mocked(leadDb.createLead).mockImplementation(async data => ({
      ...data, id: "30000000-0000-4000-8000-000000000001",
    } as never));
  });
  afterAll(async () => {
    bound.db = null;
    bound.failure = null;
    if (cluster) {
      await cluster.stop();
      await expect(access(cluster.directory)).rejects.toMatchObject({ code: "ENOENT" });
      console.log("LEAD_PROFILE_CLEANUP", "owned PostgreSQL stopped and removed");
    }
  }, 20_000);

  it("unprovisioned Auth user cannot manufacture a profile/admin or continue to business helpers", async () => {
    await denied(profile(ids.unprovisioned));
  });
  it("synthetic dev admin context cannot materialize an admin profile", async () => {
    const dev = { ...profile(ids.unprovisioned, ids.tenantA, "admin"), externalOpenId: "dev-open-id", loginMethod: "dev" };
    await denied(dev);
  });
  it("persisted inactive profile is refused even if the request context is stale and active", async () => {
    await denied(profile(ids.inactiveA));
  });
  it("profile from tenant B is refused for trusted request tenant A", async () => {
    await denied(profile(ids.userB));
  });
  it("persisted NULL tenant cannot inherit a tenant from the request", async () => {
    await cluster.observer.sql`UPDATE public.profiles SET tenant_id=NULL WHERE id=${ids.userA}`;
    await denied(profile(ids.userA));
  });
  it("admin profile is refused after its persisted tenant changes away from the context", async () => {
    await cluster.observer.sql`UPDATE public.profiles SET tenant_id=${ids.tenantB} WHERE id=${ids.adminA}`;
    await denied(profile(ids.adminA, ids.tenantA, "admin"));
  });
  it.each([
    [ids.userA, ids.tenantA, "user"],
    [ids.adminA, ids.tenantA, "admin"],
    [ids.userB, ids.tenantB, "user"],
  ])("existing active %s proceeds with all profile fields unchanged", async (id, tenant, role) => {
    const before = await snapshot();
    const result = await caller(profile(id, tenant, role)).create(businessInput);
    expect(result).toMatchObject({ id: "30000000-0000-4000-8000-000000000001", ownerUserId: id, tenantId: tenant, name: "Synthetic Lead" });
    expect(await snapshot()).toEqual(before);
    expect(leadDb.listLeads).toHaveBeenCalledOnce();
    expect(leadDb.createLead).toHaveBeenCalledOnce();
    expect(leadDb.createLead).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: id, tenantId: tenant }), id);
  });
  it("UUID letter case does not turn a valid mapped tenant into another tenant", async () => {
    const id = "abcdef01-0000-4000-8000-000000000001";
    const tenant = "abcdef02-0000-4000-8000-000000000001";
    await cluster.observer.sql`INSERT INTO auth.users(id) VALUES(${id})`;
    await cluster.observer.sql`INSERT INTO public.tenants(id) VALUES(${tenant})`;
    await cluster.observer.sql`INSERT INTO public.profiles(id,tenant_id,external_open_id,role,is_active) VALUES(${id},${tenant},${id},'user',true)`;
    const before = await snapshot();
    const result = await caller(profile(id.toUpperCase(), tenant.toUpperCase())).create(businessInput);
    expect(result).toMatchObject({ ownerUserId: id.toUpperCase(), tenantId: tenant.toUpperCase() });
    expect(await snapshot()).toEqual(before);
  });
  it("missing DB refuses before duplicate/insert without fabricating identity", async () => {
    bound.db = null;
    const error = await denied(profile(ids.userA), ids.tenantA, "INTERNAL_SERVER_ERROR");
    expect((error as Error).message).not.toMatch(/DATABASE_URL|postgres:\/\//i);
  });
  it("DB acquisition failure is sanitized and cannot become warning-and-continue", async () => {
    bound.failure = new Error("SELECT private_secret FROM profiles; postgres://lab-secret@example.invalid");
    const error = await denied(profile(ids.userA), ids.tenantA, "INTERNAL_SERVER_ERROR");
    expect((error as Error).message).not.toMatch(/private_secret|SELECT|lab-secret/);
    expect((error as Error).cause).toBeUndefined();
  });
  it("actual database read permission failure blocks the request without exposing SQL", async () => {
    bound.db = unprivileged.db;
    const error = await denied(profile(ids.userA), ids.tenantA, "INTERNAL_SERVER_ERROR");
    expect((error as Error).message).not.toMatch(/SELECT|permission denied|profiles|42501/i);
  });
  it("known profile with different external ID retains its internal identity without rewriting fields", async () => {
    await cluster.observer.sql`UPDATE public.profiles SET external_open_id=${ids.differentExternal} WHERE id=${ids.userA}`;
    const resolved = await resolveProfileForSupabaseIdentity(identity(ids.differentExternal));
    expect(resolved.id).toBe(ids.userA);
    const before = await snapshot();
    await caller(resolved).create(businessInput);
    expect(await snapshot()).toEqual(before);
    expect(leadDb.createLead).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: ids.userA, tenantId: ids.tenantA }), ids.userA);
  });
  it("retains lookup-only resolver denial for unprovisioned and inactive identities", async () => {
    const before = await snapshot();
    await expect(resolveProfileForSupabaseIdentity(identity(ids.unprovisioned))).rejects.toThrow("not provisioned");
    await expect(resolveProfileForSupabaseIdentity(identity(ids.inactiveA))).rejects.toThrow("disabled");
    expect(await snapshot()).toEqual(before);
  });
  it("retains own-profile RLS reads, denies foreign reads and prevents direct/RPC promotion", async () => {
    const before = await snapshot();
    const asUser = <T>(fn: (sql: postgres.TransactionSql) => Promise<T>) => unprivileged.sql.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx.unsafe("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: ids.userA, role: "authenticated" })]);
      return fn(tx);
    });
    const own = await asUser(tx => tx.unsafe("SELECT id FROM public.profiles"));
    expect(Array.from(own)).toEqual([{ id: ids.userA }]);
    await expect(asUser(tx => tx.unsafe("UPDATE public.profiles SET role='admin' WHERE id=$1", [ids.userA]))).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(tx => tx.unsafe("SELECT public.setup_admin_user()"))).rejects.toMatchObject({ code: "42501" });
    expect(await snapshot()).toEqual(before);
  });
  it("does not alter ACLs, schema, roles, policies, function bodies or identity constraints", async () => {
    await caller(profile(ids.userA)).create(businessInput);
    expect(await readProfileAclState(cluster)).toEqual(initialState);
  });
});
