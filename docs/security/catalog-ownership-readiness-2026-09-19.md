# Catalog ownership: bounded review preparation — 2026-09-19

This work prepares concrete review input for the approved [G4b design](g4b-catalog-ownership/2026-09-17-design.md#5-modelo-de-ownership). It does **not** classify live data, enforce quarantine, implement the ownership ledger, approve a migration, or close G4b. The application baseline is `a7c17ed7`; this additional tooling is a separate remediation change. No live writes, schema changes, commit or publication were performed by this subtask.

## What the current observation establishes

The existing private read-only collector ran the single SELECT in `scripts/catalog-ownership-readiness-snapshot.sql`. It returns only UUIDs, SHA-256 fingerprints of full rows, exact relationship UUIDs and the duplicated commercial booleans. It does not return customer names, catalog names/descriptions, prices, contacts or credentials. Hashing happens inside PostgreSQL; the original row bodies are never exported by this SELECT.

The snapshot reports `2026-09-19T03:28:37.425Z`. The observation includes 504 catalog definitions (15 assemblies, 460 cost codes, 7 cost types, 22 units) and 731 dependent records (117 assembly items, 598 price-history records, 16 crew-velocity records). The tool resolved 3,485 non-null reference occurrences to UUIDs present in that snapshot. It found no missing target in the covered relationship set. This is **not** a proof of complete database visibility, no database orphans, ownership, pricing validity or the complete G4b dependency graph.

There are seven concrete conflicts in six distinct cost types (one type has both conflicts):

| Observed pair | Count | Required resolution |
|---|---:|---|
| `isTimeTrackable=false`, `timeTrackable=true` | 6 | Establish the authorized tracking setting for each exact type and preserve the evidence. |
| `isTaxable=false`, `taxable=true` | 1 | Establish the authorized taxability setting for that exact type and preserve the evidence. |

Neither field name, a default, apparent recency nor choosing the permissive value resolves these conflicts. These are existing stored boolean disagreements, not tax guidance. The private packet identifies each affected object by UUID and full-row hash. Raw identifiers and row hashes are intentionally absent from this document.

Repository source checks included the migration journal SQL/schema snapshot, `drizzle/schema.ts`, catalog/price-book seed and export scripts, server seed, import-related tracked files and engineering/product/security manuals. `drizzle/0000_strong_jean_grey.sql` and the current schema already declare the opposing time-tracking defaults (`false` and `true`). This establishes a technical opportunity for divergence, not the actual historical origin or the intended business value for these six rows. No exact row-bound source/import/attestation resolving them was found in that inspected set. The approved design §6.3.1 explicitly treats duplicated-flag divergence as a reconciliation stop condition. This search does not assert that no authoritative source exists outside the inspected repository.

## Engineering evidence versus business decisions

| Item | Engineering can establish | Owner/source evidence still needed |
|---|---|---|
| Catalog definitions | Exact row identity/hash; current stamps; matching source IDs and full content if an authoritative source is supplied. | Identify the authoritative import/source or supply an explicit audited attestation for the exact rows that need ownership. A stamped tenant alone is insufficient. |
| Pilot subset | Trace the selected assemblies through their exact items, types, units and prices. | Identify which source-approved definitions are intended for the pilot. Do not treat all existing definitions as approved merely because they are present. |
| Seven flag conflicts | Preserve both existing values, exact object/hash and any verified import history. | Decide the authorized value using the business configuration/source for each type. No automatic precedence or mass overwrite. |
| Price history | Resolve its explicit cost-code and unit references in the observed snapshot. | Prove the commercial source, tenant, unit meaning and applicability before tenant price state is migrated. Presence of a valid unit UUID does not prove those semantics. |
| Crew velocity | Resolve its code/unit references. | Provide verified source/project/tenant authority, or retain an explicit unresolved disposition. A code relationship or source label is not ownership authority. |
| Missing reference, if a future snapshot contains one | Recheck collector visibility, then determine whether the exact target is absent/deleted or the source reference is wrong. | A business correction is needed only when source intent cannot be established from evidence. Never create a replacement by guessing a similar name. |
| Canonical catalog | Confirm that this review assigns zero canonical rows. | Future curated canonical content needs its own new IDs, review and provenance. Existing legacy rows are not promoted. |

The next owner-facing review is concrete: use the six private cost-type objects and seven questions to select the authorized boolean per field and name its source; identify the authoritative catalog/import evidence and pilot subset. Engineering then compares exact identities/full content and prepares only evidenced candidate decisions. A missing source in this metadata packet means **origin not assessed by this tool**, not “origin unknown” or “no source exists.”

## Artifacts and use

- `scripts/catalog-ownership-readiness-snapshot.sql`: one read-only SELECT, designed for the collector's `READ ONLY` transaction. Collection remains a separate authorized operation; the CLI has no database or network access.
- `scripts/catalog-ownership-cost-type-labels.sql`: optional read-only query of just the affected cost-type labels, UUIDs and hashes. Its output stays private and is attached only when every exact UUID/full-row hash matches the earlier metadata. Labels do not decide any setting or ownership.
- `scripts/catalog-ownership-readiness.ts`: strict offline validator and bounded reference analysis. Unknown columns/tables, raw content, duplicate IDs, malformed fingerprints, incompatible snapshot metadata and “unobserved” tables with rows are rejected.
- `server/catalog-ownership-readiness.test.ts`: behavior tests using synthetic UUIDs and data only.
- Private, ignored `tmp/reconciliation/catalog-ownership/snapshot.json` and `collector-output.json`: current captured evidence and collector wrapper.
- Private, ignored `tmp/reconciliation/catalog-ownership/review-packet.json`: 1,235 review objects, exact UUID/hash references and seven identified flag conflicts. It is created exclusively with file mode `0600`; no overwrite. This is review input, **not** the approved G4b classification manifest or a proposed post-state.
- Private, ignored `tmp/reconciliation/catalog-ownership/owner-review-packet.json` and `OWNER-REVIEW.private.md`: six named objects/seven concrete questions with both existing values and pending owner/source fields. The separate label capture matched every UUID and full-row hash; the files have mode `0600`. Labels are deliberately excluded from this document and Git.

From the repository root, prepare another aggregate report and a **new** private packet filename:

```sh
pnpm exec node --import tsx scripts/catalog-ownership-readiness.ts \
  --snapshot tmp/reconciliation/catalog-ownership/snapshot.json \
  --private-packet tmp/reconciliation/catalog-ownership/review-packet-next.json
```

Omit `--private-packet` for aggregate output only. stdout contains counts, limitations and a packet identity, never row UUIDs/full-row fingerprints. Detailed output is restricted to a new file under the repository's ignored `tmp` directory, including a realpath check against symlinked parent directories. Input must be a regular file, not a symlink, with a 16 MiB maximum. Rejected content and paths are not echoed in errors.

When the optional label query has been captured in a private file, append `--cost-type-labels tmp/reconciliation/catalog-ownership/cost-type-labels.json` to an invocation that specifies a new `--private-packet`. This adds `ownerReview` with recognizable labels, exact existing flag values, one question per conflict, and empty authorized-value/source/reviewer fields. Missing, extra, duplicate, older or stale-hash label captures are rejected before a packet is written. Names never enter stdout. This worksheet cannot be applied by the tool; the ordinary report remains valid without labels.

Exit `1` means valid review input was prepared but ownership remains unresolved. Exit `2` means invalid/unavailable input or output. There is no exit `0` readiness path, “apply” flag, SQL mutation or generated ownership assignment.

## Deliberate limits and remaining evidence

Every legacy catalog definition has the documentary provisional disposition `unclassified`; dependent records remain `unresolved_dependent_contract`. These labels exist only in the private review packet. The tool does not establish or change how the running application treats those records.

The following remain separate requirements before a cutover manifest can be approved:

1. Match authoritative source/import/attestation evidence to each exact row or a demonstrably homogeneous, completely enumerated batch. Preserve the evidence hash, source reference and reviewer. Do not infer provenance from tenant stamps, a single tenant, names, counts, defaults or a presumed seed run.
2. Resolve the seven commercial-flag conflicts and all intended tenant-state/price semantics from that evidence. No commercial value is copied or invented by this tool.
3. Inventory the complete inbound and operational graph required by G4b, including snapshots, feedback, adjustments, exports and audit records. This tool covers only eight named tables and their listed UUID edges; it does not cover JSON references, cycles, pricing windows or all inbound references.
4. Bind the full graph snapshot to the exact app/schema versions, prove collector visibility and freeze writers before final fingerprints. Reported observation time and consistency are collector assertions; the offline tool cannot authenticate them. Full-row fingerprints use PostgreSQL `to_jsonb(row)::text` UTF-8 SHA-256, not a portable cross-version canonical JSON standard.
5. Produce the intended post-state and exact decision ledger, verify the approved rules/constraints/permissions in an isolated clone, and prepare the explicitly approved operation and recovery evidence. A matching metadata hash alone authorizes none of those changes.

## Validation

TDD used a no-behavior scaffold: **44 tests failed**, including concrete assertions for assignments, references, rejection and output boundaries; the implementation then passed **44/44**. The private label/worksheet extension added 16 cases, with 15 expected failures and 45 passes before implementation (the existing argument guard already rejected the invalid fourth-argument case). Final focused suite: **60/60 passed**. Dedicated TypeScript checking for the script and tests passed with zero errors. Current captured metadata successfully produced the private packet; its exit `1` correctly retained unresolved readiness. These tests establish offline behavior and validation only; they are not runtime RLS, production least-privilege, source provenance or migration proof.
