# Structr Engineering Decision / Correction Log

Entries are append-only. Never rewrite a prior entry; supersede it explicitly. If later evidence changes an entry, append a new correction that cites both the superseded entry and the new exact-SHA evidence.

## 2026-08-24 — Historical handoff is evidence, not current state

- Status: CORRECTION
- Owner: Human approval authority
- Affected unit: Phase 2 Task 2 / Second Brain initialization
- Source SHA/document: `5ac13470d15a48d89e2f663d8252b11b96d5808f` [security-remediation-handoff.md](../security-remediation-handoff.md); `b95ea0bf4741646f418fcc99a22d22a42d24be51`; [Phase 1 workflow design](../superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md) at `69640ba9accf334b2066f524f60f00791e508b60`; [Phase 2 implementation plan](../superpowers/plans/2026-08-24-controlled-engineering-workflow-initial-integration.md) at `7e7953f50ff89d801fc2c07a20fd8adf236b6836`
- Previous statement/classification: The handoff carried the program's operational current state before G3a-1 implementation began.
- Corrected statement: The handoff remains byte-preserved historical evidence, but it is no longer the current-state source because it predates the `G3a-1-F5a+c` closure at `b95ea0bf4741646f418fcc99a22d22a42d24be51`.
- Decision/correction: Maintain replaceable operational truth in [current-state.md](current-state.md), append corrections here, and continue to link the handoff for the historical state it actually recorded.
- Rationale/evidence: The approved workflow design and plan record the later exact-SHA unit closure and explicitly separate replaceable current state from append-only history.
- Downstream consequence: Recovery must read current state first and use the handoff only within its time and SHA boundary; Task 3, not Task 2, is the separately gated append-only handoff correction.
- Supersedes: Only the handoff's use as the present-state source.
- Does not imply: Historical handoff text may be rewritten, Task 3 has started, or the narrow G3a-1 verdict is a global/merge verdict.

## 2026-08-24 — PostgreSQL is the current database stack

- Status: CORRECTION
- Owner: Human approval authority
- Affected unit: Phase 2 Task 1 and all future implementation units
- Source SHA/document: `806657aecdb4d9ced25cd1f52020ae2870af02ac`; [AGENTS.md](../../AGENTS.md), [package.json](../../package.json), and [server/db.ts](../../server/db.ts) at that SHA
- Previous statement/classification: Repository instructions named MySQL and the `mysql2` driver.
- Corrected statement: Structr uses PostgreSQL with the `postgres` driver.
- Decision/correction: Repository rules, SQL guidance, Drizzle usage, and dependency assumptions must use the current PostgreSQL stack.
- Rationale/evidence: Task 1 reconciled the stale instructions; `package.json` declares `postgres`, and `server/db.ts` imports that driver.
- Downstream consequence: Future plans and reviews must reject MySQL-specific assumptions unless a separately approved migration changes the live repository.
- Supersedes: The stale database wording in `AGENTS.md` before `806657aecdb4d9ced25cd1f52020ae2870af02ac`.
- Does not imply: Any schema, migration, deployment, or Supabase state was changed by Task 1 or Task 2.

## 2026-08-24 — Tenant-aware tRPC boundaries replace the universal protected-only rule

- Status: CORRECTION
- Owner: Human approval authority
- Affected unit: Phase 2 Task 1 and all business-endpoint work
- Source SHA/document: `806657aecdb4d9ced25cd1f52020ae2870af02ac`; [AGENTS.md](../../AGENTS.md) and [server/_core/trpc.ts](../../server/_core/trpc.ts) at that SHA
- Previous statement/classification: Every business endpoint was instructed to use `protectedProcedure` as a universal rule.
- Corrected statement: Use `protectedProcedure` for approved authenticated non-tenant surfaces, `tenantProcedure` for tenant-owned business data, and `adminTenantProcedure` for tenant-scoped administration, as applicable. Named pre-tenant and platform carve-outs remain explicit and cannot be generalized.
- Decision/correction: Authentication, tenant resolution, and administrative role authorization are distinct controls and must be represented by the approved boundary appropriate to the endpoint.
- Rationale/evidence: `server/_core/trpc.ts` defines separate authentication, tenant-context, role, and combined tenant-admin boundaries; Task 1 aligned the repository instructions with those definitions.
- Downstream consequence: An authenticated caller is not presumed authorized for tenant-owned data, and future endpoint reviews must verify the specific boundary rather than match one procedure name universally.
- Supersedes: The universal `protectedProcedure` wording in `AGENTS.md` before `806657aecdb4d9ced25cd1f52020ae2870af02ac`.
- Does not imply: Permission to create new carve-outs or treat unnamed business endpoints as platform-global.

