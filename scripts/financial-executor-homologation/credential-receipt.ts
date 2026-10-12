/** Public credential evidence only. Never reads or hashes secret material. */
import { z } from "zod";
import {
  parseCalculatorCredentialMetadata,
  type CalculatorCredentialMetadata,
} from "./credential-artifact";
import {
  parseCalculatorHomologationManifest,
  SYNTHETIC_IDS,
  fail,
  type CalculatorHomologationManifest,
} from "./contract";
const uuid = z.uuid().refine(v => v === v.toLowerCase());
const nonempty = z.string().trim().min(1).max(1000);
const envelope = z
  .object({
    fixture: z.unknown(),
    metadata: z.unknown(),
    expectedPreviousReceiptId: uuid.nullable(),
    nativeLogRisk: z
      .object({
        policy: z.literal("postgres-native-scram-context-v1"),
        accepted: z.literal(true),
        approvalReference: nonempty,
        logAudience: z.array(nonempty).min(1).max(20),
        retentionDescription: nonempty,
      })
      .strict(),
  })
  .strict();
export type CalculatorCredentialManifest = Omit<
  z.infer<typeof envelope>,
  "fixture" | "metadata"
> & {
  fixture: CalculatorHomologationManifest;
  metadata: CalculatorCredentialMetadata;
};
export type CalculatorCredentialReference = {
  receiptId: string;
  generationId: string;
};
export function parseCalculatorCredentialManifest(
  value: unknown
): CalculatorCredentialManifest {
  try {
    const p = envelope.parse(value),
      fixture = parseCalculatorHomologationManifest(p.fixture),
      metadata = parseCalculatorCredentialMetadata(p.metadata);
    const ids = [
      metadata.operationId,
      metadata.generationId,
      fixture.operationId,
      ...Object.values(fixture.operator),
      ...Object.values(SYNTHETIC_IDS),
    ];
    if (
      new Set(ids).size !== ids.length ||
      (p.expectedPreviousReceiptId &&
        ids.includes(p.expectedPreviousReceiptId)) ||
      metadata.fixtureOperationId !== fixture.operationId ||
      metadata.sourceCommit !== fixture.sourceCommit
    )
      throw new Error();
    return { ...p, fixture, metadata };
  } catch {
    fail("CREDENTIAL_MANIFEST_INVALID");
  }
}
import { sql } from "drizzle-orm";
import { query, type Tx, type Row } from "./admin-internal";
import { canonical, hash } from "./contract";
export const credentialTable = "calculator_credential";
export const credentialPrefix = "financial.homologation.credential.";
export function credentialReference(row: Row): CalculatorCredentialReference {
  return {
    receiptId: row.id,
    generationId: row.new_values.manifest.metadata.generationId,
  };
}
/** Complete single chain, not a latest-row query: forks, detached receipts, recycled
 * operations/generations and metadata drift reject the whole history. */
export async function credentialChain(
  tx: Tx,
  fixture: CalculatorHomologationManifest
): Promise<Row[]> {
  const rows = (
    await query(
      tx,
      sql`SELECT to_jsonb(a.*) AS row FROM public.audit_logs a WHERE table_name=${credentialTable} OR action LIKE ${credentialPrefix + "%"} FOR SHARE`
    )
  ).map(r => r.row);
  const byId = new Map<string, Row>(),
    byParent = new Map<string | null, Row>(),
    operations = new Set<string>(),
    generations = new Set<string>(),
    identifiers = new Set<string>();
  for (const r of rows) {
    const v = r.new_values,
      m = parseCalculatorCredentialManifest(v?.manifest),
      previous = m.expectedPreviousReceiptId;
    if (
      !uuid.safeParse(r.id).success ||
      r.user_id !== null ||
      r.table_name !== credentialTable ||
      r.record_id !== m.metadata.operationId ||
      r.action !==
        credentialPrefix +
          (previous ? "replace" : "provision") +
          ".completed" ||
      canonical(m.fixture) !== canonical(fixture) ||
      v.version !== "calculator-credential-receipt-v1" ||
      v.manifestHash !== hash(m) ||
      v.beforeHash !== hash(r.old_values) ||
      v.afterHash !== hash(v.state) ||
      r.old_values?.role?.rolcanlogin !== false ||
      canonical(r.old_values.role) !== canonical(v.state?.role) ||
      v.state?.generationId !== m.metadata.generationId ||
      canonical(v.administrativeActor) !==
        canonical({
          kind: "database-principal",
          currentUser: fixture.expectedPrincipal,
          sessionUser: fixture.expectedPrincipal,
        })
    )
      fail("CREDENTIAL_EVIDENCE");
    if (
      canonical(v) !==
        canonical({
          version: "calculator-credential-receipt-v1",
          manifest: m,
          manifestHash: hash(m),
          administrativeActor: v.administrativeActor,
          beforeHash: hash(r.old_values),
          afterHash: hash(v.state),
          state: {
            role: r.old_values.role,
            generationId: m.metadata.generationId,
          },
        }) ||
      canonical(r.old_values) !==
        canonical({
          role: r.old_values.role,
          credential: r.old_values.credential ?? null,
        })
    )
      fail("CREDENTIAL_EVIDENCE");
    if (
      byId.has(r.id) ||
      byParent.has(previous) ||
      operations.has(m.metadata.operationId) ||
      generations.has(m.metadata.generationId)
    )
      fail("CREDENTIAL_CHAIN");
    for (const id of [r.id, m.metadata.operationId, m.metadata.generationId]) {
      if (identifiers.has(id)) fail("CREDENTIAL_CHAIN");
      identifiers.add(id);
    }
    byId.set(r.id, r);
    byParent.set(previous, r);
    operations.add(m.metadata.operationId);
    generations.add(m.metadata.generationId);
  }
  const ordered: Row[] = [];
  let next = byParent.get(null),
    prior: Row | undefined;
  while (next) {
    if (ordered.length >= rows.length) fail("CREDENTIAL_CHAIN");
    if (
      canonical(next.old_values.credential) !==
      canonical(prior ? credentialReference(prior) : null)
    )
      fail("CREDENTIAL_CHAIN");
    if (prior) {
      const a = prior.new_values.manifest.metadata,
        b = next.new_values.manifest.metadata;
      const identity = (m: CalculatorCredentialMetadata) => {
        const { operationId, generationId, ...rest } = m;
        return rest;
      };
      if (
        canonical(identity(a)) !== canonical(identity(b)) ||
        canonical(next.old_values.role) !==
          canonical(prior.new_values.state.role)
      )
        fail("CREDENTIAL_CHAIN");
    }
    ordered.push(next);
    prior = next;
    next = byParent.get(next.id);
  }
  if (ordered.length !== rows.length) fail("CREDENTIAL_CHAIN");
  return ordered;
}
export async function requireCurrentCalculatorCredential(
  tx: Tx,
  fixture: CalculatorHomologationManifest,
  expected?: CalculatorCredentialReference
) {
  if (
    !expected ||
    !uuid.safeParse(expected.receiptId).success ||
    !uuid.safeParse(expected.generationId).success
  )
    fail("CREDENTIAL_REQUIRED");
  const chain = await credentialChain(tx, fixture),
    last = chain.at(-1);
  if (!last) fail("CREDENTIAL_REQUIRED");
  const reference = credentialReference(last);
  if (
    reference.receiptId !== expected.receiptId ||
    reference.generationId !== expected.generationId
  )
    fail("CREDENTIAL_STALE");
  return reference;
}
