# Coastal override seed: atomic business persistence

Date: 2026-09-18. Continuation base: `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`.
Branch: `codex/munder-followups-20260918`. This is focused follow-up Unit A,
authorized by the separate continuation mission; it is not a new domain/sprint.
The three inherited maintenance artifacts remain byte-identical.

## Defect and approved design

The existing `seedCoastalRules` endpoint discovered rules outside a transaction,
then called `createOverrideRule` once per seed entry. Each call committed separately.
A later failure could leave an incomplete business batch persisted.

[Persistence](../../server/geo-override-db.ts) now uses the existing wrapper/private
transaction primitive pattern from `geo-db.ts`. `createOverrideRuleInTx` performs
only the verified insert/readback. The existing single-create wrapper retains
its whitelist, tenant guard, one transaction and separate post-commit audit.

The new `seedOverrideRulesForTenant(tenantId, readonly rules, operatorId)` validates
and normalizes tenant authority before acquisition. One transaction contains strict
tenant discovery, sequential inserts and verified readbacks. Any own existing rule,
including inactive/manual/partial rules, skips with its exact count. Foreign and
NULL-owned rules neither block the seed nor change. Discovery errors retain the
sanitized `Geographic override rules are unavailable` message; write/readback/commit
failures escape their own stage. The transaction result is discriminated:
`{seeded:false, existingCount}` or `{seeded:true, inserted}`.

The [existing endpoint](../../server/geo-override-router.ts) delegates the mapped
batch, trusted context tenant and operator. Its `adminTenantProcedure`, exact public
success/skip messages, seed summary and final `geo_override.seed_coastal_rules`
audit remain. There is no parallel endpoint, schema/migration, lock, catalog change,
new seed manifest or change to `server/seed.ts`/`audit.ts`.

## Behavioral RED and GREEN

Evidence lives in ignored `tmp/munder-followups/`, with command/cwd/time/exit metadata
beside every log. All ordinary runs use exactly:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1 GIT_OPTIONAL_LOCKS=0
```

Append `node tmp/munder-followups/run-vitest.mjs focal <files>` for focal tests.
The authorized runner uses `startVitest` with `config:false`, root/aliases/include
globs/node environment preserved, fork pool, one focal worker (four for full runs).
This bypasses the previously observed unresolved config-loader hang. Results are
not a claim that literal `pnpm test` against the original loader passed.

- `baseline-focal.log/json`: 162 passed, three matched suites, zero failures before
  production edits. The command also included `tenant-g2-rule-reads.test.ts`, which
  does not exist; it supplied no additional coverage. Actual suites were
  `tenant-g2-1-override-crud`, `tenant-g2-rule-read-callers`, `sprint16-geo-override`.
- `unit-a-red.log/json`: one actual failure against the original endpoint and
  actual helpers. Only DB acquisition, audit sink and valid synthetic seed data
  were mocked. The second insertion was reached and threw; expected confirmed
  state contained the two initial foreign/NULL rows, but actual state also contained
  the first own rule. Failure was at the state equality assertion, not an import,
  missing export, invalid UUID or unused fault. Original production files and this
  first test are preserved with hashes in `unit-a-red-source/`.
- `unit-a-green.log/json`: 196 passed, four suites, zero failures. The new
  [real-route/helper suite](../../server/tenant-g2-seed-batch.test.ts) has 34 cases.
  It covers handle identity/order, strict discovery in both tenant modes, later
  insertion/readback/verification/commit rollback, existing-rule skip counts,
  discovery failures, authorization before effects, exact public results, trusted
  tenant/field filtering, audit sequencing/null/throw behavior and single-create
  compatibility. The model publishes its transaction snapshot only on success.
- Existing caller tests now measure batch delegation/context/result translation.
  They do not claim SQL discovery from a mocked seed collaborator. Bootstrap tests
  remain separate and still use their original list/create boundaries.
- `unit-a-test-types.log/json`: explicit temporary test-tsconfig includes all four
  changed/new test files, extends the repository config, `exclude:[]`, ES2022,
  `incremental:false`, `noEmit:true`; exit 0. Application typecheck is recorded in
  `unit-a-app-types.log/json`. Final focal/full regression is required after the
  continuation's final code changes, rather than repeated for each documentation
  or review step.

## Optional PostgreSQL proof: prepared, not executed successfully

[Three opt-in cases](../../server/tenant-g2-seed-batch-postgres.test.ts) reuse the
unchanged `server/test-support/g2-1-postgres.ts` harness. They prepare valid synthetic
rules, a synthetic second-insert constraint failure, an independent observer,
whole-batch audit visibility and an inactive-rule skip. They omit external foreign
keys (FKs) and row-level security (RLS), as the existing harness documents.

`unit-a-postgres.log/json` records one bounded attempt with the same sanitized
environment plus `G2_1_POSTGRES=1`, filtering only the new lab suite. `initdb` failed:

```text
FATAL: could not create shared memory segment: Operation not permitted
DETAIL: Failed system call was shmget(key=250437606, size=56, 03600).
```

The suite failed during setup; all three cases were unexecuted. This is a proof
limitation, not a test PASS and not an observed application regression. The owned
`/private/tmp/structr-g2point-pg-szkthX` directory was removed; absence is recorded in
`unit-a-postgres-cleanup.json`. No retry, sandbox widening, installation, inherited
database configuration or existing database was used. Ordinary regression leaves
all database opt-ins disabled. The prepared lab's runtime assertions remain unverified.

## Audit and remaining limits

The business batch is atomic within one invocation. Per-row `geo_override.create`
audits run in order only after all business rows commit, followed by the endpoint's
summary audit. Skip/rollback emits none. Null audit results remain tolerated.
An unexpected audit throw rejects the request **after the entire batch committed**;
it does not roll business rows back. A per-row throw prevents the final success
audit. Separate audit persistence/durability is unchanged.

Transactions alone do not establish mutual exclusion between simultaneous seeds.
The broad existing skip policy is preserved; no retry/idempotence/concurrency policy
was invented. Operational seed placeholders such as `"101"`/`"201"` were not repaired.
The stateful model proves application transaction usage, not PostgreSQL/FK/RLS,
catalog ownership, production readiness or operational seed validity. G4a, G4b-1
NO-GO/STOP, migration-history FAIL and M00 decisions remain outside this unit.

## Independent review

Jim accepted frozen candidate A1 without corrective findings in message
`2026-09-18T15-34-52-830Z-80e3fa`. Michael independently verified all seven live file
hashes, all three inherited hashes and both frozen patch hashes, then authorized
Unit B in `2026-09-18T15-35-51-376Z-8b46ee`. The original A1 snapshot, source/tests,
evidence and patches remain unchanged. Acceptance is bounded to the application
transaction evidence: the PostgreSQL lab and the FK/RLS/catalog limits above remain
unproven. Final continuation regression is still due after final code changes.
Acceptance of later units must not be inferred from this Unit A verdict.


## Publicação reconciliada

Este registro preserva a evidência e os limites da unidade original. Caminhos de logs e missões marcados como locais não integram o repositório público; os originais e seus hashes permanecem no arquivo privado. O estado de integração posterior é registrado em [reconciliação de 18/09](progress-reconciliation-2026-09-18.md).
