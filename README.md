# structr.ai — Construction Brain

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

Required variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Supabase pooler recommended) |
| `JWT_SECRET` | Secret for session signing (min 32 chars in production) |
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS |

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

For a new disposable local development database only, the project provides these commands:

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

- [Reconciliation and release blockers](docs/engineering/progress-reconciliation-2026-09-18.md) — current candidate, provenance and remaining field-use gates
- [Engineering current state](docs/engineering/current-state.md) — consolidated status with historical boundaries
- [Munder collaboration](docs/munder-difflin.md) — completed local setup and bounded agent workflow
- [Operational playbooks](docs/planning/PLAYBOOK-EXECUTION-ROADMAP.md) — deferred next round

- `docs/runbook-local.md` — Local development setup from scratch
- `docs/runbook-production.md` — Production deployment guide
- `docs/data-migration.md` — MySQL → PostgreSQL migration reference
- `docs/history/` — Sprint reports and audit history
- `docs/planning/AGENT-CAPABILITY-ROADMAP.md` — Approved roadmap for Structr Handoff and the future frontend-quality pilot
