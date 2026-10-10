/** Owned-lab only. Independent canonical evidence for one completed v1 cycle. */
import { createHash, randomUUID } from "node:crypto";
import { getTableColumns } from "drizzle-orm";
import {
  auditLogs,
  clients,
  projects,
  intakeForms,
} from "../../drizzle/schema";
import { bootstrapHomologAccess } from "../../scripts/homolog-access-bootstrap";
import * as proof from "../../scripts/homolog-read-proof";
import type { Adr002Postgrest } from "./adr002-postgrest";
import { formationCommand } from "./adr002-intake-formation-fixtures";

export function evidenceHash(value: unknown): string {
  const sorted = (v: any): any =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, sorted(v[k])])
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(sorted(value)))
    .digest("hex");
}
export function predecessorManifest() {
  const op = randomUUID();
  return {
    version: "structr-homolog-identity-cycle-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    sourceCommit: "c".repeat(40),
    reactivationOperationId: randomUUID(),
    withdrawalOperationId: randomUUID(),
    priorReadProof: {
      version: "structr-homolog-read-proof-v1",
      projectRef: "wmspwegbqtzamkhxhusg",
      sourceCommit: "b".repeat(40),
      operationId: randomUUID(),
      withdrawalOperationId: randomUUID(),
      identity: {
        version: "structr-homolog-identities-v1",
        projectRef: "wmspwegbqtzamkhxhusg",
        sourceCommit: "a".repeat(40),
        operationId: op,
        tenants: {
          A: { id: randomUUID(), slug: `homolog-access-a-${op}` },
          B: { id: randomUUID(), slug: `homolog-access-b-${op}` },
        },
        profiles: Object.fromEntries(
          ["A1", "A2", "B1"].map(name => [
            name,
            {
              id: randomUUID(),
              providerSubject: randomUUID(),
              tenant: name[0],
              role: "user",
            },
          ])
        ) as Record<
          "A1" | "A2" | "B1",
          { id: string; providerSubject: string; tenant: string; role: string }
        >,
      },
      fixture: {
        clientId: randomUUID(),
        projectId: randomUUID(),
        draftId: randomUUID(),
        membershipId: randomUUID(),
      },
    },
  };
}
export function continuationManifest() {
  const previous = predecessorManifest();
  const h = "a".repeat(64);
  return {
    version: "structr-homolog-identity-continuation-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    sourceCommit: "d".repeat(40),
    reactivationOperationId: randomUUID(),
    withdrawalOperationId: randomUUID(),
    priorReadProof: previous.priorReadProof,
    predecessor: {
      manifest: previous,
      manifestHash: evidenceHash(previous),
      reactivationReceiptHash: h,
      withdrawalReceiptHash: h,
      withdrawnStateHash: h,
    },
    auditHistory: { count: 35, hash: h },
    formations: [0, 1].map(() => ({
      clientId: randomUUID(),
      projectId: randomUUID(),
      intakeFormId: randomUUID(),
      clientHash: h,
      projectHash: h,
      intakeHash: h,
      audits: [0, 1, 2].map(() => ({ id: randomUUID(), hash: h })),
    })),
  };
}

/** Read every Drizzle column independently, retaining six timestamp digits. */
export async function physicalRows(
  lab: Adr002Postgrest,
  table:
    | typeof auditLogs
    | typeof clients
    | typeof projects
    | typeof intakeForms,
  name: string
) {
  const columns = Object.entries(getTableColumns(table)).map(([key, c]) =>
    c.columnType === "PgTimestamp"
      ? `to_char("${c.name}" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "${key}"`
      : `"${c.name}" AS "${key}"`
  );
  // JSON on the server avoids driver timestamp truncation and numeric decoding differences.
  const rows = await lab.sql.unsafe(
    `SELECT to_jsonb(r) AS row FROM (SELECT ${columns.join(",")} FROM public."${name}" ORDER BY id) r`
  );
  return rows.map(r => r.row);
}
export async function seedContinuation(lab: Adr002Postgrest) {
  const value = continuationManifest(),
    previous = value.predecessor.manifest,
    db = lab.cluster.observer.db;
  await bootstrapHomologAccess(db, previous.priorReadProof.identity);
  await proof.provisionHomologReadProof(db, previous.priorReadProof);
  await proof.withdrawHomologReadProof(db, previous.priorReadProof);
  await proof.reactivateHomologReadProofIdentities(db, previous);
  const p = previous.priorReadProof.identity.profiles.A1;
  const actor = {
    id: p.id,
    sub: p.providerSubject,
    tenant: previous.priorReadProof.identity.tenants.A.id,
    session: randomUUID(),
  };
  const token = await lab.token({ sub: actor.sub, session_id: actor.session });
  for (const formation of value.formations) {
    const command = formationCommand(actor, formation.intakeFormId);
    const result = await lab.rpc("structr_intake_create_v1", token, {
      preimage: JSON.stringify(command),
    });
    if (result.status !== 200) throw new Error("Owned IF1 formation failed");
    formation.projectId = result.body.intake.projectId;
    formation.clientId = result.body.intake.formData.clientId;
  }
  await proof.withdrawHomologReadProofIdentities(db, previous);
  const logs = await physicalRows(lab, auditLogs, "audit_logs");
  for (const [operation, key] of [
    [previous.reactivationOperationId, "reactivationReceiptHash"],
    [previous.withdrawalOperationId, "withdrawalReceiptHash"],
  ] as const) {
    const receipt = logs.find(a => a.recordId === operation)!.newValues;
    value.predecessor[key] = evidenceHash(receipt);
    if (key === "withdrawalReceiptHash")
      value.predecessor.withdrawnStateHash = evidenceHash(receipt.state);
  }
  const all = {
    clients: await physicalRows(lab, clients, "clients"),
    projects: await physicalRows(lab, projects, "projects"),
    intakes: await physicalRows(lab, intakeForms, "intake_forms"),
  };
  for (const f of value.formations) {
    f.clientHash = evidenceHash(all.clients.find(r => r.id === f.clientId));
    f.projectHash = evidenceHash(all.projects.find(r => r.id === f.projectId));
    f.intakeHash = evidenceHash(all.intakes.find(r => r.id === f.intakeFormId));
    f.audits = logs
      .filter(r =>
        [f.clientId, f.projectId, f.intakeFormId].includes(r.recordId)
      )
      .map(r => ({ id: r.id, hash: evidenceHash(r) }));
  }
  value.auditHistory = { count: logs.length, hash: evidenceHash(logs) };
  return value;
}
