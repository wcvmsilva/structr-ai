# Controlled Engineering Workflow Design

**Status:** Proposed design approved for documentary specification on 2026-08-24. Implementation remains unapproved.

**Repository:** `wcvmsilva/structr-ai`

**Baseline:** `security/tenant-isolation-remediation-20260821` at `b95ea0bf4741646f418fcc99a22d22a42d24be51`

**Program checkpoint:** `G3a-1-F5a+c CLOSED — independent Codex GO at b95ea0bf.`

**Merge posture:** PR #9 remains `NO-GO`.

## 1. Purpose

Integrate Superpowers, a repository-local Second Brain, and the existing Security Gate into one controlled engineering workflow. The workflow must preserve the current human-controlled security-remediation protocol, reduce context loss between sessions and tools, and prevent an agent from turning incomplete evidence into an implementation or merge claim.

This document defines the design only. It does not authorize implementation, workflow automation, changes to production code, changes to CI or hooks, edits to PR #9, or the start of F5b.

## 2. Current-state findings

The following facts were reverified before this design was written:

- Local branch, authoritative remote branch, and PR #9 head all resolve to `b95ea0bf4741646f418fcc99a22d22a42d24be51`.
- `origin/main` resolves to `233569d68c014712ce3d25326bda8823aab1987e`.
- PR #9 is open, not a draft, and not merged. Its base is `main` and its head is `security/tenant-isolation-remediation-20260821`.
- The repository was clean and local tracking reported 0 ahead / 0 behind.
- GitHub CI (`Type check and tests`) and Vercel checks were successful for the current PR head.
- Superpowers is already versioned under `.gemini/.superpowers/skills`, with command adapters under `.gemini/commands`.
- No formal repository-local Second Brain exists. `docs/security-remediation-handoff.md` currently carries part of that responsibility.
- The handoff is historically useful but no longer a valid current-state source: it still says G3a-1 has not started and names G3a-1 as the next action.
- CI runs `pnpm check` and `pnpm test`; it does not run `pnpm audit:tenant`.
- `pnpm audit:tenant` exits successfully at this baseline while reporting 44 warnings and 6 known gaps. The audit is therefore useful measurement, but its current exit status is not proof that the repository is multi-tenant safe or ready to merge.

## 3. Binding constraints

The integrated workflow must preserve these constraints:

1. The human is the only authority for scope expansion, product decisions, commit approval where required by the active unit, push authorization, and merge.
2. Claude Code may implement after approval but never merges.
3. Codex is the independent read-only auditor and does not edit the reviewed implementation or its evidence.
4. A green test suite is not proof of tenant isolation.
5. Historical evidence is append-only. Corrections are added explicitly; prior evidence is not silently rewritten.
6. Evidence must identify the exact reviewed SHA. A verdict does not transfer automatically to a later HEAD.
7. Previous-HEAD execution evidence remains mandatory for every load-bearing security assertion.
8. Ambiguous blocker-versus-follow-up classification stops for human arbitration.
9. Mutable operations are verified before they are repeated.
10. Documentation commits remain separate from security implementation commits.
11. No live database access, migration, backfill, `TENANT_STRICT` change, or ownership inference is authorized by this workflow design.
12. PR #9 remains `NO-GO` until every named merge precondition is independently satisfied.

## 4. Source-of-truth hierarchy

When two sources conflict, the workflow resolves them in this order:

1. **Explicit current human decision** — the controlling authority for scope and product semantics.
2. **`AGENTS.md`** — permanent repository operating rules.
3. **Current-state record** — concise, SHA-bound status of the active program and next authorized action.
4. **Approved unit design/specification** — the exact claim, boundary, files, exclusions, and stop conditions for one unit.
5. **Executed evidence** — command output and review results bound to a specific SHA and environment.
6. **Decision/correction log** — append-only record explaining changes in interpretation.
7. **Historical handoffs and reports** — retained evidence, never treated as current merely because it is detailed.
8. **Conversation transcripts** — supporting context only, not repository authority.

A lower source never silently overrides a higher source. A discovered conflict is recorded as a correction and escalated when it could change scope, product behavior, or a gate result.

## 5. Components

### 5.1 Superpowers — process controller

