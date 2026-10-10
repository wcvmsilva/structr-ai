import type { IncomingMessage, ServerResponse } from "node:http";
import type { FinancialExecutorHandler, FinancialExecutorResponse } from "./handler";
import type { FinancialExecutorErrorCode } from "../../../shared/domain/taxonomy";

class RequestReadError extends Error {
  constructor(readonly status: number, readonly code: FinancialExecutorErrorCode = "FINANCIAL_EXECUTOR_INPUT_INVALID") { super("Executor request rejected"); }
}
function readBody(request: IncomingMessage, deadline: number, clock: () => number): Promise<string> {
  if ("body" in request || request.readableEnded || request.destroyed || request.readableEncoding !== null) throw new RequestReadError(400);
  const length = request.headers["content-length"];
  if (length !== undefined && (typeof length !== "string" || !/^(0|[1-9][0-9]*)$/.test(length))) throw new RequestReadError(400);
  const expectedLength = length === undefined ? null : Number(length);
  if (expectedLength !== null && (!Number.isSafeInteger(expectedLength) || expectedLength > 65536)) throw new RequestReadError(413);
  const remaining = deadline - clock();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new RequestReadError(503, "FINANCIAL_EXECUTOR_DEADLINE");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      request.off("data", data); request.off("end", end); request.off("aborted", aborted); request.off("error", errored);
    };
    const fail = (error: RequestReadError) => {
      if (settled) return;
      settled = true; cleanup();
      // IncomingMessage emits ECONNRESET after "aborted". Keep that transport failure contained.
      request.on("error", () => {});
      request.pause(); reject(error);
    };
    const data = (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) return fail(new RequestReadError(400));
      bytes += chunk.length;
      if (bytes > 65536) return fail(new RequestReadError(413));
      if (clock() >= deadline) return fail(new RequestReadError(503, "FINANCIAL_EXECUTOR_DEADLINE"));
      chunks.push(chunk);
    };
    const end = () => {
      if (!request.complete || (expectedLength !== null && expectedLength !== bytes)) return fail(new RequestReadError(400));
      if (clock() >= deadline) return fail(new RequestReadError(503, "FINANCIAL_EXECUTOR_DEADLINE"));
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)); } catch { return fail(new RequestReadError(400)); }
      settled = true; cleanup(); resolve(text);
    };
    const aborted = () => fail(new RequestReadError(400));
    const errored = () => fail(new RequestReadError(400));
    const timer = setTimeout(() => fail(new RequestReadError(503, "FINANCIAL_EXECUTOR_DEADLINE")), remaining);
    request.on("data", data); request.once("end", end); request.once("aborted", aborted); request.once("error", errored);
  });
}
function send(response: ServerResponse, result: FinancialExecutorResponse): void {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(result.body);
  response.statusCode = result.status;
  if (result.status >= 400) response.shouldKeepAlive = false;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}
/** Node launcher must disable request helpers so original raw headers and bytes remain available. */
export function createFinancialExecutorHttpAdapter(handler: FinancialExecutorHandler, options: { monotonicNowMs?: () => number } = {}) {
  const clock = options.monotonicNowMs ?? (() => performance.now());
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      // Receiving the body is part of the same budget used by JWT, retries and commit.
      const deadline = clock() + 30000;
      const body = request.method === "POST" ? await readBody(request, deadline, clock) : "";
      const result = await handler.handle({ method: request.method ?? "", headers: request.headers, rawHeaders: request.rawHeaders, body }, { deadline });
      send(response, result);
    } catch (error) {
      const status = error instanceof RequestReadError ? error.status : 500;
      const code = error instanceof RequestReadError ? error.code : "FINANCIAL_EXECUTOR_DATABASE_FAILURE";
      send(response, { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: { error: { code } } });
    }
  };
}
