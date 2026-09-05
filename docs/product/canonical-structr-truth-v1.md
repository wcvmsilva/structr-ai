# Canonical Structr Product & Engineering Truth v1

---

## 1. Authority and Document Status

### 1.1 What this document is

This document is the **canonical product and engineering truth for Structr v1**.

It governs:

- product identity and product boundary;
- domain semantics and domain ownership;
- target capability definitions;
- maturity vocabulary and classification dimensions;
- evidence rules and evidence boundaries;
- governance boundaries between human authority, agent assistance, and observable fact.

It is the single authoritative source for **what Structr is, what its domains mean, what its capability vocabulary means, and how claims about it may be made**.

### 1.2 What this document does not replace

This document does **not** replace, override, or absorb:

- **`AGENTS.md`** — repository execution rules. Repository operating rules remain governed there.
- **ADRs** — bounded architecture decisions. Each ADR remains authoritative for its own bounded decision.
- **Security gate records** — bounded security claims. A security claim is valid only within the exact unit, scope, and SHA its gate record establishes.
- **`current-state.md`** — replaceable operational state. It is a snapshot, not proof, and it is replaced when verified state changes.
- **Exact-SHA evidence records** — authoritative for the specific facts they record at the specific commit they record them at.

This document defines vocabulary and boundaries. Those documents supply bounded, evidenced claims expressed in that vocabulary.

> **FACTUAL CONFLICT — RECORDED, NOT RESOLVED**
>
> The documents named above are referenced here as approved architectural direction.
>
> Observable fact at this document's base SHA `5c29fd07535695566adc6bcb556b529ac94987ca`: only `AGENTS.md` exists on this branch. `docs/adr/`, `docs/engineering/`, `docs/security/`, `docs/security-remediation-handoff.md`, and `docs/superpowers/` **do not exist at this SHA**. They exist on the workflow lineage branch `workflow/controlled-engineering-workflow-task5` at `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`, which is a separate lineage.
>
> The approved direction is preserved as written. The factual divergence is recorded explicitly. Neither the direction nor the evidence is rewritten to remove the conflict.
>
> **This conflict is not in scope for the current delivery gate.** See Section 5.13 and OD-13.

### 1.3 Evidence and authority boundary

- **Observable repository facts remain evidence-bound.** A fact about the repository is established by reading the repository at an exact SHA, not by decision, assertion, or restatement.
- **Human decisions govern approved direction and gates.** Human authority sets product direction, scope, approvals, and gate verdicts.
- **Human authority does not silently redefine contradictory observable facts.** Where an approved direction and an observed fact conflict, both are recorded, the conflict is marked, and the resolution is an explicit decision — never an implicit overwrite.

### 1.4 Document status

This document is a **DRAFT**. See Section 8 for the full verification anchor.

It carries no implementation authorization, no security approval, no merge approval, and no production-readiness claim. See Section 7.

---

## 2. Product Identity and Initial Product Scope

### 2.1 Canonical identity

> **Structr is an intelligent construction operating system for residential general contractors and remodelers.**

### 2.2 Functional definition

> **Structr is an operational decision infrastructure that connects preconstruction, estimating, project delivery, cost control, closeout, and continuous learning through controlled, tenant-aware, evidence-backed workflows.**

### 2.3 Product boundary

- Estimating, scope generation, pricing, and preconstruction are **central product entry capabilities**. They are where users most often enter the product and where early value is most visible.
- **They do not define the product boundary.** Structr's boundary is the full operational lifecycle from opportunity through calibration, not the estimating surface alone.
- A capability is in scope when it participates in the controlled lifecycle defined in Section 3, is tenant-aware, and can carry evidence.

### 2.4 Brand terminology

"Construction Brain" is **secondary brand terminology only**. It is not a product definition, not an architectural concept, not a domain, and not a capability. It carries no semantics in this document or in any classification derived from it.

### 2.5 Target user hierarchy

**Primary user**

Owner-operator or operational leadership of a residential general contractor or remodeler responsible for converting leads into controlled and profitable projects.

**Core internal users**

- estimators and preconstruction teams;
- project managers;
- field leads;
- cost, margin, and closeout administrators;
- tenant administrators.

**Workflow participants, not necessarily primary users**

- subcontractors;
- suppliers;
- clients;
- designers;
- engineers;
- trade partners;
- external systems and integrations.

> No company-size restriction is part of the approved target-user definition. Firm size is not a product boundary.

### 2.6 Operational promise

Structr promises that:

- every consequential state transition is **controlled** — it happens through a defined transition, not by side effect;
- every consequential state is **tenant-aware** — tenant context is derived and preserved, never inferred from absence;
- every consequential claim is **evidence-backed** — it is traceable to what was recorded, when, and by whom;
- **incomplete information can be captured** without being silently promoted into an authorized state.

### 2.7 Ownership and project-scope rules

- **Every tenant-owned operation must derive and preserve a trusted tenant context.** The tenant context is established from trusted caller identity, carried through the operation, and preserved on the records it produces.
- **Project-scoped records must preserve `project_id` once a project exists.** The identifier is carried forward, not re-derived and not dropped.
- **Pre-project, platform, and reference data follow their separately approved ownership model.** They are not forced into tenant or project ownership, and **no artificial `project_id` value is created to satisfy a schema**.
- **Ownership is never inferred** from a nullable tenant field, an absent database read, an administrative role, a hard-coded constant, or a passing audit.
- Ambiguous ownership **fails closed**: the record remains unresolved and unusable for authorized operations until affirmatively classified.
- Project scope is bounded by the Current Authorized Scope Baseline (Section 3.4). Work outside it is not "in scope by proximity"; it enters through the controlled change model.

### 2.8 Approved product non-goals for v1

Only non-goals that follow directly from approved Sections 1–4 decisions are canonical. There are two.

1. **Structr v1 is not an estimating-only product.** The estimating, scope-generation, and pricing surfaces are entry capabilities and do not define the product boundary. Narrowing the product to those surfaces is out of scope. *(Follows from the approved product-boundary decision, Section 2.3.)*

2. **Structr is not an autonomous decision authority.** No agent or automated component decides, approves, authorizes, or overrides on a human's behalf. Agents inspect, analyze, identify conflicts, propose evidence, and propose classifications — nothing more. *(Follows from the approved authority model, Section 5.9.)*

> **No further product non-goals are canonical.**
>
> An earlier draft of this document asserted five additional non-goals — that Structr is not a general-purpose accounting/general-ledger system, not a payroll system, not a CAD/design-authoring tool, not a commercial/heavy-civil platform, and not a marketplace. **Those were introduced by the draft and were never approved human product decisions.** They have been removed from canonical truth and are recorded as an open product decision (OD-14). They are not replaced by any new product decision here.

### 2.9 Current repository capability — evidence-based inference

> **CLASSIFICATION: INFERENCE**
> **Evidence scope:** repository composition read at base SHA `5c29fd07535695566adc6bcb556b529ac94987ca` — file presence, root-router registration in `server/routers.ts`, client-side tRPC namespace references under `client/src`, module import graph, Zod schema reference counts, and test-file presence. **No execution, no test run, no behavioral verification, no live-state observation, no database or Supabase access.**
> **What this supports:** that named surfaces exist and are composed into the application graph.
> **What this does not support:** that they are correct, complete, tenant-safe, validated, or production-ready.

Observed at that SHA: 41 domain routers under `server/`, all 41 imported and mounted in the `appRouter` of `server/routers.ts`; 34 `-db` persistence modules; 20 domain engines under `shared/`; 25 client pages under `client/src/pages`; 52 test files under `server/`.

Two observations recorded here because they bear directly on open decisions and are not resolved by this document:

- **No dedicated change-order surface exists.** Change-order concepts are referenced inside `field-operations-db`, `actuals-db`, `estimate-version-db`, `closeout-db`, and the Drizzle schema, with no dedicated router. See OD-02.
- **No surface was observed for proposal issuance, commercial acceptance, commitments, forecast/EAC, or baseline management** as those concepts are defined in Section 3.

### 2.10 Future end-to-end direction

> **CLASSIFICATION: FUTURE DIRECTION**

The intended end state is a single controlled operating system in which an opportunity flows through qualification, formation, preconstruction, commercial authorization, delivery, controlled change, and closeout, and in which closeout outcomes feed calibration that measurably improves subsequent estimating — with baselines, authority, and evidence preserved at every transition.

