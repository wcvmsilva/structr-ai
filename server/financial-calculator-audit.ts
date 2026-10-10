import {
  assertExecutorTransaction,
  callCalculatorRoutine,
  type ExecutorTransaction,
} from "../services/financial-executor/src/transaction";
import {
  canonicalizeCalculator,
  hashCalculatorCanonical,
} from "../shared/financial-calculator-engine";
import { serializeExecutorJson } from "../shared/financial-executor-json";
import { FinancialExecutorError } from "../shared/financial-executor-error";
import {
  validateCalculatorReceipt,
  type CalculatorReceiptIntent,
  type CalculatorReceipt,
} from "./financial-calculator-receipt";

export interface AuditedCalculatorCreation {
  receipt: CalculatorReceipt;
  currentDraft: Record<string, unknown>;
}
function invalid(): never {
  throw new FinancialExecutorError("FINANCIAL_EXECUTOR_RECEIPT_INVALID");
}

/** F2 adapter for the nominal SQL lifecycle, always inside the same real Drizzle transaction.
 * The SQL writer inserts the audit; this helper independently validates its full content,
 * then reads the durable request/audit/row again before the enclosing transaction can commit.
 */
export async function withAuditLog(
  tx: ExecutorTransaction,
  intent: CalculatorReceiptIntent,
  lifecycle: () => Promise<Record<string, unknown>>
): Promise<AuditedCalculatorCreation> {
  const actual = assertExecutorTransaction(tx);
  const expected = structuredClone(intent);
  if (
    actual.command.operation !== "calculator.create" ||
    expected.command.operation !== "calculator.create" ||
    canonicalizeCalculator(actual.command) !==
      canonicalizeCalculator(expected.command)
  )
    invalid();
  if (
    expected.binding.id !== actual.binding.id ||
    expected.binding.actorId !== actual.binding.actorId ||
    expected.binding.tenantId !== actual.binding.tenantId ||
    expected.clientId !== actual.clientId ||
    expected.commandHash !== (await hashCalculatorCanonical(actual.command))
  )
    invalid();
  assertExecutorTransaction(tx);
  const result = await lifecycle();
  const receipt = await validateCalculatorReceipt(result.receipt, expected);
  if (
    serializeExecutorJson(result.currentDraft) !==
    serializeExecutorJson(receipt.draft)
  )
    invalid();
  const persisted = await callCalculatorRoutine(tx, "recover", actual.command);
  const readback = await validateCalculatorReceipt(persisted.receipt, expected);
  if (
    serializeExecutorJson(receipt) !== serializeExecutorJson(readback) ||
    serializeExecutorJson(persisted.currentDraft) !==
      serializeExecutorJson(receipt.draft)
  )
    invalid();
  assertExecutorTransaction(tx);
  return { receipt: readback, currentDraft: structuredClone(readback.draft) };
}
