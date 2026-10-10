/** Isolated Calculator adapters: no global pool, web environment, or independent HTTP reads. */
import { z } from "zod";
import {
  assertExecutorTransaction,
  callCalculatorRoutine,
  type ExecutorTransactionRunner,
  type ExecutorTransaction,
  type ExecutorCommand,
} from "../services/financial-executor/src/transaction";
import type { VerifiedExecutorOperator } from "../services/financial-executor/src/auth";
import {
  financialExecutorPublicResultSchema,
  type FinancialExecutorPublicResult,
} from "../shared/financial-executor-contract";
import {
  calculatorSnapshotSchema,
  buildCalculatorResult,
  hashCalculatorCanonical,
  CalculatorError,
  type CreateCalculatorCommand,
  type RecoverCalculatorCommand,
} from "../shared/financial-calculator-engine";
import {
  CALCULATOR_OPERATIONS as OPS,
  CALCULATOR_PROTOCOL as P,
  FINANCIAL_EXECUTOR_RESULT_STATUSES as STATUS,
} from "../shared/domain/taxonomy";
import { FinancialExecutorError } from "../shared/financial-executor-error";
import { withAuditLog } from "./financial-calculator-audit";
import {
  validateCalculatorReceipt,
  CALCULATOR_DRAFT_RECEIPT_COLUMNS,
  type CalculatorReceipt,
} from "./financial-calculator-receipt";

function invalid(): never {
  throw new FinancialExecutorError("FINANCIAL_EXECUTOR_RECEIPT_INVALID");
}
function publicResult(value: unknown): FinancialExecutorPublicResult {
  const parsed = financialExecutorPublicResultSchema.safeParse(value);
  if (!parsed.success) invalid();
  return parsed.data;
}
export async function loadCalculatorSnapshot(
  tx: ExecutorTransaction,
  command: ExecutorCommand
) {
  const authority = assertExecutorTransaction(tx),
    response = await callCalculatorRoutine(tx, "snapshot", command);
  const parsed = calculatorSnapshotSchema.safeParse(response.snapshot);
  if (!parsed.success) throw new CalculatorError("CALCULATOR_SNAPSHOT_INVALID");
  const snapshot = parsed.data;
  if (
    snapshot.authority.bindingId !== authority.binding.id ||
    snapshot.authority.actorId !== authority.binding.actorId ||
    snapshot.authority.tenantId !== authority.binding.tenantId ||
    snapshot.project.id !== command.projectId ||
    snapshot.intake.id !== command.intakeFormId ||
    snapshot.client.id !== authority.clientId
  )
    throw new CalculatorError("CALCULATOR_IDENTITY_MISMATCH");
  if (!("assemblies" in command))
    throw new CalculatorError("CALCULATOR_INPUT_INVALID");
  const selected = new Set(command.assemblies.map(s => s.assemblyId));
  const lineCount = snapshot.assemblies
    .filter(a => selected.has(a.id))
    .reduce((count, a) => count + a.components.length, 0);
  if (lineCount < 1 || lineCount > 1000)
    throw new CalculatorError("CALCULATOR_CALCULATION_INVALID");
  return snapshot;
}
function currentDraft(value: unknown, receipt: CalculatorReceipt) {
  const row = z.record(z.string(), z.unknown()).parse(value);
  if (
    Object.keys(row).sort().join("\0") !==
    [...CALCULATOR_DRAFT_RECEIPT_COLUMNS].sort().join("\0")
  )
    invalid();
  for (const [key, expected] of Object.entries({
    id: receipt.draftId,
    tenant_id: receipt.tenantId,
    project_id: receipt.projectId,
    intake_form_id: receipt.intakeFormId,
    client_id: receipt.clientId,
    created_by: receipt.actorId,
    source: "assembly_calculator",
  }))
    if (row[key] !== expected) invalid();
  return z
    .object({
      id: z.string().uuid(),
      status: z.string().min(1).max(64),
      version: z.number().int().positive(),
      supersededBy: z.string().uuid().nullable(),
    })
    .strict()
    .parse({
      id: row.id,
      status: row.status,
      version: row.version,
      supersededBy: row.superseded_by,
    });
}
function receiptResult(
  command: CreateCalculatorCommand | RecoverCalculatorCommand,
  receipt: CalculatorReceipt | null,
  row: unknown
): FinancialExecutorPublicResult {
  if (!receipt && (row !== null || command.operation !== OPS[3])) invalid();
  return publicResult({
    contractVersion: P.version,
    operation: command.operation,
    projectId: command.projectId,
    intakeFormId: command.intakeFormId,
    requestId: command.requestId,
    status: receipt ? STATUS[0] : STATUS[1],
    draft: receipt ? currentDraft(row, receipt) : null,
    creation: receipt
      ? {
          draftId: receipt.draftId,
          sourceHash: receipt.sourceHash,
          calculationHash: receipt.calculationHash,
          createdAt: receipt.createdAt,
        }
      : null,
  });
}
export async function executeFinancialCalculator(
  runner: ExecutorTransactionRunner,
  operator: VerifiedExecutorOperator,
  commandInput: ExecutorCommand,
  request?: { deadline: number }
): Promise<FinancialExecutorPublicResult> {
  return runner.run(
    operator,
    commandInput,
    async tx => {
      const authority = assertExecutorTransaction(tx),
        command = authority.command;
      if (command.operation === OPS[0]) {
        const result = await callCalculatorRoutine(tx, "context", command);
        return publicResult({
          contractVersion: P.version,
          operation: OPS[0],
          projectId: command.projectId,
          intakeFormId: command.intakeFormId,
          clientId: result.clientId,
          options: result.options,
        });
      }
      if (command.operation === OPS[2] || command.operation === OPS[3]) {
        // Never demand today's prices to recognize a previously committed request.
        const recovered = await callCalculatorRoutine(tx, "recover", command);
        if (recovered.receipt !== null) {
          const receipt = await validateCalculatorReceipt(recovered.receipt, {
            command,
            commandHash:
              command.operation === OPS[2]
                ? await hashCalculatorCanonical(command)
                : undefined,
            binding: authority.binding,
            clientId: authority.clientId,
          });
          return receiptResult(command, receipt, recovered.currentDraft);
        }
        if (recovered.currentDraft !== null) invalid();
        if (command.operation === OPS[3])
          return receiptResult(command, null, null);
      }
      const snapshot = await loadCalculatorSnapshot(tx, command);
      const calculationCommand = {
        contractVersion: P.version,
        operation: OPS[1],
        projectId: command.projectId,
        intakeFormId: command.intakeFormId,
        assemblies: command.assemblies,
      };
      const calculation = await buildCalculatorResult(
        snapshot,
        calculationCommand
      );
      if (command.operation === OPS[1]) {
        const { draft: _draft, context: _context, ...projection } = calculation;
        return publicResult({ ...projection, operation: OPS[1] });
      }
      if (
        calculation.sourceHash !== command.expectedSourceHash ||
        calculation.calculationHash !== command.expectedCalculationHash
      )
        throw new FinancialExecutorError(
          "FINANCIAL_EXECUTOR_CONFIRMATION_STALE"
        );
      const commandHash = await hashCalculatorCanonical(command);
      const result = await withAuditLog(
        tx,
        {
          command,
          commandHash,
          binding: authority.binding,
          clientId: authority.clientId,
          calculation,
          policyContext: snapshot.policyContext,
        },
        () =>
          callCalculatorRoutine(tx, "create", command, {
            calculation,
            commandHash,
          })
      );
      return receiptResult(command, result.receipt, result.currentDraft);
    },
    request
  );
}
