# Exact discount calculation in existing estimate drafts

The existing `estimate.applyDiscount` action could discard cents even for a 0% discount: `100000000000000000.01` passed through `Number` and became `100000000000000000.00`. The new calculation operates on integer cents throughout and derives the final amount by subtracting the rounded discount.

## Input and rounding contract

The endpoint retains its numeric percentage input and the entire finite 0..50 range. Its authoritative decimal interpretation is the shortest round-trip `String(number)`, expanded exactly if written in exponent notation. It neither limits fractional places nor rounds the percentage; negative zero normalizes to zero. It cannot recover decimal digits already lost before JSON/JavaScript parsed the number. The shared validation runs at the route boundary and again at the direct helper boundary.

The stored subtotal must satisfy the unchanged A1 Core decimal-to-minor normalizer: a nonnegative decimal string with at most 18 significant whole digits and two fractional digits. Missing, malformed, overprecise or out-of-range values fail before update/audit; they are never replaced with zero. A literal zero remains an editable draft amount, independently of stricter approval requirements.

For subtotal `S` cents and percentage `n/d`, the discount is `floor((S*n + 50*d)/(100*d))` cents. This rounds an exact half-cent upward. The final amount is exactly `S - discount`. Both persisted monetary values use two decimal places. For example, a one-cent subtotal at 50% yields a one-cent discount and a zero final amount, without independently rounding both halves upward.

Money never passes through floating-point helpers. This is an intentional requirement of the accepted 20-digit minor-unit domain, which cannot be represented exactly by `round2`/`safeParseFloat`/`Number`.

## Persistence, audit and error behavior

The existing serializable mutation transaction and account/project/lineage/undecided/current-draft checks remain in force. Invalid percentages fail before opening it. Invalid stored subtotals fail only after its current-context checks, before any update. The original permission, historical-estimate restriction and immutable decision protections are unchanged.

The action preserves `discountApplied: true`, including at 0%. Audit records now store that flag as a boolean, the normalized percentage separately as `discountPct`, and the same exact amounts written to the draft. Before-values remain the exact prior stored state. Audit failure rolls the mutation back. No cost, line-item, metadata, historical amount or approval field is rewritten.

Typed invalid-percentage errors map to `BAD_REQUEST`; invalid stored subtotals map to `PRECONDITION_FAILED` with a corrective message and no raw stored contents. Persistence and audit errors keep their existing mapping.

## Scope and validation boundaries

This slice changes the existing pure calculation/helper/router integration and adds no tables, migrations or endpoints. It does not mount positive approval/version commands or grant client acceptance/execution authority. Published A1 Core schemas and content hashes remain unchanged. Later versioning and export consumers still require their own exact-value integration and validation.

Behavioral verification covers pure arithmetic, the real helper with a transactional storage fake, and actual tRPC callers with mocked dependencies. Storage-fake rollback assertions are application-level evidence, not proof of physical database locking or runtime-role permissions. Exact-commit CI results and the completion counts accompany the candidate publication.
