# A1 delivery closeout — 6 October 2026

## Scope and evidence status

The user authorized corrections, tests, publication and validated integration into `main`. The closeout starts from accepted local export integration `60dc81e9562673f7c931844777535bf425a7ece1`; the GitHub main observed at takeover was `0bd5d831ad2115fef069e979b0cc89991b52c7f7`. Michael accepted Jim's viewport candidate `59ab74188a5f5b66ef8d7af27ef16cdceb3ee3a0` on 6 October at 15:26 UTC, integrated it locally at 15:28 UTC and released the serialized verification window. The decision and integration records preserve their browser, SQL, network and cleanup limits; that acceptance covers the bounded viewport/decision-cycle slice, not the full closeout.

The combined local source is `e2048c11653041137bf6eb7547f6dc1c8448db2a`, merging that candidate with `32b9d4b723c9f8dccb702780fb19699363f9586f` (project form), `6f6ce5baed255777a69eecdad72600fa47bf86f0` (operational holds) and `d78e8831` (physical reduction tests). Subsequent typing, Monitoring and physical test-fixture corrections are committed in runtime source `f6a80a18666b8586bde3fe8d208a7f3090221165`. The fresh type check and corrected operational physical run identify that SHA. Export runtime/test blobs are unchanged between `e2048c11` and `f6a80a18`, so the ten export runs retain their attribution across those commits. The earlier `final-code-head.json` recorded `e2048c11` at the start of the window; it is not the final runtime identity. The validated source checkpoint is `6b01c2a8efb3db2ea92dbdd9d4138bdadf162629`, following the stored-context label commit `5cf008fb045d76332cd8688e39b5aa49900b7f13`. The 20 previously reviewed backend blobs remain unchanged from `f6a80a18`; the UI fixes have their own independent mutual/coordinator review. Resulting publication and main identities belong to the GitHub PR/final record, not an assumed outcome of this source checkpoint.

The intended proof is **Intake → Calculator → explicit USD/context review → internal approval → controlled export → revocation → new version**. Client/project identity and geocoding must come through product operations; only auxiliary catalog, tenant and authentication fixtures may be bootstrapped for the positive synthetic journey. An internally approved estimate never supplies execution authority, an operational budget, a payment authorization or a closed project.

Codex’s own closeout corrections add no domain, table, migration or endpoint over `60dc81e9`. Jim’s inherited decision-cycle integration does mount `estimate.revokeInternalApproval` and updates the existing approval/version routes; its endpoint is included in the combined-source inventory below. The inherited candidate contains migrations `0005`–`0014`; their presence does not establish a deployed database baseline. This record does not reclassify the 48 canonical capabilities or establish production readiness.

## Corrections and impact matrix

The accepted predecessor still exposed legacy operational promotions. The correction follows the reconciled A1 contract, preserving historical reads and valid reductions of risk rather than erasing past activity.

| Capability | Impact and changed behavior | Required evidence |
|---|---|---|
| C-07 — Project formation | Direct: preserve client UUID/name/company and ZIP; validate active same-tenant client inside creation transaction. | Form/router/DB behavior and bounded product journey recorded below. |
| C-05 — Geographic qualification | Indirect: corrected ZIP reaches existing geocoding; no geographic-engine change. | Product geocode and retained source identity. |
| C-06 — Client formation | Indirect: Projects consumes real client identity; client creation itself is unchanged. | Existing client selection and foreign/inactive client refusal. |
| C-14 — Estimating | Indirect: consumes corrected project/client/geography and historical checklist; approval does not gain execution authority. | Positive estimation journey and identity preservation. |
| C-24 — Field operations | Direct: hold creation, assignment and execution promotions; retain descriptions and valid reductions with ACL/lineage/audit. Last-task cancellation does not complete the project. | Route/helper negatives, mixed/null commands, immutability, rollback and concurrency. |
| C-23 — Field launch control | Direct: hold alternate cost writer; preserve facts and explicit unavailable variance component. | Direct/helper route refusal regardless of admin or feature flag; factual read. |
| C-30 — Actual cost capture | Direct: hold capture/approval/payment; preserve ledger, annotations and valid reject/void/delete. Refresh committed facts atomically without fictitious variance. | References/states, whole-command refusal, audit rollback and ledger preservation. |
| C-34 — Closeout and handover | Direct: hold opening/progression/closing/new report; preserve facts, valid reductions and stored reports; readiness remains blocked. | Complete legacy checklist cannot authorize close; no auto-promotion; audit rollback. |
| C-35 — Analytics | Direct: profit health unavailable and corresponding snapshots held; factual dashboard components remain. | DTO composition, snapshot refusal and historical reads. |
| C-36 — Calibration | Direct: hold project/tenant computation before DB, including empty populations; retain history. | Unmocked direct/router holds plus bounded legacy private-writer isolation assertions. |
| C-12 — Scope completeness | Direct: score/preview unavailable; historical scores and omissions checklist remain. | ACL, unavailable DTO and preserved checklist reads. |
| C-28 — Subcontractor management | Indirect: assignment hold removes the field eligibility/compliance consumer; subcontractor module retains its own evaluation. | Source/caller review without maturity reclassification. |
| P-04 — Tenant settings | Indirect: unavailable profit health no longer consumes configured floors; configuration and other consumers remain. | Source/caller review. |
| P-02 — Authorization and RBAC | Bounded direct: affected writers revalidate permissions within their transaction. | Foreign actor and changing identity tests; no general RBAC certification. |
| P-03 — Tenancy | Bounded direct: trusted tenant matches project, record and ancestors before classification/write. | Foreign/null tenant and reference tests. |
| P-05 — Audit trail | Bounded direct: retained mutations/events share durable audit transaction; refusals do not mutate. | Actual before/after evidence and injected audit-failure rollback. |
| P-06 — Data access layer | Bounded direct: locks, atomic operations and scoped queries; no new migration in this correction. | Real disposable DB/lock tests where applicable. |
| C-22 — Execution Authorization | Semantic boundary: unavailable guard does not implement canonical execution authority. | No status, role, system flag or reference grants authority. |
| C-33 — Baseline management | Semantic boundary: held legacy selectors do not implement Execution Baseline. | No fallback to legacy approved money or zero. |
| C-29 — Change Request and Change Order | Inherited boundary: existing materialization hold preserved; no new positive capability. | Relevant regression and caller inspection. |
| C-32 — Forecast / Estimate at Completion | Inherited boundary: forecast hold preserved; no new positive capability. | Relevant regression and factual dashboard composition. |

