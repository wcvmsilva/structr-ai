# Preview and clean-checkout follow-up — 19 September 2026

## Published baseline and observed failures

The locally verified candidate `57f63042924d71d60304ebaa04a47a0fe6b2e170`
was published to draft PR #14. Its [GitHub CI run](https://github.com/wcvmsilva/structr-ai/actions/runs/35419658362)
passed type checking but failed five catalog CLI fixture cases: a clean checkout
does not contain the ignored `tmp/` parent. The other 3,763 default cases passed;
367 were skipped. The hosted build step was consequently not reached. Local
verification recorded for that candidate must not be described as remote CI success.

The corresponding Vercel deployment `dpl_J6LYfYJFPNDHpTYZExfzVmGMczYL`
failed during its build step with `Cannot read properties of undefined (reading
'fsPath')`. Inspection of the official CLI 59.23.2 dependencies reproduced the
same error before the application build when the native Express builder's initial
`package.json` entry is absent from its downloaded-file map. The remote stack,
file map and project root setting were unavailable; this establishes a reproducible
mechanism, **not the exact cause of the remote failure**. No account credentials
were extracted to obtain the missing metadata.

## Bounded corrections

Commit `a2820fb7` contains the two tested code/fixture corrections below.

- Catalog CLI tests create their ignored temporary parent before creating a fixture.
  A separate clean fixture reproduced five failures before this correction and
  passed all 60 catalog readiness cases afterward. The isolated fixture was removed.
- The hosted application closes a partially written response when its downstream
  application reports an error. It cannot attempt a second JSON response after
  headers have been sent. The new HTTP case failed with the previous implementation
  and passed after the correction; the hosted group now has 16 cases.
- A subsequent successful read of the hosting settings found **Root Directory =
  `client`**, while the application's package/build/server entrypoints are at the
  repository root. The build/output/install overrides were off, outside-root build
  files were enabled, the project preset was Other and Node was 24.x. This is a
  concrete configuration mismatch. The native Express package is retained while
  correcting and verifying that directory; an alternative Vite/Node package was
  prepared but is not included in this candidate. See the
  [hosting contract](hosted-entrypoint-2026-09-19.md) for its remote acceptance
  conditions. A settings read does not by itself prove a successful settings save
  or deployment.

The API remains closed unless the explicit hosting flag equals `true`. This flag
does not contain the browser's independently configured authentication service.
No production environment variable, database grant, role, ownership classification,
migration ledger, real record or backup was changed by these corrections.

## Integration and release boundary

The playbook documentation was independently reviewed as a five-Markdown-file
change based on the published candidate. Its consolidation does not close the
environment, migration, authorization, ownership or recovery gates. The earlier
PostgreSQL laboratory results remain scoped to the unchanged database source and
owned temporary clusters; a hosting-only follow-up does not convert them into
production evidence.

GitHub pull-request CI checks the platform's synthetic merge checkout by default.
Results should identify the associated candidate head and run, without claiming
the checkout is literally that head tree. The local checks identify the source
tested separately.

A successful upload or a Vercel `READY` state is insufficient for real use. The
preview must return the application at its root and internal routes, correct assets
and response headers, and the expected closed API response. Environment and
authentication review, verified API routing with query/body, external document
storage, migration reconciliation and a representative recovery exercise remain
release gates. A read-only deployment lookup confirms that main commit `8fa14da3`
produced deployment `dpl_Hwp7P2kvQXNW1Q4HWhXZBDUAciae` with `source=git` and
`target=production`. Merging into main therefore cannot be treated as preview-only
publication. The final intended root setting/save, resulting deployment, complete
environment configuration and other deployment paths remain unverified; no
production automation setting or main branch was changed.

## Local verification of the corrected candidate

- Nonincremental TypeScript and `pnpm build:vercel`: passed.
- Full default suite: **3,769 passed, 367 skipped, zero failures**. An earlier run
  had one 5-second timeout in a legacy router-import case while compilation also
  ran. The full suite passed on repetition without concurrent compilation; no
  timeout or assertion was relaxed, and the failed run is retained.
- **160 new behavioral cases** since `a7c17ed7` (the preceding 159 plus the partial
  response case). The prepared but unshipped Vite routing tests are excluded.
- The earlier **288 passing owned-PostgreSQL cases** apply to unchanged database
  source. They overlap the default skipped set; 79 normally skipped cases remain
  unexercised. They were not relabeled as a new production database run.
- New tables, business endpoints and live migrations: **zero**. Existing global
  authorization/audit gaps remain open; this is not a whole-system completion.

The [local verification manifest](preview-followup-verification-2026-09-19.json)
identifies the tested source commit, file hashes, commands and both full-suite
attempts. The mandatory pre-push checks and remote PR checks are additional,
separate evidence. A local pass does not establish the pending preview result.