This is direction, not a schedule, not a commitment, and not a claim about current capability.

### 2.11 Binding clarification

> **Connected in Repository does not imply Production Ready.**

The presence and composition of a module, route, engine, schema, or test in the repository establishes only that it is present and composed. It establishes nothing about operational validation, security posture, tenant safety, or release readiness. These are independent dimensions (Section 4.5) and separately supported claims (Section 5.11).

---

## 3. End-to-End Operating Model and Decision Flow

### 3.1 The controlled state graph

The canonical lifecycle has eight states:

1. **Opportunity and Qualification**
2. **Project Formation**
3. **Preconstruction**
4. **Commercial Authorization**
5. **Delivery**
6. **Controlled Change and Cost Capture**
7. **Closeout**
8. **Calibration and Learning**

> This is a **controlled state graph, not a strictly linear screen sequence.**

Consequences of that statement, binding:

- A state may be re-entered. Preconstruction may be re-entered from Delivery through the controlled change model.
- States may overlap in time. Delivery and Controlled Change coexist.
- Screen order, navigation order, and user journey are presentation concerns and never define lifecycle state.
- A transition is valid only when its own preconditions are satisfied. Proximity, ordering, or UI adjacency never authorizes a transition.

### 3.2 Binding authorization distinctions

> **Internal Estimate Approval ≠ Proposal Issuance ≠ Commercial Acceptance ≠ Execution Authorization**

| Concept | What it establishes | What it does not establish |
|---|---|---|
| **Internal Estimate Approval** | The tenant's internal authority accepts the estimate as fit to issue. | Nothing external. No client obligation. No authority to build. |
| **Proposal Issuance** | A proposal has been transmitted to the client. | No acceptance. No agreement. No authority to build. |
| **Commercial Acceptance** | The client has accepted the commercial terms. Recorded through Commercial Authorization, which produces the Accepted Commercial Package (Section 3.3). | Not by itself authority to execute work. |
| **Execution Authorization** | A separate gate that validates the Accepted Commercial Package and applicable readiness requirements, activates the Execution Baseline, and authorizes transition to Delivery (Section 3.3). | Not a financial settlement and not a scope expansion. |

Additional binding rules:

- **Proposal Issuance ≠ Commercial Acceptance.**
- **Commercial Acceptance ≠ Execution Authorization.**
- **Export ≠ Commercial Acceptance.**
- **Export does not authorize execution.**
- **An approved estimate does not authorize execution by itself.**
- Export is a transmission and formatting operation. It moves representation, never authority.
- No transition may be inferred from the completion of a prior one. Each is separately established and separately evidenced.

### 3.3 Baseline model

| Concept | Definition |
|---|---|
| **Original Scope Baseline** | The initially reviewed and approved scope version. Immutable after its authorization. |
| **Original Financial Baseline** | The initially approved estimate / financial version. Immutable after its authorization. |
| **Commercial Authorization** | The act of establishing commercial acceptance. **It produces an Accepted Commercial Package.** |
| **Accepted Commercial Package** | The package produced by Commercial Authorization. It **may reference**: the approved Scope Baseline; the approved Financial Baseline; the accepted proposal; the executed contract; the approved work authorization; applicable commercial terms and conditions; and evidence of acceptance. |
| **Execution Baseline** | The authorized package **activated by Execution Authorization**, referencing the Accepted Commercial Package together with the applicable readiness requirements. |
| **Approved Change Layer** | **One** immutable, separately traceable authorized addition, associated with **one** Approved Change Order. |
| **Current Authorized Scope Baseline** | Original Scope Baseline plus all applicable Approved Scope Change Layers. |
| **Current Authorized Financial Baseline** | Original Financial Baseline plus all applicable Approved Financial Change Layers. |
| **Current Authorized Baseline** | The combined authorized package referencing both authorized views. |
| **Forecast / Estimate at Completion** | A projection combining authorized baselines, actuals, commitments, and remaining work. Separate from every baseline above. |

> **An approved estimate is a required component of the Execution Baseline but does not authorize execution by itself.**

Binding structural rules:

- **`Approved Change Layer` is a single addition, not a collection.** Each Approved Change Order produces exactly one Approved Change Layer, which is immutable and separately traceable. The plural — "all applicable Approved Scope/Financial Change Layers" — is what a Current Authorized Baseline aggregates.
- **Commercial Authorization and Execution Authorization are separate gates.** Commercial Authorization produces the Accepted Commercial Package. **Execution Authorization is a separate gate** that:
  1. validates the Accepted Commercial Package;
  2. validates applicable readiness requirements;
  3. activates the Execution Baseline;
  4. authorizes transition to Delivery.
- **Holding an Accepted Commercial Package is not Execution Authorization.** The package is an input the Execution Authorization gate validates, never a substitute for passing it.

### 3.4 Binding baseline rules

> **Actuals, commitments, and forecast do not rewrite approved baselines.**

- The Original Scope Baseline and Original Financial Baseline are **immutable after their authorization**.
- Each Approved Change Layer is **immutable and separately traceable** once authorized.
- A Current Authorized Baseline changes **only** by the addition of a new Approved Change Layer. Existing layers are never edited.
- Actuals record what was spent. Commitments record what was obligated. Forecast records what is projected. **None of the three is an authorization**, and none mutates a baseline.
- A variance between actual and baseline is a **measurement**, never a correction to the baseline.
- Correcting an erroneous baseline requires an explicit, evidenced, authorized correction — never silent recomputation.

### 3.5 Lifecycle-based cost capture

Costs are classified by the lifecycle state in which they are incurred, not by their accounting category alone.

- **Pre-execution costs** — costs incurred before Execution Authorization (qualification, site visits, preconstruction investigation, estimating effort). They are real and must be capturable.
- **Delivery Actuals** — costs incurred against an Execution Baseline after Execution Authorization.

Binding rules:

- Pre-execution costs are **not** Delivery Actuals and must never be aggregated into Delivery Actuals reporting.
- Pre-execution costs do not consume an authorized baseline, because no Execution Baseline exists yet.
- The container that bears pre-execution cost when no approved cost-bearing container exists is an **open decision** (OD-03). Recording the cost with provenance is permitted; assigning it to a baseline is not.

### 3.6 Controlled change model

```
Change Request
  → Scope and Cost Review
    → Approval or Rejection
      → Approved Change Order
        → Controlled Execution Addition
          → Separate Actual-Cost Tracking
```

Binding rules:

- A **Change Request** is a proposal. It carries no authorization, alters no baseline, and authorizes no work.
- **Scope and Cost Review** establishes both scope effect and cost effect. Neither alone is sufficient.
- **Rejection** is a recorded, evidenced outcome — never a deletion of the request.
- Only an **Approved Change Order** produces an Approved Change Layer and thereby moves a Current Authorized Baseline.
- **Controlled Execution Addition** authorizes the added work explicitly. Approval of a change order is not by itself execution authorization for its work.
- Change-order actual cost is tracked **separately** and remains attributable to its own Approved Change Layer. It is never blended into original-scope actuals.

### 3.7 Incomplete-data principle

> **Capture incomplete information with provenance, but fail closed on promotion, approval, posting, export, execution authorization, baseline mutation, and closeout.**

- **Capture is permissive.** Partial, uncertain, or unverified information may be recorded, provided its incompleteness and provenance are recorded with it.
- **Promotion is restrictive.** Each of the following operations fails closed when required information is incomplete: promotion, approval, posting, export, execution authorization, baseline mutation, closeout.
- Failing closed means the operation is **refused with a stated reason**. It does not mean a default value, a silent substitution, or a best-effort partial result.
- Incompleteness is a first-class recorded property, never an absence to be guessed at.

### 3.8 Drafts versus immutable approved snapshots

- A **draft** is mutable working state. It carries no authority and may be revised freely.
- An **approved snapshot** is immutable. It captures exactly what was approved, at the moment of approval.
- Approval **creates a snapshot**; it never converts a mutable draft into an authority by relabeling it.
- Later revision produces a **new** draft and, on approval, a **new** snapshot. Prior snapshots remain intact and referenceable.
- No approved snapshot is ever edited in place.

### 3.9 Monitoring versus authoritative calibration

