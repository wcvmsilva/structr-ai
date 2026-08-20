# Structr Auth Baseline — Supabase HS256

Current validated local authentication baseline for Structr Functional Baseline 001.

## Runtime

- Node.js: >= 22
- pnpm: 10.15.1
- Local app URL: `http://localhost:3000`
- Auth provider: Supabase

## Supabase JWT verification

The current Supabase project issues access tokens using the legacy shared-secret signing mode (`HS256`).

The Structr backend supports this mode when `SUPABASE_JWT_SECRET` is present in the server environment. If the variable is absent, the backend falls back to JWKS verification for asymmetric signing keys.

Required local/server environment values include:

- `AUTH_PROVIDER=supabase`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_JWT_SECRET` for the current HS256 mode
- matching browser-side `VITE_SUPABASE_*` variables

## Security rules

- Never commit `.env` or any secret value.
- `SUPABASE_JWT_SECRET` is server-side only.
- Supabase authentication alone does not grant Structr access.
- A signed-in Supabase user must already map to an active Structr profile through `profiles.external_open_id = auth.users.id`.
- Tenant and RBAC authorization remain fail-closed.

## Future signing-key migration

If the Supabase project is migrated from HS256 to asymmetric signing keys, validate the new JWT algorithm and JWKS flow before removing `SUPABASE_JWT_SECRET` from production/runtime configuration.
