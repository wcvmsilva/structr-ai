# C2-A: retire legacy approval and export paths

2026-09-20. Based on PR23 (`5a3046335069d305884ffff85571e78db159d3dd`). This is a negative compatibility slice, not a release for real projects. The coordinator ratified the C2-A proposal (`a65065042b7978c33111d00b0d4ae2dff37d532f39ed57a166ed354868e88d18`) in `A1-C2-COORDINATOR-RATIFICATION.md` (`dd5845e77bc598bde006b1176accbd0bd4dabb9893b65d2fb3c63f2a0651d3f4`). Existing A1 Core, Integration, Export and v2 projection contracts still apply.

## Behavior

The existing id-only approval, version copy, change-order creation and change-order materialization helpers refuse before reading inputs/storage or causing effects. Automatic materialization on legacy approval is removed. Neither old `approved` stamps, A1 active/revoked decisions, v2 markers, historical provenance, admin roles nor environment flags can enable these old paths. The version history retains facts but returns `activeApprovedId: null`; the old exportable selection returns no candidate.

Existing PDF, JSON, printable HTML, draft CSV validation, CSV issuance, preflight and download routes remain authenticated and validate their existing inputs and project permissions. They return a typed precondition failure before artifact generation, storage, audit success, attempt insertion or download updates. The direct draft generators and direct export/download helpers also refuse. Authorization returns only a closed negative answer, never an open draft or a historical price described as an approved total.

The detail page keeps exact display, navigation, historical capture links, Profit Shield reading and existing rejection/reopening paths. Legacy approval confirmation and export mutation hooks are removed. The retained unavailable export buttons have safe callbacks, including when called programmatically; stale positive query results cannot enable them. Local HTML printing, the unused printable query and cached CSV validation report are removed. There were no version/change-order callbacks on this page to replace.

Pure explicit-row CSV classification, normalization, validation, taxability, escaping and serialization remain usable for synthetic format inputs. They are not mounted as an alternative estimate export endpoint.

## Historical export summaries

`listExportsForEstimate`, `listExportsForProject` and `getExportById` now require an authenticated actor/tenant context. Each read uses one SERIALIZABLE transaction, checks the active tenant, locks the authorization rows through the existing project guard, and verifies export/estimate/project/tenant coherence on that same transaction. Inconsistent rows fail the entire read; an empty list still requires permission. Unexpected history storage/driver errors become a generic internal error at the route boundary.

Only `id`, `estimateDraftId`, `projectId`, `estimateVersion`, `status`, `rowCount`, `createdAt`, `downloadedAt` and `downloadUnavailable: true` leave the helper. The DB projection itself omits manifests, reports, hashes, payloads, URLs, storage keys and raw error messages. A historical ready/downloaded label is a fact, never a download capability. This change does not claim to revoke previously delivered external URLs.

## Audit and compatibility

A legacy refusal occurs before admission of a governed request. This slice intentionally writes no partial governed attempt and no success audit. Immutable blocked/ready attempts, durable audit, exact snapshot renderers, final revalidation and authenticated bytes remain requirements of the positive Export delivery. No schema, migration, production data or permission policy is changed here. Existing unrelated mutations retain their audit paths.

Old tests that asserted issuance or status-based approval are adapted to the ratified refusal. Independent ACL, tenant, policy arithmetic, history, precision and format controls remain. Former source-text assertions for approval setters or success-audit names are replaced with behavior; comments are not inserted to make obsolete checks pass.

## Verification and remaining work

Behavioral RED was captured before implementation for direct writers, actual routes, artifact entrypoints and real React callbacks. Incremental review found missing tenant lifecycle and unsanitized history errors; failing cases preceded those fixes. Focused test and type/CI results are recorded in the coordinator's C2-A verification report and PR.

No browser session, lab database, production migration or expanded physical security battery was run. Callback/SSR and controlled relational-driver tests are not physical concurrency or browser evidence.

C2-B exact aggregates; the remaining Integration operational consumers; positive A1 approval/revocation UI; the complete governed Export protocol; C3 replacement of the existing version route; native patch review; integrated screen flow; and destination environment/principal/migration-ledger/recovery validation are still open. This package alone must not enable real field use.