## Current verification record

Verification uses one coordinated runner and one worker. The earlier focal unit/UI runs did not use a physical database or browser; later disposable PostgreSQL runs are identified separately below. Logs under `tmp/delivery-closeout-20261006/` are local evidence artifacts associated with this worktree, not published proof. Final review must bind results to immutable source. Totals overlap and are not a unique suite count.

| Run | Observed result | Limit |
|---|---|---|
| Project form/router/DB | RED: 22 failed, 76 passed; GREEN: 98 passed, exit 0 | 27 new cases; the focal run alone is not browser evidence. The later bounded journey is recorded below. |
| Project and field final focal set | GREEN: 286 passed across seven files, exit 0 | Includes three new public-date rejection cases after their RED failures; no physical DB in this run. |
| Derived reads, analytics and Actuals UI | RED exposed the missing holds; GREEN: 166 passed across seven files, exit 0 | Instrumented latent calibration tests preserve older isolation assertions; separate unmocked tests prove the production hold. |
| Actuals/closeout and affected consumers | GREEN: 345 passed across seven files, exit 0 | Includes 106 new cases; lineage, unknown-state and whole-command findings reproduced RED and corrected. |
| Integrated TypeScript check | Initial check failed with typing diagnostics, exit 2; corrected check: 0 errors, exit 0; fresh final runtime check: 0 errors, exit 0 | `final-check.log`, `final-check-corrected.log` and `full-check.log`; `full-check.head` identifies `f6a80a18`. Correction separates held public entrypoints from private legacy bodies without enabling computation. |
| Derived typing correction regressions | 63 passed across three files, exit 0 | `derived-check-fix-green.log`; includes unmocked authority refusals and instrumented older isolation checks. |
| Monitoring high-variance component | RED: 5 failed, 28 passed, exit 1; GREEN: all 31 DB and 2 UI cases passed within the full suite at `f6a80a18` | `monitoring-red.log` and `full-tests.log`; the five new regressions pass. Source corrected at `27ff1f5b`: unavailable state replaces false zero, preserving eight factual counts. No separate focal GREEN run is claimed. |
| Physical operational reductions | Initial run: 8 passed, 3 failed out of 11, exit 1; corrected rerun: 11 passed, exit 0 | `operational-postgres.log` and `operational-postgres-corrected.log`; corrected `.head` records `f6a80a18`. Fixture constraints and transitive wait-graph observation were corrected. Cleanup confirms removal of `/private/tmp/structr-app-principal-pg-Ob25n9`. |
| Instrumented G3a2 calibration geography, disposable PostgreSQL | 9 passed, exit 0 | `g3a2-calibration-postgres.log`; instrumented private legacy isolation proof, not permission to run production calibration. Public calculation remains held. |
| Export physical suites | All ten suites passed: 331 cases, each exit 0 | Accepted V7 runner, one disposable database per suite, cleanup confirmed for each. `export-physical-results.json` identifies local logs; runtime/test blobs are unchanged across `e2048c11` → `f6a80a18`. Per-suite counts are recorded below. |
| Full regression | 6,448 passed, 951 skipped (7,409 total); 180 files passed, 32 skipped (212 total); 268.18 seconds, exit 0 | `full-tests.log`, `.exit` and `.head` identify `f6a80a18`. The 951 skips remain explicit; physical runs above are separate evidence, not added to this total. |
| Hosted build | Passed, exit 0 at `f6a80a18` | `full-build.log`, `.exit` and `.head`; warnings for unset optional analytics configuration and chunks above 600 kB remain. No deployment or API enablement is implied. |
| Physical decision cycle | 24 passed, exit 0 at `f6a80a18` | `decision-cycle-postgres.log`, `.exit` and `.head`; `server/a1-decision-cycle-surface-integration.test.ts` ran against disposable PostgreSQL, cleanup confirmed absent. This router/database proof does not replace the browser journey. |
| Bounded synthetic browser journey | Completed at `f6a80a18`, 15:50–16:01 UTC; subsequent readback: 13 checks true | Real product operations with auxiliary fixtures, legacy development authentication and a local geocoding stub. Browser file-save completion for JSON/PDF was not verified. Details below. |
| Stored pricing context label | RED: 5 failed, 93 passed; GREEN: all 98 readiness cases passed in the combined seven-file run | Subsequent P2 UI correction; `stored-pricing-label-red.log` and `final-ui-green.log`, with independent mutual/coordinator review. |
| Human-readable export block messages | RED: 19 failed, 12 passed; GREEN: all 31 cases passed in the combined run | Safe explanations preserve canonical codes without exposing unknown payload details; `export-block-messages-red.log` and `final-ui-green.log`. |
| Final UI correction regressions | 160 passed across seven files, exit 0 | Readiness 98, export messages 31, lifecycle 7, client 8, race 4, decision effects 6 and intent 6. Source checkpoint and subsequent complete hook remain separately recorded. |
| Final wording refinement | RED: 3 failed, 28 passed; GREEN: 31 passed, exit 0 | Two final user-facing messages refined after the combined 160-case run; `export-wording-red.log` and `export-wording-green.log`. |
| Final source type/build | UI check: zero errors, exit 0; final wording build: exit 0 | `ui-final-check.log` precedes only the two final text changes; `final-wording-build.log` covers them. The mandatory complete pre-push hook will recheck final HEAD without bypass. |
| GitHub CI/publication/main integration | Resulting observations belong to the GitHub PR/final record | No resulting or published commit is claimed in this source checkpoint. |

