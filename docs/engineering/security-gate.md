# Structr Layered Security Gate

## Purpose and authority boundary

This document defines the ordered evidence and decision gates for a bounded Structr security claim. It is a checklist and vocabulary, not a completed gate record. Each execution must use [the gate-record template](gate-record-template.md) and identify the exact subject, candidate SHA, claim, scope, evaluator, environment, evidence, and non-claims.

Gate results are SHA-bound and claim-bound. A result at one candidate SHA does not transfer to a later SHA, and a result for one claim does not establish any broader claim. Security verdicts must not be generalized beyond the reviewed scope.

The nine layers run in the order below. A later layer does not cure a missing, failed, or blocked earlier layer. No single lower gate can emit MERGE GO. No automated or lower gate may authorize merge. Only the human may authorize merge after evaluating the complete named gate chain and all applicable program and deployment preconditions.

## Canonical vocabulary

- **PASS:** The individual gate met its declared criteria for the exact candidate SHA, claim, scope, evaluator, and evidence boundary. `PASS` alone does not authorize a transition or merge.
- **FAIL:** The individual gate was evaluated and one or more declared criteria were not met. The claim or transition under that gate cannot advance.
- **BLOCKED:** The gate could not be evaluated because required authority, environment, input, or evidence was unavailable, ambiguous, or unreliable. `BLOCKED` is neither `PASS` nor `FAIL` and never permits advancement.
- **GO:** The specifically named transition for the specifically named unit, claim, and SHA is authorized by the authority assigned to that transition. `GO` is not transferable to another transition, claim, or SHA and is not automatically `MERGE GO`.
- **NO-GO:** The specifically named transition is prohibited for the stated unit, claim, and SHA until its recorded conditions are resolved and the required authority reevaluates it.
- **NOT EVALUATED:** No conclusion was attempted for the named gate, claim, or transition. It is not evidence of either success or failure and cannot support advancement.

## Rules that apply to every layer

- Record facts, inferences, inherited evidence, and fresh execution evidence separately.
- Record the exact commands or reviews performed, their targets, results, environment, and evidence locations.
- Preserve explicit non-claims after every result; absence of a finding is not evidence outside the reviewed boundary.
- Treat unexplained working-tree changes, SHA drift, scope expansion, conflicting authority, ambiguous evidence, and missing load-bearing proof as STOP conditions.
- A green test suite is not tenant-isolation proof.
- `pnpm audit:tenant` exit 0 is measurement, not merge proof.
- Previous-HEAD proof is required for applicable load-bearing change-sensitive assertions.
- Superpowers internal review cannot replace independent Codex review.
- Codex review is read-only and SHA-bound.
- Only the human may authorize merge.

## 1. Live-state gate

### Required inputs

- Expected repository and isolated worktree path.
- Authorized branch, exact candidate SHA, expected parent or baseline SHA, and authoritative remote names.
- Expected PR number, base branch, head branch, head SHA, and merge-state boundary.
- Current human authorization and the expected clean or explicitly bounded working-tree state.

### Minimum evidence

- Fresh local evidence for repository root, worktree isolation, branch, `HEAD`, parent/baseline relationship, ancestry, ahead/behind state, and `git status --short`.
- Fresh authoritative remote SHAs for the candidate branch, security branch, and `main`, as applicable.
- Fresh read-only PR metadata for identity, state, draft status, base, head branch, head SHA, and merged status.
- A timestamp and evaluator identity sufficient to distinguish the observation from a cached report.

### PASS / FAIL / BLOCKED criteria

- **PASS:** The clean or explicitly authorized tree, branch, exact SHA, ancestry, remotes, and PR metadata all match the expected candidate and authorized boundary.
- **FAIL:** The gate can be evaluated and finds an unexplained change, wrong branch/SHA/ancestry, remote divergence, unexpected PR identity/state/head, or other contradiction with the expected candidate.
- **BLOCKED:** A required local, remote, or PR observation cannot be obtained reliably, or the expected live-state boundary is missing or ambiguous.

