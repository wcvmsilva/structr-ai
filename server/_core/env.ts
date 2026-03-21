// Validate required environment variables at startup
const REQUIRED_ENV_VARS = ['DATABASE_URL', 'JWT_SECRET', 'OAUTH_SERVER_URL', 'OWNER_OPEN_ID'] as const;
const missing = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missing.length > 0 && process.env.NODE_ENV !== 'test') {
  throw new Error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  allowedOrigins: process.env.ALLOWED_ORIGINS ?? "http://localhost:5000",
};