An independent Codex reviewer inspected field/derived code, actuals/closeout, the scoped historical guard and affected production callers. Two serious findings (unknown-state deletion/aggregation and partial acceptance of mixed commands) and the public-date input detail were reproduced and corrected. Earlier reinspection confirmed the reviewed blobs at `6f6ce5baed255777a69eecdad72600fa47bf86f0`; final runtime reinspection covered 20 scoped blobs at `f6a80a18` and found no remaining P1/P2 in that slice. This is static source review, not final integrated approval. A further P2 review finding identified Monitoring’s hardcoded zero high-variance count. Five behavioral regressions reproduced it; the correction is now GREEN in the full suite, including all 31 Monitoring DB and 2 UI cases.

The corrected eleven-case operational physical suite passed and its disposable database was removed. Field, pending-actual and closeout fixtures have null estimate references; the retained paid actual links a synthetic calculated draft only to satisfy the legacy committed-cost constraint. No fixture exercises historical ancestry or grants execution authority. These cases do not prove production RLS policy completeness or isolation.

The **331 export cases**, **11 operational reduction cases**, **9 instrumented G3a2 cases** and **24 decision-cycle cases** are distinct attributed run results. They remain separate from the ordinary regression summary of 6,448 passes and 951 skips, which includes skipped opt-in physical suites. Instrumented G3a2 private-body execution does not authorize the held production calibration entrypoints.

Export suite results, each on its own disposable PostgreSQL instance with cleanup confirmed:

| Suite | Passed | Exit |
|---|---:|---:|
| `server/a1-export-physical.test.ts` | 140 | 0 |
| `server/a1-export-preflight-writer.test.ts` | 33 | 0 |
| `server/a1-export-preflight-writer-physical.test.ts` | 15 | 0 |
| `server/a1-export-download-writer.test.ts` | 32 | 0 |
| `server/a1-export-download-writer-physical.test.ts` | 7 | 0 |
| `server/a1-export-download-writer-renderer-unavailable.test.ts` | 1 | 0 |
| `server/a1-export-new-delivery-writer.test.ts` | 20 | 0 |
| `server/a1-export-new-delivery-writer-physical.test.ts` | 5 | 0 |
| `server/a1-export-surface-integration.test.ts` | 76 | 0 |
| `server/a1-export-surface-transport.test.ts` | 2 | 0 |