### Explicit non-claims

- Live-state `PASS` does not establish code correctness, tenant isolation, security adequacy, review quality, deployment readiness, or merge authorization.
- A clean tree proves only the recorded tree state at the observation boundary.

### STOP conditions

- STOP on any unexplained working-tree change, wrong worktree or branch, candidate-SHA drift, unexpected ancestry, remote/PR-head mismatch, merged PR when unmerged was expected, or unavailable authoritative live state.
- Do not repair, fetch-and-reset, push, edit the PR, or reinterpret the candidate to make this gate pass without explicit human authorization.

## 2. Recovery gate

### Required inputs

- Current explicit human decision.
- The candidate-SHA version of `AGENTS.md`, current-state record, approved unit design/specification and plan, applicable ADR/security authority, decision/correction log, historical index, prior gate records, and open blockers.
- The source-of-truth hierarchy defined by the approved workflow.

### Minimum evidence

- A list of every authoritative source read, including its path, exact SHA or live-state boundary, status, and applicable rules.
- A recovered statement of the last closed unit, active unit, exact next authorized action, open blockers, merge posture, and explicit prohibitions.
- Any conflict or stale statement recorded with the hierarchy used to classify it; historical documents remain historical evidence rather than silent current authority.

### PASS / FAIL / BLOCKED criteria

- **PASS:** The required sources are available and support one unambiguous, internally consistent authorized state for the exact candidate and claim.
- **FAIL:** The sources can be evaluated and show that the proposed action conflicts with current authority, approved state, or an explicit prohibition.
- **BLOCKED:** A required authority is absent, materially stale without safe reconciliation, contradictory in a way the hierarchy cannot resolve, or unavailable at the exact evidence boundary.

### Explicit non-claims

- Recovery `PASS` does not validate the implementation, prove the recovered facts beyond their evidence boundaries, reopen a closed unit, or authorize the next unit.
- Conversation history and detailed historical handoffs do not become repository authority merely because they contain relevant context.

### STOP conditions

- STOP when authority conflicts could change scope, product semantics, security posture, a gate result, or the next authorized action.
- STOP when a directly observable fact contradicts an unreconciled authoritative statement and cannot be safely classified without human arbitration.

## 3. Scope gate

### Required inputs

- Exact security claim and candidate SHA.
- Authorized unit, allowed files and actions, forbidden files and actions, named non-claims, stop conditions, and required approvals.
- Threat boundary, affected actors/tenants/resources, and explicit product semantics from approved authority.

### Minimum evidence

- A written scope/claim statement narrow enough to falsify.
- Exact allowed and forbidden file/action sets, plus the observed candidate changed-file set.
- A mapping from each proposed assertion to its authority and planned evidence, including whether previous-HEAD proof applies.
- A record of excluded adjacent units, unresolved product choices, and prohibited generalizations.

### PASS / FAIL / BLOCKED criteria

- **PASS:** The claim, file/action boundary, evidence obligations, non-claims, and stop conditions are explicit, authorized, and match the candidate diff.
- **FAIL:** The candidate contains out-of-scope work, violates a prohibition, overstates the authorized claim, or requires an unauthorized adjacent-unit or product decision.
- **BLOCKED:** Scope, authority, file boundary, product semantics, or claim wording is missing or ambiguous enough that compliance cannot be determined.

### Explicit non-claims

- Scope `PASS` does not prove technical correctness, security effectiveness, tenant isolation, completeness of the wider remediation program, or merge readiness.
- An allowed file is not evidence that every change within that file is allowed.

### STOP conditions

- STOP on any newly required production file, test, schema, migration, environment, CI/hook, package, live-data, backfill, `TENANT_STRICT`, or adjacent-unit change not explicitly authorized.
- STOP on any new product semantic choice, ownership inference, widened claim, or ambiguous blocker-versus-follow-up classification.

