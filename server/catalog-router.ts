import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { getCatalogItems, getCatalogGroups, getCatalogItemById, getCatalogStats } from "./db";

export const catalogRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        costGroupName: z.string().optional(),
        search: z.string().optional(),
        costCode: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => getCatalogItems(input ?? undefined)),

  groups: protectedProcedure.query(() => getCatalogGroups()),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => getCatalogItemById(input.id)),

  stats: protectedProcedure.query(() => getCatalogStats()),
});
