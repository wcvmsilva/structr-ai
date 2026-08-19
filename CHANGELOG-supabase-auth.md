# CHANGELOG — Supabase Auth V1 (Security Hardening)

**Branch:** `integrate/supabase-auth-v1`

**Base:** `feat/supabase-auth-v1` at `fd744f7`

**Scope:** Supabase authentication authorization boundary only

**Status:** `pnpm check` clean · `pnpm test` 2,279 passed / 0 failed · `pnpm build` clean

---

## Objective

This release hardens Supabase Auth V1 to **fail closed**. A cryptographically valid Supabase access token now proves the caller's identity only; it does **not** create a Structr principal or grant application access.

Access is granted only when an administrator has already mapped the Supabase user id (`auth.users.id`, carried as JWT `sub`) to an **active** Structr profile at `profiles.external_open_id`. Unknown Supabase identities receive `ForbiddenError` and cannot create a profile, receive the default GCHI tenant, receive a tenant membership, or inherit any RBAC role.

> **Security rule:** Authentication and authorization are separate. Supabase authenticates the user. Structr authorizes only an active, explicitly mapped profile.

---

## Security correction

| Concern | Previous V1 behavior | Hardened behavior |
|---|---|---|
| Unknown valid Supabase user | Automatically called `upsertProfileFromOAuth()` | Denied with `ForbiddenError` |
| Structr profile creation | Could create a new `profiles` row at first sign-in | Never created by the Supabase request path |
| Tenant assignment | Could resolve and assign the default GCHI tenant | No default-tenant lookup or assignment |
| Tenant membership | Could arise as a result of provisioning | Never created by authentication |
| RBAC source | Existing profile role was preserved, but new users received a default profile role | Only the pre-existing mapped profile supplies tenant and role |
| Existing mapped user | Metadata refresh through the provisioning helper | Existing active profile is returned unchanged; tenant, role and metadata remain administrator-controlled |

The correction is intentionally narrow: pricing, scope, estimate, field, actuals, closeout and learning engines remain untouched. `requireProjectAccess` and the RBAC resolver remain unchanged and continue to authorize using `profiles.id`, tenant membership and the profile role.

---

## Authentication flow

```text
Browser
  │
  ├─ supabase.auth.signInWithPassword(email, password)
  ├─ persisted Supabase session / automatic refresh
  └─ tRPC: Authorization: Bearer <access_token>
                                      │
                                      ▼
Server
  ├─ Verify JWT signature via project JWKS (or legacy HS256 secret)
  ├─ Validate issuer, audience=authenticated, expiry and non-empty sub
  ├─ Lookup profiles.external_open_id === JWT sub
  │     ├─ no profile          → ForbiddenError (fail closed)
  │     ├─ inactive profile    → ForbiddenError
  │     └─ active profile      → existing profiles.id / tenant_id / role
  └─ requireProjectAccess + RBAC execute unchanged
```

The Supabase authentication path contains **no** call to `upsertProfileFromOAuth()` and performs **no** default-tenant lookup. This is the key control that blocks implicit tenant access.

---

## Required operating procedure

Before an operator can use Supabase authentication, an administrator must provision the Structr side of the identity outside the login request path.

| Step | Administrator action | Security outcome |
|---|---|---|
| 1 | Create or identify the user in Supabase Auth | Establishes the external identity (`auth.users.id`) |
| 2 | Create or update the Structr `profiles` record through an approved administrative process | Establishes the internal principal (`profiles.id`) |
| 3 | Set `profiles.external_open_id` to the exact Supabase `auth.users.id` | Explicit identity binding |
| 4 | Assign the correct `tenant_id`, `role`, and any required project memberships | Least-privilege authorization |
| 5 | Confirm `is_active=true` | Enables login access |

A user who completes Step 1 but not Steps 2–5 can sign in to Supabase but cannot enter Structr. That denial is expected and correct.

---

## Files changed by this security fix

| File | Change |
|---|---|
| `server/_core/auth/supabase-auth.ts` | Removed the `upsertProfileFromOAuth` import and all automatic provisioning logic. `resolveProfileForSupabaseIdentity()` now looks up only `profiles.external_open_id === identity.sub`, denies absent mappings with `ForbiddenError`, denies inactive mappings, and returns the existing active profile unchanged. |
| `server/supabase-auth-v1.test.ts` | Replaced first-sign-in provisioning tests with fail-closed tests. Tests now prove that a valid but unmapped identity creates no profile, calls no provisioning helper, performs no default-tenant lookup, and receives a denial. They also prove that an active mapped profile retains its exact internal id, tenant, role and metadata. |
| `CHANGELOG-supabase-auth.md` | Rewritten to document the hardened authorization boundary, administrator provisioning prerequisite, changed risk profile and final validation. |

No schema migration was added. No data was modified. No engine file was changed.

---

## Supabase Auth V1 architecture retained from the base branch

