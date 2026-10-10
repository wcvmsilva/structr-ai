import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { inspect } from "node:util";
import { loadFinancialExecutorConfig } from "../services/financial-executor/src/config";
import { assertVerifiedExecutorOperator, createExecutorAuthenticator, type ExecutorRequestHeaders } from "../services/financial-executor/src/auth";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const ISSUER = "https://executor-auth.example.invalid/auth/v1";
const NOW = Date.parse("2026-10-10T12:00:00Z");
function environment(extra: Record<string, string | undefined> = {}) {
  return {
    FINANCIAL_EXECUTOR_ENVIRONMENT: "homologation",
    FINANCIAL_EXECUTOR_DATABASE_URL: "postgresql://structr_calculator_login_v1:discardable-test-password@db.example.invalid:5432/financial_homolog",
    FINANCIAL_EXECUTOR_EXPECTED_DB_HOST: "db.example.invalid",
    FINANCIAL_EXECUTOR_EXPECTED_DB_NAME: "financial_homolog",
    FINANCIAL_EXECUTOR_EXPECTED_DB_PRINCIPAL: "structr_calculator_login_v1",
    FINANCIAL_EXECUTOR_SUPABASE_URL: "https://executor-auth.example.invalid",
    FINANCIAL_EXECUTOR_OPERATOR_SUB: SUBJECT,
    FINANCIAL_EXECUTOR_ACTOR_ID: ACTOR,
    FINANCIAL_EXECUTOR_TENANT_ID: TENANT,
    ...extra,
  };
}

