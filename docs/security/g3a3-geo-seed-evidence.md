# G3a-3 — operational geo seed evidence

**Independent result: Layers 1–8 PASS / narrow G3a-3 GO at the implementation SHA below. Formal human acceptance/closure remains pending; delegated documentary delivery/publication has its own observations.**

## Reviewed subject and authority

Repository: https://github.com/wcvmsilva/structr-ai. Reviewed implementation: `4c243ccaa65bf1e3eb9332152977cf7781428d5e`, compared with `7e329db54d45d9e2a6993a747a224a64f3b609d4`. Observation: 2026-09-15 UTC. This is a bounded correction to the existing operational geo seed, not a new domain or a whole-sprint/global security claim.

The user accepted the recommended option A after the explicit scope packet: retain the five legacy geo zones and retire automatic co-seeding of twelve coastal price-book items. The user's prior instruction, “Autorizado! Seguimos próximos passo até próximo ponto do nosso escopo com pré aprovação automaticamente,” delegates routine implementation, proof, review, separate commits and candidate-branch publication within this unit. It does not authorize operational data changes, merge, a new unit's ownership decisions or Phase 3. Formal acceptance of the final exact-SHA unit review is recorded separately from that execution delegation.

Authority is kept in its original lineage:

- `docs/security-remediation-handoff.md` §16 and ADR-001 at the compared security-derived base define the unit: no NULL-owned creation or discovery of another tenant's zone by global name; explicit owner, loud refusal when missing, no GCHI/default inference.
- Controlled Engineering Workflow, Security Gate and decision/correction records were consulted at workflow SHA `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`. Old NOT STARTED statements retain their historical observation windows.
- Product authority and maintenance procedure were read from `main` SHA `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`: `docs/product/canonical-structr-truth-v1.md` (blob `b9e144e5b25b0c9dcfbcc0790b12931bc78713b2`) and `docs/product/feature-evidence-maintenance.md` (blob `6455caef19bbabb293ffd9104c67a5b73f487988`). This commit object is absent locally; GitHub reads were pinned to the exact SHA and returned content matched each blob hash. No fetch/pull or copy into this repository lineage occurred.
- Task 6 and documentary publication through PRs #12/#13 remain completed. G3a-2 is human-closed at its bounded implementation `bb070eb457eaacc741172162fd6100842aae0804`, with closure supplement `7e329db5`; F5b remains closed/published as an ancestor. None of those verdicts transfers to G3a-3.

The approved scope packet and reviewed implementation plan are in `/private/tmp/structr-g3a3-planning-20260915/`; their fingerprints and raw evidence are identified below. Conditional reuse of `server/geo-db.ts` and the two PostgreSQL proof files was selected in that plan.

## Observable behavior and exact file boundary

Before this change the standalone command looked up zone names globally, inserted zones without tenant ownership, then queried/inserted coastal price-book items. Its raw INSERT also omitted the current required `name` and serialized ZIPs as JSON text instead of a PostgreSQL text array. The batch had no transaction/audit and only closed its connection on success.

The command now requires a nonempty UUID in `SEED_TENANT_ID`, canonicalizes its case/whitespace, requires `DATABASE_URL`, and verifies that exact tenant exists. It never selects a slug/default tenant or creates one. All five zone existence checks, creations and ownership readbacks run in one transaction. Only an existing own-tenant name is skipped; B/NULL records remain untouched. Any business failure rolls back the newly created batch. Serial repeat preserves existing IDs and edited policies. Concurrent deduplication is not guaranteed.

All five legacy ZONES objects are byte-identical to the previous source, including descriptions, ZIP order and financial values. The explicit mapping adds required `name`, uses text arrays and correct numeric representations without recalculating policy. This preserves legacy commercial values, including the Summerville floor; it is not a financial-policy recalibration. The previous twelve-item price block is removed; this command performs no price-book query or write and deletes no existing item.

| File | Change |
|---|---|
| `scripts/seed-geo-zones.mjs` | Modified existing command; exported `runGeoSeed`, explicit tenant/config guard, legacy data mapping, shared scoped TypeScript loader, deterministic client/runtime cleanup, import-safe and symlink-safe direct entry, geo-only behavior. |
| `server/geo-db.ts` | Additive `seedOperationalGeoZones`; existing geo functions remain unchanged. Reuses private strict lookup/insert/readback primitives and existing `logAudit`. |
| `server/tenant-g3a3-geo-seed.test.ts` | New 46-case behavioral suite invoking the actual command with controlled dependency boundaries. |
| `server/tenant-g3a3-geo-seed-postgres.test.ts` | New 17-case real PostgreSQL suite invoking actual entry/helper with isolated acquisition and audit boundaries. |
| `server/test-support/g3a3-postgres.ts` | New explicitly enabled, owned disposable PostgreSQL harness. |

No schema, migration, router, endpoint, engine, UI, dependency, package, environment file, hook or CI changes. No new tables. No business endpoint was added, and existing protected/tenant procedure contracts are preserved. There is no application/package consumer of this standalone command in the measured tree; absence of repository callers does not prove absence of external operational use.

Audit calls follow a successful business commit and contain the created row's explicit owner. The existing audit helper is awaited; a null result is reported as unconfirmed persistence and produces failure status while explicitly retaining committed zones. Unexpected postcommit audit throws likewise cannot undo the zones; they may stop subsequent audit attempts. No durable/atomic audit-storage guarantee or automatic retry is claimed. The CLI closes the same pool used by the helper and then unregisters its scoped runtime, including error/partial-import paths.

## Acceptance and execution proof

All fresh candidate executions below are bound to `4c243ccaa65bf1e3eb9332152977cf7781428d5e`. Every record captured before/after SHA, all five file hashes, equality with commit blobs, a clean checkout, complete raw log, exit status and log SHA-256. No mutation occurred during these checks.

| Acceptance boundary | Observed evidence |
|---|---|
| Missing/blank/invalid tenant fails before runtime/client activity; DEV tenant is not a fallback | Normal actual-entry tests; unchanged baseline executes improperly. Direct JS helper guards are additional candidate defense. |
| Unknown tenant creates nothing and never provisions another owner | Normal tests plus successful-baseline/denied-candidate PostgreSQL contrast. Tenant row selection is exact equality with key-share lock. |
| Matching names owned by B or NULL do not suppress A's five rows or change/disclose those records | Normal and actual PostgreSQL A/B/NULL contrasts; output is creation count/errors rather than foreign rows. |
| Only own names skip; serial repeat and existing edits are preserved | Normal and PostgreSQL own/mixed/repeat positive controls. No overwrite/backfill. |
| Explicit owner stamp, required name, ZIP arrays, exact legacy values | Normal actual-entry values and direct-helper payload defense; exact-schema PostgreSQL persistence and type query; source dataset byte comparison. |
| Failure rolls back the whole new batch, including failed ownership readbacks | Normal empty-batch insert+cleanup-failure contrast; real PostgreSQL third-insert error, suppressed INSERT and immediate/final-insert ownership rewrites. |
| Audit only follows committed creations with owned snapshots | Normal behavior and independent PG observer see the full committed batch before each audit; rolled-back batches emit none. Null/throw audit cases retain committed data and signal failure. |
| Cleanup and inert import; native runtime uses the same pool | Normal lifecycle cases plus actual Node/tsx singleton-state smoke with blocked synthetic DB acquisition, for canonical and symlink paths. |
| Retired price co-seeding | No query/write in normal or PG candidate traces; legacy performs 12 sentinel SKU SELECTs in the successful PG contrast. |
| Previous-HEAD contrast is causal, with controls and exclusions | Same proof files on unchanged base; distinctions below prevent schema/API absence from being called security proof. |
| Existing regressions and technical checks | Fresh full suite, project/test typechecks, focused suite and static measurement; no failures. |

