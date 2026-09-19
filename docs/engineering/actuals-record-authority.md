# Actuals: authorized references and server-owned budget

`actuals.record` now derives its planned amount from the approved estimate snapshot.
The legacy `estimatedAmountCents` input remains accepted but is not forwarded by the
route or used by the helper. UUIDs and actual amounts in integer cents retain their
existing contract.

Before writing, the helper verifies the project and the approved, non-superseded
baseline against the caller tenant. A supplied change order must have approval
evidence, belong to that same project and tenant, and reference an authorized parent
estimate. The planned amount comes from the change-order snapshot when supplied;
otherwise it comes from the baseline. As before, `budgetEstimateDraftId` identifies
the baseline when both exist, while `changeOrderId` separately identifies the scope
that supplies the planned amount. The change order is used as budget authority when
no baseline is available.

Optional IDs for catalog codes, assemblies, subcontractors, estimate items and field
tasks are checked against their authoritative tenant. Project-owned references must
belong to the same project; field tasks must also match the selected change-order
scope. A catalog code ID must be active and consistent with supplied textual code;
its snapshot name comes from the catalog. A textual code without a catalog ID remains
valid for an unbudgeted cost; this change does not invent or require catalog records
for that existing workflow.

All checks, cost insertion, durable audit entries and project-total refresh run in
one transaction, using its database handle. The project row is locked before reading
the budgets and ledger. The total refresh records its own
`project.actuals_refreshed` audit with values captured before the update and the
applied values after it. Any insert, audit, total-update or commit failure rolls back
the new cost and related changes.

## Validation and limits

`server/actuals-record-authority.test.ts` exercises the real route, helper, project
authorization, audit function and variance engine with a deterministic database
driver. The initial guard tests failed in 27 cases (8 already passed). Adding atomic
rollback expectations produced 31 failures/8 passes. The project-total audit review
added two further failing cases after the first implementation passed 39 cases.
Final coverage includes 41 cases for budget tampering, ownership, foreign references,
approval evidence, unchanged cents/UUID behavior, same-tenant references, legacy
NULL-tenant policy, before/after audit and rollback after each write stage.

The tests model query execution and transaction rollback. They do not establish
physical PostgreSQL locks, concurrent scheduling, or the security of every Actuals
route. Existing approve/pay/reject/void/delete helpers and their older refresh path
are outside this patch. The project lock serializes this record path, not other
legacy writers that do not acquire it. Repeated requests without invoice identity
are not given a new idempotency contract by this change.

The existing tenant policy remains: strict mode rejects NULL-tenant references;
development rollout mode can still accept authorized legacy NULL rows. This code
does not reassign those rows to a canonical tenant. Production requires strict mode.
No migration, new table, new endpoint, live database write or broader G4 audit closure
is claimed.