- **Monitoring** is continuous observation: variances, trends, indicators. It informs and never authorizes.
- **Authoritative calibration** is an explicit, evidenced, authorized adjustment to pricing or estimating assumptions.
- Monitoring signals **never** automatically adjust pricing, productivity assumptions, or estimating models.
- Calibration requires closed evidence, an explicit authority, and a recorded decision.

### 3.10 Closeout exception handling

Closeout **fails closed** on unresolved items. An unresolved item is not silently closed, defaulted, or dropped.

An exception must be either:

- **resolved** — completed and evidenced; or
- **explicitly deferred** — recorded with owner, reason, and disposition, and carried forward as an open item.

A project with explicitly deferred exceptions may close only with those deferrals recorded as such. Closeout never erases an open obligation.

### 3.11 Lineage and provenance rules

Every consequential record carries:

- **origin** — where the information came from (user entry, document extraction, import, calculation, external system);
- **derivation** — what it was derived from, when derived;
- **authority** — who or what established it, and under which decision;
- **time** — when it was recorded and when it was verified;
- **completeness** — what is known to be missing or uncertain.

Binding rules:

- Provenance is **preserved across transformation**. A derived value carries its lineage forward.
- Provenance is **never reconstructed by inference** after the fact.
- A record whose provenance is unknown is treated as unverified, not as verified-by-default.

---

## 4. Capability Model, Domain Boundaries, and Maturity Registry

### 4.1 Operational Domains

1. **Opportunity Management**
2. **Client and Project Formation**
3. **Preconstruction and Evidence**
4. **Scope, Pricing, Estimating, and Commercial Authorization**
5. **Project Delivery**
6. **Controlled Change, Commitments, Cost, and Forecasting**
7. **Closeout and Handover**
8. **Analytics, Calibration, and Learning**

### 4.2 Platform Domain

9. **Platform Foundations**

> **Platform Foundations is not an operational lifecycle domain.**

It does not appear in the lifecycle state graph of Section 3.1. It has no lifecycle state, no baseline, and no commercial authority. It supplies the substrate — identity, tenancy, authorization, auditability, configuration, data access — that operational domains consume.

### 4.3 Capability classes and ownership

`capability_class` has exactly two values:

- **Operational**
- **Cross-Cutting Platform**

Binding ownership rules:

- **Every capability has exactly one `primary_domain`.** No exceptions, no shared ownership, no co-ownership.
- **Cross-Cutting Platform** capabilities use `primary_domain: Platform Foundations`.
- A capability may declare `consuming_domains` — the operational domains that depend on it.
- **`consuming_domains` never duplicates ownership.** A consuming domain is a dependent, not an owner.

### 4.4 Canonical capability registry

This registry is **logical and lives inside this document**. No separate registry file is created.

It is presented as **two keyed views over one logical registry**, joined on `capability_id`:

- **View A — Capability Evidence View** (4.4.3, 4.4.4): what is observably present and composed, plus the connection-layer evidence supporting it.
- **View B — Capability Governance and Target View** (4.4.5, 4.4.6): class, ownership, target, and governance classification.

Every capability appears in both views under the same `capability_id`. Splitting the presentation does not split the registry.

#### 4.4.1 Registry field definitions

| Field | Meaning | View |
|---|---|---|
| `capability_id` | Stable identifier joining the two views. | A and B |
| `canonical_name` | The capability's canonical name in this document. | A and B |
| `capability_class` | `Operational` or `Cross-Cutting Platform`. | B |
| `primary_domain` | The single owning domain. | B |
| `consuming_domains` | Dependent domains. Never ownership. | B |
| `target_product_capability` | What the capability is intended to be, expressed only in approved Section 3 / Section 4 semantics. | B |
| `current_repository_capability` | What is observably present and composed in the repository. | A |
| `implementation_status` | See 4.5 and the connection-evidence rule in 4.4.2. | A |
| `operational_validation` | See 4.5. | B |
| `security_status` | See 4.5 and the evidence-mapping rule in 4.4.7. | B |
| `evidence_confidence` | See 4.5. | B |
| `verification_state` | See 4.6. | B |
| `lifecycle_state` | See 4.7. Represented as `UNASSIGNED — INSUFFICIENT EVIDENCE` where no evidence or approved decision supports a value. | B |
| `roadmap_horizon` | See 4.8. Represented as `UNASSIGNED — OD-12` where no product decision has been taken. | B |
| `open_decisions` | See 4.9. | B |
| `relationships` | `depends_on`, `blocked_by`, `supersedes` only. See 4.10. | B |

> **Binding separation:** `target_product_capability` and `current_repository_capability` are **separate fields and are never merged**. Target is direction. Current is evidence.

#### 4.4.2 Connection-evidence rule for `Connected in Repository`

> **Binding rule: file presence and path naming are never sufficient to classify a capability as `Connected in Repository`. Connectivity is never inferred from naming.**

Every capability proposed for `Connected in Repository` is evaluated across seven connection layers. Each applicable layer is classified **PRESENT**, **ABSENT**, or **NOT APPLICABLE**. Every `NOT APPLICABLE` carries a rationale.

| Layer | Name | What counts as PRESENT at this evidence scope |
|---|---|---|
| **L1** | User or system entry point | A client page or system caller references the capability's namespace, observed in `client/src`. |
| **L2** | Interface, API, or router | A router module exists **and** is imported and mounted in the `appRouter` of `server/routers.ts`. |
| **L3** | Domain logic or engine | A dedicated engine module exists under `shared/`. |
| **L4** | Persistence or stateless execution boundary | A dedicated `-db` module, or an observed import of `server/db.ts` plus a Drizzle schema table, or an observed derivation-only boundary. |
| **L5** | Downstream consumer | A module other than the capability's own router imports it, or a client page consumes it. |
| **L6** | Deterministic validation | Zod schema references observed in the router module. |
| **L7** | Integration into an approved operational flow | A repository artifact maps the capability to the canonical lifecycle of Section 3.1. |

**Classification rule applied:**

- **`Connected in Repository`** — L2, L4, L5 and L6 each PRESENT or NOT APPLICABLE, **and** L1 PRESENT or NOT APPLICABLE with rationale.
- **`Implemented`** — L2 and L6 PRESENT, but L1 or L5 ABSENT. The capability is built and wired at the API level without an observed consumer or entry point.
- **`Missing`** — no surface observed for the capability as defined in Section 3.
- **`INSUFFICIENT EVIDENCE TO CLASSIFY`** — a surface exists but its correspondence to the canonical definition cannot be established from authorized read-only evidence.

**A UI is not required** for legitimate server-side or cross-cutting capabilities. For those, L1 is NOT APPLICABLE with a stated rationale. For user-facing operational capabilities, an absent entry point is recorded as **ABSENT**, not excused as NOT APPLICABLE.

> **L7 is ABSENT for every capability in this registry, uniformly and for a structural reason:** the canonical lifecycle of Section 3.1 is defined by this document and did not exist before it. No repository artifact at the base SHA maps any capability to it. The repository's own `docs/phase2-contract.md`, `phase3-contract.md`, and `phase4-contract.md` describe pre-canonical delivery phases whose correspondence to Section 3.1 is **not verified**.
>
> **Binding interpretation used here:** `Connected in Repository` means *connected within the repository's own composition graph*. It does **not** mean conformant to the canonical Section 3.1 flow, and no row may be read as claiming such conformance. Whether L7 should become a requirement for `Connected in Repository` is recorded as OD-15 and is not decided here.

#### 4.4.3 View A — Capability Evidence View: Operational capabilities

Layer columns use **P** = PRESENT, **A** = ABSENT, **N/A** = NOT APPLICABLE. L7 is ABSENT for all rows per 4.4.2 and is omitted.

