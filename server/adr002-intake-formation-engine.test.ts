import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createIntakeSchema,
  serializeIntakeFormationPreimage,
} from "../shared/intake-formation-engine";

const identity = {
  actorId: "a1000000-0000-4000-8000-000000000001",
  tenantId: "b1000000-0000-4000-8000-000000000001",
};
const command = () => ({
  requestId: "C1000000-0000-4000-8000-000000000001",
  newProject: {
    name: " Synthetic project ",
    projectType: "repair",
    client: { firstName: " Test ", lastName: " Operator " },
    address: " 1 Synthetic Lane ",
  },
  serviceType: "repair",
  rawPayload: { description: "Synthetic only" },
});
const serialize = (input: unknown = command(), context: unknown = identity) =>
  serializeIntakeFormationPreimage(input, context);

describe("candidate intake formation preimage", () => {
  it("freezes all legacy command/nested key order and the UTF8 fingerprint", () => {
    const input = {
      ...command(),
      newProject: {
        ...command().newProject,
        client: {
          firstName: " Test ",
          lastName: " Operator ",
          email: "test@example.invalid",
          phone: "555-0100",
        },
        city: "Synthetic",
        county: "Test",
        state: "SC",
        zip: "00000",
      },
      projectId: null,
      leadId: null,
      clientId: null,
      channel: "insurance",
      serviceType: "repair",
      area: "12",
      finishLevel: "premium",
      condition: "existing",
      notes: "Synthetic “quote”\n😀",
      rawPayload: { z: 1.25, a: [true, null, { second: 2, first: 1 }] },
    };
    // Literal independent of the extracted schema; original router order at 5dbec8a6.
    const frozen =
      '{"requestId":"C1000000-0000-4000-8000-000000000001","newProject":{"name":"Synthetic project","projectType":"repair","client":{"firstName":"Test","lastName":"Operator","email":"test@example.invalid","phone":"555-0100"},"address":"1 Synthetic Lane","city":"Synthetic","county":"Test","state":"SC","zip":"00000"},"projectId":null,"leadId":null,"clientId":null,"channel":"insurance","serviceType":"repair","area":"12","finishLevel":"premium","condition":"existing","notes":"Synthetic “quote”\\n😀","rawPayload":{"z":1.25,"a":[true,null,{"second":2,"first":1}]},"tenantId":"b1000000-0000-4000-8000-000000000001","userId":"a1000000-0000-4000-8000-000000000001"}';
    expect(serialize(input)).toBe(frozen);
    expect(createHash("sha256").update(serialize(input)).digest("hex")).toBe(
      "db0becabd30ba89a1d7e46435a8690b39023ab2c84efd14cf3314b01f16d8d52"
    );
  });

  it("matches the exact existing router/helper serialization and SHA-256 bytes", () => {
    const input = command(),
      parsed = createIntakeSchema.parse(input);
    const legacy = JSON.stringify({
      ...parsed,
      tenantId: identity.tenantId,
      userId: identity.actorId,
    });
    expect(serialize(input)).toBe(legacy);
    expect(createHash("sha256").update(serialize(input)).digest("hex")).toBe(
      createHash("sha256").update(legacy).digest("hex")
    );
    expect(JSON.parse(serialize(input)).newProject.name).toBe(
      "Synthetic project"
    );
    expect(input.newProject.name).toBe(" Synthetic project ");
  });
  it("uses schema property order, strips unknown command keys, preserves raw JSON order", () => {
    const input = {
      rawPayload: { z: 1, a: 2, status: "opaque" },
      ownerUserId: "not-authority",
      ...command(),
    };
    input.rawPayload = { z: 1, a: 2, status: "opaque" };
    const result = serialize(input);
    expect(result.indexOf('"requestId"')).toBe(1);
    expect(result).not.toContain("ownerUserId");
    expect(result).toContain('"rawPayload":{"z":1,"a":2,"status":"opaque"}');
  });
  it("does not normalize UUID casing or erase omitted-versus-null differences", () => {
    const a = command(),
      b = { ...a, requestId: a.requestId.toLowerCase() };
    expect(serialize(a)).not.toBe(serialize(b));
    expect(serialize(a)).not.toBe(serialize({ ...a, notes: null }));
  });
  it("preserves raw JSON key order as part of legacy replay identity", () => {
    expect(serialize({ ...command(), rawPayload: { a: 1, b: 2 } })).not.toBe(
      serialize({ ...command(), rawPayload: { b: 2, a: 1 } })
    );
  });
  it.each([
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "c1000000-0000-8000-8000-000000000001",
  ])("preserves existing Zod UUID %s", requestId => {
    expect(JSON.parse(serialize({ ...command(), requestId })).requestId).toBe(
      requestId
    );
  });
  it("accepts exactly 64KiB in UTF8, rejects one extra ASCII byte", () => {
    const empty = { ...command(), notes: "" },
      overhead = Buffer.byteLength(serialize(empty));
    expect(
      Buffer.byteLength(
        serialize({ ...empty, notes: "x".repeat(65536 - overhead) })
      )
    ).toBe(65536);
    expect(() =>
      serialize({ ...empty, notes: "x".repeat(65537 - overhead) })
    ).toThrow();
  });
  it("counts UTF8 bytes rather than JS code units", () => {
    expect(() =>
      serialize({ ...command(), notes: "é".repeat(32768) })
    ).toThrow();
  });
  it("accepts 16 containers including root but rejects 17", () => {
    let raw: unknown = {};
    for (let i = 0; i < 14; i++) raw = { child: raw };
    expect(() => serialize({ ...command(), rawPayload: raw })).not.toThrow();
    expect(() =>
      serialize({ ...command(), rawPayload: { child: raw } })
    ).toThrow();
  });
  it.each([
    NaN,
    Infinity,
    1n,
    undefined,
    () => 1,
    Symbol("bad"),
    new Date(),
    new Map(),
  ])("rejects non-JSON raw values %#", bad => {
    expect(() => serialize({ ...command(), rawPayload: { bad } })).toThrow();
  });
  it.each(["\u0000", "\ud800", "\udfff"])(
    "rejects strings PostgreSQL cannot represent %#",
    bad => {
      expect(() => serialize({ ...command(), notes: bad })).toThrow();
      expect(() =>
        serialize({ ...command(), rawPayload: { [bad]: 1 } })
      ).toThrow();
    }
  );
  it("accepts paired surrogates and checks UTF16 field lengths", () => {
    expect(JSON.parse(serialize({ ...command(), notes: "😀" })).notes).toBe(
      "😀"
    );
    const input = command();
    input.newProject.name = "😀".repeat(128);
    expect(() => serialize(input)).toThrow();
  });
  it("does not execute accessors or toJSON hooks", () => {
    const getter = vi.fn(() => "secret"),
      input = command();
    Object.defineProperty(input, "notes", { enumerable: true, get: getter });
    expect(() => serialize(input)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const hook = vi.fn(() => ({}));
    expect(() =>
      serialize({ ...command(), rawPayload: { toJSON: hook } })
    ).toThrow();
    expect(hook).not.toHaveBeenCalled();
  });
  it("serializes inspected scalar descriptors without reading a Proxy getter", () => {
    const clean = { ...command(), notes: "inspected" };
    let reads = 0;
    const input = new Proxy(clean, {
      get(target, key, receiver) {
        if (key === "notes") {
          reads++;
          return "\u0000";
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const result = serialize(input);
    expect(JSON.parse(result).notes).toBe("inspected");
    expect(result).toBe(serialize(clean));
    expect(reads).toBe(0);
  });
  it("serializes nested descriptors without invoking a Proxy toJSON hook", () => {
    const hook = vi.fn(() => ({ injected: "\u0000" }));
    const clean = { a: 1 };
    const nested = new Proxy(clean, {
      get(target, key, receiver) {
        return key === "toJSON" ? hook : Reflect.get(target, key, receiver);
      },
    });
    const result = serialize({ ...command(), rawPayload: { nested } });
    expect(hook).not.toHaveBeenCalled();
    expect(JSON.parse(result).rawPayload).toEqual({ nested: { a: 1 } });
    expect(result).toBe(
      serialize({ ...command(), rawPayload: { nested: clean } })
    );
  });
  it("binds the inspected identity without reading a Proxy getter", () => {
    let reads = 0;
    const context = new Proxy(identity, {
      get(target, key, receiver) {
        if (key === "actorId") {
          reads++;
          return "a1000000-0000-4000-8000-000000000002";
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const result = serialize(command(), context);
    expect(JSON.parse(result).userId).toBe(identity.actorId);
    expect(result).toBe(serialize());
    expect(reads).toBe(0);
  });
  it("checks the inspected rawPayload root for the key Zod would discard", () => {
    const clean = {
      ...command(),
      rawPayload: JSON.parse('{"__proto__":{"retained":true}}'),
    };
    let reads = 0;
    const input = new Proxy(clean, {
      get(target, key, receiver) {
        if (key === "rawPayload") {
          reads++;
          return {};
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() => serialize(input)).toThrow("Invalid intake formation input");
    expect(reads).toBe(0);
  });
  it("uses the inspected array length without reading a Proxy getter", () => {
    let reads = 0;
    const items = new Proxy([1, { value: 2 }], {
      get(target, key, receiver) {
        if (key === "length") {
          reads++;
          return 99;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const result = serialize({ ...command(), rawPayload: { items } });
    expect(JSON.parse(result).rawPayload).toEqual({ items: [1, { value: 2 }] });
    expect(result).toBe(
      serialize({ ...command(), rawPayload: { items: [1, { value: 2 }] } })
    );
    expect(reads).toBe(0);
  });
  it("still refuses NUL in an inspected descriptor when a Proxy getter hides it", () => {
    const input = new Proxy({ ...command(), notes: "\u0000" }, {
      get(target, key, receiver) {
        return key === "notes" ? "clean" : Reflect.get(target, key, receiver);
      },
    });
    expect(() => serialize(input)).toThrow("Invalid intake formation input");
  });
  it("preserves legacy bytes for optional fields, negative zero and nested __proto__", () => {
    const input = {
      ...command(),
      notes: undefined,
      projectId: null,
      rawPayload: {
        nested: JSON.parse('{"z":-0,"__proto__":{"marker":"retained"},"a":1}'),
      },
    };
    const legacy = JSON.stringify({
      ...createIntakeSchema.parse(input),
      tenantId: identity.tenantId,
      userId: identity.actorId,
    });
    const result = serialize(input);
    expect(result).toBe(legacy);
    expect(result).toContain('"requestId":"C1000000-0000-4000-8000-000000000001"');
    expect(result).toContain('"projectId":null');
    expect(result).not.toContain('"notes"');
    expect(result).toContain('"nested":{"z":0,"__proto__":{"marker":"retained"},"a":1}');
    expect(Object.hasOwn(JSON.parse(result).rawPayload.nested, "__proto__")).toBe(true);
    expect(Object.is(input.rawPayload.nested.z, -0)).toBe(true);
  });
  it("rejects cycles and sparse arrays instead of silently changing intent", () => {
    const cycle: any = {};
    cycle.self = cycle;
    expect(() => serialize({ ...command(), rawPayload: cycle })).toThrow();
    expect(() =>
      serialize({ ...command(), rawPayload: { items: new Array(2) } })
    ).toThrow();
  });
  it("rejects a sparse array whose extra property disguises the missing index", () => {
    const items: any = new Array(1);
    items.extra = "intent that JSON would discard";
    expect(() => serialize({ ...command(), rawPayload: { items } })).toThrow(
      "Invalid intake formation input"
    );
  });
  it("refuses the rawPayload key that Zod would silently discard", () => {
    const rawPayload = JSON.parse(
      '{"__proto__":{"marker":"retained intent"},"safe":1}'
    );
    expect(() => serialize({ ...command(), rawPayload })).toThrow(
      "Invalid intake formation input"
    );
  });
  it.each([
    { requestId: undefined },
    { newProject: undefined },
    { projectId: identity.actorId },
    { clientId: identity.actorId },
    { leadId: identity.actorId },
    { serviceType: " " },
    { channel: "residential" },
    { finishLevel: "unknown" },
  ])("refuses unsupported formation command %#", change =>
    expect(() => serialize({ ...command(), ...change })).toThrow()
  );
  it.each([
    null,
    { ...identity, actorId: "invalid" },
    { ...identity, tenantId: identity.tenantId.toUpperCase() },
    { ...identity, role: "admin" },
  ])("refuses unresolved protected identity %#", context =>
    expect(() => serialize(command(), context)).toThrow()
  );
  it("keeps the extracted legacy schema accepting linked intake without newProject", () => {
    expect(
      createIntakeSchema.parse({ projectId: identity.actorId, rawPayload: {} })
    ).toEqual({ projectId: identity.actorId, rawPayload: {} });
  });
});