describe("isolated financial executor configuration", () => {
  it("produces a dedicated TLS connection with bounded pool and operation deadlines", () => {
    const config = loadFinancialExecutorConfig(environment());
    expect(config).toMatchObject({
      environment: "homologation",
      auth: { issuer: ISSUER, jwksUrl: `${ISSUER}/.well-known/jwks.json`, audience: "authenticated", algorithms: ["ES256"], operatorSubject: SUBJECT, actorId: ACTOR, tenantId: TENANT },
      database: { host: "db.example.invalid", port: 5432, database: "financial_homolog", username: "structr_calculator_login_v1", ssl: { rejectUnauthorized: true, servername: "db.example.invalid" }, max: 2, connect_timeout: 5, idle_timeout: 10, max_lifetime: 300, prepare: false },
      timeouts: { totalMs: 30000, lockMs: 3000, statementMs: 10000 },
    });
  });

  it.each(Object.keys(environment()))("requires the dedicated %s setting", key => {
    expect(() => loadFinancialExecutorConfig(environment({ [key]: undefined }))).toThrowError(expect.objectContaining({ code: "EXECUTOR_CONFIG_INVALID" }));
  });

  it.each([
    "DATABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_JWT_SECRET", "JWT_SECRET", "AUTH_PROVIDER", "APP_DATABASE_MODE", "PGPASSWORD", "PGHOST", "PGUSER", "PGDATABASE", "PGSSLMODE", "NODE_TLS_REJECT_UNAUTHORIZED", "FINANCIAL_EXECUTOR_JWT_SECRET", "FINANCIAL_EXECUTOR_SERVICE_ROLE_KEY",
  ])("refuses inherited or unsupported %s configuration instead of using fallback authority", key => {
    expect(() => loadFinancialExecutorConfig(environment({ [key]: "unsafe-inherited-setting" }))).toThrowError(expect.objectContaining({ code: "EXECUTOR_CONFIG_INVALID" }));
  });

  it.each([
    ["admin principal", "postgresql://postgres:password@db.example.invalid/financial_homolog"],
    ["wrong principal", "postgresql://structr_other_login:password@db.example.invalid/financial_homolog"],
    ["foreign host", "postgresql://structr_calculator_login_v1:password@elsewhere.example.invalid/financial_homolog"],
    ["foreign database", "postgresql://structr_calculator_login_v1:password@db.example.invalid/production"],
    ["TLS override", "postgresql://structr_calculator_login_v1:password@db.example.invalid/financial_homolog?sslmode=disable"],
    ["startup options", "postgresql://structr_calculator_login_v1:password@db.example.invalid/financial_homolog?options=-c%20role%3Dpostgres"],
    ["alternate host option", "postgresql://structr_calculator_login_v1:password@db.example.invalid/financial_homolog?host=elsewhere.example.invalid"],
    ["fragment", "postgresql://structr_calculator_login_v1:password@db.example.invalid/financial_homolog#ignored"],
    ["HTTP URL", "https://structr_calculator_login_v1:password@db.example.invalid/financial_homolog"],
    ["absent password", "postgresql://structr_calculator_login_v1@db.example.invalid/financial_homolog"],
    ["database path injection", "postgresql://structr_calculator_login_v1:password@db.example.invalid/financial_homolog/other"],
    ["invalid port", "postgresql://structr_calculator_login_v1:password@db.example.invalid:0/financial_homolog"],
  ])("rejects %s in the executor database destination", (_name, url) => {
    expect(() => loadFinancialExecutorConfig(environment({ FINANCIAL_EXECUTOR_DATABASE_URL: url }))).toThrowError(expect.objectContaining({ code: "EXECUTOR_CONFIG_INVALID" }));
  });

  it.each([
    { FINANCIAL_EXECUTOR_EXPECTED_DB_PRINCIPAL: "postgres", FINANCIAL_EXECUTOR_DATABASE_URL: "postgresql://postgres:password@db.example.invalid/financial_homolog" },
    { FINANCIAL_EXECUTOR_ENVIRONMENT: "production", VERCEL_ENV: "preview" },
    { FINANCIAL_EXECUTOR_ENVIRONMENT: "homologation", VERCEL_ENV: "production" },
    { FINANCIAL_EXECUTOR_ENVIRONMENT: "local", VERCEL_ENV: "preview" },
    { FINANCIAL_EXECUTOR_ENVIRONMENT: "unknown" },
    { FINANCIAL_EXECUTOR_SUPABASE_URL: "http://executor-auth.example.invalid" },
    { FINANCIAL_EXECUTOR_SUPABASE_URL: "https://user:password@executor-auth.example.invalid" },
    { FINANCIAL_EXECUTOR_SUPABASE_URL: "https://executor-auth.example.invalid/foreign" },
    { FINANCIAL_EXECUTOR_SUPABASE_URL: "https://executor-auth.example.invalid?project=foreign" },
    { FINANCIAL_EXECUTOR_OPERATOR_SUB: "operator" },
    { FINANCIAL_EXECUTOR_ACTOR_ID: "actor" },
    { FINANCIAL_EXECUTOR_TENANT_ID: "tenant" },
  ])("rejects an invalid or mixed environment %#", overrides => {
    expect(() => loadFinancialExecutorConfig(environment(overrides))).toThrowError(expect.objectContaining({ code: "EXECUTOR_CONFIG_INVALID" }));
  });

  it("keeps SQL password out of serialized and inspected configuration", () => {
    const config = loadFinancialExecutorConfig(environment());
    expect(config).toBeDefined();
    expect(JSON.stringify(config)).not.toContain("discardable-test-password");
    expect(inspect(config, { depth: 10 })).not.toContain("discardable-test-password");
    expect(config.database.password).toBe("discardable-test-password");
  });

  it("does not echo rejected credentials in configuration failures", () => {
    let failure: unknown;
    try { loadFinancialExecutorConfig(environment({ FINANCIAL_EXECUTOR_DATABASE_URL: "postgresql://postgres:never-print-this@db.example.invalid/wrong" })); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "EXECUTOR_CONFIG_INVALID" });
    expect(inspect(failure)).not.toContain("never-print-this");
  });

  it("freezes validated settings against a later TLS or operator downgrade", () => {
    const config = loadFinancialExecutorConfig(environment());
    expect(config).toBeDefined();
    expect(() => { (config.auth as { operatorSubject: string }).operatorSubject = ACTOR; }).toThrow();
    expect(() => { (config.database.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized = false; }).toThrow();
  });
});

