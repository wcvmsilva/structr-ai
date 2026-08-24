# Gate Record — <gate name>

This is a reusable blank template. Replace every placeholder from exact evidence; do not treat an unfilled template as a completed gate record.

- Subject: `<artifact or claim under review>`
- Candidate SHA: `<40-character SHA>`
- Baseline SHA (if applicable): `<40-character SHA | NOT APPLICABLE with reason>`
- Evaluator: `<name and role>`
- Environment: `<repository, worktree, toolchain, relevant live-state boundary>`
- Scope/claim: `<bounded claim>`
- Non-claims: `<what this gate does not prove or authorize>`
- Unit name: `<authorized unit>`
- Branch: `<local branch and remote branch, if published>`
- Working tree state: `<clean | exact intentional changes>`
- File set: `<exact files>`

## Authoritative Rules Checked

- Current human authorization: `<source and boundary>`
- `AGENTS.md`: `<SHA and applicable rules>`
- ADR/security authority: `<document, SHA, and applicable decision>`
- Workflow specification/plan: `<document, SHA, task, and gate>`
- Other exact-SHA evidence: `<source>`

## Evidence

- Command/check: `<primary command or review>`
- Result: `<PASS / FAIL / BLOCKED / NOT RUN, with exact output boundary>`

### Check / Test / Audit Results

| Command/check/test/audit | Exact target | Result | Evidence location |
|---|---|---|---|
| `<command or review>` | `<SHA/file/scope>` | `<PASS / FAIL / BLOCKED / NOT RUN>` | `<output or record>` |

## Previous-HEAD Proof

- Required: `<YES / NO>`
- Previous SHA: `<40-character SHA | NOT APPLICABLE>`
- Expected change-sensitive failure: `<specific expected failure>`
- Observed result: `<actual result and evidence>`
- Reason: `<why change-sensitive previous-HEAD proof applies or does not apply>`
- Candidate-HEAD contrast: `<proof that the candidate changes the expected result>`

## Findings

- BLOCKER: `<none | P1 finding, evidence, owner, required disposition>`
- REQUIRED: `<none | P2 finding, evidence, owner, required disposition>`
- NOTE: `<none | bounded observation>`

## Review Chain

- Internal Superpowers review: `<NOT REQUESTED / PENDING / PASS / FAIL; reviewer and evidence>`
- Independent Codex review: `<NOT REQUESTED / PENDING / GO / NO-GO / BLOCKED; exact SHA, claim, and evidence>`
- Human approval: `<NOT REQUESTED / PENDING / APPROVED / REJECTED; authority, timestamp, and authorized next action>`

## Program Gates

- PR merge gate: `<NO-GO / GO; authority and evidence>`
- Global claim status: `<NOT EVALUATED / NOT DEFENSIBLE / DEFENSIBLE; exact claim and evidence boundary>`
- Next authorized unit: `<none | exact unit and permitted action>`
- Explicit non-claims after verdict: `<remaining incomplete units, untested claims, and prohibited inferences>`

## Verdict

`PASS | FAIL | BLOCKED | GO | NO-GO | NOT EVALUATED`

- Verdict scope: `<exact unit, claim, and SHA>`
- Rationale: `<concise evidence-backed reason>`
- Remaining conditions: `<none | exact unmet conditions>`

CI, test, or audit `PASS` cannot be promoted to security-unit or merge `GO` without the named higher gates.
