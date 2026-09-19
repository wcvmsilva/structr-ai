# F5b — project geo persistence execution record

Status: uncommitted candidate implemented and verified on 2026-09-14; internal static review found no actionable issues. No unit closure, formal security GO, commit, push, merge, or Phase 3 authorization.

## Authority and evidence boundary

- User approved the bounded design on 2026-09-13, then authorized execution of its plan with “Vamo dar continuidade!” on 2026-09-14.
- Repository: https://github.com/wcvmsilva/structr-ai
- Source baseline: `b95ea0bf4741646f418fcc99a22d22a42d24be51`.
- Workflow authority, read by exact-SHA pointer without transferring documents: `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`.
- Canonical vocabulary and feature-evidence procedure: `main` at `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`; historical registry classifications are not promoted by this unit.
- The canonical main commit `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf` is still absent from the local object database (confirmed by `git cat-file -e`). Its earlier remote document inspection remains the source for canonical vocabulary; no fetch, pull or automatic object recovery was attempted.
- Fresh remote observation: 2026-09-14 17:08:34 UTC. Security and workflow heads still match these references; PR #9 is open, not draft, not merged, head `b95ea0bf4741646f418fcc99a22d22a42d24be51`.
- Execution workspace: `/private/tmp/structr-f5b-20260914`; branch `codex/f5b-project-geo-20260914`.
- Linked installed dependencies from the original checkout; no installation, dependency/configuration change, or application setup/seed was run.
- Original main checkout and task5 preparation worktree remain outside the change scope.
- Task 6 and publication through PRs #12/#13 remain completed history. Their evidence is not rerun or transferred to F5b.
- AGENTS PostgreSQL and tenant-boundary corrections at the workflow SHA govern this execution. No new domain or sprint is opened; this record does not claim the sprint-wide 60-test distribution is satisfied.

## Bounded claim and contracts

Only `assignZoneToProject` and `persistGeocodeResult` may change production behavior: each owns one short transaction containing the locked before-read, update and checked readback. Audit remains after confirmed commit. The geocoder is outside the transaction.

Preserve signatures, false for unavailable DB or initially missing project, existing event payloads/conditions, optional snapshot preservation, and principal project/lead operations already committed before geo work. A missing/invalid/divergent readback after update must throw inside the transaction; SQL errors propagate. An indeterminate commit outcome is not called a rollback and introduces no retry.

No changes to routers, project authorization, audit.ts, schemas, engines, dependencies, CI, migrations, seeds, live/external databases, F15/TENANT_STRICT, other security units, or commercial implementation. Stale-address rejection, zipCode/zip reconciliation, derived warnings/risk consistency, strict transactional audit and export provenance repair remain excluded.

## Preflight plan review and coordination ledger

| Tasks/interfaces | Review finding and disposition |
|---|---|
| Helper tests -> both helpers | Same existing signatures; distinguish root and transaction handles per statement. Tests precede production edits. |
| assign helper -> persist helper | Separate transaction per invocation; no shared production abstraction or cast introduced. Both preserve post-commit audit. |
| Both helpers -> caller controls | Six endpoints remain unchanged. Geo failures preserve principal operations and existing return/error mapping. |
| Both helpers -> PostgreSQL suite | Real helpers and real PostgreSQL; only getDb/audit boundaries redirected. Test setup cannot satisfy production RED. |
| Tests -> existing G3a suite | Only fixture interface compatibility may change; historical assertions/notes are preserved. |
| Verification -> publication | Uncommitted working-tree review cannot claim a new exact-commit security verdict. Human commit authorization and later exact-SHA independent review remain separate. |

Ruling: use this authorized evidence file as the execution ledger instead of adding skill-specific workspace artifacts — the approved file boundary controls; no generic skill can authorize extra production changes, commits, publication, or scope expansion.