| Exact command / check | Result |
|---|---|
| `pnpm check` | PASS, zero TypeScript errors. |
| `pnpm test` | 2,833 passed, 152 skipped, zero failures; 68 files passed, five files skipped (four PostgreSQL suites plus `count.test.ts`, which is gated by `DATABASE_URL`). |
| `pnpm exec vitest run server/tenant-g3a3-geo-seed.test.ts` | 46/46 passed. |
| `G3A3_POSTGRES=1 pnpm exec vitest run server/tenant-g3a3-geo-seed-postgres.test.ts` | 17/17 passed in owned disposable PG17. |
| Two external no-emit configs including new normal/PG test and support files | Both passed; tests excluded by project check were checked separately. |
| Native Node entry smoke, canonical path and `/tmp` alias | Both passed with real scoped tsx loading; only a fail-closed synthetic DB boundary was reached. |
| `pnpm audit:tenant` | Exit 0; 83 tables, 39 tenant-scoped/44 global, **44 warnings and six known gaps**. Measurement only; the `.mjs` is outside scanner selection. |
| `GIT_OPTIONAL_LOCKS=0 git diff --check 7e329db5 4c243cca` | PASS for the committed delta. |

There are **63 new cases: 46 normal and 17 opt-in PostgreSQL**. The normal suite's 152 skips comprise the inherited 135 and these 17 PG cases, which passed separately. Other inherited opt-in suites were not freshly executed and are not presented as passed here. Existing test diagnostics remain in the raw output.

### Previous-HEAD classification

Base: `7e329db54d45d9e2a6993a747a224a64f3b609d4`; production unchanged, only the three byte-identical proof/support files overlaid.

- Normal suite: **43 failed, three controls passed**. Ten failures concern the new helper API being absent; these are not previous-HEAD security proof. The other entry-level failures are classified by their actual assertion, not pooled into a blanket security count.
- The empty-state test `preserves the operation failure when shutdown also fails` is the valid partial-write contrast: the old entry reports the injected third-insert error, then fails the zero-persisted-rows assertion with exactly two prior raw writes. The candidate rolls them back. The separately preloaded B/NULL mid-failure case instead demonstrates global-name skipping in the old source; it is not independently labeled an atomicity contrast.
- PostgreSQL baseline selection `-t 'contrast|control'`: **four expected assertion failures, one passing control**, twelve exact-schema cases deliberately unselected. All five executed legacy invocations themselves complete successfully: B/NULL names leave A with zero instead of five; own-repeat performs 12 price SELECTs; unknown owner succeeds. Existing own rows/SKUs/cleanup pass unchanged.
- The old INSERT is incompatible with current schema, so the twelve candidate exact-schema cases do not claim a PostgreSQL baseline security failure. A minimal preloaded price sentinel makes legacy SELECTs executable without pretending to reproduce its unknown price schema.
- Native baseline smoke fails because the old command attempts the guarded direct driver; the candidate instead reaches the actual helper through the real scoped loader and closes the same synthetic pool. This is native runtime/lifecycle evidence, not a live-database proof.

The internal review found and reproduced a silent exit when argv used the macOS symlink path. A real-filesystem test failed (one failure/45 passes) before the narrow realpath correction and passed afterward. The existing TypeScript environment import was observed to be erased by the installed runtime; no unnecessary JWT/Supabase credential requirement or environment spoof was added.

### Environment and reproducibility limits

Installed Node v24.14.0, tsx 4.20.6 and Vitest 2.1.9 were used; dependencies were not installed. The native smoke uses an empty disposable cwd, synthetic configuration, real entry/tsx/helper imports, and controlled DB-module acquisition/direct-driver hooks that refuse any real connection. It proves the tested error-path singleton/cleanup; import-only inactivity is demonstrated by the normal suite and source, not by a native success connection.

The PostgreSQL harness accepts no external URL/data directory, rejects inherited database configuration, creates a private cluster and Unix socket under `/private/tmp`, disables TCP, verifies identity and owns cleanup. Schema fixtures derive current geo/tenant columns, defaults, PK and NOT NULL; deployed FK/RLS and unrelated schema are not reproduced. The audit sink is substituted. The actual seed entrypoint ran only against controlled fixtures. No operational database, Supabase, migration, operational seed or backfill ran. Final process/directory inventory found no owned PG server or cluster directory remaining.

Initial sandbox IPC/shared-memory failures are preserved separately as infrastructure failures; they are not security RED. Authorized retries ran only the static scanner/private test cluster. All final required commands completed successfully. Final ownership rereads cover the tested pre-commit business boundary, not arbitrary deferred/commit-time database behavior.

## Capability impact — classifications unchanged

The following matrix uses the published maintenance procedure and canonical IDs. Every capability retains its implementation classification, operational validation, security classification, confidence, verification state, lifecycle and roadmap. Both canonical registry views and their totals remain untouched; no row is promoted to CURRENT. P-09 remains INSUFFICIENT EVIDENCE TO CLASSIFY.

