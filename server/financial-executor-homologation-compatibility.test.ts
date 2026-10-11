import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inspectCalculatorCompatibility } from "../scripts/financial-executor-homologation/compatibility";
const permission = JSON.parse(
  readFileSync(
    new URL(
      "../docs/security/financial-executor/permission-manifest.json",
      import.meta.url
    ),
    "utf8"
  )
);
const prior = JSON.parse(
  readFileSync(
    new URL(
      "../docs/security/financial-executor/homolog-readonly-observation-2026-10-10.json",
      import.meta.url
    ),
    "utf8"
  )
);
const members = prior.applicationCatalog.missingObjects.map(
  (r: any) => r.identity
);
function fixture() {
  const observation: any = {
    version: "calculator-compatibility-observation-v1",
    databaseVersion: "170011",
    extension: {
      name: "pgcrypto",
      version: "1.3",
      namespace: "public",
      members: [...members],
    },
    objects: structuredClone(permission.baselineObjects),
    surface: [],
    unresolved: [],
  };
  const approvedManifest = {
    version: "calculator-compatibility-manifest-v1",
    state: "reviewed-local-candidate",
    observation: structuredClone(observation),
  };
  return { observation, approvedManifest };
}
function outcome(change: (o: any, m: any) => void) {
  const { observation, approvedManifest } = fixture();
  change(observation, approvedManifest);
  return inspectCalculatorCompatibility(observation, approvedManifest);
}
describe("exact Calculator compatibility projection", () => {
  it("keeps the exact 1011 common application objects and 36 extension members", () => {
    const { observation, approvedManifest } = fixture();
    expect(
      observation.objects.filter((o: any) => !members.includes(o.identity))
    ).toHaveLength(1011);
    expect(
      inspectCalculatorCompatibility(observation, approvedManifest)
    ).toMatchObject({
      status: "compatible",
      applicationHash:
        "45bf03ac2fac16724469de89f6a6d26effcf8919972406f99f6196fb2f2a9774",
      findings: [],
    });
  });
  it("projects only pg_depend-proven pgcrypto 1.3 relocation with independently captured hashes", () => {
    const relocated = JSON.parse(
      readFileSync(
        new URL(
          "./test-support/financial-calculator-boundary/pgcrypto-relocated.json",
          import.meta.url
        ),
        "utf8"
      )
    );
    const result = outcome(o => {
      o.extension.namespace = "extensions";
      o.extension.members = relocated.map((r: any) => r.identity);
      o.objects = o.objects
        .filter((r: any) => !members.includes(r.identity))
        .concat(relocated);
    });
    expect(result).toMatchObject({
      status: "compatible",
      applicationHash:
        "45bf03ac2fac16724469de89f6a6d26effcf8919972406f99f6196fb2f2a9774",
      findings: [],
    });
  });

  it.each([
    ["same-name impostor", (o: any) => o.extension.members.pop()],
    [
      "extra extension member",
      (o: any) => o.extension.members.push("function:public.hostile()"),
    ],
    [
      "extension definition change",
      (o: any) => {
        o.objects.find((r: any) =>
          members.includes(r.identity)
        ).definition.definition += "--changed";
      },
    ],
    [
      "application definition drift",
      (o: any) => {
        o.objects[0].definition.validated = false;
      },
    ],
    [
      "application missing object",
      (o: any) => {
        o.objects.splice(0, 1);
      },
    ],
    [
      "application extra object",
      (o: any) => {
        o.objects.push({
          ...o.objects[0],
          identity: "relation:public.hostile",
        });
      },
    ],
    [
      "application ownership drift",
      (o: any) => {
        o.objects.find((r: any) =>
          r.identity.startsWith("relation:")
        ).definition.owner = "authenticated";
      },
    ],
    [
      "PUBLIC ACL drift",
      (o: any) => {
        o.objects.find((r: any) =>
          r.identity.startsWith("function:")
        ).definition.acl = null;
      },
    ],
    [
      "column ACL drift",
      (o: any) => {
        o.objects.find((r: any) =>
          r.identity.startsWith("relation:")
        ).definition.columns[0].acl = [
          { grantee: "PUBLIC", privilege: "SELECT", grantable: false },
        ];
      },
    ],
    [
      "schema USAGE drift",
      (o: any) => {
        o.surface.push({
          identity: "schema:extensions",
          definition: { usage: true },
          sha256: "a".repeat(64),
        });
      },
    ],
    [
      "NULL ACL is not empty ACL",
      (o: any) => {
        o.objects.find((r: any) =>
          r.identity.startsWith("function:")
        ).definition.acl = [];
      },
    ],
    [
      "owner default drift",
      (o: any) => {
        o.surface.push({
          identity: "default:postgres:*:f",
          definition: { acl: "{=X/postgres}" },
          sha256: "a".repeat(64),
        });
      },
    ],
    [
      "membership SET drift",
      (o: any) => {
        o.surface.push({
          identity: "membership:owner:login:postgres",
          definition: { set: true },
          sha256: "a".repeat(64),
        });
      },
    ],
    [
      "unknown wrapper targets",
      (o: any) => {
        o.unresolved.push("DYNAMIC_SQL_TARGET_UNRESOLVED");
      },
    ],
    [
      "unreviewed managed surface",
      (_: any, m: any) => {
        m.state = "pending-review";
      },
    ],
    [
      "incomplete input",
      (o: any) => {
        delete o.surface;
      },
    ],
    [
      "duplicate identity",
      (o: any) => {
        o.objects.push(o.objects[0]);
      },
    ],
    [
      "wrong database version",
      (o: any) => {
        o.databaseVersion = "170010";
      },
    ],
    [
      "wrong pgcrypto version",
      (o: any) => {
        o.extension.version = "1.4";
      },
    ],
    [
      "invalid hash",
      (o: any) => {
        o.objects[0].sha256 = "a".repeat(64);
      },
    ],
    [
      "unknown input field",
      (o: any) => {
        o.allowUnknown = true;
      },
    ],
  ] as const)("blocks %s without approving mutation", (_name, change) => {
    expect(outcome(change)).toMatchObject({ status: "blocked" });
  });
  it("does not mutate either input", () => {
    const { observation, approvedManifest } = fixture(),
      before = JSON.stringify({ observation, approvedManifest });
    inspectCalculatorCompatibility(observation, approvedManifest);
    expect(JSON.stringify({ observation, approvedManifest })).toBe(before);
  });
});

it("compares the independently captured hosted manifest exactly without approving application", () => {
  const approved = JSON.parse(
    readFileSync(
      new URL(
        "../docs/security/financial-executor/homolog-compatibility-manifest.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  expect(
    inspectCalculatorCompatibility(
      structuredClone(approved.observation),
      approved
    )
  ).toMatchObject({
    status: "compatible",
    applicationHash:
      "45bf03ac2fac16724469de89f6a6d26effcf8919972406f99f6196fb2f2a9774",
    findings: [],
  });
  const drift = structuredClone(approved.observation);
  drift.unresolved.push("UNKNOWN_WRAPPER_TARGET");
  expect(inspectCalculatorCompatibility(drift, approved).status).toBe(
    "blocked"
  );
});

it.each([undefined, NaN, () => 1, Symbol("metadata")])(
  "rejects non-JSON metadata without throwing",
  value => {
    const { observation, approvedManifest } = fixture();
    observation.objects[0].definition.extra = value;
    expect(() =>
      inspectCalculatorCompatibility(observation, approvedManifest)
    ).not.toThrow();
    expect(
      inspectCalculatorCompatibility(observation, approvedManifest).status
    ).toBe("blocked");
  }
);
