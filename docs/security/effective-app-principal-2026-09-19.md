# Effective application principal — bounded compatibility remediation

Base: `a7c17ed7` on the integrated PR14 candidate. This is a local, disposable PostgreSQL proof and a bounded runtime repair. It is not a production grant migration, a Supabase authentication proof, or approval for field use.

## Changed behavior

Scoped lead reads, lead activity reads/writes, pipeline reads and explicitly enabled non-production schema diagnostics no longer issue `SET LOCAL ROLE postgres`. They retain their existing tenant/owner predicates and use the connection's current grants and RLS policies. Missing permissions now fail instead of depending on membership in an administrative role.

`getLeadStats(scope)` applies the required `LeadScope` to both aggregate queries. The repository has no production consumer of the former unscoped signature; the existing helper test was updated to provide its scope. `createLead` requires a separately supplied actor and refuses to derive authentication from `data.ownerUserId`. `updateLead` uses `scope.userId` when its optional actor argument is omitted and refuses a conflicting extra actor. Normal router calls already supply this resolved actor. Test fixtures with unrelated arbitrary actor arguments were corrected; their business assertions were preserved.

`addLeadActivity` now records `lead.activity_created` through `logAudit(params, transaction)` in the same transaction as its parent authorization lookup and insert. An audit permission failure aborts the transaction, leaving no activity. The inserted row is the audit after-state; before-state is null. This adds a real requirement for audit INSERT and RETURNING privileges; absence is intentionally an error.

No endpoint, schema, tenant default, pricing policy, production grant, or live database was added or changed. Existing protected procedures and the diagnostic environment/admin gates remain in force. The transitional `TENANT_STRICT` policy was not changed; the physical tenant proof uses strict mode.

## Privilege inventory and residual boundaries

| Location | Disposition |
| --- | --- |
| `server/lead-db.ts`: common scoped transaction | Administrative role switch removed. Lead list/get/search/stats and activity operations use current principal. |
| `server/pipeline-db.ts`: common read transaction | Administrative role switch removed. Full state and overview retain tenant predicates. |
| `server/lead-router.ts`: `diagSchema` | Administrative role switch removed, including the explicitly enabled non-production branch. |
| `server/lead-db.ts`: legacy writer context | `authenticated` role and locally constructed JWT claims remain. Explicit actor absence/disagreement fails before database work. |
| `server/pipeline-db.ts`: legacy conversion/win writer context | `authenticated` role and locally constructed JWT claims remain unchanged. |
| `scripts/diag-schema.mjs` | Standalone operator script still contains an explicit postgres-role insert diagnostic. It was neither invoked nor changed and is not application runtime. |
| `scripts/diag-triggers.mjs` | Standalone authenticated-role diagnostic remains unexecuted. |

The legacy writer code sets `sub` to an internal profile ID. Neither matching UUID shape nor a persisted profile proves equivalence to a verified Supabase subject. This patch does not fabricate that binding or grant the application membership in `authenticated`. In the owned laboratory, create, update and legacy pipeline conversion each fail with PostgreSQL `42501: permission denied to set role "authenticated"`, without a privileged retry. These passing negative tests document a **remaining compatibility blocker**, not successful commercial writes.

Lead create/update's pre-existing audit gap, disqualification's separate transactions and legacy pipeline best-effort auditing are not closed by the activity-specific durable audit. No complete lead-to-deal transaction, global TOCTOU closure, signed tenant transaction binding (G4b), production RLS equivalence, effective production principal, or whole-application least-privilege result is claimed.

## Owned PostgreSQL experiment

`server/test-support/app-principal-postgres.ts` creates a fresh PostgreSQL 17 cluster under a private temporary directory. It rejects inherited database configuration, accepts no external URL or existing data directory, opens only a private Unix socket, and checks the nonce, data directory, socket, database and current/session roles before fixture DDL. It starts with a sanitized subprocess environment. Only the bootstrap observer owns schema objects; the actual application helpers use the separate `app_runtime` connection. No real identities or data are loaded.

The lab role has `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, no memberships and no owned public tables. The helper checks these attributes in PostgreSQL. A separately created role named `postgres` and the bootstrap owner cannot be assumed by this login. Another unprivileged login has no table grants.

The test-local grants are deliberately limited to the exercised operation set:

```sql
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT ON public.leads, public.lead_activities, public.deals,
  public.projects, public.profiles TO app_runtime;
