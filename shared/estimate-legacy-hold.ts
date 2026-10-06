import { LEGACY_ESTIMATE_OPERATION_ERROR_CODES, type LegacyEstimateOperation } from "./domain/taxonomy";

export const LEGACY_ESTIMATE_HOLD_MESSAGE = "Approval and exports are temporarily unavailable. You can still review this estimate.";

/** A negative compatibility boundary, never a governed approval/export attempt. */
export class LegacyEstimateOperationError extends Error {
  readonly code = LEGACY_ESTIMATE_OPERATION_ERROR_CODES[0];
  constructor(readonly operation: LegacyEstimateOperation) {
    super(LEGACY_ESTIMATE_HOLD_MESSAGE);
    this.name = "LegacyEstimateOperationError";
  }
}

export function holdLegacyEstimateOperation(operation: LegacyEstimateOperation): never {
  throw new LegacyEstimateOperationError(operation);
}
