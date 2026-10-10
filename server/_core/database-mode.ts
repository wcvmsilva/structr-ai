/** Pure runtime configuration readers. Importing this module does not boot the application. */
import { APP_DATABASE_MODES } from "../../shared/domain/taxonomy";

export function readDatabaseMode(env: NodeJS.ProcessEnv = process.env): (typeof APP_DATABASE_MODES)[number] {
  const mode = env.STRUCTR_DATABASE_MODE ?? "direct";
  if (!(APP_DATABASE_MODES as readonly string[]).includes(mode)) {
    throw new Error("[FATAL] Unsupported database mode");
  }
  return mode as (typeof APP_DATABASE_MODES)[number];
}

export function isAuthenticatedDataApiMode(): boolean {
  return readDatabaseMode() === "authenticated-data-api";
}

/**
 * IF-1 runtime gate for the named authenticated intake formation.
 *
 * Closed in every other configuration: the authenticated boundary must be the
 * active mode and the flag must be exactly "true". Any other value, any other
 * mode and the absence of either keep the formation unavailable, so direct mode
 * is never affected. This reader is an admission switch only — it grants no
 * authority, and SQL remains the final RBAC authority for the operation.
 */
export function isIntakeFormationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRUCTR_DATABASE_MODE === "authenticated-data-api" &&
    env.STRUCTR_INTAKE_FORMATION_ENABLED === "true";
}

/** SWR-1 admission only; identity and project authority are rechecked by the RPC. */
export function isScopeWorkspaceReadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRUCTR_DATABASE_MODE === "authenticated-data-api" &&
    env.STRUCTR_SCOPE_WORKSPACE_READ_ENABLED === "true";
}

/** ADR-003 admission only; the executor separately revalidates financial authority. */
export function isFinancialCalculatorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRUCTR_DATABASE_MODE === "authenticated-data-api" &&
    env.STRUCTR_FINANCIAL_CALCULATOR_ENABLED === "true";
}

/** The web may send bearer only to this deployment-owned HTTPS origin and fixed path. */
export function getFinancialCalculatorWebConfig(env: NodeJS.ProcessEnv = process.env) {
  const fail = (): never => { throw new Error("[FATAL] Invalid financial calculator web configuration"); };
  if (!isFinancialCalculatorEnabled(env)) fail();
  const raw = env.STRUCTR_FINANCIAL_EXECUTOR_ORIGIN ?? "";
  let url: URL;
  try { url = new URL(raw); } catch { return fail(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || raw.trim() !== raw || /[\u0000-\u0020\u007f]/.test(raw) ||
      (raw !== url.origin && raw !== `${url.origin}/`)) fail();
  return { origin: url.origin };
}

/** Fail closed in every environment; this mode must never carry a SQL or signing credential. */
export function getAuthenticatedDataApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const fail = (): never => { throw new Error("[FATAL] Invalid authenticated data API runtime configuration"); };
  if (readDatabaseMode(env) !== "authenticated-data-api") fail();
  for (const [name, value] of Object.entries(env)) {
    if (value && (/^(FINANCIAL_EXECUTOR_DATABASE_URL|DATABASE_URL|DIRECT_URL|POSTGRES(?:QL)?(?:_.*)?|PGHOST(?:ADDR)?|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSERVICE|PGSERVICEFILE|PGPASSFILE|PGRST_DB_URI|PGRST_JWT_SECRET|JWT_SECRET|(?:VITE_)?SUPABASE_(?:JWT_SECRET|SERVICE_ROLE_KEY|SECRET_KEY|DB_PASSWORD))$/.test(name))) fail();
  }
  if (env.AUTH_PROVIDER !== "supabase" || env.TENANT_STRICT !== "true" ||
      ![undefined, "false"].includes(env.SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK)) fail();
  const rawUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "";
  let url: URL;
  try { url = new URL(rawUrl); } catch { return fail(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || rawUrl.trim() !== rawUrl) fail();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) fail();
  return { origin: url.origin, publishableKey };
}
