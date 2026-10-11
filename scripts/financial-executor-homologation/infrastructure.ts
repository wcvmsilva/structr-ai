/** Sanitized reviewed proposal only. No provider client, environment read,
 * credential, purchase, project creation, deployment or protection mutation.
 * Exact private account/project pins are resolved in the protected package.
 */
export const CALCULATOR_EXECUTOR_INFRASTRUCTURE_PROPOSAL = Object.freeze({
  status: "proposed-not-applied",
  hostedReady: false,
  vercel: Object.freeze({
    teamId: "<vercel-team-id>",
    existingPlan: "Pro",
    existingPlanVerifiedAt: "2026-10-10T22:57:00Z",
    projectName: "structr-financial-executor-homolog",
    projectId: "<resolved-after-approved-closed-creation>",
    target: "preview",
    executorEnvironment: "homologation",
    runtime: "nodejs22.x",
    region: "iad1",
    maximumFunctionMemoryMB: 4096,
    observedProviderDefaultMemoryMB: 2048,
    cpuAndMemoryReadback: "required-before-secret-creation",
    rootDirectory: "services/financial-executor",
    framework: null,
    gitDeploymentEnabled: false,
    installCommand: "cd ../.. && pnpm install --frozen-lockfile",
    buildCommand: "cd ../.. && pnpm build:financial-executor",
    entryPoint: "services/financial-executor/api/execute.ts",
    buildOutput: "services/financial-executor/.vercel/output",
    functionRoute: "/api/execute",
    maxDurationSeconds: 35,
    credentialName: "FINANCIAL_EXECUTOR_DATABASE_URL",
    credentialCount: 1,
    publicCaSetting: "FINANCIAL_EXECUTOR_DATABASE_CA_CERT",
    publicCaDigestSetting: "FINANCIAL_EXECUTOR_EXPECTED_DB_CA_SHA256",
    credentialScope: "dedicated-executor-project-preview-only",
    productionInheritance: false,
    deploymentOrigin: "<resolved-and-pinned-after-approved-preview-deployment>",
  }),
  transport: Object.freeze({
    mode: "direct",
    host: "db.<supabase-project-ref>.supabase.co",
    port: 5432,
    database: "postgres",
    username: "structr_calculator_login_v1",
    expectedSessionUser: "structr_calculator_login_v1",
    expectedCurrentUser: "structr_calculator_login_v1",
    tls: Object.freeze({
      rejectUnauthorized: true,
      servername: "db.<supabase-project-ref>.supabase.co",
      publicCaArtifact:
        "services/financial-executor/certs/supabase-root-2021.crt",
      exactPemSha256:
        "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
      source: "https://supabase.com/docs/guides/platform/ssl-enforcement",
      serverGlobalEnforcement:
        "observed-off-no-change-proposed-client-verification-mandatory",
    }),
    ipv4: Object.freeze({
      status: "proposed-separate-approval-required",
      priceUSDPerHour: 0.0055,
      approximateUSDPerMonth: 4,
      priceSource:
        "https://supabase.com/docs/guides/platform/manage-your-usage/ipv4",
    }),
    pooler: "blocked-unproved-and-not-configured",
    authenticatedRuntimeConnectivity: "not-executed",
  }),
  limits: Object.freeze({
    connectionsPerInstance: 2,
    aggregateNormalConnections: 2,
    aggregateMechanism: "proposed-CONNECTION-LIMIT-2-for-NOSUPERUSER-login",
    localThirdConnectionProof:
      "passed-reported-by-coordinator-root-verification-required",
    hostedThirdConnectionProof: "not-executed",
    administrativeConnections: 1,
    projectedNormalConnections: 3,
    requiredOrdinaryHeadroomAfterProjection: 10,
    capacityCheck:
      "max_connections-minus-superuser_reserved_connections-minus-reserved_connections-minus-observed-normal-sessions-minus-projected-three-at-least-ten",
    capacityCheckScope:
      "pre-open-and-current-admission-abort-condition-not-reserved-capacity",
    instanceLimit: "not-enforced-by-this-candidate",
    otherServicesReserve:
      "no-capacity-reserved-require-current-headroom-and-abort-on-drift",
    connectTimeoutSeconds: 5,
    idleTimeoutSeconds: 10,
    maxLifetimeSeconds: 300,
    prepare: false,
    deadlineMs: 30000,
    statementMs: 10000,
    lockMs: 3000,
  }),
  protection: Object.freeze({
    proposedExecutorProjectDeploymentProtection: "none",
    specificConfirmationRequired: true,
    reason:
      "default-Preview-Vercel-authentication-does-not-accept-application-bearer",
    applicationAuthentication:
      "verified-fixed-human-JWT-and-protected-current-database-authority",
    existingWebProjectProtectionChange: false,
    teamDefaultProtectionChange: false,
    hostingBypassSecret: false,
    scope: "new-dedicated-executor-project-only",
    source: "https://vercel.com/docs/deployment-protection",
  }),
  incrementalCost: Object.freeze({
    newProSubscription: "not-proposed-existing-Pro-confirmed",
    ipv4: "USD-0.0055-per-billed-hour-approximately-USD-4-per-month",
    maximumWindowHours: 2,
    maximumIntentionalHttpTestCalls: 200,
    proposedWindowUsageAllowanceUSD: 5,
    estimatedIntentionalComputeAndInvocationUSD: 0.581,
    estimateAssumptions:
      "200-calls-times-35-seconds-times-two-CPU-and-four-GB-at-current-iad1-Fluid-rates",
    estimateExcludes: "build-network-and-unexpected-traffic",
    estimateIsGuarantee: false,
    hardBillingCap: false,
    stopProcedure: "manual-stop-on-unexpected-traffic-or-budget-capacity-drift",
    pricingSource: "https://vercel.com/docs/functions/usage-and-pricing",
    executorHostingAndEgress:
      "metered-USD-five-window-allowance-proposed-separate-IPv4-charge",
    advancedDeploymentProtectionAddon: "not-proposed",
    teamSpendPause:
      "not-proposed-would-affect-other-projects-and-is-not-a-Preview-cap",
    maximumCost:
      "not-guaranteed-USD-five-allowance-and-separate-IPv4-charge-require-specific-confirmation",
  }),
  hostedProofs: Object.freeze([
    "approved-IPv4-DNS-and-runtime-egress",
    "verified-TLS-chain-and-hostname",
    "true-nominal-session_user-and-current_user",
    "constant-PID-and-transaction-ID-through-commit",
    "two-connections-third-denied-and-other-services-reserve",
    "cancellation-rollback-acknowledgement-and-reconnection",
    "credential-rotation-old-session-termination-and-uncertain-COMMIT-recovery",
    "exact-Preview-environment-credential-scope-and-project-only-protection-readback",
  ]),
});
