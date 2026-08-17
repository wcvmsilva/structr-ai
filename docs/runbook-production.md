# Runbook: Production Deployment

This guide covers deploying Structr.ai to a production environment.

## 1. Infrastructure Requirements

- **Compute**: Node.js 22.x runtime (e.g., AWS ECS, Render, Vercel, or a VPS).
- **Database**: PostgreSQL 15+ (Supabase highly recommended for connection pooling).
- **Storage**: AWS S3 bucket for drawings and proposal PDFs.

## 2. Environment Variables

In production, strict environment variables are required. The app will fail to boot if critical variables are missing.

| Variable | Requirement | Notes |
|----------|-------------|-------|
| `NODE_ENV` | `production` | Enables optimizations and static file serving. |
| `DATABASE_URL` | Required | Must point to a connection pooler (e.g., Supabase port 6543). |
| `JWT_SECRET` | Required | Must be a strong, cryptographically secure random string (>32 chars). |
| `OAUTH_SERVER_URL` | Required | Your production OAuth provider URL. |
| `OWNER_OPEN_ID` | Required | The external ID of the system owner. |
| `ALLOWED_ORIGINS` | Required | Comma-separated list of your production domains. |
| `AWS_*` | Required | Credentials and bucket name for S3 storage. |

## 3. Build Process

The build process compiles both the Vite frontend and the Express/tRPC backend.

```bash
pnpm install --frozen-lockfile
pnpm build
```

This creates a `dist/` directory containing the bundled `index.js` and the static frontend assets.

## 4. Database Migrations

Before starting the new version of the application, apply schema changes. In production, prefer generating and running SQL migrations rather than `db:push`.

```bash
# Generate migrations locally
pnpm drizzle-kit generate

# In production CI/CD
pnpm drizzle-kit migrate
```

## 5. Starting the Server

Run the bundled server:

```bash
pnpm start
```

## 6. Security Considerations

- **CORS**: Ensure `ALLOWED_ORIGINS` strictly matches your frontend domain.
- **Rate Limiting**: The server has built-in rate limiting (200 requests / 15 min), but consider a WAF or Cloudflare in front of it.
- **Uploads**: The current server accepts large JSON payloads for file uploads. 
  > **TODO [P0]**: Migrate to presigned S3 URLs to prevent Node.js event loop blocking during large drawing uploads.

## 7. Monitoring

- Monitor the `PORT` (default 3000) for health checks.
- Watch for `[FATAL]` logs during startup indicating missing environment variables.
