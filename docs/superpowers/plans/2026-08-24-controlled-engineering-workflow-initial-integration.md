# Controlled Engineering Workflow Initial Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first reversible, documentation-only integration of the approved Controlled Engineering Workflow without changing production behavior, CI/hooks, PR #9, Supabase, or starting F5b.

**Architecture:** Reconcile repository operating instructions with verified current repository facts, then add a vendor-neutral repository-local Second Brain and Security Gate documentation layer. Historical security evidence remains append-only. After the documentation integration is complete, perform a no-mutation dry run against the already-closed `G3a-1-F5a+c` checkpoint. No automation or enforcement is introduced in this plan.

**Tech Stack:** Markdown documentation, Git/GitHub, existing Structr repository commands (`pnpm check`, `pnpm test`, `pnpm audit:tenant`), Superpowers process skills.

**Spec:** `docs/superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md`

## Global Constraints

- PR #9 remains `NO-GO` throughout this plan.
- F5b, G3a-2, G3a-3, G2, G3b, and G1 rule-F2/rule-F5 remediation remain out of scope.
- No production code, tests, schema, migrations, environment files, CI, hooks, package configuration, Supabase, live database, backfill, or `TENANT_STRICT` changes.
- Historical security evidence is append-only; corrections are added explicitly and prior evidence is not silently rewritten.
- Every security verdict remains bound to an exact SHA and narrow claim.
- Every security implementation commit and every push remain human-gated under the active PR #9 remediation protocol.
- Superpowers internal code review never replaces the independent Codex read-only gate.
- Execution of this plan must begin with the Superpowers worktree workflow and use isolated work by default unless the human explicitly declines or equivalent platform isolation is already active.
- This plan creates documentation only. It does not authorize automation/enforcement.
- Stop on any new product semantic choice, schema/migration requirement, production-file requirement, or conflict that cannot be resolved by the approved source-of-truth hierarchy.

---

## File Structure

**Modify:**
- `AGENTS.md` — reconcile only verified stale repository facts required by the approved spec.
- `docs/security-remediation-handoff.md` — append a correction/current-status addendum; preserve historical content.

**Create:**
- `docs/engineering/current-state.md` — concise SHA-bound operational state and next authorized action.
- `docs/engineering/decision-correction-log.md` — append-only decision/correction record.
- `docs/engineering/gate-record-template.md` — stable format for SHA-bound gate results.
- `docs/engineering/historical-index.md` — links to authoritative/historical documents without copying claims.
- `docs/engineering/security-gate.md` — layered Security Gate checklist and result vocabulary.

No other file is in scope for this plan.

---

### Task 1: Reconcile `AGENTS.md` With Verified Current Repository Truth

**Files:**
- Modify: `AGENTS.md`
- Read for evidence: `package.json`
- Read for evidence: `server/_core/trpc.ts`
- Read for evidence: `docs/superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md`

**Interfaces:**
- Consumes: current dependency declarations and exported tRPC procedure boundaries.
- Produces: repository operating instructions that no longer contradict those verified facts.

- [ ] **Step 1: Enter/verify isolated execution workspace**

Invoke `superpowers:using-git-worktrees` before any implementation action. Detect existing isolation first. Use/create an isolated worktree by default. If isolation cannot be established, STOP for human decision rather than silently working in place.

- [ ] **Step 2: Verify live repository facts before editing**

