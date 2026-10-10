/** Per-tab, reload-persistent reconciliation hints only. Every read/write remains server-authorized. */
import { z } from "zod";
import { formatEstimateMoney } from "@shared/estimate-display";
import {
  financialExecutorContextResultSchema,
  financialExecutorCalculateResultSchema,
  financialExecutorReceiptResultSchema,
} from "@shared/financial-executor-contract";
import { decodeJwt } from "jose";
import {
  calculatorContextCommandSchema,
  calculatorCalculateCommandSchema,
  calculatorCreateCommandSchema,
  calculatorRecoverCommandSchema,
  type CalculatorPair,
  type CalculatorSelection,
  type CalculateCommand,
  type CreateCalculatorCommand,
  type RecoverCalculatorCommand,
} from "@shared/financial-calculator-engine";
import { internalApprovalVersionPrimitives } from "@shared/internal-estimate-approval-engine";
export const CALCULATOR_INTENT_KEY = "structr-calculator-intent-v1";
const MAX_BYTES = 16000,
  MAX_AGE = 24 * 60 * 60 * 1000;
export type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CalculatorOwner = { subject: string; sessionId: string };
const intentSchema = z
  .object({
    version: z.literal(1),
    subject: internalApprovalVersionPrimitives.uuid,
    sessionId: internalApprovalVersionPrimitives.uuid,
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    command: calculatorCreateCommandSchema,
  })
  .strict()
  .refine(
    v => v.expiresAt > v.createdAt && v.expiresAt - v.createdAt <= MAX_AGE
  );
