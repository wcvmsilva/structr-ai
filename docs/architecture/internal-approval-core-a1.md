# Internal estimate approval — isolated A1 core

This package adds the persistence and pure validation foundation for internal
estimate decisions. It does not expose an approval writer, route, UI action or
export permission. It does not complete the commercial or field workflow.

Internal approval, proposal issuance, customer acceptance and authorization to
execute are separate authorities. An imported historical proposal remains an H1
capture even if an external document says it was approved. Neither legacy
`approved` status nor a downloadable document creates a new A1 decision.

## Persistent evidence

Migration `0007_internal_estimate_approval_core.sql`, after H1 migrations 0005
and 0006, introduces three append-only tables:

- `estimate_internal_approval_snapshots`: closed, reviewed content and exact
  policy evaluation, with tenant/project/client/draft identity and hashes.
- `estimate_internal_approvals`: one internal decision per draft, actor,
  millisecond timestamp, reason and contextual request identity.
- `estimate_internal_approval_revocations`: terminal revocation evidence. A new
  decision requires a new draft version; revocation does not unlock old content.

Deferred constraints require both the complete evidence pair and the matching
draft projection at commit. Contextual foreign keys prevent cross-project or
cross-tenant substitution. Decided drafts retain their financial content;
operational notes can change without changing the reviewed notes in the snapshot.
The A1 successor request, predecessor, backpointer and identity are permanent,
including protection against concurrent predecessor deletion.

New generic writes of `approved`, `internally_approved` or
`internal_approval_revoked` cannot manufacture a decision. Existing legacy rows
are preserved, without backfill or fabricated actors/dates. Applying this
migration closes the legacy approval writer; it must not be rolled out as if
the replacement user flow were already available.

The evidence tables have RLS enabled with no permissive policies or positive
API grants. Row changes and TRUNCATE are rejected. The migration removes direct
PUBLIC/known API-role grants on these objects and refuses residual effective or
SET-assumable access, including column privileges and MAINTAIN. It does not
rewrite global defaults, role memberships or unrelated tables. This does not
protect against an administrator changing the DDL or certify the actual runtime
principal. That principal and its transaction authorization remain rollout gates.

## Pure content and policy contract

`shared/internal-estimate-approval-engine.ts` validates closed objects and uses
the canonical enums in `shared/domain/taxonomy.ts`. Money is stored as canonical
minor-unit strings, up to 20 digits. BigInt/rational comparison preserves exact
cent boundaries; unknown values remain null rather than becoming zero.

Content includes ordered lines, selections, the explicit USD confirmation,
reviewed notes, origin and policy context. Channel/geo mappings and current
context must agree. Floors use the existing constants, with qualifying tenant
overrides; the global threshold remains a warning. Approval never refreshes a
historical price from the current catalog.

Canonical JSON preserves validated Unicode and array order, normalizes text
line endings, sorts object keys and includes explicit nulls. SHA-256 uses
WebCrypto asynchronously, with no Node import or fallback. Request hashes
include the confirmed command and authenticated context, not generated evidence
IDs or the execution clock. Read validation recomputes content/policy hashes and
the exact evaluation; a matching-looking status is insufficient.

The engine proves structure and arithmetic. Future transactional writers must
prove present authorization, active identity, source ancestry, current context,
request replay and lock discipline. No literal supplied by a client replaces
those database checks. Audit must commit atomically with each future decision.

## Laboratory and integration boundary

The empty-schema laboratory loads only the eight canonical pure SQL
prerequisites from 0007, plus the H1 CHECK prerequisite, before generated
constraints. Unique anchors precede foreign keys. This is a schema smoke test,
not migration replay: it does not install migration-only triggers or grant
production permissions. Actual migration and concurrency tests use a separate
verified, socket-only, disposable PostgreSQL database with synthetic fixtures.

Before enabling shared A1 actions, the remaining package must replace the old
approval path, implement transactional preview/decision/revocation/versioning,
enforce the export contract, close operational promotion paths and verify the
complete UI journey. Browser runtime verification, CI on the integrated commit,
runtime permissions, migration history and recovery must be recorded separately.
No part of this isolated core authorizes real-data migration or field use.
