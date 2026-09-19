import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({
  commands: [] as string[],
  updates: 0,
  db: null as any,
}));
vi.mock("./db", () => ({ getDb: async () => state.db }));
import { createLead, updateLead, qualifyLead } from "./lead-db";

const scope = {
  userId: "actor-a",
  tenantId: "tenant-a",
  via: "tenant",
} as const;
const lead = {
  id: "lead-a",
  tenantId: "tenant-a",
  ownerUserId: "actor-a",
  status: "new",
};
const dialect = new PgDialect();
beforeEach(() => {
  state.commands = [];
  state.updates = 0;
  const select = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit: async () => [lead],
  };
  state.db = {
    transaction: async (fn: any) => fn(state.db),
    execute: async (query: any) => {
      state.commands.push(dialect.sqlToQuery(query).sql);
    },
    select: () => select,
    update: () => ({
      set: () => ({
        where: async () => {
          state.updates++;
        },
      }),
    }),
    insert: () => ({ values: () => ({ returning: async () => [lead] }) }),
  };
});
describe("lead writer explicit actor contract", () => {
  it("refuses a payload owner as a substitute for the authenticated actor", async () => {
    await expect(
      createLead({ name: "Synthetic", ownerUserId: scope.userId } as any)
    ).rejects.toMatchObject({ code: "PROFILE_NOT_ALLOWED" });
    expect(state.commands).toEqual([]);
  });
  it("refuses a missing actor without a privileged fallback", async () => {
    await expect(
      createLead({ name: "Synthetic" } as any)
    ).rejects.toMatchObject({ code: "PROFILE_NOT_ALLOWED" });
    expect(state.commands).toEqual([]);
  });
  it("uses the already resolved scope actor for updates without an extra argument", async () => {
    await updateLead(lead.id, { notes: "Synthetic" }, scope);
    expect(
      state.commands.some(command => command.includes('"sub":"actor-a"'))
    ).toBe(true);
    expect(state.commands.some(command => command.includes("'postgres'"))).toBe(
      false
    );
    expect(state.updates).toBe(1);
  });
  it("keeps qualify on the same explicit actor path", async () => {
    await qualifyLead(lead.id, scope);
    expect(
      state.commands.some(command => command.includes('"sub":"actor-a"'))
    ).toBe(true);
    expect(state.updates).toBe(1);
  });
  it("refuses an extra actor that disagrees with the resolved scope", async () => {
    await expect(
      updateLead(lead.id, {}, scope, "actor-b")
    ).rejects.toMatchObject({ code: "PROFILE_NOT_ALLOWED" });
    expect(state.commands).toEqual([]);
    expect(state.updates).toBe(0);
  });
});