| capability_id | canonical_name | current_repository_capability (at base SHA) | L1 | L2 | L3 | L4 | L5 | L6 | implementation_status |
|---|---|---|---|---|---|---|---|---|---|
| C-01 | Lead capture and qualification | `lead-router` mounted; `lead-db`; `shared/lead-engine`; client `leads` | P | P | P | P | P | P | Connected in Repository |
| C-02 | Deal and pipeline management | `deal-router`, `pipeline-router` mounted; `deal-db`, `pipeline-db`; `shared/deal-engine`; client `deal`, `pipeline` | P | P | P | P | P | P | Connected in Repository |
| C-03 | Intake forms | `intake-router` mounted; `intake-db`; client `intake` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-04 | Pre-visit briefing and field checklist | `previsit-router` mounted; `previsit-db`; `shared/previsit-engine`; consumed by `scope-to-estimate-pipeline` | A | P | P | P | P | P | Implemented |
| C-05 | Service-area / geo qualification | `geo-router` mounted; `geo-db`; `shared/geo-engine`; consumed by `geo-integration`, `seed` | A | P | P | P | P | P | Implemented |
| C-06 | Client formation | `client-router` mounted; `client-db`; client `clients` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-07 | Project formation | `project-router` mounted; `project-db`, `project-access`; client `project` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-08 | Drawing intake and review | `drawing-router` mounted; `drawing-db`; client `drawing` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-09 | Scope source capture | `scope-source-router` mounted; `scope-source-db`; client `scopeSource` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-10 | Scope generation | `scope-generation-router` mounted; delegates to `scope-db`, `project-db`, `intake-db`; `shared/scope-engine`; client `scopeGeneration` | P | P | P | P² | P | P | Connected in Repository |
| C-11 | Scope review | `scope-review-router` mounted; `scope-review-db`; client `scopeReview` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-12 | Scope completeness assessment | `scope-completeness-router` mounted; `scope-completeness-db`; `shared/scope-completeness-engine` | A | P | P | P | A | P | Implemented |
| C-13 | Scope model and structure | `scope-router` mounted; `scope-db`; `shared/scope-engine`; client `scope` | P | P | P | P | P | P | Connected in Repository |
| C-14 | Estimating | `estimate-router`, `estimate-legacy-router` mounted; `estimate-db`, `estimate-version-db`; `shared/estimate-engine`; client `estimate` | P | P | P | P | P | P | Connected in Repository |
| C-15 | Pricing engine and price book | `pricing-router` mounted; `pricing-db`; `shared/pricing-engine`; consumed by `pricing-dimensions` | A | P | P | P | P | P | Implemented |
| C-16 | Catalog and assembly library | `catalog-router`, `assembly-router` mounted; `assembly-db`; `shared/assembly-engine`; client `catalog`, `assembly` | P | P | P | P | P | P | Connected in Repository |
| C-17 | Bundles and presets | `bundle-router`, `preset-router` mounted; `server/db.ts` + `bundleItems` schema; client `bundle`, `preset` | P | P | N/A¹ | P³ | P | P | Connected in Repository |
| C-18 | Price adjustment and margin control | `price-adjustment-router` mounted; `price-adjustment-db`; `shared/price-adjustment-engine`, `shared/profit-shield-engine`; consumed by `analytics-db` | A | P | P | P | P | P | Implemented |
| C-19 | Remodel modeling | `remodel-router` mounted; `remodel-db`; `shared/remodel-engine`; consumed by `workflow-visualization-router`, `seed` | A | P | P | P | P | P | Implemented |
| C-20 | Proposal issuance | No surface observed | A | A | A | A | A | A | Missing |
| C-21 | Commercial acceptance recording | No surface observed | A | A | A | A | A | A | Missing |
| C-22 | Execution Authorization *(as defined in §3.2)* | Correspondence to the canonical definition not establishable⁴ | — | — | — | — | — | — | INSUFFICIENT EVIDENCE TO CLASSIFY |
| C-23 | Field launch control | `field-launch-router` mounted; `field-launch-db`; client `fieldLaunch` (12 references) | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-24 | Field operations | `field-operations-router` mounted; `field-operations-db`; `shared/field-operations-engine`; consumed by `actuals-db`, `calibration-db`, `closeout-db`, `estimate-db`, `scope-completeness-db` | A | P | P | P | P | P | Implemented |
| C-25 | Daily logs | `daily-logs-router` mounted; `daily-log-db` | A | P | N/A¹ | P | A | P | Implemented |
| C-26 | RFI management | `rfi-router` mounted; `rfi-db`; client `rfi` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-27 | Issue reporting | `issue-report-router` mounted; `server/db.ts` + `systemIssueReports` schema; client `issueReport` | P | P | N/A¹ | P³ | P | P | Connected in Repository |
| C-28 | Subcontractor management | `subcontractors-router` mounted; `subcontractor-db`; `shared/subcontractor-performance-engine` | A | P | P | P | A | P | Implemented |
| C-29 | Change Request and Change Order *(as defined in §3.6)* | Concepts distributed across `field-operations-db`, `actuals-db`, `estimate-version-db`, `closeout-db`, Drizzle schema; no dedicated surface⁵ | — | — | — | — | — | — | INSUFFICIENT EVIDENCE TO CLASSIFY |
| C-30 | Actual cost capture | `actuals-router` mounted; `actuals-db`; `shared/actuals-variance-engine`; consumed by `calibration-db`, `closeout-db`, `scope-completeness-db` | A | P | P | P | P | P | Implemented |
| C-31 | Commitments and purchase obligations | No surface observed | A | A | A | A | A | A | Missing |
| C-32 | Forecast / Estimate at Completion | No surface observed | A | A | A | A | A | A | Missing |
| C-33 | Baseline management *(as defined in §3.3)* | No surface observed | A | A | A | A | A | A | Missing |
| C-34 | Closeout and handover | `closeout-router` mounted; `closeout-db`; `shared/closeout-engine`; consumed by `calibration-db`, `scope-completeness-db` | A | P | P | P | P | P | Implemented |
| C-35 | Analytics | `analytics-router` mounted; `analytics-db`; `shared/analytics-aggregation-engine` | A | P | P | P | N/A⁶ | P | Implemented |
| C-36 | Calibration | `calibration-router` mounted; `calibration-db`; `shared/calibration-engine`; consumed by `analytics-db`, `price-adjustment-db` | A | P | P | P | P | P | Implemented |
| C-37 | Learning layer | `learning-layer-router` mounted; `learning-layer-db`; client `learning` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-38 | Workflow visualization | `workflow-visualization-router` mounted; derives from `scope-db`, `project-db`, `geo-override-db`, `remodel-db`, `assembly-db`; client `workflowViz` | P | P | N/A¹ | N/A⁷ | P | P | Connected in Repository |

**Layer rationales**

1. **N/A (L3)** — record-management or presentation capability; no dedicated domain engine is expected by the architecture. Absence of an engine is not a gap.
2. **P (L4, C-10)** — no dedicated `scope-generation-db`; the router imports `scope-db`, `project-db`, and `intake-db`. The persistence boundary is observed, delegated.
3. **P (L4, C-17 and C-27)** — no dedicated `-db` module; the router imports `server/db.ts` and named Drizzle schema tables (`bundleItems`, `systemIssueReports`) directly. Persistence boundary observed.
4. **C-22** — `field-launch-router`, `field-launch-db` and 12 client references exist and are classified separately as C-23. Whether that surface implements *Execution Authorization* as defined in Section 3.2 **cannot be established** from repository composition alone. Classifying it either way would be inference from naming, which 4.4.2 forbids.
5. **C-29** — whether the distributed representation implements the Section 3.6 model **cannot be established** from composition alone. See OD-02.
6. **N/A (L5, C-35)** — analytics is a terminal read surface; a downstream consumer is not architecturally expected.
7. **N/A (L4, C-38)** — visualization derives from other domains' persistence; it holds no state of its own.

#### 4.4.4 View A — Capability Evidence View: Cross-Cutting Platform capabilities

