/** Disposable synthetic artifacts only; never accepts an external URL or credential. */
import { mkdtemp, chmod, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  planCalculatorCredentialArtifact,
  stageCalculatorCredentialArtifact,
} from "../../scripts/financial-executor-homologation/credential-artifact";
import { provisionCalculatorCredential } from "../../scripts/financial-executor-homologation/credential";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { CalculatorHomologationManifest } from "../../scripts/financial-executor-homologation/contract";
export function syntheticCredentialManifest(
  fixture: CalculatorHomologationManifest,
  previous: string | null = null
) {
  return {
    fixture,
    metadata: {
      version: 1 as const,
      operationId: randomUUID(),
      generationId: randomUUID(),
      fixtureOperationId: fixture.operationId,
      sourceCommit: fixture.sourceCommit,
      sourcePinsSha256: "b".repeat(64),
      role: "structr_calculator_login_v1" as const,
      target: {
        host: "db.synthetic.supabase.co",
        port: 5432 as const,
        database: "postgres" as const,
        caSha256: "c".repeat(64),
      },
      executorPreview: {
        teamId: "team_synthetic",
        projectId: "prj_synthetic",
        environment: "preview" as const,
      },
    },
    expectedPreviousReceiptId: previous,
    nativeLogRisk: {
      policy: "postgres-native-scram-context-v1" as const,
      accepted: true as const,
      approvalReference: "synthetic disposable laboratory only",
      logAudience: ["owned test operator"],
      retentionDescription: "removed with owned laboratory teardown",
    },
  };
}
export async function syntheticCredentialArtifact(
  m: ReturnType<typeof syntheticCredentialManifest>
) {
  const directory = await mkdtemp("/private/tmp/calculator-credential-");
  await chmod(directory, 0o700);
  const plan = await planCalculatorCredentialArtifact({
    directory,
    metadata: m.metadata,
  });
  const artifact = await stageCalculatorCredentialArtifact(plan);
  return {
    plan,
    artifact,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
export async function provisionSyntheticCalculatorCredential(
  db: PostgresJsDatabase,
  fixture: CalculatorHomologationManifest
) {
  const m = syntheticCredentialManifest(fixture),
    owned = await syntheticCredentialArtifact(m);
  try {
    return await provisionCalculatorCredential(db, m, owned.plan);
  } finally {
    await owned.cleanup();
  }
}
