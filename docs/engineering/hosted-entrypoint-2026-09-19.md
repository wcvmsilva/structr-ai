# Hosted entrypoint and build repair — 19 September 2026

## Observed failure and change

The preview for candidate `a7c17ed7` reported Ready but returned 404. The deployment log showed the correct branch/commit, a 40ms build, no install/build command and no files prepared for the cache. The project reported no framework preset. This establishes an empty deployment, not a passing application build. Project-root and command override fields did not finish loading during the browser inspection, so their final values remain unverified.

The repository now declares the native Express framework, frozen dependency installation and `pnpm build:vercel`. A supported root `server.ts` exports the Express application. The existing security middleware, startup guards, OAuth selection and tRPC routes are extracted into `createApplication()` and reused by both local and hosted entrypoints. The hosted entrypoint does not listen on a TCP port. No second business router or authentication bypass is introduced.

The asset preparation step copies only compiled `dist/public` frontend files into the generated root `public` directory. It rejects source/output symbolic links and an existing output directory not marked as its own generated output. The backend bundle and source files are not copied to the CDN directory. Generated assets remain ignored by Git. The CI now also builds this package after its type and test checks.

This follows Vercel's documented [native Express entrypoints and static asset handling](https://vercel.com/docs/frameworks/backend/express) and [repository build configuration](https://vercel.com/docs/project-configuration/vercel-json). In particular, Vercel serves `public/**` from its CDN and ignores `express.static()` there. Explicit CDN headers therefore supplement Express middleware: frame denial, nosniff, referrer policy and the existing default production CSP policy in report-only mode. The local static middleware exists for local rehearsal, not as a claim about CDN behavior.

## Environment activation boundary

The native hosted business API returns generic HTTP 503 unless `STRUCTR_HOSTED_API_ENABLED` is exactly `true`. This avoids silently activating inherited database/service configuration when repairing an unverified preview. It does not affect the existing local server. When enabled, it lazily loads the same application and retains its strict-tenant and production-secret startup checks. Unknown API routes stay 404 rather than receiving SPA HTML. Initialization failures are generic 503; unexpected downstream errors are generic 500 without internal connection details.

The switch is **not complete frontend/network isolation**: a browser build with Supabase variables can contact that configured authentication project independently. Verify browser/server authentication destinations and all build/runtime environments before any real login or records. No live variable, credential, grant, migration or production alias was changed for this repair. Do not activate the switch until a reviewed isolated environment is available.

## Evidence and limits

- Asset TDD: six failing behavior cases before implementation, then six passing. Checks include nested frontend output, stale generated asset replacement, preservation of an unowned folder, missing HTML and symlink refusal.
- Hosted HTTP TDD: initial scaffold had eleven failures and two passes; implementation passed thirteen cases. Two additional error-sanitization cases failed before their correction. Final focused results are recorded in the integrated verification report.
- A restricted-environment attempt could not bind the loopback HTTP listener (EPERM); the authorized local-only rerun passed. This restriction is not treated as an application success or regression.
- Four CDN configuration tests passed after a failing-first run. They verify the declared policy for the root, index, deep route and asset; they do not prove remotely served headers.
- The local hosted asset build and application TypeScript check passed. The HTTP application used synthetic handlers and no existing database. Its method/body/query and denial assertions do not replace production authentication or provider packaging tests.

The next preview must demonstrate a real dependency/build step, a root page and deep route, CDN asset retrieval and security headers, and closed API behavior. The deep-route HTML fallback must also be checked after the provider traces the function bundle. The platform's request/body limits and shared rate-limiting behavior require review before field uploads; the local 70MB parser setting does not increase a provider limit. External PDF/JSON storage remains a separate unverified dependency. No field-readiness or completed deployment is claimed by local tests.
