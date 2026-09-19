# Estimate readiness presentation — 2026-09-18

This maintenance follows the isolated laboratory pilot. The accepted private P2 candidate remains unchanged. This public reconciliation copy uses wholly invented fixtures; customer identity, commercial amounts and private evidence are excluded.

## Behavior

- The list and detail display discount percentage from stored `discountAmount / subtotalPrice`. `discountApplied` is a boolean and is never used as a percentage. Missing, nonnumeric, nondecimal, nonfinite, negative, or inconsistent amounts and a nonpositive subtotal show **Unavailable**. Valid zero discounts show **0.0%**. This is presentation only; stored prices and financial calculations are unchanged.
- GP metrics have neutral styling. The list links to the detail for policy verification without requesting a policy evaluation per row.
- The detail and approval dialog render the existing `estimate.profitShield` response: effective floor, evaluated margin, violations, warnings, and remediation. An unresolved channel is explicit, and its floor is labeled as a fallback. Legacy nullable snapshot fields do not become a failed result or a default 35% policy.
- The existing read-only `estimate.exportAuthorization` query controls PDF, JSON, and CSV download attempts in the UI. Pending queries, active refetch, paused requests (including offline refetch with cached success), errors, missing results, denial, and pending status changes disable downloads. Cached success never overrides a query error or pause. Approve/reject/reopen refresh the draft, list, policy evaluation, and export authorization.
- Positive export authorization permits an **attempt**; it does not promise a file will be produced. CSV format validation is labeled separately from authorization and the CSV server's additional validation and reconciliation. Rendering does not invoke an export preflight or other mutation.

## Verification and limits

The focused `server/estimate-readiness-ui.test.ts` renders the actual React list/detail pages to HTML, substituting only transport/auth/routing hooks. It covers boolean discounts, real zeros, incomplete/malformed amounts, numeric bounds, neutral GP, nondefault policy floors, unresolved channels, server warnings, loading/error/refetch states, all three download buttons, and readiness invalidation after status changes.

TDD evidence is retained under ignored `tmp/ed-readiness`: initial `ui-red` (32 expected failures, 1 pass), `ui-green` (33 passes), numeric-boundary RED runs, and `ui-final` (56 passes, no failures). Independent review then added paused cached-success cases and corrected the CSV-specific copy: `ui-v2-red` reproduces 3 expected failures with 55 passing cases; `ui-v2-green` verifies all 58 cases. All focused runs use `--no-cache`; the dedicated type check uses `--incremental false` and does not write to shared dependencies. Earlier freeze and verification artifacts remain unchanged. No packages were installed.

These checks establish rendered behavior, not browser interaction or end-to-end export. Root owns the final complete suite, global type check, and isolated browser validation. This change adds no endpoint, schema, business policy, approval domain, or pricing rule. The CSV endpoint enforces its existing authorization/validation/reconciliation chain. The legacy PDF/JSON endpoints check read access and generate files; they do **not** enforce the same lifecycle gate or CSV chain. Disabling their UI buttons is not backend enforcement, and direct calls remain a documented limitation outside this maintenance scope. Existing local print behavior is preserved. No live database, external upload, customer send, deployment, or publication is part of this UI change.
