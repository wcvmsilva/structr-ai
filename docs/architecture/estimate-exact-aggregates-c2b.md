# Exact estimate aggregates (C2-B)

The existing `estimate.stats` and `analytics.getPipeline` reads move to versioned, discriminated DTOs. Monetary values and ratios are decimal strings; no legacy numeric aliases remain. Counts are safe integers. This is a deliberate response migration; independent clients must branch on the version/state and invalidate cached legacy responses. No current repository React page consumes these endpoints; the separate deal-based `pipeline.getOverview` is unchanged.

## Population and precision

Statistics retain all nonhistorical records for counts, including archived and superseded versions. Only raw `draft` rows contribute to draft financials. Current unsuperseded, non-change-order estimates in `draft`, `sent`, `under_review` or `negotiation` form the opportunity monetary population. Other states, including internal approval and revocation, are counted separately and confer no revenue authority. Historical source **or** durable import linkage excludes a row from both monetary populations and increments an explicit historical count.

Rows pass through the complete C1 projection, including both v2 markers; amounts are not reparsed without their context. Invalid v2 records still contribute their stored population facts, while dependent financial components are unavailable. A missing final price is never replaced by subtotal or zero. Valid v2 region/commercial channel come from the validated pricing snapshot. Null groups remain explicit.

`mean_displayed_current_gp_2dp` is the unweighted mean of each draft's **current** GP. Each price/cost ratio rounds HALF-AWAY-FROM-ZERO to two places, then the mean rounds the same way to two places. It is neither stored GP nor a portfolio ratio. Missing cost or nonpositive final price makes the affected ratio unavailable, with complete coverage.

Opportunity weights retain the existing stage policy as exact rational numbers, applied per item. HALF-AWAY-FROM-ZERO deliberately differs from `Math.round` at negative half-cent ties. Unknown weights do not default to 10%; only dependent weighted components become unavailable. Leads represent volume and never receive invented prices. A complete empty monetary population has known `0.00`; an empty ratio is undefined.

Every financial component reports population/known/unknown counts. Any unknown member prevents a partial sum from appearing complete. Aggregate sums use a separate signed, fixed-two string domain of at most 36 minor-unit digits (34 whole digits), with a dedicated formatter. BigInt stays internal; `USD_display_only` is presentation convention, not confirmation of contractual currency or exchange conversion.

## Complete read policy

Each stats/pipeline response uses one read-only REPEATABLE READ transaction. Every page includes strict tenant equality, independent of the old null-tenant compatibility flag. UUID ascending keyset pagination uses up to 500 rows per page, without offset or a semantic 2,000-row cap.

The response resource budget is 100,000 returned records combined across all estimates (including historical/outside-population records) and eligible leads. Reads beyond that budget return `INCOMPLETE_SCAN` without partial counts or totals. Exactly 100,000 records require empty end probes for every remaining scan. Missing DB returns `DB_UNAVAILABLE`; unsafe count arithmetic returns `COUNT_OVERFLOW`. Unexpected driver/programming errors remain sanitized internal failures, not empty success. No new retry/timeout policy is introduced.

The dashboard is explicitly `independent_components`: its pipeline component owns a complete snapshot; other existing factual components retain their own read contracts. This does not claim a global dashboard transaction or physical isolation proof.

## Dependent callers and authority

`analytics.getForecast` returns `EXECUTION_AUTHORITY_NOT_AVAILABLE` before reading old budgets or reconstructing equal-value items from stage averages. The live dashboard composes the exact pipeline and unavailable forecast, with an explicit unavailable headline and independent facts retained. Existing pure numeric analytics utilities remain for their documented tests/other consumers; live exact reads do not adapt back into them.

New `pipeline` and `revenue_forecast` snapshot writes are held at both existing route and direct persistence helper before calculation, payload inspection, connection access or effects. This is a refusal before admission, not a partial governed attempt/audit protocol. Previously saved snapshots retain their old payloads; no rewrite or retroactive claim of exactness occurs. Other snapshot types and profit-health/field/calibration operational authority are outside this bounded change and are not certified by it.

No new domain, table, migration, page, endpoint, commercial acceptance or field authorization is introduced. Existing protected procedures stay in place. Positive approval, governed export, C3 version routing, remaining operational barriers, integrated screen flow and destination/principal/migration/recovery evidence remain separate release gates.
