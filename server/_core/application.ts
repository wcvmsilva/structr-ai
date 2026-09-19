import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV } from "./env";
import { buildHelmetCspOption } from "./csp";
import { assertProductionSecretsAreSafe } from "./sdk";
import { resolveAuthProvider } from "./auth";
import { assertProductionTenantIsolation } from "../tenant-scope";

/** Shared middleware and routes for the local server and native hosted entrypoint. */
export function createApplication() {
  // PHASE 1: refuse to boot a non-development deployment that still carries the
  // insecure dev secret, before a single request can be served.
  assertProductionSecretsAreSafe();
  assertProductionTenantIsolation();

  const app = express();

  // ── PHASE 1: security middleware ────────────────────────────────────
  // CSP is no longer disabled. It runs progressively (report-only → enforce)
  // via CSP_MODE; see server/_core/csp.ts for the rollout contract.
  app.use(
    helmet({
      contentSecurityPolicy: buildHelmetCspOption(),
      // The SPA loads S3 images/PDF blobs; COEP would block them.
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: ENV.isProduction
        ? { maxAge: 15552000, includeSubDomains: true, preload: false }
        : false,
    })
  );

  // Trust the reverse proxy so req.protocol/secure reflect the real TLS state.
  // Without this, Secure cookies are never set behind a load balancer.
  app.set("trust proxy", 1);
  // SUPABASE AUTH V1: the SPA now sends `Authorization: Bearer <supabase token>`.
  // Credentials stay enabled so the legacy cookie provider keeps working on rollback.
  app.use(
    cors({
      origin: ENV.allowedOrigins.split(",").map(s => s.trim()),
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    })
  );
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Body parser — increased to support drawing uploads (up to 50 MB raw ≈ 67 MB base64).
  // TODO [P0]: Migrate drawing uploads to multipart/presigned S3 upload.
  //   Current flow sends file content as base64 inside JSON body, which:
  //   1. Increases payload size by ~33% (base64 overhead)
  //   2. Blocks the event loop during large JSON parsing
  //   3. Requires this inflated body limit
  //   Target: client uploads directly to S3 via presigned URL; server receives only
  //   metadata + S3 object key. See docs/runbook-production.md for migration notes.
  app.use(express.json({ limit: "70mb" }));
  app.use(express.urlencoded({ limit: "70mb", extended: true }));

  // SUPABASE AUTH V1: the legacy Manus OAuth callback is preserved but only mounted
  // while AUTH_PROVIDER=legacy, so the Supabase deployment exposes no dead auth route.
  // Rollback = set AUTH_PROVIDER=legacy and restart; no code change required.
  const authProvider = resolveAuthProvider();
  if (authProvider === "legacy") {
    // OAuth callback under /api/oauth/callback
    registerOAuthRoutes(app);
  }
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  return app;
}
