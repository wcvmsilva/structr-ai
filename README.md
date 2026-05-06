# structr.ai — Construction Brain

An enterprise-grade construction estimating platform built for high-accuracy deterministic scope generation, geo-overrides, profit shielding, and pipeline visualization.

## Technology Stack

- **Frontend:** React 19, Vite 7, Tailwind CSS 4, shadcn/ui
- **Backend:** Node.js, Express, tRPC (v11)
- **Database:** PostgreSQL via Drizzle ORM (Supabase in production, any PG 14+ locally)
- **Language:** TypeScript 5.x

## Local Development Setup

### 1. Prerequisites
- Node.js (v20+)
- pnpm (v10+)
- PostgreSQL 14+ — Supabase project for production, local Postgres or Supabase free-tier for dev
- AWS Account (for S3 storage)

### 2. Environment Variables
Copy the example environment file and fill in your credentials:
```bash
cp .env.example .env
```

Ensure you set:
- `DATABASE_URL` — PostgreSQL connection string. For Supabase, use the pooled URL on port 6543: `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
- `JWT_SECRET` — 32+ random bytes; never reuse the dev placeholder in production
- `OAUTH_SERVER_URL`, `OWNER_OPEN_ID` — auth provider settings
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` — drawing intake / file storage
- `NODE_ENV=development`
- `ALLOWED_ORIGINS` — CORS allowlist; defaults to `http://localhost:5000` locally

### 3. Install Dependencies
```bash
pnpm install
```

### 4. Database Setup
Push the Drizzle schema to your PostgreSQL database and run the essential seed scripts:
```bash
pnpm db:push
pnpm seed
```

### 5. Start Development Server
```bash
pnpm dev
```
The application will be available at `http://localhost:5000`.

## Scripts

- `pnpm dev`: Start the unified development server
- `pnpm build`: Create a production build (Vite + esbuild)
- `pnpm start`: Run the production build
- `pnpm check`: Run TypeScript type checking
- `pnpm test`: Execute the Vitest test suite
- `pnpm db:push`: Push Drizzle schema changes to PostgreSQL
- `pnpm seed`: Seed the database with core configurations (rules, templates, zones)

## Pre-push hook

`pnpm install` runs the `prepare` script which sets `core.hooksPath=.githooks`. From then on, every `git push` runs `pnpm check` + `pnpm test` before the push is sent to the remote — broken commits never reach `main`. To bypass intentionally (docs-only push, in-progress branch), use `SKIP_PRE_PUSH=1 git push`.

## Production Constraints (Sprint 23+)
- Requires strict environment variable presence (app will not boot without `DATABASE_URL`).
- All public endpoints restricted.
- High-level engine margins governed by centralized `Profit Shield` mechanics.
- Production environment utilizes Supabase's connection pooler (port 6543) via the `postgres` driver.

## Testing
To run the full test suite (1,900+ assertions covering scopes, geo-overrides, pipeline, etc):
```bash
pnpm test
```