| Capability | Impact | Before → reviewed behavior | Relevant files / consumers | Evidence | Reviewer/disposition |
|---|---|---|---|---|---|
| C-05 Service-area / geo qualification | Direct | Globally discovered/unowned seed → explicit tenant's five zones | Entry, geo-db; loadActiveZonesForEngine, geo-integration | A/B/NULL, dataset and transaction proofs | See independent exact-SHA gate below. |
| P-03 Tenancy and tenant scoping | Direct, bounded | Missing ownership/global name → exact owner guards/predicates/stamp | Entry/helper/private geo primitives | Missing/unknown tenant, A/B/NULL, payload override | See independent exact-SHA gate below. |
| P-06 Data access layer | Direct, bounded | Legacy incompatible autocommit → schema-compatible transaction and cleanup | Entry, geo-db; schema reference only | Real PG writes/readbacks/rollback; native lifecycle | See independent exact-SHA gate below. |
| P-05 Audit and audit trail | Direct, limited | No calls → awaited calls for committed owned creations | geo-db consumes existing audit module | Postcommit observer, null/throw controls; no durability claim | See independent exact-SHA gate below. |
| P-02 Authorization and RBAC | Indirect boundary | Credential-only CLI → deliberate explicit owner; no new RBAC | Operator entry; existing business callers unchanged | Pre-acquisition guards and source trace | See independent exact-SHA gate below. |
| C-15 Pricing engine and price book | Direct retirement / indirect geo values | Twelve-item co-load → zero price SQL; geo values preserved | Entry legacy price block; pricing consumers | Query traces and complete dataset controls | Option A accepted; see independent gate. |
| C-14 Estimating | Indirect | Future owned zones feed existing consumers | geo-integration → scope-to-estimate pipeline | Trace and unchanged consumer regression; no historical re-estimate | See independent exact-SHA gate below. |
| C-18 Price adjustment and margin control | Indirect | Existing adjustment path can consume new owned policies | price-adjustment-db → geo_zones | G3a-2 normal regressions and preserved dataset | See independent exact-SHA gate below. |
| C-36 Calibration | Indirect, latent | Existing bounded writer may target new owned zones | calibration-db → geo_zones | Trace/regression; normal producer remains latent | See independent exact-SHA gate below. |
| P-09 Evidence and provenance substrate | Indirect, limited | New explicit ownership and audit snapshot | Entry/helper/audit | No historical cleanup or full provenance correspondence | See independent gate; canonical uncertainty retained. |

## Reviews, delivery and remaining decisions

Implementation/proof authors: `/root`, `/root/g3a3_implementation_design`, `/root/g3a3_proof_design`, with distinct owned files. Internal Superpowers implementation-quality reviewer: `/root/g3a3_implementation_design`; PASS at the exact implementation SHA, separate from the independent security reviewer. The resolved symlink finding and earlier reviews remain historical artifacts.

The independent read-only gate and exact transition limits are reproduced below. No security verdict is inherited from another unit or transferred to this documentary commit. The resulting documentary SHA and publication observation are necessarily recorded after they exist, in the separate delivery record.

At 2026-09-15 12:54:03 UTC, direct remote reads showed main `8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf`, workflow `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`, security `b95ea0bf4741646f418fcc99a22d22a42d24be51`, and G3a-2 `7e329db54d45d9e2a6993a747a224a64f3b609d4`; the G3a-3 branch was not yet present remotely. Candidate worktree `/private/tmp/structr-g3a3-20260915` was clean on `codex/g3a3-geo-seed-20260915`, with no upstream. Main checkout `/Users/wsilva/Desktop/structr-ai` remained clean at `233569d68c014712ce3d25326bda8823aab1987e`; `origin/*` was not treated as live remote truth.

PR #9 was read through the connector and remains open/unmerged at security head `b95ea0bf`, reporting base `main` at `233569d6`, different from the directly observed remote main. That discrepancy is retained for integration; it does not prevent this separate candidate from using the verified G3a-2 closure as its base. No PR metadata/ref change occurred.

Unit blockers, adjacent work and final merge are distinct:

- G3a-3 implementation/technical evidence and internal review are completed at the stated SHA; the independent record below governs its reviewed disposition. No operational execution or formal human closure is inferred from tests.
- G2's 13/15-surface inventory, G3b/G4b architecture/FK/provenance work, F5b's closure supplement and other units keep their separate dispositions. This unit does not silently absorb them or make every deferred implementation a mandatory PR #9 prerequisite.
- PR #9 stays **NO-GO**, global B2 **NOT DEFENSIBLE**. Applicable repository rule-F2/F5 obligations, final aggregate review, integration-base reconciliation and live/deployment preconditions remain. Phase 3 is not started.

Artifacts: `/private/tmp/structr-g3a3-execution-20260915/` preserves test-first logs, baseline classifications and author/internal reviews. `/private/tmp/structr-g3a3-sha-review-20260915/` contains ten exact-SHA check records and raw logs, `evidence-manifest.json`, remote/local/PR observations, canonical-source responses, cleanup verification and the independent report. The manifest binds 43 source/evidence artifacts; these are local reproducibility records, not a claim of permanent external archival.

## Independent exact-SHA gate — preserved verbatim

The following completed external report is preserved unchanged. Source SHA-256: `d243f1a8fbe67440b236cc8c118a804dc26227d17e7d7db09813c9ac3c202bfa`. Its pre-publication observation window is retained; subsequent documentary/publication results belong in the separate delivery record.

<!-- Begin verbatim independent G3a-3 gate -->
# G3a-3 — independent read-only security gate

**Verdict: PASS / narrow G3a-3 GO at exactly 4c243ccaa65bf1e3eb9332152977cf7781428d5e. Layers 1–8 PASS. Layer 9 is BLOCKED/pending for formal human acceptance and closure of this exact reviewed unit; existing delegated authority for bounded documentary delivery and branch publication remains valid. This is not MERGE GO.**

No unresolved BLOCKER or REQUIRED finding was identified. The verdict permits this reviewed implementation and its evidence to proceed through the already-authorized separate documentary review/delivery sequence. It neither grants new authority nor asserts that the human has received and accepted this completed report or its residual risks.

## Subject, identity and independence

- Unit: G3a-3, option A — operational geo-only seed; retire automatic co-seeding of 12 coastal price-book items.
- Repository: https://github.com/wcvmsilva/structr-ai.git.
- Candidate: 4c243ccaa65bf1e3eb9332152977cf7781428d5e.
- Sole parent / comparison base: 7e329db54d45d9e2a6993a747a224a64f3b609d4.
- Candidate checkout: /private/tmp/structr-g3a3-20260915; branch codex/g3a3-geo-seed-20260915; clean, unpublished, no upstream configured at the observation boundary.
- Baseline checkout: /private/tmp/structr-g3a3-baseline-20260915, detached at the parent. Its only intended overlay is the same three new proof/support files. Its production files are unchanged.
- Evaluator: Codex subagent /root/g3a2_independent_sha_gate, independently reviewing G3a-3. The task name is historical; no G3a-2 verdict is reused.
- Independence: this evaluator previously performed a read-only plan review, identifying an environment-prerequisite correction and assessing optional final-readback hardening. It authored no candidate implementation, tests or evidence and did not perform the internal implementation-quality review. For this gate it read production source, private primitives, schema, caller/consumer context and every changed proof file before consulting internal-review conclusions.
- Execution boundary: fresh runtime checks were performed by the root evidence producer. This evaluator independently inspected their commands, oracles, raw output, identities and hashes; it did not rerun tests or operate any database.
- Toolchain observed: Node v24.14.0; Vitest 2.1.9; installed tsx 4.20.6, postgres 3.4.8, Drizzle ORM 0.44.7; isolated PostgreSQL 17 harness. Existing dependencies were reused.
- Evidence directory: /private/tmp/structr-g3a3-sha-review-20260915, abbreviated E below. Historical/precommit execution directory: /private/tmp/structr-g3a3-execution-20260915, abbreviated H. Planning directory: /private/tmp/structr-g3a3-planning-20260915, abbreviated P. Repository-relative source references below refer to the exact candidate unless explicitly labeled baseline or workflow/main lineage.