Superpowers supplies the method used inside each stage:

- `brainstorming` for scope and design before implementation;
- `writing-plans` only after an approved written design;
- `using-git-worktrees` when implementation isolation is authorized;
- `test-driven-development` for implementation;
- `systematic-debugging` for unexpected behavior or failing tests;
- `requesting-code-review` and `receiving-code-review` for correction loops;
- `verification-before-completion` before any completion claim;
- `finishing-a-development-branch` only when the human has authorized the corresponding branch-ending operation.

Skills organize work; they do not grant authority. Repository and human constraints override any generic skill step that would merge, expand scope, edit forbidden files, rewrite evidence, or proceed through a human gate.

### 5.2 Second Brain — repository-local memory

The Second Brain is a small set of plain-text, version-controlled records, not a separate database or external service. Its proposed implementation consists of:

- **Current state:** one concise document containing the current branch/HEAD, active unit, last closed unit, open blockers, merge posture, next authorized action, and explicit prohibitions.
- **Decision and correction log:** append-only entries with date, status, decision owner, affected unit, rationale, and superseded statement where applicable.
- **Gate record format:** a stable template for SHA-bound measurements and verdicts. Gate runs may be recorded in the active unit document or another approved evidence location; the design does not require a new file per run.
- **Historical index:** links to existing handoffs, ADRs, review reports, and PR evidence without copying their claims into current state.

The current-state record is replaceable as state advances; the decision/correction log and historical evidence are append-only. Replacing current state must itself be an explicit documentation change tied to an approved transition.

The Second Brain must remain readable and maintainable without a particular AI vendor, editor, plugin, or network connection.

### 5.3 Security Gate — evidence and authority controller

The Security Gate is layered so that a success in one layer cannot be mistaken for overall approval:

1. **Live-state gate:** working directory, branch, local HEAD, parent, authoritative remote heads, ahead/behind, ancestry, tree state, and PR identity/state/head.
2. **Recovery gate:** load `AGENTS.md`, current state, applicable approved decisions, unit design, prior corrections, and open blockers.
3. **Scope gate:** exact security claim, allowed files, forbidden files/actions, stop conditions, and non-claims.
4. **Technical gate:** targeted checks, `pnpm check`, appropriate tests, and full regression suite when required by the unit.
5. **Static security measurement:** `pnpm audit:tenant`, reported with warnings, known gaps, scanner limitations, and exit status kept distinct.
6. **Security-evidence gate:** threat-specific assertions, positive controls, documentation controls, and previous-HEAD execution proof for load-bearing assertions.
7. **Independent review gate:** Codex re-derives the claim from the exact candidate HEAD in read-only mode.
8. **Human gate:** the human accepts or rejects scope, product decisions, commits, pushes, transition to the next unit, and merge.

No single layer can emit `MERGE GO`. The final merge posture is a separate human decision after all named program blockers and deploy preconditions are satisfied.

## 6. Canonical workflow

### 6.1 Recover

1. Run the live-state gate from current sources, not previous reports.
2. Load the source-of-truth hierarchy in order.
3. State the last closed unit, open blockers, next authorized action, and forbidden actions.
4. Stop if live state conflicts with the current-state record in a way that changes scope or invalidates evidence.

### 6.2 Design

1. Measure the current surface independently from HEAD.
2. Classify the work as spike, bounded, or architectural.
3. Record candidate claims, non-claims, risks, and stop conditions.
4. Present alternatives and a recommendation.
5. Obtain explicit human approval before any implementation action.

### 6.3 Plan

1. Convert the approved design into independently reviewable tasks.
2. Name exact files, test commands, evidence requirements, and commit boundaries.
3. Preserve a hard stop for any newly discovered file, schema/migration need, product semantic choice, or adjacent-unit coupling.
4. Obtain human approval for the plan or implementation prompt.

### 6.4 Implement

1. Use an isolated worktree when authorized and appropriate.
2. Execute one approved unit only.
3. Follow RED → GREEN → REFACTOR.
4. Maintain separate implementation and documentation commit boundaries.
5. Do not push, merge, broaden scope, or begin an adjacent unit without the corresponding human authorization.

### 6.5 Verify