## 4. Technical gate

### Required inputs

- Exact candidate SHA and claim-bound technical requirements.
- The unit-approved command set: targeted checks, type checking, relevant tests, regression suite, build, lint, or other checks as applicable.
- Expected results, relevant environment/toolchain, and known baseline failures or limitations.

### Minimum evidence

- Fresh, complete output and exit status for every required command at the exact candidate SHA.
- Test/check identities and counts sufficient to show what ran and what did not run.
- Clear separation of candidate results from inherited or previous-SHA evidence, including disclosed skips, warnings, flaky behavior, and environment limitations.

### PASS / FAIL / BLOCKED criteria

- **PASS:** Every command required by the authorized unit ran against the exact candidate and met its declared technical criteria with no unexplained failures or omissions.
- **FAIL:** A required command completed and failed its criteria, or the executed set demonstrably omits a required technical check.
- **BLOCKED:** A required command cannot run or cannot produce reliable, candidate-bound evidence because of environment, dependency, authority, or tooling constraints.

### Explicit non-claims

- A green test suite is not tenant-isolation proof and does not establish threat coverage, production behavior, live-data safety, security-unit `GO`, or merge authorization.
- Technical `PASS` applies only to the commands and environment actually recorded.

### STOP conditions

- STOP on any required failure, unexplained skip, incomplete output, wrong-SHA execution, unreliable environment, or pressure to treat a partial check as full technical evidence.
- Do not weaken the claim, delete a failing check, mutate unrelated code, or silently relabel a failure as pre-existing.

## 5. Static security measurement (`pnpm audit:tenant`)

### Required inputs

- Exact candidate SHA, the candidate-SHA audit implementation/configuration, and the approved invocation `pnpm audit:tenant`.
- The bounded claim being measured, known scanner rules, blind spots, warnings, gaps, and any comparison baseline.

### Minimum evidence

- Fresh full audit output and exit status at the exact candidate SHA.
- Counts and identities of warnings, errors, known gaps, exclusions, and scanner limitations; do not collapse them into the exit code.
- Where a comparison is claimed, the exact baseline SHA and like-for-like output boundary.

### PASS / FAIL / BLOCKED criteria

- **PASS:** The measurement ran completely at the exact candidate SHA, the output is preserved, and it meets only the unit's explicitly declared audit thresholds.
- **FAIL:** The audit completes and violates a declared threshold, detects an in-scope prohibited pattern, or shows that a claimed measurement improvement did not occur.
- **BLOCKED:** The audit cannot run reliably, its exact target/configuration cannot be established, or required output is unavailable or materially incomplete.

### Explicit non-claims

- `pnpm audit:tenant` exit 0 is measurement, not merge proof.
- Audit `PASS` does not prove tenant isolation, absence of vulnerabilities, runtime authorization behavior, security-unit `GO`, or merge readiness. Scanner silence does not prove safety outside encoded rules.

### STOP conditions

- STOP when the audit target is not the candidate SHA, output is truncated or hidden, warnings/gaps are omitted, rules/config changed outside scope, or an exit code is promoted to tenant-isolation or merge proof.
- Do not add audit automation, CI enforcement, hooks, package changes, or scanner changes unless separately authorized.

## 6. Security-evidence gate

### Required inputs

- Exact candidate SHA, baseline/previous SHA, bounded threat claim, approved security requirements, threat model, affected trust boundaries, and applicable ADR/security decisions.
- Claim-to-evidence mapping for threat-specific assertions, negative and positive controls, documentation controls, and load-bearing change-sensitive assertions.
- The reason previous-HEAD proof is required or, for each non-applicable assertion, a precise reason it is not applicable.

### Minimum evidence

