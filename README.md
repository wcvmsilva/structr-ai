# structr.ai — Construction Brain

> **Current delivery — 8 October 2026:** PR #36 is merged into `main` at `a05f7c42`, with passing PR and post-merge CI; migration 0017 is installed in isolated homolog and the matching-tree preview is READY. Positive hosted business reads, organization isolation, the complete journey and recovery evidence remain pending; business writers and real-project use remain closed. See [read publication evidence](docs/engineering/adr002-minimum-reads-2026-10-08.md#checkpoint-final-de-publicação-e-homologação--8-de-outubro) and [remaining release gates](docs/engineering/homolog-access-coordination-2026-10-08.md).

> **Earlier delivery checkpoint — 8 October 2026:** PR #35 is merged with passing CI; the operator confirmed the Settings password change. The partial-read backend and completed interface are integrated locally, with 361 UI/session focal tests passing; full regression and publication remain pending. Manus financial reference V2 is accepted documentarily, with Kimi test hypotheses and Perplexity research reviewed separately. Email recovery and the complete hosted journey remain pending; real-project use remains closed. See [owners and release gates](docs/engineering/homolog-access-coordination-2026-10-08.md), [read implementation evidence](docs/engineering/adr002-minimum-reads-2026-10-08.md) and the [password acceptance record](docs/engineering/auth-recovery-2026-10-08.md#troca-de-senha-em-settings--complemento-de-8-de-outubro).

> **Earlier access recovery checkpoint — 8 October 2026:** session retry and password recovery/change are implemented with 132 new behavioral tests (172 focal passes), passing typecheck and hosted build. The exact homolog email callback is configured; publication and the operator's personal email/password acceptance are separate gates. Follow the [access recovery record](docs/engineering/auth-recovery-2026-10-08.md). Real-project use remains closed.

> **Earlier checkpoint — 8 October 2026, 18:20 UTC:** real login and the operator's `user` profile are confirmed in isolated homolog after the schema-permission correction. Cross-organization isolation and the complete project journey remain pending; business writers and real-project use remain closed. See [evidence and remaining gates](docs/engineering/homolog-session-schema-usage-2026-10-08.md#aplicação-hospedada-e-primeiro-login--1820-utc).