## 2026-08-24 — Historical geo surface count was incomplete

- Status: CORRECTION
- Owner: Security program / human approval authority
- Affected unit: G2 and later geo reviews
- Source SHA/document: `5ac13470d15a48d89e2f663d8252b11b96d5808f`; [security-remediation-handoff.md](../security-remediation-handoff.md), correction register
- Previous statement/classification: The historical Class-G remaining count of 23 routes was treated as a sufficient inventory.
- Corrected statement: That count is obsolete. The documented reproduction found 18 `geoRouter` routes, 24 routes touching or depending on `geo_zones` (13 direct and 11 indirect), and 29 geo-related routes overall; a separate 13-direct-route versus 15-`geoOverride`-surface discrepancy remains unresolved.
- Decision/correction: Never carry the count of 23 into a new gate. Recompute the inventory against the exact authorized HEAD and preserve any discrepancy until evidence resolves it.
- Rationale/evidence: The handoff records the corrected counts and the remaining 13-versus-15 mismatch. The primary artifact that originally produced the number 23 was not located in the available history, so its provenance is not invented here.
- Downstream consequence: G2 scope and proof counts must be generated fresh; no closure claim may depend on the obsolete inventory.
- Supersedes: Historical use of 23 remaining routes as current scope.
- Does not imply: G2 is complete or that any of the replacement counts alone define the final G2 scope.

## 2026-08-24 — Charleston zones and geocoders are not pure platform-reference surfaces

- Status: CORRECTION
- Owner: Security program / human approval authority
- Affected unit: G2, G3a, and G3b classification
- Source SHA/document: `5ac13470d15a48d89e2f663d8252b11b96d5808f` [security-remediation-handoff.md](../security-remediation-handoff.md); current implementation at `806657aecdb4d9ced25cd1f52020ae2870af02ac` in [server/geo-router.ts](../../server/geo-router.ts) and [server/geo-integration.ts](../../server/geo-integration.ts)
- Previous statement/classification: `charlestonZones`, `geocodeAddress`, and `reverseGeocode` were classified as pure platform-reference endpoints.
- Corrected statement: That surface classification was incorrect. `CHARLESTON_ZONES` carries GCHI commercial policy as well as geography, and geocoding surfaces remain behind tenant-aware boundaries in the current implementation.
- Decision/correction: A hard-coded constant or the absence of a direct database read does not establish platform-reference ownership. Commercial modifiers, floors, service areas, and tenant policy must not be exposed as shared fallback data.
- Rationale/evidence: The handoff correction register identifies the classification error; current code separates projected geography from GCHI policy and keeps the geocoders tenant-aware.
- Downstream consequence: G2/G3 reviews must classify data semantics and consumers, not only storage access, and G3b must address the remaining service-area policy.
- Supersedes: The affected platform-reference rows in the historical [Class-G remediation plan](../security/class-g-reclassification-and-remediation-plan.md).
- Does not imply: All geo reference data is tenant-owned or that geocoding itself is forbidden as an approved platform capability.

## 2026-08-24 — Admin role authorization is not tenant identity

- Status: CORRECTION
- Owner: Security program / human approval authority
- Affected unit: All tenant-owned administrative operations
- Source SHA/document: `5ac13470d15a48d89e2f663d8252b11b96d5808f` [security-remediation-handoff.md](../security-remediation-handoff.md); [server/_core/trpc.ts](../../server/_core/trpc.ts) at `806657aecdb4d9ced25cd1f52020ae2870af02ac`
- Previous statement/classification: `adminProcedure` was treated as sufficient evidence of tenant isolation or tenant identity.
- Corrected statement: `adminProcedure` proves an administrative role; it does not resolve or prove tenant identity. `adminTenantProcedure` combines the tenant boundary with the admin-role check.
- Decision/correction: Tenant-owned administrative operations require a trusted tenant boundary in addition to role authorization.
- Rationale/evidence: The implementation checks only `ctx.user.role` in `adminProcedure`, while `adminTenantProcedure` composes tenant resolution and the role check.
- Downstream consequence: Reviews must reject admin-role-only authorization for tenant-owned data unless an explicitly approved platform exception applies.
- Supersedes: Any route classification that equated the admin role with a tenant axis.
- Does not imply: Every admin operation is tenant-owned; named platform administration remains subject to its explicit approved boundary.

