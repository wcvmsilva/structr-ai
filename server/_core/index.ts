import "dotenv/config";
import { createApplication } from "./application";
import { createServer } from "http";
import net from "net";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import { describeCspMode } from "./csp";
import { resolveSessionMaxAgeMs } from "./cookies";
import { isDevBypassEnabled } from "./sdk";
import { resolveAuthProvider } from "./auth";

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
  const app = createApplication();
  const server = createServer(app);
  const authProvider = resolveAuthProvider();

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
        `${isDevBypassEnabled() ? "ENABLED (development only)" : "disabled"}`
    );
    console.log(
      `[Auth] provider: ${authProvider}` +
        (authProvider === "supabase"
          ? ` | project: ${ENV.supabaseUrl || "(unset)"}` +
            ` | verification: ${ENV.supabaseJwtSecret ? "HS256 secret" : "JWKS (asymmetric)"}` +
            ` | legacy cookie fallback: ${ENV.supabaseAllowLegacyFallback ? "ENABLED" : "disabled"}`
          : " | Manus OAuth callback mounted at /api/oauth/callback")
    );
  });
}

startServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