Ruling: PostgreSQL tests are opt-in with `F5B_POSTGRES=1`, but mandatory for the F5b gate — normal suite skips are explicit and never count as proof. Enabled setup failures are errors, not skips.

Ruling: use a fresh worktree in the permitted temporary directory and reuse installed node_modules by symlink — preserves unrelated preparation and avoids installation/hooks. No fetch or pull was used.

## Baseline validation

Executed before new test files were written, with DATABASE_URL removed from the command environment:

- `pnpm check`: no TypeScript diagnostics in complete output.
- `pnpm test`: exit 0; 62 test files passed, 1 skipped; 2617 tests passed, 79 skipped, 0 failed. Duration 27.64s.
- Raw logs: `/private/tmp/f5b-evidence-20260914/baseline-check.log` and `/private/tmp/f5b-evidence-20260914/baseline-test.log`.
- `pnpm audit:tenant`: first invocation could not start the tsx local IPC socket under sandbox (EPERM), not an audit finding. Same authorized command retried with sandbox approval: exit 0, 44 warnings, 6 known gaps. Full logs `baseline-audit.log` and `baseline-audit-retry.log` in the same evidence directory. Audit output is static measurement, not a tenant-isolation verdict.
- Previous-HEAD comparison workspace: `/private/tmp/structr-f5b-baseline-20260914`, detached at the exact baseline, with the same installed dependency symlink. Only candidate test/support files may be overlaid; production remains baseline code.

## Capability impact matrix

IDs and semantics come from the main-line canonical registry and feature-evidence-maintenance procedure at `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`. Code paths below were measured at `b95ea0bf4741646f418fcc99a22d22a42d24be51`. These are bounded effects/compatibility obligations, not new canonical dependency declarations. No implementation, operational-validation, security, confidence, verification, lifecycle or roadmap status is promoted. Unreviewed registry rows retain their historical anchors.

