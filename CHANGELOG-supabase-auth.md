# CHANGELOG — Supabase Auth V1

**Branch:** `feat/supabase-auth-v1`
**Base:** `main` (structr-ai Phase 4 snapshot)
**Scope:** authentication layer only
**Status:** `pnpm check` clean · `pnpm test` 2,280 passed / 0 failed (51 files)

---

## Objective

Replace the Manus OAuth cookie session with **Supabase GoTrue email/password authentication**, without deleting the legacy implementation and without touching any business engine. The two providers coexist behind a single environment switch, so rollback is a restart, not a revert.

---

## Best path taken

Rather than rewriting `sdk.ts` in place, the change introduces an **auth provider dispatcher** (`server/_core/auth/`). The tRPC context calls one function; the dispatcher decides whether the request is validated by a Supabase bearer token or by the legacy signed cookie. The legacy code path is reached through the same `sdk.authenticateRequest` it always used — untouched, still tested, still reachable.

The decisive design constraint: **the identity model does not change.** The Supabase user id (`sub`) is stored in `profiles.external_open_id`, exactly the column the Manus `openId` used. Consequently `requireProjectAccess`, `getUserPermissions`, tenant scoping and every RLS assumption keep working with zero modification.

```
Browser                          Server
───────                          ──────
supabase.auth.signInWithPassword
        │
        ├─ session persisted (localStorage, auto-refresh)
        │
        └─ tRPC request ──── Authorization: Bearer <access_token> ──▶
                                    │
                                    ├─ verify signature (JWKS or HS256)
                                    ├─ verify iss / aud / exp
                                    ├─ sub ──▶ profiles.external_open_id
                                    ├─ resolve tenant_id (existing helper)
                                    └─ role ──▶ RBAC ──▶ requireProjectAccess
```

---

## Configuration

| Variable | Side | Default | Purpose |
|---|---|---|---|
| `AUTH_PROVIDER` | server | `supabase` | `supabase` \| `legacy`. Unknown values fall back to the default with a warning — the switch never fails open. |
| `SUPABASE_URL` | server | — | **Required** when `AUTH_PROVIDER=supabase`. Falls back to `VITE_SUPABASE_URL`. |
| `SUPABASE_PUBLISHABLE_KEY` | server | — | Browser-safe anon key, echoed by `auth.session`. |
| `SUPABASE_JWT_SECRET` | server | *(empty)* | Optional. Only for legacy Supabase projects signing with HS256. When empty, tokens are verified against the project **JWKS** (asymmetric, rotation-aware). |
| `SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK` | server | `false` | Transitional. Accepts a valid legacy cookie when a request carries no bearer token. Off by default. |
| `VITE_SUPABASE_URL` | client | — | Project URL for the browser client. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | client | — | Publishable key for the browser client. |
| `VITE_AUTH_PROVIDER` | client | `supabase` | Mirrors `AUTH_PROVIDER` so the SPA renders the matching login affordance. |

`OAUTH_SERVER_URL` and `OWNER_OPEN_ID` are **no longer required at boot** unless `AUTH_PROVIDER=legacy`. A full reference lives in the new `.env.example`.

---

## Files added

