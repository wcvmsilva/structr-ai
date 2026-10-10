import { describe, expect, it, vi } from "vitest";
import { scopeWorkspaceReadCommandSchema } from "../shared/scope-workspace-read";
import { decodeAuthenticatedScopeWorkspaceRead } from "./authenticated-scope-workspace-read";

const actorId = "a1000000-0000-4000-8000-000000000001";
const tenantId = "b1000000-0000-4000-8000-000000000001";
const projectId = "c1000000-0000-4000-8000-000000000001";
const intakeFormId = "d1000000-0000-4000-8000-000000000001";
const other = "e1000000-0000-4000-8000-000000000001";
const command = { projectId, intakeFormId };
const identity = { actorId, tenantId };
function envelope(): any {
  return {
    version: "structr-authenticated-scope-workspace-read-v1",
    context: { ...identity },
    project: {
      id: projectId,
      tenantId,
      name: "Synthetic",
      projectType: "stored-new-type",
      channel: null,
      status: "intake",
      address: "1 Synthetic Lane",
      city: null,
      state: null,
      zipCode: null,
      county: null,
      zone: null,
    },
    intake: {
      id: intakeFormId,
      tenantId,
      projectId,
      status: "draft",
      serviceType: " RAW ",
      area: "0.00",
      finishLevel: null,
      condition: null,
      channel: null,
      notes: "café 🏗️\n",
      createdAt: "2026-10-09T12:00:00.123Z",
      updatedAt: "2026-10-09T12:01:00.456Z",
    },
    scopes: { state: "notLoaded" },
    catalog: { state: "notLoaded" },
  };
}
const decode = (
  raw: unknown,
  input: unknown = command,
  expected: unknown = identity
) => decodeAuthenticatedScopeWorkspaceRead(raw, input, expected);