## Exact claim and non-claims

The reviewed operational entry requires an explicitly supplied canonical UUID for an existing tenant before any geo mutation; discovers duplicates using strict equality to that owner; stamps new rows with that owner; preserves the five approved legacy zone datasets; executes all tenant verification, geo discovery, insert and ownership-confirming readbacks in one business transaction; emits postcommit creation-audit calls; closes its matching scoped-runtime client; and performs no coastal price-book queries. Absent or invalid owner input fails before server-runtime/client activity. Existing foreign/NULL-owned and own duplicate rows are neither reassigned nor overwritten by this code.

This is a code-and-isolated-evidence claim for scripts/seed-geo-zones.mjs and its additive helper, not a repository-wide assertion about every possible operational script. The unchanged server seed and prior closed units retain their own anchors. Selecting an existing tenant UUID is an operator contract, not end-user RBAC. The operator already controls database credentials; executing the seed against an operational database requires separate authority.

Excluded: live data and provenance, backfill, deployed schema/FK/RLS, permanent geo architecture/service-area policy, arbitrary deferred or commit-time trigger behavior, concurrent duplicate uniqueness, globally atomic/durable audit, historical estimate recalculation, production/deployment readiness, other domains/units, canonical capability promotions, PR #9 integration/merge, Phase 3 and any new scope decision.

## Authoritative rules recovered

1. Current explicit human decision: option A was accepted after presentation of the five-zone/12-price-item choice, with delegated routine continuation within this unit. The approved plan records the decision and its boundary: implementation, proofs, correction/review loops and separate implementation/documentary delivery; no live operation, new domain/ownership choice, main/security integration, merge or Phase 3. This later explicit authority permits routine bounded commit/publication actions without a repeated ceremonial question. It does not constitute future acceptance of the completed exact-SHA security report.
2. Candidate AGENTS.md: behavioral tests, no regressions, audit on mutations, transaction on multistep business work, and modification of the existing requested entry. This is a bounded remediation, not a new domain. No router is added; router-specific requirements do not create a new endpoint. Existing legacy policy literals are preserved by explicit approved choice rather than newly recalculated. Known stale MySQL and procedure descriptions are reconciled against actual PostgreSQL code and the published workflow, not used to change architecture.
3. Candidate docs/security-remediation-handoff.md §§3, 5, 8, 10–12, 16–20: strict geo tenant policy; NULL never implies platform/GCHI ownership; operational seed must fail without explicit ownership; adjacent-unit and merge exclusions. Its old NOT STARTED/next-unit statements remain historical, superseded by subsequent recorded decisions.
4. Candidate docs/adr/ADR-001-structr-data-ownership-model.md and handoff corrections: explicit ownership, no ownership inference from NULL, and no provenance-free backfill. The handoff's more precise qualification of migration 0004 and commercial policy controls interpretation of the older ADR wording about constants/FK alignment.
5. Candidate docs/security/g3a2-geo-policy-evidence.md, appended 2026-09-15 human-closure record: G3a-2 closed at its own implementation SHA; prior publication/closure history; G3a-3 scope decision as next boundary. Parent 7e329db5 is the published closure supplement. F5b remains separately anchored; its documentary follow-up is not absorbed.
6. P/next-scope-decision.md and P/docs/superpowers/plans/2026-09-15-g3a3-operational-geo-seed.md: exact five-file implementation/proof boundary, strict existing-tenant contract, preserved dataset, retired co-seed, expected RED/GREEN contrast, isolated database and native-runtime proof, separate documentary commit and independent gate. The decision packet's earlier A/B/C-pending wording is superseded by the plan's recorded option-A acceptance. The plan includes the final ownership pass and the realpath entry correction.
7. Workflow lineage f60cf9a56679d4d7083b2c11ac4e2727d53d84c3, read using git show: docs/engineering/security-gate.md, gate-record-template.md, current-state.md, decision-correction-log.md, and docs/superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md. These supply the ordered nine-layer gate, source hierarchy, independent reviewer boundary, exact-SHA rule, and distinct human transitions. Their former F5b/G3a-2/G3a-3 NOT STARTED statements describe that lineage's earlier window, not today's approved unit.
8. Product lineage main 8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf: docs/product/canonical-structr-truth-v1.md and feature-evidence-maintenance.md, captured by exact-SHA read-only GitHub responses in E. The main object is absent locally; no fetch was performed. Recomputed Git blob hashes match b9e144e5b25b0c9dcfbcc0790b12931bc78713b2 and 6455caef19bbabb293ffd9104c67a5b73f487988. Product meaning and separate capability dimensions are preserved; these documents were not copied into the security/workflow lineage.

## Independent source derivation

### Entry, data and lifecycle

Baseline scripts/seed-geo-zones.mjs constructed a postgres client at import, globally selected by zone_name, omitted tenant_id and required name on insert, passed JSON text to a text-array column, had no transaction/audit, subsequently queried/inserted 12 price items, and closed only after success. These are observed code properties, not claims that all legacy SQL succeeds against today's schema.

Candidate script lines 103–109 runs dotenv only inside the explicit entry and validates the trimmed/lowercase owner plus DATABASE_URL before importing the server graph. Lines 113–123 create one namespaced tsx registration, load db.ts first and geo-db.ts through that same registration. The installed register API exposes import and async unregister; independent tsImport namespaces are not used. server/db.ts creates its client lazily, allowing the retained db module to expose the client used by the helper for cleanup.

The entire five-object ZONES literal is byte-identical to baseline. Lines 124–141 map name and zoneName, decode ZIP JSON to text arrays, retain numeric coordinates, encode numeric database columns as strings, and preserve descriptions, ordering and policy values. This does not substitute CHARLESTON_ZONES; notably the legacy coastal ZIP list has five entries. No automatic coastal-item block or SQL remains. Source searches found the new helper's only production caller at script lines 123/142 and no package command that additionally invokes the removed co-seed.

Lines 142–163 print a committed count only after helper completion, expose unconfirmed audit persistence with nonzero status, and close the raw client before unregistering. Both cleanup paths run even after helper failure; combined failures retain their messages. Lines 168–177 compare real argv path to module path, handle unrelated/missing argv safely, await execution and set exitCode instead of terminating before cleanup. Standard canonical and alias invocation are covered; arbitrary Node loader flags/platform configurations are not claimed.

The unused ENV import in server/db.ts does not establish execution of _core/env validation under installed tsx. The recorded native import observation confirms that distinction; no extra JWT/Supabase requirement or production validation bypass was introduced.