| File | Role |
|---|---|
| `server/_core/auth/provider.ts` | Pure provider resolution (`resolveAuthProvider`, `isSupabaseAuthEnabled`, `isLegacyAuthEnabled`). Testable without `process.env`. |
| `server/_core/auth/supabase-jwt.ts` | Token verification. Remote JWKS (cached, rotation-aware) with an HS256 fallback; enforces `iss`, `aud=authenticated`, `exp`, non-empty `sub`. Normalizes claims into a `SupabaseIdentity`. |
| `server/_core/auth/supabase-auth.ts` | Maps a verified identity onto `profiles` / tenant / RBAC. Idempotent provisioning on first sign-in; refuses deactivated accounts; fails closed when the DB is down. |
| `server/_core/auth/index.ts` | Dispatcher used by the tRPC context, plus the transitional legacy-cookie fallback. |
| `client/src/lib/supabase.ts` | Lazy browser client. `persistSession`, `autoRefreshToken`, `detectSessionInUrl`, PKCE, dedicated storage key. Returns `null` (never throws) when unconfigured. |
| `client/src/lib/auth-token.ts` | Synchronous access-token cache kept in sync by `onAuthStateChange`; forces a refresh inside a 60 s expiry skew; builds the `Authorization` header for the tRPC link. |
| `client/src/_core/hooks/useSupabaseAuth.ts` | Browser session hook: sign in, session state, sign out, human-readable GoTrue error mapping. |
| `client/src/_core/hooks/useLegacyAuth.ts` | **The Phase 1 hook, preserved.** Same logic, renamed export. Not dead code — it drives the shell under the legacy provider. |
| `client/src/pages/Login.tsx` | `/login` email/password form, `?redirect=` support (same-origin only), configuration-missing banner, legacy bounce to the OAuth portal. |
| `server/supabase-auth-v1.test.ts` | 38 tests: provider switch, bearer parsing, signature/issuer/audience/expiry rejection, claim normalization, identity mapping, idempotency, role/tenant preservation, fail-closed. |
| `server/supabase-auth-v1-isolation.test.ts` | 24 tests: mechanically asserts no protected engine imports the auth layer, and that the legacy provider is still on disk and exporting its surface. |
| `.env.example` | Full environment contract (was referenced by the README but missing from the repo). |

---

## Files modified

| File | Change |
|---|---|
| `server/_core/env.ts` | Added `authProvider`, `supabaseUrl`, `supabasePublishableKey`, `supabaseJwtSecret`, `supabaseAllowLegacyFallback`. Boot validation is now provider-aware: legacy OAuth vars are required only under `AUTH_PROVIDER=legacy`; `SUPABASE_URL` is required under `supabase`. |
| `server/_core/context.ts` | Authentication routed through the dispatcher. `TrpcContext` gained `authProvider`. Sliding cookie refresh now runs **only** under the legacy provider — Supabase rotates its own tokens in the browser. |
| `server/_core/index.ts` | CORS `allowedHeaders` now include `Authorization`. The legacy OAuth callback is mounted **only** under `AUTH_PROVIDER=legacy`. Boot log reports the active provider and verification mode. |
| `server/_core/csp.ts` | `connect-src` now includes the Supabase project origin and its `wss://` counterpart, so GoTrue calls survive `CSP_MODE=enforce`. |
| `server/auth-router.ts` | New public `auth.session` query (provider descriptor). `auth.logout` still clears the legacy cookie under both providers, so a stale Phase 1 cookie cannot outlive a Supabase sign-out. |
| `client/src/const.ts` | Added `AUTH_PROVIDER` / `IS_SUPABASE_AUTH` / `SUPABASE_LOGIN_PATH`. `getLoginUrl()` returns `/login` under Supabase and the OAuth portal URL under legacy. |
| `client/src/_core/hooks/useAuth.ts` | Rewritten as a composed hook. Same return shape for both providers, plus `signIn`, `hasSession`, `authError`, `provider`. **The unconditional `import.meta.env.DEV` auth bypass was removed** (see Risks). |
| `client/src/main.tsx` | tRPC `httpBatchLink` now sends `Authorization: Bearer …` via `headers()`. Token cache hydrated before first render. Unauthorized redirects no longer loop on `/login`. |
| `client/src/App.tsx` | `/login` matched **before** `DashboardLayout`, so the form is reachable without passing the auth gate. |
| `client/src/components/DashboardLayout.tsx` | Unauthenticated operators are redirected to `/login?redirect=…` instead of seeing an inline OAuth button. Display name now reads `fullName`/`email` from the real profile shape. |
| `package.json` / `pnpm-lock.yaml` | Added `@supabase/supabase-js@2.112.3`. |

---

## Explicitly NOT modified (requirement #9)

No file under pricing, scope, estimate, field, actuals, closeout or learning was changed. `server/supabase-auth-v1-isolation.test.ts` enforces this mechanically: it reads each engine module and fails the build if any of them references `_core/auth`, `supabase-jwt`, `supabase-auth` or `@supabase/supabase-js`.

`requireProjectAccess` and the RBAC resolver are byte-identical. They keep operating on `profiles.id` — the internal UUID — which is precisely what the Supabase mapping produces.

---

## Security properties

