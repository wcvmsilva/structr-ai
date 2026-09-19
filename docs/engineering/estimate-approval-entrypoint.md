# Estimate approval must use the dedicated action

The generic `estimate.updateStatus` route previously accepted `approved` and wrote only the status. It could bypass Profit Shield and leave the draft without an approver, approval time or lock evidence. The existing UI already uses `estimate.approveEstimate` for approval; its use of generic status is reopening a rejected draft.

`updateEstimateDraftStatus` now refuses an `approved` target before accessing the database. The existing route still authenticates, validates its input and checks project approval permission first, then returns an actionable `BAD_REQUEST` directing authorized callers to `estimate.approveEstimate`. The accepted input enum and shared transition table remain unchanged so clients receive that guidance and the dedicated approval path continues to work.

The generic helper does not delegate automatically to approval: dedicated approval can also materialize work for a change order, which would introduce an unexpected effect. Other generic transitions and their existing audit remain unchanged. Refused approval writes no status, price, metadata or successful audit event.

## Verification

`server/estimate-status-approval-guard.test.ts` uses the actual router, authentication middleware, project access guard and estimate helper with isolated persistence and audit sinks. The driver looks up primary keys without making tenant or role decisions. Coverage includes direct-helper rejection before database access, both draft origins, authorized route rejection, anonymous and malformed requests, cross-tenant user/admin denial, unresolved tenant, missing permission/draft, reopening and archival, and both blocked and compliant dedicated approval.

The no-cache RED run produced four expected failures and twelve passes against the unmodified implementation. The changed implementation and focused regressions produced 212 passes, two existing skips and no failures. The earlier run's additional shared-cache permission error was retained and was not used as the clean RED evidence. Final full-suite and typecheck results are recorded separately in the readiness report.

## Limits

This patch closes one approval entry point. It does not redesign the existing multi-step writers, their best-effort audit, transactional behavior or the approved → archived → draft lifecycle. No schema, pricing, policy constants, commercial approval or new endpoint is introduced. These controlled-driver tests do not claim a physical database concurrency proof. The wholly invented public fixture remains a draft; no customer price adjustment or floor override is authorized by this correction. Public test amounts are invented and are not records of customer commitments.
