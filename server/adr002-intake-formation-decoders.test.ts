import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeAuthenticatedIntakeCreate } from "./authenticated-intake-create";
import { serializeIntakeFormationPreimage } from "../shared/intake-formation-engine";
const identity = {
  actorId: "a1000000-0000-4000-8000-000000000001",
  tenantId: "b1000000-0000-4000-8000-000000000001",
};
const id = "c1000000-0000-4000-8000-000000000001",
  projectId = "d1000000-0000-4000-8000-000000000001";
const input = {
  requestId: id.toUpperCase(),
  newProject: {
    name: "Synthetic",
    projectType: "repair",
    client: { firstName: "Test", lastName: "Operator" },
    address: "1 Synthetic Lane",
  },
  serviceType: "repair",
  rawPayload: {},
};
const wire = () => ({
  version: "structr-authenticated-intake-create-v1",
  context: { ...identity },
  intake: {
    id,
    tenantId: identity.tenantId,
    leadId: null,
    projectId,
    status: "draft",
    formData: {
      creationFingerprint: createHash("sha256")
        .update(serializeIntakeFormationPreimage(input, identity))
        .digest("hex"),
      notes: null,
    },
    createdAt: "2026-10-08T10:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
  },
});
const decode = (
  raw: unknown = wire(),
  command: unknown = input,
  expected: unknown = identity
) => decodeAuthenticatedIntakeCreate(raw, command, expected);
describe("candidate intake response decoder", () => {
  it("preserves every opaque current formData key without Zod record filtering", () => {
    const raw = wire();
    raw.intake.formData = JSON.parse(
      JSON.stringify(raw.intake.formData).slice(0, -1) +
        ',"__proto__":{"retained":true}}'
    );
    const result = decode(raw);
    expect(Object.hasOwn(result.formData as object, "__proto__")).toBe(true);
    expect(JSON.stringify(result.formData)).toBe(
      JSON.stringify(raw.intake.formData)
    );
  });
  it("returns all eight columns with Date objects, preserving input and canonical UUID response", () => {
    const raw = wire(),
      before = JSON.stringify(raw),
      result = decode(raw);
    expect(Object.keys(result)).toHaveLength(8);
    expect(result).toEqual({
      ...raw.intake,
      createdAt: new Date(raw.intake.createdAt),
      updatedAt: new Date(raw.intake.updatedAt),
    });
    expect(JSON.stringify(raw)).toBe(before);
  });
  it("accepts current replay state without imposing original status, notes or project linkage", () => {
    const raw: any = wire();
    raw.intake.status = "converted";
    raw.intake.formData.notes = "Edited later";
    raw.intake.projectId = null;
    raw.intake.leadId = projectId;
    expect(decode(raw)).toMatchObject({
      status: "converted",
      projectId: null,
      leadId: projectId,
      formData: { notes: "Edited later" },
    });
  });
  it.each(Object.keys(wire().intake))("refuses missing column %s", key => {
    const raw: any = wire();
    delete raw.intake[key];
    expect(() => decode(raw)).toThrow();
  });
  it.each([
    (w: any) => {
      w.version = "v2";
    },
    (w: any) => {
      w.context.actorId = projectId;
    },
    (w: any) => {
      w.context.tenantId = projectId;
    },
    (w: any) => {
      w.intake.id = projectId;
    },
    (w: any) => {
      w.intake.tenantId = null;
    },
    (w: any) => {
      w.intake.tenantId = projectId;
    },
    (w: any) => {
      w.intake.createdAt = "2026-10-08T10:00:00Z";
    },
    (w: any) => {
      w.intake.formData.creationFingerprint = "0".repeat(64);
    },
    (w: any) => {
      w.intake.formData = null;
    },
    (w: any) => {
      w.extra = true;
    },
    (w: any) => {
      w.intake.extra = true;
    },
  ])("rejects unbound or malformed envelope %#", mutate => {
    const raw = wire();
    mutate(raw);
    expect(() => decode(raw)).toThrow();
  });
  it("does not expose malformed response content in its error", () => {
    const raw: any = wire();
    raw.intake.id = "private data";
    try {
      decode(raw);
      throw new Error("unexpected success");
    } catch (error) {
      expect(String(error)).toBe(
        "AuthenticatedDataApiError: Authenticated data API request failed (unavailable)"
      );
    }
  });
  it("rejects invalid command or identity", () => {
    expect(() => decode(wire(), {})).toThrow();
    expect(() =>
      decode(wire(), input, { ...identity, tenantId: projectId })
    ).toThrow();
  });
});
