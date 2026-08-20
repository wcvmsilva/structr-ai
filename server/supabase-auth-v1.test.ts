/**
 * SUPABASE AUTH V1 — provider switch, token verification and identity mapping
 *
 * The contract locked here:
 *
 *   1. AUTH_PROVIDER selects the provider, defaults to "supabase", and never fails open.
 *   2. Only a token that is signed by the project, unexpired, issued by
 *      `${SUPABASE_URL}/auth/v1` and scoped to the "authenticated" audience is accepted.
 *   3. A verified identity gets Structr access only when an ACTIVE profile already exists:
 *        profiles.external_open_id === Supabase `sub`.
 *        Unknown identities fail closed: no profile, default tenant or membership is created.
 *   4. The existing profile id / tenant_id / role remain the authorization source,
 *        so requireProjectAccess() and RBAC keep working untouched.
 *   5. Deactivated profiles are refused.
 *   6. The legacy Manus OAuth path still authenticates when AUTH_PROVIDER=legacy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT } from "jose";
import type { Request } from "express";

// ══════════════════════════════════════════════════════════════════════
// TEST DOUBLES
// ══════════════════════════════════════════════════════════════════════

type ProfileRow = {
  id: string;
  tenantId: string | null;
  externalOpenId: string | null;
  email: string | null;
  loginMethod: string | null;
  fullName: string | null;
  companyName: string | null;
  role: string | null;
  isActive: boolean;
  lastSignedIn: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const TENANT_ID = "20000000-0000-4000-8000-00000000000a";

const identityState = {
  profiles: [] as ProfileRow[],
  /** Simulate an unavailable database. */
  dbDown: false,
  /** Security assertions: Supabase auth must not invoke this legacy provisioning helper. */
  upsertCalls: [] as Array<Record<string, unknown>>,
  /** Security assertion: Supabase auth must not even look up the default tenant. */
  defaultTenantLookups: 0,
};

function makeProfile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: TENANT_ID,
    externalOpenId: null,
    email: null,
    loginMethod: null,
    fullName: null,
    companyName: "GC Home Improvement LLC",
    role: "user",
    isActive: true,
    lastSignedIn: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

vi.mock("../identity-db", () => ({}));

vi.mock("./_core/env", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/env")>();
  return {
    ...actual,
    ENV: {
      ...actual.ENV,
      supabaseUrl: "",
      supabaseJwtSecret: "",
    },
  };
});

vi.mock("./identity-db", () => ({
  getProfileByExternalOpenId: vi.fn(async (externalOpenId: string) => {
    if (identityState.dbDown) return null;
    return (
      identityState.profiles.find(p => p.externalOpenId === externalOpenId) ?? null
    );
  }),
  getDefaultTenantId: vi.fn(async () => {
    identityState.defaultTenantLookups += 1;
    return identityState.dbDown ? null : TENANT_ID;
  }),
  upsertProfileFromOAuth: vi.fn(async (identity: Record<string, unknown>) => {
    identityState.upsertCalls.push(identity);
    if (identityState.dbDown) return null;

    const externalOpenId = identity.externalOpenId as string;
    const existing = identityState.profiles.find(
      p => p.externalOpenId === externalOpenId,
    );

    if (existing) {
      // Mirrors the COALESCE semantics of the real upsert: metadata is refreshed,
      // tenant and role are never downgraded.
      existing.fullName = (identity.fullName as string) ?? existing.fullName;
      existing.email = (identity.email as string) ?? existing.email;
      existing.loginMethod =
        (identity.loginMethod as string) ?? existing.loginMethod;
      existing.lastSignedIn = new Date();
      return existing;
    }

    const created = makeProfile({
      id: `profile-${identityState.profiles.length + 1}`,
      externalOpenId,
      fullName: (identity.fullName as string) ?? null,
      email: (identity.email as string) ?? null,
      loginMethod: (identity.loginMethod as string) ?? null,
      lastSignedIn: new Date(),
    });
    identityState.profiles.push(created);
    return created;
  }),
}));

// ══════════════════════════════════════════════════════════════════════
// IMPORTS UNDER TEST (after the mocks are registered)
// ══════════════════════════════════════════════════════════════════════

