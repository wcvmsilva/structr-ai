# Isolated schema reconstruction and migration effects

Observed 2026-09-19 UTC against candidate `a7c17ed7b9deb48ea2aa097de1be4f9ac97b1ea9`. This extends the [migration-history reconciliation record](migration-history-reconciliation-2026-09-18.md) with actual PostgreSQL reconstruction. **The fresh journal replay succeeded; the observed reconstruction succeeded only within the explicit non-spatial scope below. Migration history, full recovery and production cutover remain unapproved.**

No live migration, seed, ledger repair, ownership assignment or privilege change was performed. All DDL in this experiment ran in newly created, socket-only, disposable PostgreSQL clusters. Each connection was checked against its nonce, owned data/socket directories and expected role before DDL. Every cluster was stopped and its owned directory removed, including failed attempts.

## Evidence and limits

The private public-schema-only archive has SHA-256 `8fac5a41e624ab07f96344f105c4782507522722e605d610fb8437676774689a`. Extraction and comparison used these exact bytes. An older SQL preview did not describe those bytes and was not used as reconstruction authority.

The host provided PostgreSQL 17.11. Source metadata reports PostgreSQL 17.4 and PostGIS 3.3.7 in `public`, plus pgcrypto 1.3 and uuid-ossp 1.1 in `extensions`. PostGIS was unavailable locally; no Docker, Podman, Colima or Orb runtime was found. A Homebrew install was interrupted during downloads when its plan expanded to 134 dependencies and unrelated upgrades; no package-install stage was observed. No existing PostgreSQL service was changed.

The first strict attempt stopped on the harness's already-existing empty `public` schema and rolled back. After removing only that owned empty schema, the archive stopped on the missing `public.geography` type. These failures were retained as evidence, not counted as successful restores.

The successful observed reconstruction then used SQL freshly extracted from the exact archive, with **only two exact DDL omissions**:

- `public.leads.geom`, declared as `public.geography(Point,4326)`.
- Its GiST index, `public.idx_leads_geom`.

There was no replacement or dummy spatial type. All 83 application tables, their other columns, foreign keys, triggers and policies were retained. Spatial routines were restored as definitions but were not executed. The PostGIS extension's objects were not reconstructed or compared.

External Auth dependencies were modeled only by the observed `auth.users.id` UUID primary key and the exact `auth.uid()` definition captured in a read-only metadata transaction. No Auth rows, other Auth columns, authentication service, complete Auth schema, Auth grants or session behavior were recreated. Required policy role names were disposable harness roles, not copies of deployed privileges. Real local pgcrypto and uuid-ossp extensions were created in `extensions`. Owner/ACL restoration was disabled.

This is a **partial structural reconstruction**, not a full schema/platform clone or backup recovery. Neither customer rows nor Auth/Storage data were copied. The original archive, extracted SQL, function bodies, catalog snapshots and raw logs remain private.

### Direct source-to-reconstruction verification

A separate metadata collection from the source at **2026-09-19 03:39:22.996167 UTC** verified an explicit read-only transaction. Its private artifact has SHA-256 `3e6626e334cb1e2b23ec54fdf4621b4b02b1de3eebd699c2e73edfc0af28e041`. This fresh observation does not replace or rewrite the earlier archive identity.

The source capture contains 2,344 objects. After excluding five extension identities and the two documented spatial objects, **all 2,337 captured application objects match the existing partial reconstruction exactly, with zero differences**. The shared normalized fingerprint is `dd915a541b61adac18f74dad5343789d1ac3df584ed21b87daa2a27c1782e1aa`. The local comparison likewise excludes its two extension identities. No database reconstruction or test was rerun for this offline comparison.

This links the reconstructed DDL to a fresh observation within the same declared scope, rather than relying only on matching archive names or table counts. The report deliberately retains `status: incomplete`, `structuralEquality: false`, `migrationHistoryProven: false` and `deploymentAllowed: false`: zero differences in the captured subset do not fill the spatial, Auth, ACL or recovery omissions. No raw definitions or source values are published by this verification.

