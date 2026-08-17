# Runbook: Local Development Setup

This guide covers setting up Structr.ai from scratch for local development using PostgreSQL.

## 1. Prerequisites

- **Node.js**: v22.x LTS
- **Package Manager**: pnpm 10.x
- **Database**: PostgreSQL 15+ (local or Supabase)

Enable pnpm via Corepack:
```bash
corepack enable
corepack prepare pnpm@10 --activate
```

## 2. Database Provisioning

If using Supabase (Recommended for data parity):
1. Create a new project in Supabase.
2. Go to Project Settings > Database.
3. Copy the Connection String (URI) for the Connection Pooler (port 6543).

If using local PostgreSQL:
```bash
createdb structr_ai
```

## 3. Environment Configuration

Copy the template:
```bash
cp .env.example .env
```

Update `.env` with your values:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/structr_ai
JWT_SECRET=dev-secret-key-do-not-use-in-prod
OAUTH_SERVER_URL=https://mock-oauth.local
OWNER_OPEN_ID=dev-owner-123
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:3000
```

## 4. Install and Setup

Install dependencies:
```bash
pnpm install
```

Push schema to database:
```bash
pnpm db:push
```

Seed the database with initial catalog, pricing, and RBAC rules:
```bash
pnpm seed:all
```
*(Alternatively, use `pnpm setup` which runs install, db:push, and seed:all in one step).*

## 5. Run the Application

Start the Vite development server and backend:
```bash
pnpm dev
```

Access the app at `http://localhost:3000`.

## 6. Verification

1. Ensure the frontend loads without errors.
2. Check the console for successful database connection logs.
3. Verify that `pnpm test` passes all tests in your environment.
