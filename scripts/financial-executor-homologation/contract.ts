/** Local operational candidate. No credential, deployment or source attestation. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { CALCULATOR_OPERATIONS } from "../../shared/domain/taxonomy";
const id = (n: number) =>
  `c8300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const SYNTHETIC_IDS = Object.freeze({
  binding: id(3),
  project: id(4),
  intake: id(5),
  client: id(6),
  fixture: id(7),
  unit: id(9),
  type: id(10),
  zone: id(12),
  a: id(101),
  b: id(102),
  c: id(103),
  codeA: id(201),
  codeB: id(202),
  codeC: id(203),
  itemA: id(301),
  itemB: id(302),
  itemC: id(303),
  priceA: id(401),
  priceB: id(402),
  priceC: id(403),
});
export const CATALOG_SHA256 =
  "75332da1e1b8d1492d1a99c702de39ddc8950c57f0c85c5726d11bed7d5acb2c";
export const LOGIN_ROLE = "structr_calculator_login_v1";
export const OPERATIONS = [...CALCULATOR_OPERATIONS];
export const ASSEMBLIES = [
  {
    label: "A",
    id: SYNTHETIC_IDS.a,
    cost: "40.00",
    price: "100.00",
    codeId: SYNTHETIC_IDS.codeA,
    itemId: SYNTHETIC_IDS.itemA,
    priceId: SYNTHETIC_IDS.priceA,
  },
  {
    label: "B",
    id: SYNTHETIC_IDS.b,
    cost: "60.00",
    price: "90.00",
    codeId: SYNTHETIC_IDS.codeB,
    itemId: SYNTHETIC_IDS.itemB,
    priceId: SYNTHETIC_IDS.priceB,
  },
  {
    label: "C",
    id: SYNTHETIC_IDS.c,
    cost: "0.01",
    price: "0.01",
    codeId: SYNTHETIC_IDS.codeC,
    itemId: SYNTHETIC_IDS.itemC,
    priceId: SYNTHETIC_IDS.priceC,
  },
] as const;
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(v => v !== "00000000-0000-0000-0000-000000000000");
const schema = z
  .object({
    version: z.literal("calculator-homologation-v1"),
    operationId: uuid,
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    expectedDatabase: z.literal("postgres"),
    expectedPrincipal: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    operator: z
      .object({ subject: uuid, actorId: uuid, tenantId: uuid })
      .strict(),
    window: z
      .object({
        opensAt: z.string().datetime(),
        closesAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const ids = [
      m.operationId,
      ...Object.values(m.operator),
      ...Object.values(SYNTHETIC_IDS),
    ];
    const duration =
      Date.parse(m.window.closesAt) - Date.parse(m.window.opensAt);
    if (
      new Set(ids).size !== ids.length ||
      duration <= 0 ||
      duration > 2 * 60 * 60 * 1000
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Distinct identifiers and a window of at most two hours required",
      });
  });
export type CalculatorHomologationManifest = z.infer<typeof schema>;
export function fail(code: string): never {
  throw new Error(`CALCULATOR_HOMOLOGATION_${code}`);
}
export function parseCalculatorHomologationManifest(
  value: unknown
): CalculatorHomologationManifest {
  const p = schema.safeParse(value);
  if (!p.success) fail("MANIFEST_INVALID");
  return p.data;
}
export function canonical(value: unknown): string {
  const sort = (v: any): any =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, sort(v[k])])
          )
        : v;
  return JSON.stringify(sort(JSON.parse(JSON.stringify(value))));
}
export function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function planCalculatorHomologation(value: unknown) {
  const m = parseCalculatorHomologationManifest(value);
  return {
    status: "planned" as const,
    operationId: m.operationId,
    manifestHash: hash(m),
    catalogSha256: CATALOG_SHA256,
    sourceCommit: m.sourceCommit,
    sourceAttested: false,
    hostedReady: false,
    operations: OPERATIONS,
    window: m.window,
    fixture: {
      projectId: SYNTHETIC_IDS.project,
      intakeFormId: SYNTHETIC_IDS.intake,
      bindingId: SYNTHETIC_IDS.binding,
      fixtureId: SYNTHETIC_IDS.fixture,
      assemblies: ASSEMBLIES.map(({ label, id, cost, price }) => ({
        label,
        id,
        cost,
        price,
      })),
    },
  };
}