- Candidate-HEAD execution evidence that directly exercises each load-bearing security assertion and demonstrates the expected allowed and denied behavior.
- Previous-HEAD execution proof for every applicable load-bearing change-sensitive assertion: the same relevant check fails at the previous SHA for the expected security-sensitive reason and passes at the exact candidate SHA.
- Exact commands, environments, fixtures, identities/tenants/resources, expected results, actual results, and evidence locations sufficient to reproduce the contrast.
- Residual risks, uncovered paths, scanner limitations, documentation-only assertions, and explicit non-claims.

### PASS / FAIL / BLOCKED criteria

- **PASS:** Every in-scope load-bearing assertion has direct candidate evidence, applicable previous-HEAD contrast for the expected reason, appropriate controls, and no unresolved claim-breaking gap.
- **FAIL:** An assertion is contradicted, a required control fails, previous-HEAD behavior does not fail for the expected reason, the candidate does not change the result as claimed, or evidence reveals an in-scope bypass.
- **BLOCKED:** Required security evidence, environment, fixture, authority, previous SHA, or reproducible previous-HEAD execution is unavailable or ambiguous.

### Explicit non-claims

- Security-evidence `PASS` is limited to the exact reviewed claim, actors, resources, paths, environment, and SHA; it does not establish global tenant isolation, close adjacent units, validate live deployment, or authorize merge.
- Documentation, static analysis, code inspection, and green tests alone are not substitutes for required execution proof.

### STOP conditions

- STOP if applicable previous-HEAD proof is missing, uses a different assertion, fails for an unrelated reason, or cannot be contrasted with candidate-HEAD behavior.
- STOP on evidence contamination, mutable shared state that makes results unreliable, uncovered in-scope bypasses, unsupported ownership inference, or any request to generalize the verdict beyond reviewed scope.

## 7. Superpowers implementation-quality review gate

### Required inputs

- Exact candidate SHA and approved plan/specification.
- Final candidate diff, changed-file set, technical/security evidence, applicable repository rules, and explicit non-claims.
- Internal reviewer identity and the Superpowers review method used.

### Minimum evidence

- An implementation-quality review of correctness, plan/spec compliance, scope discipline, maintainability, regression risk, and evidence quality at the exact candidate SHA.
- Findings classified as `BLOCKER`, `REQUIRED`, or `NOTE`, with disposition and fresh re-review evidence after any correction.
- Confirmation that this internal review is separate from, and does not contaminate, the independent Codex gate.

### PASS / FAIL / BLOCKED criteria

- **PASS:** The internal review is complete at the exact candidate SHA and has no unresolved `BLOCKER` or `REQUIRED` finding within its declared implementation-quality scope.
- **FAIL:** The review identifies an unresolved `BLOCKER` or `REQUIRED` finding, plan/spec deviation, correctness defect, or evidence-quality defect.
- **BLOCKED:** A qualified internal review, exact candidate diff, required authority, or supporting evidence is unavailable or the reviewer boundary cannot be established.

### Explicit non-claims

- Superpowers internal review cannot replace independent Codex review.
- Internal-review `PASS` is not an independent security verdict, security-unit `GO`, PR approval, deployment approval, or merge authorization.

### STOP conditions

- STOP on any unresolved `BLOCKER` or `REQUIRED` finding, candidate mutation after review without re-review, reviewer conflict that invalidates the boundary, or attempt to waive the independent Codex gate.
- Do not promote internal review findings or their absence into claims outside implementation quality.

## 8. Independent Codex read-only gate at the exact candidate SHA

### Required inputs

- Immutable identification of the exact candidate SHA, bounded claim, authorized scope/non-claims, plan/specification, repository authorities, candidate diff, and complete evidence package.
- Independent reviewer instructions that prohibit mutation of the reviewed implementation and evidence.
- The expected verdict/transition boundary and all unresolved findings from lower gates.

### Minimum evidence

- Codex independently re-derives live state, scope, relevant implementation behavior, and the security claim from the exact candidate SHA in read-only mode.
- A SHA-bound, claim-bound review record listing sources, checks, findings (`BLOCKER`, `REQUIRED`, `NOTE`), non-claims, and a narrow verdict.
- Confirmation that the reviewed tree was not mutated by Codex and that any later candidate change invalidates this gate until a fresh review occurs.

