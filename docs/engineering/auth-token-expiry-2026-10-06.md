# Supabase token expiry — bounded repair

Observed 6 October 2026, 20:41 UTC. Repository: https://github.com/wcvmsilva/structr-ai.
Compared base: `264443a65b3d4efaae3364c7f363ff3d1195895e`.
Runtime and test source: `23620a0f8dff16ff8cd7e19917feab64039cfd03`.

## Problem and resulting behavior

`jose.jwtVerify` checked expiration when supplied but did not require it. A correctly signed token with the expected issuer/audience and subject could omit `exp` and still pass the Structr verifier. Both HS256 and JWKS verification now require `exp`. Valid tokens retain their existing identity representation; the separate claim-shaping helper and legacy authentication behavior are unchanged.

This is a bounded security repair, not completion of a domain or sprint. It does not implement the Auth → transaction → tenant contract or authorize hosted access. No new endpoint, engine, DB helper, table, migration or business mutation was introduced. F1/F2/F5 surfaces are unchanged; the new tests verify behavior (F3). No canonical registry classification or aggregate is changed: focal cryptographic verification is not operational validation of P-01 or the wider foundation.

## Capability impact

| Capability | Impact | Source and consumer | Acceptance / evidence |
| --- | --- | --- | --- |
| P-01 — Identity and authentication | Direct | `server/_core/auth/supabase-jwt.ts`; `authenticateSupabaseRequest` in `supabase-auth.ts` consumes the result | Correctly signed tokens with missing, malformed or expired `exp` are refused for HS256, ES256 and RS256; valid tokens preserved |
| P-02 — Authorization and RBAC | Indirect input boundary | Invalid tokens return no identity before protected profile/RBAC mapping | Existing Supabase authentication/isolation regressions included in the 94 focal cases; authorization implementation unchanged |
| P-03 — Tenancy and tenant scoping | Indirect input boundary | Same downstream profile mapping and tenant resolution | No tenant authority added; no live positive tenant-isolation claim |
| P-06 — Data access layer | Proposal only | ADR-002 addresses a future authenticated entry boundary; no SQL/DB runtime changed | Human architecture decision and physical evidence remain pending |

Business calculations, historical records, approval/export, schema and cloud configuration are excluded from the code-change scope because the actual runtime diff only adds required expiry to the two existing verifier calls. Their historical readiness classifications are not re-evaluated here.

## Executed checks and independent review

- RED before the production edit: 3 expected failures (missing `exp`, HS256/ES256/RS256) and 30 passes.
- GREEN after the edit: 94 passes, zero failures — 33 new expiry cases, 37 existing Supabase Auth cases and 24 existing isolation cases.
- Real local cryptographic keys and real `jose` verification are used. The JWKS HTTP transport and clock are controlled; no real account, token, secret or cloud write is involved.
- New cases cover absent expiration, future/past/exact expiration, valid-to-expired transition, string/null values and preservation of signature, issuer, audience and `nbf` rejection.
- Independent code review: `pilot_fixture_pack`, completed before the 20:41 UTC commit, PASS with no actionable finding; reviewed implementation, installed verifier, tests and RED/GREEN logs. Root inspected the same source and logs. Full resulting-commit review and publication are recorded separately in the PR.
- `git diff --check` passed before the runtime/test commit.
- Required full typecheck, full regression suite, CI and publication: pending at this document's preparation. The resulting PR records their later observations. Ignored physical suites must not be reported as executed.

Local RED/GREEN logs remain in the private ignored `tmp/auth-foundation-20261006` directory; they contain synthetic-token refusals and are not a hosted acceptance report.

## Architecture boundary remains unresolved

The [proposed ADR-002](../adr/ADR-002-pilot-authenticated-database-boundary.md) records the observed crypto capability gap and alternatives. It does not amend G4b until a human decision and explicit contract reconciliation. Its independent review by `manus_financial_review` found no blocker to presenting it as Proposed; root incorporated clarifications covering direct RPC access, POST/VOLATILE/serializable retries and membership versus Auth-session revocation.

The separate [pilot readiness record](pilot-readiness-2026-10-06.md) remains closed for application use. No current-sprint completion, tenant-isolation pass, physical RLS validation, hosted journey or production-readiness claim follows from this repair.