## 2026-08-24 — rule-F5 means transaction atomicity, not the tenant predicate

- Status: CORRECTION
- Owner: Security program / human approval authority
- Affected unit: G1 `rule-F5` and multi-step mutation reviews
- Source SHA/document: `9755cfe127b5c1234ff4b63edda1392f5b6223ff`, `9c8ded31cf82c10456f1931a8830b50d53483a59`, and `b95ea0bf4741646f418fcc99a22d22a42d24be51`; [AGENTS.md](../../AGENTS.md) and [server/geo-db.ts](../../server/geo-db.ts)
- Previous statement/classification: A final `tenant_id` mutation predicate was labeled as satisfying `rule-F5` in earlier G3a-1 test evidence.
- Corrected statement: A tenant predicate is an isolation control. `rule-F5` requires `db.transaction()` atomicity for a multi-step workflow; the two controls are complementary.
- Decision/correction: A multi-step mutation is not closed for `rule-F5` merely because its final statement contains `tenant_id`.
- Rationale/evidence: `9c8ded31cf82c10456f1931a8830b50d53483a59` moved the G3a-1 read/update/readback workflow into a transaction, and `b95ea0bf4741646f418fcc99a22d22a42d24be51` ensured failed readback rolls it back.
- Downstream consequence: Open repository-level multi-step flows must receive their own atomicity proof; tenant scoping cannot substitute for it.
- Supersedes: The narrow earlier label that called a tenant mutation predicate `rule-F5` proof.
- Does not imply: The repository-level G1 `rule-F5` blocker is closed; only the exact `G3a-1-F5a+c` workflow received the cited closure.

## 2026-08-24 — G3a-1-F5a+c is closed only at its reviewed SHA and scope

- Status: APPROVED DECISION
- Owner: Independent Codex reviewer and human approval authority
- Affected unit: `G3a-1-F5a+c`
- Source SHA/document: `b95ea0bf4741646f418fcc99a22d22a42d24be51`; [Phase 1 workflow design](../superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md) at `69640ba9accf334b2066f524f60f00791e508b60` and [Phase 2 implementation plan](../superpowers/plans/2026-08-24-controlled-engineering-workflow-initial-integration.md) at `7e7953f50ff89d801fc2c07a20fd8adf236b6836`
- Previous statement/classification: The pre-implementation security handoff described G3a-1 as not started and therefore no longer represents current state.
- Corrected statement: `G3a-1-F5a+c` is CLOSED with independent Codex GO at exactly `b95ea0bf4741646f418fcc99a22d22a42d24be51`.
- Decision/correction: Preserve the unit verdict as exact-SHA, exact-scope evidence; use this current-state correction without rewriting the historical handoff.
- Rationale/evidence: The approved workflow design and implementation plan record the closed checkpoint and the independent Codex verdict after the implementation and atomicity corrections.
- Downstream consequence: Future work starts after the closed unit but must not rerun or broaden its verdict without a new authorized gate.
- Supersedes: Only the current-state assertion in the earlier handoff; the handoff remains historical evidence for the state it recorded.
- Does not imply: PR #9 merge GO, a defensible global B2 claim, or completion of F5b, G3a-2, G3a-3, G2, or G3b.

## 2026-08-24 — Permanent service-area and lead-engine policy remains G3b

