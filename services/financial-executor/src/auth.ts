/** ADR-003 strict JWT verification, independent from legacy web ENV/HS256/cookie paths. */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { FINANCIAL_EXECUTOR_AUTH_PROTOCOL as AUTH, FINANCIAL_EXECUTOR_ERROR_CODES, FINANCIAL_EXECUTOR_JWT_ALGORITHMS } from "../../../shared/domain/taxonomy";
import type { FinancialExecutorConfig } from "./config";

export interface ExecutorRequestHeaders {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** Node's original header pairs are required by the HTTP handler to detect joined duplicates. */
  readonly rawHeaders?: readonly string[];
}
declare const verifiedOperatorBrand: unique symbol;
/** Only this verifier can mint runtime provenance; structural casts cannot forge it. */
export interface VerifiedExecutorOperator { readonly [verifiedOperatorBrand]: true }
export interface VerifiedExecutorIdentity {
  readonly subject: string;
  readonly sessionId: string;
  readonly expiresAtMs: number;
}
export interface ExecutorAuthDependencies {
  /** Trusted initialization dependency only, never accepted from an HTTP request. */
  readonly keyResolver?: JWTVerifyGetKey;
  readonly nowMs?: () => number;
}
export interface ExecutorAuthenticator {
  authenticate(request: ExecutorRequestHeaders): Promise<VerifiedExecutorOperator>;
}
export class ExecutorAuthError extends Error {
  readonly code = FINANCIAL_EXECUTOR_ERROR_CODES[1];
  constructor() { super("Financial executor authentication rejected"); this.name = "ExecutorAuthError"; }
}
const verifiedOperators = new WeakMap<object, { identity: VerifiedExecutorIdentity; notBeforeMs: number | null }>();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function unauthorized(): never { throw new ExecutorAuthError(); }
function bearerFromRequest(request: ExecutorRequestHeaders): string {
  const entries = Object.entries(request.headers).filter(([name]) => name.toLowerCase() === "authorization");
  if (entries.length !== 1 || typeof entries[0][1] !== "string") unauthorized();
  const value = entries[0][1];
  if (value.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(value)) unauthorized();
  if (request.rawHeaders !== undefined) {
    if (request.rawHeaders.length % 2 !== 0) unauthorized();
    const originals: string[] = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index].toLowerCase() === "authorization") originals.push(request.rawHeaders[index + 1]);
    }
    if (originals.length !== 1 || originals[0] !== value) unauthorized();
  }
  return value.slice(7);
}

/** Recheck after each wait/retry and immediately before persistence/return. No bearer is retained. */
export function assertVerifiedExecutorOperator(operator: unknown, nowMs = Date.now()): VerifiedExecutorIdentity {
  const record = typeof operator === "object" && operator !== null ? verifiedOperators.get(operator) : undefined;
  if (!record || !Number.isFinite(nowMs) || nowMs >= record.identity.expiresAtMs || (record.notBeforeMs !== null && nowMs < record.notBeforeMs)) unauthorized();
  return record.identity;
}

export function createExecutorAuthenticator(config: FinancialExecutorConfig, dependencies: ExecutorAuthDependencies = {}): ExecutorAuthenticator {
  const clock = dependencies.nowMs ?? Date.now;
  const keyResolver = dependencies.keyResolver ?? createRemoteJWKSet(new URL(config.auth.jwksUrl), {
    timeoutDuration: 3000, cooldownDuration: 30000, cacheMaxAge: 600000,
  });
  return Object.freeze({
    async authenticate(request: ExecutorRequestHeaders): Promise<VerifiedExecutorOperator> {
      try {
        const token = bearerFromRequest(request);
        const now = clock();
        if (!Number.isFinite(now)) unauthorized();
        const { payload } = await jwtVerify(token, keyResolver, {
          issuer: config.auth.issuer, audience: AUTH.audience,
          algorithms: [...FINANCIAL_EXECUTOR_JWT_ALGORITHMS],
          requiredClaims: ["sub", "iss", "aud", "exp", "role", "session_id", "is_anonymous"],
          currentDate: new Date(now), clockTolerance: 0,
        });
        if (typeof payload.sub !== "string" || !uuid.test(payload.sub) || payload.sub !== config.auth.operatorSubject || typeof payload.session_id !== "string" || !uuid.test(payload.session_id) || payload.aud !== AUTH.audience || payload.role !== AUTH.role || payload.is_anonymous !== false || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.exp! * 1000)) unauthorized();
        const metadata = payload.app_metadata;
        if (metadata && typeof metadata === "object" && "provider" in metadata && metadata.provider === "anonymous") unauthorized();
        const notBeforeMs = payload.nbf === undefined ? null : payload.nbf * 1000;
        if (notBeforeMs !== null && !Number.isFinite(notBeforeMs)) unauthorized();
        const identity = Object.freeze({ subject: payload.sub, sessionId: payload.session_id, expiresAtMs: payload.exp! * 1000 });
        const operator = Object.freeze(Object.create(null)) as VerifiedExecutorOperator;
        verifiedOperators.set(operator, { identity, notBeforeMs });
        // Key acquisition can itself outlive the token. Never mint usable stale authority.
        assertVerifiedExecutorOperator(operator, clock());
        return operator;
      } catch {
        // Provider errors and raw claims can contain token details. Expose no cause or raw text.
        throw new ExecutorAuthError();
      }
    },
  });
}