## Browser journey and readback

The complete bounded synthetic journey ran against `f6a80a18666b8586bde3fe8d208a7f3090221165` on 6 October from 15:50 to 16:01 UTC. Client, project, intake and estimate records were formed through the product. The sequence was **Intake → Projects (explicit geocode) → Calculator → USD/context review → internal approval → export → revocation → new version**. The auxiliary bootstrap supplied only synthetic tenant/operator identity and catalog/geographic prerequisites, with zero clients, projects or estimates before UI use. Authentication used the legacy development mode; the geocoding provider was a local synthetic HTTP stub, while project persistence and zone detection used product code. This is not production authentication, live provider or real-data readiness evidence.

| Observed step | Result |
|---|---|
| Calculation and review | Quantity 2, cost USD 40, price USD 100, gross margin 60%; review confirmed USD and a 42% policy floor. |
| Internal approval | One retained snapshot and one approval decision, with its audit. |
| JSON, PDF and printable delivery | Three server rows marked `downloaded`, with hashes and byte lengths of 3,636, 8,860 and 4,794 respectively. Printable content was observed in its iframe. |
| CSV preflight | `blocked_validation` with `CSV_TAXABLE_UNKNOWN`; no download or invented taxability. |
| Revocation and later JSON attempt | One revocation decision and audit; the later JSON delivery attempt was `blocked_authorization` with `INTERNAL_APPROVAL_REVOKED`. |
| New version | Version 2 remained a `draft` with no approval decision; source version remained revoked and linked to its successor. One version-creation audit was retained. |
| Project boundary | Project remained `intake` / `formation_only`, operational budget and execution milestones stayed absent, and no field, actual-cost or closeout record was created. |

The read-only query returned all **13 assertions true**, including client/project/intake identity, source/successor links, retained approval/revocation evidence, export context and creation audits. Five export attempts were observed: three delivered representations, the blocked CSV preflight and the blocked post-revocation JSON attempt. The local `journey-readback.json` is the database observation; it does not replace browser or transport evidence.

The JSON browser download wait timed out; no PDF download-wait timeout was observed. Server delivery records, byte lengths and hashes were verified, but successful saving of those files on the user's machine was **not** verified. The printable iframe was observed. The snapshot content hash seen before revocation in the UI/printable evidence, `df35842a8154ce3490be047c0330cecf8facf2f4a47b2e4841d1d5d146d10aa1`, matched the later database value. This browser run did not capture complete rows before and after revocation/version creation, so it does not claim full-row equality; the separately attributed 24-case physical decision-cycle suite supplies its own immutability checks.

Cleanup also has two separate observations. The supervisor exited **1**, reporting `EPERM` while checking the static-app and geocoding-stub process groups; its report must not be relabeled as a successful exit. The subsequent `cleanup-independent-verification.json` confirmed all owned PIDs/groups absent, ports 5197/55439/55509 closed, and the disposable PostgreSQL directory gone. The laboratory was therefore independently confirmed removed despite the supervisor's failed group checks.

The browser exposed two P2 presentation issues subsequently corrected: the stored pricing-context label and safe human-readable explanations for export blocks. The label's RED run had five failures and 93 passes; export-message RED had 19 failures and 12 passes. The combined GREEN passed 160 cases across seven files, exit 0, including all 98 readiness and 31 export-message cases. Both fixes received independent mutual review and coordinator review. The final P3 message refinement then reproduced three failures with 28 passes and reached GREEN with all 31 message cases passing. These later UI results belong to source checkpoint `6b01c2a8efb3db2ea92dbdd9d4138bdadf162629` and remain separate from the full regression result at `f6a80a18`. The final wording build passed. The zero-error UI type check preceded only the two final text changes; the mandatory complete pre-push hook will recheck final HEAD without bypass. GitHub CI, publication and main identities belong to the PR/final record.

## Release boundary

The bounded A1 evidence supports internal estimate approval and controlled representation within the stated scope. Issuance, customer acceptance, execution authority, commercial change orders and independent pre-execution costs remain separate work. CSV may be refused for incompatible or unknown taxable information while other representable formats remain available; unknown values must not be filled for a demonstration.

Git deployment of `main` remains disabled by `vercel.json`; the hosted API retains its default denial. Real database baseline, effective application principal, RLS/ACL behavior, migration recovery, environment configuration and real-data operation require their own environment evidence. Local tests, CI and code integration do not supply those approvals.

The final delivery observation must separately record the reviewed source SHA, compared base, resulting commit, independent review, executed checks, skipped checks, CI and publication/main identities. A document cannot contain its own resulting SHA; that final identity belongs in the PR and final delivery record.

