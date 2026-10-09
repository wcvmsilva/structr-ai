/** Candidate response grammar: no router/allowlist activation, calculation or writes. */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { IntakeForm } from "../drizzle/schema";
import { ADR002_PROTOCOL } from "../shared/domain/taxonomy";
import { serializeIntakeFormationPreimage } from "../shared/intake-formation-engine";
import { AuthenticatedDataApiError } from "./authenticated-data-api";
import {
  authenticatedIdentitySchema,
  authenticatedTimestampSchema,
} from "./authenticated-internal-approval-review";
import { assertPlainData } from "./project-geocode-review-evidence";

const uuid = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const envelopeSchema = z
  .object({
    version: z.literal(ADR002_PROTOCOL.intakeCreate),
    context: authenticatedIdentitySchema,
    intake: z
      .object({
        id: uuid,
        tenantId: uuid,
        leadId: uuid.nullable(),
        projectId: uuid.nullable(),
        status: z.string(),
        // assertPlainData validates every descriptor/value before this schema.
        // Keep the opaque current object intact; z.record filters __proto__.
        formData: z.custom<Record<string, unknown>>(
          value =>
            value !== null && typeof value === "object" && !Array.isArray(value)
        ),
        createdAt: authenticatedTimestampSchema,
        updatedAt: authenticatedTimestampSchema,
      })
      .strict(),
  })
  .strict();

export function decodeAuthenticatedIntakeCreate(
  raw: unknown,
  command: unknown,
  expectedIdentity: unknown
): IntakeForm {
  let preimage: string;
  try {
    preimage = serializeIntakeFormationPreimage(command, expectedIdentity);
  } catch {
    throw new AuthenticatedDataApiError("invalid_request");
  }
  try {
    assertPlainData(raw);
  } catch {
    throw new AuthenticatedDataApiError("unavailable");
  }
  const parsed = envelopeSchema.safeParse(raw);
  const sent = JSON.parse(preimage) as {
    requestId: string;
    tenantId: string;
    userId: string;
  };
  if (
    !parsed.success ||
    parsed.data.context.actorId !== sent.userId ||
    parsed.data.context.tenantId !== sent.tenantId ||
    parsed.data.intake.id !== sent.requestId.toLowerCase() ||
    parsed.data.intake.tenantId !== sent.tenantId ||
    parsed.data.intake.formData.creationFingerprint !==
      createHash("sha256").update(preimage, "utf8").digest("hex")
  ) {
    throw new AuthenticatedDataApiError("unavailable");
  }
  // A successful replay returns the current intake; status, linkage and other
  // formData may legitimately have evolved since the original creation.
  return parsed.data.intake;
}
