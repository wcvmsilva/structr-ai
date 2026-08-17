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
| `OAUTH_SERVER_URL` | OAuth provider URL |
| `OWNER_OPEN_ID` | Owner's external OAuth identifier |
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS |

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

Push the Drizzle schema to your PostgreSQL/Supabase database and seed core data:

```bash
pnpm db:push
pnpm seed:all
```

> **Note:** If connecting to an existing Supabase project with data, `db:push` will reconcile the schema. See `docs/data-migration.md` for details on the MySQL → PostgreSQL migration already completed.

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

Run the full test suite (1,900+ assertions covering scopes, geo-overrides, pipeline, etc):

```bash
pnpm test
```

## Documentation

- `docs/runbook-local.md` — Local development setup from scratch
- `docs/runbook-production.md` — Production deployment guide
- `docs/data-migration.md` — MySQL → PostgreSQL migration reference
- `docs/history/` — Sprint reports and audit history
- `docs/planning/` — Ideas and roadmap