> **Earlier checkpoint — 8 October 2026, 17:57 UTC:** isolated homolog has one active `user` profile, one issuer configuration and four audit rows, with readbacks confirmed. Vercel authentication is complete; Structr login and positive session proof remain pending, with business writers and real-project use still closed. See the [dated evidence and remaining gates](docs/engineering/homolog-access-coordination-2026-10-08.md#checkpoint-provisionamento-administrativo-aplicado--8-de-outubro-1757-utc).

> **Earlier checkpoint — 8 October 2026, 16:13 UTC:** PR #30 is merged into `main` at `10ea3261`, with passing post-merge CI. The isolated homolog preview now starts in authenticated Data API mode; the operator's Auth account exists, while its internal profile, issuer setup and real-session acceptance are still pending. Codex owns integration and hosted changes; Munder owns the next read/write contracts, Manus acceptance documentation, and Perplexity public provider research. Follow the [current coordination and release gates](docs/engineering/homolog-access-coordination-2026-10-08.md). Real-project use is not released.

> **Authenticated review validated; homolog remains closed — 7 October 2026:** the approved [ADR-002](docs/adr/ADR-002-pilot-authenticated-database-boundary.md) session/review slice passed 6,703 default tests with zero failures and 88 distinct physical ADR-002 cases. Its exact migration is installed in isolated homolog with empty trust configuration and four denied HTTP probes. Publication and remaining real-session acceptance are recorded in [the implementation record](docs/engineering/adr002-review-access-2026-10-07.md). Application access and field release remain closed.

> **Code integration closed — 6 October 2026, 16:22:34 UTC:** [PR #26](https://github.com/wcvmsilva/structr-ai/pull/26) merged into `main` at `749dbcd6d34093c630b320d5e79a74c5eaa82019`, with the same tree as reviewed `a703ddb78b39db66f9e6f0f23eed7e3ca64a7960`. [PR CI](https://github.com/wcvmsilva/structr-ai/actions/runs/37494587635) passed on that reviewed head. The required local pre-push check passed with zero errors; its full test run passed **6,484 tests, 951 skipped, zero failed**, without bypass. [Post-merge CI](https://github.com/wcvmsilva/structr-ai/actions/runs/37495212987) also passed on `749dbcd6d34093c630b320d5e79a74c5eaa82019`. Production readiness is not claimed.

An enterprise-grade construction estimating platform built for high-accuracy deterministic scope generation, geo-overrides, profit shielding, and pipeline visualization.

## Technology Stack

- **Frontend:** React 19, Vite 7, Tailwind CSS 4, shadcn/ui
- **Backend:** Node.js 22, Express, tRPC (v11)
- **Database:** PostgreSQL (Supabase), Drizzle ORM
- **Language:** TypeScript 5.x
- **Package Manager:** pnpm 10.x

## Local Development Setup

### 1. Prerequisites

- Node.js **22.x** (LTS)
- pnpm **10.x** (`corepack enable && corepack prepare pnpm@10 --activate`)
- PostgreSQL 15+ (or a Supabase project)
- AWS Account (for S3 storage — drawings/proposals)

### 2. Environment Variables

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Required variables for the existing direct SQL mode:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase pooler recommended) |
| `JWT_SECRET` | Secret for session signing (min 32 chars in production) |
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS |

The bounded ADR-002 review mode uses `STRUCTR_DATABASE_MODE=authenticated-data-api`, `AUTH_PROVIDER=supabase`, `TENANT_STRICT=true`, an HTTPS `SUPABASE_URL` and a modern `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`). It rejects SQL credentials, service/signing secrets and legacy fallback. It permits exactly five queries: `auth.me`, `auth.session`, `estimate.getById`, `estimate.getInternalApproval` and `estimate.getInternalApprovalReview`; all other procedures, including business mutations and estimate listing, remain closed. This mode also requires the reviewed database boundary and compatible JWT lifetime configuration. Follow the [current read implementation record](docs/engineering/adr002-minimum-reads-2026-10-08.md) before attempting hosted enablement.

#### Authentication (Supabase Auth V1)

Two providers ship side by side, selected by `AUTH_PROVIDER` (default `supabase`).
See `CHANGELOG-supabase-auth.md` for the full contract and the rollback procedure.

| Variable | Required when | Description |
|----------|---------------|-------------|
| `AUTH_PROVIDER` | always (defaults to `supabase`) | `supabase` \| `legacy` |
| `SUPABASE_URL` | `AUTH_PROVIDER=supabase` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | `AUTH_PROVIDER=supabase` | Publishable (anon) key |
| `VITE_SUPABASE_URL` | `AUTH_PROVIDER=supabase` | Same project URL, for the browser client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `AUTH_PROVIDER=supabase` | Same publishable key, for the browser client |
| `VITE_AUTH_PROVIDER` | `AUTH_PROVIDER=supabase` | Must match `AUTH_PROVIDER` |
| `SUPABASE_JWT_SECRET` | optional | Only for Supabase projects still signing with HS256 |
| `SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK` | optional | Transitional: accept a legacy cookie when no bearer token is present |
| `OAUTH_SERVER_URL` | `AUTH_PROVIDER=legacy` | Manus OAuth provider URL |
| `OWNER_OPEN_ID` | `AUTH_PROVIDER=legacy` | Owner's external OAuth identifier |

Optional variables:

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `3000`) |
| `VITE_APP_ID` | Application identifier |
| `BUILT_IN_FORGE_API_URL` | External API endpoint |
| `BUILT_IN_FORGE_API_KEY` | External API key |
| `AWS_ACCESS_KEY_ID` | AWS credentials for S3 |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for S3 |
| `AWS_REGION` | AWS region for S3 bucket |
| `AWS_S3_BUCKET` | S3 bucket name for file storage |

### 3. Install Dependencies

```bash
pnpm install
```

### 4. Database Setup

The following schema/seed commands are only for an explicitly prepared disposable development database. They do not replace the versioned migrations or provision the private role required by the ADR-002 policies:

```bash
pnpm db:push
pnpm seed:all
```

> An existing database requires a verified migration and recovery plan before schema pushes or seeds. The current candidate has unresolved migration-history and field-readiness gates; see the reconciliation record. `docs/data-migration.md` is historical migration guidance, not authorization to modify an operational database.

### 5. Start Development Server

```bash
pnpm dev
```

The application will be available at `http://localhost:3000` (or the next available port if 3000 is busy).

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the unified development server |
| `pnpm build` | Create a production build (Vite + esbuild) |
| `pnpm start` | Run the production build |
| `pnpm check` | Run TypeScript type checking |
| `pnpm test` | Execute the Vitest test suite |
| `pnpm db:push` | Push Drizzle schema changes to PostgreSQL |
| `pnpm seed` | Seed the database with core configurations |
| `pnpm seed:all` | Run all seed scripts (catalog, assemblies, pricebook, pricing, RBAC) |
| `pnpm setup` | Full setup: install + db:push + seed:all |

## Pre-push Hook

`pnpm install` runs the `prepare` script which sets `core.hooksPath=.githooks`. From then on, every `git push` runs `pnpm check` + `pnpm test` before the push is sent to the remote — broken commits never reach `main`.

To bypass intentionally (docs-only push, in-progress branch):

```bash
SKIP_PRE_PUSH=1 git push
```

## Production Deployment

- Requires strict environment variable presence (app will not boot without `DATABASE_URL`).
- All public endpoints restricted via rate limiting and CORS.
- High-level engine margins governed by centralized **Profit Shield** mechanics.
- Production environment uses PostgreSQL connection pooling via Supabase pooler (port 6543).
- See `docs/runbook-production.md` for full deployment guide.

## Testing

Run the full test suite (2,200+ assertions covering scopes, geo-overrides, pipeline, auth, etc):

```bash
pnpm test
```

## Documentation

The 6 October A1 evidence below records verification on runtime source `f6a80a18`, following local merge `e2048c11` of the accepted viewport work and operational corrections. Type checking and the hosted build passed. The full regression run passed 6,448 tests with 951 skipped, including Monitoring’s correction. Disposable database runs passed 331 export cases, 11 operational reduction cases and 9 instrumented legacy calibration cases, recorded separately. The physical decision cycle passed 24 cases. The bounded synthetic browser journey completed at `f6a80a18`, including approval, delivered JSON/PDF/printable representations, refused CSV, revocation and an undecided new version; 13 readback checks passed. The JSON download wait timed out; saved JSON/PDF files were not verified. Independent cleanup confirmed the laboratory removed despite the supervisor’s exit 1 during group checks. Two P2 UI corrections passed 160 targeted tests after their RED runs and independent review. Validated source checkpoint: `6b01c2a8efb3db2ea92dbdd9d4138bdadf162629`. The final wording build passed; the required full pre-push hook and PR CI subsequently passed on `a703ddb7`, and publication/main integration are recorded in the dated closure notice above. Production readiness is not claimed. See the [closeout record and completion inventory](docs/engineering/a1-delivery-closeout-2026-10-06.md).

- [Engineering current state](docs/engineering/current-state.md) — integrated A1 delivery, evidence and remaining production gates
- [Current execution plan](plans/current-sprint.md) — October 6 A1 journey, ownership and verification handoff
- [Munder collaboration](docs/munder-difflin.md) — active closeout coordination and preserved collaboration history
- [September 18 reconciliation](docs/engineering/progress-reconciliation-2026-09-18.md) — historical candidate, provenance and release observations
- [Operational playbooks](docs/planning/PLAYBOOK-EXECUTION-ROADMAP.md) — scoped roadmap and historical delivery records; follow the current plan for active work

- `docs/runbook-local.md` — Local development setup from scratch
- `docs/runbook-production.md` — Production deployment guide
- `docs/data-migration.md` — MySQL → PostgreSQL migration reference
- `docs/history/` — Sprint reports and audit history
- `docs/planning/AGENT-CAPABILITY-ROADMAP.md` — Approved roadmap for Structr Handoff and the future frontend-quality pilot
