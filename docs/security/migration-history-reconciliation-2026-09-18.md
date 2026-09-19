# Migration history: current evidence and recovery procedure

Record opened 2026-09-18 America/New_York; ledger observation **2026-09-19 01:41:10 UTC**. This is an operational follow-up to [G4b-1 Recover](g4b-catalog-ownership/2026-09-17-g4b-1-recover-design.md) and its [append-only correction](g4b-catalog-ownership/2026-09-17-g4b-1-recover-correction.md). It preserves those observations and adds a reproducible offline check. The user's current instruction authorizes advancing reconciliation and security work; historical limits on earlier document-only tasks are not interpreted as a new approval requirement for routine local engineering.

**Current result: migration history remains unreconciled.** No migration, seed, ledger repair, privilege change or production rollout is performed by this work. A successful ledger comparison alone would not authorize those operations.

## Evidence added

The coordinator collected a sanitized snapshot containing only observation time, ledger availability, migration versions and SQL SHA-256 hashes. The offline checker evaluated it without a database connection:

| Measurement | Result |
|---|---:|
| Local PostgreSQL journal entries | 5 |
| Observed Drizzle ledger rows | 0 |
| Exact local `created_at + hash` pairs found in Drizzle | 0 |
| Local identities missing in Drizzle | 5 |
| Supabase versions / recorded statements | 59 / 59 |
| Distinct Supabase statement hashes | 52 |
| Duplicate Supabase versions | 0 |
| Supabase versions without statements | 0 |
| Local whole-file hashes matching an individual Supabase statement | 0 |
| Supabase statements still without a local whole-file match | 59 |

The collector's observation time and completeness are input evidence, not independently authenticated by the offline checker. The result reproduces the historical discrepancy with a fresh snapshot; it does **not** prove the five SQL files were never executed, that their effects are absent, that the 59 records are invalid, or that two schemas are semantically different.

The journal bytes have SHA-256 `1acd889cc871e8e6a1fc267ef60473bf18685dadcbb253b1320f57c4da2a1848`. The expected identities are:

| Journal tag | `created_at` | SHA-256 of local SQL bytes |
|---|---|---|
| `0000_strong_jean_grey` | `1774920397830` | `6a81bde590567b81bcd2cc0a60fa3906ad1cf35acb15760f894a849c1f0d53f0` |
| `0001_phase1_identity_tenant` | `1786538083713` | `d8340f1e53a88f657b0d4d6fd2c0ed5024018e6def8d0ebe3f47b183b80e030b` |
| `0002_phase2_previsit_estimate` | `1786557600000` | `783a664f222eb9aae9e1e04b2e7d46924898760f274e3549cee7891f566f7062` |
| `0003_phase3_field_actuals` | `1786644000000` | `fc6bff844eafff2c0ffa8aaddf269bcc144f61bece95afcfd0ba9dad0c278d9e` |
| `0004_phase4_learning_multitenant` | `1786730400000` | `660e02bf6da9122c73125500b2e3d44acd5e7d9444957860f7d8249f518ee8b5` |

`drizzle/sync-new-columns.sql` is inventoried separately because it is outside the journal. `db:push`, SQL-editor changes, old MySQL history and operational scripts are also separate mechanisms; ordering, similar DDL or a matching table count cannot substitute for evidence of execution.

## Runnable offline check

[The checker](../../scripts/migration-history-reconcile.ts) reads the versioned journal and exact SQL bytes. It has no database imports, no network calls, no environment credential lookup, no SQL execution and no automatic repair. It emits identities and aggregates, never SQL bodies or submitted unknown fields. It rejects malformed input, path traversal in journal tags, missing SQL, SQL-file symlinks, duplicate local identities and non-PostgreSQL journals.

From the repository root:

```sh
# Inventory only; exit 2 because no environment snapshot has been supplied.
node --import tsx scripts/migration-history-reconcile.ts

# Evaluate a separately collected, private metadata snapshot.
node --import tsx scripts/migration-history-reconcile.ts --snapshot /private/path/ledger-snapshot.json
```

Exit codes: `0` means exact Drizzle identities with both ledgers observed and no duplicate identity keys; `1` means a Drizzle identity discrepancy; `2` means invalid or incomplete evidence. **None means deploy-ready.** `migrationExecutionAllowed` and `schemaEffectsVerified` remain `false` in every report. `evidenceComplete` describes the requested metadata, not a passing migration gate. Supabase matches are informational and never replace Drizzle records; distinct statements are never concatenated into an invented file identity.