### Tenant boundary, transaction and audit

server/geo-db.ts:762–811 adds seedOperationalGeoZones without changing existing helper bodies. Lines 766–775 reject invalid runtime tenant input before getDb, require an available DB, and verify exact tenants.id under FOR KEY SHARE inside the transaction. The UUID check accepts canonical spelling without imposing an unrelated UUID-version policy. The existence lock protects the tenant during this batch; it does not establish permanent FK enforcement.

The reused private lookup at :206 uses strict geoZoneTenantWhere equality plus zone name and rejects mismatched returned ownership. insertGeoZoneInTx at :233 spreads caller data then applies the trusted owner, preventing payload owner override, and reads the inserted ID back through the strict predicate on the same handle. Missing INSERT return/readback or thrown SQL aborts the transaction. The final pass at :789–795 rereads every created ID after all inserts and returns those confirmed rows for auditing. It catches an ordinary later-insert trigger that changes an earlier row's owner; it expressly excludes deferred commit-time behavior.

All business checks/inserts/readbacks share one transaction, with no nested transaction and no cross-tenant/null discovery arm. Own duplicate rows are skipped, not updated; foreign duplicate names do not cause a skip. Existing server seed remains unchanged. There is no tenant/name unique constraint, so serial idempotence is the supported property.

At :799–810 each confirmed creation receives awaited logAudit with userId null, action geo_zone.create, table geo_zones, ID and owned final snapshot. server/audit.ts:31–57 independently acquires the DB and normally returns a persisted row or null while absorbing insertion failures. Unconfirmed results are counted; already committed geo data is retained. An unexpected thrown audit error can stop the remaining audit loop and propagates after commit. Neither this report nor the test spies claim durable globally atomic audit. This unchanged audit architecture is an explicit boundary of the approved unit.

### Consumers and boundaries

loadActiveZonesForEngine at geo-db.ts:511–535 maps only the caller tenant's active rows. geo-integration.ts:88–122 consumes that policy for detection and snapshots without the removed global fallback. Existing project/geo routes and project context feed downstream estimation, including scope-to-estimate-pipeline.ts:492–504 and :628–630. pricing-dimensions.ts:204–218 passes supplied geographic modifiers through existing pricing context. price-adjustment-db.ts:157–159 and calibration-db.ts:805–815 consume/write tenant-scoped geo policy through their unchanged previously reviewed boundaries. No new client route, router or cross-domain caller was introduced.

## Ordered gate results

### Layer 1 — Live state: PASS for this isolated local candidate

E/local-remote-state.json at 2026-09-15T12:54:03.951348Z and direct evaluator reads establish the correct isolated worktree, clean candidate branch, exact SHA/parent, and common Git directory. Parent-to-candidate count is 0 left / 1 right; security b95ea0bf is an ancestor. No candidate upstream is configured; candidate remote ref is absent as expected before publication.

Fresh authoritative remote observations: main 8fa14da3e9c275645c0f7b4fd67dcc5a3ebc6dcf; security b95ea0bf4741646f418fcc99a22d22a42d24be51; workflow f60cf9a56679d4d7083b2c11ac4e2727d53d84c3; published G3a-2 branch 7e329db54d45d9e2a6993a747a224a64f3b609d4. Local main remains 233569d6 and cached origin/main 5c29fd07; neither is substituted for authoritative remote main.

E/pr9-github-response.json is a fresh normalized read: PR #9 open, not draft, unmerged, security head b95ea0bf; reported main base 233569d68c014712ce3d25326bda8823aab1987e differs from observed remote main. The approved isolated parent/claim is unambiguous despite that retained integration limitation. Connector mergeable metadata is not a merge authorization. No fetch/reset/ref repair or PR mutation was performed.

Non-claim: this establishes the local review boundary, not integration synchronization, deployed state or merge readiness.

### Layer 2 — Recovery: PASS

The authorities above support one state: G3a-2 previously closed; G3a-3 option A actively authorized; exact implementation now committed and submitted for independent review; separate documentary delivery and bounded branch publication already delegated; formal acceptance/closure and any new substantive scope remain distinct. Old workflow/handoff NOT STARTED statements and stale stack facts were reconciled explicitly rather than silently adopted. PR #9 NO-GO and global B2 NOT DEFENSIBLE remain unchanged.

Non-claim: recovering prior closure does not transfer its security verdict or close G3a-3.

### Layer 3 — Scope: PASS

Exactly five changed files: scripts/seed-geo-zones.mjs; server/geo-db.ts; server/tenant-g3a3-geo-seed.test.ts; server/tenant-g3a3-geo-seed-postgres.test.ts; server/test-support/g3a3-postgres.ts. Two production files, two proof files and one proof-only harness match the plan. No production schema/migration, shared tenant-scope, package, env, hook, CI, router, UI or prior evidence file changed. The price-book effect was removed under the explicit product choice; no replacement price path or database deletion was introduced. Documentation is reserved for a separate commit.

Non-claim: scope conformity does not establish safety outside these paths.

### Layer 4 — Technical verification: PASS

All ten fresh records identify the exact candidate, clean before/after status and the same five working/committed hashes. This evaluator independently compared those fields and recomputed all raw-log hashes; none disagreed. Checks ran from 12:51:29Z through 12:53:43Z on 2026-09-15. The two explicit proof type configurations retain strict checking; normal proof allowJs does not mean checkJs coverage of the CLI.

| Command/check | Fresh result | Evidence in E |
|---|---|---|
| pnpm check | Exit 0, no TypeScript errors | check.json / check.log |
| pnpm test | Exit 0; 68 files passed, 5 skipped; 2,833 tests passed, 152 skipped, zero failures | full.json / full.log |
| pnpm exec vitest run server/tenant-g3a3-geo-seed.test.ts | Exit 0; 46/46 | focused.json / focused.log |
| G3A3_POSTGRES=1 pnpm exec vitest run server/tenant-g3a3-geo-seed-postgres.test.ts | Exit 0; 17/17 | postgres.json / postgres.log |
| pnpm exec tsc --project H/tsconfig-normal-proof.json | Exit 0 | proof-types-normal.json / .log |
| pnpm exec tsc --project H/tsconfig-postgres-proof.json | Exit 0 | proof-types-pg.json / .log |
| Native Node H/native-entry-smoke.mjs, canonical candidate path | Exit 0; real tsx helper graph reaches controlled failing DB boundary and closes same singleton client | native.json / native.log |
| Same native probe, /tmp alias path | Exit 0; same trace and error/cleanup behavior | native-alias.json / native-alias.log |
| pnpm audit:tenant | Exit 0, 44 warnings and 6 tracked gaps | scanner.json / scanner.log |
| GIT_OPTIONAL_LOCKS=0 git diff --check parent candidate | Exit 0 | diff-check.json / diff-check.log |

