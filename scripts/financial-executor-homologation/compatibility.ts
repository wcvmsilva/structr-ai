/** Pure, fail-closed metadata comparison. Never executes SQL or authorizes application. */
import { createHash } from "node:crypto";
import { z } from "zod";
import prior from "../../docs/security/financial-executor/homolog-readonly-observation-2026-10-10.json";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const record = z
  .object({
    identity: z.string().min(1),
    definition: z.record(z.string(), z.unknown()),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
const observationSchema = z
  .object({
    version: z.literal("calculator-compatibility-observation-v1"),
    databaseVersion: z.literal("170011"),
    extension: z
      .object({
        name: z.literal("pgcrypto"),
        version: z.literal("1.3"),
        namespace: z.enum(["public", "extensions"]),
        members: z.array(z.string()),
      })
      .strict(),
    objects: z.array(record).min(1),
    surface: z.array(record),
    unresolved: z.array(z.string()),
  })
  .strict();
const manifestSchema = z
  .object({
    version: z.literal("calculator-compatibility-manifest-v1"),
    state: z.literal("reviewed-local-candidate"),
    observation: observationSchema,
    application: z
      .object({ objects: z.array(record) })
      .strict()
      .optional(),
    managed: z
      .object({
        extension: observationSchema.shape.extension,
        profiles: z.array(
          z
            .object({
              name: z.enum([
                "owned-unmanaged-laboratory",
                "observed-managed-provider",
                "owned-managed-laboratory",
              ]),
              sha256: z.string().regex(/^[0-9a-f]{64}$/),
              objects: z.array(record),
            })
            .strict()
        ),
      })
      .strict()
      .optional(),
    review: z
      .object({
        status: z.literal("pending-independent-review"),
        applicationAuthorization: z.literal(false),
        providerReview: z.string().min(1),
        latentManagedPrivileges: z.array(z.string()),
        maintenance: z.string(),
        temporary: z.string(),
        resolvedFindings: z.array(
          z.enum([
            "REQUIRES_EFFECTIVE_WRAPPER_BODY_REVIEW",
            "REQUIRES_TEMP_RECIPIENT_REVIEW",
          ])
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
type Observation = z.infer<typeof observationSchema>;
type RecordRow = z.infer<typeof record>;
const memberIdentities = new Set(
  prior.applicationCatalog.missingObjects.map(r => r.identity)
);
const canonical = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map(k => JSON.stringify(k) + ":" + canonical((v as any)[k]))
    .join(",")}}`;
};
// These catalog projections contain strings/booleans/integer metadata. PostgreSQL
// jsonb orders object keys by UTF8 byte length, then bytes, and inserts spaces.
function postgresJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(postgresJson).join(", ")}]`;
  return `{${Object.keys(v)
    .sort(
      (a, b) =>
        Buffer.byteLength(a) - Buffer.byteLength(b) ||
        Buffer.compare(Buffer.from(a), Buffer.from(b))
    )
    .map(k => JSON.stringify(k) + ": " + postgresJson((v as any)[k]))
    .join(", ")}}`;
}
function normalized(o: Observation) {
  const normalizeId = (id: string) =>
    id.replace(/^function:(public|extensions)\./, "function:public.");
  const ext = new Set(o.extension.members);
  const application: RecordRow[] = [],
    managed: RecordRow[] = [];
  for (const row of o.objects) {
    if (ext.has(row.identity)) {
      const definition = { ...row.definition };
      if (typeof definition.definition !== "string")
        throw new Error("EXTENSION_DEFINITION");
      const header = `CREATE OR REPLACE FUNCTION ${o.extension.namespace}.`;
      if (!definition.definition.startsWith(header))
        throw new Error("EXTENSION_NAMESPACE");
      definition.definition = definition.definition.replace(
        header,
        "CREATE OR REPLACE FUNCTION public."
      );
      managed.push({
        identity: normalizeId(row.identity),
        definition,
        sha256: digest(postgresJson(definition)),
      });
    } else application.push(row);
  }
  return {
    application,
    managed: [...managed, ...o.surface].sort((a, b) =>
      Buffer.compare(Buffer.from(a.identity), Buffer.from(b.identity))
    ),
  };
}
export function inspectCalculatorCompatibility(
  observation: unknown,
  approvedManifest: unknown
): {
  status: "compatible" | "blocked";
  applicationHash: string;
  managedHash: string;
  findings: { code: string; identity: string }[];
} {
  const findings: { code: string; identity: string }[] = [],
    blocked = (code: string, identity: string) =>
      findings.push({ code, identity });
  let applicationHash = "",
    managedHash = "";
  // Reject cycles and non-JSON values before walking metadata from an untrusted caller.
  try {
    JSON.stringify([observation, approvedManifest], (_key, value) => {
      if (
        value === undefined ||
        typeof value === "function" ||
        typeof value === "symbol" ||
        (typeof value === "number" && !Number.isFinite(value))
      )
        throw new Error("NON_JSON");
      return value;
    });
  } catch {
    return {
      status: "blocked",
      applicationHash,
      managedHash,
      findings: [{ code: "INPUT_INVALID", identity: "metadata" }],
    };
  }
  const observed = observationSchema.safeParse(observation),
    approved = manifestSchema.safeParse(approvedManifest);
  if (!observed.success || !approved.success)
    return {
      status: "blocked",
      applicationHash,
      managedHash,
      findings: [
        {
          code: "INPUT_INVALID",
          identity: !observed.success ? "observation" : "approvedManifest",
        },
      ],
    };
  const validate = (o: Observation, label: string) => {
    for (const section of [o.objects, o.surface]) {
      const seen = new Set<string>();
      for (const row of section) {
        if (seen.has(row.identity)) blocked("DUPLICATE_IDENTITY", row.identity);
        seen.add(row.identity);
        if (digest(postgresJson(row.definition)) !== row.sha256)
          blocked("HASH_INVALID", row.identity);
      }
    }
    const expected = new Set(
      [...memberIdentities].map(id =>
        id.replace("function:public.", `function:${o.extension.namespace}.`)
      )
    );
    if (
      o.extension.members.length !== expected.size ||
      new Set(o.extension.members).size !== expected.size ||
      o.extension.members.some(id => !expected.has(id)) ||
      [...expected].some(id => !o.objects.some(r => r.identity === id))
    )
      blocked("EXTENSION_MEMBERSHIP", label);
    for (const issue of o.unresolved)
      if (
        !approved.data.review?.resolvedFindings.includes(
          issue as "REQUIRES_EFFECTIVE_WRAPPER_BODY_REVIEW"
        )
      )
        blocked("UNRESOLVED_ANALYSIS", issue);
  };
  validate(observed.data, "observation");
  validate(approved.data.observation, "approvedManifest");
  try {
    const current = normalized(observed.data),
      expected = normalized(approved.data.observation);
    applicationHash = digest(
      current.application
        .sort((a, b) =>
          Buffer.compare(Buffer.from(a.identity), Buffer.from(b.identity))
        )
        .map(r => `${r.identity}:${r.sha256}`)
        .join("\n")
    );
    managedHash = digest(canonical(current.managed));
    for (const section of ["application", "managed"] as const) {
      const want = new Map(expected[section].map(r => [r.identity, r]));
      for (const row of current[section]) {
        const previous = want.get(row.identity);
        if (!previous) blocked("OBJECT_ADDED", row.identity);
        else if (canonical(previous) !== canonical(row))
          blocked("OBJECT_CHANGED", row.identity);
        want.delete(row.identity);
      }
      for (const identity of want.keys()) blocked("OBJECT_MISSING", identity);
    }
  } catch {
    blocked("EXTENSION_DEFINITION", "pgcrypto");
  }
  return {
    status: findings.length ? "blocked" : "compatible",
    applicationHash,
    managedHash,
    findings,
  };
}
