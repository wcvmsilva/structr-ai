# Integrated readiness remediation — 18/19 September 2026

## Delivery decision

The user authorized this order: security and migration reconciliation; server authorization for PDF/JSON; the screen workflow and actual-cost linkage; integrated review, GitHub CI, and environment/permissions/recovery checks. The user also explicitly authorized publication of the package to the public GitHub repository. This is a review candidate. A green CI run alone is not permission to deploy or evidence that the live environment is ready for customer records.

This record continues the [initial reconciliation](progress-reconciliation-2026-09-18.md), whose 3,246-pass result and remote observations remain historical. New evidence must identify the new tree. Private diagnostics, database archives, source customer documents, credentials and browser sessions are excluded from publication.

## Code changes and bounded evidence

- PDF and JSON now enforce the same server-side approval-cycle authorization as the existing export policy, before generating or storing the document. The authorized snapshot is reused. See [export authorization](estimate-document-export-authorization.md).
- Production startup rejects configurations that do not enable strict tenant isolation. This application guard does not replace database grants/RLS or repair legacy ownership.
- The local laboratory now uses `TENANT_STRICT=true`. Its old value `1` did not enable the application's strict parser. Earlier laboratory results must not be described as strict-mode evidence. See [laboratory correction](ed-pilot-lab.md).
- Intake now persists client/project/intake together, scope generation preserves tenant and parent links, Review has a mounted route, and the estimate retains its priced columns. See [field-flow repairs](field-flow-repairs-2026-09-18.md).
- The calculation paths explicitly request a complete price graph; raw assembly detail and clone reads remain available without forcing pricing. See [pricing adapter](assembly-component-pricing-adapter.md).
- Actual-cost recording resolves its approved budget on the server, validates tenant/project/reference relationships, and commits the cost, audit records and refreshed totals together. See [actual-cost authority](actuals-record-authority.md).
- Scope-to-bundle conversion persists the bundle, effective items, snapshot, status and audit in one transaction. See [conversion repair](scope-review-bundle-conversion.md). Individual focused tests do not replace final integrated verification.
- The migration reconciliation utility compares exact versions and SQL hashes without writing a ledger or replaying a migration. See [migration history](../security/migration-history-reconciliation-2026-09-18.md).

## Fresh read-only environment observations

The connected Supabase environment was inspected on 19 September UTC (18 September in Charleston). Metadata queries used read-only transactions. No business records, roles, policies, migrations or ownership classifications were changed.

| Check | Observation | Consequence |
|---|---|---|
| Migration identity | Local Drizzle history contains five SQL files. The environment's Drizzle ledger is empty; its Supabase ledger contains 59 versions and 52 distinct statement hashes. No local file matched exactly. | **Unresolved.** Existing columns cannot establish which SQL ran. Do not replay these files or mark them applied by inference. |
| Schema names | All 83 expected table definitions and their expected column names were present. Extra public relations include platform objects/views. | This is a name-level inventory, not proof of matching types, defaults, constraints, policies, triggers or migration lineage. |
| Row security and grants | Of 84 public base tables, 24 had RLS enabled and 60 did not. Reviewed catalog/project policies include unconditional predicates; some unprotected tables also have anonymous/authenticated grants. The dashboard's Data API switch is **disabled**, with an explicit “No schemas can be queried” notice. | Direct PostgREST exposure is currently contained by this configuration. Database/application privilege and ownership issues remain unresolved; do not enable the Data API on the basis of existing policies. |
| Application connection | The locally configured database connection authenticates as `postgres`, with RLS bypass and role/database creation privileges. Strict tenant mode was disabled in that local configuration. | **Unresolved.** The deployed application's environment and principal still need independent confirmation and a least-privilege transition. The new startup guard was not deployed. |
| Platform advisories | Advisor output reported two RLS-without-policy notices, ten mutable-function-search-path warnings, a public extension warning, leaked-password-protection warning and a vulnerable database-version warning. | Disposition and remediation remain open. Advisor output is not an exhaustive access-control audit. |
| Recovery | The dashboard lists seven daily physical backups, 12–18 September; the latest observed is 18 September 09:06:48 UTC. Point-in-time recovery is not enabled. A separate private schema-only archive was captured for inspection. | Production restoration has not been demonstrated. The dashboard explicitly says database backups exclude Storage objects. The schema-only inspection archive is not a business-data, Auth, Storage or full-platform backup. |
| Document storage | The legacy PDF/JSON endpoints depend on a storage proxy. Its production configuration and retrieval/retention have not been demonstrated. | Unit authorization tests do not certify the external storage service. |