The 152 normal-suite skips comprise 135 inherited skips plus the new 17 PostgreSQL cases, which were separately run successfully. Existing G3a-2 36+9 PG and F5b 11 PG cases remain opt-in skips, not freshly rerun or relabeled PASS. The new unit adds 63 behavioral cases in total (46 normal + 17 PG). Existing geo/consumer regression tests ran within the full normal suite. No build/lint gate or additional backend was represented as executed.

Non-claim: green technical checks alone are not tenant isolation proof.

### Layer 5 — Static security measurement: PASS, measurement only

Fresh scanner execution retained 44 warnings (38 schema, 6 router), six query gaps and no blocking finding. Raw output names all findings. Query gaps remain assembly-db, estimate-version-db, jobtread-export-db, previsit-db, scope-db and scope-review-db. The router warnings remain assembly-router, audit-router, catalog-router, issue-report-router, pricing-router and rbac-router.

server/tenant-coverage-audit.ts:248–275 selects -db.ts plus queries.ts and accepts file-level scope symbols. It does not select this .mjs entry, and file-level detection cannot prove each branch. The scanner's printed 39/83 tenant-scoped, 44 platform-global and “Multi-tenant ready” wording is its measurement output, not an independently adopted ownership or security conclusion. Scanner files/rules were unchanged.

Non-claim: exit zero and scanner silence do not establish runtime isolation, global ownership, unit closure or merge permission.

### Layer 6 — Security evidence: PASS within the declared proof boundary

Normal proofs execute the actual script and actual geo helper with controlled dotenv, DB, audit and tsx boundaries. Their SQL double interprets emitted equality/AND/OR/IS NULL predicates and preserves absent predicates as absent; it does not secretly add tenant filtering. The legacy branch deliberately accepts schema-incompatible rows so omitted name/array compatibility cannot masquerade as isolation RED. Transaction state is staged and discarded on throw. Positive controls show the legacy entry actually executes and the setup is functional.

PG proofs use the real postgres factory supplied separately from the module mock, actual Drizzle SQL and transactions, and an independent observer backend. The harness only creates its own private Unix-socket cluster, rejects inherited PG/database configuration, has no caller-supplied host/URL/directory, sets explicit connection options, and checks backend identity. Fixture DDL derives current tenants/geo_zones columns, types, defaults, primary keys and NOT NULL constraints. It intentionally omits deployment RLS/FKs/unrelated topology. Its tiny price_book_items table is a labeled sentinel with all 12 SKUs, not a claim about the operational price schema.

Candidate evidence covers A/B/NULL collisions, unknown owner, own serial repeat and partial duplicates, exact five-zone values/name/text[] types, no price SQL, real third-insert rollback, immediate foreign/NULL owner rewrite, suppressed insert, final-insert foreign/NULL reassignment of an earlier row, observer-visible committed audit snapshots and audit-failure retention/cleanup. A suppressed INSERT can throw while the private primitive accesses a missing returning ID; that is a refusal/rollback result, not evidence of a successful scoped readback. The final ownership pass is exercised directly by ordinary transaction-time trigger faults. Tenant locking SQL is observed, but no tenant-deletion race or global duplicate-concurrency experiment is claimed.

Native evidence uses the real Node/tsx loader and actual geo helper, replacing db.ts with a fail-closed module-local client and blocking direct postgres construction. The shared state is visible to the CLI cleanup only when both imports use the same namespace. It proves native loading and matching singleton cleanup on the controlled error, not a native connection to PostgreSQL or production connection success. Import-only inactivity is supported by the normal behavioral contrast and source inspection. H/native-entry-smoke.mjs has SHA-256 aa0a78eb9a6679718e97861ffb19af987bf9ecc7bc7bd21b2b7480dba00c1b53.

Previous-HEAD classification and applicability are detailed below. Core ownership/discovery/existence/co-seed assertions have real prior-HEAD contrast; rollback has valid persisted-state double contrast plus actual candidate PG rollback. Newly added helper contracts and exact-schema/fault cases are explicitly distinguished from prior-HEAD security proof. No required in-scope assertion depends solely on a schema error or missing export.

Non-claim: these fixtures/spies do not establish durable audit, deployed permissions/RLS/FKs, all database trigger behavior or production safety.

### Layer 7 — Internal implementation-quality review: PASS

E/internal-exact-sha-review.md is a distinct exact-SHA review by /root/g3a3_implementation_design. It identifies its Superpowers plan/TDD and internal quality method, confirms source/hash parity and reports no unresolved BLOCKER/REQUIRED finding. Its author also wrote normal proofs and explicitly disclaims independence; that is appropriate for the internal layer, not a substitute for this gate. The discovered lexical-path/symlink defect was corrected before the commit, with H/normal-alias-red.log and normal-alias-green.log preserving the correction loop. Fresh canonical/alias native checks and all 46 normal cases cover the committed fix.

This evaluator consulted that review after deriving the source and proof conclusions independently. Its PASS is implementation-quality evidence only.

### Layer 8 — Independent Codex review: PASS / narrow GO

This report independently re-establishes exact SHA/scope, origin and data preservation, tenant and transaction behavior, proof validity, consumer impact, execution integrity and limits. No claim-breaking bypass, unauthorized production change or missing load-bearing evidence remains in the reviewed boundary. The temporary atomicity question was resolved against the already-existing raw baseline failure at normal test line 440; a redundant added experiment was not incorporated into the candidate or used for this verdict.

This evaluator wrote only this new external report. It performed no implementation/proof/evidence edit, test execution, database/network operation, dependency installation, Git mutation, publication or delegation. Every Git read used GIT_OPTIONAL_LOCKS=0. A later changed implementation or proof commit requires a new appropriate exact-SHA review; this GO does not transfer.

### Layer 9 — Human decision: BLOCKED/pending for exact-unit acceptance and closure

The human has already selected option A and delegated routine execution and separate documentary/branch publication within G3a-3. Those actions do not require a new routine permission question merely because this review finishes. This report does not revoke or expand that delegation.

However, no human decision after receipt of this completed exact-SHA report is recorded that accepts its findings/non-claims and formally closes G3a-3 or selects a new substantive unit. For that distinct transition, Layer 9 is pending/BLOCKED. Approval to implement, commit, review, document or publish is not recorded as future human acceptance of residual risks or as formal closure. Merge/live operations remain prohibited.

The next authorized work is the separate G3a-3 evidence document and its documentary review/delivery, followed by the already-delegated bounded branch publication if its own checks pass. The next precise human transition after that delivery is acceptance or rejection of G3a-3 closure for implementation SHA 4c243ccaa65bf1e3eb9332152977cf7781428d5e with these retained limits. A new unit/product/ownership decision needs its own scope authority.

## Previous-HEAD proof — independent classification