## Actual results

The five immutable journal SQL files were separately executed in journal order on a fresh empty owned cluster, with `ON_ERROR_STOP` and one enclosing transaction. Their identities match the prior reconciliation record. This proves that this chain executes on that empty local PostgreSQL platform. It does not prove historical execution, equivalence to Supabase's 59 records, idempotence against a populated schema, or safe execution of its tenant backfills against real data. No migration ledger was fabricated.

| Captured category | Observed partial reconstruction | Fresh five-file replay |
|---|---:|---:|
| Application tables | 83 | 83 |
| Columns, including view columns | 1,409 | 1,398 |
| Constraints | 339 | 294 |
| Indexes | 347 | 314 |
| User triggers | 39 | 20 |
| Public non-extension routines | 29 | 9 |
| RLS policies | 90 | 0 |
| Tables with RLS enabled | 24 | 0 |
| Tables with FORCE RLS | 1 | 0 |
| Views | 1 | 0 |
| Locally captured extensions | 2 | 1 |
| Total captured objects | 2,339 | 2,119 |

The 83-table count excludes PostGIS's extension-owned `spatial_ref_sys`; it is consistent with the separate source observation of 84 physical public tables. Both executions returned zero within their stated scope and cleanup was verified. The fresh replay emitted 28 notices: four already-present columns, three already-present indexes, one already-present extension and 20 initially absent triggers dropped before creation. The final catalog contains the corresponding intended objects; process exit alone was not the acceptance evidence.

The comparison excludes extension identities and the two intentionally omitted spatial objects. It compares actual PostgreSQL representations of type/precision, defaults, nullability, generated/identity/collation properties, constraints and validation state, index definitions, trigger definitions/enabled state, RLS/FORCE RLS, policy predicates/roles, routines and security/search-path properties, sequences and views. This is a bounded object inventory; it does not cover all PostgreSQL security/platform features or grants.

There are **2,049 exact object matches and 288 differences** across the captured application scope (2,337 observed versus 2,118 intended objects):

| Difference | Count | Disposition |
|---|---:|---|
| Changed column definitions | 45 | 34 type differences, 23 default differences and two collation differences overlap across these columns |
| Additional observed columns | 11 | All belong to the additional `v_current_pricing` view |
| Additional observed constraints | 45 | Preserve pending review; some duplicate an existing constraint under another name |
| Additional observed indexes | 33 | Preserve pending review; names alone do not establish redundancy |
| Additional observed policies | 90 | Existing policies are not automatically a safe target policy set |
| Additional observed routines | 20 | Review executable rights, security-definer behavior and search paths separately |
| Changed table security flags | 24 | RLS enabled in the observed source; FORCE RLS additionally enabled on `proposals` |
| Additional observed triggers | 19 | Preserve and test effects before deciding to retain or replace |
| Additional observed view | 1 | `v_current_pricing`; no ownership or pricing authority inferred |

No intended object identity was missing from the observed **comparison scope**. This does not mean identical effects: column precision/defaults and RLS flags differ. Exact text differences also do not automatically mean behavior differs; for example `1` and `'1'::numeric` require a representation-only disposition. Counts are not 288 defects or permission to remove 288 objects.

Concrete differences with operational consequences include constrained monetary/quantity numeric precision versus unconstrained `numeric`; `inet` versus `text` in the legacy audit/access-log IP columns; extra catalog foreign keys including `crew_velocity` links to cost codes and units; and the lack of any RLS policy in the fresh local replay. A stored default containing a historical readiness label is database content, not evidence of current readiness.

## Forward baseline strategy

