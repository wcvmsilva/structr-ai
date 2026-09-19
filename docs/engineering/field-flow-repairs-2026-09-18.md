# Field workflow repairs — 2026-09-18

This change repairs the existing Intake → Scope → Review → Estimate → Actuals path. It does not introduce a new domain, database table, payroll system, or production deployment.

## Behavior

- Intake creates the client, project, intake and their audit records in one transaction. A request UUID and fingerprint protect retries of the same submitted form; reusing that UUID for different details fails. The new-project form requires an address, explicit project type and service type. The existing geographic enrichment runs after commit and may leave the established unresolved-geography warning when unavailable.
- Scope generation rejects an intake belonging to a different project or tenant, unresolved ownership and deleted projects. Only assemblies explicitly owned by the current tenant and rules referencing those assemblies enter the engine. Draft, items and audit are written together.
- Navigation carries the actual project, intake and scope UUIDs. `/review` is mounted. An approved scope can use the existing `estimate.createFromScopeDraft` procedure and open its returned estimate; the UI does not claim that simultaneous conversions are idempotent.
- Priced scope estimates persist the engine's line items, selections, totals, client identity, tenant and scope provenance in real estimate columns. The canonical priced insert and its audit record share a transaction. Existing unpriced callers retain their previous interface.
- Estimate detail links to the same project's costs. Actuals uses the existing `actuals.list` and `actuals.record` domain, preserving UUIDs and converting entered dollars into integer cents. The UI sends no estimate budget authority. New records remain pending approval.
- `logAudit(params, transaction)` writes to the supplied transaction and propagates failure or a missing returned audit row. Legacy calls without a transaction retain their previous behavior.

## Verification in this workstream

Tests were written and observed failing before the corresponding implementation. The final focused run passed **176 tests in 13 files**:

- `field-flow-ui`, `workflow-route-context`, `scope-navigation-ui`, `review-estimate-handoff-ui`, `estimate-readiness-ui`;
- `transactional-audit`, `intake-atomic-create`, `intake-atomic-router`, `intake-ui-contract`;
- `phase2-pipeline`, `estimate-persist-priced`, `scope-generation-integrity`, `scope-draft-atomic`.

The focused tests cover UUID handoffs, validation and exact monetary conversion, foreign ownership, required intake details, retry conflicts, geocode failure behavior, rollback on constituent writes, durable audit failure, and persistence of priced output. The additional scope-catalog regression demonstrated two failures before correction and passed afterward, including a two-tenant catalog fixture.

These tests use synthetic data and mocked storage/transport. Static React rendering checks are not browser interaction or database-integration proof. The integrated browser laboratory and final whole-repository checks must be reported separately. No inherited database or service credentials were used in the test runner.

### Browser-discovered formula failure

The coordinator's isolated browser run reached scope generation and reported `formula.trim is not a function`. The database fixture held a numeric-looking JSONB formula string; the driver boundary exposed it as a number. Type assertions in the router did not convert its runtime value.

`loadActiveRulesForEngine` now normalizes the shared boundary used by generation, preview and regeneration: finite numbers become text, formula strings remain unchanged, and nullish values retain the engine's established `1` fallback. Objects, arrays, booleans and nonfinite numbers fail before persistence. Regeneration loads and validates the candidate output before clearing its previous items. This does not claim full transactional regeneration or change the existing arithmetic evaluator.

The new `scope-formula-boundary.test.ts` uses the real loader, routers and scope engine with controlled IO. RED reproduced 18 failures, including the observed crash on all three consumers. GREEN passed **20 new cases**, and its focused scope regression run passed **233 tests**. The coordinator records the browser rerun separately.

### Component quantities and actual-cost budget

Independent review identified that assembly quantity was applied to batch totals but omitted from persisted component quantities. The transformation also dropped the textual cost code and the priced component/assembly totals and margin fields consumed by estimate detail.

Component quantity now covers the selected assembly count. Unit rates and batch totals remain those computed by the pricing engine. Already-rounded component line totals are extended by the same assembly quantity and persisted explicitly, with margin fields and the actual textual cost code passed from the catalog adapter. A catalog UUID is never substituted for a missing code. The JSONB TypeScript interfaces describe these optional fields; no physical columns or tables were added.

`estimate-component-extension.test.ts` produced **7 expected RED failures**, then passed all **7 cases**; focused transformation/persistence regressions passed **105 tests**. Its real-engine fixture uses two assemblies, each containing 2.5 units at cost 4 and price 8. The stored quantity is 5, cost 20 and price 40; actual-cost budget extraction returns 2,000 cents under the exact `FLOW-SYN-01` code. The input calculation is unchanged.

Per-assembly cent rounding can still make a collapsed CSV quantity × unit price differ from the approved total. The tests explicitly retain the existing `blocked_reconciliation` result for a one-cent edge case. The patch preserves the computed budget and does not silently alter prices to force export reconciliation.

## Boundaries for readiness review

- The scope-generation filter protects this route. It does not certify all legacy catalog CRUD/preview routes or solve the catalog ownership migration.
- The per-submission retry key is not general customer deduplication and does not prove concurrent pipeline estimate conversion is idempotent.
- The separate legacy Projects creation form was not migrated by this repair. The validated identity-preserving entry point is Intake.
- The browser run also exposed a minor scope-table presentation issue: the assembly's default unit UUID is shown instead of its unit label. This remains a presentation follow-up; component pricing uses the separately resolved unit label.
- Assembly price-history provenance is resolved by the pricing adapter. Existing estimate line-item mapping does not persist each adapter `pricingRecordId` as a dedicated field.
- Approval/payment execution for costs and payroll remain their existing separate responsibilities. Recording a pending cost does not pay a worker.
- Passing these checks does not attest Supabase RLS, migration application, recovery of a production database, or permission to enter real customer data. Those are separate release gates.