| capability_id | canonical_name | current_repository_capability (at base SHA) | L1 | L2 | L3 | L4 | L5 | L6 | implementation_status |
|---|---|---|---|---|---|---|---|---|---|
| P-01 | Identity and authentication | `auth-router` mounted with 3 zero-input procedures (`me`, `session`, `logout`); `identity-db`; consumed by `_core/auth`, `_core/oauth`, `_core/sdk`, `db`; client `auth` | P | P | N/A¹ | P | P | N/A⁸ | Connected in Repository |
| P-02 | Authorization and RBAC | `rbac-router` mounted; `server/rbac.ts`; consumed by `auth-router`, `project-access`, `routers.ts` | N/A⁹ | P | N/A¹ | N/A | P | P | Connected in Repository |
| P-03 | Tenancy and tenant scoping | `server/tenant-scope.ts`, `tenant-coverage-audit.ts`, `shared/tenant-provisioning-engine`; consumed by `_core/auth/supabase-auth` and 11+ domain modules | N/A⁹ | N/A¹⁰ | P | N/A | P | N/A | Connected in Repository |
| P-04 | Tenant settings and configuration | `tenant-settings-router` mounted; `tenant-settings-db`; consumed by `analytics-db`, `calibration-db`, `price-adjustment-db` | A | P | N/A¹ | P | P | P | Implemented |
| P-05 | Audit and audit trail | `audit-router`, `audit-trail-router` mounted; `server/audit-trail.ts`; consumed by `analytics-db`, `calibration-db`, `price-adjustment-db`, `scope-completeness-db`, `tenant-settings-db` | A | P | N/A¹ | P | P | P | Implemented |
| P-06 | Data access layer | `server/db.ts`; `drizzle/` schema, relations, migrations; consumed repository-wide | N/A⁹ | N/A¹⁰ | N/A¹ | P | P | N/A | Connected in Repository |
| P-07 | Platform reference data (geo override) | `geo-override-router` mounted; `geo-override-db`; `shared/geo-override-engine`, `shared/geo-override-seed`; client `geoOverride`; consumed by `workflow-visualization-router` | P | P | P | P | P | P | Connected in Repository |
| P-08 | Draft recovery | `draft-recovery-db`; consumed by `estimate-router` | N/A⁹ | N/A¹⁰ | N/A¹ | P | P | N/A | Connected in Repository |
| P-09 | Evidence and provenance substrate | No surface observed | A | A | A | A | A | A | Missing |
| P-10 | Export and transmission | `jobtread-export-db`; consumed by `estimate-router`, `tenant-coverage-audit` | N/A⁹ | N/A¹⁰ | N/A¹ | P | P | N/A | Connected in Repository |

**Layer rationales**

1. **N/A (L3)** — as in 4.4.3: no dedicated domain engine is expected for this capability class.
8. **N/A (L6, P-01) — evidence-based architectural rationale.** `auth-router.ts` at the base SHA exposes exactly three procedures — `me`, `session`, `logout` — and **all three accept no input**: the file contains zero `.input(` calls, against 12 in `lead-router`, 30 in `estimate-router`, 9 in `project-router`, and 3 in `rbac-router`. Deterministic input validation is therefore **not applicable to this surface, because it has no input surface to validate**. The absent Zod reference count is the correct consequence of a zero-input router, not a validation gap. An earlier revision recorded this layer as ABSENT on the Zod count alone; that reading is superseded by direct inspection of the module. The general `Connected in Repository` rule in 4.4.2 is unchanged and was not relaxed — this row satisfies it through the rule's existing NOT APPLICABLE branch, on stated architectural evidence.
   > **Bounded to this layer.** This rationale establishes only that L6 does not apply to `auth-router`'s three procedures. It makes **no** claim about authentication correctness, session handling, token validation, or any check performed in the `_core/auth` layer, which was not inspected.
9. **N/A (L1)** — cross-cutting platform capability consumed by server-side code; no dedicated user entry point is expected by the architecture.
10. **N/A (L2)** — the capability is a library or persistence module consumed directly by other server modules, not exposed as its own router. This is architecturally intentional for a cross-cutting concern.

#### 4.4.5 View B — Capability Governance and Target View: Operational capabilities

All rows: `capability_class: Operational`. `verification_state` is `CURRENT` for every row, anchored to base SHA `5c29fd07535695566adc6bcb556b529ac94987ca`. `roadmap_horizon` is `UNASSIGNED — OD-12` for every row.

| capability_id | canonical_name | primary_domain | target_product_capability | operational_validation | security_status | evidence_confidence | lifecycle_state |
|---|---|---|---|---|---|---|---|
| C-01 | Lead capture and qualification | Opportunity Management | Opportunity and Qualification state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-02 | Deal and pipeline management | Opportunity Management | Opportunity and Qualification state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-03 | Intake forms | Opportunity Management | Incomplete-data capture with provenance, §3.7 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-04 | Pre-visit briefing and field checklist | Preconstruction and Evidence | Preconstruction state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-05 | Service-area / geo qualification | Opportunity Management | Opportunity and Qualification state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-06 | Client formation | Client and Project Formation | Project Formation state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-07 | Project formation | Client and Project Formation | Project Formation state of §3.1; `project_id` preservation per §2.7 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-08 | Drawing intake and review | Preconstruction and Evidence | Preconstruction and Evidence domain, §4.1; provenance per §3.11 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-09 | Scope source capture | Preconstruction and Evidence | Preconstruction and Evidence domain, §4.1; provenance per §3.11 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-10 | Scope generation | Preconstruction and Evidence | Preconstruction state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-11 | Scope review | Preconstruction and Evidence | Draft-to-approved-snapshot control, §3.8 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-12 | Scope completeness assessment | Preconstruction and Evidence | Fail-closed promotion on incomplete data, §3.7 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-13 | Scope model and structure | Scope, Pricing, Estimating, and Commercial Authorization | Original Scope Baseline, §3.3 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-14 | Estimating | Scope, Pricing, Estimating, and Commercial Authorization | Original Financial Baseline, §3.3; Internal Estimate Approval, §3.2 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-15 | Pricing engine and price book | Scope, Pricing, Estimating, and Commercial Authorization | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-16 | Catalog and assembly library | Scope, Pricing, Estimating, and Commercial Authorization | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-17 | Bundles and presets | Scope, Pricing, Estimating, and Commercial Authorization | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-18 | Price adjustment and margin control | Scope, Pricing, Estimating, and Commercial Authorization | Authoritative calibration applied to pricing, §3.9 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-19 | Remodel modeling | Scope, Pricing, Estimating, and Commercial Authorization | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-20 | Proposal issuance | Scope, Pricing, Estimating, and Commercial Authorization | Proposal Issuance, §3.2 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-21 | Commercial acceptance recording | Scope, Pricing, Estimating, and Commercial Authorization | Commercial Acceptance, §3.2; Commercial Authorization, §3.3 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-22 | Execution Authorization | Project Delivery | Execution Authorization, §3.2, against an Execution Baseline, §3.3 | Not Validated | Not Evaluated | Low | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-23 | Field launch control | Project Delivery | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-24 | Field operations | Project Delivery | Delivery state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-25 | Daily logs | Project Delivery | Delivery state of §3.1; provenance per §3.11 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-26 | RFI management | Project Delivery | Delivery state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-27 | Issue reporting | Project Delivery | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-28 | Subcontractor management | Project Delivery | Delivery state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-29 | Change Request and Change Order | Controlled Change, Commitments, Cost, and Forecasting | The controlled change model of §3.6, producing Approved Change Layers per §3.3 | Not Validated | Not Evaluated | Low | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-30 | Actual cost capture | Controlled Change, Commitments, Cost, and Forecasting | Delivery Actuals, §3.5; separate change-order actual tracking, §3.6 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-31 | Commitments and purchase obligations | Controlled Change, Commitments, Cost, and Forecasting | Commitments as used in §3.3 and §3.4 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-32 | Forecast / Estimate at Completion | Controlled Change, Commitments, Cost, and Forecasting | Forecast / Estimate at Completion, §3.3 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-33 | Baseline management | Controlled Change, Commitments, Cost, and Forecasting | The full baseline model of §3.3 and its binding rules in §3.4 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-34 | Closeout and handover | Closeout and Handover | Closeout state of §3.1; fail-closed exception handling, §3.10 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-35 | Analytics | Analytics, Calibration, and Learning | Monitoring as defined in §3.9 — informs, never authorizes | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-36 | Calibration | Analytics, Calibration, and Learning | Authoritative calibration, §3.9; Calibration and Learning state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-37 | Learning layer | Analytics, Calibration, and Learning | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | **Transitional**¹¹ |
| C-38 | Workflow visualization | Analytics, Calibration, and Learning | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |

11. **C-37 `Transitional` — the only evidenced lifecycle_state in this registry.** Source: `server/routers.ts` at `5c29fd07535695566adc6bcb556b529ac94987ca`, which states that `calibration` and `priceAdjustment` "supersede the Sprint 22 `learning` namespace above, which stays mounted for backward compatibility. New work targets these." A capability explicitly superseded yet deliberately kept mounted is `Transitional` under §4.7. This yields the evidenced relationships in §4.10.

