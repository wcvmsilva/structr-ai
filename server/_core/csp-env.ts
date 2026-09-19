/**
 * Public header configuration, independent of application credential validation.
 * Reading CSP must remain safe before the hosted API enablement gate runs.
 */
export function readCspEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";
  const rawMode = (env.CSP_MODE ?? "").trim().toLowerCase();
  const cspMode: "off" | "report-only" | "enforce" =
    rawMode === "off" || rawMode === "enforce" || rawMode === "report-only"
      ? rawMode
      : isProduction ? "report-only" : "enforce";

  return {
    nodeEnv,
    isProduction,
    isDevelopment: nodeEnv === "development",
    cspMode,
    cspReportUri: env.CSP_REPORT_URI ?? "",
    // Retain the trimmed value for env.ts startup validation. Consumers remove
    // trailing slashes when exposing the origin, as in the existing ENV contract.
    supabaseUrl: (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim(),
  };
}
