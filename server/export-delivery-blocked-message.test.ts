import { describe, expect, it } from "vitest";
import { formatExportDeliveryBlockedMessage, parseExportDeliveryBlockedMessage } from "@shared/export-delivery-blocked-message";

const EXPORT_ID = "c1000000-0000-4000-8000-000000000001";

describe("export-delivery-blocked-message", () => {
  it("round-trips a real ExportIssueCode and exportId", () => {
    const message = formatExportDeliveryBlockedMessage({ exportId: EXPORT_ID, code: "INTERNAL_APPROVAL_REVOKED" });
    expect(parseExportDeliveryBlockedMessage(message)).toEqual({ exportId: EXPORT_ID, code: "INTERNAL_APPROVAL_REVOKED" });
  });

  it.each([
    "not even close",
    "EXPORT_DELIVERY_BLOCKED|INTERNAL_APPROVAL_REVOKED", // missing exportId segment
    "EXPORT_DELIVERY_BLOCKED|NOT_A_REAL_CODE|c1000000-0000-4000-8000-000000000001", // unknown code
    "EXPORT_DELIVERY_BLOCKED|INTERNAL_APPROVAL_REVOKED|not-a-uuid",
    "WRONG_PREFIX|INTERNAL_APPROVAL_REVOKED|c1000000-0000-4000-8000-000000000001",
    "EXPORT_DELIVERY_BLOCKED|INTERNAL_APPROVAL_REVOKED|c1000000-0000-4000-8000-000000000001|extra",
  ])("returns null for a malformed message, never throws: %s", (message) => {
    expect(parseExportDeliveryBlockedMessage(message)).toBeNull();
  });

  it("never collides with a plain human-readable error message", () => {
    expect(parseExportDeliveryBlockedMessage("This export could not be completed. Please try again.")).toBeNull();
  });
});
