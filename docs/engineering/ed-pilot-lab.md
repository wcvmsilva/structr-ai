# Isolated synthetic estimate laboratory

This opt-in development harness exercises the existing application against a newly created, disposable PostgreSQL database. It is not production startup, an operational migration, commercial authorization, or field-release acceptance.

## Public fixture

`selection.synthetic.json` contains wholly invented customer/operator labels, line identities, external codes and amounts. It contains no real customer record, contact information, proposal, negotiation or source-document hash. Its four lines total 900.00 cost and 1200.00 price, with a 25% listed-cost margin and alternating taxable flags. The invented complete/deferred scope values are provenance only and never added to active totals. Repeated item names intentionally exercise line identity separately from display labels.

The estimate remains `draft`, with approver, approval time and lock unset. Tax rate, payment schedule, duration, cost type, commercial channel and geographic policy remain unknown. The existing policy/authorization endpoints must report their real blockers. The lab category `remodel` is a fixture classification, not a pricing decision. No source code is mapped into the internal catalog and no margin override is introduced.

The launcher reads the committed synthetic file only. It requires its reviewed SHA-256 before creating a cluster and rechecks that hash in the application child. Review any fixture edit before accepting a new hash. Do not replace it with a customer file for public demonstrations.

## Isolation and real application checks

- A fresh `/private/tmp/ed-pilot-*` cluster uses a private Unix socket, no PostgreSQL TCP listener, host authentication rejected and a verified data-directory/database/user identity before DDL or fixture writes.
- The child receives an explicit environment allowlist, an ephemeral session key, dotenv disabled and empty Vite environment/private cache directories. `TENANT_STRICT=true` uses the real application's strict-mode parser. `HOME` is not reassigned. No existing database URL or application secret is accepted.
- Fresh DDL is generated from the current Drizzle schema after removing duplicate exports of the same table object. Distinct tables and foreign-key references remain intact. This fixture DDL does not certify migration-only RLS, triggers, grants or backfills.
- Tenant, active operator profile, customer, project and estimate draft plus their provenance audit rows commit in one transaction. The real provisioner is deliberately failed on its fourth insert using a temporary private constraint; every partial row must roll back before normal provisioning. Repeated provisioning is idempotent and conflicting or partial fixtures are rejected. The application audit call is awaited separately after that transaction; this call does not use the optional transaction handle.
- The harness mounts the real router/context and verifies legacy signed-session authentication, anonymous/tampered/expired rejection, readback through a separate connection, repeated reads, blocked approval and export preflight. Supabase login is not exercised. Inactive-profile and cross-tenant HTTP coverage are not claimed by this harness.
- HTTP binds only to `127.0.0.1`; host/origin checks and a lab-specific route allowlist restrict the preview. Vite sets both `hmr:false` and `ws:false` to prevent its auxiliary listener. External font/analytics HTML is removed in memory, and a response CSP blocks remote CSS fonts. Upload routes are unavailable. These controls do not change production policy and do not instrument every attempted outbound request.

## Reviewed commands

PostgreSQL 17 executables are expected at `/usr/local/opt/postgresql@17/bin`. Run from the repository root only after inspecting the launcher and through the environment's normal approval review:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin DOTENV_CONFIG_PATH=/dev/null \
  /usr/local/bin/node --import tsx scripts/ed-pilot-lab/run.ts \
  --mode=verify \
  --selection-sha256=ba330cdb5c6676155b901a26779b268bcd4c70e64169b22db94077b9c14d9120
```

For an attended browser walkthrough, substitute `--mode=preview --minutes=10`. The one-use loopback entry URL is saved in a private ignored file referenced by that run's `ready.json`; session tokens and signing secrets are never printed or committed. Inspect the estimate list and detail, then reload the same draft and confirm identity/totals. Do not click upload/integration controls. A successful Node HTTP response is not browser evidence.

The supervisor prints its owned PIDs and evidence directory. Early termination targets only its recorded supervisor PID with SIGTERM. Both verification and preview have finite deadlines; PostgreSQL cleanup requires ownership verification. Cleanup failure remains a failed run. Stopped owned clusters and logs remain local evidence under ignored paths; they must not be committed.

The disposable child uses `explicit-after-verified-teardown`: after checks and Vite/HTTP/PostgreSQL/esbuild closers, it awaits a lifecycle record, drains output and explicitly exits while preserving failure status. This is **not spontaneous dependency shutdown**. Remaining resource types are recorded honestly. The coordinator must independently check observed child PIDs, HTTP listeners and the owned PostgreSQL PID file after exit. No production runtime uses this exit strategy.

If cluster or socket startup is denied in a worker sandbox, stop that attempt and use normal narrowly scoped review with the inspected command. Do not broaden permission modes or loop retries.

## Verification lineage and limits

The historical private precursor passed isolated PostgreSQL persistence, actual provisioner rollback, idempotency, real legacy HTTP authentication and an attended browser walkthrough. Its original artifacts and unsuccessful startup/lifecycle attempts are retained privately. They are not copied into this public candidate and do not prove execution of this new synthetic fixture. No original commercial values or source-document fingerprints are retained here.

Strict-mode correction, 2026-09-18: the original environment helper supplied `TENANT_STRICT="1"`, but `isStrictTenantMode` recognizes the string `"true"` (case-insensitive), so those earlier runs did **not** establish strict-tenant execution. A behavioral test using the real parser reproduced `false` before the fix (1 expected failure, 26 passes). The helper now supplies `"true"`; the focused unit suite passed all 27 cases. This proves the environment/parser contract only. A new physical HTTP/database/browser run is required before asserting strict-mode runtime coverage; earlier transport, rollback and authentication evidence retains its own original scope.

The public reconciliation adds a behavioral test that reads this exact committed synthetic selection, validates totals/line identities and constructs the persisted rows without internal approval. Before updating the lab helper, the new fixture produced eight expected failures and eighteen passes. The public focused run and final checks are recorded in the reconciliation report. Formatter, controlled-driver and React SSR tests do not establish physical persistence or browser behavior for changed fixtures.

```sh
node node_modules/vitest/vitest.mjs run --no-cache server/ed-pilot-lab.test.ts
node node_modules/typescript/bin/tsc -p scripts/ed-pilot-lab/tsconfig.json --pretty false --incremental false
```

The readiness maintenance separately corrects discount presentation, displays the real policy result and disables download attempts when authorization is unresolved or denied. CSV keeps its existing authorization/validation/reconciliation chain. At that predecessor snapshot PDF/JSON still lacked the server lifecycle gate; the subsequent [server authorization repair](estimate-document-export-authorization.md) closes that bounded defect in the integrated candidate.

This laboratory does not implement partial commercial acceptance, a CSV importer, a second operator/approver or full Lead-to-Export continuity. The later [field-flow repairs](field-flow-repairs-2026-09-18.md) address Intake/Review continuity; their separate browser evidence belongs to the [remediation record](readiness-remediation-2026-09-19.md), not this original laboratory proof. Tax treatment, payment terms and business classification cannot be inferred from the fixture.
