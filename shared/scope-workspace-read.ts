import { z } from "zod";
import {
  ADR002_PROTOCOL,
  SCOPE_WORKSPACE_LOAD_STATES,
} from "./domain/taxonomy";

export const SCOPE_WORKSPACE_RESPONSE_BYTE_LIMIT = 1_048_576;
export const SCOPE_WORKSPACE_TEXT_BYTE_LIMIT = 65_536;
const encoder = new TextEncoder();
const validUnicode = (value: string) => !/[\u0000\uD800-\uDFFF]/u.test(value);

/** Inspect descriptors before Zod/JSON serialization can observe getter values. */
function plainJson(
  value: unknown,
  seen = new Set<object>(),
  depth = 0
): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return validUnicode(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (
      prototype !== Array.prototype ||
      keys.length !== value.length + 1 ||
      Object.keys(value).length !== value.length
    )
      return false;
  } else if (prototype !== Object.prototype && prototype !== null) return false;
  seen.add(value);
  for (const key of keys) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !validUnicode(key) ||
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      !plainJson(descriptor.value, seen, depth + 1)
    )
      return false;
  }
  seen.delete(value);
  return true;
}
const jsonData = z.unknown().refine(value => {
  try {
    return plainJson(value);
  } catch {
    return false;
  }
}, "Invalid JSON data");
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== "00000000-0000-0000-0000-000000000000");
const text = z
  .string()
  .refine(
    value =>
      validUnicode(value) &&
      encoder.encode(value).byteLength <= SCOPE_WORKSPACE_TEXT_BYTE_LIMIT
  );
const textOrNull = text.nullable();
const utcMillis = z
  .string()
  .refine(
    value =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value
  );

export const scopeWorkspaceReadCommandSchema = jsonData.pipe(
  z.object({ projectId: uuid, intakeFormId: uuid }).strict()
);
export const scopeWorkspaceReadIdentitySchema = jsonData.pipe(
  z.object({ actorId: uuid, tenantId: uuid }).strict()
);
const notLoaded = z
  .object({ state: z.enum(SCOPE_WORKSPACE_LOAD_STATES) })
  .strict();
/** The wire contains only persisted projections, never readiness or inferred defaults. */
export const scopeWorkspaceReadWireSchema = jsonData
  .pipe(
    z.unknown().refine(value => {
      try {
        return (
          encoder.encode(JSON.stringify(value)).byteLength <=
          SCOPE_WORKSPACE_RESPONSE_BYTE_LIMIT
        );
      } catch {
        return false;
      }
    })
  )
  .pipe(
    z
      .object({
        version: z.literal(ADR002_PROTOCOL.scopeWorkspaceRead),
        context: z.object({ actorId: uuid, tenantId: uuid }).strict(),
        project: z
          .object({
            id: uuid,
            tenantId: uuid,
            name: text,
            projectType: text,
            channel: textOrNull,
            status: text,
            address: textOrNull,
            city: textOrNull,
            state: textOrNull,
            zipCode: textOrNull,
            county: textOrNull,
            zone: textOrNull,
          })
          .strict(),
        intake: z
          .object({
            id: uuid,
            tenantId: uuid,
            projectId: uuid,
            status: text,
            serviceType: textOrNull,
            area: textOrNull,
            finishLevel: textOrNull,
            condition: textOrNull,
            channel: textOrNull,
            notes: textOrNull,
            createdAt: utcMillis,
            updatedAt: utcMillis,
          })
          .strict(),
        scopes: notLoaded,
        catalog: notLoaded,
      })
      .strict()
  );

export type ScopeWorkspaceReadCommand = z.infer<
  typeof scopeWorkspaceReadCommandSchema
>;
export type ScopeWorkspaceReadWire = z.infer<
  typeof scopeWorkspaceReadWireSchema
>;
export type ScopeWorkspaceRead = Omit<ScopeWorkspaceReadWire, "intake"> & {
  intake: Omit<ScopeWorkspaceReadWire["intake"], "createdAt" | "updatedAt"> & {
    createdAt: Date;
    updatedAt: Date;
  };
};