GRANT INSERT, SELECT ON public.lead_activities, public.audit_logs TO app_runtime;
```

SELECT on audit rows supports the existing audit `INSERT ... RETURNING` behavior. This is a **lab recipe for these helpers**, not a deployment script or a full application ACL design. No ownership, role membership, grant option, UPDATE, DELETE, schema CREATE, or blanket table grant is needed. Attempts to assume administrative roles, create tables, delete leads, update profiles and delegate table privileges are refused or demonstrably ineffective. PostgreSQL can emit a warning for an ineffective GRANT; the test checks the recipient's actual privileges and denied SELECT instead of assuming an exception.

Fixture DDL uses the current Drizzle physical columns for six tables, UUID primary keys/defaults and timestamps only. It intentionally does not replay migrations, external auth dependencies, production constraints, triggers or production policies. With RLS disabled in this model, an arbitrary SQL SELECT can see all fixture tenants: isolation here is proven by the **actual scoped helpers' SQL**, not by a claim that this connection can safely execute arbitrary tenant-supplied SQL. A separate negative enables RLS with no policy and demonstrates that the principal cannot bypass it: reads return no rows and parent-scoped activity insertion fails.

The tests execute the actual lead/pipeline helpers, transactional audit and diagnostic router. Only acquisition of the database handle is replaced with the owned Drizzle connection. They cover same-tenant and other-tenant records, owner narrowing, both aggregate queries, activity text isolation, rollback after a real revoked audit permission, unavailable table grants, effective RLS refusal and remaining writer refusal. Teardown verifies that the owned cluster directory was removed. No TCP listener or existing database is used.

## TDD and verification

Private evidence is under `tmp/reconciliation/app-principal/`; it is not part of the published source package.

- First physical RED: 13 failures / 8 passes. One failure was an incorrect expectation that PostgreSQL must throw on ineffective GRANT; it was corrected to check actual privileges. No runtime code had changed.
- Corrected physical RED: 13 failures / 8 passes. The strengthened rollback test now specifically demanded the audit-table `42501`, so a failure at the old postgres role switch could not satisfy it. Failure output proves the unwanted role dependencies before the runtime patch.
- Actor RED: 5 failures / 0 passes before the runtime patch (missing actor, owner-as-auth fallback, implicit update/qualify actor, conflicting actor).
- Physical GREEN after implementation: 21 / 21. Final physical suite: **24 / 24**, adding three explicit characterizations of the still-blocked authenticated-role writers. Both green runs verified owned-cluster cleanup.
- Focused unit/route regressions: **143 passed, 4 existing skipped, zero failures**, eight files. An intermediate run exposed three existing test fixtures with actors inconsistent with their scope; the fixtures were aligned before the passing run.
- Dedicated TypeScript including the new tests, helper and updated legacy helper tests: zero errors. The additional profile-precondition regression passed 15 / 15; final dedicated types also passed. These results are recorded in the private verification manifest.
- 29 new cases total (24 physical, 5 actor); this is a bounded security repair, not a new domain/sprint. Full integrated suite/build are the parent review's responsibility and are not claimed here.

Reproduce the physical test from a sanitized shell using the installed dependencies:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1 \
  DOTENV_CONFIG_PATH=/dev/null APP_PRINCIPAL_LAB=1 \
  node node_modules/vitest/vitest.mjs run --no-cache \
  --pool=forks --maxWorkers=1 --minWorkers=1 \
  server/app-principal-postgres.test.ts
```

Without `APP_PRINCIPAL_LAB=1`, the physical suite is explicitly skipped; a normal test run is not evidence that PostgreSQL checks ran. The harness requires the installed local PostgreSQL 17 binaries and normal sandbox approval for its disposable socket/shared memory. The default path is `/usr/local/opt/postgresql@17/bin`; no package installation or environment file is performed.

## Release disposition

This candidate removes implicit administrative-role dependencies from the enumerated scoped paths. Before using an effective least-privilege principal for the complete product, reconcile the verified auth subject/profile/tenant/trigger contract, the actual schema and production RLS/grants, writer audit/transaction gaps, and the precise pilot's remaining dependencies. Do not restore a postgres-role fallback or grant elevated membership to make this laboratory green. No readiness gate is promoted by this report.