let signingKey: CryptoKey;
let otherSigningKey: CryptoKey;
let rsaSigningKey: CryptoKey;
let keyResolver: JWTVerifyGetKey;
beforeAll(async () => {
  const key = await generateKeyPair("ES256");
  signingKey = key.privateKey;
  otherSigningKey = (await generateKeyPair("ES256")).privateKey;
  const rsa = await generateKeyPair("RS256");
  rsaSigningKey = rsa.privateKey;
  keyResolver = createLocalJWKSet({ keys: [
    { ...await exportJWK(key.publicKey), kid: "executor-es256", alg: "ES256", use: "sig" },
    { ...await exportJWK(rsa.publicKey), kid: "executor-rs256", alg: "RS256", use: "sig" },
  ] });
});
async function signedToken(overrides: JWTPayload = {}, options: { omit?: string[]; key?: CryptoKey | Uint8Array; alg?: string; kid?: string } = {}) {
  const payload: JWTPayload = { sub: SUBJECT, iss: ISSUER, aud: "authenticated", exp: NOW / 1000 + 60, nbf: NOW / 1000 - 1, iat: NOW / 1000 - 1, role: "authenticated", session_id: SESSION, is_anonymous: false, ...overrides };
  for (const claim of options.omit ?? []) delete payload[claim];
  return new SignJWT(payload).setProtectedHeader({ alg: options.alg ?? "ES256", kid: options.kid ?? "executor-es256", typ: "JWT" }).sign(options.key ?? signingKey);
}
function authenticator(nowMs = () => NOW, resolver: JWTVerifyGetKey = keyResolver) {
  return createExecutorAuthenticator(loadFinancialExecutorConfig(environment()), { keyResolver: resolver, nowMs });
}
function bearer(token: string): ExecutorRequestHeaders { return { headers: { authorization: `Bearer ${token}` }, rawHeaders: ["Authorization", `Bearer ${token}`] }; }

