/**
 * structr.ai — PHASE 1: Progressive Content Security Policy
 *
 * Phase 0 shipped `helmet({ contentSecurityPolicy: false })`, which removed the
 * single most effective mitigation against injected scripts in an app that renders
 * client data (lead notes, scope reasons, RFI questions, PDF exports).
 *
 * Turning a strict CSP on in one step breaks SPAs (Vite injects inline scripts in
 * dev; Tailwind and PDF/canvas tooling use inline styles and blob workers). So the
 * rollout is progressive and controlled by CSP_MODE:
 *
 *   CSP_MODE=off          → no header at all (escape hatch, not recommended)
 *   CSP_MODE=report-only  → Content-Security-Policy-Report-Only (observe, don't break)
 *   CSP_MODE=enforce      → Content-Security-Policy (blocks violations)
 *
 * Default: `enforce` outside production (fail fast while building) and
 * `report-only` in production (observe real traffic before enforcing).
 * Recommended rollout: deploy report-only → watch reports for a week →
 * set CSP_MODE=enforce.
 */

import type { HelmetOptions } from "helmet";
import { ENV } from "./env";

type CspDirectives = Record<string, Array<string> | null>;

/**
 * Build the directive set for the current environment.
 *
 * Development needs to allow Vite's HMR websocket and its inline bootstrap script;
 * production does not, so the production policy is materially tighter.
 */
export function buildCspDirectives(
  opts: { isDevelopment?: boolean; reportUri?: string } = {},
): CspDirectives {
  const isDev = opts.isDevelopment ?? ENV.isDevelopment;
  const reportUri = opts.reportUri ?? ENV.cspReportUri;

  const scriptSrc = ["'self'"];
  const styleSrc = ["'self'", "'unsafe-inline'"]; // Tailwind/react inline styles
  const connectSrc = ["'self'", "https:"];

  if (isDev) {
    // Vite dev server: inline module preload + eval-based HMR + ws transport.
    scriptSrc.push("'unsafe-inline'", "'unsafe-eval'");
    connectSrc.push("ws:", "wss:", "http://localhost:*", "http://127.0.0.1:*");
  }

  const directives: CspDirectives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    scriptSrc,
    styleSrc,
    // S3/pre-signed drawing thumbnails and canvas/PDF blobs.
    imgSrc: ["'self'", "data:", "blob:", "https:"],
    fontSrc: ["'self'", "data:", "https:"],
    connectSrc,
    // PDF.js and drawing rendering use blob/data documents and workers.
    objectSrc: ["'none'"],
    frameSrc: ["'self'", "blob:"],
    frameAncestors: ["'none'"],
    workerSrc: ["'self'", "blob:"],
    formAction: ["'self'"],
    manifestSrc: ["'self'"],
  };

  if (!isDev) {
    // Force HTTPS sub-resources once TLS is terminated in front of the app.
    directives.upgradeInsecureRequests = [];
  }

  if (reportUri) {
    directives.reportUri = [reportUri];
  }

  return directives;
}

/**
 * Produce the `contentSecurityPolicy` option for helmet.
 * Returns `false` only when explicitly disabled via CSP_MODE=off.
 */
export function buildHelmetCspOption(): HelmetOptions["contentSecurityPolicy"] {
  if (ENV.cspMode === "off") {
    console.warn(
      "[CSP] CSP_MODE=off — Content-Security-Policy is disabled. " +
        "This is not a supported production configuration.",
    );
    return false;
  }

  return {
    useDefaults: false,
    reportOnly: ENV.cspMode === "report-only",
    directives: buildCspDirectives() as any,
  };
}

/** Human-readable summary for boot logs. */
export function describeCspMode(): string {
  switch (ENV.cspMode) {
    case "off":
      return "disabled";
    case "report-only":
      return "report-only (violations logged, nothing blocked)";
    default:
      return "enforced";
  }
}
