import { describe, expect, it } from "vitest";
import * as proof from "../scripts/homolog-read-proof";
import {
  continuationManifest,
  evidenceHash,
} from "./test-support/homolog-continuation-fixtures";

describe("one audited predecessor identity continuation", () => {
  it("plans bounded five-row transitions and preserves the complete predecessor", () => {
    const m = continuationManifest();
    expect(proof.parseHomologIdentityContinuationManifest(m)).toEqual(m);
    expect(proof.planHomologIdentityContinuation(m)).toMatchObject({
      status: "planned",
      reactivateRows: 5,
      reactivateAudits: 6,
      withdrawRows: 5,
      withdrawAudits: 6,
      authVerified: false,
      databaseTargetVerified: false,
    });
  });
  it.each([
    [
      "unknown key",
      (m: any) => {
        m.password = "PRIVATE";
      },
    ],
    [
      "wrong target",
      (m: any) => {
        m.projectRef = "foreign";
      },
    ],
    [
      "branch source",
      (m: any) => {
        m.sourceCommit = "main";
      },
    ],
    [
      "recursive predecessor",
      (m: any) => {
        m.predecessor.manifest.version = m.version;
      },
    ],
    [
      "different prior identity",
      (m: any) => {
        m.priorReadProof = structuredClone(m.priorReadProof);
        m.priorReadProof.identity.sourceCommit = "f".repeat(40);
      },
    ],
    [
      "wrong predecessor digest",
      (m: any) => {
        m.predecessor.manifestHash = "b".repeat(64);
      },
    ],
    [
      "predecessor op reuse",
      (m: any) => {
        m.reactivationOperationId =
          m.predecessor.manifest.withdrawalOperationId;
      },
    ],
    [
      "same operations",
      (m: any) => {
        m.reactivationOperationId = m.withdrawalOperationId;
      },
    ],
    [
      "fixture reuse",
      (m: any) => {
        m.formations[0].projectId = m.priorReadProof.fixture.projectId;
      },
    ],
    [
      "duplicate formation",
      (m: any) => {
        m.formations[1] = m.formations[0];
      },
    ],
    [
      "missing formation",
      (m: any) => {
        m.formations.pop();
      },
    ],
    [
      "third formation",
      (m: any) => {
        m.formations.push(m.formations[0]);
      },
    ],
    [
      "duplicate audit",
      (m: any) => {
        m.formations[0].audits[1] = m.formations[0].audits[0];
      },
    ],
    [
      "missing audit",
      (m: any) => {
        m.formations[0].audits.pop();
      },
    ],
    [
      "invalid row hash",
      (m: any) => {
        m.formations[0].intakeHash = "bad";
      },
    ],
    [
      "fractional audit population",
      (m: any) => {
        m.auditHistory.count = 35.5;
      },
    ],
  ])("refuses %s without accepting broader authority", (_name, change) => {
    const m = continuationManifest();
    change(m);
    expect(() => proof.parseHomologIdentityContinuationManifest(m)).toThrow(
      "HOMOLOG_CONTINUATION_MANIFEST_INVALID"
    );
  });
  it("pins every payload byte semantically and leaves v1 parser closed", () => {
    const m = continuationManifest(),
      hash = proof.planHomologIdentityContinuation(m).manifestHash;
    expect(hash).toBe(evidenceHash(m));
    m.formations[0].audits[0].hash = "b".repeat(64);
    expect(proof.planHomologIdentityContinuation(m).manifestHash).not.toBe(
      hash
    );
    expect(() => proof.parseHomologIdentityCycleManifest(m)).toThrow(
      "HOMOLOG_CYCLE_MANIFEST_INVALID"
    );
  });
});
