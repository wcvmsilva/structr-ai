/**
 * structr.ai — Client tRPC Router (Sprint 10)
 *
 * Procedures:
 *   - client.create       (protected) → create new client
 *   - client.getById      (protected) → get client by id
 *   - client.list         (protected) → list clients with search/filter/pagination
 *   - client.update       (protected) → update client fields
 *   - client.delete       (admin)     → soft delete client
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
import { normalizeChannel } from "@shared/domain/normalization";

const channelEnum = z.enum(["direct", "insurance", "commercial"]);

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
  county: z.string().max(128).nullish(),
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
  channel: channelEnum.optional(),
  source: z.string().max(100).nullish(),
  notes: z.string().nullish(),
});

const updateClientSchema = createClientSchema.partial();

export const clientRouter = router({
  create: protectedProcedure
    .input(createClientSchema)
    .mutation(async ({ input, ctx }) => {
      // Sprint 18.5: Normalize channel at router boundary
      const normalized = {
        ...input,
        ...(input.channel ? { channel: (normalizeChannel(input.channel) ?? input.channel) as typeof input.channel } : {}),
      };
      return createClient(normalized, ctx.user.id);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const client = await getClientById(input.id);
      if (!client) throw new Error(`Client ${input.id} not found`);
      return client;
    }),

  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        channel: z.string().optional(),
        includeDeleted: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      // Sprint 18.5: Normalize channel filter
      const normalized = input ? {
        ...input,
        ...(input.channel ? { channel: normalizeChannel(input.channel) ?? input.channel } : {}),
      } : {};
      return listClients(normalized);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        data: updateClientSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Sprint 18.5: Normalize channel at router boundary
      const normalizedData = {
        ...input.data,
        ...(input.data.channel ? { channel: (normalizeChannel(input.data.channel) ?? input.data.channel) as typeof input.data.channel } : {}),
      };
      return updateClient(input.id, normalizedData, ctx.user.id);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
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
