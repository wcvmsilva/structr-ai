import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import { buildHelmetCspOption, describeCspMode } from "./csp";
import { resolveSessionMaxAgeMs } from "./cookies";
import { assertProductionSecretsAreSafe, isDevBypassEnabled } from "./sdk";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // PHASE 1: refuse to boot a non-development deployment that still carries the
  // insecure dev secret, before a single request can be served.
  assertProductionSecretsAreSafe();

  const app = express();
  const server = createServer(app);

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
    }),
  );

  // Trust the reverse proxy so req.protocol/secure reflect the real TLS state.
  // Without this, Secure cookies are never set behind a load balancer.
  app.set("trust proxy", 1);
  app.use(cors({
    origin: ENV.allowedOrigins.split(',').map(s => s.trim()),
    credentials: true,
  }));
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  }));

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

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(
      `[Security] CSP: ${describeCspMode()} | session cookie: ` +
        `${Math.round(resolveSessionMaxAgeMs() / (1000 * 60 * 60 * 24))}d, ` +
        `SameSite=${ENV.sessionCookieSameSite} | dev auth bypass: ` +
        `${isDevBypassEnabled() ? "ENABLED (development only)" : "disabled"}`,
    );
  });
}

startServer().catch(console.error);
