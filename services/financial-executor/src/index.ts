/** Isolated service composition. No environment is read and no pool is created on import. */
import { executeFinancialCalculator } from "../../../server/financial-calculator-db";
import { loadFinancialExecutorConfig } from "./config";
import { createExecutorAuthenticator } from "./auth";
import { createExecutorTransactionRunner } from "./transaction";
import { createFinancialExecutorHandler } from "./handler";
import { createFinancialExecutorHttpAdapter } from "./http";

export function createFinancialExecutorService(environment: Readonly<Record<string, string | undefined>>) {
  const config = loadFinancialExecutorConfig(environment);
  const authenticator = createExecutorAuthenticator(config);
  const runner = createExecutorTransactionRunner(config);
  const handler = createFinancialExecutorHandler({
    authenticator,
    execute: (operator, command, request) => executeFinancialCalculator(runner, operator, command, request),
  });
  return Object.freeze({ handle: createFinancialExecutorHttpAdapter(handler), close: () => runner.close() });
}