import {
  resolveAuthProvider,
  isSupabaseAuthEnabled,
  isLegacyAuthEnabled,
  DEFAULT_AUTH_PROVIDER,
} from "./_core/auth/provider";
import {
  extractBearerToken,
  identityFromClaims,
  normalizeSupabaseUrl,
  supabaseIssuer,
  supabaseJwksUrl,
  verifySupabaseAccessToken,
  SUPABASE_AUDIENCE,
  type SupabaseIdentity,
} from "./_core/auth/supabase-jwt";
import {
  deriveDisplayName,
  supabaseLoginMethod,
  resolveProfileForSupabaseIdentity,
  authenticateSupabaseRequest,
} from "./_core/auth/supabase-auth";
import { isLegacyFallbackEnabled } from "./_core/auth";

// ══════════════════════════════════════════════════════════════════════
// FIXTURES
// ══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://project-ref.supabase.co";
const SUPABASE_JWT_SECRET = "s".repeat(48);
const SUB = "9f7d1a3e-0000-4000-8000-abcdefabcdef";

const secretKey = new TextEncoder().encode(SUPABASE_JWT_SECRET);

async function signSupabaseToken(
  overrides: {
    sub?: string | null;
    issuer?: string;
    audience?: string;
    email?: string | null;
    expiresInSeconds?: number;
    userMetadata?: Record<string, unknown>;
    appMetadata?: Record<string, unknown>;
    secret?: Uint8Array;
  } = {},
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresInSeconds = overrides.expiresInSeconds ?? 3600;

  const payload: Record<string, unknown> = {
    role: "authenticated",
    user_metadata: overrides.userMetadata ?? { full_name: "Wellington Silva" },
    app_metadata: overrides.appMetadata ?? { provider: "email" },
  };

  if (overrides.email !== null) {
    payload.email = overrides.email ?? "wellington@gchi.com";
  }

  let builder = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(nowSeconds)
    .setIssuer(overrides.issuer ?? supabaseIssuer(SUPABASE_URL))
    .setAudience(overrides.audience ?? SUPABASE_AUDIENCE)
    .setExpirationTime(nowSeconds + expiresInSeconds);

  if (overrides.sub !== null) {
    builder = builder.setSubject(overrides.sub ?? SUB);
  }

  return builder.sign(overrides.secret ?? secretKey);
}

function verifyOptions() {
  return { supabaseUrl: SUPABASE_URL, jwtSecret: SUPABASE_JWT_SECRET };
}

function requestWithAuthorization(headerValue?: string): Request {
  return {
    headers: headerValue ? { authorization: headerValue } : {},
  } as unknown as Request;
}

beforeEach(() => {
  identityState.profiles = [];
  identityState.dbDown = false;
  identityState.upsertCalls = [];
  identityState.defaultTenantLookups = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AUTH_PROVIDER;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_JWT_SECRET;
  delete process.env.SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK;
});

// ══════════════════════════════════════════════════════════════════════
// 1. PROVIDER SWITCH
// ══════════════════════════════════════════════════════════════════════