| Component | Responsibility |
|---|---|
| `server/_core/auth/provider.ts` | Selects `AUTH_PROVIDER=supabase|legacy`; defaults to `supabase` and never fails open on an unknown value. |
| `server/_core/auth/supabase-jwt.ts` | Verifies signature through the Supabase project JWKS, or the configured HS256 secret for legacy projects; requires valid issuer, audience, expiry and subject. |
| `server/_core/auth/supabase-auth.ts` | Resolves only an existing active Structr profile and enforces the fail-closed boundary. |
| `server/_core/auth/index.ts` | Provider dispatcher for tRPC context authentication. |
| `client/src/lib/supabase.ts` | Browser Supabase client with persisted session, automatic token refresh and PKCE. |
| `client/src/lib/auth-token.ts` | Keeps the bearer token current and sends it through the tRPC `Authorization` header. |
| `client/src/pages/Login.tsx` | Email/password sign-in at `/login`. |
| `client/src/_core/hooks/useLegacyAuth.ts` | Preserved Manus OAuth hook for rollback. |

---

## Configuration

| Variable | Side | Default | Purpose |
|---|---|---|---|
| `AUTH_PROVIDER` | server | `supabase` | Selects `supabase` or `legacy`. |
| `SUPABASE_URL` | server | — | Required for Supabase JWT validation. |
| `SUPABASE_PUBLISHABLE_KEY` | server | — | Browser-safe key exposed by `auth.session` diagnostics. |
| `SUPABASE_JWT_SECRET` | server | *(empty)* | Optional only for legacy HS256 Supabase projects; otherwise JWKS verification is used. |
| `SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK` | server | `false` | Transitional legacy-cookie fallback. Keep disabled after cutover. |
| `VITE_SUPABASE_URL` | browser | — | Supabase project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | — | Supabase publishable key. |
| `VITE_AUTH_PROVIDER` | browser | `supabase` | Must match `AUTH_PROVIDER`. |

`OAUTH_SERVER_URL` and `OWNER_OPEN_ID` remain required only if `AUTH_PROVIDER=legacy`.

---

## Security properties

- **Cryptographic verification:** JWTs are verified, not merely decoded. The verifier enforces signature, project issuer, `authenticated` audience, expiry and a non-empty subject.
- **Explicit identity binding:** A JWT `sub` must match an existing `profiles.external_open_id`; there is no email-based fallback and no trust in mutable JWT metadata for authorization.
- **No implicit tenant access:** Supabase login never resolves the default GCHI tenant, creates a `profiles` record or creates tenant membership.
- **RBAC preserved:** Tenant, role and project access derive exclusively from the pre-existing Structr profile and related authorization records.
- **Deactivation preserved:** A mapped profile with `is_active=false` is denied.
- **Legacy rollback preserved:** `AUTH_PROVIDER=legacy` restores the existing Manus OAuth and cookie flow; no legacy auth code was deleted.
- **Logout hygiene preserved:** Browser logout revokes the Supabase session; server logout clears the legacy cookie as a defensive cleanup step.

---

## Risks and operational controls

| Risk | Control |
|---|---|
| A new Supabase user expects immediate app access | This is now intentionally denied. Complete the administrator provisioning procedure before login. |
| Wrong Supabase user id mapped to a Structr profile | Treat the mapping as a privileged administrative change and verify the UUID directly from Supabase before saving. |
| A mapped profile has the wrong tenant or role | The login path no longer corrects or overwrites it. Review tenant, role and project membership during provisioning. |
| Browser/server provider mismatch | Keep `AUTH_PROVIDER` and `VITE_AUTH_PROVIDER` aligned; the server boot log and `auth.session` expose the active mode. |
| JWKS host unavailable from the server network | Allow outbound access to `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, or configure `SUPABASE_JWT_SECRET` only for a legacy HS256 Supabase project. |

---

## Rollback

The secure Supabase flow is the default. To return to the preserved Manus OAuth implementation:

```bash
# .env
AUTH_PROVIDER=legacy
VITE_AUTH_PROVIDER=legacy
OAUTH_SERVER_URL=...
OWNER_OPEN_ID=...
```

Rebuild the browser bundle and restart the server. The legacy callback remounts at `/api/oauth/callback`, `useLegacyAuth` drives the application shell, and cookie-session behavior remains available without reverting this security commit.

---

## Verification performed

```text
pnpm check
  → tsc --noEmit, 0 errors

pnpm test
  → 51 files passed, 1 skipped
  → 2,279 passed, 79 skipped, 0 failed

pnpm build
  → Vite browser bundle clean
  → server esbuild bundle clean
```

The targeted Supabase auth suite contains 37 passing tests. Its fail-closed coverage includes: unknown identity denial, no profile creation, no provisioning-helper call, no default-tenant lookup, no tenant-membership side effect, inactive profile denial, and exact tenant/RBAC preservation for a mapped active profile.

---

## Commit

This security correction is committed on `integrate/supabase-auth-v1`. The final artifact is `structr-ai-supabase-auth-v1-secure.zip`.

---

## References

This CHANGELOG describes repository-local implementation and validation results; no external reference was required.
