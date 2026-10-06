import { EXECUTION_AUTHORITY_NOT_AVAILABLE } from "./domain/taxonomy";

/** Internal estimate approval does not supply execution authority (A1 integration §5). */
export type ExecutionAuthorityUnavailable = {
  state: "unavailable";
  reason: typeof EXECUTION_AUTHORITY_NOT_AVAILABLE;
};

export function executionAuthorityUnavailable(): ExecutionAuthorityUnavailable {
  return { state: "unavailable", reason: EXECUTION_AUTHORITY_NOT_AVAILABLE };
}

export class ExecutionAuthorityUnavailableError extends Error {
  readonly code = EXECUTION_AUTHORITY_NOT_AVAILABLE;
  constructor(readonly operation: string) {
    super("Execution authorization is not available. Existing records remain available for review.");
    this.name = "ExecutionAuthorityUnavailableError";
  }
}

export function holdExecutionOperation(operation: string): never {
  throw new ExecutionAuthorityUnavailableError(operation);
}
