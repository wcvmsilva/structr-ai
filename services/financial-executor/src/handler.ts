import type { ExecutorAuthenticator, ExecutorRequestHeaders, VerifiedExecutorOperator } from "./auth";
import { CalculatorError } from "../../../shared/financial-calculator-engine";
import { financialExecutorCommandSchema, financialExecutorPublicResultSchema, type FinancialExecutorCommand, type FinancialExecutorPublicResult } from "../../../shared/financial-executor-contract";
import { CALCULATOR_ERROR_CODES, FINANCIAL_EXECUTOR_ERROR_CODES } from "../../../shared/domain/taxonomy";
export type { FinancialExecutorCommand, FinancialExecutorPublicResult } from "../../../shared/financial-executor-contract";

export interface FinancialExecutorRequest extends ExecutorRequestHeaders { readonly method: string; readonly body: unknown }
export interface FinancialExecutorResponse { readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: FinancialExecutorPublicResult | { error: { code: string } } }
export interface FinancialExecutorHandler { handle(request: FinancialExecutorRequest, options?: { readonly deadline: number }): Promise<FinancialExecutorResponse> }
export interface FinancialExecutorHandlerDependencies {
  readonly authenticator: ExecutorAuthenticator;
  /** Trusted composition passes only the transaction runner's committed public projection. */
  readonly execute: (operator: VerifiedExecutorOperator, command: FinancialExecutorCommand, options: { readonly deadline: number }) => Promise<FinancialExecutorPublicResult>;
  /** Trusted clock injection; the production clock is monotonic performance.now(). */
  readonly monotonicNowMs?: () => number;
}
const responseHeaders = Object.freeze({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
const invalidCode = "FINANCIAL_EXECUTOR_INPUT_INVALID" satisfies (typeof FINANCIAL_EXECUTOR_ERROR_CODES)[number];
function failure(status: number, code: string): FinancialExecutorResponse { return { status, headers: responseHeaders, body: { error: { code } } }; }
function hasSingleJsonContentType(request: ExecutorRequestHeaders): boolean {
  const headers = Object.entries(request.headers).filter(([key]) => key.toLowerCase() === "content-type");
  if (headers.length !== 1 || typeof headers[0][1] !== "string" || /[\r\n]/.test(headers[0][1]) || !/^application\/json(?:[\t ]*;[\t ]*charset=utf-8)?$/i.test(headers[0][1])) return false;
  if (request.rawHeaders !== undefined) {
    if (request.rawHeaders.length % 2 !== 0) return false;
    const values: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index].toLowerCase() === "content-type") values.push(request.rawHeaders[index + 1]);
    if (values.length !== 1 || values[0] !== headers[0][1]) return false;
  }
  return true;
}
/** JSON.parse checks syntax once; this lexical pass rejects ambiguous duplicate member names. */
function hasDuplicateJsonKeys(source: string): boolean {
  const objectKeys: Array<Set<string> | null> = [];
  const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) ?? [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "{") objectKeys.push(new Set());
    else if (token === "[") objectKeys.push(null);
    else if (token === "}" || token === "]") objectKeys.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const keys = objectKeys.at(-1);
      // Unescape only the member name; the command object itself is never parsed twice.
      const name = JSON.parse(token) as string;
      if (keys?.has(name)) return true;
      keys?.add(name);
    }
  }
  return false;
}
function errorResponse(error: unknown): FinancialExecutorResponse {
  const descriptor = typeof error === "object" && error !== null ? Object.getOwnPropertyDescriptor(error, "code") : undefined;
  const code = descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : "";
  if (code === "EXECUTOR_UNAUTHORIZED") return failure(401, code);
  if (code === "FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH") return failure(403, code);
  if (code === "FINANCIAL_EXECUTOR_CONFIRMATION_STALE" || code === "FINANCIAL_EXECUTOR_REQUEST_CONFLICT") return failure(409, code);
  if (code === "FINANCIAL_EXECUTOR_DEADLINE" || code === "FINANCIAL_EXECUTOR_CAPACITY") return failure(503, code);
  if (code === invalidCode) return failure(400, code);
  if (error instanceof CalculatorError && CALCULATOR_ERROR_CODES.some(known => known === code)) {
    if (code === "CALCULATOR_INPUT_INVALID") return failure(400, code);
    if (code === "CALCULATOR_IDENTITY_MISMATCH" || code === "CALCULATOR_SOURCE_TENANT_MISMATCH") return failure(403, code);
    if (code === "CALCULATOR_CRYPTO_UNAVAILABLE") return failure(500, code);
    return failure(409, code);
  }
  if (FINANCIAL_EXECUTOR_ERROR_CODES.some(known => known === code)) return failure(500, code);
  return failure(500, "FINANCIAL_EXECUTOR_DATABASE_FAILURE");
}

export function createFinancialExecutorHandler(dependencies: FinancialExecutorHandlerDependencies): FinancialExecutorHandler {
  const monotonicNow = dependencies.monotonicNowMs ?? (() => performance.now());
  return Object.freeze({ async handle(request: FinancialExecutorRequest, options?: { readonly deadline: number }): Promise<FinancialExecutorResponse> {
    try {
      if (request.method !== "POST") return failure(405, invalidCode);
      if (!hasSingleJsonContentType(request)) return failure(415, invalidCode);
      if (typeof request.body !== "string") return failure(400, invalidCode);
      if (Buffer.byteLength(request.body, "utf8") > 65536) return failure(413, invalidCode);
      const startedAt = monotonicNow();
      const deadline = options?.deadline ?? startedAt + 30000;
      const withinDeadline = () => { const now = monotonicNow(); return Number.isFinite(now) && now >= startedAt && now < deadline; };
      if (!Number.isFinite(startedAt) || !Number.isFinite(deadline) || deadline <= startedAt || deadline > startedAt + 30000) return failure(503, "FINANCIAL_EXECUTOR_DEADLINE");
      const operator = await dependencies.authenticator.authenticate(request);
      if (!withinDeadline()) return failure(503, "FINANCIAL_EXECUTOR_DEADLINE");
      let raw: unknown;
      try { raw = JSON.parse(request.body); if (hasDuplicateJsonKeys(request.body)) return failure(400, invalidCode); } catch { return failure(400, invalidCode); }
      const parsed = financialExecutorCommandSchema.safeParse(raw);
      if (!parsed.success) return failure(400, invalidCode);
      const command = parsed.data;
      if (!withinDeadline()) return failure(503, "FINANCIAL_EXECUTOR_DEADLINE");
      // The execute promise resolves only after the enclosing Drizzle transaction has committed.
      const executed = await dependencies.execute(operator, command, { deadline });
      // A late result can have committed. This response does not assert rollback or resubmit.
      if (!withinDeadline()) return failure(503, "FINANCIAL_EXECUTOR_DEADLINE");
      const output = financialExecutorPublicResultSchema.safeParse(executed);
      if (!output.success || output.data.operation !== command.operation || output.data.projectId !== command.projectId || output.data.intakeFormId !== command.intakeFormId || ("requestId" in command && (!('requestId' in output.data) || output.data.requestId !== command.requestId))) return failure(500, "FINANCIAL_EXECUTOR_RECEIPT_INVALID");
      if (!withinDeadline()) return failure(503, "FINANCIAL_EXECUTOR_DEADLINE");
      return { status: 200, headers: responseHeaders, body: output.data };
    } catch (error) { return errorResponse(error); }
  } });
}
