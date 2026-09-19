# Hosted entrypoint and build repair — 19 September 2026

## Observed failure and change

The preview for candidate `a7c17ed7` reported Ready but returned 404. The deployment log showed the correct branch/commit, a 40ms build, no install/build command and no files prepared for the cache. The project reported no framework preset. This establishes an empty deployment, not a passing application build. Project-root and command override fields did not finish loading during the browser inspection, so their final values remain unverified.

A later settings read found Root Directory set to `client`, rather than the repository root containing the package/build/server entrypoints. Build/output/install overrides were off. The native package is retained while correcting and verifying this mismatch; the [publication follow-up](preview-ci-followup-2026-09-19.md) separates the observed configuration from save/deployment evidence. The earlier `fsPath` error was reproduced in the official builder, but its remote stack was not available.

The repository declares the native Express framework, frozen dependency installation and `pnpm build:vercel`. A supported root `server.js` creates Express and loads the hosted factory from `dist/hosted.js`. The build bundles local TypeScript imports into that ESM artifact while leaving installed packages external. This replaces the earlier `server.ts` entrypoint whose extensionless emitted import failed under native Node. The existing security middleware, startup guards, OAuth selection and tRPC routes remain in `createApplication()` and are reused by both local and hosted entrypoints. The hosted entrypoint does not listen on a TCP port. No second business router or authentication bypass is introduced.

The asset preparation step copies only compiled `dist/public` frontend files into the generated root `public` directory. It rejects source/output symbolic links and an existing output directory not marked as its own generated output. The backend bundle and source files are not copied to the CDN directory. Generated assets remain ignored by Git. The CI now also builds this package after its type and test checks.

This follows Vercel's documented [native Express entrypoints and static asset handling](https://vercel.com/docs/frameworks/backend/express) and [repository build configuration](https://vercel.com/docs/project-configuration/vercel-json). In particular, Vercel serves `public/**` from its CDN and ignores `express.static()` there. Explicit CDN headers therefore supplement Express middleware: frame denial, nosniff, referrer policy and the existing default production CSP policy in report-only mode. The local static middleware exists for local rehearsal, not as a claim about CDN behavior.

## Environment activation boundary

The consolidation candidate sets `git.deploymentEnabled.main` to `false` in
`vercel.json`, using Vercel's documented
[branch deployment control](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled).
Deployment remains enabled by this setting for unspecified branches. This is a Git-trigger control;
it does not disable manual deployments, CLI/API publication, deploy hooks or
other projects linked to the repository. Confirm the project's repository root
and effective deployment paths before merging. The existing production
deployment and environment variables are not changed by this source edit.
Re-enabling production publication belongs to the later release decision.

On the resumed 19 September session, a fresh authenticated settings page showed
Root Directory empty with its Save button disabled. The corrected root was
already persisted; this task did not perform a second settings save. Framework
preset remained Other, command overrides were off, and Node was 24.x. A new
deployment must still demonstrate that the repository configuration is applied.

The native hosted business API returns generic HTTP 503 unless `STRUCTR_HOSTED_API_ENABLED` is exactly `true`. This avoids silently activating inherited database/service configuration when repairing an unverified preview. It does not affect the existing local server. When enabled, it lazily loads the same application and retains its strict-tenant and production-secret startup checks. Unknown API routes stay 404 rather than receiving SPA HTML. Initialization failures are generic 503; unexpected downstream errors are generic 500 without internal connection details.

The switch is **not complete frontend/network isolation**: a browser build with Supabase variables can contact that configured authentication project independently. Verify browser/server authentication destinations and all build/runtime environments before any real login or records. No live variable, credential, grant, migration or production alias was changed for this repair. Do not activate the switch until a reviewed isolated environment is available.

Header configuration is read independently from application credential validation.
The shared CSP reader preserves the existing policy defaults, mode normalization
and Supabase origin precedence. Importing the hosted page no longer initializes
`ENV` through CSP; loading the enabled business application still runs all existing
credential, production-secret and tenant-isolation checks.

## Evidence and limits

- Asset TDD: six failing behavior cases before implementation, then six passing. Checks include nested frontend output, stale generated asset replacement, preservation of an unowned folder, missing HTML and symlink refusal.
- Hosted HTTP TDD: initial scaffold had eleven failures and two passes; implementation passed thirteen cases. Two additional error-sanitization cases failed before their correction. Final focused results are recorded in the integrated verification report.
- A restricted-environment attempt could not bind the loopback HTTP listener (EPERM); the authorized local-only rerun passed. This restriction is not treated as an application success or regression.
- Four CDN configuration tests passed after a failing-first run. They verify the declared policy for the root, index, deep route and asset; they do not prove remotely served headers.
- The local hosted asset build and application TypeScript check passed. The HTTP application used synthetic handlers and no existing database. Its method/body/query and denial assertions do not replace production authentication or provider packaging tests.
- The native packaging regression reproduced the deployed `ERR_MODULE_NOT_FOUND` before the repair. Four new cases execute the generated ESM artifact in a separate production-mode Node process: root/deep HTML, closed API, missing configuration and a fully configured synthetic application rejecting an anonymous request with 401. Outbound connections are prohibited by the harness. The final focused packaging/hosting/assets group passed 26 cases. These checks use a synthetic HTML file and installed dependencies; provider tracing and CDN behavior remain separate remote acceptance conditions.
- Twenty CSP/environment cases verify that headers can load without backend credentials while application credential validation remains enforced. The focused CSP/environment/header group passed 44 cases after the expected failing-first run.

The next preview must demonstrate a real dependency/build step, a root page and deep route, CDN asset retrieval and security headers, and closed API behavior. The deep-route HTML fallback must also be checked after the provider traces the function bundle. The platform's request/body limits and shared rate-limiting behavior require review before field uploads; the local 70MB parser setting does not increase a provider limit. External PDF/JSON storage remains a separate unverified dependency. No field-readiness or completed deployment is claimed by local tests.
