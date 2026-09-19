/** Offline structural comparison; does not connect to a database or authorize writes. */
import { createHash } from "node:crypto";
import { z } from "zod";

const catalogObject = z.object({
  kind: z.enum(["table", "column", "constraint", "index", "trigger", "policy", "routine", "extension", "sequence", "view"]),
  name: z.string().min(1),
  definition: z.unknown(),
}).strict();
const snapshotSchema = z.object({
  version: z.literal(1), complete: z.boolean(), omissions: z.array(z.string()), objects: z.array(catalogObject),
}).strict();
type CatalogObject = z.infer<typeof catalogObject>;

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  throw new Error("Invalid catalog snapshot");
}
const key = (object: CatalogObject) => `${object.kind}:${object.name}`;
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function validate(input: unknown) {
  try {
    const snapshot = snapshotSchema.parse(input);
    if (snapshot.complete && snapshot.omissions.length) throw new Error();
    const names = new Set<string>();
    for (const object of snapshot.objects) {
      if (names.has(key(object))) throw new Error();
      names.add(key(object)); canonical(object.definition);
    }
    return { ...snapshot, objects: snapshot.objects.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) };
  } catch { throw new Error("Invalid catalog snapshot"); }
}

export function compareSchemaSnapshots(observedInput: unknown, intendedInput: unknown) {
  const observed = validate(observedInput), intended = validate(intendedInput);
  const left = new Map(observed.objects.map(object => [key(object), object]));
  const right = new Map(intended.objects.map(object => [key(object), object]));
  const differences: Array<{ kind: string; name: string; disposition: "changed" | "missing_from_observed" | "only_in_observed" }> = [];
  let matches = 0;
  for (const identity of Array.from(new Set([...Array.from(left.keys()), ...Array.from(right.keys())])).sort()) {
    const a = left.get(identity), b = right.get(identity), object = a ?? b!;
    if (a && b && canonical(a.definition) === canonical(b.definition)) { matches++; continue; }
    differences.push({ kind: object.kind, name: object.name, disposition: !a ? "missing_from_observed" : !b ? "only_in_observed" : "changed" });
  }
  const complete = observed.complete && intended.complete;
  return {
    version: 1, status: !complete ? "incomplete" : differences.length ? "different" : "equal",
    observedCount: observed.objects.length, intendedCount: intended.objects.length, matches, differences,
    observedComplete: observed.complete, intendedComplete: intended.complete,
    observedOmissionCount: observed.omissions.length, intendedOmissionCount: intended.omissions.length,
    observedFingerprint: digest(observed.objects), intendedFingerprint: digest(intended.objects),
    structuralEquality: complete && differences.length === 0,
    migrationHistoryProven: false, deploymentAllowed: false,
  };
}
