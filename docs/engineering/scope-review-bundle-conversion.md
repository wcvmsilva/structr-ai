# Scope Review: persist the converted bundle

`scopeReview.convertToBundle` previously marked an approved scope as converted and
created a review snapshot whose `bundleId` was null. It now returns the IDs of an
actual bundle and its linked snapshot. The existing route and response fields remain;
`bundleId` is added to the response. No table, migration or endpoint is added.

## Conversion boundary

The route uses `adminTenantProcedure` (authenticated, admin and resolved tenant),
validates the scope UUID and retains project-level `approve` access. The helper
`convertApprovedScopeToBundle` rechecks the persisted active admin profile, tenant,
project, scope status and original approval identity/time inside one transaction.

The transaction locks the scope row, reads the effective selection from original
items and the latest review deltas, and verifies each active catalog assembly using
the existing tenant policy. Catalog names come from the database, not the optional
client name map. Removed items stay removed; quantity adjustments are retained.
Empty selections, missing or duplicate assembly identities, invalid quantities and
missing/inactive/foreign assemblies fail before any conversion write.

The bundle has the caller's tenant and an explicit zero discount: converting a
reviewed scope does not accept the bundle schema's default discount as a commercial
decision. An unknown project region is recorded as `unspecified`. Bundle items,
review snapshot, approved-to-converted state update and audit are committed together.
The snapshot preserves the original approver and approval time; the audit identifies
the converting operator and links scope, project, bundle and snapshot. Audit failure
propagates and rolls back this transaction.

`TENANT_STRICT=true` is required for the isolated pilot and production rollout.
In transitional non-strict mode the existing policy still permits legacy catalog
rows with no tenant; conversion never changes or assigns those catalog rows a
canonical tenant.

## Evidence

The new `server/scope-review-conversion.test.ts` exercises the real tRPC route,
authorization, state machine and audit function with a transactional database driver
model. Its initial run against the old implementation had 28 expected failures and
8 passes; the corrected implementation passes all 36 cases. Coverage includes linked
IDs and quantities, removal/latest adjustment, catalog isolation, caller boundaries,
approval evidence, duplicate requests, and rollback after bundle/items/snapshot/state/
audit/commit failures. The model performs each injected write before throwing, so
the assertions check restoration of all business and audit rows.

The model proves transaction composition and application behavior; it does not prove
physical PostgreSQL locking or concurrent execution. No live database or migration
was used for these tests. Integrated suite, types and browser evidence are recorded
separately by the integration owner.

## Deliberate limits

- This fix does not repair previously converted rows with missing bundles. A scope
  with an existing snapshot is refused rather than creating a second ambiguous one.
- The existing approval action records approver/time but does not seal an immutable
  content snapshot at approval. This conversion snapshots the effective selection
  when converting. It does not establish a content-bound approval signature or
  serialize legacy delta writers that do not use this scope-row lock.
- Scope confidence warnings retain their legacy response names, including
  `profitShieldPassed`. They are not margin evaluation or permission to approve or
  export an estimate. Pricing and estimate approval remain separate gates.
- The legacy `scope.convertToBundle` endpoint is outside this change. The canonical
  scope-to-estimate pipeline remains `estimate.createFromScopeDraft`; no claim is
  made that every legacy bundle/estimate path has been unified.
