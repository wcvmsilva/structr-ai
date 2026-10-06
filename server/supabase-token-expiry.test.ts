import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactSign, exportJWK, generateKeyPair, type JWK } from "jose";
import {
  clearSupabaseJwksCache,
  verifySupabaseAccessToken,
} from "./_core/auth/supabase-jwt";

const PROJECT_URL = "https://expiry-test.invalid";
const ISSUER = "https://expiry-test.invalid/auth/v1";
const JWKS_URL = "https://expiry-test.invalid/auth/v1/.well-known/jwks.json";
const SUBJECT = "10000000-0000-4000-8000-000000000001";
const NOW_SECONDS = 1_893_456_000;
const NOW = new Date("2030-01-01T00:00:00.000Z");
const ALGORITHMS = ["HS256", "ES256", "RS256"] as const;
type Algorithm = (typeof ALGORITHMS)[number];

// All key material is generated here. Only the JWKS HTTP transport is replaced;
// jose selects the real public key and verifies every signature and claim.
const secret = randomBytes(32).toString("base64url");
const signingKeys: Partial<Record<Algorithm, CryptoKey | Uint8Array>> = {
  HS256: new TextEncoder().encode(secret),
};
const publicKeys: JWK[] = [];

beforeAll(async () => {
  for (const algorithm of ["ES256", "RS256"] as const) {
    const pair = await generateKeyPair(algorithm);
    signingKeys[algorithm] = pair.privateKey;
    publicKeys.push({
      ...(await exportJWK(pair.publicKey)),
      alg: algorithm,
      kid: `expiry-${algorithm}`,
      use: "sig",
    });
  }
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearSupabaseJwksCache();
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== JWKS_URL) throw new Error("Unexpected external request in expiry test");
    return new Response(JSON.stringify({ keys: publicKeys }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  clearSupabaseJwksCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function sign(algorithm: Algorithm, claims: Record<string, unknown>) {
  const key = signingKeys[algorithm];
  if (!key) throw new Error("Synthetic signing key not initialized");
  // CompactSign permits signed malformed claim values, so rejection must happen
  // at the production verification boundary instead of in a fixture builder.
  return new CompactSign(new TextEncoder().encode(JSON.stringify({
    iss: ISSUER,
    aud: "authenticated",
    sub: SUBJECT,
    role: "authenticated",
    nbf: NOW_SECONDS,
    ...claims,
  })))
    .setProtectedHeader({ alg: algorithm, kid: `expiry-${algorithm}`, typ: "JWT" })
    .sign(key);
}

function verify(algorithm: Algorithm, token: string) {
  return verifySupabaseAccessToken(token, {
    supabaseUrl: PROJECT_URL,
    // An explicit empty secret selects JWKS regardless of inherited environment.
    jwtSecret: algorithm === "HS256" ? secret : "",
  });
}

describe.each(ALGORITHMS)("Supabase %s access-token expiry", algorithm => {
  it("rejects a correctly signed token without exp", async () => {
    expect(await verify(algorithm, await sign(algorithm, {}))).toBeNull();
  });

  it("accepts a correctly signed token with future exp and returns its expiry", async () => {
    const token = await sign(algorithm, { exp: 1_893_456_060 });
    expect(await verify(algorithm, token)).toMatchObject({
      sub: SUBJECT,
      role: "authenticated",
      expiresAtMs: 1_893_456_060_000,
    });
  });

  it("rejects a correctly signed token whose exp is in the past", async () => {
    expect(await verify(algorithm, await sign(algorithm, { exp: 1_893_455_999 }))).toBeNull();
  });

  it("rejects a token at the exact exp instant without a grace interval", async () => {
    expect(await verify(algorithm, await sign(algorithm, { exp: 1_893_456_000 }))).toBeNull();
  });

  it("rechecks expiry after a previously valid token reaches exp", async () => {
    const token = await sign(algorithm, { exp: 1_893_456_001 });
    expect(await verify(algorithm, token)).toMatchObject({ sub: SUBJECT });
    vi.setSystemTime(new Date("2030-01-01T00:00:01.000Z"));
    expect(await verify(algorithm, token)).toBeNull();
  });

  it.each([
    ["numeric string", "1893456060"],
    ["null", null],
  ])("rejects a signed %s exp instead of coercing it", async (_label, exp) => {
    expect(await verify(algorithm, await sign(algorithm, { exp }))).toBeNull();
  });

  it("still rejects a future nbf even when exp is valid", async () => {
    const token = await sign(algorithm, { exp: 1_893_456_060, nbf: 1_893_456_001 });
    expect(await verify(algorithm, token)).toBeNull();
  });

  it("still rejects a payload modified after signing even when exp is valid", async () => {
    const token = await sign(algorithm, { exp: 1_893_456_060 });
    const [header, payload, signature] = token.split(".");
    const changedPayload = {
      ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
      sub: "10000000-0000-4000-8000-000000000002",
    };
    const forged = `${header}.${Buffer.from(JSON.stringify(changedPayload)).toString("base64url")}.${signature}`;
    expect(await verify(algorithm, forged)).toBeNull();
  });

  it("still rejects another issuer even when signature and exp are valid", async () => {
    const token = await sign(algorithm, { exp: 1_893_456_060, iss: "https://other-project.invalid/auth/v1" });
    expect(await verify(algorithm, token)).toBeNull();
  });

  it("still rejects the anon audience even when signature and exp are valid", async () => {
    const token = await sign(algorithm, { exp: 1_893_456_060, aud: "anon" });
    expect(await verify(algorithm, token)).toBeNull();
  });
});