describe("SWR-1 closed command and decoded workspace", () => {
  it("preserves both canonical IDs without selecting or normalizing an intake", () => {
    expect(scopeWorkspaceReadCommandSchema.parse(command)).toEqual({
      projectId,
      intakeFormId,
    });
  });
  it.each([
    {},
    { projectId },
    { intakeFormId },
    { ...command, actorId },
    { ...command, tenantId },
    { ...command, projectId: projectId.toUpperCase() },
    { ...command, intakeFormId: ` ${intakeFormId}` },
    { ...command, projectId: "00000000-0000-0000-0000-000000000000" },
    { ...command, intakeFormId: null },
    { ...command, intakeFormId: 42 },
  ])("rejects invalid or expanded command %#", input => {
    expect(scopeWorkspaceReadCommandSchema.safeParse(input).success).toBe(
      false
    );
    expect(() => decode(envelope(), input)).toThrowError(
      expect.objectContaining({ kind: "invalid_request" })
    );
  });
  it("rejects command accessors without executing them", () => {
    const getter = vi.fn(() => projectId);
    const input = {
      intakeFormId,
      get projectId() {
        return getter();
      },
    };
    expect(scopeWorkspaceReadCommandSchema.safeParse(input).success).toBe(
      false
    );
    expect(getter).not.toHaveBeenCalled();
  });
  it("returns a versioned pair, Date values and explicit unloaded sentinels without enrichment", () => {
    const result = decode(envelope());
    expect(result).toEqual({
      ...envelope(),
      intake: {
        ...envelope().intake,
        createdAt: new Date("2026-10-09T12:00:00.123Z"),
        updatedAt: new Date("2026-10-09T12:01:00.456Z"),
      },
    });
    expect(result).not.toHaveProperty("readiness");
    expect(result).not.toHaveProperty("latestDraft");
  });
  it.each([
    [
      "version",
      (r: any) => {
        r.version = "legacy";
      },
    ],
    [
      "actor",
      (r: any) => {
        r.context.actorId = other;
      },
    ],
    [
      "context tenant",
      (r: any) => {
        r.context.tenantId = other;
      },
    ],
    [
      "project",
      (r: any) => {
        r.project.id = other;
      },
    ],
    [
      "intake",
      (r: any) => {
        r.intake.id = other;
      },
    ],
    [
      "project tenant",
      (r: any) => {
        r.project.tenantId = other;
      },
    ],
    [
      "intake tenant",
      (r: any) => {
        r.intake.tenantId = other;
      },
    ],
    [
      "intake parent",
      (r: any) => {
        r.intake.projectId = other;
      },
    ],
    [
      "extra top field",
      (r: any) => {
        r.readiness = {};
      },
    ],
    [
      "extra identity",
      (r: any) => {
        r.context.role = "admin";
      },
    ],
    [
      "project contacts",
      (r: any) => {
        r.project.clientEmail = "synthetic@example.invalid";
      },
    ],
    [
      "raw payload",
      (r: any) => {
        r.intake.rawPayload = {};
      },
    ],
    [
      "missing nullable field",
      (r: any) => {
        delete r.intake.notes;
      },
    ],
    [
      "numeric area",
      (r: any) => {
        r.intake.area = 4;
      },
    ],
    [
      "false empty scopes",
      (r: any) => {
        r.scopes = [];
      },
    ],
    [
      "loaded catalog",
      (r: any) => {
        r.catalog.state = "loaded";
      },
    ],
    [
      "extra sentinel field",
      (r: any) => {
        r.scopes.items = [];
      },
    ],
    [
      "invalid calendar",
      (r: any) => {
        r.intake.createdAt = "2026-02-30T00:00:00.000Z";
      },
    ],
    [
      "microseconds",
      (r: any) => {
        r.intake.updatedAt = "2026-10-09T12:00:00.123456Z";
      },
    ],
    [
      "offset timestamp",
      (r: any) => {
        r.intake.updatedAt = "2026-10-09T12:00:00.000+00:00";
      },
    ],
    [
      "Date on wire",
      (r: any) => {
        r.intake.updatedAt = new Date();
      },
    ],
    [
      "NUL",
      (r: any) => {
        r.project.name = "bad\0text";
      },
    ],
    [
      "lone surrogate",
      (r: any) => {
        r.intake.notes = "\ud800";
      },
    ],
    [
      "NIL",
      (r: any) => {
        r.project.id = "00000000-0000-0000-0000-000000000000";
      },
    ],
  ] as const)("refuses the entire envelope for %s", (_label, change) => {
    const raw = envelope();
    change(raw);
    expect(() => decode(raw)).toThrowError(
      expect.objectContaining({ kind: "unavailable" })
    );
  });
  it.each([
    null,
    { ...identity, actorId: other },
    { ...identity, tenantId: null },
    { ...identity, role: "admin" },
  ])(
    "does not accept an absent, foreign or expanded expected identity %#",
    expected => {
      expect(() => decode(envelope(), command, expected)).toThrowError(
        expect.objectContaining({ kind: "unavailable" })
      );
    }
  );
  it("rejects wire getters without observing their value", () => {
    const raw = envelope(),
      getter = vi.fn(() => "secret");
    Object.defineProperty(raw.intake, "notes", {
      enumerable: true,
      get: getter,
    });
    expect(() => decode(raw)).toThrowError(
      expect.objectContaining({ kind: "unavailable" })
    );
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(["prototype", "symbol", "hidden", "undefined", "cycle"])(
    "rejects non-JSON %s",
    variant => {
      const raw = envelope();
      if (variant === "prototype")
        Object.setPrototypeOf(raw.intake, { inherited: true });
      if (variant === "symbol") raw[Symbol("hidden")] = true;
      if (variant === "hidden")
        Object.defineProperty(raw, "hidden", { value: true });
      if (variant === "undefined") raw.intake.notes = undefined;
      if (variant === "cycle") raw.intake.notes = raw;
      expect(() => decode(raw)).toThrowError(
        expect.objectContaining({ kind: "unavailable" })
      );
    }
  );
  it("accepts exactly 65536 UTF-8 text bytes and rejects one additional multibyte character", () => {
    const raw = envelope();
    raw.intake.notes = "é".repeat(32768);
    expect(decode(raw).intake.notes).toBe(raw.intake.notes);
    raw.intake.notes += "é";
    expect(() => decode(raw)).toThrowError(
      expect.objectContaining({ kind: "unavailable" })
    );
  });
  it("refuses aggregate JSON over 1 MiB even when every text is within its limit", () => {
    const raw = envelope();
    for (const key of [
      "name",
      "projectType",
      "channel",
      "status",
      "address",
      "city",
      "state",
      "zipCode",
      "county",
      "zone",
    ])
      raw.project[key] = "\n".repeat(65536);
    expect(() => decode(raw)).toThrowError(
      expect.objectContaining({ kind: "unavailable" })
    );
  });
});
