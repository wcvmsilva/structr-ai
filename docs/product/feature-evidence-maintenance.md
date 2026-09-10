# Feature evidence maintenance

Approved for local preparation on 2026-09-10. This procedure applies the [canonical registry](canonical-structr-truth-v1.md), especially §§4.4–4.6 and 5. It does not replace `AGENTS.md`, assign authority holders, or resolve open canonical decisions. The PR template makes it available during feature delivery; no automated enforcement is installed by this document.

## Before implementation

The feature author completes an impact matrix in the PR description or linked specification. Use existing capability IDs and canonical definitions. A proposed new capability requires the applicable human product decision; a new filename does not create one.

State the observable before/after behavior and acceptance criteria. Identify directly changed capabilities, then trace callers, shared data, consumers and transformations to identify indirect effects. Include static and dynamic imports, router/client entry points, schema and migration effects, shared rules, and cross-domain data flows where relevant. A capability may be distributed across domains or consume its own engine.

| Capability ID | Direct or indirect impact | Changed behavior or claim | Relevant files and consumers | Acceptance criterion / evidence needed | Reviewer and disposition |
|---|---|---|---|---|---|
| Fill from registry | Direct / indirect | Describe the actual change | Paths and caller/data-flow references | Observable result; test or inspection appropriate to the claim | Named reviewer; pending / reviewed, with record |

Remove the placeholder row and add one row per affected capability. If there is no capability impact, explain why using the actual diff and dependencies. An empty matrix is not evidence of no impact.

### Starting points for scope discovery

These are review prompts, not an exhaustive dependency map or new canonical `depends_on` relationships. Confirm inclusion and exclusion against the feature's exact tree.

| Change surface | Capability review candidates | Required scope check |
|---|---|---|
| Pricing dimensions, scope-to-estimate construction | C-14, C-15, P-09; consuming capabilities discovered by tracing | Follow source values through transformation, persistence and output; distinguish a field from a preserved lineage |
| Scope approvals, estimate versions and authorization | C-11, C-14, C-22, C-29, C-33 | Inspect approval events, baseline selection, immutability and downstream consumers against canonical semantics |
| JSON/export representation | P-10, P-09, C-14 | Verify producer/storage/reader agreement, missing values, and preservation of authority and provenance |
| Shared DB helpers, schemas, tenancy or access rules | P-06, P-03, P-02 and each affected consumer | Inspect reads and writes, tenant/access boundaries and migration compatibility; identify security-review needs separately |
| Shared financial calculations or taxonomy | Owning capability and actual consuming capabilities, including C-18/C-30/C-32/C-35 where affected | Trace input meanings, rounding, state transitions and outputs; do not classify by identifier names |
| Client routes, router registration or input validation | Capabilities served by changed entry points | Recheck affected L1/L2/L6 evidence and the actual called procedures |
| Canonical definitions or classification rules | Every row relying on the changed definition or rule | Broaden the review to all affected claims; obtain the applicable authority decision |

## During implementation and review

1. Keep implementation, affected registry rows and evidence changes in the same PR. Update both views when applicable, totals and confidence distributions, and any active summaries affected by a reclassification.
2. Meet `AGENTS.md` execution and testing requirements for implementation work. Tests must verify behavior; file presence, a function name or an import alone cannot establish operational validation.
3. Record evidence for each changed claim: repository, full reviewed SHA, UTC observation time, inspected scope, exact references, findings and limitations. Distinguish observed facts, inference, historical evidence and unverified assertions.
4. Assess implementation, operational validation, security, confidence, verification state, lifecycle and roadmap separately. Retain uncertainty when canonical correspondence is unsettled. A passing test or a connected router does not approve the other dimensions.
5. Preserve superseded claims in an explicit scoped correction record: before, after, reason, evidence, what is superseded and what does not follow. Keep old pass reports as history; update active summaries.
6. A reviewer other than the author checks the affected claims and the proposed review boundary. If a shared dependency, conflicting fact or unexplained data-flow edge expands the scope, expand the matrix before closing review. No second reviewer is implied merely by generating this checklist.

## Exact-SHA delivery record

Use the PR or a separate delivery record to capture the resulting commit after it exists; a document cannot contain its own resulting SHA. Fill these fields with actual observations, not planned results:

| Field | Required content |
|---|---|
| Repository | Repository URL |
| Reviewed source SHA | Full immutable SHA used for evidence |
| Compared base SHA | Full SHA used to establish the change scope |
| Observation time | UTC timestamp |
| Scope | Capability IDs, claims, files, consumers, exclusions and reasons |
| Evidence | Source references and actual checks/results; unexecuted checks explicitly identified |
| Decisions | Before/after classifications and independent grounds per changed dimension; human decision reference where required |
| Reviewer | Actual reviewer identity, review time, result and unresolved findings |
| Reviewed pre-commit SHA | Explicitly labeled documentary/code review anchor |
| Resulting post-commit SHA | Filled after commit creation; separately reviewed result |
| Publication observation | Filled only if publication occurs and is observed; otherwise pending |

Incremental review limits the inspection scope; it does not transfer an old verdict to a new commit. At the new SHA, re-establish affected claims and document the comparison and dependency checks used to bound the review. Unreviewed rows retain their historical anchors and cannot be relabeled `CURRENT` by this procedure. A claim about all 48 rows requires evidence covering all 48 at the stated SHA.

## Completion checklist

- [ ] Impact matrix covers direct changes and traced consumers, with justified exclusions.
- [ ] Behavior and acceptance criteria are explicit; required implementation checks have recorded results.
- [ ] Both registry views and affected aggregates agree; IDs and allowed values are valid.
- [ ] Source references exist at the recorded SHA and support the actual claims, including negative claims.
- [ ] Corrections preserve previous statements and state their exact scope.
- [ ] Each changed dimension has its own evidence and required human decision.
- [ ] Independent review covers the affected claims and scope boundary; unresolved findings have an explicit disposition.
- [ ] Resulting commit and any publication have their own observations before the corresponding delivery gate is declared complete.

Automated checks for IDs, row correspondence, allowed values, aggregates and reference existence are a future implementation step. Until installed, perform those checks during review. Such checks can detect structural inconsistency; they cannot decide canonical correspondence, prove runtime behavior, or grant approval.