## Completion report — validated source checkpoint

This report binds source to `6b01c2a8efb3db2ea92dbdd9d4138bdadf162629` and keeps the earlier immutable inventory below unchanged. It is not a statement that publication or main integration already occurred. The required complete pre-push hook and GitHub result must be recorded on their actual resulting commit.

| Requirement | Evidence and scope |
|---|---|
| TypeScript | Zero errors, exit 0 in `ui-final-check.log`, before only the two final UI text changes; final HEAD will be checked by the mandatory pre-push hook. |
| Tests | Full run at `f6a80a18`: 6,448 passed, 951 skipped, zero failed. Later UI regressions: 160 passed; final wording refinement: 31 passed. These overlap and are not added together. At least 36 new UI cases are directly identifiable (5 readiness + 31 export messages); earlier project work separately reports 27 new cases. No unique grand total of new tests is claimed. |
| Files created/modified | Immutable `e2048c11` inventory below, plus the 12-file source addendum following this table. This documentation update is separate from that source comparison. |
| New tables/functions/helpers/endpoints | Seven tables and the explicitly listed functions/helpers/ten endpoints in the immutable inventory; no additional table, migration or endpoint in the source addendum. |
| Security — F1 | **YES for the scoped new/affected A1 business surfaces:** [historical router](../../server/historical-estimate-router.ts) and [estimate router](../../server/estimate-router.ts) use authenticated `tenantProcedure` or `protectedProcedure`; both reject missing users in [tRPC middleware](../../server/_core/trpc.ts). No `publicProcedure` is used on those scoped business routes. This is not a repository-wide RBAC or production RLS certification. |
| Audit — F2 | **YES for the reviewed A1 writes and retained reductions:** historical source/import call `logAudit` in [historical DB](../../server/historical-estimate-db.ts); internal decisions use its checked audit wrapper in [approval DB](../../server/internal-estimate-approval-db.ts); versioning uses `auditEstimateMutation` in [version DB](../../server/estimate-version-v2-db.ts); export attempts/delivery/refusal use checked audit in [export DB](../../server/internal-estimate-export-db.ts). Retained field/actuals/closeout writes have the scoped behavioral/physical rollback evidence above. No claim is made about every legacy mutation elsewhere. |
| Regressions — F4 | No failing test in the executed GREEN runs listed above; all RED failures were reproduced before correction. The final whole-suite hook result remains a separate publication observation, and skips are not passes. |
| Product journey | Bounded browser journey completed at `f6a80a18`, 13 readback assertions true; download-save, provider/authentication and snapshot-comparison limits remain as recorded above. |

### Source addendum: `e2048c11` → `6b01c2a8`

Read-only Git comparison: **12 changed files, 2 added and 10 modified; +338/-47**. Across observed GitHub base `0bd5d831` → source checkpoint `6b01c2a8`, the aggregate source inventory is **223 files: 149 added and 74 modified, no deletions**. These numbers exclude this uncommitted documentation update and do not rewrite the 220-file `e2048c11` inventory.

Added:

- `server/estimate-export-block-messages.test.ts`
- `server/monitoring-variance-ui.test.ts`

Modified:

- `client/src/components/estimate/EstimateReadiness.tsx`
- `client/src/pages/EstimateDetail.tsx`
- `client/src/pages/Monitoring.tsx`
- `server/a1-operational-reductions-postgres.test.ts`
- `server/calibration-db.ts`
- `server/estimate-readiness-ui.test.ts`
- `server/field-launch-db.ts`
- `server/field-launch-monitoring-historical.test.ts`
- `server/scope-completeness-db.ts`
- `server/sprint21-field-launch-control.test.ts`

## Completion inventory appendix — immutable combined source

This is an inventory of the inherited combined delivery, not a completion verdict. Comparison: observed GitHub main `0bd5d831ad2115fef069e979b0cc89991b52c7f7` → combined local source `e2048c11653041137bf6eb7547f6dc1c8448db2a`. Read-only Git comparison confirms **220 changed files: 147 added, 73 modified, no deleted files**. The local branch named `main` resolves to a different historical commit (`233569d68c014712ce3d25326bda8823aab1987e`); it is not the base used here. Later corrections committed through `f6a80a18` and this documentation update are excluded from these immutable counts; this appendix deliberately preserves the stated `e2048c11` comparison.

Codex’s own closeout corrections add no table or endpoint over `60dc81e9`; Jim’s inherited decision-cycle integration adds the revocation route included in the following combined inventory. Across the full comparison there are **7 new tables**, **10 new mounted endpoints**, **6 new engine files with 42 exported function declarations**, and **7 new DB files with 29 exported function declarations**. Function counts exclude types, constants, classes and exports in other added helper/renderer files; they are a source inventory, not a claim that every export is a public API.