1. Run every gate named by the approved unit.
2. Distinguish fresh output, inherited evidence, facts, inferences, and unverified live-state assumptions.
3. Execute load-bearing tests at the previous HEAD and candidate HEAD where required.
4. Confirm the final diff and repository state against the approved scope.
5. Submit the exact candidate HEAD to independent Codex read-only review.

### 6.6 Close

1. The human evaluates the implementation and independent verdict.
2. If approved, record the narrow canonical closure statement against the exact SHA.
3. Append corrections and evidence without changing historical material.
4. Update the concise current-state record in a documentation-only commit.
5. Keep the next unit blocked until its own design/approval cycle starts.
6. Keep PR #9 `NO-GO` unless a separate final merge-gate decision explicitly changes it.

## 7. Gate result vocabulary

Every formal result uses one of these labels:

- **PASS:** this individual gate met its declared criteria at the stated SHA.
- **FAIL:** this individual gate did not meet its criteria.
- **BLOCKED:** the gate could not be evaluated because required authority, environment, or evidence was unavailable.
- **GO:** a specifically named unit may advance through the specifically named transition.
- **NO-GO:** that transition is prohibited.
- **NOT EVALUATED:** no conclusion was attempted.

Every result must include the exact subject, SHA, scope, evaluator, evidence source, and non-claims. `PASS` for CI, tests, Vercel, or `audit:tenant` never implies security-unit `GO` or PR merge `GO`.

## 8. Failure and stop behavior

The workflow stops and returns to the human when:

- local, remote, and PR heads do not match the expected candidate;
- the working tree contains unexplained changes;
- an approved claim requires a new production file, migration, schema change, live-data operation, product decision, or adjacent-unit modification;
- a gate produces ambiguous or contradictory evidence;
- a load-bearing test cannot be shown to fail for the relevant reason at the previous HEAD;
- an auditor would need to edit the implementation it is meant to review;
- existing documentation disagrees about the current state and the hierarchy does not resolve it safely;
- any operation would rewrite historical PR evidence rather than append a correction.

Stopping does not convert the issue into permission to weaken the claim or bypass the gate.

## 9. Minimum reversible implementation sequence

This sequence is proposed but not authorized by this design document:

1. Add the minimal Second Brain records and templates in a documentation-only commit.
2. Reconcile the stale handoff through an explicit append-only correction; preserve its historical content.
3. Document the gate checklist and result vocabulary without changing CI, hooks, production code, or PR #9.
4. Dry-run the workflow against the already closed `G3a-1-F5a+c` checkpoint. The dry run must end with no repository mutation and must not start F5b.
5. Present dry-run findings and any proposed automation to the human.
6. Only after new approval, prepare a separate implementation plan for selected automation.

Each step is independently removable because the initial integration is plain documentation and does not change runtime behavior or repository enforcement.

## 10. Acceptance criteria for the future integration

The integrated workflow is acceptable only when:

- a fresh agent can identify the exact current state and next authorized action without reading conversation history;
- a stale historical statement cannot silently override the current-state record;
- every security verdict is bound to an exact SHA and narrow claim;
- skills cannot bypass human, scope, independent-review, or merge gates;
- `audit:tenant` output is reported honestly, including warnings and known scanner limitations;
- the dry run reproduces the `G3a-1-F5a+c` closure posture without modifying code, PR #9, or historical evidence;
- the repository is clean after the dry run;
- PR #9 remains `NO-GO` and F5b remains unstarted unless the human later issues separate explicit approvals.

## 11. Explicit non-goals

This design does not:

- start or design F5b;
- reopen G3a-1-F5a+c;
- change production code, tests, schema, migrations, configuration, CI, hooks, or environment files;
- edit the PR #9 body or comments;
- access Supabase or any live database;
- make `audit:tenant` a blocking CI check;
- install another memory service or vendor dependency;
- authorize a worktree, implementation, commit beyond this specification, push, merge, or historical rewrite;
- claim that CI, Vercel, tests, or the tenant audit make PR #9 mergeable from the security-program perspective.

## 12. Approval boundary

Approval of this document authorizes only its existence as a documentation-only specification commit. The next possible action is human review of the committed specification. Writing an implementation plan or creating any additional integration artifact requires a new explicit human approval.
