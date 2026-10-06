# A1 transaction foundations — isolated integration candidate

This candidate builds on the immutable A1 Core. It is not a deployable approval workflow by itself. Positive approval routes, governed exports, version integration, later commercial authorities and operational boundaries still need integration and review. Do not apply these migrations to an existing environment merely because unit tests or CI pass.

## Behavior

- The existing calculator draft writer takes tenant/actor identity from authenticated arguments, locks and validates project/client context, rechecks write access in the same transaction, and commits the draft with durable audit evidence. It preserves calculated values; it does not reinterpret a historical approval as a new calculation.
- The calculator now requires an explicit existing project, supports project search, and blocks generation when selection/query/calculation is unresolved. It sends the project ID with the original selections. The server resolves the client and rechecks access; listing a project is not write authorization.
- A1 authorization uses the writer's transaction and bypasses the permission cache. Project, membership, profile and applicable grant rows are checked under the same context. Other callers retain the existing access API.
- The pure current-review adapter validates exact financial data, conflicting channel evidence, the active geographic zone, current policy and provenance. A geographic review is tied to the exact stored address, project/tenant, geocode result and capture timestamp. Empty or stale evidence cannot establish eligibility. No price or cost is recalculated by this adapter.
- Internal decision helpers provide review, audited approval/revocation, stored reads and idempotent replay. A retry of an old approved request returns its recorded decision even after revocation; it cannot reactivate it. New decisions compare the expected draft version, content hash and policy hash with the current locked review.
- Database retries encompass the entire SERIALIZABLE operation, at most three times, for serialization/deadlock failures only. Audit failures abort atomically and are not retried, including when another error wraps the audit failure.

These helpers are not newly mounted business endpoints. In particular, the legacy positive approval wrapper still needs replacement with the reviewed command contract and removal of operational side effects. Internal audit errors must be mapped to a generic response at that boundary; raw driver messages or `auditCause` must never be serialized.

## Concurrent changes that introduce previously absent evidence

Locking existing child rows does not by itself protect a transaction that previously saw no matching child. The disposable PostgreSQL lab reproduced stale membership, tenant-policy and historical-link reads while a decision held an older snapshot. The integration adds three migrations without rewriting migrations0005–0007:

| Migration | Behavior |
| --- | --- |
| 0008 | Membership INSERT or project/user rekey creates an MVCC version of its parent project. |
| 0009 | Tenant-settings INSERT or tenant rekey creates an MVCC version of its parent tenant. |
| 0010 | H1 import INSERT and A1 snapshot INSERT both version their project; a deferred H1 check revalidates recorded A1 lineage in that tenant/project. |

The witnesses update `updated_at` to itself. They preserve visible business values and roll back with the originating operation. They use invoker rights, qualified objects, a fixed search path and an exactly-one-parent check. They add no privileges, data backfill, side connection, bypass role or authority status. Missing parent-update rights fail closed.

An H1 link touching a recorded decision or either kind of ancestor must be rejected even if the decision is revoked. Independent historical capture in the same project remains allowed. The symmetric project witness matters because either the H1 writer or A1 writer can be the transaction with the older snapshot.

The deferred historical read uses function-local `row_security=off` to fail when row policies would omit evidence. This setting does not grant visibility or bypass a policy; see [PostgreSQL17 row-security documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html). No table policy or global setting is modified. Runtime-principal/RLS verification remains required: tests performed as the disposable lab owner do not establish production visibility or privileges.

## Evidence and explicit limits

Tests cover actual adapter/authorization/Drizzle behavior in an owned socket-only PostgreSQL17 lab. The transaction physical tests require `A1_TRANSACTION_PHYSICAL_CONFIG`, reject `DATABASE_URL`, verify server identity/data directory/role/socket/no TCP, and use synthetic UUID fixtures. Append-only historical and approval evidence remains in that disposable lab until teardown; tests do not disable guards or truncate protected data to clean up.

The original membership reproduction changed from three passes/one failure to four passes after0008. The policy/history diagnosis first needed a correction to a nested zone ID in its synthetic fixture; after that correction, two controls passed and four real concurrency assertions failed. Those findings led to0009/0010. The historical-link suite changed from ten failures/one pass to eleven passes. Its older-H1 ordering already produced serialization failure in the initial topology; the observed defect was acceptance of the contradictory link on the subsequent fresh retry. Do not claim the initial run proved an unsafe commit in both directions.

The expanded authorization suite contains fourteen additional prepared cases that were not executed after a reviewer service interruption. The original four were validated separately through the normal tool approval path. Do not report the expanded suite as physically green. Unit/SSR tests of the calculator validate callback/payload behavior, not real-browser execution or pricing-engine mathematics.

This patch protects recorded A1 decisions against new H1 associations. It does not claim to freeze every still-draft version or all arbitrary future changes to an undecided ancestor. Version formation, generic writers and their lifecycle guards remain separate integration work.

Before real use, finish the approval/version wrappers, exports, customer/field authority boundaries and complete browser flow; reconcile migration history, verify the actual runtime principal and recovery procedure, and review the assembled candidate. No customer acceptance, field start, payment, operational budget, production migration or production deployment is authorized by these technical checks.
