# Local ADR-002 physical laboratory

This harness uses an owned PostgreSQL 17 cluster and real PostgREST HTTP/JWT verification. It accepts no database URL, cloud host or inherited database configuration. It never obtains hosted Auth credentials. Auth rows, signer, addresses, geocoder evidence and business values are explicitly synthetic local fixtures; they do not satisfy hosted Auth/provider acceptance.

## Current evidence and limits

The first three-case physical run on October 7, 2026, at 18:12 local time produced two expected functional failures and one pass: valid ES256 tokens reached the live service and received 404/PGRST202 for both missing RPCs; a signature from another key received 401/PGRST301. The unknown-draft assertion was then corrected to expect domain NOT_FOUND after implementation. This was the functional preimplementation RED, not an infrastructure failure.

The original strict-session proposal was **not adopted**. Its assertions that Auth session deletion/expiry, session-to-user rebinding, Auth bans or Auth user deletion immediately invalidate an issued JWT are historical design alternatives, not passing or pending acceptance tests. That test branch was replaced explicitly when the reduced bounded-JWT contract was adopted. The current test demonstrates the documented distinction: Auth logout alone leaves an unexpired bounded token usable, while deactivating the protected organizational profile denies the next operation.

`auth.users` and `auth.sessions` have RLS enabled, FORCE false, a separate NOLOGIN owner and no policies. The authenticated runtime and dedicated definer have no Auth privileges. The bounded implementation was exercised with those restrictions intact.

Migrations 0000–0014 are replayed from the versioned journal, one transaction each. With boundary application explicitly enabled, the harness first attempts 0015 against this unchanged legacy replay and requires its privilege preflight to refuse and roll back. It then explicitly revokes raw PUBLIC/API-role access to establish a separate contained laboratory baseline. Five further transaction-scoped drift probes must also refuse and roll back: a column grant, a switchable reader role, a restrictive evidence policy, an unknown executable function and an unknown readable view. Only then is 0015 installed. This is **not** a claim that unmodified replay is safe or that the laboratory revocation sweep is an approved hosted containment plan.

At the first verifier checkpoint, there were seven standalone real JWT verifier controls, two optional functional RED cases, and the original strict-session contract scaffold. On October 7 at 18:23 local time, all seven standalone controls passed; the other 38 cases were explicitly skipped. That scaffold was subsequently replaced by the bounded contract described above. Log, JSON result and independent process/directory cleanup observations are in `/private/tmp/structr-adr002-verifier-evidence-luyv8N/`. Both owned servers exited and the cluster directory was removed. Two preceding setup failures were preserved in sibling evidence directories; neither was counted as a behavioral test result. The first removed an incorrect duplicate provenance check of the supervisor; the second assigned the synthetic Auth schema to its Auth owner so its FK check could run without granting runtime privileges.

On October 7 at 18:35 local time, the primary suite passed **67 tests** (seven verifier controls and 60 bounded-contract tests); two optional historical RED cases were skipped. Evidence is in `/private/tmp/structr-adr002-bounded-evidence-U37hlS/`: `standalone.log`, `results.json`, `cleanup.json` and source hashes observed after the run. PostgreSQL PID 7978 and PostgREST PID 7994 exited, and the owned cluster directory was removed. An earlier bounded run with four test setup/status expectation failures is retained in `/private/tmp/structr-adr002-bounded-evidence-SKn8KU/`; it is not reported as GREEN.

The suite was repeated at 18:38 against the final migration after the non-superuser grant-order repair: **67 passed, two optional RED cases skipped**. SHA-256 was verified before and after execution as `88fcc8c3627f7bc041f1664ad3218c9669fed8bdaf80818aa083df9286c06241`. The exact SQL copy, log, JSON results and cleanup evidence are in `/private/tmp/structr-adr002-final-http-umscxuhn/`. PostgreSQL PID 9566 and PostgREST PID 9581 exited, and `/private/tmp/structr-app-principal-pg-bIjxcQ` was removed.

Passing primary behavior includes mapped identity; A1 approval-capable membership; A2/B1 denial; exact current-engine review parity; read-only replay; nullable permissions denial; JWT original/remaining lifetime bounds; organizational revocation; private-helper/direct SQL refusal; raw-table refusal; one-connection identity reuse; and real lock conflicts. Concurrent draft, membership and profile changes produced real SQLSTATE 40001 responses, and the real Node transport retried the complete HTTP operation. The retry returned the exact new snapshot or denied revoked access. A token expiring during a real project-lock wait was rejected by the final DB clock check.

For the transport retry tests only, a test adapter translates a synthetic HTTPS destination to the owned loopback service. Bearer, body, cryptographic verification and responses remain real and unchanged. Existing A1 writer/adapter functions form fixtures and compare results; `getDb` is redirected only for those supervisor calls. The RPC is never mocked. Separate coordinator-owned suites cover migration principal lifecycle, schema/policy metadata, composite-row equivalence and frozen A1/H1 evidence; their outcomes are not claimed by this primary-suite report. Local results do not establish hosted compatibility, provider TTL configuration or pilot readiness.

## Reviewed runtime

- PostgreSQL 17.11: `/usr/local/opt/postgresql@17/bin`.
- macOS x86_64 PostgREST 16.4 official release: `https://github.com/PostgREST/postgrest/releases/download/v16.4/postgrest-v16.4-macos-x86-64.tar.xz`.
- Archive SHA-256: `9c50547cddf94ede6abf42dacc586caa18e17db4557aee386c6e45e6806aaed2`.
- Extracted binary SHA-256 enforced by the harness: `687feb850521f90bff189d1f140c33354c572b24e1e95ff586d7dd4beb245817`.
- Existing local binary: `/private/tmp/structr-adr002-postgrest-bin-BvcvxK/postgrest`.
- Only the PostgREST child receives `DYLD_LIBRARY_PATH=/usr/local/opt/postgresql@17/lib/postgresql`; no global installation is required.

The binary and its path are environment-specific prerequisites, not a portable installer. A port is allocated on loopback; the PostgreSQL listener is socket-only. A one-connection PostgREST pool supports identity reuse tests. Generated private signing material remains only in the supervisor process; the service receives a public JWK. Owned PostgreSQL cleanup verifies the nonce, data path and PID. PostgREST cleanup signals only the spawned child. Normal completion removes the owned cluster and its public-JWK configuration file.

## Running after coordinator serialization

The default suite skips these opt-in physical tests. To run standalone verifier controls, use a sanitized environment with `APP_PRINCIPAL_LAB=1`, `ADR002_PHYSICAL=1`, and the reviewed binary path:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C LC_ALL=C NODE_ENV=test \
  APP_PRINCIPAL_LAB=1 ADR002_PHYSICAL=1 \
  ADR002_POSTGREST_BIN=/private/tmp/structr-adr002-postgrest-bin-BvcvxK/postgrest \
  pnpm exec vitest run server/adr002-data-api-physical.test.ts \
  --maxWorkers=1 --minWorkers=1 --no-file-parallelism
```

For the authorized disposable bounded-contract proof, add `ADR002_APPLY_BOUNDARY=1 ADR002_BOUNDED_CONTRACT=1` to that sanitized environment. Merely placing a migration on disk does not execute it. Activation of the bounded contract without explicit application fails with an explanation.

`ADR002_RPC_RED=1` separately retains the two live missing-operation assertions; without applying 0015 they are expected to fail. Do not interpret their absence from an ordinary run as proof of the boundary. This guide authorizes no hosted changes.