#### 4.4.6 View B — Capability Governance and Target View: Cross-Cutting Platform capabilities

All rows: `capability_class: Cross-Cutting Platform`, `primary_domain: Platform Foundations`. `verification_state` is `CURRENT` for every row, anchored to base SHA `5c29fd07535695566adc6bcb556b529ac94987ca`. `roadmap_horizon` is `UNASSIGNED — OD-12` for every row.

| capability_id | canonical_name | consuming_domains | target_product_capability | operational_validation | security_status | evidence_confidence | lifecycle_state |
|---|---|---|---|---|---|---|---|
| P-01 | Identity and authentication | All operational domains | Trusted caller identity from which tenant context is derived, §2.7 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-02 | Authorization and RBAC | All operational domains | Controlled transitions and fail-closed authorization, §3.1 and §3.7 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-03 | Tenancy and tenant scoping | All operational domains | Derivation and preservation of trusted tenant context, §2.7 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-04 | Tenant settings and configuration | All operational domains | NOT SEPARATELY APPROVED beyond the Platform Foundations definition in §4.2 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-05 | Audit and audit trail | All operational domains | Evidence-backed traceability of consequential state, §2.6 and §3.11 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-06 | Data access layer | All operational domains | NOT SEPARATELY APPROVED beyond the Platform Foundations definition in §4.2 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-07 | Platform reference data (geo override) | Opportunity Management; Analytics, Calibration, and Learning | Platform and reference data under its separately approved ownership model, §2.7 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-08 | Draft recovery | Scope, Pricing, Estimating, and Commercial Authorization | Protection of mutable draft state, §3.8 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-09 | Evidence and provenance substrate | All operational domains | The lineage and provenance rules of §3.11 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| P-10 | Export and transmission | Scope, Pricing, Estimating, and Commercial Authorization; Closeout and Handover | Export as transmission only — moves representation, never authority, §3.2 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |

#### 4.4.7 Security-status evidence rule and mapping

> **Binding rule: a security status above `Not Evaluated` requires an exact bounded evidence mapping — source artifact, source SHA, bounded unit/claim, scope, why the bounded claim applies to this capability, and explicit non-claims. A security-program record existing on another lineage is never sufficient.**

**Every capability in this registry is classified `Not Evaluated`.** The reason is evidenced, not conservative default:

- **VERIFIED FACT.** The security program's remediation artifacts are **absent from the tree at this document's base SHA**. Checked by `git cat-file -e` at `5c29fd07535695566adc6bcb556b529ac94987ca`: `server/lead-access.ts` ABSENT, `server/tenant-b2-fail-closed.test.ts` ABSENT, `server/tenant-b2-bundles.test.ts` ABSENT, `server/tenant-b2-subcontractors.test.ts` ABSENT, `server/tenant-g3a-geo-zones.test.ts` ABSENT.
- **VERIFIED FACT.** `origin/security/tenant-isolation-remediation-20260821` at `b95ea0bf4741646f418fcc99a22d22a42d24be51` is **not an ancestor** of `origin/main` at `5c29fd07535695566adc6bcb556b529ac94987ca` (`git merge-base --is-ancestor`, exit code 1).
- **INFERENCE, stated with its limits.** Every bounded security verdict in the program — including `G3a-1-F5a+c` — is anchored to a SHA on the security/workflow lineage. The code those verdicts reviewed is **not the code present at this base SHA**. Therefore **no bounded security claim maps to any capability as it exists at `5c29fd07`.**

Consequences, binding:

- No capability here carries `Open Findings`, `Bounded Approval`, or `Approved for Defined Scope`.
- **`G3a-1-F5a+c` is not expanded, restated, or applied to any capability in this registry.** It remains closed only for its exact reviewed unit, claim, scope, and SHA.
- **PR #9 remains NO-GO.**
- **The global B2 tenant-isolation claim remains NOT DEFENSIBLE.**
- `Not Evaluated` here means *no security evaluation of this code at this SHA has been mapped*. It is **not** a claim that the capability is insecure, and **not** a claim that it is secure.

#### 4.4.8 Registry totals

Counted directly from Views A and B above. Every capability appears exactly once in each view under the same `capability_id`.

| implementation_status | Operational (C-*) | Platform (P-*) | Total |
|---|---|---|---|
| Connected in Repository | 18 | 7 | **25** |
| Implemented | 13 | 2 | **15** |
| Missing | 5 | 1 | **6** |
| INSUFFICIENT EVIDENCE TO CLASSIFY | 2 | 0 | **2** |
| **Total capabilities** | **38** | **10** | **48** |

`25 + 15 + 6 + 2 = 48`. View A rows: 38 + 10 = 48. View B rows: 38 + 10 = 48. The three totals agree.

**Other dimensions, counted across all 48 capabilities:**

| Dimension | Distribution |
|---|---|
| `operational_validation` | `Not Validated` — 48 of 48 |
| `security_status` | `Not Evaluated` — 48 of 48 |
| `evidence_confidence` | `Medium` — 46; `Low` — 2 (C-22, C-29) |
| `verification_state` | `CURRENT` — 48 of 48 |
| `lifecycle_state` | `Transitional` — 1 (C-37, evidenced); `UNASSIGNED — INSUFFICIENT EVIDENCE` — 47 |
| `roadmap_horizon` | `UNASSIGNED — OD-12` — 48 of 48 |

#### 4.4.9 Evidence and governance notes

- **Evidence class.** Every row rests on repository composition at one SHA: file presence, root-router registration, client namespace references, module import graph, Zod reference counts, and test-file presence. **No execution, no test run, no behavioral verification.** This bounds every classification uniformly and caps `evidence_confidence` at `Medium`.
- **`Medium` vs `Low`.** `Medium` reflects a multi-layer composition observation. `Low` is used only where the correspondence between a surface and its canonical definition is itself uncertain (C-22, C-29).
- **`Missing` means "no surface observed at this SHA and evidence scope."** It is not a statement that the capability was never built, exists nowhere, or cannot be found under a different name or on a different lineage.
- **`Implemented`** records that the capability is built and mounted, not that it is reachable by a user.
- **Every `operational_validation` is `Not Validated`** because no test was run and no behavior was observed. This is an evidence ceiling, not a quality judgment.
- **`UNASSIGNED — INSUFFICIENT EVIDENCE` is a registry representation of absent classification, not a Lifecycle State value.** The Lifecycle State vocabulary remains exactly the four values in §4.7. No fifth value exists.
- **`UNASSIGNED — OD-12`** is likewise a representation of an undecided field, not a Roadmap Horizon value. The Roadmap Horizon vocabulary remains exactly the five values in §4.8, `NONE` among them; `NONE` is a decision and has not been taken.
- **This registry is a classification snapshot in the canonical vocabulary. It is not an audit, not a security evaluation, and not a maturity assessment.**
- **Registry maintenance** is governed by Section 5. A row changes only through evidenced reclassification, never through restatement.

### 4.5 Maturity dimensions

Four dimensions. **They are independent.**

**Implementation Status** — Missing · Planned · Implemented · Connected in Repository

**Operational Validation** — Not Validated · Locally Validated · End-to-End Validated · Field Validated · Production Validated

**Security Status** — Not Evaluated · Open Findings · Bounded Approval · Approved for Defined Scope

**Evidence Confidence** — Low · Medium · High

Binding independence rules:

- **Connected in Repository does not mean operationally validated.**
- **Operational validation does not imply security approval.**
- **High evidence confidence does not imply high maturity.** Confidence measures how well the classification is supported, not how mature the capability is. A capability may be confidently classified as Missing.
- No dimension may be derived from another. Each requires its own evidence.
- **Connectivity is never inferred from naming.** See 4.4.2.
- **A security status above `Not Evaluated` requires an exact bounded mapping.** See 4.4.7.

### 4.6 Verification state

`verification_state`: **CURRENT** · **REVERIFICATION REQUIRED**

- **`REVERIFICATION REQUIRED` is not a maturity status.** It is orthogonal to all four dimensions of 4.5.
- **Stale evidence alone does not demote implementation, operational, security, or evidence-confidence classifications.** It changes `verification_state` and nothing else.
- Demotion of a maturity dimension requires **new contradicting evidence**, not the passage of time.