- Status: PREVENTIVE DECISION / REJECTED INFERENCE
- Owner: Security program / human approval authority
- Affected unit: G3b
- Source SHA/document: `9755cfe127b5c1234ff4b63edda1392f5b6223ff`; [security-remediation-handoff.md](../security-remediation-handoff.md) at `5ac13470d15a48d89e2f663d8252b11b96d5808f`; current [shared/lead-engine.ts](../../shared/lead-engine.ts) at `806657aecdb4d9ced25cd1f52020ae2870af02ac`
- Rejected inference (not an evidenced historical assertion): Closing G3a-1 also closes permanent service-area policy and every lead-scoring consumer of `CHARLESTON_ZONES`.
- Corrected statement: Permanent tenant-configurable service-area policy remains G3b. `shared/lead-engine.ts` remains an explicit downstream consumer outside the G3a-1 closure.
- Decision/correction: Keep operating-center, radius, fallback policy, and lead-engine impact out of the G3a-1 verdict and inside a separately authorized G3b unit.
- Rationale/evidence: The G3a-1 implementation records this non-claim, the handoff assigns permanent service-area architecture to G3b, and current code still uses `CHARLESTON_ZONES` in lead scoring.
- Downstream consequence: No current document may claim tenant-specific service-area or lead-score behavior is complete; G3b must measure and govern those consumers.
- Supersedes: none.
- Does not imply: G3b has started or that Task 2 authorizes implementation.

## 2026-08-24 — PR #9 global claim remains not defensible