Run:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
grep -n 'mysql2\|MySQL\|PostgreSQL\|postgres' AGENTS.md package.json
grep -n 'protectedProcedure\|tenantProcedure\|adminTenantProcedure' AGENTS.md server/_core/trpc.ts
```

Expected evidence:
- `package.json` uses the `postgres` driver and does not use `mysql2` as the current DB driver.
- `server/_core/trpc.ts` exports `protectedProcedure`, `tenantProcedure`, and `adminTenantProcedure`.
- `AGENTS.md` contains stale MySQL/mysql2 wording and over-broad business-endpoint `protectedProcedure` wording.

If those facts do not hold at execution HEAD, STOP and return to human review.

- [ ] **Step 3: Make the minimal documentation reconciliation**

Edit only the verified stale statements in `AGENTS.md`:

1. Replace the MySQL/mysql2 stack/database description with the verified PostgreSQL/`postgres` driver description.
2. Replace the universal business-endpoint `protectedProcedure` instruction with a rule that distinguishes:
   - `protectedProcedure` for authenticated non-tenant-specific surfaces where approved;
   - `tenantProcedure` for tenant-owned business operations requiring a resolved tenant;
   - `adminTenantProcedure` for tenant-scoped administrative operations;
   - named pre-tenant/platform carve-outs remain explicit and must not be generalized.
3. Preserve existing F1-F6 rules, especially F2 and F5, unless a separate verified contradiction is discovered. Do not opportunistically rewrite unrelated rules.

- [ ] **Step 4: Verify reconciliation is bounded**

Run:

```bash
git diff -- AGENTS.md
git diff --check
```

Expected: only the verified stack/procedure-boundary documentation is changed; no unrelated operating rule is rewritten.

- [ ] **Step 5: Human review gate for `AGENTS.md` reconciliation**

STOP and present the exact `AGENTS.md` diff. Do not proceed to Task 2 until the human explicitly approves this reconciliation.

- [ ] **Step 6: Commit the approved documentation reconciliation**

After explicit approval:

```bash
git add AGENTS.md
git commit -m "docs: reconcile agent rules with current repository"
```

Do not push yet unless separately authorized.

---

### Task 2: Add the Minimal Repository-Local Second Brain

**Files:**
- Create: `docs/engineering/current-state.md`
- Create: `docs/engineering/decision-correction-log.md`
- Create: `docs/engineering/gate-record-template.md`
- Create: `docs/engineering/historical-index.md`

**Interfaces:**
- Consumes: live repository/GitHub state, approved spec, accepted ADR/security docs, historical handoff.
- Produces: vendor-neutral recovery records for future agents and humans.

- [ ] **Step 1: Create `docs/engineering/current-state.md`**

The file must contain exactly these operational sections:

```markdown
# Structr Engineering Current State

## Verified At
- Date/time:
- Evaluator:
- Repository:
- Branch:
- Local HEAD:
- Remote branch HEAD:
- origin/main:
- PR:
- PR state/head:
- Working tree:

## Program State
- Last closed unit:
- Active unit:
- PR merge posture:
- B2 global claim:

## Open Blockers
- ...

## Next Authorized Action
- ...

## Explicit Prohibitions
- ...

## Evidence Boundary
This document is replaceable current state, not historical proof. Historical evidence remains in the linked sources and exact SHA-bound gate records.
```

Populate values from fresh live state at execution time. Do not copy stale SHA/state from conversation history.

- [ ] **Step 2: Create `docs/engineering/decision-correction-log.md`**

Use this stable append-only entry format:

```markdown
# Structr Engineering Decision / Correction Log

Entries are append-only. Never rewrite a prior entry; supersede it explicitly.

## YYYY-MM-DD — <short title>
- Status: APPROVED DECISION | CORRECTION | OPEN ISSUE | DEFERRED
- Owner:
- Affected unit:
- Decision/correction:
- Rationale/evidence:
- Supersedes:
- Does not imply:
```

Add an initial correction entry explaining that the historical security handoff is retained as evidence but is no longer the current-state source because it predates G3a-1 closure.

- [ ] **Step 3: Create `docs/engineering/gate-record-template.md`**

Use this exact minimum structure:

```markdown
# Gate Record — <gate name>

- Subject:
- Candidate SHA:
- Baseline SHA (if applicable):
- Evaluator:
- Environment:
- Scope/claim:
- Non-claims:

## Evidence
- Command/check:
- Result:

## Previous-HEAD Proof
- Required: YES/NO
- Previous SHA:
- Expected change-sensitive failure:
- Observed result:

## Findings
- BLOCKER:
- REQUIRED:
- NOTE:

