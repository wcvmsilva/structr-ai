import { describe, expect, it, vi } from "vitest";
import {
  parseCalculatorPair,
  readCalculatorIntent,
  writeCalculatorIntent,
  createCalculatorJourney,
  CALCULATOR_INTENT_KEY,
} from "../client/src/lib/calculator-intent";
const PROJECT = "bc100000-0000-4000-8000-000000000001",
  INTAKE = "bc100000-0000-4000-8000-000000000002",
  ASSEMBLY = "bc100000-0000-4000-8000-000000000003",
  SUBJECT = "bc100000-0000-4000-8000-000000000004",
  SESSION = "bc100000-0000-4000-8000-000000000005",
  REQUEST = "bc100000-0000-4000-8000-000000000006";
const pair = { projectId: PROJECT, intakeFormId: INTAKE },
  owner = { subject: SUBJECT, sessionId: SESSION };
const now = 1791633600000,
  hash = "a".repeat(64),
  calcHash = "b".repeat(64);
const command = {
  contractVersion: "calculator-v1" as const,
  operation: "calculator.create" as const,
  ...pair,
  assemblies: [{ assemblyId: ASSEMBLY, quantity: 1 }],
  requestId: REQUEST,
  expectedSourceHash: hash,
  expectedCalculationHash: calcHash,
};
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
const intent = () => ({
  version: 1 as const,
  ...owner,
  createdAt: now,
  expiresAt: now + 86400000,
  command: structuredClone(command),
});
describe("Calculator contextual URL and bounded recovery intent", () => {
  it("accepts exactly one known canonical pair", () =>
    expect(
      parseCalculatorPair(`projectId=${PROJECT}&intakeFormId=${INTAKE}`)
    ).toEqual(pair));
  it.each([
    "",
    `projectId=${PROJECT}`,
    `projectId=${PROJECT}&intakeFormId=${INTAKE}&projectId=${PROJECT}`,
    `projectId=${PROJECT.toUpperCase()}&intakeFormId=${INTAKE}`,
    `projectId=00000000-0000-0000-0000-000000000000&intakeFormId=${INTAKE}`,
    `projectId=${PROJECT}&intakeFormId=${INTAKE}&tenantId=${SUBJECT}`,
  ])("rejects incomplete, ambiguous or authoritative URL %s", search =>
    expect(parseCalculatorPair(search)).toBeNull()
  );
  it("persists only immutable identifiers selections and original confirmation hashes", () => {
    const s = storage();
    expect(writeCalculatorIntent(s, intent())).toBe(true);
    expect(JSON.parse(s.getItem(CALCULATOR_INTENT_KEY)!)).toEqual(intent());
    expect(readCalculatorIntent(s, owner, pair, now)).toEqual(intent());
  });
  it.each([{ subject: ASSEMBLY }, { sessionId: ASSEMBLY }])(
    "clears another subject or session intent",
    patch => {
      const s = storage();
      s.setItem(CALCULATOR_INTENT_KEY, JSON.stringify(intent()));
      expect(
        readCalculatorIntent(s, { ...owner, ...patch }, pair, now)
      ).toBeNull();
      expect(s.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
    }
  );
  it("clears a different pair rather than transferring the request", () => {
    const s = storage();
    s.setItem(CALCULATOR_INTENT_KEY, JSON.stringify(intent()));
    expect(
      readCalculatorIntent(s, owner, { ...pair, intakeFormId: ASSEMBLY }, now)
    ).toBeNull();
    expect(s.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
  });
  it.each([86400000, 86400001, -1])(
    "clears expired or future intent at offset %i",
    offset => {
      const s = storage();
      s.setItem(CALCULATOR_INTENT_KEY, JSON.stringify(intent()));
      expect(readCalculatorIntent(s, owner, pair, now + offset)).toBeNull();
      expect(s.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
    }
  );
  it.each([
    { bearer: "secret" },
    { costMinor: "4000" },
    { expiresAt: now + 86400001 },
  ])("refuses additional data or excessive retention %j", patch => {
    const s = storage();
    expect(writeCalculatorIntent(s, { ...intent(), ...patch })).toBe(false);
    expect(s.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
  });
  it("bounds hostile storage before parsing", () => {
    const s = storage();
    s.setItem(CALCULATOR_INTENT_KEY, "x".repeat(20000));
    expect(readCalculatorIntent(s, owner, pair, now)).toBeNull();
    expect(s.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
  });
});
import { buildCalculatorResult } from "../shared/financial-calculator-engine";
import {
  calculatorSnapshot,
  calculatorCommand,
  calculatorIds,
} from "./test-support/calculator-engine-fixture";
async function harness(kind: "a" | "b" | "c" = "a", saved = storage()) {
  const raw = await buildCalculatorResult(
    calculatorSnapshot(),
    calculatorCommand([{ assemblyId: calculatorIds[kind], quantity: 1 }])
  );
  const { context: _context, draft: _draft, ...projection } = raw;
  const result = { ...projection, operation: "calculator.calculate" as const };
  const context = {
    contractVersion: "calculator-v1" as const,
    operation: "calculator.context" as const,
    projectId: raw.projectId,
    intakeFormId: raw.intakeFormId,
    clientId: calculatorIds.client,
    options: [
      { assemblyId: calculatorIds[kind], name: kind.toUpperCase(), unit: "EA" },
    ],
  };
  const receipt = {
    contractVersion: "calculator-v1" as const,
    operation: "calculator.create" as const,
    projectId: raw.projectId,
    intakeFormId: raw.intakeFormId,
    requestId: REQUEST,
    status: "confirmed" as const,
    draft: { id: ASSEMBLY, status: "draft", version: 1, supersededBy: null },
    creation: {
      draftId: ASSEMBLY,
      sourceHash: raw.sourceHash,
      calculationHash: raw.calculationHash,
      createdAt: "2026-10-10T16:00:00.000Z",
    },
  };
  const transport = {
    context: vi.fn(async () => context),
    calculate: vi.fn(async () => result),
    create: vi.fn(async () => receipt),
    recover: vi.fn(async () => ({
      ...receipt,
      operation: "calculator.recover" as const,
    })),
  };
  let current = true,
    clock = now;
  const pair = { projectId: raw.projectId, intakeFormId: raw.intakeFormId };
  const deps = {
    storage: saved,
    owner,
    pair,
    now: () => clock,
    requestId: () => REQUEST,
    current: () => current,
    transport,
  };
  const journey = createCalculatorJourney(deps);
  return {
    journey,
    transport,
    result,
    receipt,
    saved,
    pair,
    deps,
    assembly: calculatorIds[kind],
    expire: () => {
      clock = now + 86400000;
    },
    switch: () => {
      current = false;
      journey.invalidate(true);
    },
  };
}
async function ready(h: Awaited<ReturnType<typeof harness>>) {
  await h.journey.load();
  h.journey.select(h.assembly, 1);
  await h.journey.calculate();
  h.journey.confirm(true);
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("Calculator real journey controller", () => {
  it("loads only pair-scoped options with no preselected quantity", async () => {
    const h = await harness();
    await h.journey.load();
    expect(h.journey.getSnapshot().context).toEqual(
      expect.objectContaining(h.pair)
    );
    expect(h.journey.getSnapshot().selections).toEqual([]);
    expect(h.transport.context).toHaveBeenCalledWith({
      mode: "calculator",
      ...h.pair,
    });
    expect(h.transport.calculate).not.toHaveBeenCalled();
  });
  it.each([0, 1.5, 101, NaN])(
    "rejects non-integer or out-of-range quantity %s",
    async q => {
      const h = await harness();
      await h.journey.load();
      h.journey.select(h.assembly, q);
      await h.journey.calculate();
      expect(h.journey.getSnapshot().selections).toEqual([]);
      expect(h.transport.calculate).not.toHaveBeenCalled();
    }
  );
  it("requires simulation and explicit confirmation before creating", async () => {
    const h = await harness();
    await h.journey.load();
    h.journey.select(h.assembly, 1);
    await h.journey.save();
    await h.journey.calculate();
    await h.journey.save();
    expect(h.transport.create).not.toHaveBeenCalled();
    expect(h.journey.getSnapshot().result).toEqual(h.result);
  });
  it("saves C with 0% margin warning and exact original hashes", async () => {
    const h = await harness("c");
    await ready(h);
    await h.journey.save();
    expect(h.transport.create).toHaveBeenCalledWith({
      contractVersion: "calculator-v1",
      operation: "calculator.create",
      ...h.pair,
      assemblies: [{ assemblyId: h.assembly, quantity: 1 }],
      requestId: REQUEST,
      expectedSourceHash: h.result.sourceHash,
      expectedCalculationHash: h.result.calculationHash,
    });
    expect(h.journey.getSnapshot().result.warnings).toContain(
      "calculator.margin_below_policy_floor"
    );
    expect(h.journey.getSnapshot().receipt.status).toBe("confirmed");
  });
  it("single immutable request survives double-click lost response and reload; recovery never writes", async () => {
    const h = await harness();
    await ready(h);
    const pending = deferred<any>();
    h.transport.create.mockImplementation(() => pending.promise);
    const save = h.journey.save();
    await h.journey.save();
    expect(h.transport.create).toHaveBeenCalledTimes(1);
    const original = h.saved.getItem(CALCULATOR_INTENT_KEY);
    pending.resolve(Promise.reject(new Error("lost response")));
    await save;
    const loaded = createCalculatorJourney(h.deps);
    expect(loaded.getSnapshot().intent.command).toEqual(
      h.transport.create.mock.calls[0][0]
    );
    await loaded.load();
    await loaded.save();
    expect(h.transport.create).toHaveBeenCalledTimes(1);
    expect(h.saved.getItem(CALCULATOR_INTENT_KEY)).toBe(original);
    await loaded.recover();
    expect(h.transport.recover).toHaveBeenCalledWith({
      contractVersion: "calculator-v1",
      operation: "calculator.recover",
      ...h.pair,
      requestId: REQUEST,
    });
    expect(loaded.getSnapshot().receipt.status).toBe("confirmed");
  });
  it("keeps intent on not_found and never derives rollback or retries a create", async () => {
    const h = await harness();
    await ready(h);
    h.transport.create.mockRejectedValue(new Error("timeout"));
    await h.journey.save();
    h.transport.recover.mockResolvedValue({
      ...h.receipt,
      operation: "calculator.recover",
      status: "not_found",
      draft: null,
      creation: null,
    } as any);
    await h.journey.recover();
    await h.journey.save();
    expect(h.journey.getSnapshot().intent.command.requestId).toBe(REQUEST);
    expect(h.transport.create).toHaveBeenCalledTimes(1);
    expect(h.journey.getSnapshot().message).toMatch(/not confirmed|not found/i);
  });
  it("stale source removes confirmation and requires a new calculation", async () => {
    const h = await harness();
    await ready(h);
    h.transport.create.mockRejectedValue(
      Object.assign(new Error("FINANCIAL_EXECUTOR_CONFIRMATION_STALE"), {
        data: { code: "CONFLICT" },
      })
    );
    await h.journey.save();
    expect(h.journey.getSnapshot().result).toBeNull();
    expect(h.journey.getSnapshot().confirmed).toBe(false);
    expect(h.journey.getSnapshot().intent).toBeNull();
    await h.journey.save();
    expect(h.transport.create).toHaveBeenCalledTimes(1);
  });
  it("selection edits revoke calculation and confirmation", async () => {
    const h = await harness();
    await ready(h);
    h.journey.select(h.assembly, 2);
    await h.journey.save();
    expect(h.journey.getSnapshot().result).toBeNull();
    expect(h.journey.getSnapshot().confirmed).toBe(false);
    expect(h.transport.create).not.toHaveBeenCalled();
  });
  it("ignores a late calculation after selection change", async () => {
    const h = await harness();
    await h.journey.load();
    h.journey.select(h.assembly, 1);
    const pending = deferred<any>();
    h.transport.calculate.mockImplementation(() => pending.promise);
    const read = h.journey.calculate();
    h.journey.select(h.assembly, 2);
    pending.resolve(h.result);
    await read;
    expect(h.journey.getSnapshot().result).toBeNull();
  });
  it("clears data and storage on context change and ignores late receipt", async () => {
    const h = await harness();
    await ready(h);
    const pending = deferred<any>();
    h.transport.create.mockImplementation(() => pending.promise);
    const save = h.journey.save();
    h.switch();
    pending.resolve(h.receipt);
    await save;
    expect(h.journey.getSnapshot().receipt).toBeNull();
    expect(h.journey.getSnapshot().result).toBeNull();
    expect(h.saved.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
  });
  it.each(["projectId", "requestId", "sourceHash"])(
    "rejects receipt with mismatched %s",
    async field => {
      const h = await harness();
      await ready(h);
      h.transport.create.mockResolvedValue(
        field === "sourceHash"
          ? {
              ...h.receipt,
              creation: { ...h.receipt.creation, sourceHash: hash },
            }
          : { ...h.receipt, [field]: SUBJECT }
      );
      await h.journey.save();
      expect(h.journey.getSnapshot().receipt).toBeNull();
      expect(h.journey.getSnapshot().intent.command.requestId).toBe(REQUEST);
    }
  );
  it("refuses context for another pair", async () => {
    const h = await harness();
    h.transport.context.mockResolvedValue({
      ...(await h.transport.context()),
      projectId: SUBJECT,
    });
    await h.journey.load();
    expect(h.journey.getSnapshot().context).toBeNull();
  });
  it("expired storage offers manual request lookup and never repeats the writer", async () => {
    const h = await harness();
    await ready(h);
    h.transport.create.mockRejectedValue(new Error("timeout"));
    await h.journey.save();
    h.expire();
    const loaded = createCalculatorJourney(h.deps);
    expect(loaded.getSnapshot().intent).toBeNull();
    await loaded.recover(REQUEST);
    expect(h.transport.recover).toHaveBeenCalledWith({
      contractVersion: "calculator-v1",
      operation: "calculator.recover",
      ...h.pair,
      requestId: REQUEST,
    });
    expect(h.transport.create).toHaveBeenCalledTimes(1);
  });
  it("refuses creating if recoverable intent cannot be stored", async () => {
    const h = await harness();
    await ready(h);
    h.deps.storage.setItem = () => {
      throw new Error("storage blocked");
    };
    await h.journey.save();
    expect(h.transport.create).not.toHaveBeenCalled();
    expect(h.journey.getSnapshot().message).toMatch(/storage/i);
  });
});
import {
  reconcileCalculatorIntentSession,
  calculatorSessionId,
} from "../client/src/lib/calculator-intent";
const browserSession = (subject = SUBJECT, sessionId = SESSION) => ({
  user: { id: subject },
  access_token: `e30.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url")}.test`,
});
describe("Calculator persistence across browser authentication", () => {
  it("keeps recovery intent through first hydration and token refresh of the same session", () => {
    const s = storage();
    writeCalculatorIntent(s, intent());
    reconcileCalculatorIntentSession(browserSession(), s, now);
    expect(s.getItem(CALCULATOR_INTENT_KEY)).not.toBeNull();
    expect(calculatorSessionId(browserSession())).toBe(SESSION);
  });
  it.each([
    null,
    browserSession(ASSEMBLY),
    browserSession(SUBJECT, ASSEMBLY),
    { user: { id: SUBJECT }, access_token: "invalid" },
  ])(
    "clears persisted intent on logout or changed subject/session even off the page",
    session => {
      const s = storage();
      writeCalculatorIntent(s, intent());
      reconcileCalculatorIntentSession(session, s, now);
      expect(s.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
    }
  );
  it("expires retained intent during hydration", () => {
    const s = storage();
    writeCalculatorIntent(s, intent());
    reconcileCalculatorIntentSession(browserSession(), s, now + 86400000);
    expect(s.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
  });
  it("manual lookup clears unrelated simulation and confirmation", async () => {
    const h = await harness();
    await ready(h);
    await h.journey.recover(REQUEST);
    expect(h.journey.getSnapshot().result).toBeNull();
    expect(h.journey.getSnapshot().confirmed).toBe(false);
  });
});
import { formatCalculatorMoney } from "../client/src/lib/calculator-intent";
describe("Calculator money display preserves minor units", () => {
  it.each([
    ["4000", "$40.00"],
    ["10000", "$100.00"],
    ["6000", "$60.00"],
    ["9000", "$90.00"],
    ["1", "$0.01"],
    ["0", "$0.00"],
    ["-1", "-$0.01"],
  ])("renders %s minor as %s", (minor, label) =>
    expect(formatCalculatorMoney(minor)).toBe(label)
  );
});
describe("Calculator receipt navigation", () => {
  it("offers an exact current confirmed draft destination only after confirmation", async () => {
    const h = await harness();
    expect(h.journey.confirmedDraftPath()).toBeNull();
    await ready(h);
    await h.journey.save();
    expect(h.journey.confirmedDraftPath()).toBe(`/estimates/${ASSEMBLY}`);
    h.switch();
    expect(h.journey.confirmedDraftPath()).toBeNull();
  });
  it("never navigates from an unresolved or not_found request", async () => {
    const h = await harness();
    await ready(h);
    h.transport.create.mockRejectedValue(new Error("lost"));
    await h.journey.save();
    expect(h.journey.confirmedDraftPath()).toBeNull();
    h.transport.recover.mockResolvedValue({
      ...h.receipt,
      operation: "calculator.recover",
      status: "not_found",
      draft: null,
      creation: null,
    } as any);
    await h.journey.recover();
    expect(h.journey.confirmedDraftPath()).toBeNull();
  });
});
it("projects a full live page identity to only subject/sessionId before persisting", async () => {
  const h = await harness();
  const pageIdentity = {
    ...owner,
    actorId: PROJECT,
    tenantId: INTAKE,
    generation: 7,
  };
  h.deps.owner = pageIdentity;
  await ready(h);
  await h.journey.save();
  expect(h.journey.getSnapshot().receipt?.status).toBe("confirmed");
  const persisted = JSON.parse(h.saved.getItem(CALCULATOR_INTENT_KEY)!);
  expect(persisted.subject).toBe(SUBJECT);
  expect(persisted).not.toHaveProperty("actorId");
  expect(persisted).not.toHaveProperty("tenantId");
  expect(persisted).not.toHaveProperty("generation");
});
it("preserves an existing uncertain command when a second mounted instance attempts to save", async () => {
  const first = await harness(),
    second = await harness("a", first.saved);
  second.deps.requestId = () => SUBJECT;
  await ready(first);
  await ready(second);
  first.transport.create.mockRejectedValue(new Error("lost"));
  await first.journey.save();
  const original = first.saved.getItem(CALCULATOR_INTENT_KEY);
  await second.journey.save();
  expect(second.transport.create).not.toHaveBeenCalled();
  expect(first.saved.getItem(CALCULATOR_INTENT_KEY)).toBe(original);
  expect(second.journey.getSnapshot().intent?.command.requestId).toBe(REQUEST);
});
import { calculatorBrowserStorage } from "../client/src/lib/calculator-intent";
it("uses reload-persistent per-tab storage so another tab cannot replace the recovery request", () => {
  const tab = storage(),
    shared = storage();
  vi.stubGlobal("sessionStorage", tab);
  vi.stubGlobal("localStorage", shared);
  try {
    expect(calculatorBrowserStorage()).toBe(tab);
    writeCalculatorIntent(calculatorBrowserStorage(), intent());
    expect(shared.getItem(CALCULATOR_INTENT_KEY)).toBeNull();
    expect(tab.getItem(CALCULATOR_INTENT_KEY)).not.toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("another tab with a different pair cannot erase this tab request across reload", async () => {
  const first = await harness();
  await ready(first);
  first.transport.create.mockRejectedValue(new Error("lost"));
  await first.journey.save();
  const original = first.saved.getItem(CALCULATOR_INTENT_KEY);
  const other = await harness();
  other.deps.pair = { projectId: SUBJECT, intakeFormId: SESSION };
  createCalculatorJourney(other.deps);
  expect(first.saved.getItem(CALCULATOR_INTENT_KEY)).toBe(original);
  expect(
    createCalculatorJourney(first.deps).getSnapshot().intent?.command.requestId
  ).toBe(REQUEST);
});