Every classification must be anchored to `repository`, `commit_sha`, `verified_at`, `evidence_scope`, and `evidence_references`. A classification without a complete anchor is not a classification.

### 4.7 Lifecycle state

`lifecycle_state` vocabulary — exactly four values, no others:

- **Active**
- **Transitional**
- **Legacy**
- **Deprecated**

Binding rules:

- Lifecycle state is independent of maturity and of verification state.
- **A lifecycle state is assigned only where repository evidence or an approved human product decision supports it.** It is never assigned by default.
- Where neither exists, the registry records `UNASSIGNED — INSUFFICIENT EVIDENCE`. That phrase is a **representation of absent classification, not a fifth vocabulary value**.

### 4.8 Roadmap horizon

`roadmap_horizon` vocabulary — exactly five values, no others: **NOW** · **NEXT** · **LATER** · **RESEARCH** · **NONE**

Horizon is **intent**. It is never evidence, and it never implies that work has been authorized or started.

> Horizon values are deliberately not assigned in the registry; every row records `UNASSIGNED — OD-12`. Assigning them — including assigning `NONE` — is a product-authority decision that has not been made. See OD-12.

### 4.9 Open decision types

`open_decisions` entries carry exactly one type: **PRODUCT** · **ARCHITECTURE** · **SECURITY** · **DELIVERY** · **OPERATIONAL**

An open decision is recorded, never silently resolved. See Section 6.

### 4.10 Relationships

v1 permits exactly three relationship types:

- **`depends_on`** — the capability requires another to function.
- **`blocked_by`** — the capability cannot progress until another item is resolved.
- **`supersedes`** — the capability replaces another.

No other relationship type exists in v1.

**Evidenced relationships at this SHA**, source `server/routers.ts` at `5c29fd07535695566adc6bcb556b529ac94987ca`:

- `C-36 (Calibration) supersedes C-37 (Learning layer)`
- `C-18 (Price adjustment and margin control) supersedes C-37 (Learning layer)`

No other relationship is evidenced, and none is asserted.

---

## 5. Evidence, Security, and Delivery Governance

### 5.1 Claim-specific authority

**Authority is per claim, never global.** No document, person, agent, or record is authoritative for all claim types.

### 5.2 Source hierarchy by claim type

| Claim type | Authoritative source |
|---|---|
| Observable repository fact | Live repository read at an exact SHA. |
| Live external state (PR state, remote refs, CI) | Direct observation at a recorded time. Never a document's restatement. |
| Product identity, domain semantics, capability vocabulary | **This document.** |
| Repository execution rules | `AGENTS.md`. |
| Bounded architecture decision | The relevant ADR. |
| Bounded security claim | The relevant security gate record, at its exact SHA and scope. |
| Replaceable operational state | `current-state.md`. |
| Durable decisions and corrections | The append-only decision/correction log. |
| Historical evidence | The original artifact at its original SHA. |

### 5.3 Evidence classifications

- **VERIFIED FACT** — directly observed, with repository, SHA, time, scope, and reference recorded. Reproducible by re-reading the same source.
- **INFERENCE** — a reasoned conclusion from verified facts. Must state both the facts it rests on and the limits of what it supports.
- **FUTURE DIRECTION** — approved intent. Carries no claim about the present and no authorization.
- **UNVERIFIED** — asserted but not established. Usable only when labeled as such.
- **HISTORICAL EVIDENCE** — true at a past SHA or past time. Never automatically true now.

Binding rule: **an unlabeled claim is not an established claim.**

### 5.4 Exact-SHA evidence boundaries

- Every evidence record binds to one exact commit SHA.
- A verdict, classification, or approval established at one SHA applies to **that SHA only**.
- A later commit does not inherit an earlier verdict, however small the change.
- **A verdict does not travel across lineages.** A claim reviewed on one branch's tree does not apply to a different tree that lacks the reviewed code. See 4.4.7.
- Because a commit's own SHA cannot appear in its contents, a gate record cites the **reviewed pre-commit SHA** and the **resulting post-commit SHA** as separate, explicitly labeled anchors.
- **A push transfers no verdict.** Publication requires its own observation and its own record.

### 5.5 Current versus historical evidence

- **Current evidence** describes state now and must carry a recent observation time.
- **Historical evidence** describes state then and remains permanently valid *as history*.
- Historical evidence is **never** promoted to current by restatement, by copying into a newer document, or by absence of contradiction.
- When current and historical evidence conflict, current evidence governs the present, and the historical record remains intact.

### 5.6 Status promotion and demotion

**Promotion** on any dimension of 4.5 requires new evidence sufficient for that specific dimension, a complete anchor (4.6), and the human authority for that claim type (5.9).

**Demotion** requires new contradicting evidence.

Binding prohibitions:

- No dimension is promoted because another dimension was promoted.
- No status is promoted by restatement, summary, or repetition in another document.
- No status is promoted by naming, path convention, or file presence.
- No classification is assigned by default where evidence is absent; absence is represented as absence.
- **Agents never self-promote a status.**

### 5.7 Stale evidence versus verification state

> Staleness alone changes `verification_state: CURRENT → REVERIFICATION REQUIRED`.
> Staleness alone does **not** automatically demote any maturity dimension.

The staleness time policy is an open decision (OD-05).

### 5.8 Correction and supersession

- Corrections are **append-only**. A superseded statement is marked superseded and retained.
- A correction records: what was previously stated, what is now stated, why, on what evidence, what it supersedes, and what it does **not** imply.
- **Supersession is explicit and scoped.** A correction supersedes only what it names.
- Silent replacement of a prior statement is a governance violation.

### 5.9 Agent and human authority

**Human authorities:** Human Product Authority · Engineering Evidence Authority · Operational Validation Authority · Security Authority · Delivery Authority

**Agents may:** inspect · analyze · identify conflicts · propose evidence · propose classifications.

**Agents may not:** self-promote statuses · become sources of truth · authorize security work · authorize branch publication · emit merge approval · override human decisions.

The named individuals holding each authority are an open decision (OD-06).

### 5.10 Cross-document reference and conflict resolution

**Reference rules:**

- Reference by **pointer**, not by copy.
- A reference carries the source's own anchor (SHA, time, scope).
- **A summary may narrow a claim. A summary may never widen one.**
- **`current-state.md` may summarize but may not expand bounded claims.**

**Conflict resolution:**

1. Identify the claim type and its authoritative source (5.2).
2. Approved direction versus observable fact: **preserve the direction, mark the conflict explicitly, do not rewrite the evidence.**
3. Evidence record versus evidence record: the more recent observation with the tighter evidence scope governs; both are retained.
4. Bounded claim versus broader restatement: the **bounded** claim governs. The broader restatement is a governance error.
5. Never resolve a conflict by deleting one side.

### 5.11 Production Ready and Release Ready

- **Production Ready is a separately supported claim, not another maturity status.** It is not a value on any dimension of 4.5 and cannot be reached by promotion within them.
- A Production Ready claim requires, at minimum: End-to-End Validated or higher operational validation; a security status of Approved for Defined Scope covering the claimed scope; no open blocking findings in that scope; live-state and deployment preconditions satisfied; and an explicit decision by the relevant human authorities.
- **Release Ready** additionally requires the delivery gate for that release to have passed on its exact SHA.
- **`Connected in Repository` contributes nothing to either claim.**

### 5.12 Publication direction and the canonical artifact's transfer mechanism

> **CLASSIFICATION: APPROVED DIRECTION**

The publication direction for canonical documentation is a **clean documentation lineage based on `origin/main`**.

Rationale, as approved: the workflow lineage descends from still-open security-remediation lineage, and PR #9 remains NO-GO. Canonical truth must not descend from an open remediation lineage.

**VERIFIED FACT.** `origin/security/tenant-isolation-remediation-20260821` at `b95ea0bf4741646f418fcc99a22d22a42d24be51` is **not** an ancestor of `origin/main` at `5c29fd07535695566adc6bcb556b529ac94987ca`, and is not an ancestor of this document's branch HEAD (`git merge-base --is-ancestor`, exit code 1).

**Transfer mechanism for this canonical artifact — ESTABLISHED, not open.**

For **this document only**, the applicable mechanism is **controlled reproduction on the clean `origin/main`-based branch**.

The reason is structural, not preferential:

- **VERIFIED FACT.** The canonical artifact did not exist in any repository commit before this draft was authored.
- **Consequence.** Patch application, cherry-pick, merge, and rebase are **not transfer mechanisms for this artifact**, because there was no source artifact to transfer. They were not rejected on risk grounds; they are mechanically inapplicable.

**Bounded scope of that establishment:**

- It applies to **this canonical document only**.
- It selects **no** mechanism for any other artifact.
- It **does not authorize** staging, commit, push, PR creation, publication, or merge — of this document or of anything else.
- The exact remaining delivery operations and their authorizations **remain separately gated**, each requiring its own explicit human authorization.

### 5.13 Content boundary of the current delivery gate

> **CLASSIFICATION: BOUNDED DELIVERY DECISION — this gate only**

The content boundary approved for the current Delivery and Publication Governance Gate is **CANONICAL DOCUMENT ONLY**.

The following are **OUT OF SCOPE FOR TRANSFER in this gate**:

- `docs/engineering/*`
- `docs/superpowers/*`
- `AGENTS.md`
- `docs/adr/*`
- `docs/security*`

They remain **evidence and reference lineage** where applicable, on the workflow lineage at `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3`, citable by SHA.

**This is a bounded delivery decision for this gate. It does NOT permanently decide the future architecture or location of the Second Brain or of any other artifact above.** A future gate may decide differently, on its own evidence and its own authorization.

---

## 6. Open Decisions

**None of the decisions below is resolved by this document.** Recording is not resolution. Fifteen decisions, IDs OD-01 through OD-15, each appearing exactly once.

| # | Open decision | Type |
|---|---|---|
| OD-01 | Exact sequencing among lead, deal/opportunity, client, and project — which entity is created when, and what each requires of the others. | PRODUCT |
| OD-02 | Change Order persistence model. Observed: change-order concepts distributed across `field-operations-db`, `actuals-db`, `estimate-version-db`, `closeout-db`, and the Drizzle schema, with no dedicated surface (C-29). Whether the canonical model is a first-class entity or a distributed representation is undecided. | ARCHITECTURE |
| OD-03 | Treatment of pre-project costs when no approved cost-bearing container exists — what bears the cost, and how it is later reconciled or not reconciled to a project. | PRODUCT |
| OD-04 | Transfer mechanism for **artifacts other than this canonical document**. The mechanism for this document is established in 5.12 as controlled reproduction and is not reopened. No mechanism is selected for any other artifact, and none is needed while 5.13's content boundary holds. | DELIVERY |
| OD-05 | Stale-evidence time policy — after what interval `verification_state` moves to `REVERIFICATION REQUIRED`, and whether the interval varies by claim type. | OPERATIONAL |
| OD-06 | Named human authorities for each gate — who specifically holds Product, Engineering Evidence, Operational Validation, Security, and Delivery authority. | OPERATIONAL |
| OD-07 | Detailed criteria for `Field Validated` and `Production Validated` — what evidence each requires and who may assert it. | OPERATIONAL |
| OD-08 | Deployment-gate scope — what a deployment gate covers, what it excludes, and its relationship to the security and delivery gates. | DELIVERY |
| OD-09 | Future architecture and location of the Second Brain (`docs/engineering/*`) and of `docs/superpowers/*`. **Out of scope for the current gate** per 5.13; those artifacts are not transfer candidates in this unit. This decision concerns only their eventual architecture, to be taken in a future separately authorized unit. | DELIVERY |
| OD-10 | Evidence retention outside Git — whether, where, and under what retention non-Git evidence is preserved and referenced. | ARCHITECTURE |
| OD-11 | Revalidation rules after transverse changes — which classifications must be revalidated when a cross-cutting platform capability changes. | OPERATIONAL |
| OD-12 | Roadmap horizon assignment for every capability in the Section 4.4 registry. Every row currently records `UNASSIGNED — OD-12`; assigning any value, including `NONE`, is a product-authority decision not yet taken. | PRODUCT |
| OD-13 | Long-term relationship between the canonical documentation lineage and `AGENTS.md`, `docs/adr/*`, and `docs/security*`, given the divergence recorded in 1.2. **Out of scope for the current gate** per 5.13; those artifacts are not transfer candidates in this unit. This decision concerns only the eventual relationship. | DELIVERY |
| OD-14 | Whether Structr v1 should canonically declare additional product non-goals — specifically whether it is out of scope as a general-purpose accounting/general-ledger system, a payroll system, a CAD/design-authoring tool, a commercial/heavy-civil platform, or a marketplace. These were asserted by an earlier draft **without approval** and were removed from canonical truth (2.8). No position is taken here. | PRODUCT |
| OD-15 | Whether connection layer **L7** — integration into the canonical Section 3.1 operational flow — should become a requirement for `Connected in Repository`. L7 is currently ABSENT for every capability for the structural reason stated in 4.4.2. | ARCHITECTURE |

---

## 7. Explicit Non-Claims

This document makes **none** of the following claims:

**Readiness and validation**

- Current Structr capabilities are **not** declared Production Ready.
- End-to-end validation is **not** implied.
- Field validation is **not** implied.
- Production validation is **not** implied.
- No capability in the Section 4.4 registry is asserted to be operationally validated at any level.
- No capability classified `Connected in Repository` is asserted to conform to the canonical Section 3.1 operational flow. L7 is ABSENT for every row.

**Security**

- Security approval expansion is **not** implied.
- **PR #9 remains NO-GO.**
- **The global B2 claim remains NOT DEFENSIBLE.**
- **`G3a-1-F5a+c` remains bounded to its exact reviewed unit, claim, scope, and SHA**, and is not expanded, restated, or applied to any capability by this document.
- **F5b, G3a-2, G3a-3, G2, and G3b are not authorized by this document**, and their status is unchanged by it.
- Every security status in this registry is `Not Evaluated`. That is **not** a claim that any capability is secure, and **not** a claim that any is insecure.

**Classification**

- No `lifecycle_state` is asserted for any capability except C-37, whose `Transitional` classification rests on the cited `server/routers.ts` evidence. All other rows record absence of classification, not `Active`.
- No `roadmap_horizon` is asserted for any capability.
- `Missing` and `ABSENT` mean *not observed within the stated evidence scope* — never *does not exist*.

**Authorization**

- This document **does not authorize implementation**.
- This document **does not authorize automation or enforcement**.
- This document **does not authorize migrations, Supabase, or live-database work**.
- This document **does not authorize merge or release**.
- This document does not authorize staging, committing, pushing, PR creation, or publication of itself.
- The transfer-mechanism establishment in 5.12 authorizes **no** delivery operation; it identifies a mechanism only.
- The content boundary in 5.13 is bounded to the current gate and decides no future architecture.
- This document does not resolve any open decision in Section 6.

**Evidence**

- The registry in Section 4.4 is not an audit, not a security evaluation, and not a maturity assessment.
- No classification in this document rests on execution, test results, behavioral verification, or live-state observation.

---

## 8. Verification Anchor

**Repository**
`https://github.com/wcvmsilva/structr-ai.git`

**Document branch**
`docs/canonical-structr-truth-v1`

**Base**
`origin/main`

**Base SHA**
`5c29fd07535695566adc6bcb556b529ac94987ca`

**Branch HEAD at authoring time**
`5c29fd07535695566adc6bcb556b529ac94987ca`

**Ancestry verification**
`origin/security/tenant-isolation-remediation-20260821` at `b95ea0bf4741646f418fcc99a22d22a42d24be51` is **NOT** an ancestor of this branch HEAD. Verified by `git merge-base --is-ancestor`, exit code 1.

**Divergence from `origin/main` at authoring time**
`0 0`

**Evidence scope of all repository-derived statements**
Repository composition read at `5c29fd07535695566adc6bcb556b529ac94987ca`: file presence and paths; root-router registration in `server/routers.ts`; client-side tRPC namespace references under `client/src`; module import graph; Zod schema reference counts per router; test-file presence; targeted `git cat-file -e` existence checks. **No execution, no test run, no build, no behavioral verification, no live-state observation, no database, Supabase, `.env`, or secret access.**

**Document status**
`DRAFT — COMMITTED LOCALLY — PENDING PUBLICATION REVIEW`

**Commit SHA**
**The document does not self-assert its own commit SHA.** The resulting commit SHA is recorded by the applicable exact-SHA delivery gate record.