The first pre-push attempt for `1955d6f3` was correctly stopped by a separate
5-second timeout in a legacy authentication import case. Nothing was pushed by
that attempt. This later failure is retained alongside the earlier passing run;
the runner was then limited to at most two workers (`maxWorkers: 2`,
`minWorkers: 1`). No assertion, timeout, retry or skip was relaxed. A fresh
`vitest run --no-cache` passed **3,769 cases, 367 skipped, zero failures** across
110 passing and 11 skipped files. The manifest records this separately against
base commit `1955d6f3` plus the configuration hash, preserving the earlier
`96a2c826` verification. Publication and remote checks still require their own
observed results.

## Resumed publication and native runtime failure

Candidate `7f7a180d403663e929392583e4499852b6b9ac02` was published after the mandatory
pre-push type check and full suite passed (3,769 passed, 367 skipped). Its
[GitHub CI run](https://github.com/wcvmsilva/structr-ai/actions/runs/35464707617)
also passed type checking, tests and the hosted package build. A fresh Vercel
settings read showed the Root Directory already empty and saved.

The [preview deployment](https://vercel.com/wcvmsilvas-projects/structr-ai/7CmLbsqxEB5JyNBipsnWaZuaR8R8)
compiled in approximately 1 minute 45 seconds and reported READY, but GET `/`
returned HTTP 500 `FUNCTION_INVOCATION_FAILED`. Runtime logs identified
`ERR_MODULE_NOT_FOUND` for the extensionless hosted-app import from emitted
`server.js`. This closes the earlier empty-build/root-directory failure only;
the preview did not pass runtime acceptance.

The next repair uses a small native JavaScript entrypoint and an ESM bundle of
the existing hosted factory. Its CSP dependency is separated from credential
validation so the closed API can serve the page without initializing backend
configuration. The application validation itself is retained. The
[hosting contract](hosted-entrypoint-2026-09-19.md) describes the final structure;
the replacement candidate must receive its own checks and remote acceptance.

The repair source at `7dcc2064bea15a6fc9dd765cbfc6da585f69f61b` passed a
nonincremental type check, `pnpm build:vercel` and the full default suite:
**3,793 passed, 367 skipped, zero failures**, across 112 passing and 11 skipped
files. Its 24 new behavioral cases cover independent CSP configuration and
native ESM packaging, bringing the recorded increment since `a7c17ed7` to 184.
The [manifest](preview-followup-verification-2026-09-19.json) preserves hashes and
timestamps for these checks separately from the earlier candidates. A second
review found no blocker in the packaging change. Provider dependency tracing,
public-file inclusion and remote behavior remain subject to the new preview.

## Native server accepted; browser bundle regression

Published candidate `872b3c396972b23271ca6bd32c080bbf6c88ac38` passed its mandatory
pre-push checks (3,793 passed, 367 skipped),
[GitHub CI](https://github.com/wcvmsilva/structr-ai/actions/runs/35465725979) and the
[Vercel build](https://vercel.com/wcvmsilvas-projects/structr-ai/5x2CEWncqG6XkP4K8N2ttj4CmPrS).
GET-only checks against that exact preview returned root/deep HTML 200, compiled
JavaScript 200, missing JavaScript 404 and closed API 503 with generic JSON and
`Cache-Control: no-store`. Root and deep HTML matched; frame denial, nosniff,
referrer policy and report-only CSP were present. Temporary provider access was
used only for verification; no access token or cookie is included in this evidence.

Browser acceptance still failed: React's `forwardRef` was undefined while the
`ui-primitives` bundle initialized, leaving the page blank. This is distinct from
the now-resolved native server module failure. A successful HTTP response does
not establish a functioning interface; the candidate remains unmerged pending
the frontend bundle repair and new browser acceptance.

The failing regression test builds the real frontend graph with the repository's
Vite configuration and an additional React/Radix rendering entry. Executing that
compiled entry reproduced the same `ui-primitives-O_bGi4Yv.js` error and offsets
as the deployed browser. Removing `manualChunks` lets Rollup order shared
dependencies without the React/UI/CommonJS-helper initialization cycle. The same
test then passed; its expectations were unchanged. Existing page imports remain
lazy. An independent review found no blocker.

Repair source `91d87a948ae5ade4d004925a43982d59607ab892` passed nonincremental
TypeScript and `pnpm build:vercel`. The build reports a 973.38 kB initial JavaScript
chunk (274.93 kB gzip), exceeding the existing 600 kB warning threshold; that
warning remains visible. Chunk/cache distribution changed and browser performance
has not been benchmarked. The regression probe uses Node/static rendering and
does not replace acceptance of the real page in the replacement deployment.
This source still needs its mandatory full-suite publication checks and remote
verification; no consolidation or real-data release is claimed here.
