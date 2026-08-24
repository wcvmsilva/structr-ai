# Structr Engineering Historical Index

This file is an index to repository evidence, not a rewritten history and not proof by itself. Read each artifact at the cited SHA and apply the classification below before relying on it.

## CURRENT AUTHORITY

- CURRENT AUTHORITY — Live repository and GitHub state: highest authority for observable facts such as ref SHAs, working-tree state, and PR state. Record the observation time and exact target whenever it is used.
- CURRENT AUTHORITY — [AGENTS.md](../../AGENTS.md): repository operating rules, reconciled by `806657aecdb4d9ced25cd1f52020ae2870af02ac`. For repository operating rules it is subordinate to explicit current human decisions; fresh live repository/GitHub observation controls directly observable facts.
- CURRENT AUTHORITY — [Current state](current-state.md): replaceable snapshot of observable repository/GitHub state and the current authorized unit. Replace it when verified state changes; do not use an old version as historical proof.
- CURRENT AUTHORITY — [Decision / correction log](decision-correction-log.md): append-only record of established decisions, corrections, evidence boundaries, and downstream consequences.
- CURRENT AUTHORITY — [Gate record template](gate-record-template.md): blank reusable structure. Only completed records tied to exact evidence and SHAs can support a gate verdict.

## APPROVED ARCHITECTURE

- APPROVED ARCHITECTURE — [ADR-001 — Structr Data Ownership Model](../adr/ADR-001-structr-data-ownership-model.md): accepted in `7c5d14877928ecc0e0657c278da8a00b6afe01f7`; authority for tenant, platform-reference, and GCHI ownership semantics.
- APPROVED ARCHITECTURE — [Class-G reclassification and remediation plan](../security/class-g-reclassification-and-remediation-plan.md): versioned architecture and remediation evidence at `7c5d14877928ecc0e0657c278da8a00b6afe01f7`; read together with later corrections rather than copying its historical route classifications blindly.
- APPROVED ARCHITECTURE — [Phase 1 controlled engineering workflow design](../superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md): introduced at `da0110381576479d1043cef31b250cef881d6323` and refined at `69640ba9accf334b2066f524f60f00791e508b60`; defines authority, gates, roles, worktrees, review separation, and evidence boundaries.
- APPROVED ARCHITECTURE — [Phase 2 initial integration plan](../superpowers/plans/2026-08-24-controlled-engineering-workflow-initial-integration.md): `7e7953f50ff89d801fc2c07a20fd8adf236b6836`; approved task sequence and scope for the initial workflow integration.
- APPROVED ARCHITECTURE — [Task 1 AGENTS.md reconciliation](../../AGENTS.md): `806657aecdb4d9ced25cd1f52020ae2870af02ac`; approved correction of repository operating rules before Second Brain integration.

## HISTORICAL EVIDENCE

- HISTORICAL EVIDENCE — [Security remediation handoff v2](../security-remediation-handoff.md): `5ac13470d15a48d89e2f663d8252b11b96d5808f`; append-only record of program state and planned gates at that temporal boundary.
- HISTORICAL EVIDENCE — [PR #9](https://github.com/wcvmsilva/structr-ai/pull/9): append-only review and program history. Read its live state separately from historical descriptions; Task 2 does not edit it.

### Security-unit references

- HISTORICAL EVIDENCE — [`7be4951879c465fef3b01f5f7231c316be09ac1f`](https://github.com/wcvmsilva/structr-ai/commit/7be4951879c465fef3b01f5f7231c316be09ac1f) through [`0bc9e60503c348a1e1455f70d1f14939ff2ef5be`](https://github.com/wcvmsilva/structr-ai/commit/0bc9e60503c348a1e1455f70d1f14939ff2ef5be): Class-B/B2 implementation sequence; each reference is bounded to its own commit and diff.
- HISTORICAL EVIDENCE — [`ab131e7719efeb72e749d767020df302e15a742a`](https://github.com/wcvmsilva/structr-ai/commit/ab131e7719efeb72e749d767020df302e15a742a): G1 unit reference at that SHA.
- HISTORICAL EVIDENCE — [`9755cfe127b5c1234ff4b63edda1392f5b6223ff`](https://github.com/wcvmsilva/structr-ai/commit/9755cfe127b5c1234ff4b63edda1392f5b6223ff): G3a-1 unit reference at that SHA.
- HISTORICAL EVIDENCE — [`9c8ded31cf82c10456f1931a8830b50d53483a59`](https://github.com/wcvmsilva/structr-ai/commit/9c8ded31cf82c10456f1931a8830b50d53483a59): later G3a-1 unit reference at that SHA.
- HISTORICAL EVIDENCE — [`b95ea0bf4741646f418fcc99a22d22a42d24be51`](https://github.com/wcvmsilva/structr-ai/commit/b95ea0bf4741646f418fcc99a22d22a42d24be51): G3a-1 review-candidate reference at that SHA.

## SUPERSEDED / CORRECTED

- SUPERSEDED / CORRECTED — [`AGENTS.md`](../../AGENTS.md) before `806657aecdb4d9ced25cd1f52020ae2870af02ac`: prior repository-rule versions; correction details are in the [decision / correction log](decision-correction-log.md).
- SUPERSEDED / CORRECTED — [Security remediation handoff](../security-remediation-handoff.md) at `5ac13470d15a48d89e2f663d8252b11b96d5808f`: time-bounded program record; later state references are indexed in [current-state.md](current-state.md) and correction details in the [decision / correction log](decision-correction-log.md).
- SUPERSEDED / CORRECTED — [Class-G reclassification and remediation plan](../security/class-g-reclassification-and-remediation-plan.md) at `7c5d14877928ecc0e0657c278da8a00b6afe01f7`: versioned classification record; later correction boundaries are recorded in the [decision / correction log](decision-correction-log.md).