- **Verification is not decoding.** Tokens are cryptographically verified against the project JWKS (or the HS256 secret), then checked for issuer, audience `authenticated`, expiry and a non-empty `sub`. A token from another Supabase project, an `anon`-audience token, an expired token or a forged signature are all rejected.
- **No trust in client claims for authorization.** Supabase establishes *who* the caller is; the Structr database decides *what* they can do. `role`, `tenant_id` and project membership are never read from the JWT.
- **No privilege escalation on sign-in.** The provisioning upsert refreshes metadata only. An existing `admin` role or a reassigned tenant is never downgraded, and a new account is created with the default role inside the default tenant.
- **Fail closed.** An unreachable profile store raises `403` rather than granting an unmapped session.
- **Deactivated accounts are refused** before and after the upsert.
- **Cookie hygiene.** `auth.logout` clears the legacy cookie under both providers; the browser additionally revokes the Supabase refresh token.

---

## Risks

1. **Dev auth bypass removed.** The previous `useAuth` returned a hard-coded `Wellington` user whenever `import.meta.env.DEV` was true, which meant `pnpm dev` never exercised authentication at all. Under Supabase the login flow now runs in development exactly as in production. If you want the old behaviour while developing offline, set `VITE_AUTH_PROVIDER=legacy` — the server-side dev bypass in `sdk.ts` (`NODE_ENV=development` + `JWT_SECRET=dev-secret-key`) is untouched.
2. **Existing operators must be provisioned in Supabase.** Profiles are keyed by `external_open_id`. A Manus `openId` and a Supabase `sub` are different strings, so an existing operator signing in through Supabase gets a **new** profile row in the default tenant with the default role. Before cutover, either (a) backfill `profiles.external_open_id` with the corresponding Supabase user id, or (b) accept new rows and reassign role/tenant manually. This is a data task, not a code task — flagging it because it is the single most likely production surprise.
3. **JWKS reachability.** Asymmetric verification performs an outbound HTTPS call to `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cached ~10 min, 30 s cooldown). If the server runs in an egress-restricted network, either allow that host or set `SUPABASE_JWT_SECRET` to use symmetric verification.
4. **Provider mismatch.** `AUTH_PROVIDER` and `VITE_AUTH_PROVIDER` must agree. A server on `supabase` with a client built for `legacy` produces silent `401`s. The boot log prints the server-side value; `auth.session` exposes it to the client for diagnostics.
5. **Rate limiting.** The global limiter is 200 requests / 15 min / IP and covers `/api/trpc` only. Supabase sign-in calls go directly to GoTrue and are governed by Supabase's own limits, not by this app.

---

## Rollback

```bash
# .env
AUTH_PROVIDER=legacy
VITE_AUTH_PROVIDER=legacy
OAUTH_SERVER_URL=...     # required again under legacy
OWNER_OPEN_ID=...
```

Rebuild the client, restart the server. The Manus OAuth callback remounts at `/api/oauth/callback`, `useLegacyAuth` drives the shell, and the cookie session with its sliding refresh behaves exactly as in Phase 1. No code revert, no migration, no data change.

---

## Optimization notes

- **One JWKS fetcher per process, not per request.** The key set is memoized by project URL; `jose` handles rotation and cooldown internally.
- **Synchronous token read on the hot path.** The tRPC link reads a module-level cache kept current by `onAuthStateChange`, and only awaits a refresh inside the 60 s expiry skew. No extra promise hop per batch.
- **`auth.me` stays idle until a session exists.** Under Supabase the query is disabled without a token, so an unauthenticated visit costs zero backend round-trips and the shell never hangs on the skeleton.
- **Next lever (not in this change):** `getUserPermissions` already memoizes for 30 s per user. Once Supabase is the only provider, the profile lookup in `authenticateRequest` can share that cache window and drop one DB round-trip per request.

---

## Verification performed

```
pnpm check   → tsc --noEmit, 0 errors
pnpm test    → 51 files passed, 1 skipped · 2,280 tests passed, 79 skipped, 0 failed
vite build   → production bundle builds clean
```

Baseline before the change was 49 files / 2,218 tests. The delta is the 62 new tests introduced by this branch; no pre-existing test was modified or removed.
