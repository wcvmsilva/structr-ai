# A1 generic estimate writers — isolated integration candidate

This slice builds on the transaction foundations in PR19. It protects existing generic draft creation and editing; it does not enable the new positive approval or version workflow and is not a release for real customer data.

## Behavior

Generic creation refuses legacy `approved` and both A1 decision statuses. It requires trusted actor and tenant arguments, validates an active project/account/company, derives the client from that project, and rechecks project write permission in the insert transaction. An incomplete project can retain a draft with no client; creation does not invent identity or approval evidence. Supplied pricing is preserved. Both priced and unpriced inserts commit with durable audit evidence, or roll back together. The legacy bundle caller now forwards authenticated identity and relies on this atomic audit.

Status changes, rejection, archive, discount and operational notes now use the same SERIALIZABLE transaction for current context, permission, locked estimate, update and audit. The transaction checks uncached A1 permissions and retries the entire operation at most three times for serialization/deadlock failures. Audit failures are not retried. Editing an incomplete draft does not require filling its client, and these operations never change project/client identity.

A durable approval or snapshot relation prevents generic financial/status changes even if the displayed status is inconsistent. Both A1 decision statuses also deny those edits. Operational notes remain editable, without changing immutable reviewed notes. Historical capture retains operational notes and visual archive; it cannot acquire calculated or approval authority through a generic status or financial edit.

Discounts require a current, unlocked, undecided calculated draft. Both derivation edges are inspected with a bounded traversal, identity checks and historical-link checks; missing required version/change-order parents, missing records, cycles, mismatched context and unknown calculated source evidence fail closed. This is application protection, not a claim that all undecided ancestors are database-immutable.

Existing business procedures receive actor/tenant identity from the authenticated context. Known context, conflict and permission failures produce actionable responses. Typed writer and audit failures in these protected paths do not return internal details to the operator, including audit text that resembles an old business-transition error. This does not claim to replace every legacy untyped pipeline error response.

## Scope and evidence limits

No tables, migrations, pricing algorithms, production data or positive authority endpoints are added by this slice. Existing legacy positive approval/version wrappers still require replacement; the published Core migration must not be deployed alone with those legacy wrappers. Legacy status compatibility outside recorded A1 decisions is retained. The original discount arithmetic is unchanged. Its floating-point precision is a blocking dependency before enabling version copies with the Core's larger exact-money range; implement exact arithmetic or reject unsupported values at the server before that activation.

The behavior suites model commit/rollback, SQL bindings, authorization, durable audit failure, relational evidence and route dispatch. They do not establish physical PostgreSQL locking or real-browser behavior. Separate environment/runtime-principal/migration/recovery and browser gates remain open. No customer acceptance, field start, budget materialization or payment authority is created by these changes.

Version projection remains a separate pending architecture amendment. It must define explicit currency provenance, closed copying of price/line metadata and exact presentation values before implementation. No historical approved amount is recalculated or approved anew here.

## Candidate verification

The new suites contain 213 behavior cases: 118 mutation cases, 31 creation cases and 64 route cases. All passed locally after recorded RED failures. The focused compatibility runs additionally passed 190 existing cases (66 historical guards, 51 Phase2 flow, 16 status guards, 46 tenant/bundle controls, four priced persistence and seven component-continuity cases). These are unit/integration fakes, not new physical database proofs. Exact-commit GitHub CI is recorded in the pull request; this document alone is not evidence that the full release gates passed.