Required: YES for applicable change-sensitive claims. Baseline is the exact parent 7e329db54d45d9e2a6993a747a224a64f3b609d4. This evaluator verified all three proof/support files byte-for-byte equal in baseline and candidate and verified baseline production is unchanged. H/normal-baseline-final.log records 43 failures and 3 passes from 46 cases. H/postgres-red-final.log records four failures, one pass and 12 deliberately unselected cases from 17. These totals are not vulnerability counts.

### All 43 normal failures, grouped without changing their meaning

N01–N43 below follow the failed-case order in the baseline log, not a severity ranking.

| Cases | Baseline failure / interpretation |
|---|---|
| N01–N06: absent, empty, whitespace and three malformed owners | Entry succeeds instead of refusing; meaningful missing-owner validation contrast, with functional legacy execution control. |
| N07: DEV owner is not a substitute | Missing operational owner is still accepted; meaningful no-fallback boundary contrast. It does not prove baseline actually reads DEV_TENANT_ID. |
| N08: uppercase/padded UUID | Rows are not stamped to A; ownership contrast, not proof that old code attempted canonicalization. |
| N09: unknown owner | Legacy succeeds with no tenant check; exact-existence contrast, complemented by real PG unknown-owner case. |
| N10: wrong tenant lookup response | Legacy never performs that lookup; a candidate defensive contract, not a demonstrated wrong-row SQL return from baseline. |
| N11: tenant and geo work in one transaction | Transaction count zero; structural transaction contract, complemented by N32's persisted partial-state failure. |
| N12–N14: B, NULL, and mixed complete name collisions | A receives zero instead of five; meaningful global-discovery/ownership contrast. |
| N15: complete schema-shaped dataset | Legacy has omitted name/owner and JSON string rather than mapped array/numeric encodings. Mixed ownership/compatibility contract; not a PG security error. |
| N16: partial own names plus foreign names | A remains at two instead of five because foreign names cause global skips; meaningful strict-discovery contrast. |
| N17: serial repeat | Zero rows belong to A because legacy writes NULL ownership; ownership contrast. It does not show the legacy command lacks global-name serial deduplication. |
| N18: no coastal price book | 24 legacy price operations instead of zero; meaningful retired-side-effect contrast in the double. PG independently observes the 12 SELECTs with preloaded SKUs. |
| N19: midpoint failure with all B/NULL names preloaded | Legacy skips all five inserts, so the expected error never occurs. This failure is global-discovery behavior, NOT partial-batch/rollback proof. |
| N20–N21: missing/foreign inserted-row readback | Legacy has no readback and ignores those candidate-path fault controls. Candidate rollback/readback contracts, not evidence of an injected foreign database row in baseline. |
| N22: filesystem alias entry | Baseline executes but creates no A-owned rows. This is ownership contrast; it is NOT the precommit symlink bug's RED. The separate alias correction log supplies that evidence. |
| N23: creation audits | Legacy emits zero instead of five; meaningful missing-audit-call contrast. |
| N24–N25: null/throwing audit | Legacy has no audit sink call, so injected sink faults are not encountered. Candidate postcommit error contracts, not durable audit proof. |
| N26: unavailable shared DB | Legacy uses its direct client instead of that shared boundary. Candidate acquisition contract. |
| N27–N28: db/geo import failures | Legacy has no scoped imports, so candidate fault controls are not reached. Candidate loader lifecycle contracts. |
| N29: one scoped pool closed after audits | No scoped registration in legacy. Candidate singleton/lifecycle contract; native proof supplies real loader evidence. |
| N30: close rejection still unregisters | Legacy has no runtime unregister. Candidate cleanup contract. |
| N31: unregister rejection is reported | Legacy never unregisters. Candidate cleanup contract. |
| N32: preserve operation failure when shutdown also fails | Empty starting state; failInsert=3. Baseline passes the expected insert-error assertion at test :439, then fails :440 because raw-1 and raw-2 remain. This IS valid partial-state/atomicity RED. Candidate rolls back to zero, retains the error and completes cleanup handling. The failEnd flag does not invalidate the earlier successful insert-error assertion or observed two persisted rows. |
| N33: import-only inactivity | Baseline executes dotenv/client/seed work when imported; meaningful side-effect contrast. |
| N34–N40: seven invalid direct-helper inputs | New helper export does not exist on baseline. API-absence failures, NOT security RED. |
| N41: payload owner override | Missing new helper export. Candidate-only defense contract; CLI ownership stamp has separate entry-level contrast. |
| N42: later empty zone name | Missing new helper export. Candidate-only input/rollback contract. |
| N43: returned created/auditUnconfirmed counts | Missing new helper export. Candidate-only return contract. |

Three baseline controls pass: configured actual entry persists five geographic records and closes; existing own rows/IDs remain untouched; absent DATABASE_URL fails before client/server import. The positive controls establish that baseline execution is not universally broken by the test setup. Ten API-absence failures and other candidate-path fault contracts are not counted as independent vulnerabilities.

### PostgreSQL contrast and complementary evidence

| Baseline case | Observed result and validity |
|---|---|
| A with all five names under B | Legacy completes normally, leaves B intact, creates zero A rows; expected five assertion fails. Valid discovery contrast. |
| A with all five names under NULL | Same valid contrast; unknown-provenance rows are global-name blockers in legacy. |
| Own-name repeat must perform zero price queries | Legacy completes normally but makes 12 SELECTs against sentinel SKUs; zero-query assertion fails. Valid co-seed-removal contrast. |
| Unknown tenant with all names already present | Legacy completes normally instead of refusing; no incompatible INSERT is reached. Valid exact-existence contrast. |
| Existing own rows and sentinel SKUs unchanged | Passes, with no audits and one client close. Positive PG infrastructure/control case. |

The other 12 cases are deliberately unselected at baseline because its incompatible INSERT would prevent exercising the intended real-PG schema/fault path. They are candidate exact-schema evidence, not red-to-green security claims. The actual candidate third-insert SQL error rolls back the transaction as observed from a separate connection, complementing N32's meaningful prior-HEAD partial-state contrast. Immediate and final ownership-confirmation faults strengthen the new helper's candidate behavior; absent baseline confirmation paths and incompatible DDL are disclosed rather than misreported as attack execution.

The native baseline probe fails by reaching its deliberately blocked direct-driver branch; it is a loader/path contrast, not a network failure or live exploit. Earlier harness/type attempts and precommit GREEN logs remain historical; fresh exact-SHA results above control this verdict. The separately corrected symlink defect has its own 1-of-46 precommit RED and subsequent 46 GREEN; it is not disguised as a parent-SHA security regression.

## Capability impact disposition — ten rows, no canonical promotion

The evaluator independently traced the changed entry, strict geo primitives and unchanged consumers, using the canonical definitions from main 8fa14da3. Each disposition below concerns this change only. Existing implementation status, operational validation, security status, confidence, verification, lifecycle and roadmap fields remain unchanged; no row becomes CURRENT. This is not verification of all 48 capabilities.

