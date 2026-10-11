# Isolated financial executor

This is the local ADR-003 T3/T4 service package. It is not enabled in Structr's web runtime and has not been deployed. See the [implementation evidence](../../docs/engineering/calculator-executor-implementation-2026-10-10.md) and [permission manifest](../../docs/security/financial-executor/permission-manifest.json).

## Boundary

`POST /api/execute` accepts one JSON command (`calculator.context`, `.calculate`, `.create`, or `.recover`) and one verified human bearer. Commands and results are strict Zod projections. Duplicate headers/JSON keys, large or malformed bodies, unauthorized identities, and additional authority fields are rejected. Internal snapshots, bindings, receipts and audit rows are never the public response.

The service uses its own configuration and two exclusive database slots per instance. It does not import web environment variables, the web pool, tRPC context, frontend code or test fixtures. The real Drizzle transaction uses a fixed SQL principal with four nominal EXECUTE signatures. TLS certificate and hostname verification are mandatory. The PostgreSQL 17.11 contract and actual `session_user` must be proved before hosted activation; a pooler that substitutes another principal is unsuitable.

Every create runs through a substantive transactional `withAuditLog` adapter. The writer/audit/receipt commit together; replay and recovery are separate authenticated commands. A timeout or lost response may be indeterminate around COMMIT, so callers must retain the request ID and recover rather than blindly create again. The frontend integration is a subsequent task.

## Build and verification

From the repository root:

```sh
pnpm check:financial-executor
pnpm build:financial-executor
```

The generated Build Output API package is under this service's ignored `.vercel/output` directory. Its Node launcher receives the raw request stream; the bounded reader enforces the body limit and one inherited deadline. The build checks emitted dependencies and credential-shaped constants. Importing the bundle does not read configuration or start a connection. Git-triggered deployment is disabled in this service's `vercel.json`.

The repository CI verifies this package independently of the existing web build. Physical PostgreSQL tests require the explicit local laboratory flags documented in the implementation evidence; default skipped physical cases are not passing database proof.

## Configuration contract, not provisioning instructions

The loader requires all of these names and has no web/SQL/admin fallback:

| Name | Purpose |
| --- | --- |
| `FINANCIAL_EXECUTOR_ENVIRONMENT` | Explicit local, homologation or production environment. |
| `FINANCIAL_EXECUTOR_DATABASE_URL` | Dedicated credential; never copy to the web deployment or commit it. |
| `FINANCIAL_EXECUTOR_EXPECTED_DB_HOST` | Independent exact hostname pin and TLS server name. |
| `FINANCIAL_EXECUTOR_EXPECTED_DB_NAME` | Independent exact database pin. |
| `FINANCIAL_EXECUTOR_DATABASE_CA_CERT` | Exact reviewed public CA PEM; explicit trust, not a secret. |
| `FINANCIAL_EXECUTOR_EXPECTED_DB_CA_SHA256` | Independently supplied exact-byte SHA-256 of that PEM. |
| `FINANCIAL_EXECUTOR_EXPECTED_DB_PRINCIPAL` | Exactly `structr_calculator_login_v1`. |
| `FINANCIAL_EXECUTOR_SUPABASE_URL` | Trusted issuer/JWKS origin. |
| `FINANCIAL_EXECUTOR_OPERATOR_SUB` | Fixed Auth subject. |
| `FINANCIAL_EXECUTOR_ACTOR_ID` | Protected internal actor corresponding to the subject. |
| `FINANCIAL_EXECUTOR_TENANT_ID` | Protected organization. |

The public [Supabase Root 2021 CA](certs/supabase-root-2021.crt) has exact PEM SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. Obtain/review the certificate through the [official SSL guidance](https://supabase.com/docs/guides/platform/ssl-enforcement); a different certificate requires a new independently verified pin. The loader refuses missing or mismatched certificate bytes, non-CA material and substituted hostname pins; it retains ordinary TLS chain and hostname checks. The bundled public file is not an implicit configuration fallback.

These values must agree with the separately reviewed database binding. There is no checked-in `.env` or reusable test password. The current migrations create no credential, active binding or fixture. Creating a hosted credential, configuring a deployment, applying permissions or enabling the web adapter requires the user's specific confirmation of the reviewed environment package.

The two-slot bound applies per service instance. The controlled-homologation administrative candidate additionally proposes `CONNECTION LIMIT 2` for the nominal NOSUPERUSER login, plus one separate administrative connection. Normal PostgreSQL connection admission is approximate; neither bound reserves capacity or limits serverless instances. Hosted admission and third-connection refusal still require proof in the separately confirmed window. This implementation does not attest hosted token revocation, network partition recovery or field acceptance.