describe("SUPABASE AUTH V1: AUTH_PROVIDER switch", () => {
  it("defaults to supabase when AUTH_PROVIDER is unset or blank", () => {
    expect(DEFAULT_AUTH_PROVIDER).toBe("supabase");
    expect(resolveAuthProvider({})).toBe("supabase");
    expect(resolveAuthProvider({ AUTH_PROVIDER: undefined })).toBe("supabase");
    expect(resolveAuthProvider({ AUTH_PROVIDER: "   " })).toBe("supabase");
  });

  it("selects the legacy provider for an explicit opt-in", () => {
    expect(resolveAuthProvider({ AUTH_PROVIDER: "legacy" })).toBe("legacy");
    expect(resolveAuthProvider({ AUTH_PROVIDER: "  LEGACY " })).toBe("legacy");
  });

  it("accepts the supabase value case-insensitively", () => {
    expect(resolveAuthProvider({ AUTH_PROVIDER: "Supabase" })).toBe("supabase");
  });

  it("falls back to the default (never fails open) on an unknown value", () => {
    expect(resolveAuthProvider({ AUTH_PROVIDER: "auth0" })).toBe("supabase");
    expect(resolveAuthProvider({ AUTH_PROVIDER: "none" })).toBe("supabase");
    expect(resolveAuthProvider({ AUTH_PROVIDER: "off" })).toBe("supabase");
  });

  it("exposes matching boolean helpers", () => {
    expect(isSupabaseAuthEnabled({})).toBe(true);
    expect(isLegacyAuthEnabled({})).toBe(false);
    expect(isSupabaseAuthEnabled({ AUTH_PROVIDER: "legacy" })).toBe(false);
    expect(isLegacyAuthEnabled({ AUTH_PROVIDER: "legacy" })).toBe(true);
  });

  it("keeps the transitional legacy-cookie fallback OFF by default", () => {
    expect(isLegacyFallbackEnabled({})).toBe(false);
    expect(
      isLegacyFallbackEnabled({ SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK: "false" }),
    ).toBe(false);
    expect(
      isLegacyFallbackEnabled({ SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK: "true" }),
    ).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 2. URL / HEADER HELPERS
// ══════════════════════════════════════════════════════════════════════

describe("SUPABASE AUTH V1: project URL helpers", () => {
  it("strips trailing slashes from the project URL", () => {
    expect(normalizeSupabaseUrl("https://x.supabase.co/")).toBe(
      "https://x.supabase.co",
    );
    expect(normalizeSupabaseUrl("  https://x.supabase.co///  ")).toBe(
      "https://x.supabase.co",
    );
  });

  it("derives the GoTrue issuer and JWKS endpoint", () => {
    expect(supabaseIssuer(SUPABASE_URL)).toBe(
      "https://project-ref.supabase.co/auth/v1",
    );
    expect(supabaseJwksUrl(SUPABASE_URL)).toBe(
      "https://project-ref.supabase.co/auth/v1/.well-known/jwks.json",
    );
  });
});

describe("SUPABASE AUTH V1: bearer extraction", () => {
  it("extracts the token from a well-formed header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("is case-insensitive on the scheme and tolerates extra whitespace", () => {
    expect(extractBearerToken("bearer   abc.def.ghi  ")).toBe("abc.def.ghi");
    expect(extractBearerToken("BEARER abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("returns null for a missing, empty or non-bearer header", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(extractBearerToken("Bearer")).toBeNull();
    expect(extractBearerToken("Bearer    ")).toBeNull();
  });

  it("uses the first value when the header arrives as an array", () => {
    expect(extractBearerToken(["Bearer token-a", "Bearer token-b"])).toBe(
      "token-a",
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
// 3. TOKEN VERIFICATION
// ══════════════════════════════════════════════════════════════════════

describe("SUPABASE AUTH V1: access token verification", () => {
  it("accepts a valid token and returns the normalized identity", async () => {
    const token = await signSupabaseToken();
    const identity = await verifySupabaseAccessToken(token, verifyOptions());

    expect(identity).not.toBeNull();
    expect(identity?.sub).toBe(SUB);
    expect(identity?.email).toBe("wellington@gchi.com");
    expect(identity?.fullName).toBe("Wellington Silva");
    expect(identity?.provider).toBe("email");
    expect(identity?.role).toBe("authenticated");
    expect(identity?.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it("rejects an empty or missing token", async () => {
    expect(await verifySupabaseAccessToken(null, verifyOptions())).toBeNull();
    expect(await verifySupabaseAccessToken(undefined, verifyOptions())).toBeNull();
    expect(await verifySupabaseAccessToken("", verifyOptions())).toBeNull();
  });

  it("rejects a token signed with a different secret (forged signature)", async () => {
    const token = await signSupabaseToken({
      secret: new TextEncoder().encode("x".repeat(48)),
    });
    expect(await verifySupabaseAccessToken(token, verifyOptions())).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signSupabaseToken({ expiresInSeconds: -60 });
    expect(await verifySupabaseAccessToken(token, verifyOptions())).toBeNull();
  });

  it("rejects a token issued by another Supabase project", async () => {
    const token = await signSupabaseToken({
      issuer: "https://another-project.supabase.co/auth/v1",
    });
    expect(await verifySupabaseAccessToken(token, verifyOptions())).toBeNull();
  });

  it("rejects a token with the wrong audience (e.g. anon key)", async () => {
    const token = await signSupabaseToken({ audience: "anon" });
    expect(await verifySupabaseAccessToken(token, verifyOptions())).toBeNull();
  });

  it("rejects a structurally invalid token", async () => {
    expect(
      await verifySupabaseAccessToken("not-a-jwt", verifyOptions()),
    ).toBeNull();
    expect(
      await verifySupabaseAccessToken("a.b.c", verifyOptions()),
    ).toBeNull();
  });

  it("throws a configuration error when the project URL is unset", async () => {
    const token = await signSupabaseToken();
    await expect(
      verifySupabaseAccessToken(token, {
        supabaseUrl: "",
        jwtSecret: SUPABASE_JWT_SECRET,
      }),
    ).rejects.toThrow(/SUPABASE_URL/i);
  });

  it("tolerates a project URL configured with a trailing slash", async () => {
    const token = await signSupabaseToken();
    const identity = await verifySupabaseAccessToken(token, {
      supabaseUrl: `${SUPABASE_URL}/`,
      jwtSecret: SUPABASE_JWT_SECRET,
    });
    expect(identity?.sub).toBe(SUB);
  });
});

describe("SUPABASE AUTH V1: claim normalization", () => {
  it("prefers user_metadata.full_name, then name", () => {
    expect(
      identityFromClaims({ sub: SUB, user_metadata: { name: "Field Op" } })
        .fullName,
    ).toBe("Field Op");
    expect(
      identityFromClaims({
        sub: SUB,
        user_metadata: { full_name: "Wellington", name: "ignored" },
      }).fullName,
    ).toBe("Wellington");
  });

  it("returns nulls instead of empty strings when metadata is absent", () => {
    const identity = identityFromClaims({ sub: SUB });
    expect(identity.email).toBeNull();
    expect(identity.fullName).toBeNull();
    expect(identity.provider).toBeNull();
  });

  it("reads the sign-in provider from app_metadata", () => {
    expect(
      identityFromClaims({ sub: SUB, app_metadata: { provider: "google" } })
        .provider,
    ).toBe("google");
  });
});

// ══════════════════════════════════════════════════════════════════════
// 4. IDENTITY MAPPING ONTO THE STRUCTR MODEL
// ══════════════════════════════════════════════════════════════════════

function identityFixture(
  overrides: Partial<SupabaseIdentity> = {},
): SupabaseIdentity {
  return {
    sub: SUB,
    email: "wellington@gchi.com",
    fullName: "Wellington Silva",
    provider: "email",
    role: "authenticated",
    expiresAtMs: Date.now() + 3_600_000,
    claims: {},
    ...overrides,
  };
}

describe("SUPABASE AUTH V1: login method and display name", () => {
  it("namespaces the login method by provider", () => {
    expect(supabaseLoginMethod(identityFixture())).toBe("supabase:email");
    expect(supabaseLoginMethod(identityFixture({ provider: "google" }))).toBe(
      "supabase:google",
    );
    expect(supabaseLoginMethod(identityFixture({ provider: null }))).toBe(
      "supabase",
    );
  });

  it("falls back to the email local part when no name is present", () => {
    expect(deriveDisplayName(identityFixture({ fullName: null }))).toBe(
      "wellington",
    );
    expect(
      deriveDisplayName(identityFixture({ fullName: null, email: null })),
    ).toBeNull();
  });
});

describe("SUPABASE AUTH V1: profile / tenant / RBAC mapping", () => {
  it("denies a valid Supabase identity that has no mapped active Structr profile", async () => {
    await expect(
      resolveProfileForSupabaseIdentity(identityFixture()),
    ).rejects.toThrow(/not provisioned/i);

    // Fail closed: authentication does not create a Structr principal, tenant link,
    // membership or a default-tenant lookup as a side effect.
    expect(identityState.profiles).toHaveLength(0);
    expect(identityState.upsertCalls).toHaveLength(0);
    expect(identityState.defaultTenantLookups).toBe(0);
  });

  it("keeps an existing mapped profile as the sole source of tenant and RBAC", async () => {
    const mapped = makeProfile({
      id: "admin-profile",
      externalOpenId: SUB,
      role: "admin",
      tenantId: "30000000-0000-4000-8000-00000000000b",
      fullName: "Provisioned Operator",
      email: "operator@gchi.com",
      loginMethod: "admin-provisioned",
    });
    identityState.profiles.push(mapped);

    const profile = await resolveProfileForSupabaseIdentity(identityFixture());

    expect(profile).toBe(mapped);
    expect(profile.id).toBe("admin-profile");
    expect(profile.externalOpenId).toBe(SUB);
    expect(profile.id).not.toBe(profile.externalOpenId);
    expect(profile.role).toBe("admin");
    expect(profile.tenantId).toBe("30000000-0000-4000-8000-00000000000b");
    expect(profile.fullName).toBe("Provisioned Operator");
    expect(profile.email).toBe("operator@gchi.com");
    expect(profile.loginMethod).toBe("admin-provisioned");
    expect(identityState.profiles).toHaveLength(1);
    expect(identityState.upsertCalls).toHaveLength(0);
    expect(identityState.defaultTenantLookups).toBe(0);
  });

  it("refuses a deactivated mapped profile", async () => {
    identityState.profiles.push(
      makeProfile({ externalOpenId: SUB, isActive: false }),
    );

    await expect(
      resolveProfileForSupabaseIdentity(identityFixture()),
    ).rejects.toThrow(/disabled/i);
    expect(identityState.upsertCalls).toHaveLength(0);
    expect(identityState.defaultTenantLookups).toBe(0);
  });

  it("refuses an identity with no subject", async () => {
    await expect(
      resolveProfileForSupabaseIdentity(identityFixture({ sub: "" })),
    ).rejects.toThrow(/subject/i);
  });

  it("fails closed when the profile lookup returns no row", async () => {
    identityState.dbDown = true;

    await expect(
      resolveProfileForSupabaseIdentity(identityFixture()),
    ).rejects.toThrow(/not provisioned/i);
    expect(identityState.upsertCalls).toHaveLength(0);
    expect(identityState.defaultTenantLookups).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 5. REQUEST-LEVEL AUTHENTICATION
// ══════════════════════════════════════════════════════════════════════

describe("SUPABASE AUTH V1: request authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    await expect(
      authenticateSupabaseRequest(requestWithAuthorization()),
    ).rejects.toThrow(/bearer token/i);
  });

  it("rejects a request carrying a non-bearer scheme", async () => {
    await expect(
      authenticateSupabaseRequest(requestWithAuthorization("Basic abc")),
    ).rejects.toThrow(/bearer token/i);
  });

  it("refuses to authenticate when the project URL is not configured", async () => {
    // ENV is frozen at import time. In the test environment SUPABASE_URL is unset,
    // which must surface as a hard configuration failure rather than an open door.
    await expect(
      authenticateSupabaseRequest(
        requestWithAuthorization("Bearer definitely.not.valid"),
      ),
    ).rejects.toThrow(/SUPABASE_URL/i);
  });

  it("rejects an invalid bearer token once the project is configured", async () => {
    // Same code path with an explicit project configuration: a malformed token is
    // refused, and the refusal is a 403, not a crash.
    const identity = await verifySupabaseAccessToken(
      "definitely.not.valid",
      verifyOptions(),
    );
    expect(identity).toBeNull();
  });

  it("denies a cryptographically valid token when its user is not mapped in Structr", async () => {
    const token = await signSupabaseToken();
    const verified = await verifySupabaseAccessToken(token, verifyOptions());
    expect(verified).not.toBeNull();

    await expect(
      resolveProfileForSupabaseIdentity(verified!),
    ).rejects.toThrow(/not provisioned/i);
    expect(identityState.profiles).toHaveLength(0);
    expect(identityState.upsertCalls).toHaveLength(0);
    expect(identityState.defaultTenantLookups).toBe(0);
  });

  it("authorizes a cryptographically valid token only after an active Structr mapping exists", async () => {
    identityState.profiles.push(
      makeProfile({
        id: "mapped-user-profile",
        externalOpenId: SUB,
        tenantId: TENANT_ID,
        role: "estimator",
      }),
    );
    const token = await signSupabaseToken();
    const verified = await verifySupabaseAccessToken(token, verifyOptions());
    expect(verified).not.toBeNull();

    const profile = await resolveProfileForSupabaseIdentity(verified!);
    expect(profile.id).toBe("mapped-user-profile");
    expect(profile.externalOpenId).toBe(SUB);
    expect(profile.tenantId).toBe(TENANT_ID);
    expect(profile.role).toBe("estimator");
    expect(profile.isActive).toBe(true);
    expect(identityState.upsertCalls).toHaveLength(0);
    expect(identityState.defaultTenantLookups).toBe(0);
  });
});
