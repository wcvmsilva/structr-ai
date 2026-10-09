import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import * as proof from "../scripts/homolog-read-proof";

function manifest() {
  const identityOperationId = randomUUID();
  return {
    version: "structr-homolog-identity-cycle-v1",
    projectRef: "wmspwegbqtzamkhxhusg",
    sourceCommit: "c".repeat(40),
    reactivationOperationId: randomUUID(),
    withdrawalOperationId: randomUUID(),
    priorReadProof: {
      version: "structr-homolog-read-proof-v1",
      projectRef: "wmspwegbqtzamkhxhusg",
      sourceCommit: "ed64270954cef16b617f29a8c05c74801dea5b2c",
      operationId: randomUUID(),
      withdrawalOperationId: randomUUID(),
      identity: {
        version: "structr-homolog-identities-v1",
        projectRef: "wmspwegbqtzamkhxhusg",
        sourceCommit: "8e349d472f5b16494350b1dd26ccc039a9580d21",
        operationId: identityOperationId,
        tenants: {
          A: {
            id: randomUUID(),
            slug: `homolog-access-a-${identityOperationId}`,
          },
          B: {
            id: randomUUID(),
            slug: `homolog-access-b-${identityOperationId}`,
          },
        },
        profiles: {
          A1: {
            id: randomUUID(),
            providerSubject: randomUUID(),
            tenant: "A",
            role: "user",
          },
          A2: {
            id: randomUUID(),
            providerSubject: randomUUID(),
            tenant: "A",
            role: "user",
          },
          B1: {
            id: randomUUID(),
            providerSubject: randomUUID(),
            tenant: "B",
            role: "user",
          },
        },
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

describe("nominal homolog identity cycle manifest", () => {
  it("plans two audited five-row transitions while retaining both historical manifests", () => {
    const value = manifest(),
      original = structuredClone(value);
    expect(() => proof.parseHomologIdentityCycleManifest(value)).not.toThrow();
    expect(proof.parseHomologIdentityCycleManifest(value)).toEqual(original);
    const plan = proof.planHomologIdentityCycle(value);
    expect(plan).toMatchObject({
      status: "planned",
      reactivationOperationId: value.reactivationOperationId,
      withdrawalOperationId: value.withdrawalOperationId,
      reactivateRows: 5,
      reactivateAudits: 6,
      withdrawRows: 5,
      withdrawAudits: 6,
      authVerified: false,
      databaseTargetVerified: false,
    });
    expect(plan.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(value).toEqual(original);
    expect(JSON.stringify(plan)).not.toContain(
      value.priorReadProof.identity.profiles.A1.providerSubject
    );
    expect(JSON.stringify(plan)).not.toContain(
      value.priorReadProof.fixture.clientId
    );
  });
  it.each([
    [
      "foreign target",
      (m: any) => {
        m.projectRef = "foreign";
      },
    ],
    [
      "source branch instead of commit",
      (m: any) => {
        m.sourceCommit = "main";
      },
    ],
    [
      "missing prior withdrawal",
      (m: any) => {
        delete m.priorReadProof.withdrawalOperationId;
      },
    ],
    [
      "foreign historical target",
      (m: any) => {
        m.priorReadProof.projectRef = "foreign";
      },
    ],
    [
      "operator target override",
      (m: any) => {
        m.profileIds = [randomUUID()];
      },
    ],
    [
      "arbitrary update values",
      (m: any) => {
        m.values = { role: "admin" };
      },
    ],
    [
      "secret input",
      (m: any) => {
        m.password = "PRIVATE_SENTINEL";
      },
    ],
    [
      "changed historical role",
      (m: any) => {
        m.priorReadProof.identity.profiles.A1.role = "admin";
      },
    ],
    [
      "cycle operation collision",
      (m: any) => {
        m.withdrawalOperationId = m.reactivationOperationId;
      },
    ],
    [
      "historical withdrawal collision",
      (m: any) => {
        m.reactivationOperationId = m.priorReadProof.withdrawalOperationId;
      },
    ],
    [
      "historical bootstrap collision",
      (m: any) => {
        m.withdrawalOperationId = m.priorReadProof.identity.operationId;
      },
    ],
    [
      "profile collision",
      (m: any) => {
        m.reactivationOperationId = m.priorReadProof.identity.profiles.A1.id;
      },
    ],
    [
      "provider subject collision",
      (m: any) => {
        m.withdrawalOperationId =
          m.priorReadProof.identity.profiles.A2.providerSubject;
      },
    ],
    [
      "fixture collision",
      (m: any) => {
        m.withdrawalOperationId = m.priorReadProof.fixture.projectId;
      },
    ],
  ])("refuses %s without echoing input", (_name, change) => {
    const value = manifest();
    change(value);
    expect(() => proof.planHomologIdentityCycle(value)).toThrow(
      "HOMOLOG_CYCLE_MANIFEST_INVALID"
    );
  });
  it("keeps digest stable across property order but binds the complete historical manifest", () => {
    const value = manifest();
    expect(() => proof.planHomologIdentityCycle(value)).not.toThrow();
    const hash = proof.planHomologIdentityCycle(value).manifestHash;
    expect(
      proof.planHomologIdentityCycle(
        Object.fromEntries(Object.entries(value).reverse())
      ).manifestHash
    ).toBe(hash);
    value.priorReadProof.identity.sourceCommit = "d".repeat(40);
    expect(proof.planHomologIdentityCycle(value).manifestHash).not.toBe(hash);
  });
  it("does not broaden the old read-proof parser", () => {
    expect(() => proof.parseHomologReadProofManifest(manifest())).toThrow(
      "HOMOLOG_READ_MANIFEST_INVALID"
    );
  });
});
