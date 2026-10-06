# Estimate version v2 foundations

Version formation has two distinct sources. A calculated, undecided draft needs an explicit currency confirmation for copying. An internally approved or revoked A1 estimate supplies its original recorded snapshot. Neither operation may reprice the source from the current assembly catalog or inherit approval into the new draft.

This candidate provides both pure representations and unmounted transactional helpers. It does **not** replace the legacy `createVersion` endpoint, activate a version button, or make the application ready for field use. Consumer, export and operational gates remain necessary before activation.

## Closed command and content contracts

The `estimate-version-preview-command-v2` command contains `sourceKind`, `sourceDraftId` and `confirmedCurrencyCode`. `current_draft` requires explicit `USD`; `recorded_a1` requires explicit null because its currency comes from the recorded evidence. The server determines eligibility; a requested source kind is an expectation, not proof of approval.

The `estimate-version-command-v2` creation command adds `requestId`, `expectedSourceVersion`, `expectedSourceContentHash`, `name` and `reason`. Omitted name normalizes to null; a blank name is invalid. Unknown keys, malformed identifiers, incompatible source/currency pairs and missing currency confirmation are rejected. The request hash binds the normalized command to the current tenant, actor, project and client under `estimate-version-request-v2` / `create_version`. Generated identity, time and future child state do not enter that hash.

Current draft content uses `estimate-version-copy-source-v2` and currency basis `version_request_confirmation`. It shares the existing exact amount, line reconciliation, provenance and commercial-context invariants, without constructing a temporary approval or evaluating a new decision. Known below-floor amounts may be copied for correction. Unknown cost or a nonpositive final amount cannot be converted into a valid copy by manufacturing defaults.

The copy envelope also binds `copyProjection` into its content hash:

- `assemblyCount` is explicit null or an integer from 0 through 1000 equal to the selection array length.
- `directZone` is explicit null or the same normalized code as the reviewed pricing zone.

This distinguishes absent direct values from derived context. For recorded A1 snapshots, the original snapshot/hash remains intact; the new child derives count from recorded selections and zone from recorded pricing context. These are explicit new projections, not a claim to preserve the old unrepresented column nulls.

Published Core snapshot, policy and approve/revoke/legacy-version hash formats remain unchanged. Shared validators have a supported additive composition surface; the v2 engine does not inspect private Zod internals.

## New draft projection

The pure projector supplies every one of the 54 insertable estimate-draft columns, including explicit resets. It never spreads the old draft or depends on physical defaults. Identity, actor, version and one timestamp are supplied by the transaction. Tenant/project/client must match the reviewed content. Source becomes `version`, status becomes `draft`, and `supersedesId` points to the source.

Reviewed names, notes, financial values, origin links, scope association and pricing context are copied by a closed mapping. Command name can replace the reviewed bundle name; command reason becomes `changeOrderReason`. A reviewed `changeOrderOf` association is retained without creating a commercial change order. All approval/rejection stamps, lock, metadata, warnings, draftData, Profit Shield results and the child's successor pointer reset to null.

Money stays in integer cents and fixed two-decimal strings. The projector preserves the reviewed discount amount and flag, including true with zero discount. Gross profit is final price minus cost. Display margin uses that final price, rounds exact ties away from zero to two decimals, and is not clamped or used as a new policy evaluation. There is no floating-point conversion or second discount application.

Stored JSON projections are closed:

- Lines contain the ten reviewed descriptive/quantity/rate/identity fields plus exact `lineTotalCost` and `lineTotalPrice` strings. They omit review ordinals, classifications, inferred margins and extra catalog fields.
- Selections contain seven reviewed descriptive/quantity/rate fields plus exact or null extended cost/price. Missing extended amounts are not reconstructed by multiplication.
- Pricing contains exactly channel, finishLevel, region, zone, trade, coastalModifier, commercialChannel and geoRiskClass, preserving reviewed nulls.

Direct commercialChannel is populated only when the reviewed policy channel basis was the draft's direct commercialChannel column. Otherwise it remains null. JSON string/null representations have dedicated types and parameterized JSONB bindings; they are not cast to the legacy numeric DTOs. Existing consumers still require review before these values are exposed through a positive action.

## Transaction and replay order

Both helpers use the existing SERIALIZABLE transaction, locked current context, project access and full ancestry validation. Historical-reference sources or links through either parent edge are rejected before money is interpreted. A recorded source is read through the existing integrity-checked A1 evidence reader; live draft amounts do not replace recorded content.

Creation resolves an existing request after current access/context and lineage validation, but before new-copy eligibility, source-state, preview, successor and optional-reference checks. A matching replay checks the recorded request, actor, permanent child identity, source version, reciprocal link and current child ancestry. It returns the existing child without recopying edited amounts or appending another mutation audit. A conflicting request fails instead of falling through to create another child.

A new request validates the source state, content hash and optional references. Its version is the maximum project version plus one under the project lock; overflow fails. The transaction inserts the projected child, updates the source successor pointer, then awaits durable audit. Insert, pointer or audit failure rolls the complete attempt back. Serialization/deadlock retries follow the Core limit; audit failures are never retried as successful writes.

## Optional provenance links

The same helper validates `estimateId`, `bundleId` and `intakeFormId` when forming a new approval review/decision and a new version copy. Explicit null is permitted; missing or malformed identifiers are not silently converted to null. It uses the caller's transaction, fixed estimate/bundle/intake read order and shared row locks.

Estimate and intake references must belong to the current tenant/project. Bundles must belong to the current tenant; inactive bundles remain valid historical provenance. Intake form status is not approval or execution authority. If intake JSON explicitly names a nonnull client or project, it must match the current context. Catalog prices/items are never fetched to replace reviewed values. Existing approval replay, evidence reads and revocation do not depend on today's catalog availability.

## Verification boundaries

Behavioral tests cover commands, exact money/projection, old Core hash goldens, current row normalization, provenance references, both source branches and transaction/replay/audit behavior. Transactional storage fakes exercise the real orchestration and Core helpers but do not prove physical database scheduling or production permissions. No physical database, migration, real-browser workflow or production deployment is executed by this slice. Exact-commit CI and completion counts are recorded with its draft pull request.

Before positive activation, replace the existing version action with the complete reviewed contract, finish string/null consumer and export integration, and retain distinct internal approval, issuance, customer acceptance and execution authority. Reconcile migration history, verify the actual runtime principal and recovery, and validate the assembled workflow before real data.