| Capability | Impact | Changed behavior or bounded claim | Files / consumers | Acceptance / evidence needed | Reviewer and disposition |
|---|---|---|---|---|---|
| C-01 Lead capture and qualification | Indirect | Conversion stays committed on geo error | lead-router, lead-conversion, LeadModal | Real conversion control with preserved IDs/warning | Independent reviewer not yet assigned; pending |
| C-03 Intake forms | Indirect | Conversion-created intake survives geo error | lead-conversion; Intake project creation | Preserved intake/IDs | Independent reviewer not yet assigned; pending |
| C-04 Pre-visit briefing and field checklist | Indirect | Reconstructed context remains a consumer | previsit-db, previsit-engine | Dependency/diff review; unchanged context losses | Independent reviewer not yet assigned; pending |
| C-05 Service-area / geo qualification | Direct | Atomic project persistence per helper | geo-db, geo-integration, geo-router | Helper, rollback and PostgreSQL proofs | Independent reviewer not yet assigned; pending |
| C-06 Client formation | Indirect | Conversion-created client survives geo error | lead-conversion | Committed client preserved | Independent reviewer not yet assigned; pending |
| C-07 Project formation | Direct | Geographic fields persisted with checked transaction | project-router, Projects | Success, missing row, error and main-operation controls | Independent reviewer not yet assigned; pending |
| C-10 Scope generation | Indirect | Zone/snapshot supplied to future generation | scope-generation-router, scope-router | Dependency/diff review; no automatic regeneration claim | Independent reviewer not yet assigned; pending |
| C-13 Scope model and structure | Indirect | Existing zone rule/alert consumers preserved | scope-router, scope-engine | Existing regressions and bounded dependency review | Independent reviewer not yet assigned; pending |
| C-14 Estimating | Indirect | Project context consumed when building estimate | scope-to-estimate-pipeline, estimate-db | No implicit repricing/invalidation claim | Independent reviewer not yet assigned; pending |
| C-15 Pricing engine and price book | Indirect, limited | Full snapshot not automatically injected by this pipeline | pricing-dimensions, scope-to-estimate-pipeline | Preserve limitation; no pricing-rule changes | Independent reviewer not yet assigned; pending |
| C-18 Price adjustment and margin control | Indirect | Existing zone/risk Profit Shield inputs preserved | scope-to-estimate-pipeline, profit-shield-engine | Existing regressions; no new financial semantics | Independent reviewer not yet assigned; pending |
| C-19 Remodel modeling | Indirect | Zone reaches override consumers | remodel-router, remodel-engine | No template/override logic changes | Independent reviewer not yet assigned; pending |
| C-35 Analytics | Indirect, limited | Persisted derived risk remains separately written | analytics-db | Record stale-risk limitation; no synchronization claim | Independent reviewer not yet assigned; pending |
| C-36 Calibration | Indirect, limited | Derived project risk consumed separately | calibration-db | G3a-2 remains outside this correction | Independent reviewer not yet assigned; pending |
| C-38 Workflow visualization | Indirect | Current project zone used for overrides | workflow-visualization-router | Dependency review; metadata zone loss remains | Independent reviewer not yet assigned; pending |
| P-02 Authorization and RBAC | Indirect | Existing caller/project guards unchanged | project-access, geo/project/lead routers | Real-guard allow/deny controls | Independent reviewer not yet assigned; pending |
| P-03 Tenancy and tenant scoping | Indirect | Trusted context and geo-policy source boundary preserved | tenant boundaries, geo-router | Foreign/unresolved controls and existing G3a regression | Independent reviewer not yet assigned; pending |
| P-05 Audit and audit trail | Direct, bounded | Audit after commit, before state acquired under lock | both helpers, audit | Ordering, payload and zero-audit-on-rollback controls | Independent reviewer not yet assigned; pending |
| P-06 Data access layer | Direct | Read/lock/update/readback use one transaction handle | both helpers, db | Instrumentation and actual PostgreSQL | Independent reviewer not yet assigned; pending |
| P-07 Platform reference data (geo override) | Indirect | Project zone consumed by override paths | geo-override-db, workflow/remodel | No G2 remediation or closure claim | Independent reviewer not yet assigned; pending |
| P-09 Evidence and provenance substrate | Indirect, limited | Context producer/consumer divergence remains | pipeline, estimate-db, estimate-export | draftData/metadata mismatch explicitly excluded | Independent reviewer not yet assigned; pending |
| P-10 Export and transmission | Indirect, limited | Existing captured estimate data consumed | estimate-export | No full geo-provenance or recalculation claim | Independent reviewer not yet assigned; pending |

## Implementation and observed verification

Production changes are restricted to the bodies of the two existing helpers, plus the SQL import required by their readback. Both capture input values, acquire the project row with `FOR UPDATE`, update and verify the fields written on the same transaction handle. PostgreSQL `IS NOT DISTINCT FROM` with column encoders compares numeric, timestamp and jsonb values using database semantics. A missing or divergent readback throws inside the transaction. Audit payloads are captured in memory before leaving the callback and emitted only after commit resolves.

The existing G3a fake gained only the `.for()` interface and explicit queued readback results for four affected controls. Its original assertions remain unchanged. The fake's scripted `matches:true` is not SQL proof and does not close historical NOTE-1/NOTE-2.

