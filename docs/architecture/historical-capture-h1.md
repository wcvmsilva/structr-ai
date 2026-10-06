# H1 historical capture — review summary

Review basis: implementation contract V2 and V2.1 addendum; isolated H1 checkout based on `0bd5d831ad2115fef069e979b0cc89991b52c7f7`. This document describes the H1 package and its acceptance gates. It is not production authorization. It contains no real customer records or commercial values.

## Problem and resulting behavior

The ordinary estimate writer recalculates current assemblies and cannot preserve a previously quoted price reliably. H1 adds a separate historical capture path: record the complete original proposal, select whole source lines, record the selected totals as reported, and create a linked historical **draft**. Later catalog changes do not recalculate those stored facts. Missing costs, currency, and taxability remain unknown; reconciliation reports discrepancies without changing the declared price.

The package adds four historical evidence tables, exact-decimal normalization, immutable source/selection hashes, transactional persistence and audit, protected tenant/project APIs, and a dedicated capture/read screen. Existing estimate, export, field, actual-cost, and analytics consumers refuse or exclude H1 records before interpreting legacy financial fields. Detection uses either the historical source marker or its durable import relationship. The existing generic-writer prohibition on `approved` remains intact.

## What H1 does not authorize

- Historical capture and a reported customer approval note are evidence, not internal approval, proposal issuance, verified commercial acceptance, or execution authorization.
- Even a fully reconciled historical draft cannot be approved, repriced, discounted, exported, cloned through a legacy version/change-order writer, or used as an operational budget or field-task basis. Descriptive notes and visual archival do not change that boundary; archived history cannot reopen for financial editing.
- H1 does not complete R3 or R4. A1/A2/A3 still need the reviewed authority schema, atomic decisions, accepted commercial packages, execution baselines, consumer conversion, and legacy reconciliation.
- The first screen supports manual transcription against existing project/client identities. It does not perform OCR, create identities by name, allocate whole-proposal discounts/taxes to selected lines, or establish custody/authenticity of an attached file. A content hash is not a document signature.

## Integrity and security boundaries

Money uses exact decimal strings and integer minor units; quantities/rates have explicit precision limits. Unknown currency keeps normalized financial values null while preserving original text. Closed, versioned JSON is checked at the API/engine, storage, and read boundaries.

Source and selection writes revalidate active tenant/project/client/actor and project permission inside the transaction. Advisory request locks, unique constraints, and predecessor locking support deterministic replay and one linear successor. Evidence, draft, child links, and audit share the transaction. Contextual foreign keys prevent cross-context links; immutable parent counts and deferred parent/child triggers prevent incomplete sets and later appends. Those protections require the versioned migration, not merely the ORM definitions.

Independent review found a P1: the four new public tables initially lacked RLS. The assigned correction adds RLS in migration and schema with no permissive policies or new grants; verify that correction and its physical configuration proof on the final package. Default-deny for ordinary roles does **not** establish safety for table owners, superusers, or `BYPASSRLS`. The effective application principal, production grants, authentication binding, and production policies remain a separate gate; see `docs/security/effective-app-principal-2026-09-19.md`. Do not add an administrative-role fallback to obtain a passing test.

## Coverage and remaining limits

Behavioral tests cover exact precision/null semantics, partial selections, reconciliation, request conflicts/replay, transactional failure, tenant/project access, immutable evidence, historical consumer refusals, and presentation. The opt-in physical suite exercises actual PostgreSQL connections for concurrency, contextual constraints, deferred completeness, and audit rollback. A default test run that skips it is not physical evidence.

The UI tests render components statically, including exact original text, unknown values, line-level reconciliation findings, and expected/reported amounts. They do not prove form submission, retry after a lost response, switching project/source, reloading saved selections, or legacy-detail navigation. A synthetic browser rehearsal must cover those interactions. Current lists request only the first 100 projects/sources; the screen does not consume source pagination cursors. The initial screen does not expose the API's predecessor-revision workflow. Record these usability limits; do not claim a complete financial review interface.

No additional material integrity blocker was identified in the independent DB/engine/schema/router/UI read-through. That assessment does not substitute for the runner's final evidence or review of the separate legacy-guard patch.

## Acceptance and release gates

1. Close the RLS finding and review the final diff, including migration/schema parity. Obtain the required independent patch review with no open blocker.
2. On the final candidate, record zero TypeScript errors and zero test regressions; satisfy the contract's behavioral coverage minimums. Retain the real RED/GREEN evidence. Report skipped tests separately.
3. Replay the migration in an owned disposable PostgreSQL environment and run the physical suite explicitly, including verification that all four RLS flags are enabled with no permissive policies. Report this as a configuration proof, not proof of the application's effective principal. Principal-specific access/denial and production equivalence remain withheld; do not create an elevated role or use `SET ROLE` to manufacture that claim.
4. Complete the synthetic browser rehearsal and verify that historical approval/export/field actions remain unavailable, including after reload and through legacy entry points. Confirm that calculated estimates retain their existing behavior.
5. Publish only the reviewed technical package and obtain GitHub CI on its exact commit. Do not include private proposals, pilot values, lab configuration, credentials, or local evidence logs. A green GitHub job does not imply the opt-in physical/browser checks ran unless they actually did.
6. Keep production migration and real-data use withheld until the effective environment/principal, permissions, backup/restore and recovery plan, and the remaining commercial/execution authority work are reconciled. H1 publication alone is not field readiness.

## Deployment ordering and recovery

This application revision queries the historical tables from existing estimate consumers. Do not deploy the server before reviewing and applying migration `0005_historical_estimate_capture.sql` in the intended environment. ORM push is not a substitute: append-only and deferred completeness triggers exist only in the versioned SQL migration. The migration has no legacy ownership backfill and does not establish a runtime database principal.

Keep the business API closed until the environment and migration ledger are reconciled and the actual application role can be proven safe. RLS is enabled without new grants or policies; ordinary roles without a policy are denied. Table ownership or BYPASSRLS can bypass this boundary, so the effective-principal review is still required.

Before real writes, verify a restorable backup and rehearse recovery on a copy. Do not delete immutable historical evidence to reverse an application release. Application rollback must preserve the additive tables and their relationships; a down migration that drops captured evidence is not an approved recovery procedure. Existing customer acceptance and field-start facts must never be inferred from this technical deployment.

## Deliberate precision rule

Historical decimal capture uses exact strings and BigInt minor units instead of the legacy floating-point helpers. This preserves recorded values up to PostgreSQL numeric capacity without rerounding historical evidence. The compiler target is ES2020, consistent with the supported modern runtime. New calculated estimates retain their existing pricing and Profit Shield engines.

## Physical test reproduction

The physical suites require a disposable PostgreSQL cluster owned by the runner, with a private Unix socket and no TCP listener. They do not use DATABASE_URL. Start from an empty database containing the base schema at commit `0bd5d831ad2115fef069e979b0cc89991b52c7f7`, then apply the complete versioned H1 migration in a transaction. Do not use the current ORM-generated schema alone: it lacks migration-only triggers. The checked-in test rejects a configuration that is not the dedicated local H1 laboratory.

Set H1_PHYSICAL_CONFIG to a private JSON file containing directory `/private/tmp/structr-h1-<unique>`, dataDirectory `<directory>/data`, socketDirectory `<directory>/sock`, database `h1_test`, user `h1_lab`, and the cluster port. Run both `server/historical-estimate-physical.test.ts` and `server/historical-estimate-schema-security.test.ts` with one worker. Retain the server identity, migration hash, exact results, and scope of the role used; stop only the verified owned cluster afterward. These tests certify disposable database behavior, not a Supabase production principal.
