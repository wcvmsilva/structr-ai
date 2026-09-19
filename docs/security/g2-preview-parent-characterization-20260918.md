# G2 preview parent characterization — 2026-09-18

Continuation Unit C, base `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`, branch
`codex/munder-followups-20260918`. This records current behavior requested by the
[G2 reconciliation](g2-family-reconciliation-2026-09-17.md). It changes no production
code, shared access guard, authorization policy or catalog behavior.

## Measured outcomes

The caller is an active tenant A user who owns the project. Request context and
profile both carry A. The rule reader supplies one valid synthetic tenant A rule;
draft content and guard fixtures use consistent IDs/tenant values. “Accepted” below
means the real resolver returned the expected assembly swap with quantity **2** and
the exact supplied rule ID, after the real access guards ran. It does not mean the
authorization policy is secure, approved or closed.

| Draft / project | `TENANT_STRICT=false` | `TENANT_STRICT=true` | Interpretation |
|---|---|---|---|
| Own draft / own active project | Accepted | Accepted | Positive control |
| Foreign-tenant draft / own active project | Accepted | Accepted | **Current acceptance; unresolved policy** |
| NULL-tenant draft / own active project | Accepted | Accepted | **Current acceptance; unresolved policy** |
| Own draft / own deleted project | Accepted | Accepted | **Current acceptance; unresolved policy** |
| Own draft / NULL-tenant project | Accepted | `FORBIDDEN` | **Strict-off current acceptance; unresolved policy** |
| Own draft / foreign-tenant project | `FORBIDDEN` | `FORBIDDEN` | Negative tenant control |
| Missing draft | `NOT_FOUND` | `NOT_FOUND` | Stops before project/content reads |
| Missing project | `NOT_FOUND` | `NOT_FOUND` | Stops before profile/content reads |

All sixteen cases passed in `unit-c-characterization-green.log/json`: nine accepted
resolutions and seven denials, including four missing-parent controls. The predicted
foreign-draft/deleted-project/NULL-project/foreign-project outcomes were reproduced.
No production adjustment was made to match the expectations. Future policy fixes
may intentionally change these characterization assertions.

## What was exercised

[The test](../../server/tenant-g2-preview-parent-characterization.test.ts) keeps the
real tRPC router, authentication/tenant middleware,
[`requireEntityAccess` and `requireProjectAccess`](../../server/project-access.ts),
[`assertSameTenant`](../../server/tenant-scope.ts) and
[override engine](../../shared/geo-override-engine.ts).

Only DB acquisition, role-based access control (RBAC) permission response,
downstream draft/item/catalog/rule readers and mutation/audit sinks are substituted.
The instrumented lookup double selects by **primary key only**, returns foreign,
NULL-tenant and deleted rows unchanged, and never silently applies ownership or
deletion filters. Assertions compare actual lookup rows with the configured rows.
The guard's draft and downstream content draft have identical tenant and project
fields, including the permissive cases.

Successful cases assert the real resolved swap, original/replacement/rule identity,
quantity, engine statistics, exactly one tenant A rule read, exact draft/catalog
inputs, and this complete order:

```text
guard:scope_drafts → guard:projects → guard:profiles
→ content:draft → content:items → catalog:assemblies → rules
```

Rejected cases assert the exact error code and no downstream content, catalog or
rule reads. Every case asserts no DB mutation/transaction, override-log write or
audit, and the scenario rows remain unchanged. The RBAC fallback is not reached
in these owner fixtures; this unit does not characterize other membership/role paths.

The observed behavior is consistent with current source: the draft guard resolves
its `projectId` without testing the draft tenant; the project guard fetches but does
not reject `deletedAt`; `assertSameTenant` admits NULL-owned projects only while
strict mode is off. This measurement does not add the historical-log helpers'
separate local parent policy to preview.

## Execution evidence and limits