- Status: PREVENTIVE DECISION / REJECTED INFERENCE
- Owner: Human approval authority
- Affected unit: PR #9 and the global B2 claim
- Source SHA/document: [PR #9](https://github.com/wcvmsilva/structr-ai/pull/9) live at 2026-08-24 17:01 EDT; [security-remediation-handoff.md](../security-remediation-handoff.md) at `5ac13470d15a48d89e2f663d8252b11b96d5808f`; [Phase 1 workflow design](../superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md); [Phase 2 implementation plan](../superpowers/plans/2026-08-24-controlled-engineering-workflow-initial-integration.md)
- Rejected inference (not an evidenced historical assertion): A narrow unit GO or green checks are sufficient to make the PR-wide B2 claim defensible.
- Corrected statement: PR #9 remains OPEN, unmerged, and NO-GO at head `b95ea0bf4741646f418fcc99a22d22a42d24be51`; the global B2 claim is not defensible.
- Decision/correction: Lower gates cannot emit merge GO or promote their scoped proof to a repository-wide tenant-safety claim.
- Rationale/evidence: The approved workflow requires all remaining units, final exact-HEAD independent review, open blocker closure, and deployment/live-state preconditions before a global claim can be evaluated.
- Downstream consequence: Every gate record must state explicit non-claims and preserve the PR merge gate as NO-GO until human authority changes it on complete evidence.
- Supersedes: none.
- Does not imply: PR #9 should be closed, edited, merged, or otherwise mutated by Task 2.

## 2026-08-24 — Nullable tenant ownership never implies GCHI/global ownership

- Status: PREVENTIVE DECISION / REJECTED INFERENCE
- Owner: Human approval authority
- Affected unit: All data-ownership classification and G2/G3 reviews
- Source SHA/document: `7c5d14877928ecc0e0657c278da8a00b6afe01f7`; [ADR-001](../adr/ADR-001-structr-data-ownership-model.md)
- Rejected inference (not an evidenced historical assertion): A nullable `tenant_id`, or a row whose tenant value is absent, could be treated as GCHI/global by inference.
- Corrected statement: Nullability alone never establishes platform-global or GCHI ownership. Ownership follows the approved data model and explicit provenance.
- Decision/correction: Fail closed on ambiguous ownership; require affirmative classification evidence rather than inferring global scope.
- Rationale/evidence: ADR-001 explicitly rejects using NULL as a semantic shortcut for global ownership.
- Downstream consequence: Inventories, migrations, queries, and reviews must keep ambiguous rows unresolved until a separately approved rule classifies them.
- Supersedes: none.
- Does not imply: Existing nullable rows are automatically tenant-owned; their ownership remains evidence-dependent.

## 2026-09-03 — Task 6 no-mutation dry run is approved and closed

- Status: APPROVED DECISION
- Owner: Human approval authority
- Affected unit: Controlled Engineering Workflow Phase 2 / Task 6
- Source SHA/document: `23a3e3278bcd38f04b4316dfd7d9c5e58690a05d`; [Phase 1 workflow design](../superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md); [Phase 2 implementation plan](../superpowers/plans/2026-08-24-controlled-engineering-workflow-initial-integration.md)
- Previous statement/classification: [current-state.md](current-state.md) at `23a3e3278bcd38f04b4316dfd7d9c5e58690a05d` still classified Task 6 as blocked pending publication of the recovery-state correction and a fresh no-mutation rerun.
- Corrected statement: The recovery-state correction was published at `23a3e3278bcd38f04b4316dfd7d9c5e58690a05d`; the fresh Task 6 dry run at that exact SHA returned PASS; initial and final HEAD were identical; both working-tree observations were clean; and zero repository mutation was confirmed.
- Decision/correction: The human reviewed and accepted the exact-SHA dry-run PASS and formally closes Task 6.
- Rationale/evidence: The dry run recovered the closed `G3a-1-F5a+c` posture, required workflow sequence, blockers, next-action boundary, and explicit non-claims exclusively from repository-local sources while preserving a clean tree and unchanged HEAD.
- Downstream consequence: Replace the obsolete Task 6 BLOCKED wording in current state. After separately authorized closure-record commit and publication gates, the next recommended major planning unit is `Canonical Structr Product & Engineering Truth v1`, beginning with recovery/design only. Selected workflow automation or enforcement remains deferred until that canonical truth is finalized and separately approved.
- Supersedes: Only the Task 6 BLOCKED, uncommitted-correction, rerun-required, and associated next-action statements in [current-state.md](current-state.md) at `23a3e3278bcd38f04b4316dfd7d9c5e58690a05d`.
- Does not imply: PR #9 merge or modification; modification of `main`; a defensible global B2 claim; F5b, G3a-2, G3a-3, G2, or G3b authorization; security implementation; automation or enforcement; migration, backfill, seed, `TENANT_STRICT`, Supabase, or live-database work; commit or push authorization; or authorization to begin the next planning unit.

## 2026-09-17 — Workflow Visualization UUID contract is locally closed and G2 is reconciled without a global closure claim

- Status: APPROVED DECISION / CURRENT-STATE CORRECTION
- Owner: Human approval authority, with independent read-only review
- Affected unit: Workflow Visualization UUID Round-trip Contract; G2 current classification; next Class-G design boundary
- Source SHA/document: code `cb1a2048b560c40d558c68b1f3806d1ade2a3ce7`; documentation `363616b80e7a36c47365de9c76eaa60cfee9edb4`; local human closure `7dad361432558b2c56bdc672650a7a971996d8b2`; G2 reconciliation `719fc4d9872571748a254a0a9037f12e97cc96a6`
- Previous statement/classification: The published workflow current state at `f60cf9a5` described G2 as future work not started, while the UUID evidence at `363616b8` still recorded human closure as the next pending decision.
- Corrected statement: The UUID contract is locally CLOSED at the exact SHAs above. G2 now has separately evidenced CRUD, list/aggregate, resolution and history recuts, but G2 as a whole remains open because seed atomicity, preview parent semantics, catalog dependencies, field follow-ups and environment preconditions retain separate dispositions.
- Decision/correction: Preserve every narrow SHA-bound verdict and reject both stale “not started” wording and an unsupported “G2 complete” promotion. The next sequential Class-G candidate is G4a; starting its Recovery/Design remains blocked pending explicit human authorization.
- Rationale/evidence: The local candidate inventory contains 13 direct G2 endpoints, split 7 `tenantProcedure` and 6 `adminTenantProcedure`; independent reviews accepted the UUID closure append and G2 reconciliation. G4a measurement identified unresolved pre-tenant consumers and tenant-stamped component dependencies that require design decisions before RED.
- Downstream consequence: Replace the concise current-state record. Keep G4a implementation blocked until its design is approved; keep seed `rule-F5`, preview parent policy, G1 rules, integration and environment work visible as separate blockers.
- Supersedes: Only the obsolete current-state classifications that G2 and the UUID unit had not started or had not received human closure.
- Does not imply: G2 global closure; G4a approval or implementation; PR #9 merge GO; a defensible global B2 claim; production readiness; field release; push, PR mutation, merge, deploy or database work.

## 2026-09-17 — Data API containment does not establish RLS or database-path safety

- Status: CURRENT-STATE CORRECTION / PREVENTIVE DECISION
- Owner: Human approval authority
- Affected unit: Production containment and field-readiness preconditions
- Source observation: Supabase project (identifier withheld in this publication copy) observed read-only on 2026-09-17 as `ACTIVE_HEALTHY`; dashboard Data API switch disabled with no schemas queryable through `/rest/v1`; administrative inventory reporting 60 tables with RLS disabled
- Rejected inference: Data API disabled means the database and all application access paths are tenant-safe, or `ACTIVE_HEALTHY` means security-ready.
- Corrected statement: Disabling the Data API contains the observed PostgREST surface only. It does not prove the safety of PostgreSQL connections, grants, service roles or other paths. Sixty RLS-disabled tables prevent any global claim of RLS protection or field readiness.
- Decision/correction: Keep the Data API disabled until a separately approved compatibility and policy plan exists. Do not enable RLS indiscriminately: tables without policies can become unavailable to the application.
- Rationale/evidence: The dashboard supplied the authoritative switch state, while the management inventory supplied the RLS posture. Those facts describe different controls and must not be collapsed into one claim.
- Downstream consequence: Environment identity, connection role, grants/policies, recovery and representative end-to-end testing remain deploy preconditions. RLS/Data API changes require their own reviewed rollout and rollback plan.
- Supersedes: Any inference that the earlier email alert was globally resolved merely by disabling the Data API, or that RLS warnings prove an active REST exposure while the API is disabled.
- Does not imply: An observed exploit, permission to query production rows, authorization to enable RLS or the Data API, a migration/backfill decision, PR #9 merge GO or field release.

## 2026-09-17 — G4a is superseded and the G4b Catalog Ownership Design is locally closed

- Status: APPROVED DECISION / CURRENT-STATE CORRECTION
- Owner: Human approval authority, with independent read-only review
- Affected unit: G4a implementation disposition; G4b Catalog Ownership Architecture Design; next Class-G transition boundary
- Source SHA/document: G4b Design commit `8c2fdfb630933259998fa98616b2ae08e2ce32ad`, parent `719fc4d9872571748a254a0a9037f12e97cc96a6`, file `docs/security/g4b-catalog-ownership/2026-09-17-design.md`, SHA-256 `fb2c5ad7622e099524dd4c21dd52da1b7109b6dec912136c113c4e497e923228`, Git blob `93d8a76709420255d6ef0e9d39185710f5d46090`; prior workflow current state `e6570c408764b1fd63fbfe2937a46a8f53189ec0`; published workflow authority `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`
- Review evidence: pre-commit reviewers `/root/g4b_pass_security_v2`, `/root/g4b_pass_surface_v2` and `/root/g4b_pass_workflow_v2` returned PASS for the final digest; exact-SHA reviewers `/root/g4b_pass_security_v2` and `/root/g4b_pass_workflow_v2` returned `EXACT-SHA PASS` for `8c2fdfb630933259998fa98616b2ae08e2ce32ad`, its parent, single-file boundary, digest and explicit non-claims. The human then issued explicit GO to close the Design and prepare this documentation-only reconciliation.
- Previous statement/classification: The workflow current state at `e6570c408764b1fd63fbfe2937a46a8f53189ec0` named G4a as the next sequential Class-G design unit and listed G4b architecture as a future follow-up. The committed G4b document itself recorded exact-SHA independent review and human textual approval as pending gates at its writing boundary.
- Corrected statement: The G4a Recover found that the NULL-only interim carve-out cannot preserve the current catalog-dependent revenue path without violating ADR-001, so G4a is NO-GO and superseded for implementation. The exact-SHA reviews and human GO close the G4b Design only; they do not start G4b-1 or any implementation unit.
- Decision/correction: Adopt the exact-SHA G4b architecture as the approved Design boundary: explicit catalog ownership; an initially empty canonical set; existing catalog rows treated as unclassified until separately evidenced and approved; tenant-owned commercial state; and eight separately gated G4b units. G4b-1 read-only Recover/Design is the next possible unit but remains BLOCKED pending completion of this reconciliation and a new explicit human GO.
- Rationale/evidence: The Design records 15 tenant-stamped assemblies, 117 assembly-item links, 460 tenant-stamped cost codes, 598 pricing-history rows, 7 cost types and 22 units. The prior default-tenant backfill means those stamps prove structural consistency, not provenance. A literal G4a implementation would either remove all visible catalog data from Calculator, Scope and Estimate or expose tenant-stamped data globally.
- Downstream consequence: Replace the concise current-state record; execute no G4a patch; retain G2, G1, integration, environment and field-readiness blockers; require a new gate for G4b-1 and a distinct human GO for every later plan, implementation, data operation, publication or program transition.
- Supersedes: Only the next-unit classification in the 2026-09-17 “Workflow Visualization UUID contract is locally closed and G2 is reconciled without a global closure claim” entry, the G4a/G4b statements in `current-state.md` at `e6570c408764b1fd63fbfe2937a46a8f53189ec0`, and the committed Design's pre-closure pending-status statement. It does not rewrite those historical artifacts or supersede their G2/UUID conclusions.
- Does not imply: G4b implementation or program closure; authorization to begin G4b-1; an implementation plan; RED, GREEN or production code; schema, migration, classification, backfill, seed or live-data work; Supabase, RLS, Data API, grant or policy mutation; G3b or G4c closure; PR #9 modification or merge GO; a defensible global B2 claim; production readiness; field release; commit, publication, push, deploy or merge authorization.

## 2026-09-18 — Reconcile published truth, local closures and the review candidate

- Status: CURRENT-STATE CORRECTION / AUTHORIZED RECONCILIATION
- Authority: Current user request to pause hours work, finish pending documentation and reconcile agent progress with GitHub; coordinator observations of remote refs and independent local-document inspection.
- Sources: published workflow closure `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`; later local workflow snapshot `0db4499cc6be577d1c1bf408c624968a7c7f67e3`; remote main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`; accumulated local base `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`; [current state](current-state.md) and [coordinator reconciliation](progress-reconciliation-2026-09-18.md).
- Correction: Tasks 1–6 remain closed. PRs #12/#13 published the canonical documents. Neither publication nor local maintenance acceptance verifies every canonical capability or completes an operational release. Do not carry task2/3/4 historical “not started” classifications into current work.
- Correction: G4b-1 Recover occurred after the 0db snapshot; [original Recover](../security/g4b-catalog-ownership/2026-09-17-g4b-1-recover-design.md) and [append-only correction](../security/g4b-catalog-ownership/2026-09-17-g4b-1-recover-correction.md) preserve NO-GO/STOP for Plan/implementation/G4b-2, with migration history FAIL. This entry does not refresh live-environment measurements or relax those findings.
- Correction: Accepted 18 September candidates resolve bounded local Sprint17 type, coastal-seed transaction, Review state, preset-delete audit and bundle-item transaction defects. The preview-parent work closes measurement only; parent-policy correction remains open. Later final mission acceptances govern the frozen intermediate documents' pending-review wording, without rewriting those snapshots.
- Correction: F5b implementation is already inherited; its formal final closure/retrospective was not located by the lineage review. C-20 scope/design/preparation documents remain proposals with M00 partial. Their four local executable preparation artifacts are not imported. In particular, the old approval characterization that expected generic approval now conflicts with the candidate's explicit rejection and cannot be imported unchanged as current acceptance evidence.
- New review boundary: An isolated branch starts at remote main, reconciles the accumulated candidate and bounded readiness work, and prepares a draft review submission. Its final checks, resulting commit and publication are separately recorded by the coordinator. Earlier pass counts/hashes remain predecessor evidence, not an automatic pass for this integration.
- Supersedes: Only stale current-state/next-action descriptions and the named locally resolved defect status. Does not reopen approved workflow tasks, rewrite historical evidence or promote local code to merged code.
- Publication treatment: The source log remains intact in its original worktree/commit. This copy withholds the historical Supabase project identifier; dates, findings and verdicts are preserved. No live database query was performed for this correction.
- Does not imply: PR #9 modification/merge GO; global B2 closure; G4b or C-20/C-21/C-22 implementation; production/field readiness; approval of commercial terms or ownership classification; automatic migration replay, backfill, live-data or deployment authority. Hours/pay-period work remains paused.