### PASS / FAIL / BLOCKED criteria

- **PASS:** Independent Codex review completes read-only at the exact candidate SHA, supports the bounded claim within the recorded evidence, and has no unresolved finding that prohibits the named transition. Any resulting `GO` is limited to that named unit and transition and is not `MERGE GO`.
- **FAIL:** Codex issues `NO-GO` or finds a claim-breaking defect, scope violation, unsupported assertion, missing required proof, or unresolved blocker at the exact candidate SHA.
- **BLOCKED:** Independence, read-only operation, exact-SHA access, required authority/evidence, or a reproducible review boundary cannot be established.

### Explicit non-claims

- Codex review is read-only and SHA-bound. Codex cannot mutate the reviewed implementation or its evidence and remain the independent reviewer for that candidate.
- Codex `PASS` or narrow unit `GO` does not authorize merge, validate a later SHA, close a broader program claim, or replace the human gate.

### STOP conditions

- STOP if Codex would need to edit the candidate or evidence, reviewed content differs from the exact candidate SHA, independence is compromised, required evidence is missing, or the candidate changes after review.
- Corrections require a new candidate SHA and a fresh independent Codex review; do not carry the prior verdict forward.

## 9. Human gate

### Required inputs

- The exact candidate SHA, bounded claim, requested transition, and complete ordered results for Layers 1-8.
- All `BLOCKER`, `REQUIRED`, and `NOTE` findings; residual risks; explicit non-claims; program blockers; deployment/live-state preconditions; and current PR merge posture.
- The human authority responsible for the specific decision: scope, commit, push, unit transition, deployment, or merge.

### Minimum evidence

- An explicit human decision identifying the exact candidate SHA, claim, transition, decision, conditions, and next authorized action.
- A durable record of `GO`, `NO-GO`, or deferred/`NOT EVALUATED` posture without rewriting historical evidence.
- For merge consideration, evidence that every named lower gate and all separate program/deployment preconditions were evaluated and that no unresolved prohibition is being bypassed.

### PASS / FAIL / BLOCKED criteria

- **PASS:** The authorized human explicitly approves the specifically named transition for the exact candidate SHA and claim after receiving the complete bounded evidence and non-claims.
- **FAIL:** The human explicitly rejects the transition, issues `NO-GO`, or the evidence shows that a required condition for the requested transition is not met.
- **BLOCKED:** No authorized human decision exists, the decision is ambiguous or not bound to the exact candidate/claim/transition, or prerequisite gate evidence is unavailable or contradictory.

### Explicit non-claims

- Human authorization for one action does not authorize another: approval to draft, commit, push, transition units, deploy, and merge are distinct unless the decision explicitly says otherwise.
- A human `GO` remains bound to the named SHA, claim, and transition; it does not erase non-claims, unresolved adjacent units, or deployment conditions.

### STOP conditions

- STOP until the authorized human gives an explicit decision for the requested transition. Silence, prior approval at another SHA, an agent recommendation, CI status, test results, audit results, Superpowers review, and Codex review are not human authorization.
- STOP on ambiguous authority, unresolved lower-gate `FAIL`/`BLOCKED`, unaccepted residual risk, later SHA changes, or any attempt to infer merge approval from a narrower human decision.

## Current program posture and document non-effects

- PR #9 remains `NO-GO`.
- B2 remains `NOT DEFENSIBLE`.
- F5b remains `NOT STARTED`.
- This document introduces NO automation, enforcement, CI changes, hooks, package changes, production code, tests, schema, migrations, env changes, Supabase/live DB work, backfill, or `TENANT_STRICT`.
- This document does not touch PR #9, `main`, or `security/tenant-isolation-remediation-20260821`; authorize a commit or push; start Task 5; or start F5b.