The strict snapshot format is:

```json
{
  "version": 1,
  "observedAt": "2026-09-19T01:41:10Z",
  "drizzle": { "available": true, "rows": [] },
  "supabase": { "available": true, "rows": [] }
}
```

For nonempty ledgers, each Drizzle row has exactly `createdAt` (positive decimal string) and `hash` (lowercase 64-character SHA-256); each Supabase row has exactly `version` (decimal string) and `statementHashes` (array of the same hash format). `available:false` requires an empty array and means unavailable, **not** a confirmed empty ledger. Do not include URLs, usernames, credentials, database names, raw statements, business rows or arbitrary metadata. The example above illustrates the format; it is not the observed 59-row Supabase snapshot.

## Collection procedure: read-only before any repair

1. Bind the observation to the exact candidate commit and intended environment in the **private** operator record. Confirm that the connection target is the intended environment without printing its connection string. An administrative inspection connection and the deployed application's effective principal are separate evidence subjects.
2. Open an explicit `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, apply a short transaction-local statement timeout, and verify `current_setting('transaction_read_only') = 'on'` before catalog queries. A connection parameter requesting read-only mode is insufficient when a pooler discards it. Finish with `ROLLBACK`; abort on errors or an unexpected target.
3. Check `to_regclass` for both ledgers first. If absent or access is denied, record unavailable; do not fabricate a zero count. Read only Drizzle `created_at::text, hash` and Supabase `version::text` plus SHA-256 of each stored statement's UTF-8 bytes. Preserve each statement separately and its parent version. Do not return the SQL body. Preserve NULL/malformed metadata as a collection failure instead of silently dropping it.
4. Use one transaction snapshot for the paired ledger collection. Record its observation time and coverage. Run the offline check, preserve its output hash and exit code, and retain the snapshot privately. Do not infer schema equivalence from the result.
5. Separately inventory schema objects and the effective application role: memberships and inherited grants, owner relationships, RLS/FORCE RLS, policy predicates, executable security-definer routines/search paths, sequences, triggers, extensions, constraints and their validation state. Preserve object identities privately; publish aggregates and dispositions. The application role must be measured through the deployment's actual connection/configuration, not inferred from a maintenance connection.

## Why replay is not a repair

- [The initial migration](../../drizzle/0000_strong_jean_grey.sql) contains plain `CREATE TABLE` operations. Replaying it against an existing schema is not a reconciliation strategy.
- [Phase 1](../../drizzle/0001_phase1_identity_tenant.sql), section 4, assigns NULL tenant rows across operational and catalog tables to the default tenant. Existing tenant stamps do not independently establish catalog ownership; executing that backfill would preempt the G4b ownership decision.
- [Phase 2](../../drizzle/0002_phase2_previsit_estimate.sql) and later files include exception handlers that emit `NOTICE` and continue. A process exit of zero would not prove all intended FKs, checks, backfills or triggers were established. Verification must compare actual postconditions and account for every skipped object.
- The earlier Recover found physical foreign keys not represented in the local `crew_velocity` definition. A blind `db:push` or a ledger-only insertion could hide or worsen that drift.

## Minimal sequence to close the technical gap

| Work package | Concrete output | Observable acceptance |
|---|---|---|
| 1. Freeze and describe the observed baseline | Private schema-only archive, object catalog, role/ACL/policy inventory and migration ledger snapshot, all bound to environment/time/hash | Archive scope and omissions explicit; no customer rows published; collected identities reproduce the same offline result |
| 2. Build the migration effect map | One disposition for every local file and every Supabase migration version: exact identity if demonstrated, effect already present, effect missing, conflict, or provenance unresolved | Every disposition links to object-level evidence; no guessed pairing by dates or counts; unresolved writes remain blocked |
| 3. Reconstruct in owned PostgreSQL | Restore the schema archive into a disposable isolated instance with no external endpoints, then separately test the intended local chain against a fresh disposable instance | Capture restore/replay failures and NOTICEs; inventory columns/types/defaults, constraints/validation/actions, indexes, triggers/functions, extensions, RLS and policies; compare both inventories to the observed source and intended contracts |
| 4. Prepare forward corrections | Reviewed, bounded SQL changes for proven missing/conflicting effects; preserve applied historical SQL and keep ownership backfills separate | Each change has preconditions, expected row/object impact, rollback/recovery steps and behavioral RED/GREEN evidence in the isolated baseline; zero unclassified ownership assignment |
| 5. Prove access and recovery | Exercise the actual intended application role against representative routes, and run a recovery drill against the relevant backup scope | No privileged fallback, foreign-tenant denial, audited mutation failure behavior, same-transaction rollback where required; restored data/object invariants and measured restore time documented |
| 6. Reconcile tracking and roll out | One explicitly reviewed choice of future authoritative migration mechanism plus a forward deployment plan | No fabricated historical execution; immutable adopted baseline provenance; exact candidate/environment identity, backup/rollback owner and stop conditions; migration, privilege and data changes applied only by the authorized rollout operation |

A schema-only archive with `--no-owner --no-acl` is useful for DDL comparison. It is **not** a full backup and does not prove recovery of customer rows, auth identities, storage objects, role memberships, grants or ownership. A successful local schema restore cannot close the full recovery gate. The intended fresh-chain replay must occur only in the disposable laboratory, because it contains backfills and writes by design.

The baseline/adoption strategy and order of bounded patches are engineering choices the team can prepare. The existing histories must remain preserved. Any eventual marker for an adopted baseline must state that it describes an observed schema, rather than claiming the five local migrations ran historically.

## Remaining G4b/G2 and policy boundaries

| Boundary | Evidence / next action |
|---|---|
| Legacy catalog ownership | [G4b design](g4b-catalog-ownership/2026-09-17-design.md) starts canonical empty and legacy unclassified. Prepare row manifests privately; an authorized owner must decide canonical/tenant/quarantine with provenance. No automatic assignment from a tenant stamp or matching price. |
| Cost-type meaning and lifecycle | Reconcile the duplicated taxability/time-tracking fields and intended effective behavior before migration. Choosing which contradictory business value wins requires owner evidence, not a schema heuristic. |
| Effective principal and privileges | [Lead DB helpers](../../server/lead-db.ts) set local role to `postgres` for regular reads/activities and missing-identity write fallbacks; [pipeline reads](../../server/pipeline-db.ts) and a [lead router path](../../server/lead-router.ts) do so too. Several queries still enforce tenant predicates/guards, so role switching alone does not demonstrate a data leak. Measure the actual principal and replace these dependencies with behavioral/physical coverage before removing role membership. Merely deploying a weaker role can break those paths. A development connection is not proof of deployment configuration. |
| G2 parent authorization | [Preview characterization](g2-preview-parent-characterization-20260918.md) documented permissive parent cases. Resolve the existing draft/project authorization contract before changing those semantics. A private draft for one operator does not permit foreign-tenant catalog reads. |
| Catalog consumers and operational seeds | The approved design inventories inbound references and JSON consumers. Provisional numeric seed references, `price_book_items` contract ambiguity, and unclassified learning-layer identifiers require their own dispositions; do not add tables or reinterpret IDs automatically. |
| Audit and recovery | Some callers can use a transaction-bound audit handle; legacy best-effort callers and the legacy audit table remain a separate inventory. Do not claim audit atomicity globally. Recovery scope, retention, maximum tolerable data loss and downtime must be explicit before a production rollout. |

The operational facts do not reopen accepted G2 CRUD/history/UUID work or the completed coastal-seed transaction correction. Those units retain their exact evidence. This follow-up does not certify the complete G2/G4b family, PR #9, RLS globally, production access, or readiness for real customer data.

## Verification of this tool

[Behavioral tests](../../server/migration-history-reconcile.test.ts) cover exact byte identities, line-ending changes, additional SQL inventory, malformed local journals, absent files, symlinks, missing/unavailable/duplicate/conflicting ledger entries, independent Supabase statements, strict metadata rejection, and CLI exit/output contracts.

The initial contract scaffold produced 34 failing tests; after implementation those 34 passed. The separate CLI RED produced 6 failures with the 34 existing cases passing. Final focused result: **40 passed, 0 failed**. Focused TypeScript verification includes both the script and its tests, because the normal application `tsconfig` excludes `scripts` and test files. No database, migration, browser or external-service test was performed by this offline tool's validation. Whole-candidate validation is recorded separately by the coordinator.
