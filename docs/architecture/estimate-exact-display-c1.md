# Exact estimate read presentation

The estimate list and detail must display the amounts actually stored in a draft without losing cents, inventing missing costs, or requiring the legacy numeric line shape. The common display adapter is a pure read boundary. It neither calculates a new estimate nor authorizes approval, export, or field work.

## Representation and unknown values

The persisted `a1VersionRequestId` / `a1VersionRequestHash` pair distinguishes the closed version-v2 projection. Both absent or both null select explicit legacy compatibility. A partial or malformed pair cannot fall back to legacy. A v2 row also requires its expected source, identity, closed line/selection/pricing shapes, and coherent current financial amounts. Invalid v2 data shows an unavailable/reconciliation state as a unit. A valid-looking discriminator is not verification of the request hash or the database's provenance.

Historical-source or historical-link dispatch keeps priority in the detail page. The display adapter cannot turn historical capture into a calculated estimate. Unavailable collections differ from known empty arrays; unknown scalar values differ from a known zero.

## Exact amounts and current margins

Money is parsed and formatted as decimal strings using integer arithmetic. Stored money supports the accepted twenty minor digits; quantities and unit rates preserve up to fourteen whole and six fractional digits. Rates retain their meaningful fractional digits even below one cent. Explicit line and selection totals are never replaced by quantity times rate.

Displayed gross profit uses the current explicit price/cost pair: final price and subtotal cost for the summary, and extended price/cost for rows. Stored gross-profit columns are not a fallback, because a later discount can leave them stale. A known zero price remains zero money; its percentage is unavailable. Negative profit remains visible. The signed difference of two legacy inputs may require twenty-one minor digits in a display-only result, without widening the persisted input contract.

Percentages round once, with exact ties away from zero. Legacy GP retains one decimal; v2 GP uses two. The discount ratio of stored amounts uses one decimal. This ratio does not reconstruct the originally requested discount percentage or evaluate any policy.

Legacy compatibility accepts complete bounded decimal/exponent strings. Finite numeric inputs are accepted only when their observed decimal value is safely distinguishable at the applicable scale. Partial text, ambiguous floating-point values, booleans, and unknowns never become zero. Unknown values are shown as `Unavailable`.

## Stored pricing context and scope limits

V2 detail displays the eight recorded pricing-context fields, schema version and scope reference, preserving nulls. It supplies no default schema version, multiplier or geography, and explicitly distinguishes stored context from verified policy, geography and approval. Existing legacy metadata remains a separate presentation path.

This slice changes read presentation only. Existing live policy and export query handling remains; legacy local printing, positive version/approval routing, aggregate precision and operational authority barriers require their separate integration gates. No new endpoint, mutation, table or migration is introduced. SSR and actual expand-callback tests verify rendering without claiming browser hydration, production permissions, physical database scheduling or real-use readiness.