### Tables and new endpoints

New ORM tables, matched by SQL table name in `drizzle/schema.ts`:

- `historical_estimate_sources`
- `historical_estimate_source_lines`
- `historical_estimate_imports`
- `historical_estimate_import_lines`
- `estimate_internal_approval_snapshots`
- `estimate_internal_approvals`
- `estimate_internal_approval_revocations`

New mounted endpoints (existing endpoints whose implementation changed are not counted as new):

- `historicalEstimate.recordSource`, `historicalEstimate.getSource`, `historicalEstimate.getImport`, `historicalEstimate.listSources`.
- `estimate.importHistorical`, `estimate.getInternalApprovalReview`, `estimate.getInternalApproval`, `estimate.getEstimateVersionPreview`, `estimate.revokeInternalApproval`, `estimate.getExportDetail`.

### Exported functions in the new engines

| File | Exported functions |
|---|---|
| `shared/estimate-aggregate-engine.ts` | `prepareEstimateAggregateRow`, `checkedAggregateCount`, `aggregateEstimateStats`, `aggregateEstimateOpportunityPipeline`, `formatEstimateAggregateMoney` |
| `shared/estimate-discount-engine.ts` | `normalizeEstimateDiscountPercent`, `calculateEstimateDraftDiscount` |
| `shared/estimate-version-engine.ts` | `normalizeEstimateVersionPreviewCommand`, `normalizeEstimateCreateVersionCommand`, `normalizeEstimateVersionCopySourceV2`, `hashEstimateVersionCopySourceV2`, `hashEstimateVersionCommandV2`, `buildEstimateVersionPreviewV2`, `projectEstimateVersionDraftV2` |
| `shared/historical-estimate-engine.ts` | `parseHistoricalDecimal`, `decimalToMinorUnits`, `canonicalHistoricalJson`, `normalizeHistoricalSource`, `reconcileHistoricalSelection`, `buildHistoricalSelection`, `buildHistoricalDraftProjection`, `assertHistoricalCaptureOnly` |
| `shared/internal-estimate-approval-engine.ts` | `normalizeApprovalMinor`, `normalizeApprovalDecimal`, `normalizeApprovalPercent`, `refineInternalApprovalFinancialAmounts`, `refineInternalApprovalContentRelationships`, `canonicalizeInternalApproval`, `hashInternalApprovalContent`, `hashInternalApprovalPolicy`, `hashInternalApprovalCommand`, `evaluateInternalApprovalPolicy`, `buildInternalApprovalReview`, `assertInternalApprovalReviewMatch`, `validateInternalApprovalSnapshotRecord` |
| `shared/internal-estimate-export-engine.ts` | `buildExportFilename`, `lineKeyOrdinal`, `exportIssueOrderIsValid`, `normalizeExportManifest`, `computeExactAmountMinor`, `checkExportManifestAgainstSnapshot`, `checkExportCsvRowAgainstLine` |

### Exported functions in the new DB files

| File | Exported functions |
|---|---|
| `server/estimate-aggregate-db.ts` | `getExactEstimateStats`, `getExactEstimatePipeline` |
| `server/estimate-mutation-db.ts` | `withEstimateMutation`, `assertEstimateUndecided`, `assertEstimateNonHistoricalLineage`, `auditEstimateMutation` |
| `server/estimate-version-v2-db.ts` | `getEstimateVersionPreviewV2`, `createEstimateVersionV2` |
| `server/historical-estimate-db.ts` | `recordHistoricalSource`, `importHistoricalEstimate`, `getHistoricalSource`, `getHistoricalImport`, `listHistoricalSources` |
| `server/internal-estimate-approval-db.ts` | `withInternalApprovalTransaction`, `lockInternalApprovalContext`, `assertInternalApprovalCalculatedLineage`, `loadInternalApprovalRows`, `readInternalApprovalRecord`, `getInternalApprovalReview`, `recordInternalEstimateApproval`, `revokeInternalEstimateApproval`, `getInternalApproval` |
| `server/internal-estimate-export-db.ts` | `checkExportAuthorization`, `skillFor`, `createExportAttempt`, `deepJsonEqual`, `downloadExportAttempt`, `createAndDeliverExportAttempt` |
| `server/internal-estimate-reference-db.ts` | `assertInternalEstimateReferences` |

### File inventory

<details>
<summary>147 added files at the immutable comparison</summary>

