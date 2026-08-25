# Structr Agent Capability Roadmap

**Status:** Approved for future implementation  
**Decision date:** 2026-08-25  
**Scope:** Agent continuity and deterministic frontend quality  
**Current action:** Record the capabilities and their activation gates. Do not install third-party skills, packages, hooks, or CI gates in this phase.

## Architectural placement

These capabilities are subordinate to the approved architecture:

1. Canonical Structr Engineering Truth
2. Shared skills with one canonical implementation
3. Thin adapters for Codex, Claude, and other supported harnesses
4. Deterministic verification and evidence before completion

Neither capability may become a parallel source of project truth.

## Capability A — Structr Handoff

**Decision:** Build a Structr-owned shared skill instead of installing the generic `mattpocock/skills` handoff unchanged.

**Purpose:** Transfer an unfinished task between sessions or agent harnesses without requiring Wellington to reconstruct the context and without treating assumptions as verified facts.

### Boundary with canonical truth

- Canonical truth stores durable project facts, architecture, contracts, ADRs, and standing rules.
- A handoff stores only the live state of one unfinished task.
- The handoff references canonical artifacts by path and commit SHA; it does not copy or replace them.
- The handoff becomes obsolete when the task lands and must be closed or removed according to the final workflow contract.

### Required handoff contract

Every generated handoff must contain:

1. Repository and branch
2. Anchoring commit SHA and dirty-state summary
3. Task goal and explicit scope boundaries
4. Canonical sources read
5. Decisions made and the reasoning that remains load-bearing
6. Verified state, with the command or evidence that verified it
7. Unverified assumptions labeled `[UNVERIFIED]`
8. Files created, modified, and intentionally untouched
9. Tests and gates run, including exact results
10. Known failures, dead ends, risks, and blockers
11. Immediate next action and exact safe starting command
12. Suggested Structr shared skills for the receiving agent
13. Secret and personal-data redaction confirmation
14. Resume protocol that revalidates repository drift before any mutation

### Activation gate

Implementation begins only after:

- the Canonical Structr Engineering Truth location and schema are finalized;
- the canonical shared-skill directory and adapter contract are finalized;
- the lifecycle for active, completed, and abandoned handoffs is defined;
- persistence across Codex and Claude sessions is proven without relying only on OS temporary directories.

### Acceptance criteria

- The same fixture produces equivalent handoff structure from Codex and Claude.
- A receiving agent can resume a bounded task without asking Wellington to restate prior decisions.
- Every factual completion claim is tied to evidence.
- An anchor SHA mismatch forces revalidation before work continues.
- Secrets and personal identifiers never appear in the artifact.
- No handoff duplicates standing rules from `AGENTS.md`, ADRs, sprint specs, or canonical truth.

## Capability B — Frontend Quality Pilot

**Decision:** Defer installation of Impeccable. Evaluate it later in a pinned, audit-only pilot and reuse only the parts that pass Structr review.

**Purpose:** Add deterministic checks for visual consistency, accessibility, responsiveness, typography, layout, and common AI-generated frontend defects while preserving the Structr design system.

### Existing foundation

The Structr frontend already uses React, Tailwind CSS, shadcn/ui, CSS variables, and branded design tokens. A future quality layer must consume those existing sources instead of replacing them.

### Pilot sequence

1. Stabilize the security, RLS, canonical architecture, and prototype critical path.
2. Formalize the Structr product and design-system contract within the canonical documentation structure.
3. Review a pinned Impeccable release, license, installer, scripts, file writes, detector rules, and hook behavior.
4. Run the detector on a non-production branch in report-only mode.
5. Measure false positives, design-system conflicts, execution time, and usefulness of findings.
6. Compare three outcomes:
   - adopt the pinned detector;
   - wrap selected capabilities in a Structr-owned `structr-ui-quality` shared skill;
   - implement only the validated deterministic rules internally.
7. Enable an automatic hook or CI gate only after the pilot passes and a narrow ignore policy is approved.

### Guardrails

- No floating `npx` installation in the repository.
- No automatic visual rewrite.
- No hook or CI enforcement during the first pilot.
- No new `PRODUCT.md` or `DESIGN.md` may override canonical Structr documentation.
- Existing brand tokens, components, terminology, and functional behavior remain authoritative.
- Generated findings are evidence inputs, not automatic design decisions.

### Acceptance criteria

- The pilot runs against TSX/CSS and at least one rendered desktop and mobile surface.
- Findings are reproducible and identify exact files, elements, or rules.
- The tool does not overwrite the existing visual system.
- False positives and approved exceptions are documented.
- Any adopted dependency is version-pinned and passes security and supply-chain review.
- The final solution works through the same canonical skill with thin Codex and Claude adapters.

## Roadmap order

1. Finish Canonical Structr Engineering Truth.
2. Finalize the shared-skill schema and thin-adapter contract.
3. Implement and fixture-test `structr-handoff`.
4. Complete current security/RLS and prototype stabilization.
5. Formalize the frontend design-system contract.
6. Run the Impeccable audit-only pilot.
7. Decide whether to adopt, wrap, or replace its validated capabilities.
8. Consider a deterministic frontend CI gate only after successful pilot evidence.

## Non-goals in the current phase

- Installing Impeccable
- Installing the generic handoff skill
- Adding dependencies to `package.json`
- Enabling new hooks
- Modifying application runtime code
- Redesigning the frontend
- Creating a second source of architectural truth

## Implementation planning rule

Before either capability is implemented, create a bounded implementation plan with exact files, tests, verification commands, rollback procedure, and completion evidence. Implementation must follow `AGENTS.md`, the active sprint contract, and the then-current Canonical Structr Engineering Truth.