## Verdict
PASS | FAIL | BLOCKED | GO | NO-GO | NOT EVALUATED
```

Include a note that CI/test/audit `PASS` cannot be promoted to security-unit or merge `GO` without the named higher gates.

- [ ] **Step 4: Create `docs/engineering/historical-index.md`**

Link, without copying claims, to at least:

```text
AGENTS.md
docs/superpowers/specs/2026-08-24-controlled-engineering-workflow-design.md
docs/security-remediation-handoff.md
docs/adr/ADR-001-structr-data-ownership-model.md
docs/security/class-g-reclassification-and-remediation-plan.md
PR #9
```

Label each entry as CURRENT AUTHORITY, APPROVED ARCHITECTURE, or HISTORICAL EVIDENCE according to the approved hierarchy.

- [ ] **Step 5: Validate the Second Brain files**

Run:

```bash
grep -R "TBD\|TODO\|FIXME" docs/engineering || true
git diff --check
git status --short
```

Expected: no placeholders in the four new documents and no files outside approved scope.

- [ ] **Step 6: Commit Second Brain documentation separately**

After human approval of the four-file diff:

```bash
git add docs/engineering/current-state.md docs/engineering/decision-correction-log.md docs/engineering/gate-record-template.md docs/engineering/historical-index.md
git commit -m "docs: add Structr engineering second brain"
```

Do not push unless separately authorized.

---

### Task 3: Reconcile the Historical Security Handoff Append-Only

**Files:**
- Modify: `docs/security-remediation-handoff.md`
- Read: `docs/engineering/current-state.md`
- Read: `docs/engineering/decision-correction-log.md`

**Interfaces:**
- Consumes: newly established current-state record and the historical handoff.
- Produces: explicit correction without rewriting historical evidence.

- [ ] **Step 1: Confirm historical content will remain byte-preserved**

Capture the original file before editing:

```bash
cp docs/security-remediation-handoff.md /tmp/structr-security-remediation-handoff.before.md
```

- [ ] **Step 2: Append one correction block only**

Append a new final section with this semantic content:

```markdown
---

## Current-state correction — 2026-08-24

This handoff is retained as historical evidence and is no longer the canonical current-state source.

At the time of this correction:
- `G3a-1-F5a+c` is CLOSED after independent Codex GO at `b95ea0bf`.
- PR #9 remains NO-GO.
- F5b has not started.
- The canonical live operational state is maintained in `docs/engineering/current-state.md`.
- Approved architecture remains in the ADR/security documents linked by `docs/engineering/historical-index.md`.

