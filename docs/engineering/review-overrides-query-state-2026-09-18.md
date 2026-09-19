# Review geographic override query states

Date: 2026-09-18. Continuation Unit B, after independent acceptance of Unit A/A1.
Base: `fbf7e4cabf8e60ee1d46a13d9d316afee353b451`.

## Display correction

The former inline panel in [Review](../../client/src/pages/Review.tsx) discarded
query errors and project loading state. A failed project query looked like a missing
zone; a failed history/preview query could look like empty success. A missing zone
also hid loaded applied history.

The panel now lives in
[GeographicOverridePanel.tsx](../../client/src/components/review/GeographicOverridePanel.tsx).
Props, project/draft IDs, preview zone input and the existing enabled predicate are
unchanged: preview is enabled only for a nonempty zone other than `"unknown"`.
The page imports the extracted component. The display precedence is:

1. Project/history errors and enabled-preview errors show `role="alert"` with
   “Unable to load geographic override information. Please try again.” Cached data
   and active refetch do not override an error. Raw server messages never render.
2. Required queries that have not succeeded, are pending/loading, or are fetching
   show `role="status"` and “Loading geographic override information...”. An active
   refetch temporarily replaces cached success with loading. A disabled preview's
   pending/error flags do not participate in the required-query state.
3. Once project/history successfully settle, a missing/unknown zone shows
   “No zone detected for this project. Override preview is unavailable.” Any loaded
   applied-history count remains visible; current missing zone says nothing about
   previously persisted overrides.
4. Empty success requires an explicitly empty history and preview
   `hasOverrides === false`, after successful settlement. Existing populated
   details, stats, warning rows, skipped-detail filtering and history count remain.

No approval/conversion gate, retry workflow, endpoint, policy, catalog change,
dependency or unrelated page redesign was introduced. Product strings are English.

## Rendered RED and GREEN evidence

Evidence is under ignored `tmp/munder-followups/` with exact command/cwd/time/exit
metadata and raw logs. Every run uses the mission's sanitized environment:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=test CI=1 GIT_OPTIONAL_LOCKS=0
```

The original whole Review file is preserved in `unit-b-original/Review.tsx`.
`unit-b-original/extraction.json` records that the extracted panel body is identical
apart from adding its export. `unit-b-red-source/` preserves the mechanically
extracted page/component, test and config before the display correction, with hashes.

[The test](../../server/review-geographic-overrides-ui.test.ts) uses React
`createElement` and `react-dom/server` `renderToStaticMarkup`. Only tRPC query results
are mocked; the component, icons and React renderer are real. Assertions inspect
rendered HTML, rather than source text or export existence.

- `unit-b-red.log/json`: 19 behavioral assertion failures, three passing success
  controls, 22 total. Failure HTML shows the former false empty/no-zone display or
  loading spinner without accessible status/text. No import/transform failure.
- `unit-b-green.log/json`: 218 passed across five focal suites, zero failures,
  including all 22 rendered UI cases and all 196 Unit A/existing focal cases.
- UI coverage includes each error/loading/refetch source, cached-error priority,
  disabled preview, history error/loading before missing-zone display, preserved
  history without a zone, exact query IDs/enabled predicate, true empty success,
  populated swap/add/warning details/stats/history and suppression of raw errors.
- `unit-b-test-types.log/json` records the dedicated typecheck, including the new
  UI test and all changed/new Unit A tests with ES2022, `incremental:false`,
  `noEmit:true`, `exclude:[]`. Application/full-regression final evidence follows
  after the continuation's final code/test changes.

The only tracked Vitest config change is `esbuild: { jsx: "automatic" }`, required
to render TSX with this node setup. The already-authorized runner's `jsx-focal` and
`jsx-full` variants mirror it. Original root/aliases/environment/include globs and
worker counts are preserved. The previous config-file loader hang is still
unresolved; these results use `startVitest(config:false)`, not literal `pnpm test`.

Server-rendered HTML does not prove browser interactions, layout, hydration,
screen-reader behavior or live query transitions. Those remain outside this proof.
No browser/DOM dependency was installed.

## Review and preserved scope

Jim accepted Unit B source/patch without corrective findings in
`2026-09-18T15-43-09-904Z-065bd3`. Candidate B2 corrected only evidence packaging:
it excluded a generated manifest-output file captured while still empty. All twelve
source/document hashes and both patch hashes are identical to B1. Michael verified
the match; Jim explicitly bound his bounded acceptance to B2 in
`2026-09-18T15-44-08-472Z-bf1f59`. Both historical snapshots are preserved. Accepted
A source/tests and all three inherited artifacts remain unchanged;
only the authorized A document's actual review status was updated. PostgreSQL proof
remains blocked by sandbox shared-memory permissions, with no retry. Parent-policy
measurement is the subsequent Unit C; this UI correction does not resolve G2/G4
authorization, G4b-1 STOP or M00 decisions.


## Publicação reconciliada

Este registro preserva a evidência e os limites da unidade original. Caminhos de logs e missões marcados como locais não integram o repositório público; os originais e seus hashes permanecem no arquivo privado. O estado de integração posterior é registrado em [reconciliação de 18/09](progress-reconciliation-2026-09-18.md).
