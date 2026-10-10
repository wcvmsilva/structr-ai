/** ADR-003 web transport. No SQL handle, privileged credential, fallback or write retry. */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { resolveAuthenticatedDataApiIdentity } from "./_core/trpc";
import { getFinancialCalculatorWebConfig, isAuthenticatedDataApiMode, isFinancialCalculatorEnabled } from "./_core/database-mode";
import { CALCULATOR_ERROR_CODES, CALCULATOR_OPERATIONS as OPS, FINANCIAL_EXECUTOR_ERROR_CODES } from "../shared/domain/taxonomy";
import { financialExecutorCommandSchema, financialExecutorPublicResultSchema, financialExecutorContextResultSchema, financialExecutorCalculateResultSchema, financialExecutorReceiptResultSchema, type FinancialExecutorCommand } from "../shared/financial-executor-contract";

type ResultFor<C extends FinancialExecutorCommand> = C["operation"] extends typeof OPS[0]
  ? z.infer<typeof financialExecutorContextResultSchema>
  : C["operation"] extends typeof OPS[1] ? z.infer<typeof financialExecutorCalculateResultSchema>
  : z.infer<typeof financialExecutorReceiptResultSchema>;
const unavailable = () => new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "FINANCIAL_EXECUTOR_DATABASE_FAILURE" });

/** Validate the selected variant before a permissive legacy schema can strip its fields. */
export function financialCalculatorRouteInput<C extends z.ZodType, L extends z.ZodType>(contextual: C, legacy: L, marker: "mode" | "contractVersion") {
  return z.custom<z.input<C> | z.input<L>>(raw => {
    const nominal = isAuthenticatedDataApiMode() || (raw !== null && typeof raw === "object" && Object.getOwnPropertyDescriptor(raw, marker) !== undefined);
    return (nominal ? contextual : legacy).safeParse(raw).success;
  }, "Calculator request is invalid").pipe(z.union([contextual, legacy]));
}

function authorization(ctx: TrpcContext): string {
  const entries = Object.entries(ctx.req.headers).filter(([key]) => key.toLowerCase() === "authorization");
  const value = entries[0]?.[1];
  const fail = (): never => { throw new TRPCError({ code: "UNAUTHORIZED", message: "EXECUTOR_UNAUTHORIZED" }); };
  if (entries.length !== 1 || typeof value !== "string" || value.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(value)) return fail();
  if (ctx.req.rawHeaders !== undefined) {
    if (ctx.req.rawHeaders.length % 2 !== 0) return fail();
    const values: string[] = [];
    for (let index = 0; index < ctx.req.rawHeaders.length; index += 2) if (ctx.req.rawHeaders[index].toLowerCase() === "authorization") values.push(ctx.req.rawHeaders[index + 1]);
    if (values.length !== 1 || values[0] !== value) return fail();
  }
  // Syntax only: the isolated executor verifies the JWT and current protected binding.
  return `Bearer ${value.slice(7)}`;
}

async function readResponse(response: Response): Promise<unknown> {
  const maximumBytes = 2_097_152;
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "") || Number(response.headers.get("content-length")) > maximumBytes) throw unavailable();
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw unavailable(); }
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { reader.releaseLock(); }
}

const errorSchema = z.object({ error: z.object({ code: z.enum([...FINANCIAL_EXECUTOR_ERROR_CODES, ...CALCULATOR_ERROR_CODES]) }).strict() }).strict();
function rejectResponse(status: number, data: unknown): never {
  const error = errorSchema.safeParse(data);
  if (!error.success) throw unavailable();
  const message = error.data.error.code;
  if (status === 401 && message === "EXECUTOR_UNAUTHORIZED") throw new TRPCError({ code: "UNAUTHORIZED", message });
  if (status === 403 && ["FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH", "CALCULATOR_IDENTITY_MISMATCH", "CALCULATOR_SOURCE_TENANT_MISMATCH"].includes(message)) throw new TRPCError({ code: "FORBIDDEN", message });
  if (status === 400 && ["FINANCIAL_EXECUTOR_INPUT_INVALID", "CALCULATOR_INPUT_INVALID"].includes(message)) throw new TRPCError({ code: "BAD_REQUEST", message });
  if (status === 409 && (["FINANCIAL_EXECUTOR_CONFIRMATION_STALE", "FINANCIAL_EXECUTOR_REQUEST_CONFLICT"].includes(message) || CALCULATOR_ERROR_CODES.some(code => code === message))) throw new TRPCError({ code: "CONFLICT", message });
  // Unavailable may follow a committed create; only nominal recovery can reconcile it.
  throw unavailable();
}

export async function callFinancialCalculator<C extends FinancialExecutorCommand>(ctx: TrpcContext, input: C): Promise<ResultFor<C>> {
  if (!isFinancialCalculatorEnabled()) throw new TRPCError({ code: "FORBIDDEN", message: "Calculator is unavailable" });
  if (!resolveAuthenticatedDataApiIdentity(ctx)) throw new TRPCError({ code: "FORBIDDEN", message: "Calculator identity is unavailable" });
  const parsed = financialExecutorCommandSchema.safeParse(input);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "FINANCIAL_EXECUTOR_INPUT_INVALID" });
  const command = parsed.data;
  const bearer = authorization(ctx);
  let origin: string;
  try { origin = getFinancialCalculatorWebConfig().origin; } catch { throw unavailable(); }
  let response: Response; let data: unknown;
  try {
    response = await fetch(`${origin}/api/execute`, {
      method: "POST", redirect: "error", cache: "no-store", credentials: "omit",
      headers: { authorization: bearer, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(command), signal: AbortSignal.timeout(30_000),
    });
    if (response.redirected || (response.status >= 300 && response.status < 400) || (response.url && response.url !== `${origin}/api/execute`)) throw unavailable();
    data = await readResponse(response);
  } catch { throw unavailable(); }
  if (response.status !== 200) rejectResponse(response.status, data);
  const result = financialExecutorPublicResultSchema.safeParse(data);
  if (!result.success) throw unavailable();
  const output = result.data;
  if (output.operation !== command.operation || output.projectId !== command.projectId || output.intakeFormId !== command.intakeFormId) throw unavailable();
  if ("requestId" in command && (!("requestId" in output) || output.requestId !== command.requestId)) throw unavailable();
  if (command.operation === OPS[2] && (!("creation" in output) || output.creation?.sourceHash !== command.expectedSourceHash || output.creation.calculationHash !== command.expectedCalculationHash)) throw unavailable();
  if (command.operation === OPS[1] && (!("selections" in output) || output.selections.length !== command.assemblies.length || output.selections.some((selection, index) => selection.assemblyId !== command.assemblies[index].assemblyId || selection.quantity !== command.assemblies[index].quantity))) throw unavailable();
  return output as ResultFor<C>;
}
