/**
 * A1 export surface integration — transport encoding for the one typed error
 * a blocked `createAndDeliverExportAttempt` call surfaces after commit
 * (`ExportDeliveryBlockedError{exportId,code}`, server/internal-estimate-
 * export-db.ts). tRPC's default error formatter drops `TRPCError.cause` on
 * the wire — only `code`/`message`/`data.code` reach the client — so the
 * router cannot hand the client `{exportId,code}` via `cause` and call it
 * delivered; the contract explicitly requires proving this crosses REAL
 * serialization, not merely an in-memory `.cause` read. Encoding the pair
 * into the message itself, with one shared encode/decode pair the server
 * mapper and the client consumer both import, is the minimal fix: no new
 * error-formatter plumbing, no second format invented on either side.
 */
import { z } from "zod";
import { EXPORT_ISSUE_CODES, type ExportIssueCode } from "./domain/taxonomy";

const PREFIX = "EXPORT_DELIVERY_BLOCKED";

export function formatExportDeliveryBlockedMessage(value: { exportId: string; code: ExportIssueCode }): string {
  return `${PREFIX}|${value.code}|${value.exportId}`;
}

const payloadSchema = z.object({ exportId: z.string().uuid(), code: z.enum(EXPORT_ISSUE_CODES) }).strict();
export type ExportDeliveryBlockedMessage = z.infer<typeof payloadSchema>;

/** Returns null for anything that isn't a well-formed encoded message — never throws. */
export function parseExportDeliveryBlockedMessage(message: string): ExportDeliveryBlockedMessage | null {
  const parts = message.split("|");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const result = payloadSchema.safeParse({ code: parts[1], exportId: parts[2] });
  return result.success ? result.data : null;
}
