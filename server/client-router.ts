/**
 * structr.ai — Client tRPC Router (Sprint 10)
 *
 * Procedures:
 *   - client.create       (protected) → create new client
 *   - client.getById      (protected) → get client by id
 *   - client.list         (protected) → list clients with search/filter/pagination
 *   - client.update       (protected) → update client fields
 *   - client.delete       (admin)     → soft delete client (set isActive=false)
 *   - client.search       (protected) → quick search for autocomplete
 *   - client.stats        (protected) → aggregate stats
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
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

export const clientRouter = router({
  create: protectedProcedure
    .input(createClientSchema)
    .mutation(async ({ input, ctx }) => {
      return createClient(input, ctx.user.id);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const client = await getClientById(input.id);
      if (!client) throw new Error(`Client ${input.id} not found`);
      return client;
    }),

  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      return listClients(input);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: updateClientSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return updateClient(input.id, input.data, ctx.user.id);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return deleteClient(input.id, ctx.user.id);
    }),

  search: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      return searchClients(input.query);
    }),

  stats: protectedProcedure.query(async () => {
    return getClientStats();
  }),
});
