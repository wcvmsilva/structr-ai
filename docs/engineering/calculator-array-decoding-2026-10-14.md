# Calculator: explicit ACL decoding — 14 October 2026

The controlled homologation reached the audited TEMP containment step. The following closed installer returned `uncertain`; it was not automatically retried. Read-only recovery found no installation receipt, no Calculator roles/schema, no remaining administrative session, and the unchanged application/managed catalog hashes. The TEMP containment receipt remains durable as approved.

A diagnostic through the actual administrative connection confirmed that `fetch_types: false` returns PostgreSQL `text[]` as a string. `installer.ts` attempted `.sort()` on that value before the first migration. The physical test previously used the default type-discovery configuration and missed this difference.

The correction projects the database ACL as `to_jsonb(datacl::text[])`. This preserves the array elements, canonical sorting, audit snapshots and all guards without enabling type discovery or changing permissions. The physical installer suite and operational child transport now use `fetch_types: false` explicitly.

## Verification

- RED, before implementation: the actual driver configuration reproduced `state.databaseAcl.sort is not a function`; 12 dependent cases failed and 3 passed. The owned cluster was removed.
- GREEN: 15 physical installer cases, 10 manifest cases, 48 command/process cases and 1 physical operational journey passed: **74 distinct cases**, including one new array-decoding characterization.
- Physical behavior covers audited closed installation, read-only recovery, refusal of replay, rollback on audit or second-migration failures, receipt tampering, preparation, opening, deactivation and withdrawal.
- Independent review of the three executable/test changes reported no P1/P2 findings. All 52 frozen files retain their exact hashes; aggregate `8eb116952a6ffe5d8e08df6c790ec89bd23f30d6c7be307e31c2f40d8d3d5669` is unchanged.
- Migrations 0020/0021, credentials, runtime authorization and production configuration are unchanged by this correction. Broad pre-push checks and GitHub CI are separate gates; consult the correction PR for their actual results.

## Resumption conditions

Record the corrected commit and operational hashes before another installation attempt. Preserve the original inconclusive-attempt evidence; use a distinct operation ID for the reconciled corrective attempt and the existing TEMP receipt. Do not recreate the TEMP receipt or treat absence of a receipt alone as rollback proof.

The financial window has not begun. Hosted credential provisioning, Preview delivery, transport and same-bearer withdrawal proofs must still complete under the approved scope. This correction does not approve field use or the broader approval/version/export/recovery journey.
