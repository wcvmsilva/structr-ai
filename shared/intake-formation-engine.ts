import { z } from "zod";
import { CHANNELS, FINISH_LEVELS, PROJECT_TYPES } from "./domain/taxonomy";

export const createIntakeSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    newProject: z
      .object({
        name: z.string().trim().min(1).max(255),
        projectType: z.enum(PROJECT_TYPES),
        client: z.object({
          firstName: z.string().trim().min(1).max(128),
          lastName: z.string().trim().min(1).max(128),
          email: z.string().email().max(320).optional(),
          phone: z.string().max(64).optional(),
        }),
        address: z.string().trim().min(1).max(1000),
        city: z.string().max(128).optional(),
        county: z.string().max(128).optional(),
        state: z.string().max(2).optional(),
        zip: z.string().max(10).optional(),
      })
      .optional(),
    projectId: z.string().uuid().nullish(),
    leadId: z.string().uuid().nullish(),
    clientId: z.string().uuid().nullish(),
    channel: z.enum(CHANNELS).optional(),
    serviceType: z.string().max(128).nullish(),
    area: z.string().max(255).nullish(),
    finishLevel: z.enum(FINISH_LEVELS).optional(),
    condition: z.string().max(255).nullish(),
    notes: z.string().nullish(),
    rawPayload: z.record(z.string(), z.unknown()),
  })
  .superRefine((input, ctx) => {
    if (input.newProject && !input.serviceType?.trim())
      ctx.addIssue({
        code: "custom",
        message: "Service type is required for a new project.",
      });
    if (
      input.newProject &&
      (!input.requestId || input.projectId || input.clientId || input.leadId)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Combined creation requires a request ID and cannot include existing project, client, or lead IDs.",
      });
    }
  });

const identityId = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
  .refine(value => value !== "00000000-0000-0000-0000-000000000000");
const identitySchema = z
  .object({ actorId: identityId, tenantId: identityId })
  .strict();
function invalid(): never {
  throw new Error("Invalid intake formation input");
}
function validText(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit === 0 || (unit >= 0xdc00 && unit <= 0xdfff)) invalid();
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid();
    }
  }
}
/** JSON data only; inspect descriptors before Zod/JSON.stringify can run accessors. */
function jsonData(
  value: unknown,
  allowUndefined: boolean,
  depth = 0,
  seen = new Set<object>()
): void {
  if (value === undefined && allowUndefined) return;
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") return validText(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (typeof value !== "object" || seen.has(value) || depth >= 16) invalid();
  const proto = Object.getPrototypeOf(value),
    keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (
      proto !== Array.prototype ||
      keys.length !== value.length + 1 ||
      Object.keys(value).length !== value.length
    )
      invalid();
  } else if (proto !== Object.prototype && proto !== null) invalid();
  seen.add(value);
  for (const key of keys) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== "string" ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value")
    )
      invalid();
    if (
      Array.isArray(value) &&
      (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
    )
      invalid();
    validText(key);
    jsonData(descriptor.value, allowUndefined, depth + 1, seen);
  }
  seen.delete(value);
}

/** Candidate command only. No hashing, authorization, I/O or financial calculation. */
export function serializeIntakeFormationPreimage(
  input: unknown,
  identity: unknown
): string {
  jsonData(input, true);
  jsonData(identity, false);
  const context = identitySchema.safeParse(identity),
    parsed = createIntakeSchema.safeParse(input);
  if (
    !context.success ||
    !parsed.success ||
    !parsed.data.requestId ||
    !parsed.data.newProject
  )
    invalid();
  // z.record deliberately skips this root key. Refuse rather than silently lose
  // opaque input in this candidate; the legacy direct-mode schema stays unchanged.
  if (Object.hasOwn((input as { rawPayload: object }).rawPayload, "__proto__"))
    invalid();
  // Undefined optional command fields retain the legacy JSON.stringify omission;
  // opaque rawPayload must itself be JSON without lossy conversion.
  jsonData(parsed.data.rawPayload, false, 1);
  const preimage = JSON.stringify({
    ...parsed.data,
    tenantId: context.data.tenantId,
    userId: context.data.actorId,
  });
  if (new TextEncoder().encode(preimage).length > 65_536) invalid();
  return preimage;
}