describe("executor JWT authentication with real signed tokens", () => {
  it("verifies the exact human operator and exposes only token-free identity", async () => {
    const token = await signedToken();
    const operator = await authenticator().authenticate(bearer(token));
    expect(assertVerifiedExecutorOperator(operator, NOW)).toEqual({ subject: SUBJECT, sessionId: SESSION, expiresAtMs: NOW + 60000 });
    expect(JSON.stringify(operator)).toBe("{}");
    expect(inspect(operator)).not.toContain(token);
  });

  it.each([
    ["foreign issuer", { iss: "https://foreign.example.invalid/auth/v1" }],
    ["foreign audience", { aud: "service_role" }],
    ["mixed audience", { aud: ["authenticated", "service_role"] }],
    ["expired token", { exp: NOW / 1000 - 1 }],
    ["expiry boundary", { exp: NOW / 1000 }],
    ["future not-before", { nbf: NOW / 1000 + 1 }],
    ["non-UUID subject", { sub: "operator" }],
    ["other real operator", { sub: ACTOR }],
    ["non-UUID session", { session_id: "session" }],
    ["service-role credential", { role: "service_role" }],
    ["anonymous role", { role: "anon" }],
    ["anonymous authenticated user", { is_anonymous: true }],
    ["malformed anonymous claim", { is_anonymous: "false" }],
    ["anonymous provider", { app_metadata: { provider: "anonymous" } }],
    ["non-numeric expiry", { exp: "future" } as unknown as JWTPayload],
  ])("refuses %s", async (_name, claims) => {
    await expect(authenticator().authenticate(bearer(await signedToken(claims)))).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
  });

  it.each(["sub", "iss", "aud", "exp", "role", "session_id", "is_anonymous"])("requires signed %s", async claim => {
    await expect(authenticator().authenticate(bearer(await signedToken({}, { omit: [claim] })))).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
  });

  it("refuses a token signed by an untrusted asymmetric key", async () => {
    await expect(authenticator().authenticate(bearer(await signedToken({}, { key: otherSigningKey })))).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
  });
  it("refuses unapproved RS256 even when the trusted JWKS publishes its key", async () => {
    await expect(authenticator().authenticate(bearer(await signedToken({}, { key: rsaSigningKey, alg: "RS256", kid: "executor-rs256" })))).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
  });
  it("refuses HS256 even when a resolver could supply a valid symmetric key", async () => {
    const key = new TextEncoder().encode("only-a-disposable-local-test-key-no-credential");
    await expect(authenticator(() => NOW, async () => key).authenticate(bearer(await signedToken({}, { key, alg: "HS256" })))).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
  });
  it("refuses unknown key identifiers", async () => {
    await expect(authenticator().authenticate(bearer(await signedToken({}, { kid: "unknown-key" })))).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
  });

  it.each([
    ["no authorization", (token: string) => ({ headers: {} })],
    ["cookie-only session", (token: string) => ({ headers: { cookie: `session=${token}` } })],
    ["service API key", (token: string) => ({ headers: { apikey: token } })],
    ["array header", (token: string) => ({ headers: { authorization: [`Bearer ${token}`] } })],
    ["comma-combined headers", (token: string) => ({ headers: { authorization: `Bearer ${token}, Bearer ${token}` } })],
    ["duplicate normalized keys", (token: string) => ({ headers: { authorization: `Bearer ${token}`, Authorization: `Bearer ${token}` } })],
    ["duplicate raw headers", (token: string) => ({ ...bearer(token), rawHeaders: ["Authorization", `Bearer ${token}`, "authorization", `Bearer ${token}`] })],
    ["raw and parsed mismatch", (token: string) => ({ ...bearer(token), rawHeaders: ["Authorization", "Bearer different"] })],
    ["Basic scheme", (token: string) => ({ headers: { authorization: `Basic ${token}` } })],
    ["whitespace separated tokens", (token: string) => ({ headers: { authorization: `Bearer ${token} ${token}` } })],
    ["line break", (token: string) => ({ headers: { authorization: `Bearer ${token}\n` } })],
  ] as const)("refuses %s without cookie or key fallback", async (_name, request) => {
    await expect(authenticator().authenticate(request(await signedToken()))).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
  });

  it("discards untrusted metadata rather than treating it as actor or tenant authority", async () => {
    const token = await signedToken({ tenant_id: ACTOR, user_metadata: { actorId: SUBJECT, tenantId: ACTOR, role: "admin" } });
    const operator = await authenticator().authenticate(bearer(token));
    expect(assertVerifiedExecutorOperator(operator, NOW)).toEqual({ subject: SUBJECT, sessionId: SESSION, expiresAtMs: NOW + 60000 });
  });
  it("rechecks expiry after a slow signature-key acquisition", async () => {
    let now = NOW;
    const delayedResolver: JWTVerifyGetKey = async (...args) => { const key = await keyResolver(...args); now += 61000; return key; };
    await expect(authenticator(() => now, delayedResolver).authenticate(bearer(await signedToken()))).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
  });
  it("revalidates expiry at each later transaction boundary", async () => {
    const operator = await authenticator().authenticate(bearer(await signedToken()));
    expect(assertVerifiedExecutorOperator(operator, NOW + 59999)).toMatchObject({ subject: SUBJECT });
    expect(() => assertVerifiedExecutorOperator(operator, NOW + 60000)).toThrowError(expect.objectContaining({ code: "EXECUTOR_UNAUTHORIZED" }));
  });
  it("rejects a structurally correct but never verified identity", () => {
    expect(() => assertVerifiedExecutorOperator({ subject: SUBJECT, sessionId: SESSION, expiresAtMs: NOW + 60000 }, NOW)).toThrowError(expect.objectContaining({ code: "EXECUTOR_UNAUTHORIZED" }));
  });
  it("rejects copied and serialized identities that lost verifier provenance", async () => {
    const operator = await authenticator().authenticate(bearer(await signedToken()));
    expect(() => assertVerifiedExecutorOperator({ ...operator }, NOW)).toThrowError(expect.objectContaining({ code: "EXECUTOR_UNAUTHORIZED" }));
    expect(() => assertVerifiedExecutorOperator(JSON.parse(JSON.stringify(operator)), NOW)).toThrowError(expect.objectContaining({ code: "EXECUTOR_UNAUTHORIZED" }));
  });
  it("does not expose bearer or underlying provider failures in errors", async () => {
    const token = await signedToken();
    const resolver: JWTVerifyGetKey = async () => { throw new Error(`unsafe-provider-detail ${token}`); };
    let failure: unknown;
    try { await authenticator(() => NOW, resolver).authenticate(bearer(token)); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
    expect(inspect(failure)).not.toContain(token);
    expect(inspect(failure)).not.toContain("unsafe-provider-detail");
  });
});
