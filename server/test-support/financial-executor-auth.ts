/** Disposable local signing keys and public synthetic IDs. No process environment or network. */
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { createExecutorAuthenticator } from "../../services/financial-executor/src/auth";
import { loadFinancialExecutorConfig, type FinancialExecutorConfig } from "../../services/financial-executor/src/config";

export const EXECUTOR_TEST_NOW_MS = Date.parse("2026-10-10T12:00:00Z");
export const EXECUTOR_TEST_SESSION_ID = "44444444-4444-4444-8444-444444444444";
export const executorTestConfig = loadFinancialExecutorConfig({
  FINANCIAL_EXECUTOR_ENVIRONMENT: "local",
  FINANCIAL_EXECUTOR_DATABASE_URL: "postgresql://structr_calculator_login_v1:disposable-fixture-password@db.example.invalid:5432/financial_local",
  FINANCIAL_EXECUTOR_EXPECTED_DB_HOST: "db.example.invalid",
  FINANCIAL_EXECUTOR_EXPECTED_DB_NAME: "financial_local",
  FINANCIAL_EXECUTOR_EXPECTED_DB_PRINCIPAL: "structr_calculator_login_v1",
  FINANCIAL_EXECUTOR_SUPABASE_URL: "https://executor-auth.example.invalid",
  FINANCIAL_EXECUTOR_OPERATOR_SUB: "11111111-1111-4111-8111-111111111111",
  FINANCIAL_EXECUTOR_ACTOR_ID: "22222222-2222-4222-8222-222222222222",
  FINANCIAL_EXECUTOR_TENANT_ID: "33333333-3333-4333-8333-333333333333",
});
const signingKeys = generateKeyPair("ES256").then(async pair => ({
  privateKey: pair.privateKey,
  keyResolver: createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "executor-test-es256", alg: "ES256", use: "sig" }] }),
}));
export interface SignedExecutorTestOptions {
  config?: FinancialExecutorConfig;
  nowMs?: () => number;
  expiresAtMs?: number;
  claims?: JWTPayload;
}
/** The clock callback also feeds the real verifier; expiry may subsequently be advanced. */
export async function signedExecutorAuthFixture(options: SignedExecutorTestOptions = {}) {
  const config = options.config ?? executorTestConfig;
  const nowMs = options.nowMs ?? (() => EXECUTOR_TEST_NOW_MS);
  const keys = await signingKeys;
  const authenticator = createExecutorAuthenticator(config, { keyResolver: keys.keyResolver, nowMs });
  const token = await new SignJWT({
    sub: config.auth.operatorSubject, iss: config.auth.issuer, aud: "authenticated", role: "authenticated",
    session_id: EXECUTOR_TEST_SESSION_ID, is_anonymous: false,
    exp: Math.floor((options.expiresAtMs ?? nowMs() + 60000) / 1000),
    nbf: Math.floor(nowMs() / 1000) - 1,
    ...options.claims,
  }).setProtectedHeader({ alg: "ES256", kid: "executor-test-es256", typ: "JWT" }).sign(keys.privateKey);
  const request = { headers: { authorization: `Bearer ${token}` }, rawHeaders: ["Authorization", `Bearer ${token}`] };
  const operator = await authenticator.authenticate(request);
  return { operator, authenticator, request, token };
}
export async function signedExecutorOperator(options: SignedExecutorTestOptions = {}) {
  return (await signedExecutorAuthFixture(options)).operator;
}