export type CalculatorIntent = z.infer<typeof intentSchema>;
export function parseCalculatorPair(search: string): CalculatorPair | null {
  const params = new URLSearchParams(search);
  if (
    [...params.keys()].some(
      key => key !== "projectId" && key !== "intakeFormId"
    ) ||
    params.getAll("projectId").length !== 1 ||
    params.getAll("intakeFormId").length !== 1
  )
    return null;
  const parsed = calculatorContextCommandSchema.safeParse({
    contractVersion: "calculator-v1",
    operation: "calculator.context",
    projectId: params.get("projectId"),
    intakeFormId: params.get("intakeFormId"),
  });
  return parsed.success
    ? {
        projectId: parsed.data.projectId,
        intakeFormId: parsed.data.intakeFormId,
      }
    : null;
}
export function calculatorBrowserStorage(): IntentStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}
export function clearCalculatorIntent(
  storage: IntentStorage | null = calculatorBrowserStorage()
) {
  try {
    storage?.removeItem(CALCULATOR_INTENT_KEY);
  } catch {
    /* Storage may be unavailable; no write is authorized by it. */
  }
}
export function writeCalculatorIntent(
  storage: IntentStorage | null,
  value: unknown
): boolean {
  const parsed = intentSchema.safeParse(value);
  if (!storage || !parsed.success) return false;
  const json = JSON.stringify(parsed.data);
  if (json.length > MAX_BYTES) return false;
  try {
    storage.setItem(CALCULATOR_INTENT_KEY, json);
    return storage.getItem(CALCULATOR_INTENT_KEY) === json;
  } catch {
    return false;
  }
}
export function readCalculatorIntent(
  storage: IntentStorage | null,
  owner: CalculatorOwner,
  pair: CalculatorPair,
  now: number
): CalculatorIntent | null {
  try {
    const raw = storage?.getItem(CALCULATOR_INTENT_KEY);
    if (!raw) return null;
    if (raw.length <= MAX_BYTES) {
      const parsed = intentSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        const v = parsed.data;
        if (
          v.subject === owner.subject &&
          v.sessionId === owner.sessionId &&
          v.command.projectId === pair.projectId &&
          v.command.intakeFormId === pair.intakeFormId &&
          v.createdAt <= now &&
          now < v.expiresAt
        )
          return v;
      }
    }
  } catch {
    /* Invalid local storage is never authority. */
  }
  clearCalculatorIntent(storage);
  return null;
}
/** Decoded only for local isolation, never authorization. No token is persisted here. */
export function calculatorSessionId(
  session: { access_token: string } | null
): string | null {
  try {
    const parsed = internalApprovalVersionPrimitives.uuid.safeParse(
      session ? decodeJwt(session.access_token).session_id : null
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export type CalculatorContext = z.infer<
  typeof financialExecutorContextResultSchema
>;
export type CalculatorSimulation = z.infer<
  typeof financialExecutorCalculateResultSchema
>;
export type CalculatorReceipt = z.infer<
  typeof financialExecutorReceiptResultSchema
>;
export type CalculatorJourneyState = {
  context: CalculatorContext | null;
  selections: CalculatorSelection[];
  result: CalculatorSimulation | null;
  intent: CalculatorIntent | null;
  receipt: CalculatorReceipt | null;
  confirmed: boolean;
  busy: boolean;
  message: string | null;
};
export type CalculatorTransport = {
  context(command: CalculatorPair & { mode: "calculator" }): Promise<unknown>;
  calculate(command: CalculateCommand): Promise<unknown>;
  create(command: CreateCalculatorCommand): Promise<unknown>;
  recover(command: RecoverCalculatorCommand): Promise<unknown>;
};
export function createCalculatorJourney(deps: {
  storage: IntentStorage | null;
  owner: CalculatorOwner;
  pair: CalculatorPair;
  now: () => number;
  requestId: () => string;
  current: () => boolean;
  transport: CalculatorTransport;
}) {
  const restored = readCalculatorIntent(
    deps.storage,
    deps.owner,
    deps.pair,
    deps.now()
  );
  let active = true,
    epoch = 0;
  const empty = (): CalculatorJourneyState => ({
    context: null,
    selections: [],
    result: null,
    intent: null,
    receipt: null,
    confirmed: false,
    busy: false,
    message: null,
  });
  let state: CalculatorJourneyState = {
    ...empty(),
    intent: restored,
    selections: restored?.command.assemblies ?? [],
    message: restored
      ? "A previous save needs reconciliation. Check its result; it will not be submitted again."
      : null,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CalculatorJourneyState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };
  const current = (expected = epoch) =>
    active && deps.current() && expected === epoch;
  const samePair = (value: CalculatorPair) =>
    value.projectId === deps.pair.projectId &&
    value.intakeFormId === deps.pair.intakeFormId;
  const receipt = (
    value: unknown,
    requestId: string,
    operation: "calculator.create" | "calculator.recover"
  ) => {
    const parsed = financialExecutorReceiptResultSchema.safeParse(value);
    if (
      !parsed.success ||
      !samePair(parsed.data) ||
      parsed.data.requestId !== requestId ||
      parsed.data.operation !== operation
    )
      throw new Error("Receipt mismatch");
    const intent = state.intent;
    if (
      parsed.data.creation &&
      intent &&
      (parsed.data.creation.sourceHash !== intent.command.expectedSourceHash ||
        parsed.data.creation.calculationHash !==
          intent.command.expectedCalculationHash)
    )
      throw new Error("Receipt hashes changed");
    return parsed.data;
  };
  return {
    confirmedDraftPath: (): string | null =>
      current() && state.receipt?.status === "confirmed" && state.receipt.draft
        ? `/estimates/${state.receipt.draft.id}`
        : null,
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    invalidate(clearIntent = false) {
      active = false;
      epoch++;
      if (clearIntent) clearCalculatorIntent(deps.storage);
      state = empty();
      for (const fn of listeners) fn();
    },
    async load() {
      if (!current() || state.busy) return;
      const attempt = ++epoch;
      update({ busy: true, context: null });
      try {
        const parsed = financialExecutorContextResultSchema.safeParse(
          await deps.transport.context({ mode: "calculator", ...deps.pair })
        );
        if (!current(attempt)) return;
        if (!parsed.success || !samePair(parsed.data))
          throw new Error("Context mismatch");
        update({ context: parsed.data });
      } catch {
        if (current(attempt))
          update({
            message:
              "Could not load authorized assemblies for this project and intake.",
          });
      } finally {
        if (current(attempt)) update({ busy: false });
      }
    },
    select(assemblyId: string, quantity: number | null) {
      if (
        !current() ||
        state.intent ||
        state.receipt ||
        !state.context?.options.some(v => v.assemblyId === assemblyId)
      )
        return;
      if (
        quantity !== null &&
        (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
      )
        return;
      const selections = state.selections.filter(
        v => v.assemblyId !== assemblyId
      );
      if (quantity !== null) {
        const existing = state.selections.findIndex(
          v => v.assemblyId === assemblyId
        );
        if (existing >= 0)
          selections.splice(existing, 0, { assemblyId, quantity });
        else selections.push({ assemblyId, quantity });
      }
      epoch++;
      update({
        selections,
        result: null,
        confirmed: false,
        busy: false,
        message: null,
      });
    },
    async calculate() {
      if (
        !current() ||
        state.busy ||
        state.intent ||
        state.receipt ||
        !state.context
      )
        return;
      const command = calculatorCalculateCommandSchema.safeParse({
        contractVersion: "calculator-v1",
        operation: "calculator.calculate",
        ...deps.pair,
        assemblies: state.selections,
      });
      if (!command.success) return;
      const attempt = ++epoch;
      update({ busy: true, result: null, confirmed: false, message: null });
      try {
        const parsed = financialExecutorCalculateResultSchema.safeParse(
          await deps.transport.calculate(command.data)
        );
        if (!current(attempt)) return;
        if (
          !parsed.success ||
          !samePair(parsed.data) ||
          JSON.stringify(parsed.data.selections) !==
            JSON.stringify(command.data.assemblies)
        )
          throw new Error("Calculation mismatch");
        update({ result: parsed.data });
      } catch {
        if (current(attempt))
          update({
            message:
              "Calculation could not be verified. Check access and calculate again.",
          });
      } finally {
        if (current(attempt)) update({ busy: false });
      }
    },
    confirm(confirmed: boolean) {
      if (current() && state.result && !state.busy && !state.intent)
        update({ confirmed });
    },
    async save() {
      if (
        !current() ||
        state.busy ||
        state.intent ||
        state.receipt ||
        !state.result ||
        !state.confirmed
      )
        return;
      const result = state.result,
        createdAt = deps.now();
      const existing = readCalculatorIntent(
        deps.storage,
        deps.owner,
        deps.pair,
        createdAt
      );
      if (existing) {
        update({
          intent: existing,
          selections: existing.command.assemblies,
          result: null,
          confirmed: false,
          message:
            "Another open Calculator already saved a request. Check that request before starting another draft.",
        });
        return;
      }
      const command = calculatorCreateCommandSchema.parse({
        contractVersion: "calculator-v1",
        operation: "calculator.create",
        ...deps.pair,
        assemblies: state.selections,
        requestId: deps.requestId(),
        expectedSourceHash: result.sourceHash,
        expectedCalculationHash: result.calculationHash,
      });
      // Persist before the first network write and freeze the exact command. A double
      // click, transport rejection, not_found or reload may only perform a lookup.
      for (const selection of command.assemblies) Object.freeze(selection);
      Object.freeze(command.assemblies);
      Object.freeze(command);
      const intent: CalculatorIntent = Object.freeze({
        version: 1,
        subject: deps.owner.subject,
        sessionId: deps.owner.sessionId,
        createdAt,
        expiresAt: createdAt + MAX_AGE,
        command,
      });
      if (!writeCalculatorIntent(deps.storage, intent)) {
        update({
          message:
            "Browser storage is unavailable. Enable storage before saving a recoverable draft.",
        });
        return;
      }
      const attempt = ++epoch;
      update({ intent, busy: true, message: null });
      try {
        const raw = await deps.transport.create(command);
        if (current(attempt))
          update({
            receipt: receipt(raw, command.requestId, "calculator.create"),
            message:
              "Draft saved. This receipt does not authorize approval or construction.",
          });
      } catch (error) {
        if (current(attempt)) {
          const e = error as { message?: string; data?: { code?: string } };
          if (
            e.data?.code === "CONFLICT" &&
            e.message === "FINANCIAL_EXECUTOR_CONFIRMATION_STALE"
          ) {
            clearCalculatorIntent(deps.storage);
            update({
              intent: null,
              result: null,
              confirmed: false,
              message:
                "Sources changed. Calculate again and confirm the new result before saving.",
            });
          } else
            update({
              message:
                "Save outcome is not confirmed. Keep the request ID and check the result; do not submit again.",
            });
        }
      } finally {
        if (current(attempt)) update({ busy: false });
      }
    },
    async recover(manualRequestId?: string) {
      if (!current() || state.busy) return;
      const requestId = state.intent?.command.requestId ?? manualRequestId;
      const command = calculatorRecoverCommandSchema.safeParse({
        contractVersion: "calculator-v1",
        operation: "calculator.recover",
        ...deps.pair,
        requestId,
      });
      if (!command.success) {
        update({
          message: "Enter the recorded request ID for this project and intake.",
        });
        return;
      }
      const attempt = ++epoch;
      update({
        busy: true,
        receipt: null,
        message: null,
        ...(!state.intent
          ? { result: null, confirmed: false, selections: [] }
          : {}),
      });
      try {
        const raw = await deps.transport.recover(command.data);
        if (!current(attempt)) return;
        const value = receipt(
          raw,
          command.data.requestId,
          "calculator.recover"
        );
        update({
          receipt: value,
          message:
            value.status === "confirmed"
              ? "Draft confirmed. Its current state is shown below."
              : "Result not found yet. A concurrent save may still finish. Keep this request ID and check again.",
        });
      } catch {
        if (current(attempt))
          update({
            message:
              "Could not verify this request. Check access and retry this lookup.",
          });
      } finally {
        if (current(attempt)) update({ busy: false });
      }
    },
  };
}
export function reconcileCalculatorIntentSession(
  session: { user: { id: string }; access_token: string } | null,
  storage: IntentStorage | null = calculatorBrowserStorage(),
  now = Date.now()
): void {
  try {
    const raw = storage?.getItem(CALCULATOR_INTENT_KEY);
    if (!raw) return;
    if (session && raw.length <= MAX_BYTES) {
      const parsed = intentSchema.safeParse(JSON.parse(raw));
      if (
        parsed.success &&
        parsed.data.subject === session.user.id &&
        parsed.data.sessionId === calculatorSessionId(session) &&
        parsed.data.createdAt <= now &&
        now < parsed.data.expiresAt
      )
        return;
    }
  } catch {
    /* Clear malformed or inaccessible local hints. */
  }
  clearCalculatorIntent(storage);
}
export function formatCalculatorMoney(minor: string): string {
  if (!/^-?(0|[1-9][0-9]{0,11})$/.test(minor)) return "Unavailable";
  const amount = BigInt(minor),
    digits = (amount < 0n ? -amount : amount).toString().padStart(3, "0");
  return formatEstimateMoney({
    state: "known",
    value: `${amount < 0n ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`,
  });
}
