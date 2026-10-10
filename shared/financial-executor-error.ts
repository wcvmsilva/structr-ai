import type { FinancialExecutorErrorCode } from "./domain/taxonomy";

/** Stable public codes only; SQL, connection data and bearer never become messages. */
export class FinancialExecutorError extends Error {
  constructor(public readonly code: FinancialExecutorErrorCode) {
    super(code);
    this.name = "FinancialExecutorError";
  }
}
