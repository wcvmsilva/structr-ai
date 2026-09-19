import express, { type Express } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { buildHelmetCspOption } from "./csp";

export type HostedOptions = {
  publicDirectory?: string;
  env?: NodeJS.ProcessEnv;
  loadApplication?: () => Promise<Express>;
};

/** Native Express host: CDN assets plus the existing API, never a second router. */
export function configureHostedApplication(
  app: Express,
  options: HostedOptions = {}
): void {
  const env = options.env ?? process.env;
  const publicDirectory =
    options.publicDirectory ?? resolve(process.cwd(), "public");
  const load =
    options.loadApplication ??
    (async () => (await import("./application")).createApplication());
  let application: Promise<Express> | undefined;

  app.use(
    helmet({
      contentSecurityPolicy: buildHelmetCspOption(),
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      frameguard: { action: "deny" },
    })
  );
  app.use((req, res, next) => {
    if (req.path !== "/api" && !req.path.startsWith("/api/")) return next();
    res.set("Cache-Control", "no-store");
    // The newly wired host must not accidentally activate inherited production
    // credentials in an unverified preview. Enable only after environment review.
    if (env.STRUCTR_HOSTED_API_ENABLED !== "true") {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }
    application ??= Promise.resolve().then(load);
    application.then(
      inner => {
        // Mounted without a path prefix: tRPC must receive its original URL/body.
        inner(req, res, error => {
          if (error) {
            res.status(500).json({ error: "Internal server error" });
            return;
          }
          res.status(404).json({ error: "Not found" });
        });
      },
      () => {
        // Initialization can contain connection details; never return raw errors.
        res.status(503).json({ error: "Service unavailable" });
      }
    );
  });
  // Vercel serves public/** through its CDN. This is also useful for local checks.
  app.use(express.static(publicDirectory));
  app.get("*", (req, res) => {
    if (extname(req.path)) {
      res.status(404).end();
      return;
    }
    const entry = resolve(publicDirectory, "index.html");
    if (!existsSync(entry)) {
      res.status(503).send("Service unavailable");
      return;
    }
    res.set("Cache-Control", "no-store").sendFile(entry);
  });
}