| Capability | Impact and reviewed before/after | Evidence / disposition and retained boundary |
|---|---|---|
| C-05 Service-area / geo qualification | Direct: operational seed gains explicit tenant-owned five-zone policy | Script and geo-db; tenant collisions, exact data and rollback proof. Bounded impact PASS; permanent service-area architecture excluded. |
| P-03 Tenancy and tenant scoping | Direct: global name lookup/unstamped insert becomes exact owner discovery/stamp | A/B/NULL and missing/unknown owner proofs. Bounded impact PASS; no global isolation promotion. |
| P-06 Data access layer | Direct: raw legacy/autocommit path becomes schema-shaped helper transaction with cleanup | Real PG encoders/rollback and native singleton proof. Bounded impact PASS; deployed FK/RLS not evaluated. |
| P-05 Audit and audit trail | Direct, limited: no seed audits becomes postcommit calls for confirmed creations | Correct owned snapshots and observer order; null/throw retention. Bounded impact PASS; durable/global atomic audit excluded. |
| P-02 Authorization and RBAC | Indirect boundary: trusted operator must choose an existing tenant | Guards precede runtime/geo mutation; no default inference. Preservation PASS; no new user-role enforcement claim. |
| C-15 Pricing engine and price book | Direct removal of 12-item co-seed; indirect preservation of geo commercial inputs | Zero price queries plus byte-identical dataset and mapping. Bounded impact PASS; no catalog-wide security or pricing approval. |
| C-14 Estimating | Indirect: newly owned zones can feed existing tenant detection/project context | geo-integration and scope-to-estimate/pricing context trace; unchanged consumer regressions. Preservation PASS; no historical re-estimation. |
| C-18 Price adjustment and margin control | Indirect: seeded policies remain valid inputs to existing tenant-scoped adjustments | price-adjustment-db geo lookup and unchanged reviewed apply/rollback paths. Preservation PASS; prior unit not reopened. |
| C-36 Calibration | Indirect, latent: owned zones remain available to scoped calibration writer | calibration-db strict geo write trace and normal regressions. Preservation PASS; no claim that latent producer becomes operational. |
| P-09 Evidence and provenance substrate | Indirect, limited: deliberate ownership and creation snapshot improve this input path | No complete lineage mechanism or historical classification established. Bounded impact reviewed; INSUFFICIENT EVIDENCE TO CLASSIFY and Low confidence remain unchanged. |

Unchanged adjacent domains are not silently included as additional direct impact. No new schema, replacement price writer or runtime consumer was discovered that requires scope expansion.

## Findings and dispositions

- **BLOCKER: none.**
- **REQUIRED: none.** The exact focused command and diff-check were supplied during review; the temporary question about baseline atomicity was resolved using existing N32 evidence without changing the candidate.
- **NOTE N-A — Audit boundary.** geo-db.ts:799 and audit.ts:31: business data can remain committed while audit is unconfirmed or unexpectedly throws. Current proofs use audit spies/synthetic sinks. No durable/global atomic claim, automatic retry or human risk acceptance is inferred.
- **NOTE N-B — Concurrency/deployment boundary.** geo-db.ts:773–795 and schema.ts:942–976: tenant existence is locked during the batch and created ownership is finally reread; no unique tenant/name constraint, mirrored tenant FK or deferred-trigger immunity is established. Serial repeat is the supported guarantee.
- **NOTE N-C — Evidence classification.** normal proof :366 is not rollback RED on baseline; :437–441 is. Direct-helper absence and exact-schema baseline failures are not security proof. This report's classification, not aggregate fail counts, supports the verdict.
- **NOTE N-D — Scanner limitation.** tenant-coverage-audit.ts:248–275 does not select the operational .mjs and has file-level false-negative potential. All 44 warnings/six gaps remain visible.
- **NOTE N-E — Runtime/environment.** script :113–156 depends on installed source-tree tsx and shared module state. Native proof is controlled error/cleanup on Node 24.14.0, separately complemented by actual PG tests; no native live-DB operation or broad environment compatibility is claimed.
- **NOTE N-F — Integration/live state.** E/local-remote-state.json and pr9-github-response.json retain the main/base discrepancy and intentionally unpublished candidate. PR #9 remains NO-GO, B2 NOT DEFENSIBLE. The local gate cannot resolve those conditions.
- **NOTE N-G — Human/closure boundary.** Delegated documentation/publication authority is established, but formal exact-unit closure and acceptance of this completed evidence are not. Layer 9 remains pending for that distinct decision; no routine reapproval is invented for already-authorized delivery.

## Integrity and final disposition

Independent comparisons establish these committed and working SHA-256 values:

| File | SHA-256 |
|---|---|
| scripts/seed-geo-zones.mjs | 025fbd0f84c02b87795e0ce6b9a745944a9c6b2aab547c520d1c3105dfe7aa27 |
| server/geo-db.ts | 9c0d084ffffd3f0a4fb87e56c0bdba94a0dbd499640563ca11bf825b0f9334c5 |
| server/tenant-g3a3-geo-seed.test.ts | fb5921589e8f2f7184cb026df0a73bf3709dcc6d3c8ce29552713c627a508461 |
| server/tenant-g3a3-geo-seed-postgres.test.ts | e3b49a7d5dc6409969bd47d49eca8b393c302a95a273c7fe05e7087d76dcfa73 |
| server/test-support/g3a3-postgres.ts | 56e732b9c9280d18e8a339804269af034fde9bfac1c2a5d8522f8261748a72da |

At 2026-09-15T12:56:33.969779Z the evaluator recomputed all 43 entries in E/evidence-manifest.json with zero mismatch. Manifest SHA-256: 844a26a5ee0965dba644582416232d74aa2caa753846b51db06733c9f0976599. Ten fresh check records bind before/after state and raw logs to the candidate. Final direct reads confirmed the clean exact HEAD and three identical baseline overlay files. E/cleanup.json records zero owned PostgreSQL processes/directories after runtime execution. No further runtime execution followed that completed package.

The earlier G3a-2 independent report remains unchanged at SHA-256 0b521a7f4821ada2d04d352f68eb992b060101627abe83d8f3f88ea2fa06d8b1. It was not edited, appended to, or used as a substitute for this verdict.

**Final narrow disposition:** G3a-3 independent security GO for the reviewed operational geo-only seed at 4c243ccaa65bf1e3eb9332152977cf7781428d5e, with no unresolved in-scope correction. Proceed only through the already-delegated separate evidence-document/review/publication work; do not label that work complete until its actual resulting SHA/publication are observed. Present this exact implementation and retained limits for the subsequent human closure decision. No unit transition, live execution, canonical promotion or merge is authorized by this report.

Report completed at 2026-09-15T12:59:01.520583+00:00 UTC.

<!-- End verbatim independent G3a-3 gate -->