```text
client/src/components/historical-estimates/HistoricalSourceView.tsx
client/src/lib/decision-intent.ts
client/src/pages/HistoricalEstimates.tsx
docs/architecture/estimate-exact-aggregates-c2b.md
docs/architecture/estimate-exact-discount-a1.md
docs/architecture/estimate-exact-display-c1.md
docs/architecture/estimate-legacy-barriers-c2a.md
docs/architecture/estimate-version-v2-foundations-a1.md
docs/architecture/historical-capture-h1.md
docs/architecture/internal-approval-application-foundations-a1.md
docs/architecture/internal-approval-core-a1.md
docs/architecture/internal-approval-generic-writers-a1.md
docs/release/historical-capture-h1-validation-2026-09-19.md
docs/security/historical-capture-acl-hardening.md
drizzle/0005_historical_estimate_capture.sql
drizzle/0006_historical_estimate_acl_hardening.sql
drizzle/0007_internal_estimate_approval_core.sql
drizzle/0008_internal_approval_membership_serialization.sql
drizzle/0009_internal_approval_policy_serialization.sql
drizzle/0010_internal_approval_historical_link_serialization.sql
drizzle/0011_historical_estimate_prior_source_anchor.sql
drizzle/0012_project_reopen_provenance.sql
drizzle/0013_jobtread_exports_a1_physical.sql
drizzle/0014_a1_export_issue_status_class_fix.sql
server/a1-actuals-closeout-boundary.test.ts
server/a1-authorization-concurrency-physical.test.ts
server/a1-authorization-transaction.test.ts
server/a1-calculated-formation-router.test.ts
server/a1-calculated-formation.test.ts
server/a1-context-absence-concurrency-physical.test.ts
server/a1-decision-cycle-client-effects.test.ts
server/a1-decision-cycle-client-intent.test.ts
server/a1-decision-cycle-surface-integration.test.ts
server/a1-export-csv-renderer.test.ts
server/a1-export-download-writer-physical.test.ts
server/a1-export-download-writer-renderer-unavailable.test.ts
server/a1-export-download-writer.test.ts
server/a1-export-history-summary.test.ts
server/a1-export-json-printable-renderer.test.ts
server/a1-export-manifest-engine.test.ts
server/a1-export-new-delivery-writer-physical.test.ts
server/a1-export-new-delivery-writer.test.ts
server/a1-export-pdf-renderer.test.ts
server/a1-export-physical-concurrency-worker.mjs
server/a1-export-physical.test.ts
server/a1-export-preflight-writer-physical.test.ts
server/a1-export-preflight-writer.test.ts
server/a1-export-surface-integration.test.ts
server/a1-export-surface-transport.test.ts
server/a1-generic-estimate-creation.test.ts
server/a1-generic-estimate-router.test.ts
server/a1-historical-link-ordering-physical.test.ts
server/a1-internal-approval-db-physical.test.ts
server/a1-operational-reductions-postgres.test.ts
server/a1-read-queries-router-integration.test.ts
server/a1-read-queries-router.test.ts
server/a1-version-preview-router-integration.test.ts
server/a1-version-preview-router.test.ts
server/analytics-exact-dependents.test.ts
server/analytics-exact-router.test.ts
server/auth-transaction.ts
server/calculator-project-ui.test.ts
server/estimate-aggregate-db.test.ts
server/estimate-aggregate-db.ts
server/estimate-aggregate-engine.test.ts
server/estimate-aggregate-errors.ts
server/estimate-detail-export-client.test.ts
server/estimate-detail-export-lifecycle.test.ts
server/estimate-detail-export-race.test.ts
server/estimate-discount-engine.test.ts
server/estimate-display.test.ts
server/estimate-exact-display-ui.test.ts
server/estimate-generic-mutations-a1.test.ts
server/estimate-guard-error.ts
server/estimate-legacy-artifact-holds.test.ts
server/estimate-legacy-holds-ui.test.ts
server/estimate-legacy-router-holds.test.ts
server/estimate-legacy-writer-holds.test.ts
server/estimate-mutation-db.ts
server/estimate-mutation-errors.ts
server/estimate-version-adapter.test.ts
server/estimate-version-engine.test.ts
server/estimate-version-v2-db.test.ts
server/estimate-version-v2-db.ts
server/execution-derived-authority.test.ts
server/export-delivery-blocked-message.test.ts
server/field-launch-monitoring-historical.test.ts
server/field-launch-tenant-router.test.ts
server/field-operations-authority.test.ts
server/geo-review-provenance.test.ts
server/historical-estimate-acl-hardening.test.ts
server/historical-estimate-db.test.ts
server/historical-estimate-db.ts
server/historical-estimate-engine.test.ts
server/historical-estimate-field-lineage.test.ts
server/historical-estimate-guard.ts
server/historical-estimate-guards.test.ts
server/historical-estimate-physical.test.ts
server/historical-estimate-router.test.ts
server/historical-estimate-router.ts
server/historical-estimate-schema-security.test.ts
server/historical-estimate-ui.test.ts
server/internal-estimate-approval-adapter.fixtures.ts
server/internal-estimate-approval-adapter.test.ts
server/internal-estimate-approval-adapter.ts
server/internal-estimate-approval-db.test.ts
server/internal-estimate-approval-db.ts
server/internal-estimate-approval-engine.fixtures.ts
server/internal-estimate-approval-engine.test.ts
server/internal-estimate-approval-errors.ts
server/internal-estimate-approval-lab.test.ts
server/internal-estimate-approval-physical.test.ts
server/internal-estimate-export-attempt.test.ts
server/internal-estimate-export-db-deep-json-equal.test.ts
server/internal-estimate-export-db.ts
server/internal-estimate-export-delivery.test.ts
server/internal-estimate-reference-db.test.ts
server/internal-estimate-reference-db.ts
server/lead-conversion-identity.ts
server/pipeline-conversion-audit-v2.test.ts
server/project-barriers-router-integration.test.ts
server/project-db-reopen-mapper.test.ts
server/project-db.test.ts
server/project-form-ui.test.ts
server/project-geocode-review-evidence.ts
server/project-reopen-product-physical.test.ts
server/project-reopen-provenance-regression-control.test.ts
server/project-router.test.ts
server/test-support/project-reopen-0012-v1-reference.sql
shared/analytics-exact-dashboard.ts
shared/domain/cost-codes.ts
shared/estimate-aggregate-engine.ts
shared/estimate-discount-engine.ts
shared/estimate-display.ts
shared/estimate-legacy-hold.ts
shared/estimate-version-engine.ts
shared/execution-authority.ts
shared/export-delivery-blocked-message.ts
shared/historical-estimate-engine.ts
shared/internal-estimate-approval-engine.ts
shared/internal-estimate-export-attempt.ts
shared/internal-estimate-export-csv-renderer.ts
shared/internal-estimate-export-delivery.ts
shared/internal-estimate-export-engine.ts
shared/internal-estimate-export-pdf-renderer.ts
shared/internal-estimate-export-renderer.ts
shared/project-operation-guard.ts
```

