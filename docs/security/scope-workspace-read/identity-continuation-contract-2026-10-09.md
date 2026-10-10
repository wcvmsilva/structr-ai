# Nominal identity continuation for the SWR-1 proof

This administrative helper continues exactly one closed
`structr-homolog-identity-cycle-v1` predecessor and preserves exactly two prior
IF-1 formations. It does not change the v1 parser, receipts, executor or original
population rules. It grants no database privilege and performs no Auth operation,
deployment or business mutation. Hosted execution remains a separate reviewed step.

The strict `structr-homolog-identity-continuation-v1` manifest contains:

- Fixed homolog project reference, the new source commit and two fresh operation UUIDs.
- The exact original `priorReadProof`, also equal to the predecessor's nested value.
- `predecessor`: the entire v1 manifest plus `manifestHash`,
  `reactivationReceiptHash`, `withdrawalReceiptHash` and `withdrawnStateHash`.
- `auditHistory`: the complete baseline audit count and hash (42 in this hosted
  proof), including unrelated historical audits. Current continuation events are
  the only permitted additions.
- Exactly two `formations`, each containing `clientId`, `projectId`,
  `intakeFormId`, their three complete physical row hashes, and exactly three
  `{id, hash}` audit references. All new IDs are disjoint from historical identities,
  subjects, fixtures, predecessor operations and the other formation/audit IDs.

Hashes are SHA-256 of UTF-8 JSON with recursively sorted object keys. Array order
is preserved; row arrays are ordered by audit UUID. Physical rows use every
Drizzle property in camelCase and UTC timestamps with six fractional digits.
Receipt hashes cover the complete `newValues` object. The withdrawn-state hash
covers the exact five-row `state` from the verified predecessor withdrawal.
IF-1 audit `newValues` are checked separately against the independent legacy
projection: UTC milliseconds and the numeric strings specified by 0018. The
three physical creation timestamps, their update timestamps and the three audit
timestamps must match exactly. Physical and wire hashes are not interchangeable.

The executor uses an actual SERIALIZABLE `db.transaction()`, the same two nominal
advisory locks as v1, protected row locks and current administrative visibility.
Unfiltered SELECT authority is required for all original tables, `intake_forms`
and the private issuer configuration. No privilege is created as a fallback.
It verifies the original bootstrap/read-proof receipts and both full predecessor
cycle receipts, their row-to-audit maps, metadata and hashes before deriving the
current expected state. It never adopts current timestamps or the latest audit
as authority.

Exact synthetic sets are required in both tenants: three profiles, three clients,
three projects, two intakes, one original draft and one original membership.
The formation graphs must belong to A/A1 and retain IF-1 creation status and
provenance. Missing, extra, altered or unaudited rows fail closed. The baseline
audit history, original fixture, formations, other identities and issuer remain
unchanged across each transaction.

Each transition changes only `isActive` and `updatedAt` on the same five identity
rows and writes five mandatory row audits plus one completion receipt. New row
actions are `homolog.identity-continuation.{tenants|profiles}.{reactivate|withdraw}`;
completion actions are `homolog.identity-continuation.{reactivate|withdraw}.completed`
with table `homolog_identity_continuation`. The receipt version is
`structr-homolog-identity-continuation-receipt-v1`; executor ID is
`structr-homolog-identity-continuation-drizzle-v1`. Its fields mirror the bounded
cycle receipt but embed the new manifest. Reactivation `priorEvidenceHash` is the
baseline audit hash; withdrawal uses the canonical hash of
`{history: auditHistory.hash, reactivation: orderedFullReactivationAudits}`.

After flushing deferred constraints, the executor validates the exact six new
audits, current five-row state, full old history, formations and protected rows.
It also proves the opposite operation's evidence unchanged, preventing a seventh
audit hidden under the future withdrawal UUID. Any failure rolls back all changes.
Only SQLSTATE `40001`/`40P01` retry the complete transaction, at most three attempts.
Replay revalidates the same evidence and creates no rows or audits; reactivation
after a completed withdrawal is refused. Preservation also applies to withdrawal
and replay, unlike the original v1 cycle's permission to retain new IF-1 additions
made during that earlier cycle.

Public administrative exports are `parseHomologIdentityContinuationManifest`,
`planHomologIdentityContinuation`, `reactivateHomologIdentityContinuation` and
`withdrawHomologIdentityContinuation`. The pure
`verifyHomologIdentityContinuationEvidence` verifies an operation's six complete
camelCase audit rows against supplied verified before-state and prior-evidence
hash; it performs no reads or writes and does not independently attest its inputs.
