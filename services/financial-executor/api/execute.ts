import type { IncomingMessage, ServerResponse } from "node:http";
import { createFinancialExecutorService } from "../src/index";

let service: ReturnType<typeof createFinancialExecutorService> | undefined;

/** Build Output's Node launcher disables helpers; the raw Node stream reaches our bounded reader. */
export default async function execute(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    service ??= createFinancialExecutorService(process.env);
    await service.handle(request, response);
  } catch {
    // Never log config values, driver errors, tokens or request bodies from startup failures.
    if (response.destroyed || response.writableEnded) return;
    const body = JSON.stringify({ error: { code: "EXECUTOR_CONFIG_INVALID" } });
    response.statusCode = 503;
    response.shouldKeepAlive = false;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-length", Buffer.byteLength(body));
    response.end(body);
  }
}
