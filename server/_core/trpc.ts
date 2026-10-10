import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { isAuthenticatedDataApiMode, isIntakeFormationEnabled, isScopeWorkspaceReadEnabled } from "./database-mode";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
// All bases share this boundary, including pre-tenant/public procedures. The
// bounded pilot reads only these existing paths; the single IF-1 mutation
// below additionally requires its own explicit server gate.
const dataApiPaths = new Set(["auth.me", "auth.session", "estimate.getInternalApprovalReview", "estimate.getById", "estimate.getInternalApproval"]);
const gatedDataApiQueries = new Map<string, () => boolean>([["scopeGeneration.loadWorkspace", isScopeWorkspaceReadEnabled]]);
// IF-1: the single mutation this boundary may admit, and only while its own
// server gate is open. A Map keeps the lookup immune to prototype-shaped paths.
const dataApiMutations = new Map<string, () => boolean>([["intake.create", isIntakeFormationEnabled]]);
const baseProcedure = t.procedure.use(async ({ path, type, next }) => {
  if (isAuthenticatedDataApiMode()) {
    const gate = type === "mutation" ? dataApiMutations.get(path) : undefined;
    const readGate = type === "query" ? gatedDataApiQueries.get(path) : undefined;
    const admitted = type === "query"
      ? dataApiPaths.has(path) || (readGate !== undefined && readGate())
      : gate !== undefined && gate();
    if (!admitted) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Procedure is unavailable in authenticated data API mode" });
    }
  }
  return next();
});
export const publicProcedure = baseProcedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = baseProcedure.use(requireUser);

/**
 * B2 (Codex P1-1) — tenant-aware business boundary.
 *
 * An authenticated caller whose tenant cannot be resolved is rejected here, loudly,
 * before any business helper runs. Silent empty results are deliberately avoided: an
 * unprovisioned account and a tenant with no data produce identical empty screens, and
 * only the rejection is diagnosable.
 *
 * This guard is for TENANT-SCOPED BUSINESS operations. It is deliberately NOT applied to
 * the named pre-tenant carve-outs (auth.*, system.health, tenantSettings.provision),
 * which must stay reachable before a tenant exists. It is not an admin, dev or role
 * bypass and confers no access of its own.
 */
export const TENANT_UNRESOLVED_ERR_MSG =
  "No tenant is assigned to this account (10005)";

const requireTenant = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  if (!ctx.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: TENANT_UNRESOLVED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      tenantId: ctx.tenantId,
    },
  });
});

export const tenantProcedure = baseProcedure.use(requireTenant);

export const adminProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

/**
 * Admin role AND a resolved tenant. Used by tenant-scoped admin operations (e.g.
 * `clients.delete`) which are administrative *within* a tenant, not platform-wide.
 * Explicitly NOT a bypass: it is strictly narrower than both of its parents.
 */
export const adminTenantProcedure = tenantProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  return next();
});

const CANONICAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Protected bootstrap identity shared by the separately gated IF-1 and SWR-1 paths.
 *
 * Returns the actor/tenant pair only when this request carries a consistent
 * DB-authenticated bootstrap session: the protected profile the Data API resolved
 * must be the current user, active, in the resolved tenant, under the Supabase
 * provider. Anything absent, inactive or mismatched yields null, so the caller
 * refuses before the RPC instead of sending an identity it cannot vouch for.
 *
 * This is NOT an authorization decision and confers nothing: the authenticated
 * transaction revalidates protected identity and RBAC in SQL, which stays the
 * final authority, including for direct RPC calls.
 */
export function resolveAuthenticatedDataApiIdentity(
  ctx: TrpcContext,
): { actorId: string; tenantId: string } | null {
  const session = ctx.authenticatedDataApiSession;
  if (!session || ctx.authProvider !== "supabase") return null;
  const actorId = ctx.user?.id;
  const tenantId = ctx.tenantId;
  if (!actorId || !tenantId) return null;
  if (!CANONICAL_ID.test(actorId) || !CANONICAL_ID.test(tenantId)) return null;
  if (actorId === NIL_ID || tenantId === NIL_ID) return null;
  if (ctx.user?.isActive !== true || session.profile.isActive !== true) return null;
  if (session.profile.id !== actorId || session.profile.tenantId !== tenantId) return null;
  if (session.tenantId !== tenantId || ctx.user?.tenantId !== tenantId) return null;
  return { actorId, tenantId };
}

/** Preserve the IF-1 helper API; this checks identity, never operation authority. */
export const resolveAuthenticatedIntakeIdentity = resolveAuthenticatedDataApiIdentity;
