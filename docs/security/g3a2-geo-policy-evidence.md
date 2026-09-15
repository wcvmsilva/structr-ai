# G3a-2 — geo policy isolation: local pre-commit evidence

Repository: https://github.com/wcvmsilva/structr-ai

This is a local, pre-commit delivery record. It does not declare the security unit
formally closed, create a post-commit SHA, publish the branch, authorize PR #9, or
change canonical classifications. Final whole-diff review is recorded below when
complete. The human authorization was “otimo” after presentation of the detailed
implementation plan in this session.

## Anchors and scope

- Compared base / current HEAD: **bcb50d3e9355256c1beef28190f24c4612f903ce**.
- Candidate: /private/tmp/structr-g3a2-20260914, branch
  codex/g3a2-geo-policy-20260914; changes are uncommitted.
- Counterfactual: /private/tmp/structr-g3a2-baseline-20260914, detached at the
  same base; only the six new proof/support files are overlaid.
- F5b remains at /private/tmp/structr-f5b-20260914 on bcb50d3e. Its previously
  reviewed commit and historical pre-commit evidence were not rewritten.
- Plan: /private/tmp/structr-g3a2-planning-20260914/docs/superpowers/plans/2026-09-14-g3a2-geo-policy-isolation.md.
- Approved design: /private/tmp/structr-g3a2-recovery-20260914.md.
- Execution ledger, raw logs, reports, reviews and manifests:
  /private/tmp/structr-g3a2-execution-20260914/.
- Local verification date: 2026-09-14. Observation timestamps remain in the raw logs.
  Final package observation time and manifest are recorded with final review.

Remote observations from the preceding recovery, not refreshed by this execution:
main 8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf; workflow
f60cf9a56679d4d7083b2c11ac4e2727d53d84c3; security / PR #9 head
b95ea0bf4741646f418fcc99a22d22a42d24be51. The main object remains absent
from the local repository; product documents were read remotely at that exact SHA.
No fetch or pull was performed. The previously reported main/PR-base metadata
discrepancy is not resolved by this local work and cannot select an integration base.

Authority remains separate by lineage:

- [Workflow §§6.2–6.6](https://github.com/wcvmsilva/structr-ai/blob/f60cf9a56679d4d7083b2c11ac4e2727d53d84c3/docs/superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md).
- [Security Gate](https://github.com/wcvmsilva/structr-ai/blob/f60cf9a56679d4d7083b2c11ac4e2727d53d84c3/docs/engineering/security-gate.md).
- [Canonical registry](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/docs/product/canonical-structr-truth-v1.md).
- [Feature evidence maintenance](https://github.com/wcvmsilva/structr-ai/blob/8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf/docs/product/feature-evidence-maintenance.md).

Task 6 and documentary publication through PRs #12/#13 remain completed. This
record does not copy those documents into the security lineage or reopen F5b.

## Observable change

Before this change, the price target reader selected geo_zones by ID without
tenant, apply/rollback updated a referenced zone by ID, and the latent calibration
writer updated observational fields by ID. Owning an adjustment did not establish
ownership of its referenced commercial policy. Zero-row or altered writes could
still leave a successful adjustment transition.

The price reader now uses geoZoneTenantWhere with the trusted caller tenant and
checks returned-row ownership. Geo apply/rollback use READ COMMITTED transactions
and lock adjustment then zone. They recompute from the current locked adjustment
and authorized zone, require one returned row from both writes, and confirm both
persisted rows after both writes using column-encoded SQL comparisons. The result
and snapshot come from that transaction. Rollback validates target identity/type
and a finite previous factor and verifies restoration before commit.

The other target types preserve their serial calculations and writes. Their final
adjustment transition gains the approved conditional guard against stale status,
type or target identity. A failed guard rolls back their existing transaction.
The two-stage PA-005 behavior is preserved, including the known broad second
lookup; in geo apply both stages use the same transaction after the zone lock.

Calibration changes only its final geo UPDATE predicate. The writer still changes
validatedFloorPct, validatedAt and validationSampleCount on a best-effort basis
per finding. It does not change the configured commercial floor. Reports/events
and their authorized audit may still succeed when a zone update is skipped.
The normal producer still emits null geoZoneId/geoZoneName; it was not activated.

Rejected individual geo proposals/apply/rollback do not persist a new snapshot,
change the zone, advance status or emit the corresponding success audit.
proposeFromFindings retains its mixed result contract for other authorized items.

## Files and interfaces

Production behavior:

- server/price-adjustment-db.ts.
- server/calibration-db.ts.

Comment-only correction:

- server/tenant-coverage-audit.ts: the old claim that the G3a-2 branches remain
  unscoped is superseded by this bounded correction. The scanner's symbol-based
  blind spot and excluded table/file coverage are explicitly retained.

New proofs:

- server/tenant-g3a2-price-geo.test.ts — 72 cases.
- server/tenant-g3a2-calibration-geo.test.ts — 12 cases.
- server/tenant-g3a2-callers.test.ts — 39 cases.
- server/tenant-g3a2-price-geo-postgres.test.ts — 36 opt-in cases.
- server/tenant-g3a2-calibration-geo-postgres.test.ts — 9 opt-in cases.
- server/test-support/g3a2-postgres.ts — owned disposable cluster only.

This record is the tenth file in the approved allowance (including the optional
scanner comment). No production table, engine, endpoint, router, migration,
configuration, dependency or front-end change was introduced.

Private price helpers added: loadGeoTargetState, hasLiveAdjustmentInDb,
loadLockedGeoAdjustment, adjustmentFieldsMatch, geoAdjustmentWhere,
confirmGeoAdjustment, confirmGeoWrite, observedAdjustmentWhere,
applyGeoAdjustment, rollbackValues, rollbackGeoAdjustment. Public signatures and
return contracts are unchanged. Existing audit actions are retained; none added.

Caller trace: propose → proposeAdjustment → loadTargetState; proposeFromRun →
real report lookup / inline tenant guard → proposeFromFindings; applyToPriceBook /
rollback → requireOwnAdjustment → DB helper; calibration.runTenant →
runTenantCalibration → private observational writer. previewImpact does not read
geoZones. Both routers remain mounted; no client tRPC consumer of these two
routers was found in the measured tree. analytics-db:583–584 consumes summaries.
geo-db continues mapping commercial floors into geo/estimate consumers.

## Verification results

All entries below are observed executions, not projected counts.

| Check | Observed result | Evidence |
|---|---|---|
| Clean baseline full suite, before edits | 2664 passed, 90 skipped; exit 0 | logs/baseline-full.log |
| New normal cases, candidate | 123 passed: 72 price + 12 calibration + 39 callers | owner GREEN logs and complete suite |
| Complete normal suite, candidate | 2787 passed, 135 skipped; 67 files passed, 4 skipped; exit 0 | logs/final-full.log |
| Standard application TypeScript | 0 errors; exit 0 | logs/final-check.log |
| Dedicated typing of five new test files | 0 diagnostics, target ES2022 / no emit; exit 0 | logs/new-tests-typecheck-final.log |
| Real PostgreSQL, candidate | 45 passed: 36 price + 9 calibration; exit 0 | postgres-report.md and associated GREEN logs |
| Identical normal proofs on bcb50d3e | 52 expected failures, 71 passing controls; exit 1 | logs/baseline-new-normal.log |
| Identical PostgreSQL proofs on bcb50d3e | 34 expected failures, 11 passing controls; exit 1 | postgres-report.md and baseline RED logs |
| PostgreSQL opt-out | 45 skipped, no cluster startup | logs/postgres-optout.log |
| Tenant scanner | exit 0; 44 warnings and 6 tracked gaps | logs/final-audit.log |
| Whitespace check | exit 0 | git diff --check, recorded during verification |

There are **168 new behavioral/contract cases**, 123 normal plus 45 opt-in.
The 135 skipped cases in the normal suite are the previous 90 plus the 45 new
PostgreSQL cases, which were executed separately. They are not 135 unresolved
test failures. There are no new engine tests because no engine was changed;
this security unit uses the explicitly approved distribution rather than claiming
the generic new-domain sprint distribution.

The 52 baseline normal failures consist of 48 price and 4 calibration cases;
all 39 callers pass on both trees. Of the price contrasts, 44 concern rejection,
counts or stale values, and 4 concern explicit SQL/executor/isolation contracts.
These are test cases, not 52 distinct vulnerabilities. The price report reconciles
the staged RED runs, controls and final overlay. Null/Infinity/NaN snapshot
variants are distinct inputs even where JSON-based test titles render them alike.

The PostgreSQL baseline failures are 31 price and 3 calibration contrasts.
Positive own roundtrip, existing missing-zone apply guard, real SQL/pre-commit
rollback, JSONB equivalence and calibration best-effort controls pass in both
trees. Failing imports, fixtures, timeouts or setup are not counted as RED.
Six proof/support files are compared byte-for-byte; SHA-256 values are recorded
in proof-hashes.txt and the final manifest. Baseline production remains unchanged.

## Commands and corrections during verification

Normal tests:

~~~sh
env -u DATABASE_URL -u POSTGRES_URL -u POSTGRESQL_URL -u F5B_POSTGRES -u G3A2_POSTGRES pnpm test
~~~

Focused counterfactual normal tests:

~~~sh
env -u DATABASE_URL -u POSTGRES_URL -u POSTGRESQL_URL -u F5B_POSTGRES -u G3A2_POSTGRES pnpm exec vitest run server/tenant-g3a2-price-geo.test.ts server/tenant-g3a2-calibration-geo.test.ts server/tenant-g3a2-callers.test.ts
~~~

Real PostgreSQL (same command in candidate and baseline):

~~~sh
env -u DATABASE_URL -u POSTGRES_URL -u POSTGRESQL_URL -u F5B_POSTGRES G3A2_POSTGRES=1 pnpm exec vitest run server/tenant-g3a2-price-geo-postgres.test.ts server/tenant-g3a2-calibration-geo-postgres.test.ts
~~~

TypeScript, scanner and diff:

~~~sh
env -u DATABASE_URL -u POSTGRES_URL -u POSTGRESQL_URL -u F5B_POSTGRES -u G3A2_POSTGRES pnpm check
node /private/tmp/structr-g3a2-execution-20260914/check-new-tests.cjs
env -u DATABASE_URL -u POSTGRES_URL -u POSTGRESQL_URL -u F5B_POSTGRES -u G3A2_POSTGRES pnpm audit:tenant
GIT_OPTIONAL_LOCKS=0 git diff --check
~~~

Toolchain: Node v24.14.0, pnpm 10.15.1, installed TypeScript/Vitest/Drizzle from
the existing dependency tree. No installation. Standard tsconfig excludes test
files; the additional in-memory TypeScript program checks exactly the five new
tests with ES2022, appropriate to their Node/Vitest runtime, without changing
project configuration or writing build output.

Corrections are retained as history in executor reports: an unsupported Vitest
matcher in caller controls; a Drizzle SQL error wrapped in cause; the existing
INVALID_ADJUSTMENT_TRANSITION mapping; a nonfinite engine-output guard tested by
explicit injection because unchanged round2 normalizes nonfinite arithmetic;
one incompletely typed finding fixture; four TransactionSql test declarations,
fixed with parameterized unsafe queries; and specific domain codes added to
concurrent-refusal assertions. None is counted as an independently fixed product
defect. The initial ES5 default-target typecheck complaint about test top-level
await was corrected by using the actual modern test-runtime target.

The sandbox blocked initdb shared memory and the scanner executor's local IPC.
The exact approved local operations were run with escalation after those
infrastructure failures. No external database fallback was used. Those startup
errors are not behavioral RED.

## PostgreSQL and audit limits

The closed-API harness creates only its own /private/tmp/structr-g3a2-pg-*
directory, private Unix socket and PostgreSQL 17 server, with no TCP listener.
It refuses inherited PG*/database URL configuration, uses explicit synthetic
connection settings, verifies three distinct backends and owns their cleanup.
Enabled startup/cleanup errors fail; opt-out imports do not start a cluster.

The five derived tables preserve real column types, defaults, PK and not-null;
two tenant/key unique indexes are present. Excluded foreign-key/domain topology,
deployed RLS, migrations and existing data are not represented. Tests use real
helper SQL, engines, transactions, numeric/timestamp/JSONB comparisons, triggers
and pg_blocking_pids. The baseline can finish without the missing locks so that
it fails assertions rather than satisfying a timeout.

The price unit double returns rows permissively and explicitly injects comparison
results; it is not a SQL engine. Calibration's unit double interprets the limited
emitted predicates and executes the real report/event/audit helper chain into an
in-memory store. PostgreSQL audit sinks are spies. These observations prove
calls/payload/order and modeled persistence, not durable audit-log persistence.

markEventActioned remains after commit and before price audit. Its failure can
leave a committed change without the later audit; that limitation is tested and
not represented as resolved. G3a-2 does not establish global event/audit atomicity,
approval provenance, general nongeo isolation or new percentage arithmetic rules.
No historical snapshot cleanup or re-estimation occurred.

The scanner still recognizes a tenant symbol per module rather than every SQL
branch. Its printed “Multi-tenant ready” is its structural result only. The
44 warnings and all 6 known gaps remain in the full log; PR #9 remains NO-GO and
B2 remains NOT DEFENSIBLE.

## Capability impact

All canonical dimensions retain their prior classifications and anchors. No row,
aggregate, confidence, lifecycle or roadmap status is promoted by this record.
P-09 correspondence remains insufficient. This is a bounded change review, not
a review of all 48 capabilities.

| Capability | Impact / before → after | Files and consumers | Acceptance / evidence | Reviewer and disposition |
|---|---|---|---|---|
| C-05 Service-area / geo qualification | Direct: ID-only policy access → strict tenant | Price/calibration DB; geo-db; geo consumers | Foreign/NULL controls and own behavior, real PG | Price/PG task reviewers: PASS; whole-diff pending |
| C-18 Price adjustment and margin control | Direct: possible partial success → current locked snapshot and verified transition | price-adjustment-db/router/engine | Apply/rollback, both-row triggers, concurrency and contracts | g3a2_price_review: PASS |
| C-36 Calibration | Direct latent boundary: unscoped observation → strict writer | calibration-db/router/engine | Injected writer proof plus separate real null-ID producer | g3a2_calibration_callers_review: PASS |
| P-03 Tenancy and tenant scoping | Direct bounded: trusted tenant in four SQL points | Two DB modules; geoZoneTenantWhere | Strict predicates, returned-row guards, no NULL fallback | Price/calibration/PG reviewers: PASS |
| P-06 Data access layer | Direct: success can outlive missing write → checked transactional result | Price DB; disposable harness | Real storage and rollback, fixed fixture limits | Price/PG reviewers: PASS |
| P-05 Audit and audit trail | Direct limited: no success audit for rejected individual operation | Existing audit calls in both DB modules | Rejected operation versus authorized report/items; no durable global audit claim | Task reviewers: PASS, limitations retained |
| P-02 Authorization and RBAC | Indirect: existing guards preserved | Both routers and parent lookups | 39 real-caller controls; normal user propose allowed as before | g3a2_calibration_callers_review: PASS |
| C-15 Pricing engine and price book | Direct only at concurrent final guard; serial math unchanged | Nongeo price transition, cost code/history | Guard rejection rolls back staged writes; serial controls | g3a2_price_review: PASS |
| C-16 Catalog and assembly library | Indirect through assembly adjustment target | Price target reader/transition | Serial contract, no new catalog write or isolation claim | g3a2_price_review: PASS within task boundary |
| C-14 Estimating | Indirect: authorized policy remains consumed | geo-db/geo-integration/scope-to-estimate | Static trace + unchanged regressions; no historical repricing | Author trace; whole-diff review pending |
| C-35 Analytics | Indirect: summary contracts preserved | analytics-db:583–584 | Static summary calls and regressions, no global analytics claim | Author trace; whole-diff review pending |
| P-09 Evidence and provenance substrate | Indirect bounded: new snapshot from authorized locked zone | Price target/tx/audit | Snapshot origin checked; no historical/provenance program claim | Price/PG reviewers: bounded PASS; canonical uncertainty retained |

## Reviews and delivery gates

Per-task review:

- Price: g3a2_price_review, spec/quality PASS. The typed fixture follow-up also
  passed narrow review. Reports: price-review.md, price-report.md.
- Calibration/callers: g3a2_calibration_callers_review, spec/quality PASS. An
  initial interpretation of a source-code documentation header as an HTTP-header
  requirement was withdrawn against the actual brief. Ancillary import mocks
  are documented as import isolation, not replacements for exercised guards.
- PostgreSQL proofs: g3a2_postgres_review, PASS with one minor request for named
  concurrent-refusal codes; the change and its narrow verification are recorded
  in postgres-report.md. Final disposition is appended after narrow review.
- Whole-diff independent review and final delivery manifest: pending at creation
  of this pre-commit record; no verdict is inherited from F5b.

Resulting commit SHA: not created. Exact resulting-SHA review: not yet applicable.
Publication/integration observation: none. Unit closure: pending human gate.
Do not relabel this record as post-commit evidence; record any later SHA and review
in a separate delivery observation after the commit exists.

External pending work includes G3a-3, G2's 13/15-surface discrepancy, G3b/G4b,
existing G1 obligations and data/provenance programs. Their enumeration does not
make every deferred unit a mandatory implementation for PR #9: its merge depends
on its own unresolved gates, applicable deployment preconditions and human
decision. F5b's documentary supplement/publication remains separate from its
already approved local closure. Clients UI, new plugins and Phase 3 are excluded.

Next human action after local verification/review: approve the local G3a-2
implementation commit. That approval does not authorize push, merge, external
database operations or the next security unit.

## Final local delivery observation — 2026-09-14 22:36:53 UTC

This appended observation supersedes the pending review dispositions above;
those statements describe the record at creation, before the verdict existed.
The subject remains the uncommitted candidate based on
**bcb50d3e9355256c1beef28190f24c4612f903ce**.

- PostgreSQL narrow re-review: g3a2_postgres_review, **PASS**, named error-code
  assertions addressed, no unresolved findings. Its final report reconciles
  45 candidate passes with 34 expected baseline failures and 11 controls.
- Whole-diff reviewer: /root/g3a2_final_review, **specification PASS / code quality
  PASS; 0 Critical, 0 Important, 0 Minor**. The review covered all ten files and
  the capability-impact boundary. C-05, C-14 and C-35 now have bounded whole-diff
  review PASS; the remaining rows retain their bounded task dispositions and
  were also included in that whole-diff review. No canonical status is changed.
- Review anchors: final-review.diff and final-review-manifest.json, observed
  **2026-09-14T22:33:30.798058+00:00**, in the execution directory named above.
  The reviewer independently matched all ten hashes and the six identical
  counterfactual proofs. This append is the later factual report finalization;
  its narrow review is recorded externally in final-review.md.
- These are implementation-quality reviews inside the development process.
  They do **not** replace the formal independent Codex read-only gate on the
  resulting approved commit SHA. No resulting SHA exists yet.

The final normal suite was refreshed after the last PostgreSQL test assertion
change: **2787 passed / 135 skipped, exit 0, 23.97s**,
logs/final-full-current.log. Dedicated typing was also refreshed:
**five new test roots / zero diagnostics, exit 0**,
logs/new-tests-typecheck-current.log. The standard application check and scanner
results above apply to the same unchanged production files. The latest real-PG
logs are postgres-candidate-green.log (**45/45, 4.79s**) and
postgres-baseline-red.log (**34 expected failures / 11 controls, 4.35s**).
verification-artifacts-manifest.json fingerprints the final verification files.

At **22:34:13 UTC**, main was clean at
233569d68c014712ce3d25326bda8823aab1987e with upstream origin/main; F5b
was clean at bcb50d3e9355256c1beef28190f24c4612f903ce with no upstream.
Candidate HEAD/branch remained unchanged, no upstream, empty index and exactly
the ten allowed modified/new files. The counterfactual had an unchanged tracked
tree/index and only the six proof/support files untracked. These are local
observations, not fresh remote-ref checks. Root's read-only process/directory
check at **22:34:28 UTC** found no owned PostgreSQL servers or cluster directories.
Details: final-local-state.json and final-postgres-cleanup.json.

### Reviewed implementation/proof fingerprints

These SHA-256 fingerprints identify the nine proposed implementation files;
they are file hashes, not commit SHAs. All six new proof/support files have the
same hashes in the counterfactual. No self-referential document hash is claimed.

| File | SHA-256 |
|---|---|
| server/calibration-db.ts | e979de14e7d188cf70a9240a52c096e8e8982788e241aa0a1e0a69b8bb08b862 |
| server/price-adjustment-db.ts | 8fdb563ab262ace6432bb105b6958c229009937357bef3b037f16b6879de707c |
| server/tenant-coverage-audit.ts | 02cbf97e6cd027b97320814750e17a1f82e2e7b69aa773cb3d93e05e35696b33 |
| server/tenant-g3a2-calibration-geo-postgres.test.ts | 6cc2bd24d51c21a47681c1855279921bc1762ffacc45546f9041c465d8bf08b9 |
| server/tenant-g3a2-calibration-geo.test.ts | 81c8d701b74fd30486ddf944c9cf7113942fb7cbd2b0d77c813fcf69c0ab2b14 |
| server/tenant-g3a2-callers.test.ts | 646a9f22c1c23bd66c7149bbfd3cfcc32b11214895d0289fe47a176ab029fa0f |
| server/tenant-g3a2-price-geo-postgres.test.ts | 8c58253f5ef348cdc87f8b71f656e556d03ecf146f162ef1838488bbe8ae329e |
| server/tenant-g3a2-price-geo.test.ts | 7c43aac8b2a37f619f0a055cab0e870eeeb255cb5ee6b65092cbec8d8b8607ed |
| server/test-support/g3a2-postgres.ts | 99bd3dfaac07cae6f3489050f294c372a458f27aafa13ecd86574b3370f1d34b |

### Execution decisions retained for human review

1. Keep scratch ledger/reports outside the repository and manually extract the
   Portuguese task briefs, preserving the approved file allowance. If this
   organization is rejected, reporting artifacts need relocation.
2. Use one serial owner for the shared price file, with independent calibration
   and caller tasks in parallel as the approved plan allows. If rejected, the
   task sequence may need re-review; no shared-file concurrent edits occurred.
3. Isolate the candidate in /private/tmp without changing .gitignore or creating
   another user task. If another location is required, relocate after review.
4. Preserve financial-engine arithmetic; test the nonfinite-result guard with
   explicitly injected engine output because round2 normalizes nonfinite
   arithmetic. A broader malformed-percentage guarantee requires a separate
   design and proof rather than extending this unit's claim.

The next approval concerns only the **nine code/proof files** as a local security
implementation commit. This evidence document stays under a separate
documentation commit boundary. Worktrees and execution evidence are preserved.
There is no commit, push, publication, unit closure or Phase 3 transition in this
delivery; PR #9 remains NO-GO and B2 remains NOT DEFENSIBLE.

## Post-commit independent review observation — 2026-09-15

This new delivery observation records the later implementation commit and its
independent review. It leaves the complete historical pre-commit record above
unchanged. The reviewed implementation SHA is
**bb070eb457eaacc741172162fd6100842aae0804**, sole parent
**bcb50d3e9355256c1beef28190f24c4612f903ce**.

The independent report below is reproduced verbatim from
/private/tmp/structr-g3a2-sha-review-20260915/independent-gate.md,
SHA-256 **0b521a7f4821ada2d04d352f68eb992b060101627abe83d8f3f88ea2fa06d8b1**. The coordinator prepared this
append for documentary delivery; the independent evaluator's original report
and reviewed evidence remain unchanged. Fresh execution records, complete logs,
proof classification, source responses and integrity manifests are retained in
/private/tmp/structr-g3a2-sha-review-20260915/.

This proposed documentary delivery affects only
docs/security/g3a2-geo-policy-evidence.md, in a commit separate from the nine-file
implementation commit. Its own future documentary commit SHA does not exist yet
and is not invented here. The independent GO below does not authorize this
documentary commit, publication, unit closure, PR #9 merge or Phase 3. The human
decision remains pending at this observation boundary.

<!-- Begin verbatim independent review record -->

# Gate Record — G3a-2 independent exact-SHA security review

- Subject: G3a-2 geo policy isolation and the approved geo apply/rollback integrity boundary.
- Candidate SHA: `bb070eb457eaacc741172162fd6100842aae0804`.
- Baseline / sole parent: `bcb50d3e9355256c1beef28190f24c4612f903ce`.
- Evaluator: Codex, `/root/g3a2_independent_sha_gate`, independent read-only reviewer. I did not implement this candidate or participate in its internal reviews. I inspected source and proofs before reading implementation-quality conclusions. No subagents were used.
- Review date: 2026-09-15. Independent local observations: `11:30:37.883184 UTC` and `11:32:34.556695 UTC`. Package-ready notification and all dependent evidence were received before finalization.
- Repository: `https://github.com/wcvmsilva/structr-ai`.
- Worktree / branch: `/private/tmp/structr-g3a2-20260914`, `codex/g3a2-geo-policy-20260914`, deliberately local and unpublished, no upstream.
- Environment: existing Node `v24.14.0`, pnpm `10.15.1`, Vitest `2.1.9`, TypeScript/Drizzle dependency tree, PostgreSQL `17.11` Homebrew. Runtime evidence was produced by the implementation-side coordinator and independently examined here; I did not run runtime tests, create a database, or change fixtures.
- Working tree: empty index and tracked diff; the sole untracked file is the intentional, separate historical `docs/security/g3a2-geo-policy-evidence.md`. Its unchanged SHA-256 is `bc28abe7a0e88bb02b11c327232149adf91cc4d36737fa68ed2203df6a7546d9`.
- Review mutation boundary: my only new filesystem write is this external report. No reviewed source, Git state, existing evidence, or historical report was changed. Git reads used optional-lock suppression; subsequent calls explicitly used `GIT_OPTIONAL_LOCKS=0`.

## Scope and non-claims

The reviewed claim is that the named price-adjustment paths and calibration's observational writer cannot authorize another tenant's or NULL-owned geo policy. Their geo predicates use the trusted caller tenant. Geo apply and rollback use current locked rows, derive their snapshot/calculation inside the transaction, require both writes, confirm the relevant persisted fields after both writes, and fail before commit on the tested rejection/integrity conditions. Rejected individual operations do not emit their success audit. The approved minimal nongeo final-transition guard and existing caller/return contracts are preserved.

Entry paths inspected: `priceAdjustment.propose`, `proposeFromRun`, `applyToPriceBook`, `rollback`, and `calibration.runTenant`. `previewImpact` is a preserved parent-ownership/return-contract control; it does not resolve `geoZones`. This is a local helper/SQL/caller boundary review, not a production HTTP, deployment, or whole-application evaluation.

No claim is made about all geo paths, global tenancy/B2, general nongeo isolation, deployed RLS/FKs/triggers, live data, provenance of old snapshots or approval records, arbitrary historical numeric precision, changed financial mathematics, global deadlock freedom, durable audit storage, or atomicity across zone/adjustment/event/audit. Calibration's normal producer remains latent. Nothing here authorizes source fixes, new commits, publication, PR changes, integration, closure, another security unit, or Phase 3.

Exact committed file set, independently checked against Git blobs and working bytes:

1. `server/calibration-db.ts`
2. `server/price-adjustment-db.ts`
3. `server/tenant-coverage-audit.ts` — comment only
4. `server/tenant-g3a2-calibration-geo-postgres.test.ts`
5. `server/tenant-g3a2-calibration-geo.test.ts`
6. `server/tenant-g3a2-callers.test.ts`
7. `server/tenant-g3a2-price-geo-postgres.test.ts`
8. `server/tenant-g3a2-price-geo.test.ts`
9. `server/test-support/g3a2-postgres.ts`

The commit is nine files, 2027 insertions / 62 deletions. No engine, schema, router, UI, dependency, environment, migration, or executable scanner change is included. The separate precommit document is absent from the commit and retains its historical wording.

## Authoritative Rules Checked

- Current human authorization, transmitted in `independent-review-brief.md`: “Autorizado! Vamos para próximo passo” after delivery identifying independent review of this exact commit as the next action. This authorizes the present review; it does not supply a future documentary/publication/closure decision.
- Approved unit design: `/private/tmp/structr-g3a2-recovery-20260914.md`; approved plan: `/private/tmp/structr-g3a2-planning-20260914/docs/superpowers/plans/2026-09-14-g3a2-geo-policy-isolation.md`. Read their file/action allowance, transaction design, previous-HEAD requirements, proof distribution, impact matrix, retained limitations, and separate human gates.
- Candidate `AGENTS.md`: behavior tests, zero regressions, input/authentication boundaries, audit requirements, transactions, and controlled implementation scope. The candidate's historical MySQL wording was compared with actual PostgreSQL source and the reconciled `AGENTS.md` in workflow lineage `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`; this review does not copy documents across lineages or change database architecture. The approved unit explicitly preserves the existing router-plus-tenant guards and audit architecture, and ratifies the 168 behavioral/contract cases in place of an artificial new-domain 20/20/15/5 split. It does not waive the open repository-level G1 obligations.
- Candidate `docs/adr/ADR-001-structr-data-ownership-model.md`: commercial geo policy is tenant data; NULL never implies global/GCHI ownership. Candidate `docs/security-remediation-handoff.md:511` defines G3a-2, and `:527` keeps G3a-3 separate.
- Workflow sources read with `git show f60cf9a56679d4d7083b2c11ac4e2727d53d84c3:<path>`: `docs/engineering/security-gate.md`, `gate-record-template.md`, `current-state.md`, `decision-correction-log.md`, `historical-index.md`, and `docs/superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md`. The ordered gate vocabulary and §§6.2–6.6 govern this report.
- Product sources read from preserved primary GitHub responses at main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`: `product-source-0.json` contains `docs/product/canonical-structr-truth-v1.md` (blob `b9e144e5b25b0c9dcfbcc0790b12931bc78713b2`); `product-source-1.json` contains `docs/product/feature-evidence-maintenance.md` (blob `6455caef19bbabb293ffd9104c67a5b73f487988`). Relevant capability definitions, independent classification dimensions, exact-SHA mapping rules, no automatic promotion, and delivery procedure were checked.
- Reconciliation: old NOT STARTED and next-action statements describe their earlier temporal boundaries. They do not override the explicit approved G3a-2 design/plan, subsequent implementation/commit authority, or current review authorization. Task 6 and PRs #12/#13 publication remain completed; F5b is locally closed with publication separate. PR #9 NO-GO and global B2 NOT DEFENSIBLE remain current constraints.

## Ordered Layer Results

| Layer | Result | Exact evidence and reason | Boundary |
|---|---|---|---|
| 1. Live state | PASS | Independent local Git reads, `start-state.json`, `live-state.json`, `remote-pr-observations.json`, and `final-integrity.json`: exact branch/HEAD/sole parent, base ancestry, empty tracked/index changes, expected untracked evidence, no upstream, security-to-candidate distance `0 / 2`. Remote main/workflow/security and PR #9 state match the explicitly approved local boundary. | Local unpublished candidate only; does not determine an integration base. |
| 2. Recovery | PASS | Sources listed above resolve one authorized state: independent review of G3a-2 at the committed SHA, with earlier unit and publication history preserved. Known stale lineage statements are explicitly reconciled. | Does not reopen F5b or authorize G3a-3. |
| 3. Scope | PASS | Independently regenerated production diff and nine-file list; all changed files, tests, helper/engine/schema/caller context and impact matrix inspected. The nongeo guard and scanner comment are explicitly allowed. | No schema, mathematics, RBAC redesign, producer activation, or program expansion. |
| 4. Technical | PASS | Fresh exact-SHA `targeted`, `postgres`, `check`, `test-types`, `full`, and `whitespace` records/logs meet their criteria; all records have unchanged before/after HEAD and hashes. Counts and skips appear below. | Green checks are bounded execution evidence, not security or merge authority. |
| 5. Static security measurement | PASS | Fresh `audit.json` / `logs/audit.log`: exit 0; 83 tables, 34 DB modules, 40 routers; 44 warnings and six known gaps fully retained. No executable scanner change or in-scope prohibited pattern was found. | Measurement only. No claimed warning reduction or global isolation. |
| 6. Security evidence | PASS | Fresh identical-file baseline/candidate contrasts, real PostgreSQL effects and lock oracles, permissive-double guards, positive controls, real-caller guards, source tracing, and failure classification below support each load-bearing assertion within its declared proof layer. | Fixture, audit, precision, latent-producer and adjacent-domain limits remain. |
| 7. Internal Superpowers implementation-quality review | PASS | `internal-sha-review.md`, reviewer `/root/g3a2_final_review`: new committed-SHA reassessment under the implementation-quality review method, specification/code-quality PASS, no unresolved findings. Exact commit blobs independently matched. Earlier task/whole-diff reviews remain history. | Separate from this independent reviewer and not substituted for Layer 8. |
| 8. Independent Codex read-only gate | PASS | This source-first review independently confirmed the claim, evidence scope, immutable files, controls, and limitations. No BLOCKER or REQUIRED finding remains in the reviewed boundary. | Narrow independent GO to submit the result to the next human decision only. |
| 9. Human gate for subsequent documentation/publication/closure | BLOCKED — pending explicit decision | Present review authorization is established and consumed. No subsequent exact-SHA human decision accepting this report and authorizing a concrete documentary/publication/closure action exists at this observation boundary. | This is an expected pending authority gate, not a code defect or rejection of the authorized review. |

## Evidence and execution results

Fresh execution evidence is in `/private/tmp/structr-g3a2-sha-review-20260915/`. `checks.json` and the nine individual records preserve exact commands, working directories, UTC times, exit codes, before/after SHA, file fingerprints and raw-log hashes. I independently recomputed all nine raw-log hashes and compared every committed blob with the working file and start fingerprint at `11:32:34 UTC`; every comparison matched. The six proof/support files also match the unchanged baseline overlay byte for byte.

The runner rejects inherited database settings before execution, clears the proof toggles, and sets `G3A2_POSTGRES=1` only for the two PostgreSQL runs. I inspected the runner and the separate no-emit test typechecker. No application/external database is part of this evidence.

| Command/check | Exact target | Observed result | Record / raw log |
|---|---|---|---|
| Focused three normal G3a-2 suites | candidate SHA | PASS, exit 0; 123 passed: price 72, calibration 12, callers 39 | `targeted.json`, `logs/targeted.log` |
| Same three suites | baseline SHA | Expected contrast, exit 1; 52 failed / 71 passed | `baseline-targeted.json`, `logs/baseline-targeted.log` |
| Two opt-in G3a-2 PostgreSQL suites | candidate SHA | PASS, exit 0; 45 passed: price 36, calibration 9 | `postgres.json`, `logs/postgres.log` |
| Same PostgreSQL suites | baseline SHA | Expected contrast, exit 1; 34 failed / 11 passed | `baseline-postgres.json`, `logs/baseline-postgres.log` |
| `pnpm check` | candidate SHA | PASS, exit 0; zero TypeScript errors | `check.json`, `logs/check.log` |
| Dedicated five-test-root no-emit typecheck | candidate SHA | PASS, exit 0; zero diagnostics | `test-types.json`, `logs/test-types.log` |
| `pnpm test` | candidate SHA | PASS, exit 0; 2787 passed / 135 skipped; 67 files passed / 4 skipped | `full.json`, `logs/full.log` |
| `pnpm audit:tenant` | candidate SHA | PASS for measurement threshold, exit 0; 44 warnings / six known gaps | `audit.json`, `logs/audit.log` |
| `git diff --check <base> <candidate>` | exact committed diff | PASS, exit 0 | `whitespace.json`, `logs/whitespace.log` |

There are 168 new cases: 123 normal and 45 explicitly enabled PostgreSQL cases. The normal suite's 135 skips are the inherited 90 plus the new 45 opt-in cases, which passed separately. F5b normal helper/caller suites and the existing 95-case G3a geo suite passed; the 24-case `phase4-engines` suite passed. The F5b PostgreSQL suite remains among the inherited opt-in skips and is not represented as freshly re-executed here. Existing OAuth configuration diagnostics and the `ensureProfileExists` mock warning are visible in `full.log`; they produced no test failures and were not suppressed or reclassified as security proof.

The audit's six named known gaps are `assembly-db.ts`, `estimate-version-db.ts`, `jobtread-export-db.ts`, `previsit-db.ts`, `scope-db.ts`, and `scope-review-db.ts`. The full 44-warning identities/messages remain in `logs/audit.log` (38 schema warnings and six router warnings). Its printed “Multi-tenant ready” label is not adopted as a security conclusion.

Inherited evidence: the 2026-09-14 task reports, staged RED/GREEN logs, proof hashes, internal reviews and precommit document explain development chronology and disclosed corrections. They were consulted only after independent source/proof inspection. They do not grant the resulting-SHA verdict. The fresh baseline/candidate runs above independently renew the applicable contrasts. Root's `final-integrity.json` at `11:32:14 UTC` also records prior verification artifacts unchanged and zero owned PostgreSQL processes/directories; this is the coordinator's live cleanup observation, not a claim that I ran cleanup.

## Independent implementation and oracle assessment

1. **Trusted tenant and caller chain.** `server/price-adjustment-db.ts:145` delegates geo lookup to `geoZoneTenantWhere` and checks `assertGeoZoneTenant`; `server/geo-db.ts:154` uses strict equality without a NULL arm. Foreign, NULL-owned and absent zones use the same generic not-found result after lookup. Both final geo updates (`price-adjustment-db.ts:947`, `:1258`) and calibration's final update (`calibration-db.ts:813`) repeat the trusted tenant. No returned row supplies tenant authority. Existing `requireOwnAdjustment` at `price-adjustment-router.ts:95`, report ownership at `:165`, and explicit tenant guards compose with real authentication/admin middleware; the 39 caller tests keep those controls real while mocking only the final operations.
2. **Current state and locks.** `price-adjustment-db.ts:799` locks the current adjustment by id and trusted tenant; it reclassifies the current type before authorizing and locking the current zone. Apply at `:905` and rollback at `:1240` use READ COMMITTED and adjustment → zone lock order. Snapshot, percentage, target, status and result come from those current rows. The two PA-005 reads run on the same transaction after the zone lock without taking competing-adjustment locks. Its existing broad second-stage veto is preserved, not redesigned.
3. **Both-row confirmation.** Each write requires exactly one RETURNING row. `:825` encodes the transition fields using their actual Drizzle columns and `IS NOT DISTINCT FROM`; `:861` checks the geo factor and timestamp using their column encoders. The confirmations occur after both writes (`:961`, `:1272`). All eleven apply fields and all six rollback fields plus the original snapshot are represented. The current id/tenant/type/zone predicates remain on the adjustment write and readback. PostgreSQL tests cover real numeric/timestamp/JSONB semantics, semantically equivalent JSONB order, suppressed writes, changed factor/timestamp/status/actor/snapshot, and an adjustment-write trigger that changes the zone.
4. **Rollback and stale nongeo dispatch.** Geo rollback validates snapshot target type/id and finite numeric factor before restoring, then checks the confirmed target inside the transaction; it has no optimistic catch-to-null integrity fallback. The nongeo final updates at `:1168` and `:1384` compare the observed tenant/status/type and all nullable target identifiers, reject zero rows, and roll back prior transaction effects. Existing serial cost-code, assembly and duration contracts are controls; general nongeo authorization is not proved.
5. **Calibration semantics.** `calibration-db.ts:791` changes only three observational fields, retains per-item best effort, and adds no “zone validated” success claim. Own events/reports and report audit can still succeed after a denied zone update. The populated-project producer control verifies actual `collectProjectSamples` and engine behavior with nonzero financial input; `calibration-db.ts:216` still emits null zone id/name. Injected PostgreSQL findings use synthetic engine samples and empty projects, and are correctly labeled latent-writer evidence.
6. **Proof quality.** The price double returns rows by id without executing tenant/status predicates and explicitly injects match results; it cannot make foreign-row rejection pass by filtering in the fixture. Its staged transactions prove modeled rollback and call order. The real PostgreSQL harness derives the five tables' actual types/defaults/PK/not-null constraints and two unique indexes; real own proposal/event/report inserts validate defaults. It has no external connection input, uses a private owned socket without TCP, and checks three distinct backends. Concurrency barriers observe table/operation/transaction boundaries and `pg_blocking_pids`, not elapsed sleep or SELECT counts. Baseline unsafe operations may finish; timeouts cannot pass an assertion. Observer reads cover persisted zone and adjustment state after failures. Failure injection before effective COMMIT does not pretend to prove rollback after an unknown commit outcome.

## Previous-HEAD Proof

- Required: YES for the change-sensitive isolation, confirmation, snapshot freshness, dispatch-guard and latent-writer assertions.
- Previous SHA: `bcb50d3e9355256c1beef28190f24c4612f903ce`, not F5b's older parent.
- Candidate contrast: all 168 exact proof cases pass at `bb070eb457eaacc741172162fd6100842aae0804` under their applicable normal/opt-in execution mode.
- Integrity: all six proof/support hashes match across the two trees; baseline tracked production/index remain unchanged. No proof-only production patch was added to the baseline.

I independently inspected raw assertion diagnostics and their source oracles before receiving any fresh implementation-side classification supplement. The baseline failures are expected security/transaction assertion contrasts, not startup/import errors or timeouts:

| Normal group | Failed / passing | Observed baseline failure classification |
|---|---|---|
| Price proposal | 4 / 4 | Two unauthorized proposals resolve, own lookup lacks tenant binding, mixed batch creates both proposals. |
| Geo apply | 18 / 8 | Missing explicit transaction contract; unauthorized/invalid-factor acceptance; absent fail-closed handling for suppressed writes and missing/divergent/nonboolean readbacks; PA-005 executor outside transaction; stale factor/percentage or changed type/tenant accepted. |
| Nongeo apply / preview | 6 / 4 | Each observed status/type/nullable-target guard is absent, allowing staged effects to survive simulated stale dispatch. |
| Geo rollback | 19 / 4 | Missing explicit transaction contract; foreign/NULL/absent target success; six incompatible snapshot variants accepted; suppressed writes and invalid/absent readbacks accepted; integrity mismatch succeeds; stale snapshot used. |
| Nongeo rollback / availability | 1 / 4 | Missing final guard permits history effects and success. |
| Calibration | 4 / 8 | Foreign/NULL/mixed-list observational changes persist; strict predicate absent. |
| Real callers | 0 / 39 | Existing authentication, tenant, parent ownership, delegation and error mappings remain passing controls. |
| **Normal total** | **52 / 71** | No unrelated failure counted as RED. |

Four of the 48 price failures are query/transaction-contract contrasts (own proposal predicate, own apply/rollback isolation configuration, PA-005 executor placement); their earliest failing assertion does not independently establish every later assertion in that test. Calibration contributes one further predicate-contract failure. The other 47 normal failures concern rejection, changed count or stale value. Null/Infinity/NaN snapshot inputs are distinct despite identical JSON-rendered test titles. The nonfinite engine-return case is explicit fault injection and does not claim malformed-percentage hardening.

PostgreSQL baseline: 31 price failures / five passing controls, plus three calibration failures / six passing controls = **34 failures / 11 passes**. Price failures comprise unauthorized proposals/writes and missing-zone rollback (seven), the sixteen write-suppression/tamper cases, and eight concurrency cases. Concurrency diagnostics include a repeated operation resolving instead of the required refusal, factor `44.1` instead of `52.5`, old rollback factor `42` instead of `50`, stale owner/target success, stale duration dispatch persistence, and rollback failing to wait for an in-flight apply. The last case's missing-blocker assertion is a required lock/ordering contrast, not a timeout. All candidate counterparts pass.

Passing PostgreSQL controls on both SHAs: own propose → approve → apply → rollback, existing absent-zone apply guard, actual SQL-error rollback, failure before effective COMMIT, JSONB equivalence, own calibration observation/report, absent/no-id finding handling, per-item SQL failure continuation, commercial-field preservation and empty-project real-engine behavior. These are controls, not newly fixed defects. Previous-HEAD failure is not required for unchanged callers, serial contracts, existing actor/status/reason/snapshot-presence/autoApply guards, or documentary/source-only impact statements; their evidence is preservation, positive execution, or inspection as labeled.

## Findings

- **BLOCKER: none** in the exact reviewed unit, SHA and evidence boundary.
- **REQUIRED: none** in that boundary. No implementation or proof correction is requested.
- **NOTE — postcommit audit limitation remains.** `server/price-adjustment-db.ts:966`: `markEventActioned` executes after commit and before applied audit, so an event error can leave committed business state without that later success-audit call. The behavior is explicitly tested and accepted as an inherited scope limit. P-05 and G1 are not globally closed.
- **NOTE — fixture and oracle limits remain.** `server/test-support/g3a2-postgres.ts:168` deliberately omits deployed FK/RLS/domain topology; `server/tenant-g3a2-price-geo.test.ts:1` declares injected SQL-comparison results; PostgreSQL audit sinks are call spies. These are adequate complementary proofs for this claim, not a deployment or durable-audit proof.
- **NOTE — latent writer remains.** `server/calibration-db.ts:216` and `server/tenant-g3a2-calibration-geo-postgres.test.ts:42`: injected finding tests do not show that the ordinary producer reaches a writable geo id. No producer activation is authorized or inferred.
- **NOTE — financial and PA-005 semantics are preserved.** `shared/price-adjustment-engine.ts:501` uses existing two-decimal rounding; `server/price-adjustment-db.ts:925` retains the existing two-stage veto. “Exact restoration” here means the validated snapshot factor under the approved engine contract; arbitrary historical precision, malformed percentage behavior, approval provenance and a complete redesign/proof of PA-005 are excluded.
- **NOTE — publication/integration limitation remains.** Approved plan §1 and `remote-pr-observations.json`: main is `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, while PR #9 metadata reports base `233569d68c014712ce3d25326bda8823aab1987e`. PR #9 is open, not draft, unmerged, at security head `b95ea0bf4741646f418fcc99a22d22a42d24be51`. The local candidate is absent remotely. The plan explicitly permits this local review boundary; integration/publication needs its own authority and reconciliation. No unauthorized publication is required to make this gate pass.

## Capability impact disposition

All rows below were reviewed by `/root/g3a2_independent_sha_gate` for this candidate's impact only. Their canonical implementation, operational validation, security, confidence, verification, lifecycle and roadmap classifications remain unchanged; no row is relabeled CURRENT. Main-line registry totals are untouched. P-09 correspondence remains insufficient.

| Capability | Disposition for this change | Evidence / retained limit |
|---|---|---|
| C-05 Service-area / geo qualification | Bounded impact PASS, direct | Trusted-tenant geo read/write guards and own/foreign/NULL PostgreSQL controls; service-area architecture excluded. |
| C-18 Price adjustment and margin control | Bounded impact PASS, direct | Current snapshots, both-row confirmation, rollback, caller and concurrency controls; original financial/approval contract limits retained. |
| C-36 Calibration | Bounded impact PASS, direct latent writer | Strict observation predicate; real report/event persistence; producer control remains null-id. |
| P-03 Tenancy and tenant scoping | Bounded impact PASS, direct | Four original SQL boundaries plus new confirmations use strict geo policy; no repository-wide claim. |
| P-06 Data access layer | Bounded impact PASS, direct | Real SQL types, transactions, triggers and persisted effects; fixture topology limits retained. |
| P-05 Audit and audit trail | Bounded impact PASS, direct limited | Denied individual operations have no success audit; report/mixed-item success preserved; no durable/global atomic audit claim. |
| P-02 Authorization and RBAC | Preservation PASS, indirect | Real middleware/tenant/parent guards and 39 caller controls; no new RBAC design. |
| C-15 Pricing engine and price book | Bounded impact PASS, direct final guard | Stale nongeo transition aborts existing transaction; serial cost-code calculations preserved. |
| C-16 Catalog and assembly library | Preservation PASS, indirect | Assembly adjustment serial contract preserved; no new catalog write/isolation claim. |
| C-14 Estimating | Preservation PASS, indirect | Unchanged geo mapping/estimate consumer trace and regression suite; no historical re-estimation. |
| C-35 Analytics | Preservation PASS, indirect | `server/analytics-db.ts:583` and `:584` consume unchanged summaries; no global analytics-isolation claim. |
| P-09 Evidence and provenance substrate | Bounded impact PASS, indirect limited | New snapshot originates from authorized current locked zone; no historical cleanup or complete canonical provenance mapping. |

Both routers remain mounted in `server/routers.ts`; the source search found no client tRPC consumer for these two namespaces. No additional changed downstream surface requiring an expanded production scope was identified. This matrix is not a review of all 48 capabilities.

## Review Chain and Program Gates

- Internal Superpowers implementation-quality review: **PASS** at the exact candidate, separate reviewer and record named above.
- Independent Codex read-only review: **PASS / narrow G3a-2 GO** at `bb070eb457eaacc741172162fd6100842aae0804` for submission to human consideration of the reviewed local unit only.
- Human approval of this review: established. Human acceptance and authorization of any subsequent documentary commit, publication/integration or formal closure: **PENDING**, separate decisions.
- PR #9 merge gate: **NO-GO**. No PR change or merge authorization is given.
- B2 global claim: **NOT DEFENSIBLE**; not reevaluated as a global claim here.
- Next authorized security unit: **none**. G3a-3, G2 including its 13/15-surface discrepancy, G3b/G4b, repository-level G1 and data/provenance work remain separately governed. Their enumeration does not automatically make every deferred implementation mandatory for PR #9.

## Verdict

**Independent Codex G3a-2 GO at exactly `bb070eb457eaacc741172162fd6100842aae0804`, limited to the reviewed local geo policy isolation and transaction-integrity claim and its presentation to the next human gate. Layers 1–8 PASS; Layer 9 remains pending/BLOCKED for subsequent actions.**

No concrete in-scope correction is needed. The next precise action is to present this immutable review and its retained limits for explicit human acceptance and selection of the next G3a-2 documentary/publication/closure action. The approval to perform this review must not be recycled as approval for that next action. No additional work is authorized by this verdict itself.

This is not formal human closure, publication approval, deployment approval, a canonical status promotion, or MERGE GO. Any later implementation change invalidates this exact-SHA gate until a new candidate receives fresh independent review.

<!-- End verbatim independent review record -->
