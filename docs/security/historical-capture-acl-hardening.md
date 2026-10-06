# Historical capture — ACL and TRUNCATE hardening

Migration `0006_historical_estimate_acl_hardening.sql` follows H1 migration 0005 without changing that file or its hash. This is a bounded integrity correction for the four historical evidence tables. It does not enable historical estimates for commercial approval, exports or field work.

## Problem and resulting behavior

PostgreSQL row security does not cover TRUNCATE. The H1 row-level UPDATE/DELETE triggers and deferred INSERT completeness checks also do not run for TRUNCATE. A creator's default ACL can give an ordinary API role that privilege even when the migration contains no GRANT statement. The leaf selection table can then be emptied while its parent still declares a complete selection.

The correction adds a BEFORE TRUNCATE statement trigger to each historical table. All four reuse the existing exception-only, SECURITY INVOKER function, whose message now covers row changes and truncation. The stable SQLSTATE is `23514`, with constraint name `historical_estimate_immutable`. Existing row immutability, contextual foreign keys, completeness checks and default-deny RLS remain in place.

The migration also removes all table privileges from PUBLIC and from `anon`/`authenticated` if those roles exist, only on these four tables. It creates no roles, grants, policies or memberships, and changes no creator defaults or unrelated table ACLs. A PostgreSQL installation without those provider roles does not need to create them.

After the REVOKE, it checks effective table and column privileges for each known API role and every role it may assume with SET ROLE. The PostgreSQL 17 fixture confirms that REVOKE ALL on the table also removes a direct column grant to that recipient. Privileges held by a different reachable role remain: an inherited table grant or a column-only grant through such a role raises `23514` / `historical_estimate_api_acl`. The migration refuses the deployment instead of rewriting the role graph or silently claiming that direct REVOKE removed all access. An unknown application principal is not covered by naming these two API roles; it remains a separate release gate.

The migration is designed for transactional execution and rerun. It is not a rollback script. Returning to an earlier application build must not remove the guards, restore destructive grants or erase historical evidence.

## Verification and reproducibility

`server/historical-estimate-acl-hardening.test.ts` is an opt-in physical suite. It accepts only a dedicated `H1_ACL_CONFIG`, not DATABASE_URL. The runner must first provision the owned socket-only PostgreSQL laboratory, with a separate `h1_acl_test` database, private directory, sentinel and actual non-owner API connections. The test verifies the server/database identity and the roles' absence of superuser, BYPASSRLS, ownership and elevated membership before any fixture mutation.

The baseline is the exact 0005 applied after reproducing the observed table-default grants in the fixture. Fixtures contain synthetic complete sources/selections for two additional tenants per run. This models the relevant ACL mechanism; it does not identify or certify the production application principal.

The focused cases verify:

- ordinary roles lose effective table access and cannot truncate the leaf table;
- the statement triggers reject each table, multi-table TRUNCATE and CASCADE, even after a fixture-only TRUNCATE grant;
- all four statement guards are active, BEFORE/TRUNCATE rather than row triggers, and use an invoker function;
- owner-issued accidental TRUNCATE is refused while the guards remain active;
- row immutability and RLS denial still hold, and evidence hashes/counts remain unchanged;
- unrelated table ACLs and creator defaults remain unchanged;
- rerunning 0006 preserves evidence, definitions and effective denial;
- PUBLIC and direct API column grants are removed, while inherited, assumable and column-only residual grants through another role stop the migration;
- a failed migration attempt rolls back its trigger/ACL changes, and temporary fixture roles/memberships are rolled back.

All destructive attempts are executed inside transactions that are rolled back even when the unprotected baseline succeeds. Temporary column grants and memberships remain inside uncommitted fixture transactions. The extra TRUNCATE/SELECT grants used to exercise the independent trigger/RLS barriers are restored after each case. These are laboratory-only operations.

Focused command, after the authorized runner supplies the configuration:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1 \
  H1_ACL_CONFIG=/absolute/path/to/owned-fixture-config.json \
  node node_modules/vitest/vitest.mjs run --no-cache \
  --pool=forks --maxWorkers=1 --minWorkers=1 \
  server/historical-estimate-acl-hardening.test.ts \
  server/migration-history-reconcile.test.ts
```

Without H1_ACL_CONFIG, the physical suite is skipped. A normal CI run without the fixture is not evidence that PostgreSQL checks ran. The supplied laboratory uses PostgreSQL 17; the target version must support the exercised privilege set, including MAINTAIN and SET-role membership semantics. Do not omit an unsupported privilege check merely to make another version pass.

The separate test TypeScript check includes test files explicitly because the application tsconfig excludes `*.test.ts`. Full application checks and final CI must be recorded against the integrated candidate SHA; the focused result alone is not a complete release certificate.

## Mandatory release preflight

1. Preserve the hash and prior evidence of 0005. Reconcile the actual destination ledger and schema before executing any migration; the new journal entry is not proof of prior execution. Do not repair a mismatch by fabricating ledger rows or replaying older migrations on inference. Schema generation alone does not install these custom triggers and ACL checks; use the reviewed versioned migration artifact.
2. Apply 0005 and 0006 transactionally before historical capture becomes accessible, or keep the environment isolated until all post-checks succeed. Existing failed ACL preflight must abort the entire rollout unit; do not catch and ignore `historical_estimate_api_acl`.
3. Record the actual creating and runtime roles. Check effective table **and column** privileges, memberships and roles assumable via SET, as well as schema access, ownership, superuser and BYPASSRLS. Include the real runtime and API/proxy principals, not only the two known role names. Missing or unknown principal identity blocks release. No administrative membership or privileged fallback may be granted to make the checks pass.
4. Inspect all four statement triggers, the invoker function, FKs, deferred completeness checks, RLS and policies after migration and restore. Verify ordinary-role denial in the approved isolated environment; owner queries alone do not prove it.
5. Confirm backup coverage and rehearse recovery on a separate approved target. Preserve the historical tables and guards when rolling the application back. A database backup does not establish coverage of external file objects.
6. Capture the exact new candidate SHA, migration hashes, focused physical evidence, application checks and CI. Publication of source and a green CI status do not authorize production activation or real field data.

Owner/admin accounts that can disable triggers, replace functions or alter schema remain capable of bypassing DDL safeguards. The owner test covers accidental use with guards active; no administrator-resistant immutability is claimed. Grants alone do not establish PostgREST or public HTTP exposure, and this work does not claim that an external attack occurred.

## Recorded local result — 2026-09-19

The isolated PostgreSQL 17.11 run passed 25 physical ACL/immutability cases and 40 migration-identity cases (65 total, zero failures). A final run of the frozen SQL passed all 25 physical cases again. The explicit TypeScript check for the new test files also passed. RED logs demonstrate the original TRUNCATE behavior and the residual column grant reachable through another role before correction.

Migration 0005 remains SHA-256 `1741d20d6b9aca3e90e447f9fb8023337a86038ac2cd05271a5fe35f316c5015`; migration 0006 is `a3cdb624b5c268e2180062b1daa6b30a3d470531e00fa477a779e65e57583411`. These local results do not stand in for CI on the new commit, runtime-principal verification, destination-ledger reconciliation, or a production restore rehearsal. No real-data migration was performed.
