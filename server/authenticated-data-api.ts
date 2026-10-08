import type { Request } from "express";
import { z } from "zod";
import type { Profile } from "../drizzle/schema";
import { ADR002_PROTOCOL, ADR002_RPC_ERROR_CODES, INTERNAL_APPROVAL_PROTOCOL } from "../shared/domain/taxonomy";
import { getAuthenticatedDataApiConfig } from "./_core/database-mode";

type ErrorKind = "unauthorized" | "forbidden" | "not_found" | "invalid_request" | "conflict" | "unavailable";
type ApplicationCode = (typeof ADR002_RPC_ERROR_CODES)[number];

/** Content-free failure: neither tokens, provider bodies nor driver details leave this boundary. */
export class AuthenticatedDataApiError extends Error {
  constructor(readonly kind: ErrorKind, readonly sqlState?: string, readonly applicationCode?: ApplicationCode) {
    super(`Authenticated data API request failed (${kind})`);
    this.name = "AuthenticatedDataApiError";
  }
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== "00000000-0000-0000-0000-000000000000");
const date = z.iso.datetime().refine(value => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}).transform(value => new Date(value));
const profileSchema = z.object({
  id: uuid, tenantId: uuid, externalOpenId: uuid,
  email: z.string().nullable(), loginMethod: z.string().nullable(), fullName: z.string().nullable(),
  companyName: z.string().nullable(), role: z.string().nullable(), isActive: z.literal(true),
  lastSignedIn: date.nullable(), createdAt: date, updatedAt: date,
}).strict();
const sessionSchema = z.object({
  version: z.literal(ADR002_PROTOCOL.session), profile: profileSchema, tenantId: uuid,
  permissions: z.object({
    slugs: z.array(z.string().min(1)).refine(values => new Set(values).size === values.length),
    isPlatformAdmin: z.boolean(),
  }).strict(),
}).strict().refine(session => session.profile.tenantId === session.tenantId &&
  session.permissions.isPlatformAdmin === (session.profile.role === "admin"));

export type AuthenticatedDataApiSession = z.infer<typeof sessionSchema> & { profile: Profile };
const reviewCommandSchema = z.object({ id: uuid, confirmedCurrencyCode: z.literal(INTERNAL_APPROVAL_PROTOCOL.currency) }).strict();
type ReviewCommand = z.infer<typeof reviewCommandSchema>;
const readCommandSchema = z.object({ id: uuid }).strict();
type ReadCommand = z.infer<typeof readCommandSchema>;
const estimateReadCommandSchema = z.object({id: z.string().uuid().transform(value => value.toLowerCase())}).strict();

function bearer(req: Pick<Request, "headers">): string {
  const value = req.headers.authorization;
  // Syntax only. The trusted Data API verifies signature/issuer/audience; the RPC
  // revalidates claims and current organizational authority inside its transaction.
  // This syntax check alone makes no claim about signature or Auth-session liveness.
  if (typeof value !== "string" || value.length > 16_384 ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(value)) {
    throw new AuthenticatedDataApiError("unauthorized");
  }
  return `Bearer ${value.slice(7)}`;
}

const allowedCodes = new Set<string>(ADR002_RPC_ERROR_CODES);
const byteLimit = 16_777_216;
async function readJson(response: Response): Promise<unknown> {
  // Bound both declared and actual response size, including chunked responses.
  if (Number(response.headers.get("content-length")) > byteLimit) throw new AuthenticatedDataApiError("unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new AuthenticatedDataApiError("unavailable");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > byteLimit) { await reader.cancel(); throw new AuthenticatedDataApiError("unavailable"); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}

function responseError(status: number, data: unknown): AuthenticatedDataApiError {
  const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const sqlState = typeof body.code === "string" && /^[0-9A-Z]{5}$/.test(body.code) ? body.code : undefined;
  const applicationCode = (sqlState === "P0001" || sqlState === "P0002") && typeof body.message === "string" && allowedCodes.has(body.message)
    ? body.message as ApplicationCode : undefined;
  const kind: ErrorKind = sqlState === "40001" || sqlState === "40P01" ? "conflict"
    : status === 401 ? "unauthorized"
    : status === 403 || sqlState === "42501" || applicationCode === "FORBIDDEN" ? "forbidden"
    : applicationCode === "NOT_FOUND" ? "not_found"
    : status === 400 ? "invalid_request" : "unavailable";
  return new AuthenticatedDataApiError(kind, sqlState, applicationCode);
}

/** Private fixed-function dispatcher; callers cannot supply a path, schema, table or SQL. */
async function request(req: Pick<Request, "headers">, operation: "session" | "review" | "estimateRead" | "approvalRecord", body: unknown): Promise<unknown> {
  const authorization = bearer(req);
  const config = getAuthenticatedDataApiConfig();
  const path = {
    session: "structr_authenticated_session_v1",
    review: "structr_internal_approval_review_v1",
    estimateRead: "structr_estimate_draft_read_v1",
    approvalRecord: "structr_internal_approval_record_v1",
  }[operation];
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    let data: unknown;
    try {
      response = await fetch(`${config.origin}/rest/v1/rpc/${path}`, {
        method: "POST", headers: {
          authorization, apikey: config.publishableKey, "content-type": "application/json", accept: "application/json",
          "content-profile": "public", "accept-profile": "public",
        },
        body: JSON.stringify(body), redirect: "error", cache: "no-store", credentials: "omit",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new AuthenticatedDataApiError("unavailable");
      data = await readJson(response);
    } catch {
      // No arbitrary network/body failure is retried, and there is no SQL fallback.
      throw new AuthenticatedDataApiError("unavailable");
    }
    if (response.ok) return data;
    const error = responseError(response.status, data);
    if (error.kind === "conflict" && attempt < 2) continue;
    throw error;
  }
  throw new AuthenticatedDataApiError("unavailable");
}

export async function getAuthenticatedDataApiSession(req: Pick<Request, "headers">): Promise<AuthenticatedDataApiSession> {
  const parsed = sessionSchema.safeParse(await request(req, "session", {}));
  if (!parsed.success) throw new AuthenticatedDataApiError("unauthorized");
  return parsed.data;
}

export async function callAuthenticatedReview(req: Pick<Request, "headers">, command: ReviewCommand): Promise<unknown> {
  const parsed = reviewCommandSchema.safeParse(command);
  if (!parsed.success) throw new AuthenticatedDataApiError("invalid_request");
  return request(req, "review", { command: parsed.data });
}

export async function callAuthenticatedEstimateDraftRead(req: Pick<Request, "headers">, command: ReadCommand): Promise<unknown> {
  const parsed = estimateReadCommandSchema.safeParse(command);
  if (!parsed.success) throw new AuthenticatedDataApiError("invalid_request");
  return request(req, "estimateRead", {command: parsed.data});
}

export async function callAuthenticatedInternalApprovalRecord(req: Pick<Request, "headers">, command: ReadCommand): Promise<unknown> {
  const parsed = readCommandSchema.safeParse(command);
  if (!parsed.success) throw new AuthenticatedDataApiError("invalid_request");
  return request(req, "approvalRecord", {command: parsed.data});
}
