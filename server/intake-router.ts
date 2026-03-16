/**
 * structr.ai — Intake tRPC Router (Sprint 10)
 *
 * Procedures:
 *   - intake.create         (protected) → create new intake form
 *   - intake.getById        (protected) → get intake form by id
 *   - intake.list           (protected) → list intake forms with filter/pagination
 *   - intake.update         (protected) → update intake form fields
 *   - intake.updateStatus   (protected) → change intake status (state machine)
 *   - intake.getByProject   (protected) → list intake forms for a project
 *   - intake.getByClient    (protected) → list intake forms for a client
 *   - intake.stats          (protected) → aggregate stats
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { normalizeChannel, normalizeFinishLevel, normalizeServiceType, normalizeCondition } from "@shared/domain/normalization";
import {
  createIntakeForm,
  getIntakeFormById,
  listIntakeForms,
  updateIntakeForm,
  updateIntakeStatus,
  getIntakeFormsByProject,
  getIntakeFormsByClient,
  getIntakeStats,
} from "./intake-db";

// Canonical channel enum — "direct" replaces legacy "residential"
const channelEnum = z.enum(["direct", "insurance", "commercial"]);
const finishLevelEnum = z.enum(["standard", "premium", "luxury"]);
const intakeStatusEnum = z.enum(["received", "parsing", "parsed", "reviewed", "converted"]);

const createIntakeSchema = z.object({
  projectId: z.number().int().positive().nullish(),
  clientId: z.number().int().positive().nullish(),
  channel: channelEnum.optional(),
  serviceType: z.string().max(128).nullish(),
  area: z.string().max(255).nullish(),
  finishLevel: finishLevelEnum.optional(),
  condition: z.string().max(255).nullish(),
  notes: z.string().nullish(),
  rawPayload: z.record(z.string(), z.unknown()),
});

const updateIntakeSchema = z.object({
  projectId: z.number().int().positive().nullish(),
  clientId: z.number().int().positive().nullish(),
  channel: channelEnum.optional(),
  serviceType: z.string().max(128).nullish(),
  area: z.string().max(255).nullish(),
  finishLevel: finishLevelEnum.optional(),
  condition: z.string().max(255).nullish(),
  notes: z.string().nullish(),
  rawPayload: z.record(z.string(), z.unknown()).optional(),
  parsedScope: z.record(z.string(), z.unknown()).nullish(),
  confidenceScore: z.string().nullish(),
});

export const intakeRouter = router({
  create: protectedProcedure
    .input(createIntakeSchema)
    .mutation(async ({ input, ctx }) => {
      const normalized = {
        ...input,
        channel: (normalizeChannel(input.channel) ?? input.channel) as any,
        finishLevel: (normalizeFinishLevel(input.finishLevel) ?? input.finishLevel) as any,
        serviceType: normalizeServiceType(input.serviceType) ?? input.serviceType,
        condition: normalizeCondition(input.condition) ?? input.condition,
      };
      return createIntakeForm(normalized, ctx.user.id);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const form = await getIntakeFormById(input.id);
      if (!form) throw new Error(`Intake form ${input.id} not found`);
      return form;
    }),

  list: protectedProcedure
    .input(
      z.object({
        status: z.string().optional(),
        channel: z.string().optional(),
        projectId: z.number().int().positive().optional(),
        clientId: z.number().int().positive().optional(),
        serviceType: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      return listIntakeForms(input ?? {});
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        data: updateIntakeSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return updateIntakeForm(input.id, input.data, ctx.user.id);
    }),

  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: intakeStatusEnum,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return updateIntakeStatus(input.id, input.status, ctx.user.id);
    }),

  getByProject: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getIntakeFormsByProject(input.projectId);
    }),

  getByClient: protectedProcedure
    .input(z.object({ clientId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getIntakeFormsByClient(input.clientId);
    }),

  stats: protectedProcedure.query(async () => {
    return getIntakeStats();
  }),
});