Raw logs and exact command/cwd/time/exit metadata are in ignored
`tmp/munder-followups/`. Runs use:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1 GIT_OPTIONAL_LOCKS=0 \
  node tmp/munder-followups/run-vitest.mjs jsx-focal \
  server/tenant-g2-preview-parent-characterization.test.ts
```

The first `unit-c-characterization.log/json` run had nine test-infrastructure
failures and seven passes: installed Vitest 2.1.9 does not support
`toHaveBeenCalledExactlyOnceWith`. It was replaced with the equivalent supported
call-count plus argument assertions; a promise assertion was explicitly awaited.
This was a test fixture correction, **not** an application RED or a policy fix.
The subsequent `unit-c-characterization-green.log/json` run passed all sixteen.

No database was contacted for this characterization. It does not prove PostgreSQL,
foreign keys, row-level security, catalog visibility, browser behavior or production
data state. The optional Unit A owned-cluster proof remains unexecuted after its
sandbox `shmget` denial; it was not retried. The original Vitest configuration-file
loader issue also remains unresolved: all runs use the authorized `config:false`
API runner, with automatic JSX mirrored from the minimal Unit B config addition.
They are not literal `pnpm test` results.

## Continuation validation and review

All final runtime/type checks followed the final code/test edits; subsequent
documentation edits do not trigger duplicate test runs. Evidence records:

| Final check | Actual result | Evidence files in `tmp/munder-followups/` |
|---|---|---|
| Dedicated tests, ES2022, no emit/incremental, `exclude:[]` | Exit 0, no diagnostics | `final-test-types.log/json`, frozen `test-tsconfig.json` |
| `pnpm check --incremental false` | Exit 0, no diagnostics | `final-app-types.log/json` |
| Authorized `jsx-focal` runner, all changed/new test files plus Sprint 16 | 289 passed, 3 skipped, 0 failures; 7 files passed/1 skipped | `final-focal.log/json` |
| Authorized `jsx-full` runner, four max/one min workers | 3044 passed, 343 skipped, 0 failures; 78 files passed/10 skipped | `final-full.log/json`, `final-runtime-summary.json` |
| `git diff --check` | Exit 0 | `final-diff-check.log/json` |
| Separate new-file `git diff --no-index --check -- /dev/null <file>` | No whitespace diagnostics; exit 1 means the new file differs | `final-new-files-whitespace.json` |

The continuation adds **72 executed cases** (A: 34, B: 22, C: 16) and three prepared
PostgreSQL cases that remain gated/unexecuted. The full suite's 343 skips comprise
the 340 pre-existing skips and those three new lab cases. Zero failures applies to
the executed regular regression; it does not erase the separate blocked lab setup
attempt or claim coverage of skipped tests. No full pre-change regression was rerun
in this continuation: its actual pre-change focal baseline was 162 passes.

The final candidate preserves accepted A/B code/tests, all three inherited hashes,
base/branch, the original RED snapshots and the B1/B2 evidence-packaging history.
It contains fourteen continuation files (eight created, six modified), separate
continuation/combined patches and per-file/evidence hashes. There are no new tables,
engines or endpoints. The added public helper is `seedOverrideRulesForTenant`; the
existing seed endpoint retains authenticated tenant/admin middleware and audit
logging with the documented post-commit limit.

Unit A/A1 and Unit B/B2 already received bounded independent acceptance. Unit C and
final continuation review are pending at this candidate snapshot; the final report
must bind any later verdict to its actual immutable hashes.

This closes only the requested measurement. Deciding whether/how to reject foreign
or NULL-owned drafts, deleted projects or transitional NULL-owned projects requires
a separately approved policy unit. No G2-wide security closure, G4a/catalog decision,
G4b-1 NO-GO/STOP reversal, migration-history repair, M00 resolution, deployment or
live operational readiness is claimed.


## Publicação reconciliada

A evidência histórica local permanece preservada. Consulte a [reconciliação de 18/09](../engineering/progress-reconciliation-2026-09-18.md) para a disposição posterior; este registro não encerra a política de autorização.