| Verification | Observed result | Raw log in `/private/tmp/f5b-evidence-20260914` |
|---|---|---|
| Helper RED, before production edits | 14 expected failures, 13 passes, 27 cases; failures exposed absent transaction/readback and audit ordering | `helpers-red.log` |
| Helper GREEN | 27 passed, 0 failed; separate independent execution also passed 27 | `helpers-green.log`, `helpers-independent-green.log` |
| Caller controls on unchanged baseline | 20 passed; compatibility controls, not correction-sensitive RED | `callers-baseline.log` |
| Caller controls and existing G3a on final candidate | 115 passed: 20 new caller controls and 95 historical G3a tests | `regression-final.log` |
| Real PostgreSQL RED on unchanged baseline | 8 expected failures, 3 passes: four missing locks, two missing readbacks and two accepted divergent writes | `postgres-red.log` |
| Real PostgreSQL GREEN on candidate | 11 passed, 0 failed, 0 skipped; owned cluster stopped and removed | `postgres-green.log` |
| Default PostgreSQL opt-out | 11 skipped; no cluster startup | `postgres-default.log` |
| Final `pnpm check` | Exit 0, no TypeScript diagnostics | `candidate-check-final.log` |
| Final `pnpm test` | Exit 0; 64 files passed, 2 skipped; 2664 tests passed, 90 skipped, 0 failed; 25.69s | `candidate-test-final.log` |
| Final `pnpm audit:tenant` | Exit 0; 44 warnings and 6 known gaps; full output differs from baseline only in its timestamp | `candidate-audit-final.log` |
| Final Git whitespace check | `git diff --check` exited 0 | Observed in this execution session |

There are 58 new cases: 27 helper cases, 20 caller controls and 11 PostgreSQL cases. The normal suite executes 47 new cases and skips the 11 opt-in PostgreSQL cases; those 11 were separately executed and passed. The other 79 skips existed in the baseline. Of the new cases, 14 helper and 8 PostgreSQL assertions fail on baseline for the expected reasons. These are 22 correction-sensitive cases, not a claim of 22 distinct vulnerabilities. The remaining cases are compatibility/representation controls.

The accepted final PostgreSQL test and support files are byte-identical to the baseline overlay (`cmp` exit 0). Baseline production files remain unchanged at `b95ea0bf4741646f418fcc99a22d22a42d24be51`. PostgreSQL RED used the application helpers, not a standalone demonstration of database transactions.

Intermediate failures were resolved within scope: the first candidate typecheck exposed test-support PostgreSQL option typing; the first G3a run exposed four fake-chain compatibility failures (`.for is not a function`). The final checks above ran after those corrections. The PostgreSQL sandbox initially denied shared-memory startup; the approved private-cluster run supplied the accepted behavioral RED/GREEN evidence. Infrastructure errors were not counted as behavioral failures or passes.

## Acceptance coverage and limits

| Obligation | Evidence and interpretation |
|---|---|
| One transaction and one handle per helper | H03 checks each statement's handle and predicate; P01–P04 observe actual PostgreSQL locks between two working connections |
| Accurate locked before-state under contention | P01–P04 cover assign/assign, persist/persist and both mixed orders; second audit reflects the first committed write |
| Rollback after attempted write and no audit | H07–H10 exercise readback error/absence/mismatch and explicitly rejected commit; P05–P06 and P10–P11 verify actual stored state after SQL error or trigger divergence |
| Existing return, field and event contracts | H01–H11 and G01–G05 preserve unavailable/missing behavior, committed writes, original event shapes/conditions, optional snapshots and failed geocodes |
| PostgreSQL representation equivalence | P07–P09 accept equivalent numeric scale, jsonb key order and timezone rendering |
| Caller failure and authorization contracts | C01–C09 exercise real routers, project guards, principal project mutations and lead conversion with controlled geo seams; historical G3a regressions remain green |
| Network remains outside persistence transactions | Static call/diff review: changed helpers contain no geocoder invocation; refresh/create/conversion composition remains unchanged. C07 additionally observes principal conversion commit before its substituted geo boundary. This is not an end-to-end live-geocoder test |
| Separate warnings/risk update remains a limit | C04 records that `persisted:false` still permits the later summary update. Later summary-write failure does not belong to the helper transaction; no end-to-end atomic-context claim is made |

