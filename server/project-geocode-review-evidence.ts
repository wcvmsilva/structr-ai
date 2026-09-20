/** Pure provenance grammar: equality to captured input is evidence, never authorization. */
import { z } from "zod";
import type { Project } from "../drizzle/schema";
import type { GeocodeResult } from "./geo-geocoding";
import type { ZoneDetectionResult } from "../shared/geo-engine";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";
function unresolved(): never {
  throw new InternalApprovalError("POLICY_CONTEXT_UNRESOLVED");
}
/** Validate descriptors before reading values so persisted JSON cannot hide getters/prototype state. */
export function assertPlainData(
  value: unknown,
  allowDate = false,
  seen = new Set<object>(),
  depth = 0
): void {
  if (depth > 32) unresolved();
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) unresolved();
    return;
  }
  if (
    allowDate &&
    value instanceof Date &&
    Object.getPrototypeOf(value) === Date.prototype &&
    Reflect.ownKeys(value).length === 0 &&
    Number.isFinite(Date.prototype.getTime.call(value))
  )
    return;
  if (typeof value !== "object" || seen.has(value)) unresolved();
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (
      proto !== Array.prototype ||
      Object.keys(value).length !== value.length ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      unresolved();
  } else if (proto !== Object.prototype && proto !== null) unresolved();
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value"))
      unresolved();
    assertPlainData(d.value, allowDate, seen, depth + 1);
  }
  seen.delete(value);
}
const uuid = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/)
  .refine(v => v !== "00000000-0000-0000-0000-000000000000");
const timestamp = z
  .string()
  .refine(
    v =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString() === v
  );
const addressSchema = z
  .object({
    address: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    zipCode: z.string().nullable(),
    county: z.string().nullable(),
  })
  .strict();
const evidenceSchema = z
  .object({
    version: z.literal("project-geocode-review-v1"),
    projectId: uuid,
    tenantId: uuid,
    inputAddress: addressSchema,
    geocodedAt: timestamp,
    geocode: z
      .object({
        success: z.boolean(),
        latitude: z.number().finite().min(-90).max(90).nullable(),
        longitude: z.number().finite().min(-180).max(180).nullable(),
        formattedAddress: z.string().nullable(),
        confidence: z.union([
          z.literal("high"),
          z.literal("medium"),
          z.literal("low"),
          z.literal("failed"),
        ]),
        source: z.union([
          z.literal("google_maps"),
          z.literal("manual"),
          z.literal("zip_centroid"),
        ]),
        withinServiceRadius: z.boolean(),
      })
      .strict(),
    zoneDetection: z
      .object({
        zoneId: uuid,
        method: z.union([
          z.literal("coordinates"),
          z.literal("zip"),
          z.literal("default"),
        ]),
        confidence: z.union([
          z.literal("high"),
          z.literal("medium"),
          z.literal("low"),
        ]),
      })
      .strict(),
  })
  .strict();
export type ProjectGeocodeAddress = z.infer<typeof addressSchema>;
export type ProjectGeocodeReviewEvidence = z.infer<typeof evidenceSchema>;
export function captureProjectGeocodeAddress(
  project: Pick<Project, "address" | "city" | "state" | "zip" | "county">
): ProjectGeocodeAddress {
  const address = {
    address: project.address,
    city: project.city,
    state: project.state,
    zipCode: project.zip,
    county: project.county,
  };
  const result = addressSchema.safeParse(address);
  if (!result.success) unresolved();
  return result.data;
}
export function sameProjectGeocodeAddress(
  project: Pick<Project, "address" | "city" | "state" | "zip" | "county">,
  address: ProjectGeocodeAddress
): boolean {
  const current = captureProjectGeocodeAddress(project);
  return (Object.keys(current) as (keyof ProjectGeocodeAddress)[]).every(
    k => current[k] === address[k]
  );
}
export function stripGeocodeReviewEvidence(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return value;
  const { reviewEvidence: _discard, ...snapshot } = value as Record<
    string,
    unknown
  >;
  return snapshot;
}
export function createProjectGeocodeReviewEvidence(input: {
  projectId: string;
  tenantId: string;
  inputAddress: ProjectGeocodeAddress;
  geocodedAt: Date;
  geocode: GeocodeResult;
  zoneDetection: ZoneDetectionResult;
}): ProjectGeocodeReviewEvidence {
  const { geocode: g, zoneDetection: d } = input;
  const value = {
    version: "project-geocode-review-v1",
    projectId: input.projectId,
    tenantId: input.tenantId,
    inputAddress: input.inputAddress,
    geocodedAt: input.geocodedAt.toISOString(),
    geocode: {
      success: g.success,
      latitude: g.latitude,
      longitude: g.longitude,
      formattedAddress: g.formattedAddress,
      confidence: g.confidence,
      source: g.source,
      withinServiceRadius: g.withinServiceRadius,
    },
    zoneDetection: {
      zoneId: d.zone?.id,
      method: d.method,
      confidence: d.confidence,
    },
  };
  assertPlainData(value);
  const result = evidenceSchema.safeParse(value);
  if (!result.success) unresolved();
  return result.data;
}
/** Exact decimal coordinate equivalence, including a resolver number's exponent form. */
function coordinate(value: string | number | null): string | null {
  if (value === null) return null;
  const text = String(value);
  if (text.length > 100) unresolved();
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m) unresolved();
  const exp = Number(m[4] ?? 0);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 100) unresolved();
  const digits = m[2] + (m[3] ?? "");
  const places = (m[3]?.length ?? 0) - exp;
  let n = BigInt(digits);
  let scale = Math.max(0, places);
  if (places < 0) n *= 10n ** BigInt(-places);
  while (scale > 0 && n % 10n === 0n) {
    n /= 10n;
    scale--;
  }
  return `${n === 0n ? "" : m[1]}${n}:${scale}`;
}
export function readProjectGeocodeReviewEvidence(
  project: Project,
  snapshot: Record<string, unknown>
): ProjectGeocodeReviewEvidence {
  assertPlainData(snapshot);
  const result = evidenceSchema.safeParse(snapshot.reviewEvidence);
  if (!result.success) unresolved();
  const e = result.data,
    g = e.geocode,
    d = e.zoneDetection;
  if (
    e.projectId !== project.id ||
    e.tenantId !== project.tenantId ||
    !sameProjectGeocodeAddress(project, e.inputAddress) ||
    !g.success ||
    g.latitude === null ||
    g.longitude === null ||
    g.formattedAddress === null ||
    g.formattedAddress.trim().length === 0 ||
    g.source !== "google_maps" ||
    (g.confidence !== "high" && g.confidence !== "medium") ||
    (d.method !== "coordinates" && d.method !== "zip") ||
    (d.confidence !== "high" && d.confidence !== "medium") ||
    d.zoneId !== snapshot.zoneId ||
    project.geocodedAt?.toISOString() !== e.geocodedAt ||
    project.geocodeConfidence !== g.confidence ||
    project.geocodeSource !== g.source ||
    project.geocodedAddress !== g.formattedAddress ||
    coordinate(project.latitude) !== coordinate(g.latitude) ||
    coordinate(project.longitude) !== coordinate(g.longitude)
  )
    unresolved();
  return e;
}
