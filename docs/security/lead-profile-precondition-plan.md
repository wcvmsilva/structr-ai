# Lead profile precondition — authorized execution plan

Base: 622e6afb9591c8b118c8661e5695f9870e26a53b. Authorized 2026-09-15 following `/private/tmp/structr-identity-contract-20260915/contrato-identidade-provisionamento.md` §§7–8.

## Scope and interfaces

Claim: lead.create cannot create/promote a profile and cannot continue after its profile precondition fails. Require persisted active profile matching trusted actor ID and tenant before duplicate reads or lead insertion. No global TOCTOU, commercial atomicity, audit compliance or production-remediation claim.

Allowed production files: server/lead-db.ts and server/lead-router.ts. Replace ensureProfileExists writer with `requireExistingLeadProfile(userId: string, tenantId: string): Promise<void>`. No profile mutation, default tenant or caller-controlled authority. Error contract: exported `LeadProfileError` with readonly code `PROFILE_NOT_ALLOWED` or `DB_UNAVAILABLE`; error messages are safe constants. Query exact internal ID and validate its non-null tenant equals expected tenant and isActive is true. Use a read only DB query, no postgres role switch. Missing DB/query errors fail closed. Route maps PROFILE_NOT_ALLOWED to FORBIDDEN; every other precondition failure to sanitized INTERNAL_SERVER_ERROR, without raw SQL/cause. Input/missing user/tenant retain existing gates. Use scope.userId/scope.tenantId from resolveLeadScope as trusted arguments. Do not modify unrelated duplicate/insert error handling or business algorithms.

Production code changes only AFTER observed security-specific RED. Before implementation, tests call stable lead.create; no missing new export may count as RED.

Allowed test files: new server/lead-profile-precondition.test.ts, new server/lead-profile-precondition-postgres.test.ts, existing server/sprint24-lead-router.test.ts (explicit mock of precondition and provisioned context). Exactly copied helpers server/test-support/profile-acl-postgres.ts, profile-acl-fixture.ts, profile-acl-treatment.ts from prior lab are fixed by hashes in fixture-provenance.json. Do not modify their schema, ACL, guard or lifecycle.

Evidence/docs: this plan, docs/security/lead-profile-precondition-evidence.md, and `.superpowers/sdd/lead-profile-precondition/` artifacts. No package/lockfile/schema/migration or other source edits. No commits, push, merge, deploy, Supabase, Auth, network DB, real users, backfill or Data API activation. Existing PostgreSQL 17.11 and node_modules reused, no install.

## Tasks

1. Recover base/local/remote/PR state; create isolated checkout; verify copied-fixture hashes; baseline types and full tests.
2. Write route behavioral tests (agent) and real PostgreSQL proof (root). Keep actual route/real profile helper; only business duplicate/read/write boundary doubles, DB acquisition and dotenv replaced as appropriate. Baseline and candidate use same owned postgres connection and same applied ACL treatment. Real roles/FK/RLS/profile writes are in scope, commercial lead inserts are observable doubles. Preserve RED logs, source hashes and independent before/after profile rows. Do not port prior lab's expected admin-creation characterization as a passing candidate test.
3. After RED root implements only two production files; agent adjusts existing Sprint24 mock/context after baseline. Run targeted GREEN, query/helper edge cases, same-input state proof and preserved resolver/ACL controls.
4. Independent read-only review of final diff including untracked helpers/tests. Fix required findings, verify relevant cases. Run final types including test-specific tsconfig, full suite and static tenant audit. Evidence/impact matrix, manifest and clean original-state proof. No gate/capability promotion; PR9 remains NO-GO and G2 open.

## Fixed commands

All commands prefixed `env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1`, output to this unit's evidence directory:

- `pnpm check --incremental false`
- `pnpm test --pool=forks --maxWorkers=4 --minWorkers=1`
- `pnpm exec vitest run server/lead-profile-precondition.test.ts server/sprint24-lead-router.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`
- Add `PROFILE_ACL_LAB=1`: `pnpm exec vitest run server/lead-profile-precondition-postgres.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`
- `pnpm exec tsc --project .superpowers/sdd/lead-profile-precondition/test-tsconfig.json` (include both new tests, existing changed test and copied helpers; exclude=[]; incremental=false)
- `pnpm audit:tenant`; if tsx launcher IPC denied, disclose failure and run the same script with `node --import tsx scripts/tenant-coverage-audit.ts`.

Unix-socket PostgreSQL needs approved sandbox escalation for shared memory, already within approved isolated laboratory scope. All Git reads use GIT_OPTIONAL_LOCKS=0. No fresh remote DB queries.

## Required cases

- Existing active ordinary/admin profiles: route proceeds, owner and tenant derive from trusted context, all profile fields unchanged.
- Missing profile/unprovisioned Auth and synthetic dev actor: denies, zero profile creation/elevation and no duplicate/read/write business helper call.
- Inactive, NULL tenant, other tenant, mismatched trusted tenant: denies without modifications.
- Missing user/tenant: existing route rejects before profile/business access.
- Missing DB/DB read failure: safe internal failure, no continued business call, no raw SQL/credential details returned.
- Payload spoof of role/tenant/actor: stripped/ignored by existing schema; trusted context used.
- Duplicate conflict remains for authorized actor; profile check precedes duplicate helper.
- No regressions to normal profile resolver, native own-profile SELECT and ACL revocation; no new tests assert whole login/lead conversion.
- Retained residuals: OAuth, upsertUser, rbac.assignRole, Auth triggers, createLead no-actor fallback, other bypassRLS paths, audit/TOCTOU, main object/integration divergence.
