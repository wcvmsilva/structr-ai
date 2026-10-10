/** Explicit executor configuration: never imports or falls back to the web environment. */
import { FINANCIAL_EXECUTOR_AUTH_PROTOCOL as AUTH, FINANCIAL_EXECUTOR_ENVIRONMENTS, FINANCIAL_EXECUTOR_ERROR_CODES, FINANCIAL_EXECUTOR_JWT_ALGORITHMS } from "../../../shared/domain/taxonomy";

type ExecutorEnvironment = (typeof FINANCIAL_EXECUTOR_ENVIRONMENTS)[number];
export interface FinancialExecutorConfig {
  readonly environment: ExecutorEnvironment;
  readonly auth: {
    readonly issuer: string;
    readonly jwksUrl: string;
    readonly audience: typeof AUTH.audience;
    readonly algorithms: readonly (typeof FINANCIAL_EXECUTOR_JWT_ALGORITHMS)[number][];
    readonly operatorSubject: string;
    readonly actorId: string;
    readonly tenantId: string;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly username: typeof AUTH.principal;
    /** Non-enumerable: pass this options object directly to postgres, without spreading it. */
    readonly password: string;
    readonly ssl: { readonly rejectUnauthorized: true; readonly servername: string };
    readonly max: 2;
    readonly connect_timeout: 5;
    readonly idle_timeout: 10;
    readonly max_lifetime: 300;
    readonly prepare: false;
  };
  readonly timeouts: { readonly totalMs: 30000; readonly lockMs: 3000; readonly statementMs: 10000 };
}
export class ExecutorConfigError extends Error {
  readonly code = FINANCIAL_EXECUTOR_ERROR_CODES[0];
  constructor() { super("Financial executor configuration rejected"); this.name = "ExecutorConfigError"; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requiredKeys = [
  "FINANCIAL_EXECUTOR_ENVIRONMENT", "FINANCIAL_EXECUTOR_DATABASE_URL",
  "FINANCIAL_EXECUTOR_EXPECTED_DB_HOST", "FINANCIAL_EXECUTOR_EXPECTED_DB_NAME", "FINANCIAL_EXECUTOR_EXPECTED_DB_PRINCIPAL",
  "FINANCIAL_EXECUTOR_SUPABASE_URL", "FINANCIAL_EXECUTOR_OPERATOR_SUB", "FINANCIAL_EXECUTOR_ACTOR_ID", "FINANCIAL_EXECUTOR_TENANT_ID",
] as const;
const forbiddenKeys = new Set(["DATABASE_URL", "DATABASE_READ_URL", "AUTH_PROVIDER", "APP_DATABASE_MODE", "JWT_SECRET", "SESSION_SECRET", "NODE_TLS_REJECT_UNAUTHORIZED"]);
function reject(): never { throw new ExecutorConfigError(); }

/** All destination/identity pins are supplied explicitly by the isolated deployment. */
export function loadFinancialExecutorConfig(env: Readonly<Record<string, string | undefined>>): FinancialExecutorConfig {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (forbiddenKeys.has(key) || /^(SUPABASE_|VITE_|PG)/.test(key) || (key.startsWith("FINANCIAL_EXECUTOR_") && !requiredKeys.some(allowed => key === allowed))) reject();
  }
  const required = (key: (typeof requiredKeys)[number]): string => {
    const value = env[key];
    if (typeof value !== "string" || value.length === 0 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) reject();
    return value;
  };
  const environment = required("FINANCIAL_EXECUTOR_ENVIRONMENT") as ExecutorEnvironment;
  if (!FINANCIAL_EXECUTOR_ENVIRONMENTS.includes(environment)) reject();
  if (env.VERCEL_ENV !== undefined) {
    const expected = env.VERCEL_ENV === "production" ? "production" : env.VERCEL_ENV === "preview" ? "homologation" : env.VERCEL_ENV === "development" ? "local" : null;
    if (environment !== expected) reject();
  }
  if (env.VERCEL_TARGET_ENV === "production" && environment !== "production") reject();

  const host = required("FINANCIAL_EXECUTOR_EXPECTED_DB_HOST");
  const database = required("FINANCIAL_EXECUTOR_EXPECTED_DB_NAME");
  const username = required("FINANCIAL_EXECUTOR_EXPECTED_DB_PRINCIPAL");
  if (username !== AUTH.principal || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes(".") || host.includes("..") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !/^[a-z][a-z0-9_]{0,62}$/.test(database)) reject();
  let connection: URL;
  let project: URL;
  try {
    connection = new URL(required("FINANCIAL_EXECUTOR_DATABASE_URL"));
    project = new URL(required("FINANCIAL_EXECUTOR_SUPABASE_URL"));
  } catch { reject(); }
  let password: string;
  let connectionUser: string;
  try { password = decodeURIComponent(connection.password); connectionUser = decodeURIComponent(connection.username); } catch { reject(); }
  const port = connection.port ? Number(connection.port) : 5432;
  if (!["postgresql:", "postgres:"].includes(connection.protocol) || connection.hostname !== host || connectionUser !== username || connection.pathname !== `/${database}` || connection.search || connection.hash || !password || /[\u0000-\u001f\u007f]/.test(password) || !Number.isInteger(port) || port < 1 || port > 65535) reject();
  if (project.protocol !== "https:" || project.username || project.password || project.port || project.pathname !== "/" || project.search || project.hash) reject();
  const operatorSubject = required("FINANCIAL_EXECUTOR_OPERATOR_SUB");
  const actorId = required("FINANCIAL_EXECUTOR_ACTOR_ID");
  const tenantId = required("FINANCIAL_EXECUTOR_TENANT_ID");
  if (![operatorSubject, actorId, tenantId].every(value => uuid.test(value))) reject();
  const issuer = `${project.origin}/auth/v1`;
  const databaseOptions = {
    host, port, database, username: AUTH.principal,
    // Node TLS performs normal certificate-chain and hostname validation; no override callback.
    ssl: Object.freeze({ rejectUnauthorized: true as const, servername: host }),
    max: 2 as const, connect_timeout: 5 as const, idle_timeout: 10 as const, max_lifetime: 300 as const, prepare: false as const,
  };
  Object.defineProperty(databaseOptions, "password", { value: password, enumerable: false, writable: false, configurable: false });
  return Object.freeze({
    environment,
    auth: Object.freeze({ issuer, jwksUrl: `${issuer}/.well-known/jwks.json`, audience: AUTH.audience, algorithms: Object.freeze([...FINANCIAL_EXECUTOR_JWT_ALGORITHMS]), operatorSubject, actorId, tenantId }),
    database: Object.freeze(databaseOptions) as FinancialExecutorConfig["database"],
    timeouts: Object.freeze({ totalMs: 30000 as const, lockMs: 3000 as const, statementMs: 10000 as const }),
  });
}