Actual PostgreSQL tests use installed PostgreSQL 17 binaries at `/usr/local/opt/postgresql@17/bin`, an owned temporary cluster, private Unix socket and no TCP listener. They reject inherited database configuration, substitute only application connection/audit boundaries and block any geocoder call. The minimal `projects` table derives real column types, but does not reproduce constraints, foreign keys, RLS, triggers from a deployment, or the full application schema. The audit sink is substituted. These tests prove bounded helper behavior, not deployed-database or tenant-isolation correctness. This host-specific harness is not a portable CI setup; dependencies and CI were not changed.

Auditing remains best effort after commit. A failed audit can leave a committed business update without an audit row. A lost connection during COMMIT can leave its outcome unknown; no retry or rollback claim is introduced for that case. The lock does not revalidate the caller's tenant, address freshness or source-zone policy. All earlier exclusions remain applicable.

## Internal review and candidate identity

Independent internal reviewer `/root/f5b_internal_review` inspected the uncommitted production diff, three F5b suites, PostgreSQL support and narrow G3a fixture change. Result: no actionable findings; exactly the eight authorized paths were present. This was a static review without reviewer-executed tests. Root separately inspected code and observed the verification output above. Capability rows remain pending for formal exact-SHA review; no capability status is promoted by this internal assessment.

The same reviewer subsequently checked this completed evidence record against the raw logs, all seven manifest hashes and the unchanged-baseline PostgreSQL overlay: no documentation correction was required.

HEAD is still the baseline SHA; it does **not** identify the implementation. The implementation is the uncommitted working tree plus this file manifest, captured after the final checks:

| File | SHA-256 |
|---|---|
| `server/geo-db.ts` | `d7116ee7e5e8764b29227a13937f7d9c2acbbd633010448818fe14b96516f5b4` |
| `server/geo-integration.ts` | `52c53fb7eaf28dbd75da6557c213b3776e3a0023070135640ba50f33ca4807a8` |
| `server/tenant-f5b-project-geo.test.ts` | `90bf2ea7f6c0bbc94346bbbb2e2bef1ac54b61f9b00d5d9a49c3d4d8d5d26b60` |
| `server/tenant-f5b-project-geo-callers.test.ts` | `0a27964dca902ba0de5e9688064aa95f90baaa12ee4f9dc589f0141b69914824` |
| `server/tenant-f5b-project-geo-postgres.test.ts` | `dcf61a1133a94e23ab0d80aa1aa23e962d42c4655bcbae6b21b7e95509a13b6b` |
| `server/test-support/f5b-postgres.ts` | `2a4f59b85cbed06eea0616e91a8a6d6fd8344df0e694c73801d28dc58b07da0b` |
| `server/tenant-g3a-geo-zones.test.ts` | `e7443da035c22fabada4845e87f3c07002158840f7d5c130d6f6398a3ff6c75e` |

The eighth authorized file is this newly authored evidence record; it is not included in its own checksum manifest. No canonical or workflow source document was copied into the security lineage.

Original main remains clean at `233569d68c014712ce3d25326bda8823aab1987e`, upstream `origin/main` (not treated as a current remote observation). Task5 remains at `91d083c2aa1e5b92c88b3a77a808f196c8d92012` with its pre-existing one modified and ten untracked files. Other worktrees and their existing metadata were not repaired or removed. Temporary candidate and comparison worktrees are retained for review; disposable PostgreSQL clusters were removed. No commit, push, merge or PR update occurred.

Implementation and local verification are complete for this candidate. Formal independent exact-commit review, human unit closure and the pilot retrospective remain pending. The single next human decision is authorization to create a local commit of these eight reviewed paths; it would supply the new SHA needed for the subsequent formal review. It does not authorize push, merge, Phase 3 or any other unit.

## Program posture

PR #9: NO-GO. Global B2: NOT DEFENSIBLE. F5b is a locally verified, uncommitted candidate, not a closed security unit. G1 rule-F2/rule-F5, G3a-2/3, G2, G3b/G4b and provenance/data programs are not changed or closed by this record.
