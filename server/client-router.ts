/**
 * structr.ai — Client tRPC Router (Sprint 10)
 *
 * Procedures:
 *   - client.create       (client:write) → create new client
 *   - client.getById      (client:read)  → get client by id
 *   - client.list         (client:read)  → list clients with search/filter/pagination
 *   - client.update       (client:write) → update client fields
 *   - client.delete       (admin)        → soft delete client (set isActive=false)
 *   - client.search       (client:read)  → quick search for autocomplete
 *   - client.stats        (client:read)  → aggregate stats
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { requirePermission } from "./rbac";
import {
  createClient,
  getClientById,
  listClients,
  updateClient,
  deleteClient,
  searchClients,
  getClientStats,
} from "./client-db";

const createClientSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  companyName: z.string().max(160).nullish(),
  email: z.string().email().max(255).nullish(),
  phone: z.string().max(30).nullish(),
  address: z.string().nullish(),
  city: z.string().max(128).nullish(),
  state: z.string().max(2).nullish(),
  zip: z.string().max(10).nullish(),
  billingAddressLine1: z.string().max(255).nullish(),
  billingAddressLine2: z.string().max(255).nullish(),
  billingCity: z.string().max(128).nullish(),
  billingState: z.string().max(2).nullish(),
  billingZip: z.string().max(10).nullish(),
  shippingAddressLine1: z.string().max(255).nullish(),
  shippingAddressLine2: z.string().max(255).nullish(),
  shippingCity: z.string().max(128).nullish(),
  shippingState: z.string().max(2).nullish(),
  shippingZip: z.string().max(10).nullish(),
  notes: z.string().nullish(),
});

const updateClientSchema = createClientSchema.partial();

/**
 * RBAC gate for the CRM client domain.
 *
 * These procedures ran on bare `protectedProcedure` — authenticated was the only
 * check — even though the seeded RBAC model defines `client:read` / `client:write`
 * / `client:delete` and withholds `client:write` from the read-only `viewer` and
 * `reviewer` roles. A read-only user could therefore create and modify any client
 * record. This binds each procedure to the permission the model already declares.
 *
 * Refuses on `requirePermission`'s "denied" only: a caller whose role the model does
 * not govern for `client` (the default `'user'` role, a missing profile, an unseeded
 * RBAC table, no database) is "unenforced" and keeps exactly today's access. See
 * `PermissionDecision` in ./rbac.
 *
 * Tenant scoping is a separate, already-enforced concern: every procedure below
 * threads `{ tenantId: ctx.tenantId }` into the data layer, which requires it.
 */
function clientProcedure(action: "read" | "write") {
  return protectedProcedure.use(async ({ ctx, next }) => {
    // Platform admins hold every permission in the model; skip the lookup.
    if (ctx.user.role !== "admin") {
      await requirePermission(ctx.user.id, "client", action);
    }
    return next();
  });
}

const clientReadProcedure = clientProcedure("read");
const clientWriteProcedure = clientProcedure("write");

export const clientRouter = router({
  create: clientWriteProcedure
    .input(createClientSchema)
    .mutation(async ({ input, ctx }) => {
      return createClient(input, { tenantId: ctx.tenantId }, ctx.user.id);
    }),

  getById: clientReadProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const client = await getClientById(input.id, { tenantId: ctx.tenantId });
      if (!client) throw new Error(`Client ${input.id} not found`);
      return client;
    }),

  list: clientReadProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      return listClients({ tenantId: ctx.tenantId }, input);
    }),

  update: clientWriteProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateClientSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return updateClient(input.id, input.data, { tenantId: ctx.tenantId }, ctx.user.id);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return deleteClient(input.id, { tenantId: ctx.tenantId }, ctx.user.id);
    }),

  search: clientReadProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ input, ctx }) => {
      return searchClients(input.query, { tenantId: ctx.tenantId });
    }),

  stats: clientReadProcedure.query(async ({ ctx }) => {
    return getClientStats({ tenantId: ctx.tenantId });
  }),
});
