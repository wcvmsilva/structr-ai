import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

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

export const protectedProcedure = t.procedure.use(requireUser);

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

export const tenantProcedure = t.procedure.use(requireTenant);

export const adminProcedure = t.procedure.use(
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