No prior statement in this handoff is rewritten by this correction.
```

Use fresh verified state if any value differs at execution time. If the stated G3a-1 closure no longer matches repository-approved evidence, STOP.

- [ ] **Step 3: Prove append-only integrity**

Run a comparison that verifies the original file is an exact prefix of the new file. For example:

```bash
python - <<'PY'
from pathlib import Path
old = Path('/tmp/structr-security-remediation-handoff.before.md').read_bytes()
new = Path('docs/security-remediation-handoff.md').read_bytes()
assert new.startswith(old), 'historical handoff prefix changed'
print('append-only integrity: PASS')
PY
```

Expected: `append-only integrity: PASS`.

- [ ] **Step 4: Human review gate**

Present only the appended block and append-integrity result. Wait for explicit human approval.

- [ ] **Step 5: Commit the append-only correction separately**

```bash
git add docs/security-remediation-handoff.md
git commit -m "docs: mark security handoff as historical"
```

Do not push unless separately authorized.

---

### Task 4: Add the Security Gate Checklist and Vocabulary

**Files:**
- Create: `docs/engineering/security-gate.md`
- Read: `docs/engineering/gate-record-template.md`
- Read: `AGENTS.md`

**Interfaces:**
- Consumes: repository operating rules, approved workflow spec, gate-record format.
- Produces: one human-readable checklist for the layered security gate.

- [ ] **Step 1: Create the layered Security Gate document**

`docs/engineering/security-gate.md` must include these ordered layers:

1. Live-state gate
2. Recovery gate
3. Scope gate
4. Technical gate
5. Static security measurement (`pnpm audit:tenant`)
6. Security-evidence gate, including previous-HEAD execution proof for load-bearing assertions
7. Superpowers implementation-quality review gate
8. Independent Codex read-only gate at the exact candidate SHA
9. Human gate

For each layer, include:
- required inputs;
- minimum evidence;
- PASS/FAIL/BLOCKED criteria;
- explicit non-claims;
- STOP conditions.

- [ ] **Step 2: Record the canonical vocabulary**

Include definitions for:

```text
PASS
FAIL
BLOCKED
GO
NO-GO
NOT EVALUATED
```

State explicitly:

```text
No single lower gate can emit MERGE GO.
A green test suite is not tenant-isolation proof.
pnpm audit:tenant exit 0 is measurement, not merge proof.
Superpowers internal review cannot replace independent Codex review.
Only the human may authorize merge.
```

- [ ] **Step 3: Validate consistency**

Run:

```bash
grep -n "MERGE GO\|Codex\|Superpowers\|audit:tenant\|previous-HEAD\|human" docs/engineering/security-gate.md
git diff --check
```

Expected: all required distinctions are present.

- [ ] **Step 4: Human review gate**

Present the new Security Gate document diff. Wait for explicit human approval.

- [ ] **Step 5: Commit separately**

```bash
git add docs/engineering/security-gate.md
git commit -m "docs: define layered security gate"
```

Do not push unless separately authorized.

---

### Task 5: Validate Documentation Integration Before Dry Run

**Files:**
- Verify only; no new file is created by this task.

**Interfaces:**
- Consumes: Tasks 1-4 committed documentation.
- Produces: evidence that the integration is internally consistent and runtime-neutral.

- [ ] **Step 1: Confirm exact changed-file boundary from the plan baseline**

Expected changed files only:

```text
AGENTS.md
docs/engineering/current-state.md
docs/engineering/decision-correction-log.md
docs/engineering/gate-record-template.md
docs/engineering/historical-index.md
docs/engineering/security-gate.md
docs/security-remediation-handoff.md
```

Any production/test/config/CI/hook/schema/migration/env file in the diff is a STOP condition.

- [ ] **Step 2: Run documentation and repository validation**

Run:

```bash
git diff --check <PLAN_BASELINE_SHA>..HEAD
pnpm check
pnpm test
pnpm audit:tenant
```

Report the exact outputs. `audit:tenant` warnings and known gaps must be reported, not hidden behind exit status.

- [ ] **Step 3: Verify PR #9 and security branch remain untouched**

Verify authoritatively:

```bash
git ls-remote origin refs/heads/security/tenant-isolation-remediation-20260821 refs/heads/main
```

Also query PR #9 remote metadata and confirm it remains OPEN, unmerged, and `NO-GO` by the security program.

- [ ] **Step 4: Human approval gate before any push of the integration branch**

Present:
- commit list;
- exact changed-file set;
- validation output;
- security branch/main/PR #9 state.

Do not push without explicit human approval.

---

### Task 6: Perform the No-Mutation Dry Run Against Closed `G3a-1-F5a+c`

**Files:**
- Read only. No file changes are permitted in this task.

**Interfaces:**
- Consumes: approved documentation integration and the already-closed G3a-1-F5a+c evidence.
- Produces: a human-readable dry-run report only, with zero repository mutation.

- [ ] **Step 1: Start from clean state**

Verify:

```bash
git status --short
git rev-parse HEAD
```

Expected: clean tree.

- [ ] **Step 2: Recover exclusively from repository-local sources**

A fresh agent must read, in hierarchy order:

```text
AGENTS.md
docs/engineering/current-state.md
applicable approved ADR/security docs
approved G3a-1/F5a+c evidence and corrections
docs/engineering/decision-correction-log.md
docs/engineering/historical-index.md
```

Do not use conversation history as required state.

- [ ] **Step 3: Reconstruct the closed-unit posture**

The dry run must independently identify:

```text
G3a-1-F5a+c CLOSED
reviewed SHA: b95ea0bf4741646f418fcc99a22d22a42d24be51
independent Codex verdict: GO
PR #9 MERGE GATE: NO-GO
B2 GLOBAL CLAIM: NOT YET DEFENSIBLE
F5b: NOT STARTED
```

If repository-local records cannot recover those facts without conversation history, the dry run FAILS.

- [ ] **Step 4: Reconstruct the required gate sequence without executing mutations**

The fresh agent must identify:

```text
recover → design → human approval → writing-plans → human approval → worktree → TDD → internal review → verification → independent Codex review → human close/transition
```

It must also identify that Superpowers review cannot replace Codex and no lower gate can produce merge GO.

- [ ] **Step 5: Prove zero mutation**

At the end run:

```bash
git status --short
git rev-parse HEAD
```

Expected: same HEAD and clean tree as Step 1.

- [ ] **Step 6: Report dry-run result to human**

Return:
- recovered current state;
- recovered next authorized action;
- recovered prohibitions;
- source hierarchy used;
- gate sequence;
- any ambiguity/conflict;
- final `PASS`, `FAIL`, or `BLOCKED`;
- explicit confirmation of zero mutation.

STOP after the report.

Do not create an automation/enforcement plan yet.

---

## Plan Completion Gate

This plan is complete only when its document exists and has been human-reviewed. Execution is a separate authorization.

After approval, execution options are:

1. **Subagent-Driven (recommended):** use `superpowers:subagent-driven-development`, with a fresh subagent per task and review between tasks.
2. **Inline Execution:** use `superpowers:executing-plans`, with batch execution and checkpoints.

Regardless of execution mode, all human gates in this plan remain binding.