Dashboard access became available during this verification; only read-only navigation was performed. No backup was restored onto the production project and no paid add-on or integration was activated. Official operating references: [Supabase environments](https://supabase.com/docs/guides/deployment/managing-environments) and [backup coverage](https://supabase.com/docs/guides/platform/backups).

## Remaining release gates

1. Establish the actual migration baseline from retained SQL/history/owner evidence; reconcile it on a clone and independently review the resulting changes. Preserve the current environment. Do not run blanket backfills or swallow migration failures.
2. Complete the approved G4b catalog ownership units. Existing tenant stamps, NULLs and names are not authority to classify shared or tenant-owned commercial data.
3. Confirm the deployed environment and effective application principal, remove dependence on elevated roles in a reviewed change, and verify access through both application and exposed database APIs.
4. Prove restoration of the intended production backup, including the documented boundaries for database data, authentication and file storage; record the recovery procedure and operator.
5. Review the final candidate and obtain CI on its exact commit. Then validate the representative deployed workflow, login/permissions and document retrieval before authorizing real records.

The earlier G4b recover STOP is a dated finding, not a refusal to perform the newly authorized work. The factual migration, ownership, privilege and recovery gaps remain release blockers until supported evidence resolves them. PR #9 is not automatically merged or closed by this candidate. Hours/payroll implementation and the start of any customer job remain outside this delivery.

## Verification record

Final local verification completed on 19 September UTC. The PR records the resulting commit and GitHub CI; a local pass is not a remote CI result.

| Check | Result |
|---|---|
| TypeScript | `pnpm check --incremental false`: exit 0, no errors. |
| Default suite | `pnpm test`: **3,633 passed, 343 skipped, zero failures**; 103 files passed and ten skipped. Skips remain unverified by this default invocation. |
| Build | `pnpm build`: exit 0. The existing large-bundle warning remains. |
| Opt-in physical PostgreSQL regressions | **264 passed**, nine files, zero skips/failures, rerun against the final source. These overlap the default suite's skipped tests; do not add them as new tests. |
| Independent review | Source/transaction/authorization review and public-package privacy review completed. No remaining blocker to a **draft PR** was identified; production gates above remain open. |

The final browser rehearsal exercised Intake → Scope → Review → Estimate → Actuals using an owned disposable PostgreSQL cluster, strict tenant mode and a synthetic administrator. It created linked client/project/intake records, generated and approved quantity two, and persisted an estimate with $40 cost, $80 price and 50% gross profit. The estimate lines retained the canonical cost code and extended quantity. PDF/JSON controls were disabled in draft and enabled after approval. A $10.25 materials cost was saved against the approved estimate with a $40 budget reference and −$29.75 variance, remained pending and survived a full page reload. Independent SQL assertions confirmed tenant/client/project links, cents, approval baseline, zero committed cost while pending, and the cost/totals audit records.

This was not a clean certification of every screen or integration: the geography override panel still reported a load failure in the synthetic fixture; Scope/Review displayed a unit identifier while Estimate displayed the correct unit. Geocoding credentials were intentionally absent. The laboratory blocked document-upload endpoints, so no external PDF/JSON storage/retrieval was exercised. Lead creation, production login/RLS and the actual-cost approval/payment journey were outside this rehearsal. The local session used a synthetic signed administrator; it does not prove production authentication or least privilege.

The owned PostgreSQL regression run exercised 264 tests across nine opt-in security/transaction files with no failures or skips. These tests are part of the normally skipped set, not 264 additional new tests. They use temporary clusters and do not validate the configured Supabase environment.

After the final browser rehearsal, a synthetic recovery check dumped and restored the owned local PostgreSQL database into a separate disposable database with a single-transaction restore. All **83 table content fingerprints matched, covering 47 synthetic rows**. The archive SHA-256 was `5e52fc8ea1e0412fc8b34008ad1065d84c96039994a87c67f5f45f7445f8092b`. This demonstrates the exercised local mechanism; it is not restoration of the platform's production physical backup. The archive and detailed fingerprints remain private. The supervisor was deliberately stopped after verification; its cancellation exit was accompanied by `cleanupVerified: true`, and both application/supervisor processes were confirmed absent.

No new SQL migration or table was introduced by this remediation. The schema TypeScript change documents priced JSON fields. This delivery does not mark the unresolved live migration history or overall security program complete.