1. **Preserve both histories and this source identity.** Keep the five journal files and 59 observed migration records unchanged. Record an adopted observed baseline as a new, explicitly named provenance event only after complete platform reconstruction. Never backfill the Drizzle ledger to imply the five files historically ran.
2. **Complete the platform gap first.** Use an isolated PostGIS-capable environment, repeat extraction from the same archive identity or an explicitly refreshed one, restore the two spatial objects and exercise spatial routines. Include the real required Auth contract and separate owner/ACL inventory. The current partial result remains useful but cannot pass that gate.
3. **Disposition the 288 captured differences by effect.** Preserve observed additional constraints/indexes until duplicate/equivalence and application compatibility are proven. Separate representation-only defaults from real default changes. For numeric precision, use exact affected columns and boundary-value tests; do not narrow populated values or silently change rounding. Do not copy permissive policies merely to make schema counts match.
4. **Prepare two explicit supported starting states.** An empty installation and an adopted observed environment need the same reviewed postconditions, but not blind replay of the same historical backfills. Create forward changes with exact object/definition preconditions, expected impact, transaction boundaries and recovery instructions. A mismatch must stop before DDL rather than falling back to `db:push`, dropping extras or swallowing errors.
5. **Keep business ownership separate.** Existing tenant stamps, matching UUIDs, shared prices and a successful replay do not establish catalog ownership. Use the [catalog review packet](catalog-ownership-readiness-2026-09-19.md), reconcile the duplicated commercial booleans with owner evidence and keep unclassified rows out of automatic assignments. The Phase 1 blanket tenant backfill must not be reused as the G4b decision.
6. **Prove effective access and data recovery before rollout.** Run route-level behavior against the intended least-privilege principal and the reconstructed target policies, verify audit behavior, then perform recovery with the required business/Auth/Storage scope. Schema-only success does not establish acceptable data loss, downtime or deployed-role behavior.

Routine choices of disposable runtime, capture format, comparison ordering and isolated branch do not need a new product decision. Business evidence remains necessary where existing ownership or contradictory taxability/time-tracking fields determine the target state. Deployed principal identity and recovery requirements must be verified independently; they cannot be inferred from this laboratory.

## Reusable inspection tools and validation

[The read-only catalog query](../../scripts/migration-schema-snapshot.sql) captures the bounded public structure. For a non-laboratory database, execute it only inside an explicit verified `READ ONLY` transaction. Keep its output private because routine bodies and default literals may include environment or business information. The query is not a deployment command.

[The offline comparator](../../scripts/migration-schema-compare.ts) accepts two version-1 snapshots with `complete`, `omissions` and typed object identities/definitions. It performs no database or network access, credential lookup, repair or SQL execution. Definition-key and object ordering are normalized; array ordering remains significant. Reports contain identities, hashes and dispositions, not definitions. `complete` means completion of the declared capture scope, not all PostgreSQL security features. Missing reconstruction dependencies must set it to `false` and list omissions. `migrationHistoryProven` and `deploymentAllowed` remain false even when captured objects match.

[Behavioral tests](../../server/migration-schema-compare.test.ts) produced 23 expected RED failures, then **23 passed / 0 failed**. Focused TypeScript compilation of the tool and its tests exited zero. Both physical reconstructions and their catalog inspection were separately recorded; unit tests are not presented as evidence of restore or persistence. Whole-candidate validation remains the coordinator's responsibility.

An independent read-only review checked the four public files, their evidence hashes, comparison outputs and successful final cleanup receipts. It accepted the offline tool and partial structural evidence within these limits; it did not certify full recovery or inspect every private routine body. The subsequent direct source comparison above adds evidence without changing the tool or reconstruction.

The private evidence package binds source archive, journal hashes, exact commands, all retained failed attempts, final catalog snapshots, comparison and cleanup receipts. This document publishes only aggregate findings and selected schema identifiers, not the archive, connection details, credentials or customer data. G2/G4b family closure, complete migration-history reconciliation, production security and real-data readiness are not claimed.
