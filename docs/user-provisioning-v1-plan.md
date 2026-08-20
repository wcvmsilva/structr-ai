# User Provisioning v1 — Implementation Plan

## Objective

Allow Structr administrators to create and manage users safely while preserving the current fail-closed Supabase authentication and tenant/RBAC model.

## Current baseline

- Supabase Auth authenticates users.
- Structr authorizes only users mapped through `profiles.external_open_id = auth.users.id`.
- `profiles` already stores tenant, role, email, login method, active status, and last sign-in.
- Roles and permissions already exist as separate tables.
- No `must_change_password` field currently exists.
- No automatic Supabase-to-Structr profile provisioning is allowed on normal login.

## V1 scope

1. Admin-only Users screen.
2. Create user with name, email, role, tenant, active state.
3. Server-side Supabase Admin API creates the Auth user.
4. Create matching Structr profile in the same application workflow.
5. Generate or accept a strong temporary password.
6. Mark user as requiring password change.
7. On login, block normal application access until password is changed.
8. Allow administrator to activate/deactivate a user.
9. Keep privileged Supabase credentials server-side only.
10. Add audit events for create, disable, enable, role change, and forced-password-reset state.

## Data-model change

Add `profiles.must_change_password boolean not null default false`.

Optional later fields, not required for V1:

- `password_changed_at`
- `invited_at`
- `disabled_at`

## Server architecture

Create a dedicated admin user-management service/router rather than placing provisioning logic in the login path.

Provisioning sequence:

1. Verify caller is authenticated Structr admin.
2. Validate tenant and role.
3. Create Supabase Auth user using server-side privileged credentials.
4. Insert Structr profile using returned `auth.users.id` as `external_open_id`.
5. Set `must_change_password = true`.
6. If profile creation fails, compensate by deleting the newly created Supabase Auth user.
7. Return only non-sensitive user/profile metadata.

## First-login enforcement

After authentication and profile mapping:

- if `is_active = false`, deny access;
- if `must_change_password = true`, allow only the password-change flow and minimal auth/session endpoints;
- after a successful password update, clear `must_change_password` server-side;
- then allow normal dashboard access.

## Security constraints

- Never expose service-role/secret credentials to the browser.
- Never store plaintext temporary passwords in Postgres.
- Never log temporary passwords.
- Do not auto-create tenants or profiles during login.
- Preserve fail-closed behavior for missing profile, inactive profile, invalid tenant, or invalid role.
- Do not edit `auth.users` directly with SQL.

## Delivery order

1. Schema migration and Drizzle model.
2. Server-side Supabase admin client/service.
3. Admin user-management router with authorization.
4. Users UI.
5. Forced-password-change route and gate.
6. Tests.
7. Manual local validation.
8. PR review and merge.