</details>

<details>
<summary>73 modified files at the immutable comparison</summary>

```text
.github/workflows/ci.yml
client/src/App.tsx
client/src/components/DashboardLayout.tsx
client/src/components/estimate/EstimateReadiness.tsx
client/src/pages/Calculator.tsx
client/src/pages/Estimate.tsx
client/src/pages/EstimateDetail.tsx
client/src/pages/Monitoring.tsx
client/src/pages/ProjectActuals.tsx
client/src/pages/Projects.tsx
drizzle/meta/_journal.json
drizzle/relations.ts
drizzle/schema.ts
scripts/ed-pilot-lab/app.ts
server/actuals-db.ts
server/actuals-record-authority.test.ts
server/actuals-router.ts
server/analytics-db.ts
server/analytics-router.ts
server/calibration-db.ts
server/calibration-router.ts
server/closeout-db.ts
server/closeout-router.ts
server/db.ts
server/ed-pilot-lab.test.ts
server/estimate-component-extension.test.ts
server/estimate-db.ts
server/estimate-document-export-authorization.test.ts
server/estimate-export.ts
server/estimate-legacy-router.ts
server/estimate-persist-priced.test.ts
server/estimate-readiness-ui.test.ts
server/estimate-router.ts
server/estimate-status-approval-guard.test.ts
server/estimate-version-db.ts
server/field-flow-ui.test.ts
server/field-launch-db.ts
server/field-launch-router.ts
server/field-operations-db.ts
server/field-operations-router.ts
server/geo-integration.ts
server/jobtread-csv-export.ts
server/jobtread-export-db.ts
server/lead-conversion.ts
server/lead-router.ts
server/migration-history-reconcile.test.ts
server/phase2-flow.test.ts
server/pipeline-db.ts
server/pipeline-router.ts
server/project-access.ts
server/project-db.ts
server/project-router.ts
server/rbac.ts
server/routers.ts
server/scope-completeness-db.ts
server/scope-completeness-router.ts
server/sprint18-5-normalization-versioning.test.ts
server/sprint20-1-jobtread-csv.test.ts
server/sprint20-field-launch.test.ts
server/sprint24-lead-router.test.ts
server/sprint26-pipeline-db.test.ts
server/sprint26-pipeline-integration.test.ts
server/sprint26-pipeline-router.test.ts
server/tenant-b2-bundles.test.ts
server/tenant-f5b-project-geo-callers.test.ts
server/tenant-g3a-geo-zones.test.ts
server/tenant-g3a2-calibration-geo-postgres.test.ts
server/tenant-g3a2-calibration-geo.test.ts
server/test-support/ed-pilot-lab.ts
shared/closeout-engine.ts
shared/domain/normalization.ts
shared/domain/taxonomy.ts
tsconfig.json
```

</details>
