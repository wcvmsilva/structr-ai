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

The following observations are recorded here because they bear directly on open decisions and are not resolved by this document:

- **No dedicated change-order surface exists.** Change-order concepts are referenced inside `field-operations-db`, `actuals-db`, `estimate-version-db`, `closeout-db`, and the Drizzle schema, with no dedicated router. See OD-02.
- **For proposal issuance and commercial acceptance, no operation performing those flows was observed.** Schema structures exist — `leadProposals`, `proposals` and `proposalAccessLog` in `drizzle/schema.ts:550–617`, carrying `signatureUrl` and `signedUrl` — but no `server/` module reads or writes them at this SHA. Tables and fields are not issuance or acceptance. See C-20, C-21 and footnote 32.
- **For commitments, no record of obligation was observed reaching any tracked flow.** The field named `committedCostCents` is not taken as evidence by its name: it aggregates recorded actual-cost rows in `approved` or `paid` status. See C-31 and footnote 30.
- **For forecast/EAC, a projection was observed whose correspondence to the Section 3.3 model could not be established.** `forecastRevenue` combines approved-baseline-derived and change-order-derived contract value, a committed-cost aggregate, a derived unearned balance and weighted pipeline. Whether that is the canonical projection is unresolved, not answered either way. See C-32 and footnote 33.

> **Correction record (§5.8) — the §2.9 forecast bullet.** *Previously stated, now superseded:* "a revenue projection was observed, but **it does not combine the components §3.3 requires** … no obligation record and **no independent assessment of remaining work** enters it." *Now stated:* the bullet above. *Why:* §3.3 requires a projection *combining* four things and does not require that each arrive as an independent input, nor that remaining work be supplied rather than computed; the superseded sentence added those requirements and converted an unsettled correspondence into a stated absence. *Evidence:* §3.3's **Forecast / Estimate at Completion** row and §3.4 of this document, with the analysis and citations in footnote 33, at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* this §2.9 bullet only. *What this does not imply:* **C-32 is now `INSUFFICIENT EVIDENCE TO CLASSIFY`, not `Missing`** (footnote 33) — a change of disposition, not a promotion; the commitments bullet above and C-31 are unaffected; and §2.9's CLASSIFICATION as INFERENCE, evidence scope and stated limits are unchanged.
- **For baseline management, both an approved-scope surface and a financial-side representation were observed, but their correspondence to the Section 3.3 model could not be established** from this evidence scope. See C-33 and footnote 30.

> **Correction record (§5.8) — §2.9, third revision.** *Previously stated, now superseded:* the introduction "**Two observations** recorded here…", which introduced five bullets; "**No surface was observed** for proposal issuance or commercial acceptance"; "not obligations **not yet incurred**"; "it produces **no cost-at-completion figure**"; and "a **distributed financial-side representation** was observed" for baseline management. *Now stated:* the uncounted introduction and the four bullets above. *Why:* the count no longer matched the list; "no surface" denied schema structures that exist; "not yet incurred" and "cost-at-completion" attributed to §3.3/§3.4 wording those sections do not contain — §3.3 defines the Forecast / Estimate at Completion as "a projection combining authorized baselines, actuals, commitments, and remaining work" and §3.4 says only "Commitments record what was obligated"; and "financial-side" omitted the approved-scope surface recorded in footnote 30. *Evidence:* `drizzle/schema.ts:550–617`; `server/scope-review-router.ts:238–283, 358–368`; `server/scope-review-db.ts:128–145, 254–283`; `server/analytics-db.ts:206–248`; `shared/analytics-aggregation-engine.ts:179–187, 215–286`; and this document's own §3.3 and §3.4 text — repository files at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* this §2.9 observation list and its introduction only. *What this does not imply:* **C-20, C-21, C-31 and C-32 remain `Missing` and C-33 remains `INSUFFICIENT EVIDENCE TO CLASSIFY`**; no registry cell, total or distribution changes. §2.9's CLASSIFICATION as INFERENCE, its evidence scope and its stated limits are unchanged, and the earlier §2.9 correction records below remain in force for what they introduced.

> **Correction record (§5.8) — §2.9, second revision.** *Previously stated, now superseded:* "No surface was observed for proposal issuance, commercial acceptance, **commitments, or forecast/EAC** as those concepts are defined in Section 3." *Now stated:* the four bullets above, which split commitments and forecast/EAC out of the no-surface list and record for each what **was** observed and why it is nonetheless not the Section 3 concept. *Why:* a bare "no surface was observed" overstated the finding for those two. A revenue-projection surface exists and receives baseline- and actual-derived financial data (footnote 30), and a `committedCostCents` field exists whose derivation — not whose name — is what places it outside the canonical commitments concept. Both classifications survive, but on stated derivations rather than on absence. *Evidence:* `server/analytics-db.ts:206–248`, `server/field-operations-db.ts:911–927`, `server/actuals-db.ts:745–759`, `shared/domain/phase3-taxonomy.ts:236, 252, 526–528`, at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* this §2.9 observation bullet only. *What this does not imply:* **C-31 and C-32 remain `Missing`** and no registry cell, total or distribution changes. Proposal issuance and commercial acceptance are unchanged and were not re-examined in this pass — they retain the finding of the pass that recorded them. §2.9's CLASSIFICATION as INFERENCE, its evidence scope and its stated limits are unchanged, and the earlier §2.9 correction record below remains in force for the baseline-management bullet it introduced.

> **Correction record (§5.8) — §2.9 observation.** *Previously stated, now superseded:* "No surface was observed for proposal issuance, commercial acceptance, commitments, forecast/EAC, **or baseline management** as those concepts are defined in Section 3." *Now stated:* the two bullets above, which remove baseline management from the no-surface list and record it separately. *Why:* the negative claim is contradicted by `server/field-operations-db.ts:96–132`, `server/actuals-db.ts:657–683` and `server/estimate-version-db.ts:210–274`, which were present at the base SHA and not examined when that sentence was written. Leaving it active would contradict the C-33 row. *Evidence:* those files and line ranges at `5c29fd07535695566adc6bcb556b529ac94987ca`; full analysis in footnote 30. *Scope:* this observation bullet in §2.9 and its counterpart row C-33 only. *What this does not imply:* the four remaining no-surface findings are **unchanged and re-confirmed in this pass** (commitments and forecast/EAC were re-checked directly; see footnote 30). This is **not** a claim that baseline management is implemented, and §2.9's CLASSIFICATION as INFERENCE, its evidence scope, and its stated limits are unchanged.

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
| C-12 | Scope completeness assessment | `scope-completeness-router` mounted; `scope-completeness-db`; `shared/scope-completeness-engine`; engine imported and invoked by `scope-completeness-db`²⁸ | A | P | P | P | P²⁸ | P | Implemented |
| C-13 | Scope model and structure | `scope-router` mounted; `scope-db`; `shared/scope-engine`; client `scope` | P | P | P | P | P | P | Connected in Repository |
| C-14 | Estimating | `estimate-router`, `estimate-legacy-router` mounted; `estimate-db`, `estimate-version-db`; `shared/estimate-engine`; client `estimate` | P | P | P | P | P | P | Connected in Repository |
| C-15 | Pricing engine and price book | `pricing-router` mounted; `pricing-db`; `shared/pricing-engine`; consumed by `pricing-dimensions` | A | P | P | P | P | P | Implemented |
| C-16 | Catalog and assembly library | `catalog-router`, `assembly-router` mounted; `assembly-db`; `shared/assembly-engine`; client `catalog`, `assembly` | P | P | P | P | P | P | Connected in Repository |
| C-17 | Bundles and presets | `bundle-router`, `preset-router` mounted; `server/db.ts` + `bundleItems` schema; client `bundle`, `preset` | P | P | N/A¹ | P³ | P | P | Connected in Repository |
| C-18 | Price adjustment and margin control | `price-adjustment-router` mounted; `price-adjustment-db`; `shared/price-adjustment-engine`, `shared/profit-shield-engine`; consumed by `analytics-db` | A | P | P | P | P | P | Implemented |
| C-19 | Remodel modeling | `remodel-router` mounted; `remodel-db`; `shared/remodel-engine`; consumed by `workflow-visualization-router`, `seed` | A | P | P | P | P | P | Implemented |
| C-20 | Proposal issuance | Proposal schema structures exist; no operation performing §3.2 issuance observed³² | A | A | A | A | A | A | Missing |
| C-21 | Commercial acceptance recording | Signature/acceptance fields exist in schema; no operation performing §3.2 acceptance observed³² | A | A | A | A | A | A | Missing |
| C-22 | Execution Authorization *(as defined in §3.2)* | Correspondence to the canonical definition not establishable⁴ | — | — | — | — | — | — | INSUFFICIENT EVIDENCE TO CLASSIFY |
| C-23 | Field launch control | `field-launch-router` mounted; `field-launch-db`; client `fieldLaunch` (12 references) | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-24 | Field operations | `field-operations-router` mounted; `field-operations-db`; `shared/field-operations-engine`; consumed by `actuals-db`, `calibration-db`, `closeout-db`, `estimate-db`, `scope-completeness-db` | A | P | P | P | P | P | Implemented |
| C-25 | Daily logs | `daily-logs-router` mounted; `daily-log-db` | A | P | N/A¹ | P | A | P | Implemented |
| C-26 | RFI management | `rfi-router` mounted; `rfi-db`; client `rfi` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-27 | Issue reporting | `issue-report-router` mounted; `server/db.ts` + `systemIssueReports` schema; client `issueReport` | P | P | N/A¹ | P³ | P | P | Connected in Repository |
| C-28 | Subcontractor management | `subcontractors-router` mounted; `subcontractor-db`; `shared/subcontractor-performance-engine`; engine consumed by `field-operations-db`²⁶ | A | P | P | P | P²⁶ | P | Implemented |
| C-29 | Change Request and Change Order *(as defined in §3.6)* | Concepts distributed across `field-operations-db`, `actuals-db`, `estimate-version-db`, `closeout-db`, Drizzle schema; no dedicated surface⁵ | — | — | — | — | — | — | INSUFFICIENT EVIDENCE TO CLASSIFY |
| C-30 | Actual cost capture | `actuals-router` mounted; `actuals-db`; `shared/actuals-variance-engine`; consumed by `calibration-db`, `closeout-db`, `scope-completeness-db` | A | P | P | P | P | P | Implemented |
| C-31 | Commitments and purchase obligations | No surface observed | A | A | A | A | A | A | Missing |
| C-32 | Forecast / Estimate at Completion *(as defined in §3.3)* | `forecastRevenue` in `shared/analytics-aggregation-engine`, reached through `analytics-db`; combines approved-baseline-derived and change-order-derived contract value, a committed-cost aggregate, a derived unearned balance and weighted pipeline; correspondence to the §3.3 model not establishable³³ | — | — | — | — | — | — | INSUFFICIENT EVIDENCE TO CLASSIFY |
| C-33 | Baseline management *(as defined in §3.3)* | Scope approval with recorded approver/time and approved-item snapshots in `scope-review-router`, `scope-review-db`; financial-side representation distributed across `field-operations-db`, `actuals-db`, `estimate-version-db`; no dedicated surface; correspondence to the §3.3 model not establishable³⁰ | — | — | — | — | — | — | INSUFFICIENT EVIDENCE TO CLASSIFY |
| C-34 | Closeout and handover | `closeout-router` mounted; `closeout-db`; `shared/closeout-engine`; consumed by `calibration-db`, `scope-completeness-db` | A | P | P | P | P | P | Implemented |
| C-35 | Analytics | `analytics-router` mounted; `analytics-db`; `shared/analytics-aggregation-engine`; engine imported and invoked by `analytics-db`²⁹ | A | P | P | P | P²⁹ | P | Implemented |
| C-36 | Calibration | `calibration-router` mounted; `calibration-db`; `shared/calibration-engine`; consumed by `analytics-db`, `price-adjustment-db` | A | P | P | P | P | P | Implemented |
| C-37 | Learning layer | `learning-layer-router` mounted; `learning-layer-db`; client `learning` | P | P | N/A¹ | P | P | P | Connected in Repository |
| C-38 | Workflow visualization | `workflow-visualization-router` mounted; derives from `scope-db`, `project-db`, `geo-override-db`, `remodel-db`, `assembly-db`; client `workflowViz` | P | P | N/A¹ | P⁷ | P | P | Connected in Repository |

**Layer rationales**

1. **N/A (L3)** — record-management or presentation capability; no dedicated domain engine is expected by the architecture. Absence of an engine is not a gap.
2. **P (L4, C-10)** — no dedicated `scope-generation-db`; the router imports `scope-db`, `project-db`, and `intake-db`. The persistence boundary is observed, delegated.
3. **P (L4, C-17 and C-27)** — no dedicated `-db` module; the router imports `server/db.ts` and named Drizzle schema tables (`bundleItems`, `systemIssueReports`) directly. Persistence boundary observed.
4. **C-22** — `field-launch-router`, `field-launch-db` and 12 client references exist and are classified separately as C-23. Whether that surface implements *Execution Authorization* as defined in Section 3.2 **cannot be established** from repository composition alone. Classifying it either way would be inference from naming, which 4.4.2 forbids.
5. **C-29** — whether the distributed representation implements the Section 3.6 model **cannot be established** from composition alone. See OD-02.
6. **SUPERSEDED HISTORY — former L5 rationale for C-35; no active row reference.** *Retained under §5.8, superseded by footnote 29:* "**N/A (L5, C-35)** — analytics is a terminal read surface; a downstream consumer is not architecturally expected."
7. **P (L4, C-38) — corrected from `N/A` by application of the binding L4 rule as written.** The L4 definition in 4.4.2 lists three PRESENT criteria, the third being *an observed derivation-only boundary*. `server/workflow-visualization-router.ts` at the base SHA is exactly that: it contains **no** `getDb` and **no** `drizzle/schema` import (`git grep -E "getDb|drizzle/schema"`, exit code 1), and reaches state only through other domains' persistence modules — line 22 `getScopeDraftWithItems, listScopeDraftsForProject` from `./scope-db`, line 23 `getProjectById` from `./project-db`, line 24 `getOverrideLogForDraft` and line 39 `listOverrideRules` from `./geo-override-db`, line 25 `listRemodelTemplates` from `./remodel-db`, line 26 `listAssemblies` from `./assembly-db`. Visualization derives; it holds no state of its own. Under the rule as written, deriving **is** the observed boundary, and the layer is PRESENT.
   > **Correction record (§5.8).** *Previously stated:* `N/A (L4, C-38)` — "visualization derives from other domains' persistence; it holds no state of its own." *Now stated:* `P (L4, C-38)`, on the evidence above. *Why:* the previous entry treated "holds no state of its own" as making the layer inapplicable; the binding L4 definition in 4.4.2 instead makes an observed derivation-only boundary a PRESENT criterion. The observation was correct; the classification drawn from it was not. *Evidence:* `server/workflow-visualization-router.ts` at `5c29fd07535695566adc6bcb556b529ac94987ca`, lines 22–26 and 39, plus the negative `getDb`/`drizzle/schema` check. *Scope:* the C-38 L4 cell only. *What this does not imply:* `implementation_status` is unchanged — 4.4.2 admits L4 PRESENT *or* NOT APPLICABLE, so C-38 satisfied `Connected in Repository` before and after, and the totals in 4.4.8 are unchanged. It is **not** a claim that the visualization is correct, validated, or secure, and it changes no other cell, capability, or dimension. The L4 rule itself is **not** amended, broadened, or weakened by this correction; it is applied as written.

28. **P (L5, C-12) — corrected from `A`.** `server/scope-completeness-db.ts` imports the capability's engine at lines 32–40 (`buildScopeChecklist`, `detectScopePatterns`, `scoreScopeCompleteness` and four type imports `from "@shared/scope-completeness-engine"`) and invokes `scoreScopeCompleteness(...)` at lines 176–182. `scope-completeness-db` is a module other than `scope-completeness-router`, so the L5 definition in 4.4.2 — *"A module other than the capability's own router imports it, or a client page consumes it"* — is satisfied on its face.
    > **Correction record (§5.8).** *Previously stated, now superseded:* C-12 L5 `A`, i.e. no downstream consumer observed. *Now stated:* C-12 L5 `P`. *Why:* the prior reading treated a consumer internal to the capability's own domain as not counting. The L5 definition excludes **only the capability's own router**; it does not require the consumer to be outside the domain. The former cell applied an unstated external-consumer requirement. *Evidence:* `server/scope-completeness-db.ts` lines 32–40 and 176–182 at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-12 L5 cell and its evidence description only. *What this does not imply:* the L5 rule in 4.4.2 is **not** amended, broadened or weakened, and **no external-consumer, exclusive-router or new capability-attribution rule is introduced**. `implementation_status` is unchanged — L1 remains `A`, so C-12 remains `Implemented` under the existing rule — and no other layer, capability, dimension or total changes. It is **not** a claim that the assessment is correct, validated, or secure.
29. **P (L5, C-35) — corrected from `N/A`.** `server/analytics-db.ts` imports the capability's engine at lines 29–47 (`aggregateFieldProgress`, `aggregatePipeline`, `buildDashboard`, `computeProfitHealth`, `forecastRevenue`, `rankSubcontractors` at lines 30–35, and eleven type imports at lines 36–46, all `from "@shared/analytics-aggregation-engine"`) and invokes `aggregatePipeline(items)` at line 178.
    > **Count correction (§5.8).** *Previously stated, now superseded:* "**twelve** type imports". *Now stated:* **eleven**, at lines 36–46 — `BacklogItem`, `DashboardResult`, `FieldProgressRow`, `PipelineItem`, `PipelineSummary`, `ProfitHealthSummary`, `ProjectMarginRow`, `RevenueForecast`, `FieldProgressSummaryResult`, `SubcontractorPerformanceRow`, `SubcontractorScore` — alongside six value imports at lines 30–35, seventeen named bindings in all. *Why:* the earlier figure was an arithmetic error in transcribing the import block; the eleven `type` lines span 36–46 inclusive. *Evidence:* `server/analytics-db.ts:29–47` at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* this count only. *What this does not imply:* **C-35 L5 remains `P`** — the classification rests on the value import of `aggregatePipeline` at line 31 and its invocation at line 178, neither of which depends on how many type imports accompany them. No other cell, count or classification changes. `analytics-db` is a module other than `analytics-router`, so the L5 definition in 4.4.2 is satisfied on its face.
    > **Correction record (§5.8).** *Previously stated, now superseded:* footnote 6 — "`N/A (L5, C-35)` — analytics is a terminal read surface; a downstream consumer is not architecturally expected." That text is retained as explicit superseded history at footnote 6 and has no active row reference. *Now stated:* C-35 L5 `P`. *Why:* the rationale rested on architectural **expectation**, not observation. A consumer is in fact observed, and 4.4.2 classifies a layer on what is observed; whether a consumer was expected does not arise once one is found. This is the same reasoning already applied to P-10 L1 in footnote 22. *Evidence:* `server/analytics-db.ts` lines 29–47 and 178 at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-35 L5 cell and its evidence description only. *What this does not imply:* the L5 rule is **not** amended; no external-consumer or exclusive-router requirement is introduced. `implementation_status` is unchanged — L1 remains `A`, so C-35 remains `Implemented` — and no other cell, capability, dimension or total changes. Nothing here alters C-35's §3.9 target semantics: monitoring still informs and never authorizes.
30. **C-33 — `Missing` → `INSUFFICIENT EVIDENCE TO CLASSIFY`.** Functional representation relevant to §3.3 is observed at `5c29fd07535695566adc6bcb556b529ac94987ca` on **two** sides — an approved-scope side, set out in clause (c) below, and a financial side, set out here — distributed across modules owned by other capabilities, with no dedicated router or `-db` of its own. On the financial side:
    > - `server/field-operations-db.ts:96–116` — `getProjectBudgetEstimate(projectId)` resolves a project's approved estimate, filtering `status = "approved"`, `supersededBy IS NULL` and `changeOrderOf IS NULL`, ordered by `desc(version)`; its own doc comment (lines 90–95) calls this "the live approved version of the original scope". Lines 119–132 — `listApprovedChangeOrders(projectId)` returns approved drafts having `changeOrderOf` set, ordered by ascending version.
    > - `server/actuals-db.ts:657–683` — `getProjectBudgetLines(projectId)` composes the two, emitting baseline line items with `fromChangeOrder: false` and each change order's line items with `fromChangeOrder: true`, so change-order lines remain separately tagged in the aggregate.
    > - `server/estimate-version-db.ts:210–274` — `createChangeOrder(input)` requires the base draft to be `approved` (raising `SCOPE_NOT_APPROVED` otherwise, lines 224–230) and a reason of at least 10 characters (lines 232–238), then inserts a new row with `changeOrderOf: base.id`, `source: "change_order"`, a fresh project version, and `status: "draft"` (lines 248–274). Its doc comment (lines 203–209) states the change order "does not supersede the base estimate".
    >
    > **Further static properties, observed in this pass and previously uninspected.** These are properties of the code as written; none of them requires execution to read, and none of them is asserted here to be operationally validated.
    > - **The resolver re-selects on every call.** `getProjectBudgetEstimate` contains no cache and no memoisation: each invocation issues the query at lines 102–113 and returns `rows[0]`. Its result is therefore derived from current row state, not read from a stored baseline reference. This is a static property of the function body, not a runtime unknown.
    > - **`estimate_drafts.supersededBy` has one non-test writer.** `server/estimate-version-db.ts:172–175`, inside `createEstimateVersion`, sets it on the **source** draft when a new version is created from it — before that new version is approved. Its own comment (lines 170–171) calls this "metadata, not money". The same function refuses to version an already-superseded source (lines 133–137). *The column name also exists on `calibration_events`, written at `server/calibration-db.ts:401–404`; that is a different table and is not part of this capability — the claim here is scoped to `estimate_drafts`.*
    > - **An approval transition exists and is explicit.** `approveEstimateDraft(id, userId)` at `server/estimate-db.ts:488–600` validates the move against the `STATUS_TRANSITIONS` table at lines 311–318 (`draft` and `sent_to_estimate` may reach `approved`; `approved` may then reach only `converted` or `archived`), applies the Profit Shield as a hard gate that throws `PROFIT_SHIELD_CHANNEL_FLOOR` when breached (512–525), and writes `status: "approved"`, `approvedBy`, `approvedAt`, `lockedAt` and a frozen `profitShieldEvaluation` in a single update (528–539). When the approved row is a change order (`current.changeOrderOf`), the same function calls `materializeChangeOrderTasks({ changeOrderId: id, userId })` (575–578).
    > - **Immutability after approval is represented in code, within stated limits.** The migration `drizzle/0002_phase2_previsit_estimate.sql:569–597` defines `structr_guard_approved_estimate()` and the `BEFORE UPDATE` trigger `trg_guard_approved_estimate` on `estimate_drafts`, raising `ESTIMATE_VERSION_LOCKED` if an approved row's `final_total_price`, `subtotal_price`, `subtotal_cost`, `discount_amount`, `line_items`, `assembly_selections` or `version` is altered, while permitting superseding, locking, archiving and non-monetary annotation. `assertEstimateMutable` (`server/estimate-db.ts:64–75`) mirrors the rule in the application layer.
    >   **Limits of that observation, stated so it is not over-read.** The guard tests exactly **seven** columns and only when `OLD.status = 'approved'` (572–583) — other columns of an approved row are untouched by it. Its installation block is wrapped in `EXCEPTION WHEN others THEN RAISE NOTICE '… skipped: %'` (589–597), so a failure to create the trigger is swallowed rather than raised. The application guard `assertEstimateMutable` reads the row's **current** status and is invoked at one call site, `server/estimate-db.ts:438` (`applyDiscount`). The presence of this code therefore does **not** establish that the trigger is deployed in any environment, that it ever executed, that every field or path is covered, that an approved row is permanently immutable, or that §3.3/§3.4 are satisfied. No migration, database, trigger or application was run in this pass.
    >
    > **Correction record (§5.8) — the indeterminacy rationale itself.** *Previously stated, now superseded:* "(a) … whether that value is fixed at authorization or re-resolves as later versions are approved **is a runtime behaviour, not a composition fact**; (b) … the observed change order is inserted with `status: "draft"` and **its approval transition is not observed here**; (d) §3.4's binding rules (baselines immutable, layers never edited, variance is measurement not correction) **are behavioural and were not observed**." *Now stated:* the four static properties above, and the narrowed indeterminacy below. *Why:* each of those three clauses was wrong in kind. (a) treated a readable property of the function body as requiring execution. (b) inferred the absence of an approval transition from the insert status of a new row, when `approveEstimateDraft` is present in the tree and handles change orders explicitly — the transition was **not inspected** in that pass, which is a limit of that inspection, not an absence of code. (d) declared §3.4's immutability rule unobserved when a database trigger and an application guard both express it. *Evidence:* `server/field-operations-db.ts:96–116`; `server/estimate-version-db.ts:149–175`; `server/estimate-db.ts:64–75, 311–318, 488–600`; `drizzle/0002_phase2_previsit_estimate.sql:567–597` — all at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the rationale supporting C-33's disposition only. *What this does not imply:* **the disposition is unchanged** — C-33 remains `INSUFFICIENT EVIDENCE TO CLASSIFY` with six `—` cells and `Low` confidence, on the narrowed grounds below. Recognising these static properties is **not** a finding that §3.3 or §3.4 is satisfied, and **not** an operational validation: no trigger was executed, no transition was exercised, and no behaviour was observed.
    >
    > **What remains indeterminate, narrowed to what the composition does not settle.** The observed composition supports an approved-baseline-plus-approved-change-orders structure with approval gating and post-approval monetary immutability. It does **not** establish correspondence to §3.3/§3.4 in four specific respects. (a) **Anchoring.** §3.3's Original Financial Baseline is an artifact fixed by its own authorization; what is observed is a *query* re-evaluated per call over mutable row state. Because `supersededBy` is written at version **creation** rather than at version **approval** (`estimate-version-db.ts:172–175`), the row set the resolver selects from changes before any second approval occurs, and the filter admits no reference to a specific authorization event. Whether the two coincide is a question about the model, not about execution — and the composition does not answer it. (b) **Layer identity.** §3.3 requires each Approved Change Order to yield **exactly one** immutable, separately traceable Approved Change Layer. Approved change orders are observable and the trigger protects their money, but no Change Layer entity, no one-to-one binding, and no separate traceability record is observed — `getProjectBudgetLines` tags lines `fromChangeOrder: true` without identifying *which* change order a line belongs to. (c) **Baseline kinds: an approved-scope surface exists; the authorized package around it does not.** §3.3's Original Scope Baseline is "the initially reviewed and approved scope version. Immutable after its authorization" (§3.3, the **Original Scope Baseline** row). A scope approval surface **is** observed, and is recorded in the evidence cell: `approveOrReject` (`server/scope-review-router.ts:238–283`) is an `adminProcedure` with a Zod input, gated by `requireEntityAccess("scopeDraft", …, "approve")` (245) and by the state machine `validateTransition` (253–262); `transitionDraftStatus` (`server/scope-review-db.ts:128–145`) then writes `approvedBy` and `approvedAt` on approval, or `rejectedBy`, `rejectedAt` and `rejectionReason` on rejection. A snapshot surface is observed too: `createReviewSnapshot` (`server/scope-review-db.ts:254–283`, called at `server/scope-review-router.ts:358–368`) inserts into `scopeReviewSnapshots` with `approvedItems`, `deltaChanges`, `approvedBy`, `approvedAt`, `decision` and `deltaCount`. **What is not established is the rest of §3.3's structure around them.** The snapshot is **not shown to be immutable, and is not treated as such by name** — nor is it shown to be mutated; both remain unestablished. Four separable facts, kept apart: (i) a helper that can change a snapshot exists — `updateSnapshotBundleId` (`server/scope-review-db.ts:326–339`); (ii) it is imported by the router (`server/scope-review-router.ts:35`, from `./scope-review-db` at line 37); (iii) **no call to it is observed anywhere in `server/` or `shared/`** — the only other references at this SHA are an existence-only assertion in `server/sprint14-scope-review.test.ts:522–524` and a line in `todo.md`; and (iv) the inspected flow creates the snapshot with `bundleId: null` (`server/scope-review-router.ts:359–368`), under a comment reading "bundleId will be updated after bundle creation" (358) — a statement of intent, not an observed call. The helper's `.set({ bundleId })` (335) would alter **only** that column; it does not touch `approvedItems` or `deltaChanges`. Separately, no database trigger on `scope_review_snapshots` or `scope_drafts` was found in `drizzle/*.sql`, unlike `estimate_drafts` — **which is not evidence that no protection exists**, only that none of this kind was observed within this evidence scope. Taken together, §3.4's "immutable after their authorization" is neither evidenced nor contradicted for this artifact. Nor is any snapshot designated *the* Original Scope Baseline, or bound one-to-one to a financial baseline: `estimateDrafts.scopeDraftId` (`drizzle/schema.ts:779`) links an estimate to a **draft**, not to an approved snapshot.
    >   > **Correction record (§5.8) — the bundleId citation.** *Previously stated, now superseded:* "`updateSnapshotBundleId` … **performs an unguarded `UPDATE` on a created snapshot row**, so §3.4's 'immutable after their authorization' is not evidenced", and "the snapshot's own `bundleId` **is filled in afterwards**". *Now stated:* the four separated facts above. *Why:* both sentences reported an update as occurring in the flow. The helper is defined and imported, but **no call site exists**; the only support for the update was the helper's existence and an intent comment, which is the same defect — code presence read as execution — that this footnote corrects elsewhere. The earlier wording also let the absence of a trigger stand as absence of all protection. *Evidence:* `server/scope-review-db.ts:326–339`; `server/scope-review-router.ts:35, 37, 358–368`; `server/sprint14-scope-review.test.ts:522–524`; and a repository-wide query for `updateSnapshotBundleId` at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* this citation within clause (c). *What this does not imply:* **C-33 remains `INSUFFICIENT EVIDENCE TO CLASSIFY` with `Low` confidence**, sustained by the incomplete correspondence to the canonical package set out in clauses (a)–(d) — not by any claim that the snapshot is mutated. It is **not** a finding that the snapshot is immutable, **not** a finding that it is mutable, and **not** an operational validation; and no earlier finding already resolved in this footnote is reopened. Beyond that, no surface is observed for the **Accepted Commercial Package**, the **Execution Baseline** or the **Current Authorized Baseline** as distinct §3.3 concepts — and §3.3 defines the Execution Baseline as activated by an Execution Authorization gate that C-22 already records as unestablished.
    >   > **Correction record (§5.8) — the scope-surface claim.** *Previously stated, now superseded:* "No surface is observed for the **Original Scope Baseline**, … ; **what is present is a financial-side aggregation only**." *Now stated:* clause (c) above. *Why:* the claim was false as written. A scope approval flow with recorded approver and timestamp, and a snapshot of approved items, are both present at the base SHA and were simply not inspected in the passes that wrote and repeated that sentence — an absence of inspection reported as an absence of code, the same defect this footnote corrects elsewhere. The indeterminacy survives, but it now rests on the missing immutability evidence and the missing bindings, not on a denial that any scope surface exists. *Evidence:* `server/scope-review-router.ts:238–283, 358–368`; `server/scope-review-db.ts:128–145, 254–283, 326–339`; `drizzle/schema.ts:779`; the absence of any trigger on `scope_review_snapshots` or `scope_drafts` in `drizzle/*.sql`; and §3.3's **Original Scope Baseline**, **Execution Baseline**, **Approved Change Layer** and **Current Authorized Scope Baseline** rows, with §3.4, of this document — at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* clause (c) of this footnote and the C-33 evidence cell. *What this does not imply:* **C-33 remains `INSUFFICIENT EVIDENCE TO CLASSIFY` with six `—` cells and `Low` confidence**, on the four narrowed grounds in this paragraph — not for want of authorization to change it. Recognising these surfaces is **not** a finding that the Original Scope Baseline is implemented, **not** a claim that the snapshot is or is not mutated in practice, and **not** an operational validation: nothing was executed.
    >
    > (d) **Rules not expressible in composition.** §3.4's requirements that a Current Authorized Baseline change *only* by adding a layer, that existing layers are never edited, and that a variance is a measurement and never a correction, are statements about permitted operations over time; the trigger constrains monetary columns on `estimate_drafts` but does not, on its face, establish these. Resolving any of the four clauses (a)–(d) either way from what is present would be inference beyond the evidence.
    > **Correction record (§5.8).** *Previously stated, now superseded:* C-33 `current_repository_capability` "No surface observed", all six layers `A`, and `implementation_status: Missing`. *Now stated:* the evidence description above, layer cells `—`, and `INSUFFICIENT EVIDENCE TO CLASSIFY`. *Why:* `Missing` is defined in 4.4.9 as *"no surface observed at this SHA and evidence scope"*. That is contradicted by the three functional regions cited above, which were present at the base SHA and not previously examined. The accurate disposition is the one 4.4.2 already provides for this exact situation — *"a surface exists but its correspondence to the canonical definition cannot be established from authorized read-only evidence"* — which is the disposition already applied to C-22 and C-29. *Evidence:* the files and line ranges above at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-33 View A row and the totals and distributions that count it; `evidence_confidence` is treated separately in footnote 31. *What this does not imply:* this is **not** a promotion. `INSUFFICIENT EVIDENCE TO CLASSIFY` is not a maturity level and ranks above nothing; C-33 is **not** `Implemented` and **not** `Connected in Repository`. No binding definition in 4.4.2, §3.3 or §3.4 is amended. No layer is assigned `P`, `A` or `N/A`, because none has an independent basis once capability correspondence is unestablished — the same representation used for C-22 and C-29. `operational_validation`, `security_status`, `verification_state`, `lifecycle_state` and `roadmap_horizon` are unchanged, and this is **not** a claim that baseline management exists, is correct, or is absent.
    > **Distinguished from the neighbouring `Missing` rows, re-examined in this pass by tracing data to its origin.**
    > - **C-32 (Forecast / Estimate at Completion).** `forecastRevenue` (`shared/analytics-aggregation-engine.ts:215–286`) is called at `server/analytics-db.ts:204` and `:248`. Its `backlog` argument is **not** opaque: `analytics-db.ts:206–235` selects `projects.approvedBudgetCents`, `projects.changeOrderBudgetCents` and `projects.committedCostCents` for active projects, then builds each `BacklogItem` as `contractValueCents = approvedBudgetCents + changeOrderBudgetCents` (227–228) and `billedToDateCents = committedCostCents` (232). Tracing those three fields to their writers: `approvedBudgetCents` is `toCents(budget.finalTotalPrice ?? budget.subtotalPrice)` where `budget` is the approved baseline estimate, and `changeOrderBudgetCents` is the sum of `listApprovedChangeOrders(...)` — both written together at `server/field-operations-db.ts:911–927` under the comment "Recompose the available budget: baseline + Σ approved change orders"; `committedCostCents` is written at `server/actuals-db.ts:745–759` as the sum of `project_cost_actuals` rows passing `isActualCommitted(...)`, and the same statement stores that figure as `actualTotal`. **Authorized-baseline-derived and actual-cost-derived amounts therefore do reach this function.** The engine then computes, per backlog item, `pctComplete = billed / contract × 100` when no explicit `percentComplete` is supplied — which is the case here — and `unearned = contract − contract × pctComplete/100` (226–243), bucketed by the project's expected completion month and added to weighted pipeline value (245–258). **Whether this composition is the §3.3 projection is not settled here; it is treated in footnote 33**, which sets out the static facts and the three correspondence questions they leave open. C-32 is therefore recorded as `INSUFFICIENT EVIDENCE TO CLASSIFY`, and the observed projection remains reachable through C-35 under §3.9 monitoring.
    >   > **Correction record (§5.8) — the "two of four" rationale.** *Previously stated, now superseded:* "Of those four, the inspected flow supplies two and does not supply two … **Commitments — not supplied** … **Remaining work — not supplied:** the engine receives no assessment of work remaining … A quantity inferred by subtraction from baselines and actuals is not a fourth input; it is a restatement of the first two", and the conclusion "On that basis — two of four required components absent — C-32 remains `Missing`". *Now stated:* the referral to footnote 33 above, and the disposition recorded there. *Why:* that rationale added requirements the canonical text does not carry. §3.3 asks for a projection **combining** authorized baselines, actuals, commitments and remaining work; it does not require four arguments, four independent aggregates, four independent sources, or that remaining work be supplied rather than computed. It also treated a derived value (`unearned`) as an absent one, and treated the commitments correspondence — which the same footnote called unsettled — as a determinate absence. *Evidence:* §3.3's **Forecast / Estimate at Completion** row and §3.4 of this document; `shared/analytics-aggregation-engine.ts:184–185, 215–286`; `server/analytics-db.ts:196–249`; `shared/domain/phase3-taxonomy.ts:236, 252, 526–528` at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-32 rationale in this footnote only. *What this does not imply:* no canonical definition is amended — §3.3 and §3.4 are quoted, not revised; C-31 is unaffected and remains `Missing` on its own evidence; and the reclassification of C-32 is **not** a promotion, as footnote 33 records.
    >   > **Correction record (§5.8) — the EAC formulation.** *Previously stated, now superseded:* "**whereas §3.3 defines Forecast / Estimate at Completion as a projection of *cost at completion***. No cost-at-completion figure and no remaining-work cost estimate is produced", and the framing that "the distinction is in the quantity projected, not in the data available". *Now stated:* the component-by-component comparison above. *Why:* §3.3's **Forecast / Estimate at Completion** row in this document reads "a projection combining authorized baselines, actuals, commitments, and remaining work" and **contains no phrase "cost at completion"**. The superseded sentence rewrote the canonical definition to fit the observed code, then judged the code against the rewrite — the error runs in the opposite direction from the one it replaced, but it is the same error. Revenue-versus-cost is not the operative test; the four named components are. *Evidence:* §3.3 line 229 and §3.4 of this document; `shared/analytics-aggregation-engine.ts:179–187, 208–213, 226–243, 275–285`; `server/analytics-db.ts:225–235` — repository files at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-32 rationale in this footnote only. *What this does not imply:* **C-32 remains `Missing`** — the corrected test is not weaker, it is the one the document specifies. No canonical definition is amended; §3.3 and §3.4 are quoted, not revised. Nothing here evaluates whether the revenue projection is correct, and no cell, total or distribution changes.
    > - **On `committedCostCents` and canonical commitments.** The name is not taken as evidence, and neither is its absence. `isActualCommitted` (`shared/domain/phase3-taxonomy.ts:526–528`) tests membership of `ACTUAL_COMMITTED_STATUSES = ["approved", "paid"]` (line 252) over `ACTUAL_STATUSES = ["pending", "approved", "paid", "rejected", "void"]` (line 236), and the field is written at `server/actuals-db.ts:745–759` by summing `project_cost_actuals` rows that pass that test — **the same statement storing the identical figure as `actualTotal`**. Its observed derivation is therefore an aggregate over recorded cost rows, and §3.4 already classes such rows as actuals: "Actuals record what was spent." Whether a row in `approved` status also answers to "Commitments record what was obligated" is not settled by this derivation, and is not asserted either way here; what the derivation does establish is that this figure is **not a second, independent component** — the flow reads one cost aggregate and uses it once. Because that reading is unsettled, **no determinate finding about the commitments component of §3.3 is drawn from it here**; the question is carried, with the other two, in footnote 33. What the derivation does establish is narrower: the flow reads this one cost aggregate once.
    >   > **Correction record (§5.8) — the commitments formulation.** *Previously stated, now superseded:* the field aggregates "money already incurred — **not obligations entered into and not yet incurred, which is what §3.3 and §3.4 mean by commitments**". *Now stated:* the derivation-based reading above. *Why:* §3.4's text is "Commitments record what was obligated"; it does **not** say "not yet incurred", and neither does §3.3. The superseded sentence narrowed the canonical definition to make an exclusion follow. A later pass removed the exclusion altogether: "one cost aggregate, read once, not a distinct commitments input" was itself still a determinate finding drawn from an unsettled reading, and is **superseded** by footnote 33, which carries the question open. *Evidence:* §3.4 of this document; `shared/domain/phase3-taxonomy.ts:236, 252, 526–528`; `server/actuals-db.ts:745–759` at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* this commitments rationale only. *What this does not imply:* **C-31 and C-32 remain `Missing`**; no canonical definition is amended; and no claim is made that `approved`-status actual rows are, or are not, commitments in the §3.4 sense — that reading is left open rather than settled by this pass.
    > - **C-31 (Commitments and purchase obligations).** Re-checked with a broader query than the earlier pass used, over `server/`, `shared/` and `drizzle/schema.ts` for `purchase`, `procure`, `vendorOrder`, `subcontract agreement`, `obligation` and `commit`. The matches resolve to the actual-cost aggregate described above, to subcontractor performance metrics, and to unrelated word stems; **no purchase-order, vendor-commitment or obligation record is observed** — no such table in `drizzle/schema.ts` and no module owning one. `Missing` stands, on that derivation rather than on the absence of a keyword.
    >
    > **Correction record (§5.8) — the forecast-data claim.** *Previously stated, now superseded:* "`forecastRevenue` … takes `{ backlog, pipeline, months }` — **no authorized baseline, no actuals, no commitments** — so it is not the §3.3 concept". *Now stated:* the traced derivation above. *Why:* that sentence inferred the content of the data from the **names of the parameters** and stopped at the call site. Following the values to their writers shows the opposite for two of the three: authorized-baseline-derived amounts (`approvedBudgetCents + changeOrderBudgetCents`) and actual-cost-derived amounts (`committedCostCents`) both reach the function. Only the commitments clause survives, and it survives on the taxonomy definition rather than on the parameter list. *Evidence:* `server/analytics-db.ts:206–248`; `shared/analytics-aggregation-engine.ts:215–286`; `server/field-operations-db.ts:911–927`; `server/actuals-db.ts:745–759`; `shared/domain/phase3-taxonomy.ts:236, 252, 526–528` — all at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-32 and C-31 rationales in this footnote only. *What this does not imply:* **C-32 and C-31 remain `Missing` and are not reclassified in this pass**; the corrected rationale narrows the ground for `Missing` from "the data is absent" to a distinction in canonical correspondence. *(The formulation that pass used for that distinction — "the projected quantity is revenue, not cost at completion" — is itself **superseded** by the EAC correction record above, which tests against the four components §3.3 names.)* Nothing here evaluates whether the revenue projection is correct, and no `implementation_status`, layer, confidence or total changes for either row.
33. **C-32 — `Missing` → `INSUFFICIENT EVIDENCE TO CLASSIFY`.** §3.3 defines the **Forecast / Estimate at Completion** as "a projection combining authorized baselines, actuals, commitments, and remaining work. Separate from every baseline above." A projection surface answering to that description in part is observed at `5c29fd07535695566adc6bcb556b529ac94987ca`, and whether it answers to it in full cannot be established from composition.
    > **Static facts — what reaches the calculation, how it is derived, what it produces.** `forecastRevenue` (`shared/analytics-aggregation-engine.ts:215–286`) is reached from `getRevenueForecast` (`server/analytics-db.ts:196–249`).
    > - *Values entering the calculation.* Each `BacklogItem` is built at `analytics-db.ts:225–235` from an active project's own columns: `contractValueCents = approvedBudgetCents + changeOrderBudgetCents` (226–228) and `billedToDateCents = committedCostCents` (232). Those columns are themselves derived, not free-standing: `approvedBudgetCents` is `toCents(budget.finalTotalPrice ?? budget.subtotalPrice)` for the approved baseline estimate and `changeOrderBudgetCents` is the sum over `listApprovedChangeOrders(...)`, both written at `server/field-operations-db.ts:910–927` under the comment "Recompose the available budget: baseline + Σ approved change orders"; `committedCostCents` is written at `server/actuals-db.ts:745–759` as the sum of `project_cost_actuals` rows passing `isActualCommitted(resolveActualStatus(...))`, the same statement also storing that figure as `actualTotal`. Pipeline items are supplied separately (237–246).
    > - *How progress and the unearned balance are derived.* `percentComplete` is an optional field on `BacklogItem` (`analytics-aggregation-engine.ts:184–185`) that this caller does not set, so the engine takes the second branch: `pctComplete = contract > 0 ? clamp(0,100, (billed / contract) × 100) : 0` (231–236), and `unearned = max(0, contract − round(contract × pctComplete / 100))` (238), accumulated into `unearnedBacklogCents` (239) and bucketed by `expectedCompletionMonth` (241–242). Pipeline value is weighted by `PIPELINE_STAGE_WEIGHTS[stage] ?? 0.1` (251–252).
    > - *What the flow produces.* `totalForecastCents = unearnedBacklogCents + weightedPipelineCents` (273), returned with `backlogCents`, `unearnedBacklogCents`, `weightedPipelineCents`, `byMonth` and a `summary` (275–285).
    >
    > **Correspondence that cannot be established.** Three questions decide whether this is the §3.3 projection, and composition answers none of them. (a) **Remaining work.** `unearned` *is* a remaining-balance quantity, computed rather than passed in — and §3.3 requires the projection to combine remaining work, not to receive it as a separate input. Whether a balance obtained as `contract − earned`, where progress is inferred from a cost-to-contract ratio, is "remaining work" in the canonical sense, or a different quantity that happens to share its shape, is a semantic judgment the code does not settle. (b) **Commitments.** Whether the committed-cost aggregate corresponds to §3.4's "Commitments record what was obligated" is likewise unsettled: it is built from actual-cost rows in `approved` or `paid` status (`shared/domain/phase3-taxonomy.ts:236, 252, 526–528`) and is stored alongside `actualTotal`, so it may answer to actuals, to commitments, to both under this schema's conventions, or to neither as §3.3 intends them — and the same value is read once, so composition cannot show whether the model treats the two components as distinct. (c) **The projection as a whole.** With (a) and (b) unresolved, whether the composition establishes the complete canonical projection is unresolved with them. Deciding any of the three from what is present would be inference from naming and shape, which 4.4.2 forbids.
    >
    > **Correction record (§5.8).** *Previously stated, now superseded:* the C-32 evidence cell "**No surface observed**", all six layers `A`, `implementation_status: Missing`, and the rationale that the flow supplies "two of four" §3.3 components with "commitments — not supplied" and "remaining work — not supplied … a quantity inferred by subtraction … is not a fourth input". *Now stated:* the evidence cell as it now reads, six `—` layer cells, `INSUFFICIENT EVIDENCE TO CLASSIFY`, and the analysis above. *Why:* the superseded rationale added requirements §3.3 does not contain. §3.3 asks for a projection **combining** four things; it does not require four arguments, four independent aggregates, four independent sources, or that remaining work be passed in rather than computed. Treating a derived value as an absent one, and treating a correspondence expressly called indeterminate as a determinate absence, are the two errors it rested on — and "no surface observed" was contradicted by the projection itself. 4.4.2 already provides the accurate disposition for a surface whose correspondence to a canonical definition cannot be established from authorized read-only evidence; that is the disposition applied here, as for C-22, C-29 and C-33. *Evidence:* the files and line ranges above at `5c29fd07535695566adc6bcb556b529ac94987ca`, and §3.3's **Forecast / Estimate at Completion** row with §3.4 of this document. *Scope:* the C-32 View A row, and the totals and distributions that count it; `evidence_confidence` is treated separately in footnote 34. *What this does not imply:* this is **not a promotion**. `INSUFFICIENT EVIDENCE TO CLASSIFY` is not a maturity level and ranks above nothing; C-32 is **not** `Implemented` and **not** `Connected in Repository`, and no layer is assigned `P`, `A` or `N/A`, because none has an independent basis once capability correspondence is unestablished. It is **not** a finding that the canonical Forecast / Estimate at Completion is implemented, **not** a finding that it is absent, and **not** an operational validation — nothing was executed. No canonical definition, binding rule or classification rule is amended, and `operational_validation`, `security_status`, `verification_state`, `lifecycle_state` and `roadmap_horizon` are unchanged. The observed projection remains reachable through C-35, whose §3.9 target semantics — monitoring informs, never authorizes — are untouched.
32. **C-20 and C-21 — evidence-cell wording narrowed; `Missing` unchanged.** `drizzle/schema.ts:550–617` declares `leadProposals` (550–566, including `signatureUrl` at 559), `proposals` (572–585, including `signedUrl` at 579) and `proposalAccessLog` (607–617). A query over `server/` and `shared/` for those table identifiers returns no read or write of any of them at this SHA: every textual match resolves to the unrelated `AdjustmentProposal` concept in `price-adjustment-db`/`price-adjustment-router`, or to prose in comments. **Declared tables and columns are not an issuance or an acceptance operation**, and §3.2 defines Proposal Issuance as a proposal having been *transmitted* to the client and Commercial Acceptance as the client having *accepted* the commercial terms — transmission and acceptance events, neither of which is observed. `Missing` therefore stands for both, and 4.4.9's definition of `Missing` — "no surface observed at this SHA and evidence scope" — is met for the canonical operations.
    > **Correction record (§5.8).** *Previously stated, now superseded:* the C-20 and C-21 `current_repository_capability` cells read "**No surface observed**". *Now stated:* the cells as they now read, restricting the finding to the canonical §3.2 operations. *Why:* the unqualified phrase denied structures that exist in the schema. The classification is unaffected, but the evidence description was broader than the evidence. *Evidence:* `drizzle/schema.ts:550–617` and the absence of any `server/` or `shared/` operation on those tables, at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-20 and C-21 evidence cells only. *What this does not imply:* **both rows remain `Missing`** with all six layers `A`; no layer, status, confidence, total or distribution changes. This pass did **not** open a wider investigation of these two capabilities, and the schema structures listed here were not traced beyond establishing that no module operates on them.
26. **P (L5, C-28) — corrected from `A`.** `server/field-operations-db.ts:53` imports `assessCompliance` and `evaluateAssignmentEligibility` from `shared/subcontractor-performance-engine`, and invokes them at lines 525–538. This is a downstream consumer outside C-28's own router and establishes L5 under the unchanged §4.4.2 rule.
    > **Correction record (§5.8).** *Previously stated, now superseded:* C-28 L5 `A`; Section 8 recorded the edge as unresolved. *Now stated:* C-28 L5 `P`, with the engine consumer included in the evidence cell. *Why/evidence:* the direct import and invocations above at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* C-28 L5 and its evidence description only, under the user-authorized next correction pass. *Non-claims:* L1 remains `A`, so `implementation_status` remains `Implemented`; no other dimension or security verdict changes. The earlier unresolved record is retained as explicitly superseded history in Section 8.

#### 4.4.4 View A — Capability Evidence View: Cross-Cutting Platform capabilities

| capability_id | canonical_name | current_repository_capability (at base SHA) | L1 | L2 | L3 | L4 | L5 | L6 | implementation_status |
|---|---|---|---|---|---|---|---|---|---|
| P-01 | Identity and authentication | `auth-router` mounted with 3 zero-input procedures (`me`, `session`, `logout`); `identity-db`; consumed by `_core/auth/supabase-auth`, `_core/oauth`, `_core/sdk`; `identity-db` itself imports `server/db.ts`¹⁸; client `auth` | P | P | N/A¹ | P | P | N/A⁸ | Connected in Repository |
| P-02 | Authorization and RBAC | `rbac-router` mounted; `server/rbac.ts`, which imports `server/db.ts` and the `roles`, `permissions`, `rolePermissions`, `users` schema tables; consumed directly by `auth-router`, `project-access`, `rbac-router`²⁷ | N/A⁹ | P | N/A¹ | P¹² | P | P | Connected in Repository |
| P-03 | Tenancy and tenant scoping | `server/tenant-scope.ts`, `server/tenant-coverage-audit.ts`, `shared/tenant-provisioning-engine`; `tenant-scope` imported by 13 `-db` modules and `server/audit-trail.ts`; `tenant-coverage-audit` imported by `tenant-settings-router` and `scripts/tenant-coverage-audit.ts`; `tenant-provisioning-engine` imported by `tenant-settings-db`¹⁹ | N/A⁹ | P²⁴ | P | P¹³ | P | P¹⁴ | Connected in Repository |
| P-04 | Tenant settings and configuration | `tenant-settings-router` mounted; `tenant-settings-db`; consumed by `analytics-db`, `calibration-db`, `price-adjustment-db` | A | P | N/A¹ | P | P | P | Implemented |
| P-05 | Audit and audit trail | `audit-router`, `audit-trail-router` mounted; `server/audit-trail.ts`; consumed by `analytics-db`, `calibration-db`, `price-adjustment-db`, `scope-completeness-db`, `tenant-settings-db` | A | P | N/A¹ | P | P | P | Implemented |
| P-06 | Data access layer | `server/db.ts`; `drizzle/` schema, relations, migrations; consumed repository-wide | N/A⁹ | P²⁵ | N/A¹ | P | P | P¹⁵ | Connected in Repository |
| P-07 | Platform reference data (geo override) | `geo-override-router` mounted; `geo-override-db`; `shared/geo-override-engine`, `shared/geo-override-seed`; client `geoOverride`; consumed by `workflow-visualization-router` | P | P | P | P | P | P | Connected in Repository |
| P-08 | Draft recovery | `draft-recovery-db`; consumed by `estimate-router`, which exposes 5 draft-recovery procedures on the mounted `estimate` namespace | N/A⁹ | P²⁰ | N/A¹ | P | P | P¹⁶ | Connected in Repository |
| P-09 | Evidence and provenance substrate | Pricing dimension sources, generated context snapshots and JSON export provenance fields observed; correspondence to the complete §3.11 substrate not established (bounded correction, §9) | — | — | — | — | — | — | INSUFFICIENT EVIDENCE TO CLASSIFY |
| P-10 | Export and transmission | `jobtread-export-db`; consumed by `estimate-router`, which exposes 6 export procedures on the mounted `estimate` namespace; client entry point `EstimateDetail.tsx`²¹ | P²² | P²³ | N/A¹ | P | P | P¹⁷ | Connected in Repository |

**Layer rationales**

1. **N/A (L3)** — as in 4.4.3: no dedicated domain engine is expected for this capability class.
8. **N/A (L6, P-01) — evidence-based architectural rationale.** `auth-router.ts` at the base SHA exposes exactly three procedures — `me`, `session`, `logout` — and **all three accept no input**: the file contains zero `.input(` calls, against 12 in `lead-router`, 30 in `estimate-router`, 9 in `project-router`, and 3 in `rbac-router`. Deterministic input validation is therefore **not applicable to this surface, because it has no input surface to validate**. The absent Zod reference count is the correct consequence of a zero-input router, not a validation gap. An earlier revision recorded this layer as ABSENT on the Zod count alone; that reading is superseded by direct inspection of the module. The general `Connected in Repository` rule in 4.4.2 is unchanged and was not relaxed — this row satisfies it through the rule's existing NOT APPLICABLE branch, on stated architectural evidence.
   > **Bounded to this layer.** This rationale establishes only that L6 does not apply to `auth-router`'s three procedures. It makes **no** claim about authentication correctness, session handling, token validation, or any check performed in the `_core/auth` layer, which was not inspected.
9. **N/A (L1)** — cross-cutting platform capability consumed by server-side code; no dedicated user entry point is expected by the architecture.
10. **SUPERSEDED HISTORY — former L2 rationale; no active row cites this note.** Previously: "the capability is a library or persistence module consumed directly by other server modules, not exposed as its own router. This is architecturally intentional for a cross-cutting concern." The dedicated-router requirement was not in §4.4.2. Footnotes 20, 23, 24 and 25 supersede this rationale for P-08, P-10, P-03 and P-06 respectively; the binding rule itself is unchanged.
12. **P (L4, P-02) — corrected from `N/A` on inspected evidence, by explicit human decision.** L4 in 4.4.2 is PRESENT on any one of three criteria; the second is *an observed import of `server/db.ts` plus a Drizzle schema table*. `server/rbac.ts` (206 lines) at the base SHA satisfies it directly: line 16 `import { getDb } from "./db";`, lines 17–24 `import { roles, permissions, rolePermissions, users, type Role, type Permission } from "../drizzle/schema";`, with reads against those tables at lines 46–47, 55–56, 64–68, 105, 114, 127–128, 135–142, 162–163 and 189–201, and one mutation at lines 170–175 — a chained `db` call whose `.update(users)` appears at line 171 and whose `.set({ role: roleName })` spans lines 172–174, filtered by `.where(eq(users.id, userId))` at line 175. This is the same shape footnote 3 already records for C-17 and C-27.
    > **Correction record (§5.8).** *Previously stated:* `N/A (L4, P-02)`, on the reading that the absence of a dedicated `rbac-db` module made the layer inapplicable. *Now stated:* `P (L4, P-02)`, on the evidence above. *Why:* that reading ignored the other two PRESENT criteria in the 4.4.2 L4 definition. *Evidence:* `server/rbac.ts` at `5c29fd07535695566adc6bcb556b529ac94987ca`, lines listed above. *Scope:* the P-02 L4 cell only. *What this does not imply:* `implementation_status` is unchanged — 4.4.2 admits L4 PRESENT *or* NOT APPLICABLE, so P-02 satisfied `Connected in Repository` before and after, and the totals in 4.4.8 are unchanged. No other cell, capability, dimension, or status is altered, and this is **not** a security evaluation of RBAC.
13. **P (L4, P-03) — corrected from `N/A` by application of the binding L4 rule as written, by explicit human decision.** The third PRESENT criterion in the 4.4.2 L4 definition is *an observed derivation-only boundary*. `server/tenant-scope.ts` (93 lines) is exactly that, and the boundary is observed directly: it imports only `drizzle-orm` operators (line 13: `and, eq, isNull, or, type SQL`) and `type PgColumn` (line 14), contains no `getDb` and no `drizzle/schema` import, and its whole exported surface derives persistence constraints for other modules to apply — `tenantFilter` builds the tenant predicate (lines 32–44), `tenantWhere` composes it with domain conditions (lines 50–62), `withTenant`/`withTenantAll` stamp `tenantId` onto insert payloads (lines 65–80), and `assertSameTenant` compares a loaded row's tenant to the caller's (lines 86–93). At this SHA **13** `-db` modules import `tenant-scope` — `actuals-db`, `analytics-db`, `calibration-db`, `closeout-db`, `daily-log-db`, `estimate-db`, `field-operations-db`, `intake-db`, `price-adjustment-db`, `project-db`, `scope-completeness-db`, `subcontractor-db`, `tenant-settings-db` — together with `server/audit-trail.ts`, giving 14 non-test importers in total (15 counting `server/phase1-tenant-csp.test.ts`). The other two modules in the capability hold no state either: `server/tenant-coverage-audit.ts` (366 lines) imports only `fs` and `path` (lines 23–24), its header (lines 9–15) states all three of its checks are static analysis over the repository's own files, and its one mention of `drizzle/schema.ts` (line 136) is a doc comment about a file it reads as text; `shared/tenant-provisioning-engine.ts` (577 lines) declares at line 20 "PURE module: no DB, no IO, no clock (timestamps arrive as arguments), no randomness", and its complete import list is `./domain/phase4-taxonomy` (lines 23–37), `./constants/profit-shield` (lines 38–43), `type { CommercialChannel }` from `./domain/phase2-taxonomy` (line 44) and **`round1` from `./calibration-engine` (line 45)** — no `getDb`, no `drizzle/schema`.
    > *A prior revision's description of that module is corrected here:* it stated that `tenant-provisioning-engine` "imports only taxonomy and constants". That is incomplete — line 45 imports the `round1` helper from `shared/calibration-engine.ts`, a fourth import that is neither a taxonomy nor a constants module. The corrected statement is the full import list above. The engine's L4-relevant property is unchanged: it opens no persistence boundary, and `calibration-engine` is a `shared/` module, not a data-access one. Reproduced by reading `shared/tenant-provisioning-engine.ts` lines 23–45 at the base SHA.
    > **Correction record (§5.8).** *Previously stated:* `N/A (L4, P-03)` — that none of the three modules opens a persistence boundary of its own, and that the capability "holds no state itself", with an accompanying note recording the derivation-only criterion as an unresolved tension. *Now stated:* `P (L4, P-03)`. *Why:* the binding L4 definition in 4.4.2 makes an observed derivation-only boundary a PRESENT criterion, and `tenant-scope` is observed to be one. The underlying observations were correct; the classification drawn from them was not. The recorded tension is thereby resolved **by applying the rule as written**, not by amending it. *Evidence:* the files and line ranges above, at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the P-03 L4 cell only. *What this does not imply:* the L4 rule in 4.4.2 is **not** amended, broadened or weakened. `implementation_status` is unchanged and the totals in 4.4.8 are unchanged. It is **not** a claim that tenant isolation is correct, complete, or secure; `security_status` for P-03 remains `Not Evaluated`.
    >
    > *A prior revision's arithmetic is corrected here:* that revision stated "14 `-db` modules import `tenant-scope` at this SHA". The observed count of `-db` modules is **13**; 14 is the count of non-test importers of any kind, which additionally includes `server/audit-trail.ts`. Reproduced by `git grep -l -E "from \"[^\"]*tenant-scope\""` at the base SHA. No classification depended on the number.
14. **P (L6, P-03) — corrected from `N/A`.** The mounted `tenantSettings` router imports Zod at `server/tenant-settings-router.ts:20`. Its `provision` procedure carries a Zod input schema at lines 247–263 and passes parsed inputs to `provisionTenant` at lines 264–276. That function invokes the P-03 engine's `buildTenantProvisionPlan` at `server/tenant-settings-db.ts:587–596`; the engine import is at lines 26–41. The same router exposes the zero-input `coverageAudit` at lines 288–289. The observed Zod schema on the provisioning path establishes L6 under §4.4.2; no claim is made that the zero-input audit has an input schema.
    > **Helper-signature precision.** At the base SHA, `tenantFilter(table, tenantId)` takes a `TenantScopedTable` and nullable tenant identifier (`server/tenant-scope.ts:32–35`); `tenantWhere(table, tenantId, ...conditions)` additionally takes `SQL | undefined` conditions (50–54). `withTenant(values, tenantId)` takes a record (65–68); `withTenantAll(rows, tenantId)` takes records (75–78); `assertSameTenant(rowTenantId, tenantId)` takes two nullable identifiers (86–89). These five signatures do not all take Drizzle objects. `isStrictTenantMode` accepts an environment-shaped argument, defaulting to `process.env` (25–29); this is a source observation, not environment access. The provisioning engine exports typed functions; `tenant-settings-db.ts:26–41` imports them, while representative actual invocations are `defaultFeatureFlags()` at line 141 and `buildTenantProvisionPlan(...)` at lines 587–596.
    > **Audit arguments.** `auditSchemaTenantCoverage(schemaSource?: string)` (142–143), `auditQueryTenantScoping(serverDir?: string)` (222–223), and `auditRouterTenantContext(serverDir?: string)` (279–280) accept direct arguments and default to repository paths. `runTenantCoverageAudit` accepts an optional options object whose `checkedAt` field is required when that object is supplied; omitting the object supplies a current-clock default (324–328). The mounted router passes no arguments (289); `scripts/tenant-coverage-audit.ts:11` passes a clock-derived `checkedAt`. These are source-level observations of those two call sites only.
    > **Correction record (§5.8).** *Previously stated, now superseded:* `N/A (L6, P-03)` because validation was upstream and did not apply at the internal modules; all five helpers were described as taking a tenant identifier plus Drizzle `PgColumn`/`SQL` objects; the engine was described as called at `tenant-settings-db.ts:41`. *Now stated:* L6 `P`, the separate signatures above, and distinct import/invocation citations. *Why/evidence:* the mounted provisioning path and exact signatures above at `5c29fd07535695566adc6bcb556b529ac94987ca`; line 41 is an import, not an invocation. *Scope:* P-03 L6 and footnote 14's factual rationale only; L2 is recorded separately in footnote 24. *Non-claims:* no change to implementation, operational, security, confidence or lifecycle status; no claim of complete or correct input validation.
    > **Retained structural observations, not a security verdict.** `tenantFilter` returns `undefined` when `tenantId` is falsy (`tenant-scope.ts:36`), and `assertSameTenant` returns `true` when `tenantId` is falsy (90). P-03 remains `Not Evaluated`; neither these observations nor the presence of Zod evaluates tenant isolation or alters the B2 position in §4.4.7 and Section 7.
15. **P (L6, P-06) — corrected from `N/A`.** `server/db.ts` itself has zero Zod references and zero `.input(` calls. The relevant boundary is its consuming mounted routers, as for P-08/P-10. Eight routers directly consume `./db` and import Zod: `bundle-router` (9 `.input(`), `catalog-router` (2), `estimate-legacy-router` (3), `issue-report-router` (4), `lead-router` (12), `preset-router` (6), `previsit-router` (8), and `scope-source-router` (7). Footnote 25 records their import and mounting evidence. These router-level schemas establish L6 under §4.4.2; they do not establish validation completeness or runtime behavior.
    > **Data provenance and counts retained.** Some helper arguments originate in Zod-parsed router inputs. The internal module's lack of parsing does not make L6 inapplicable to the capability. The observed count remains **49 non-test server consumers**, including **eight routers**, with `lead-router.ts:65` using dynamic `await import("./db")`.
    > **Correction record (§5.8).** *Previously stated, now superseded:* `N/A (L6, P-06)` because "the validation boundary is elsewhere and is observed there", with the conclusion that validation-at-the-boundary was "the reason the layer is recorded as NOT APPLICABLE here rather than ABSENT". *Now stated:* `P (L6, P-06)`. *Why/evidence:* the eight mounted router modules above contain the Zod references required by §4.4.2 at `5c29fd07535695566adc6bcb556b529ac94987ca`; requiring parsing inside `db.ts` incorrectly narrowed the capability surface. *Scope:* P-06 L6 only; L2 is recorded separately in footnote 25. *Non-claims:* implementation status and all other maturity/governance dimensions and totals remain unchanged; no security or behavioral verdict.
    > **Earlier count correction retained (§5.8).** The prior statements "48 non-test server modules importing `./db`" and "the seven that are themselves routers" are superseded by 49 and eight; the omitted edge was `lead-router.ts:65`. This arithmetic correction does not itself change a classification.
16. **P (L6, P-08) — corrected from `N/A`.** `server/draft-recovery-db.ts` (364 lines) is a persistence module — line 9 `import { getDb } from "./db";`, lines 10–13 Drizzle schema, line 14 `logAudit` — which is why its L4 is PRESENT. The module itself holds **zero** Zod references and **zero** `.input(` calls, but L6 in 4.4.2 asks whether *Zod schema references are observed in the router module* for the capability, and they are: the capability's procedures are exposed on the mounted `estimate` namespace (see footnote 20) and **four of the five carry an explicit Zod input schema** — `listPartialDrafts` `.input(z.object({ scopeDraftId, status, limit, offset }).optional())` (`estimate-router.ts:1106–1115`), `getPartialDraft` `.input(z.object({ id: z.string().uuid() }))` (1123–1124), `retryPartialDraft` (1139–1140) and `abandonPartialDraft` (1195–1196) likewise; the fifth, `partialDraftStats` (line 1216), is zero-input. The router imports Zod at line 17.
    > **Correction record (§5.8).** *Previously stated:* `N/A (L6, P-08)` — that validation was observed at the consuming router but the layer "is not applicable to the persistence module itself". *Now stated:* `P (L6, P-08)`. *Why:* the previous entry silently applied a requirement that the capability own a dedicated router namespace. 4.4.2 states no such requirement; it asks only for Zod schema references in the router module through which the capability is exposed, and those are observed. *Evidence:* `server/estimate-router.ts` at `5c29fd07535695566adc6bcb556b529ac94987ca`, lines 17 and 1106–1216. *Scope:* the P-08 L6 cell only. *What this does not imply:* `implementation_status` is unchanged — 4.4.2 admits L6 PRESENT *or* NOT APPLICABLE — and the totals in 4.4.8 are unchanged. Observing a Zod schema is **not** a claim that the validation is sufficient, correct, or secure.
17. **P (L6, P-10) — corrected from `N/A`.** `server/jobtread-export-db.ts` (617 lines) is likewise a persistence module — line 20 `import { getDb } from "./db";`, lines 21–26 importing the `estimateDrafts` and `jobtreadExports` schema tables, line 27 `logAudit` — with **zero** Zod references and **zero** `.input(` calls of its own. The capability's procedures are exposed on the mounted `estimate` namespace (see footnote 23) and **all six carry an explicit Zod input schema**: `exportCsv` (`estimate-router.ts:828–843`), `exportAuthorization` `.input(z.object({ id: z.string().uuid() }))` (925–926), `exportPreflight` (948–962), `downloadExport` `.input(z.object({ exportId: z.string().uuid() }))` (981–982), `listExports` (1005–1006) and `listProjectExports` `.input(z.object({ projectId: z.string().uuid() }))` (1013–1014). The router imports Zod at line 17.
    > **Correction record (§5.8).** *Previously stated:* `N/A (L6, P-10)` — that the consuming router validates but the layer does not apply to the persistence module. *Now stated:* `P (L6, P-10)`, on the same reasoning as footnote 16: 4.4.2 imposes no dedicated-namespace requirement. *Evidence:* `server/estimate-router.ts` at `5c29fd07535695566adc6bcb556b529ac94987ca`, lines 17 and 828–1014. *Scope:* the P-10 L6 cell only. *What this does not imply:* `implementation_status` and the 4.4.8 totals are unchanged, and observing a Zod schema is **not** a claim that export validation is sufficient, correct, or secure.
18. **P-01 evidence-cell correction (§5.8).** *Previously stated:* the cell listed `identity-db` as "consumed by `_core/auth`, `_core/oauth`, `_core/sdk`, `db`". *Now stated:* the cell names `_core/auth/supabase-auth`, `_core/oauth` and `_core/sdk` as consumers and records the `server/db.ts` relationship in its actual direction. *Why:* the fourth item inverted the import direction. `server/db.ts` does **not** import `identity-db`; its only reference is a doc comment at line 45 pointing readers to `upsertProfileFromOAuth()` in `server/identity-db.ts`. The real edge runs the other way — `server/identity-db.ts:22` `import { getDb } from "./db";`. *Evidence:* at `5c29fd07535695566adc6bcb556b529ac94987ca`, `server/db.ts:45` (comment; the file's only imports are at lines 1–5 and include no `identity-db`), `server/identity-db.ts:22`, and the three consumer imports `server/_core/auth/supabase-auth.ts:26`, `server/_core/oauth.ts:3`, `server/_core/sdk.ts:17`. *Scope:* the P-01 `current_repository_capability` cell only. *What this does not imply:* **no layer classification changes.** L5 was and remains PRESENT on the three real consumer imports, and `implementation_status` is unchanged.
19. **P-03 evidence-cell correction (§5.8).** *Previously stated:* "consumed by `_core/auth/supabase-auth` and 11+ domain modules". *Now stated:* the enumerated consumer set in the cell. *Why:* `server/_core/auth/supabase-auth.ts` does **not** import any of the three modules composing P-03. Its full import list at this SHA is lines 23–31 — `@shared/_core/errors`, `express`, `drizzle/schema`, `../../identity-db`, `./supabase-jwt` — and its only textual match on "tenant-scope" is prose in a comment at line 14. The unsupported consumer claim is removed. *Evidence:* at `5c29fd07535695566adc6bcb556b529ac94987ca`: `server/_core/auth/supabase-auth.ts` lines 14 and 23–31; the 13 `-db` importers plus `server/audit-trail.ts` enumerated in footnote 13; `server/tenant-settings-router.ts:35` and `scripts/tenant-coverage-audit.ts:9` for `tenant-coverage-audit`; `server/tenant-settings-db.ts:41` for `tenant-provisioning-engine`. *Scope:* the P-03 `current_repository_capability` cell only. *What this does not imply:* **no layer classification changes on account of this correction.** L5 was and remains PRESENT on the enumerated real importers, which are more numerous than the "11+" previously claimed, not fewer. It makes no claim about how tenant context reaches `supabase-auth` at runtime, which was not inspected.
20. **P (L2, P-08) — corrected from `N/A`.** The five draft-recovery procedures are exposed through a router that is imported and mounted in the `appRouter` of `server/routers.ts`: `import { estimateRouter } from "./estimate-router";` at line 5 and `estimate: estimateRouter,` at line 91. The procedures are `listPartialDrafts` (`estimate-router.ts:1106`), `getPartialDraft` (1123), `retryPartialDraft` (1139), `abandonPartialDraft` (1195) and `partialDraftStats` (1216), each a `protectedProcedure`, and each backed by the `draft-recovery-db` functions imported at lines 56–64.
    > **Correction record (§5.8).** *Previously stated:* `N/A (L2, P-08)` under footnote 10 — "the capability is a library or persistence module consumed directly by other server modules, not exposed as its own router." *Now stated:* `P (L2, P-08)`. *Why:* the phrase "its own router" applied an unstated dedicated-namespace requirement. The L2 definition in 4.4.2 reads "A router module exists **and** is imported and mounted in the `appRouter` of `server/routers.ts`" — it does not require the router to be exclusive to the capability, and `estimate-router` satisfies it. *Evidence:* `server/routers.ts:5,91` and `server/estimate-router.ts:56–64,1106–1216` at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the P-08 L2 cell only. *What this does not imply:* `implementation_status` is unchanged — 4.4.2 admits L2 PRESENT *or* NOT APPLICABLE — and the totals in 4.4.8 are unchanged. The former statement that footnote 10 remained applicable to P-03/P-06 because they were "not exposed through any mounted router" is **superseded history**: footnotes 24–25 record their mounted surfaces. Footnote 10 now has no active references.
21. **P-10 evidence-cell correction (§5.8) — SUPERSEDED HISTORY, retained.** *Previous statement, now superseded:* "`jobtread-export-db`; consumed by `estimate-router`, `tenant-coverage-audit`". *Corrected statement, now active:* the cell as it now reads — `jobtread-export-db` consumed by `estimate-router`, which exposes 6 export procedures on the mounted `estimate` namespace, with client entry point `EstimateDetail.tsx`. *Why:* `tenant-coverage-audit` is not a consumer. *Evidence:* `server/tenant-coverage-audit.ts` at `5c29fd07535695566adc6bcb556b529ac94987ca` contains no import of `jobtread-export-db` — its only imports are `fs` and `path` at lines 23–24 — and its single occurrence of the name is the **string literal** `"jobtread-export-db.ts",` at line 219, one entry in the `KNOWN_UNSCOPED_MODULES` array declared at lines 202–220 and read by `auditQueryTenantScoping`, whose definition begins at line 222. The real consumer edge is `server/estimate-router.ts:70–78`. *Scope:* the P-10 `current_repository_capability` cell only. *What this correction does not imply:* it does **not** change L5, which was and remains PRESENT on the `estimate-router` import alone; it does **not** change `implementation_status` or any 4.4.8 total; it is **not** a finding about `tenant-coverage-audit`, whose listing of that filename is its own accurate record of a module it audits; and it is **not** a security or tenant-scoping claim about `jobtread-export-db`, notwithstanding that the array it is listed in is named for unscoped modules. A prior revision recorded this discrepancy in a precision note but deliberately left the cell text unchanged; that note is superseded by this correction, and the note's own description of the array as "`ACCEPTED_GLOBAL_TABLES`-adjacent … (lines 208–220)" is corrected to `KNOWN_UNSCOPED_MODULES`, lines 202–220.
22. **P (L1, P-10) — corrected from `N/A`.** A client page references the capability's namespace, observed in `client/src`: `client/src/pages/EstimateDetail.tsx:286` — `const exportCsv = trpc.estimate.exportCsv.useMutation({`. This is the only `client/src` reference to any of the six P-10 procedures enumerated in footnote 23 at this SHA.
    > **Precision correction (§5.8).** *Previously stated, now superseded:* "the only `client/src` reference to any export procedure". *Now stated:* exclusivity is limited to the six procedures in footnote 23. *Why/evidence:* `EstimateDetail.tsx` also references `exportPdf` at line 269, `exportJson` at 277 and `exportPrintable` at 372, alongside `exportCsv` at 286, at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* this reference-count statement only. *Non-claims:* P-10 L1 remains PRESENT; the capability boundary, implementation status and security status are unchanged.
    > **Correction record (§5.8).** *Previously stated:* `N/A (L1, P-10)` under footnote 9 — "cross-cutting platform capability consumed by server-side code; no dedicated user entry point is expected by the architecture." *Now stated:* `P (L1, P-10)`. *Why:* an entry point was in fact observed, so the layer is PRESENT on the L1 definition as written; whether one was architecturally *expected* does not arise once one is found. *Evidence:* `client/src/pages/EstimateDetail.tsx:286` at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the P-10 L1 cell only. *What this does not imply:* `implementation_status` is unchanged — 4.4.2 admits L1 PRESENT *or* NOT APPLICABLE with rationale — and the totals in 4.4.8 are unchanged. It is **not** a claim that the export flow is reachable, usable, validated, or secure. Footnote 9 is **not** withdrawn and continues to apply to the rows that still cite it.
23. **P (L2, P-10) — corrected from `N/A`.** The six export procedures are exposed through the same mounted router as P-08 (`server/routers.ts:5,91`): `exportCsv` (`estimate-router.ts:828`), `exportAuthorization` (925), `exportPreflight` (948), `downloadExport` (981), `listExports` (1005) and `listProjectExports` (1013), each a `protectedProcedure`, backed by the `jobtread-export-db` functions imported at lines 70–78.
    > **Correction record (§5.8).** *Previously stated:* `N/A (L2, P-10)` under footnote 10. *Now stated:* `P (L2, P-10)`, for the same reason given in footnote 20: 4.4.2's L2 definition does not require a dedicated namespace. *Evidence:* `server/routers.ts:5,91` and `server/estimate-router.ts:70–78,828–1014` at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the P-10 L2 cell only. *What this does not imply:* `implementation_status` and the 4.4.8 totals are unchanged, and no claim is made about the behaviour or security of any export procedure.

24. **P (L2, P-03) — corrected from `N/A`.** `tenantSettingsRouter` is imported at `server/routers.ts:43` and mounted at line 145. `tenant-settings-router.ts:35,288–289` imports and invokes `runTenantCoverageAudit`; its `provision` procedure at lines 247–276 calls `provisionTenant`, which invokes the P-03 engine at `tenant-settings-db.ts:587–596`. These are observed capability paths through a shared mounted router.
    > **Correction record (§5.8).** *Previously stated, now superseded:* P-03 L2 `N/A` under footnote 10, and footnote 20's statement that P-03 was not exposed through any mounted router. *Now stated:* L2 `P`. *Why/evidence:* the exact import, mount and call chain above at `5c29fd07535695566adc6bcb556b529ac94987ca`; §4.4.2 does not require an exclusive router. *Scope:* P-03 L2 only. *Non-claims:* implementation and other status dimensions are unchanged; this does not establish operational or security validation.
25. **P (L2, P-06) — corrected from `N/A`.** Direct `./db` consumers occur at `bundle-router.ts:9–10`, `catalog-router.ts:3`, `estimate-legacy-router.ts:9`, `issue-report-router.ts:8`, `lead-router.ts:65` (dynamic import), `preset-router.ts:9`, `previsit-router.ts:42`, and `scope-source-router.ts:23`. Their imports in `server/routers.ts` are lines 22, 21, 24, 17, 27, 23, 9 and 31 respectively; the corresponding mounts are 110, 109, 112, 96, 61, 111, 76 and 122. L2 is therefore PRESENT on those shared router paths.
    > **Correction record (§5.8).** *Previously stated, now superseded:* P-06 L2 `N/A` under footnote 10, and footnote 20's statement that P-06 was not exposed through any mounted router. *Now stated:* L2 `P`. *Why/evidence:* the direct import edges and root-router mounts above at `5c29fd07535695566adc6bcb556b529ac94987ca`; the same shared-router interpretation already applies to P-08/P-10. *Scope:* P-06 L2 only. *Non-claims:* no new binding capability-attribution rule, implementation-status change, security verdict or operational validation.

27. **P-02 consumer correction (§5.8).** *Previously stated, now superseded:* `server/rbac.ts` was described as consumed by `auth-router`, `project-access`, `routers.ts`. *Now stated:* its direct non-test consumers are `auth-router`, `project-access`, `rbac-router`. *Why/evidence:* at `5c29fd07535695566adc6bcb556b529ac94987ca`, direct imports occur at `server/auth-router.ts:2`, `server/project-access.ts:25`, and `server/rbac-router.ts:8`; `server/routers.ts:25,113` imports and mounts `rbacRouter`, not `server/rbac.ts`. *Scope:* P-02 evidence cell only. *Non-claims:* L5, implementation status and all other dimensions remain unchanged; this is not a security assessment.

> **Footnote sequence extension.** Notes 26–27 are appended without renumbering earlier notes; note 26 appears with the operational capability it supports.

> **Footnote numbering correction (§5.8).** Footnotes 24–25 are appended; existing numbers, including 11 in §4.4.5, are unchanged. The earlier numbering note stated that footnotes 9 and 10 remained in force for their remaining rows. That statement is **superseded for footnote 10 only**: it now has no active row references after the evidence-based P-03/P-06 corrections. Footnote 9 remains applicable to its existing L1 cells; no L1 change is made in this pass.

#### 4.4.5 View B — Capability Governance and Target View: Operational capabilities

All rows: `capability_class: Operational`. `verification_state` is **`REVERIFICATION REQUIRED`** for every row — see the registry-wide note in 4.4.8 — with every classification anchored to base SHA `5c29fd07535695566adc6bcb556b529ac94987ca`. `roadmap_horizon` is `UNASSIGNED — OD-12` for every row.

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
| C-32 | Forecast / Estimate at Completion | Controlled Change, Commitments, Cost, and Forecasting | Forecast / Estimate at Completion, §3.3 | Not Validated | Not Evaluated | **Low**³⁴ | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-33 | Baseline management | Controlled Change, Commitments, Cost, and Forecasting | The full baseline model of §3.3 and its binding rules in §3.4 | Not Validated | Not Evaluated | **Low**³¹ | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-34 | Closeout and handover | Closeout and Handover | Closeout state of §3.1; fail-closed exception handling, §3.10 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-35 | Analytics | Analytics, Calibration, and Learning | Monitoring as defined in §3.9 — informs, never authorizes | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-36 | Calibration | Analytics, Calibration, and Learning | Authoritative calibration, §3.9; Calibration and Learning state of §3.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |
| C-37 | Learning layer | Analytics, Calibration, and Learning | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | **Transitional**¹¹ |
| C-38 | Workflow visualization | Analytics, Calibration, and Learning | NOT SEPARATELY APPROVED beyond its domain definition in §4.1 | Not Validated | Not Evaluated | Medium | UNASSIGNED — INSUFFICIENT EVIDENCE |

34. **C-32 `evidence_confidence: Medium → Low` — assessed independently of the `implementation_status` change.** This does **not** follow from footnote 33; §4.5 forbids deriving one dimension from another, and a reclassification alone moves no confidence value. The basis is the standing rule in 4.4.9, whose text is unchanged: *"`Medium` reflects a multi-layer composition observation. `Low` is used only where the correspondence between a surface and its canonical definition is itself uncertain."* Applied to C-32 on its own evidence: a projection surface **is** observed and its inputs traced to their writers, and what is uncertain is precisely whether that projection corresponds to §3.3's Forecast / Estimate at Completion — the three questions in footnote 33. That is the condition the rule names for `Low`, and it is the same condition on which C-22, C-29 and C-33 already carry it.
    > **Correction record (§5.8).** *Previously stated, now superseded:* C-32 `evidence_confidence: Medium`. *Now stated:* `Low`. *Why:* `Medium` is defined as a multi-layer composition observation, and C-32 now has no layer independently classified — its six cells are `—`. The earlier `Medium` was coherent with the former `Missing` reading, where the absence was what was being asserted confidently; it does not survive the observation that a surface exists whose canonical correspondence is unsettled. *Evidence:* the rule text in 4.4.9 and the analysis in footnote 33, at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-32 `evidence_confidence` cell and the `evidence_confidence` distribution in 4.4.8 only. *What this does not imply:* the 4.4.9 rule is **not** amended and the `Low · Medium · High` vocabulary of §4.5 is unchanged. Per §4.5 a confidence value measures how well a classification is supported, not how mature the capability is — this is **not** a demotion of C-32 on any maturity dimension. No other capability's confidence is reassessed in this pass.
31. **C-33 `evidence_confidence: Medium → Low` — assessed independently of the `implementation_status` change.** This is **not** a consequence of footnote 30; per §4.5 no dimension may be derived from another, and the reclassification alone would not move confidence. The basis is the standing rule in 4.4.9: *"`Medium` reflects a multi-layer composition observation. `Low` is used only where the correspondence between a surface and its canonical definition is itself uncertain."* Applied to C-33 on its own evidence: a surface **is** observed (the three regions in footnote 30), and what is uncertain is precisely its correspondence to the §3.3 definition — the condition the rule names for `Low`, and the same condition on which C-22 and C-29 already carry `Low`. Holding `Medium` would assert a multi-layer composition observation that C-33 does not have, since no layer is independently classified.
    > **Correction record (§5.8).** *Previously stated, now superseded:* C-33 `evidence_confidence: Medium`. *Now stated:* `Low`. *Why:* the rule in 4.4.9 conditions `Low` on uncertain canonical correspondence, which now describes C-33; the earlier `Medium` was consistent with the former `Missing` reading — a confidently-classified absence — and does not survive the observation that a surface exists. *Evidence:* the rule text in 4.4.9 and the evidence in footnote 30 at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the C-33 `evidence_confidence` cell and the `evidence_confidence` distribution in 4.4.8 only. *What this does not imply:* the 4.4.9 rule is **not** amended and the `Low · Medium · High` vocabulary of §4.5 is unchanged. No other capability's confidence is reassessed in this pass, and per §4.5 a confidence value measures how well a classification is supported, not how mature the capability is — this is **not** a demotion of C-33 on any maturity dimension.

11. **C-37 `Transitional` — the only evidenced lifecycle_state in this registry.** Source: `server/routers.ts` at `5c29fd07535695566adc6bcb556b529ac94987ca`, which states that `calibration` and `priceAdjustment` "supersede the Sprint 22 `learning` namespace above, which stays mounted for backward compatibility. New work targets these." A capability explicitly superseded yet deliberately kept mounted is `Transitional` under §4.7. This yields the evidenced relationships in §4.10.

#### 4.4.6 View B — Capability Governance and Target View: Cross-Cutting Platform capabilities

All rows: `capability_class: Cross-Cutting Platform`, `primary_domain: Platform Foundations`. `verification_state` is **`REVERIFICATION REQUIRED`** for every row — see the registry-wide note in 4.4.8 — with every classification anchored to base SHA `5c29fd07535695566adc6bcb556b529ac94987ca`. `roadmap_horizon` is `UNASSIGNED — OD-12` for every row.

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
| P-09 | Evidence and provenance substrate | All operational domains | The lineage and provenance rules of §3.11 | Not Validated | Not Evaluated | Low | UNASSIGNED — INSUFFICIENT EVIDENCE |
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
| Missing | 3 | 0 | **3** |
| INSUFFICIENT EVIDENCE TO CLASSIFY | 4 | 1 | **5** |
| **Total capabilities** | **38** | **10** | **48** |

`25 + 15 + 3 + 5 = 48`. View A rows: 38 + 10 = 48. View B rows: 38 + 10 = 48. The three totals agree. Every figure above was recounted directly from the Views A and B rows in this pass, not carried over from a previous summary table.

> **Correction record (§5.8) — totals, second revision; retained as history before P-09 (§9).** *Previously stated, now superseded:* `Missing` — Operational **4**, Platform 1, total **5**; `INSUFFICIENT EVIDENCE TO CLASSIFY` — Operational **3**, Platform 0, total **3**; and the arithmetic line `25 + 15 + 5 + 3 = 48`. *Now stated at that revision:* 25 `Connected in Repository`, 15 `Implemented`, 4 `Missing`, and 4 `INSUFFICIENT EVIDENCE TO CLASSIFY` (`25 + 15 + 4 + 4 = 48`). *Why:* C-32 moved from `Missing` to `INSUFFICIENT EVIDENCE TO CLASSIFY` on the evidence in footnote 33; it is an Operational row, so exactly one capability crosses between those two rows. *Evidence:* the C-32 View A row and footnote 33, at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the `Missing` and `INSUFFICIENT EVIDENCE TO CLASSIFY` rows of this table and the arithmetic line only. *What this does not imply:* `Connected in Repository` (25) and `Implemented` (15) are unchanged, as are both column totals (38 / 10) and the registry total (48). The reclassification is **not** a promotion.

> **Correction record (§5.8) — totals, first revision; retained as history.** *Previously stated, now superseded:* `Missing` — Operational 5, Platform 1, total **6**; `INSUFFICIENT EVIDENCE TO CLASSIFY` — Operational 2, Platform 0, total **2**; and the arithmetic line `25 + 15 + 6 + 2 = 48`. *Now stated at that revision:* 25 `Connected in Repository`, 15 `Implemented`, 5 `Missing`, and 3 `INSUFFICIENT EVIDENCE TO CLASSIFY` (`25 + 15 + 5 + 3 = 48`). *Why:* C-33 moved from `Missing` to `INSUFFICIENT EVIDENCE TO CLASSIFY` on the evidence in footnote 30; it is an Operational row, so exactly one capability crosses between those two rows of this table. *Evidence:* the C-33 View A row and footnote 30, at `5c29fd07535695566adc6bcb556b529ac94987ca`. *Scope:* the `Missing` and `INSUFFICIENT EVIDENCE TO CLASSIFY` rows of this table and the arithmetic line only. *What this does not imply:* `Connected in Repository` (25) and `Implemented` (15) are unchanged, as are both column totals (38 / 10) and the registry total (48). The L5 corrections to C-12, C-28 and C-35 changed **no** figure in this table, because none of them changed an `implementation_status`.

**Other dimensions, counted across all 48 capabilities:**

| Dimension | Distribution |
|---|---|
| `operational_validation` | `Not Validated` — 48 of 48 |
| `security_status` | `Not Evaluated` — 48 of 48 |
| `evidence_confidence` | `Medium` — 43; `Low` — 5 (C-22, C-29, C-32³⁴, C-33³¹, P-09 §9) |
| `verification_state` | `REVERIFICATION REQUIRED` — 48 of 48 |
| `lifecycle_state` | `Transitional` — 1 (C-37, evidenced); `UNASSIGNED — INSUFFICIENT EVIDENCE` — 47 |
| `roadmap_horizon` | `UNASSIGNED — OD-12` — 48 of 48 |

**`verification_state: REVERIFICATION REQUIRED` — registry-wide, and why**

*Previously stated:* `verification_state` was `CURRENT` for all 48 rows. *Now stated:* `REVERIFICATION REQUIRED` for all 48 rows. This is a **`verification_state`-only** change, taken by explicit human decision, and it does **not** redefine `CURRENT`.

The reason follows from two rules this document already binds itself to:

- **§5.4** — a verdict established at one SHA applies to that SHA only, and **a later commit does not inherit an earlier verdict, however small the change**. Every classification here is anchored to `5c29fd07535695566adc6bcb556b529ac94987ca`, which is not the branch HEAD and not the commit that will carry this document.
- **§5.5** — **current evidence describes state now**. These classifications describe the repository as it stood at the historical base SHA. Labelling them `CURRENT` asserted something the evidence does not support, and §5.5 forbids promoting historical evidence to current by restatement.

`REVERIFICATION REQUIRED` is therefore the accurate label for evidence that remains fully valid **as history** and has not been re-established against the present tree.

Binding consequences, per §4.6 and §5.7:

- **`REVERIFICATION REQUIRED` is not a maturity status and carries no demotion.** `implementation_status`, `operational_validation`, `security_status`, `evidence_confidence` and `lifecycle_state` are **unchanged for every one of the 48 rows**, and none may be read as demoted on account of this field.
- It is **not** a statement that any classification is wrong, stale in substance, or contradicted. The earlier claim that the sweep "found the registry as recorded, apart from the corrections that section enumerates" is **superseded** by Section 8's correction and unresolved-finding record. Verification state alone implies no contradiction; the separately observed C-28 discrepancy is now corrected by footnote 26; its earlier unresolved record is retained as superseded history in Section 8.
- Section 8 separates the historical registry anchor from the **fresh bounded verification of corrections at the historical base SHA**; it does not assert that this pass re-established every registry claim. It does **not** assert that the current branch HEAD, or the future commit that will carry this document, has been verified. Those require their own observation and their own record.
- The staleness time policy remains open as OD-05; this change is made on the exact-SHA and current-versus-historical rules above, not on any elapsed-time threshold.

#### 4.4.9 Evidence and governance notes

- **Evidence class.** Every row rests on repository composition at one SHA: file presence, root-router registration, client namespace references, module import graph, Zod reference counts, and test-file presence. **No execution, no test run, no behavioral verification.** This bounds every classification uniformly and caps `evidence_confidence` at `Medium`.
- **`Medium` vs `Low`.** `Medium` reflects a multi-layer composition observation. `Low` is used only where the correspondence between a surface and its canonical definition is itself uncertain (C-22, C-29, C-32, C-33, P-09). *The rule text is unchanged; C-33 and then C-32 were added through footnotes 31 and 34; P-09 is added by the independently justified confidence correction in §9.*
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

**Complementary verification — C-32 disposition and the bundleId citation**

- **Repository:** `https://github.com/wcvmsilva/structr-ai.git`. **Historical evidence SHA:** `5c29fd07535695566adc6bcb556b529ac94987ca`. **Branch:** `docs/canonical-structr-truth-v1`. **HEAD during this pass:** `22c0630f37cfa24c6a076f1f26a517130623573a`, unchanged. Everything below was read at the historical SHA; nothing is attributed to HEAD or to any future commit.
- **Window:** started `2026-09-10T12:34:53Z` (UTC) · evidence operations completed `2026-09-10T12:50:47Z` (UTC), both read with `date -u` before the first and after the last evidence command. This pass's own window; no earlier window is adopted.
- **Method:** static inspection of Git objects (`git show`, `git grep`). No checkout, no branch change, no project hook or script. **No test, build, application, dependency install, migration, database, Supabase, `.env` or secret access.** Nothing here is an operational validation or a security assessment.
- **Regions reproduced:** `shared/analytics-aggregation-engine.ts:184–185, 226–243, 251–252, 273–286`; `server/analytics-db.ts:196–249`, in particular 225–235; `server/field-operations-db.ts:910–927`; `server/actuals-db.ts:745–760`; `shared/domain/phase3-taxonomy.ts:236, 252, 526–528`; `server/scope-review-db.ts:326–339`; `server/scope-review-router.ts:35, 37, 356–400`; a repository-wide query for `updateSnapshotBundleId`; and this document's own §3.3 **Forecast / Estimate at Completion** row with §3.4, quoted rather than paraphrased.
- **Corrections made.** (1) **C-32 reclassified** `Missing` → `INSUFFICIENT EVIDENCE TO CLASSIFY`, six layer cells `A` → `—`, evidence cell rewritten (footnote 33), and `evidence_confidence` `Medium` → `Low` on separate grounds (footnote 34). (2) The rationale that the flow supplies "two of four" §3.3 components, with commitments and remaining work "not supplied", is superseded wherever it was active — footnote 30's C-32 bullet, the commitments bullet, §2.9, and the §8 conclusions summary. (3) The `bundleId` citation in footnote 30 clause (c) is corrected: the update helper is defined and imported but **no call to it is observed**, the snapshot is created with `bundleId: null`, and the helper would alter only that column. (4) 4.4.8 totals and the `evidence_confidence` distribution updated; 4.4.9's `Low` row list extended; the counting criterion now records reclassifications and confidence changes as inventories separate from the fifteen layer corrections.
- **Conclusions and their limits.** C-32 is `INSUFFICIENT EVIDENCE TO CLASSIFY` because three questions decide whether the observed projection is §3.3's Forecast / Estimate at Completion — whether a computed unearned balance is "remaining work", whether a committed-cost aggregate is "what was obligated", and whether the composition as a whole establishes the canonical projection — and composition answers none of them. **This is not a finding that the canonical projection is implemented, and not a finding that it is absent.** C-33 is unchanged and its earlier findings are not reopened. **Nothing was executed:** no query ran against data, no trigger fired, no test or build was run.
- **Coverage limit, stated plainly.** This pass reproduced the regions listed above and revised C-32, footnote 30's C-32 and commitments bullets, footnote 30 clause (c), §2.9's forecast bullet, the 4.4.8 totals and distributions, 4.4.9's `Low` list, the counting criterion, and the §8 summaries; it recounted the registry totals from the Views A and B rows. It is **not** a re-verification of all 48 capabilities — rows not named here rest on earlier passes' records. **This is an author's pass: not an independent PASS, not a verification of HEAD, not a verification of any future commit, and no guarantee that no further findings exist.** The corrected version requires independent review.

**Complementary verification — canonical EAC text, C-33 scope surfaces, and §2.9 wording**

- **Repository:** `https://github.com/wcvmsilva/structr-ai.git`. **Historical evidence SHA:** `5c29fd07535695566adc6bcb556b529ac94987ca`. **Branch:** `docs/canonical-structr-truth-v1`. **HEAD during this pass:** `22c0630f37cfa24c6a076f1f26a517130623573a`, unchanged. Everything below was read at the historical SHA and is **not** attributed to HEAD or to any future commit.
- **Window:** started `2026-09-10T02:33:52Z` (UTC) · evidence operations completed `2026-09-10T02:41:37Z` (UTC), read with `date -u` before the first and after the last evidence command. This pass's own window; no earlier window is adopted.
- **Regions inspected in full, with context:** `shared/analytics-aggregation-engine.ts:37–48, 179–187, 205–286`; `server/analytics-db.ts:196–250`; `server/scope-review-router.ts:236–284, 352–372`; `server/scope-review-db.ts:118–150, 246–283, 325–339`; `drizzle/0002_phase2_previsit_estimate.sql:560–598`; `drizzle/schema.ts:550–617, 779, 919–933`; `shared/domain/phase3-taxonomy.ts:236–252`; `server/actuals-db.ts:740–765`; and this document's own §3.3 (lines 220–229) and §3.4 text, which was quoted rather than paraphrased.
- **Corrections made.** (1) The EAC distinction no longer asserts a "cost at completion" formulation that §3.3 does not contain; it is restated against the four components §3.3 names, two of which the inspected flow supplies and two of which it does not. (2) The commitments distinction no longer narrows §3.4's "what was obligated" to obligations not yet incurred; it rests on the flow reading a single cost aggregate once. (3) C-33's evidence cell and footnote 30 clause (c) now record the approved-scope surface and the approved-item snapshots, replacing the false claim that only a financial aggregation exists. (4) The trigger observation now carries its limits — seven columns, `OLD.status = 'approved'` only, an install block that swallows failure, one application call site. (5) §2.9's "Two observations" introduction, which preceded five bullets, is replaced by an uncounted one, and its bullets are corrected to match. (6) C-20/C-21 evidence cells no longer read "No surface observed" in the absolute (footnote 32). (7) Active summaries in this section that repeated the superseded reasoning are marked superseded, including the clause that offered lack of authorization as a ground for C-33's disposition.
- **Conclusions and their limits.** ~~C-32 remains `Missing` because two of §3.3's four required components — commitments and remaining work — are not supplied to the inspected flow; `unearned` is obtained by arithmetic on the two components that are.~~ **That C-32 conclusion is superseded** by the block titled "Complementary verification — C-32 disposition and the bundleId citation": §3.3 does not require four independent inputs, and C-32 is now `INSUFFICIENT EVIDENCE TO CLASSIFY` (footnote 33). C-33 remains `INSUFFICIENT EVIDENCE TO CLASSIFY` with `Low` confidence because, although both scope-approval and financial surfaces exist, no immutability is evidenced for the snapshot, no snapshot is designated the Original Scope Baseline or bound to a financial baseline, and the Accepted Commercial Package, Execution Baseline and Current Authorized Baseline are unobserved. *(The parenthetical this sentence carried — "no trigger on `scope_review_snapshots`; an unguarded update path" — is corrected in footnote 30 clause (c): no call to the update helper was observed in the inspected flow.)* **These are statements about correspondence between code and canonical text, not about behaviour:** nothing was executed, no trigger fired, no query ran against data, and no test or build was run.
- **Coverage limit, stated plainly.** This pass re-examined the delimited regions listed above, plus §2.9, C-20, C-21, C-31, C-32, C-33, footnotes 28–32 and the §8 summaries, and recounted the registry totals from the Views A and B rows. It is **not** a re-verification of all 48 capabilities; rows not named here rest on earlier passes' records. **This is an author's pass — not an independent PASS, not a verification of HEAD, and not a verification of any future commit.** The corrected version requires independent review.
- **Pendency carried forward.** Whether the scope-approval and snapshot surfaces now recorded should move C-33 is a classification question left to the reviewer, not decided here.

**Preceding verification — C-33 rationale, C-32 data lineage, and import counts**

- **Repository:** `https://github.com/wcvmsilva/structr-ai.git`. **Historical evidence SHA:** `5c29fd07535695566adc6bcb556b529ac94987ca`. **Branch:** `docs/canonical-structr-truth-v1`. **HEAD during this pass:** `22c0630f37cfa24c6a076f1f26a517130623573a`, unchanged throughout. Every finding below was read at the historical SHA; **none of it is attributed to HEAD**, and none establishes a classification there.
- **Window:** started `2026-09-10T02:07:24Z` (UTC) · evidence operations completed `2026-09-10T02:20:30Z` (UTC), both read with `date -u` immediately before the first and after the last evidence command. This is this pass's own window; the reviewer's window and those of earlier passes are their records, not adopted here.
- **Method:** static inspection of Git objects (`git show`, `git grep`, `git ls-tree`, `git cat-file -e`, `git merge-base --is-ancestor`). No checkout, no branch change, no project hook or script. **No test, build, application, dependency install, migration, database, Supabase, `.env` or secret access.** Nothing here is an operational validation or a security assessment.
- **Scope actually examined — regions read in full, with surrounding context, not pattern-matched:** `server/field-operations-db.ts:88–135` and `896–945`; `server/estimate-version-db.ts:140–200` and `210–280`; `server/estimate-db.ts:60–80, 311–318, 480–600`; `server/actuals-db.ts:650–690` and `740–765`; `server/analytics-db.ts:196–250`; `shared/analytics-aggregation-engine.ts:215–262`; `shared/domain/phase3-taxonomy.ts:236–252, 515–532`; `server/scope-completeness-db.ts:32–41, 174–184`; `drizzle/0002_phase2_previsit_estimate.sql:560–598`. Field writers were traced caller → argument construction → consuming function → transformation → result, rather than inferred from identifiers.
- **Conclusions supported by that reading.** (1) The C-33 indeterminacy rationale contained three defects of kind, now corrected in footnote 30: a readable property of a function body described as requiring execution; an approval transition described as unobserved when `approveEstimateDraft` was present and merely uninspected; and §3.4 immutability described as unobserved when a database trigger and an application guard express it. (2) The C-32 exclusion rested on parameter names; tracing `backlog` shows authorized-baseline-derived and actual-cost-derived amounts do reach `forecastRevenue`. ~~and the surviving distinction is that it projects revenue still to be earned rather than cost at completion~~ — **that clause is superseded** by the block titled "Complementary verification — canonical EAC text, C-33 scope surfaces, and §2.9 wording": §3.3 contains no "cost at completion" formulation, and the operative test is the four components it names. (3) `committedCostCents` aggregates actual rows in `approved`/`paid` status. ~~so it is actuals, not canonical commitments~~ — **superseded** by the same block, which grounds the commitments finding on the flow reading one cost aggregate once, without narrowing §3.4's "what was obligated". (4) Footnote 29 overcounted the `analytics-db` type imports by one — eleven, not twelve.
- **Dispositions unchanged by this pass.** C-33 remains `INSUFFICIENT EVIDENCE TO CLASSIFY`, six `—` cells, `Low` confidence, on narrowed grounds. C-31 and C-32 remain `Missing`, on corrected grounds. C-35 L5 remains `P`. No `implementation_status`, layer cell, `evidence_confidence`, `operational_validation`, `security_status`, `verification_state`, `lifecycle_state` or `roadmap_horizon` value changed anywhere in the registry in this pass, and no binding definition, classification rule, open decision or security boundary was touched. The totals were recounted from the Views A and B rows and are unchanged: `25 + 15 + 5 + 3 = 48`.
- **Limitations, stated as limits rather than findings.** This pass targeted the reviewer's three findings and the same classes of error in the justifications adjacent to them. It re-read §2.9, C-31, C-32, C-33 and footnotes 28–31 line by line, and re-derived the registry totals and distributions from the rows; it did **not** re-derive every one of the 48 rows' full evidence from scratch — earlier passes' records for the untouched rows stand on their own terms. **Proposal issuance and commercial acceptance (C-20, C-21) were not re-examined** and retain the finding of the pass that recorded them. Nothing here is an operational validation: no trigger fired, no transition was exercised, no query ran against data. **This is a self-verification by the correcting agent — not an independent gate and not a PASS.** The corrected version requires a fresh independent review.
- **Open question referred to review, not decided here.** The static properties newly recognised in footnote 30 are more supportive of a §3.3 correspondence than the earlier rationale acknowledged. This pass keeps C-33 at `INSUFFICIENT EVIDENCE TO CLASSIFY` because the four narrowed gaps in footnote 30 remain unestablished, and because reclassifying it was not authorized. **Whether those properties should instead move C-33 is a classification question for the independent reviewer**, and is recorded here rather than resolved.
  > **Superseded in part (§5.8).** The final clause above — "and because reclassifying it was not authorized" — is **superseded as a ground for the disposition** by the block titled "Complementary verification — canonical EAC text, C-33 scope surfaces, and §2.9 wording". C-33 is held at `INSUFFICIENT EVIDENCE TO CLASSIFY` **on the evidence and the definitions**, set out in footnote 30 clauses (a)–(d); authorization governs what this agent may change, and is not a semantic justification for a classification. The referral of the question to the reviewer stands.

**Preceding verification — L5 consistency (C-12, C-35), C-33 disposition, and provenance precision**

- **Repository:** `https://github.com/wcvmsilva/structr-ai.git`. **Historical evidence SHA:** `5c29fd07535695566adc6bcb556b529ac94987ca`. **Branch:** `docs/canonical-structr-truth-v1`. **HEAD during this pass:** `22c0630f37cfa24c6a076f1f26a517130623573a`, unchanged throughout.
- **Window:** started `2026-09-10T01:49:40Z` (UTC) · evidence operations completed `2026-09-10T01:57:22Z` (UTC). Both read from the machine's system clock with `date -u`, immediately before the first and immediately after the last evidence command. They are observed times, not derived from Git metadata, and they are **this pass's own window** — the windows of the reviewer and of earlier agents are retained below as their history and are not adopted here.
- **Method:** read-only inspection of Git objects at the historical SHA (`git show`, `git grep`, `git ls-tree`, `git cat-file -e`, `git merge-base --is-ancestor`). No checkout and no branch change; the working tree stayed on the document branch. **No test, build, application, dependency install, migration, database, Supabase, `.env` or secret access.** Test files were counted, never executed — their presence evidences no behaviour.
- **Findings reproduced directly, not adopted from the reviewer's report,** which was treated as guidance for investigation: C-12's engine import (`server/scope-completeness-db.ts:32–40`) and invocation (176–182); C-35's engine import (`server/analytics-db.ts:29–47`) and invocation (178); and the three C-33 regions (`server/field-operations-db.ts:96–132`, `server/actuals-db.ts:657–683`, `server/estimate-version-db.ts:210–274`) read in full with surrounding context.
- **Registry-wide coverage actually performed.** All 48 rows in each View were re-read. **Every L5 cell** was re-examined under the literal 4.4.2 definition, explicitly including engine consumers inside the capability's own domain — the reading that produced the C-12 and C-35 defects. The only non-`Missing` rows carrying a non-`P` L5 were C-12, C-25 and C-35; C-25 was checked directly and **stands at `A`**, because `server/daily-log-db.ts` is imported only by `server/daily-logs-router.ts` (static and dynamic queries) and the capability has no engine in `shared/`. Also re-observed: file counts (41 `server/*-router.ts`, 34 `server/*-db.ts`, 20 `shared/*-engine.ts`, 25 `client/src/pages/*.tsx`, 52 `server/*.test.ts`); 41 domain routers imported and mounted alongside the separate `_core/systemRouter`, for 42 namespaces; client `trpc.<namespace>.` references for every L1 cell in both Views; the static **and dynamic** import graph behind every L5; `.input(` counts and Zod imports for every router cited in a rationale; existence of every cited module and path; the five 4.4.7 security artifacts **absent** at the base SHA; and the ancestry triple — `b95ea0bf…` not an ancestor of the base SHA (exit 1) nor of HEAD (exit 1), the base SHA an ancestor of HEAD (exit 0).
- **Distinction applied throughout.** A real import was distinguished from a doc comment, a string literal and a type-only reference. That distinction is what keeps `tenant-coverage-audit` out of P-10's consumer set (a `KNOWN_UNSCOPED_MODULES` literal), keeps `server/db.ts` out of P-01's (a doc comment at line 45), and is why the C-12 and C-35 import blocks are cited with their full ranges, value imports and type imports together.
- **Corrections made in this pass:** C-12 L5 `A`→`P` (footnote 28); C-35 L5 `N/A`→`P` (footnote 29, superseding footnote 6); C-33 `Missing`→`INSUFFICIENT EVIDENCE TO CLASSIFY` (footnote 30); C-33 `evidence_confidence` `Medium`→`Low` (footnote 31); the §2.9 no-surface observation; the 4.4.8 totals and the `evidence_confidence` distribution; the inventory counting criterion and the cumulative layer-table figures; and the provenance-authentication statement.
- **Remaining contradictions: none found outside the corrected set during this sweep.** C-31 and C-32 were checked specifically, because they are the `Missing` rows adjacent to C-33, and both remain defensible on stated evidence (footnote 30). This is a statement about what this sweep observed within the declared evidence scope — **not** a claim that the registry is now free of contradiction, and **not** an independent verification.
  > **Superseded (§5.8).** The sentence above is retained as this block's own record and is **superseded as an active claim** by the verification recorded in the block titled "Preceding verification — C-33 rationale, C-32 data lineage, and import counts" *(a later pass renamed that block's leading word when a further block was added; its content is unchanged)*. That later pass found three defects that this sweep did not: an execution-dependency claim, an approval transition reported as unobserved when the code was present but uninspected, and a forecast-data claim inferred from parameter names. The C-31 and C-32 conclusions stand; the reasoning recorded for them here does not.
- **Limits, binding.** This verifies evidence **at the historical SHA only**. It establishes **no** classification at branch HEAD and none at the future commit that will carry this document; per §5.4 that commit inherits no verdict from this anchor. It is a **self-verification by the correcting agent, not an independent gate, and not a PASS** — the corrected version requires a fresh independent review even though this sweep surfaced no further contradiction. No layer definition, classification rule, security verdict or open decision was changed to accommodate a classification. `operational_validation` remains `Not Validated`, `security_status` `Not Evaluated` and `verification_state` `REVERIFICATION REQUIRED` for all 48 rows; `CURRENT` is not redefined. No commit, publication or status promotion is authorized.

**Preceding follow-up correction verification — P-02, C-28 and provenance**

- **Evidence SHA:** `5c29fd07535695566adc6bcb556b529ac94987ca`. **Window:** `2026-09-09T23:57:17Z` → `2026-09-09T23:57:37Z` (UTC, system clock). This `verified_at` applies only to the checks stated here; it is not an exact-HEAD or publication verdict.
- **Direct checks:** reproduced P-02's direct imports and root-router mount; C-28's engine import and invocations; the three committed evidence-cell defects and absence of notes 12–23 in committed HEAD. Footnotes 26–27 record the corrections. The original nine-item provenance inventory is three committed / six uncommitted-origin defects; it is not a count for all later findings.
- **Repeated composition sweep:** 41 routers, 34 DB modules, 20 engines, 25 pages, 52 test paths; 42 mounts; client namespace references; static/dynamic source import edges; router Zod/input counts; named module existence and ancestry/divergence checks. Commands read immutable Git objects and recorded exit codes and stderr; no code, tests, build, database or environment files were executed or accessed.
- **Outcome and limit:** the three named follow-up corrections are supported. The prior C-28 unresolved status is superseded; no named P-02/C-28/provenance correction remains open in this revision. The repeated composition scan is not represented as a fresh semantic verification of every assertion in all 48 rows. Complete registry verification and an independent review remain pending; the Claude report's verification window is not adopted as this agent's evidence.
- **Preserved constraints:** unchanged layer definitions and implementation totals 25/15/6/2; all 48 rows retain `REVERIFICATION REQUIRED` and `Not Evaluated`. No status promotion, commit, publication or independent PASS is authorized.

**Earliest bounded correction verification — historical record; its unresolved-C-28 status is superseded by the block titled "Preceding follow-up correction verification — P-02, C-28 and provenance"**

> **Editorial correction (§5.8).** The locator "follow-up below" was first superseded by "follow-up above", and is now superseded again by the section title named in this heading. *Why:* a later pass inserted an additional verification block, so a relative up/down locator no longer identifies its target unambiguously; §5.10 requires a reference to carry its source's own anchor, and a title does, whereas a direction does not. *Scope:* this relative document reference only. *What this does not imply:* no evidence, classification, verification window, scope or authorization changes, and the earlier editorial record is retained here as history rather than deleted.

- **Historical evidence SHA:** `5c29fd07535695566adc6bcb556b529ac94987ca`.
- **Started:** `2026-09-09T23:37:24Z` (UTC). **`verified_at` / evidence inspection ended:** `2026-09-09T23:39:45Z` (UTC). Both were read from the system UTC clock using Python `datetime`, not reconstructed from Git metadata. Document editing and final Git checks follow this evidence window.
- **Scope:** the latest independent NO-GO findings, plus repository-wide composition checks: file counts (41 routers, 34 DB modules, 20 engines, 25 pages, 52 test files); all 42 root-router mounts; client namespace counts; source import edges including dynamic imports; router Zod/input counts; named module existence and exact ancestry/divergence checks. The P-03/P-06 call chains, helper signatures and P-10 client references were inspected directly at the historical SHA. These observations support footnotes 14–15 and 22–25.
- **Method:** read-only Git object inspection (`ls-tree`, `show`, `cat-file`, `merge-base --is-ancestor`), with command exit codes, stdout and stderr recorded; static source parsing was followed by direct inspection of the changed claims. No application, test, build, database, Supabase, environment file or secret was executed or accessed.
- **Coverage limit:** this pass does **not** assert a successful complete verification of all 48 capabilities or every active repository-derived statement. The expanded checks exposed the additional C-28 contradiction below. The historical registry timestamp is retained in the superseded record, not relabeled as a successful new registry-wide verification. This new time anchors only the stated checks and bounded corrections.
- **Exact-SHA boundary:** neither current HEAD `22c0630f37cfa24c6a076f1f26a517130623573a` nor a future document commit has been verified for registry classifications. All 48 rows retain `REVERIFICATION REQUIRED`.

**SUPERSEDED HISTORY — C-28 L5 finding before the follow-up correction**

> C-28 names `shared/subcontractor-performance-engine` as part of its capability but records L5 `A`. At `5c29fd07535695566adc6bcb556b529ac94987ca`, `server/field-operations-db.ts:53` imports `assessCompliance` and `evaluateAssignmentEligibility` from that engine. This is an external consumer edge under the literal L5 rule in §4.4.2. C-28 L5 remains unchanged in this bounded correction pass and is explicitly disputed pending the next authorized correction/review; `P` is the evidence-supported proposed cell value. Its L1 remains `A`, so applying that correction would leave `implementation_status` as `Implemented` under the existing rule. This is not a security or behavioral finding. No complete-verification success is asserted while this discrepancy remains.

**Prior correction record (§5.8) — verification coverage; retained as history**

> *Previously stated, now superseded:* the pass ending `2026-09-09T22:59:35Z` was a "fresh, complete static verification", covered "every active repository-derived statement", and found the registry as recorded except its nine enumerated corrections. *Now stated:* the latest NO-GO demonstrated additional defects; this pass verifies the bounded corrections and records the additional unresolved C-28 evidence above. *Why/evidence:* footnotes 14–15, 22, 24–25 and `server/field-operations-db.ts:53` at the exact historical SHA. *Scope:* completeness/result claims in §4.4.8 and §8 only. *Non-claims:* no maturity/status demotion, redefinition of CURRENT, independent PASS or delivery authorization. A complete static verification remains pending.

<details>
<summary>SUPERSEDED HISTORY — prior verification anchor and coverage claims (retained under §5.8; not active evidence of completeness)</summary>

> **`verified_at`**
> `2026-09-09T22:59:35Z` (UTC)
>
> This is the anchor required by Section 4.6 for every classification in this document.
>
> **What exactly this anchor covers — read before relying on it**
>
> - **It anchors a fresh, complete static verification of the historical evidence base SHA `5c29fd07535695566adc6bcb556b529ac94987ca`.** That is the whole of its scope.
> - **It is NOT a verification of the current branch HEAD** (`22c0630f37cfa24c6a076f1f26a517130623573a` at the time of this pass). The current HEAD was not the subject of the verification and no classification in this registry has been re-established against it.
> - **It is NOT a verification of the future commit that will carry this document.** That commit does not yet exist. Per §5.4 it will inherit no verdict from this anchor, however small the change.
> - **The verification time of the original authoring pass was not recovered.** It was not recorded in this document and no authoritative record of it was found; it is **not** reconstructed here. Commit dates, file modification times, and presumed dates were **not** used as substitutes. "Branch HEAD at authoring time" and "Divergence from `origin/main` at authoring time" above remain the authoring-time anchors and are unchanged.
> - An earlier working-tree revision of this section recorded `verified_at` as `2026-09-09T16:22:59Z` for a prior verification pass. **That value is superseded** by the anchor above, which records the later and more complete pass described here. The superseded value described a pass whose completeness claim did not survive independent review; it is retained in this sentence as history and must not be cited as the current anchor.
>
> **Scope and window of this verification**
>
> - **Started** `2026-09-09T21:13:59Z` (UTC) · **Completed** `2026-09-09T22:59:35Z` (UTC).
> - **Origin of both times:** the system clock of the machine performing the verification, read via `date -u` immediately before the first and immediately after the last evidence command. They are observed times, not derived from Git metadata.
> - **Method:** read-only inspection of Git objects at the base SHA (`git cat-file`, `git ls-tree`, `git show`, `git grep`, `git merge-base --is-ancestor`). **No checkout and no branch change** was performed; the working tree stayed at the document branch throughout. **No test was run, no build was run, no application was executed**, and no database, Supabase, `.env`, or secret was accessed.
> - **Evidence scope:** the complete scope declared above, re-observed at the base SHA and covering the whole registry — all 48 capabilities in both views, not only the rows this pass changed.
> - **Evidence references, by scope element:**
>   - *File presence and paths* — 41 `server/*-router.ts`, 34 `server/*-db.ts`, 20 `shared/*-engine.ts`, 25 `client/src/pages/*.tsx`, 52 `server/*.test.ts`, each counted by `git ls-tree -r --name-only` at the base SHA.
>   - *Targeted `git cat-file -e` existence checks* — every `-db` module and engine cited in the registry, plus `server/project-access.ts`, `server/audit-trail.ts`, `server/rbac.ts`, `server/pricing-dimensions.ts`, `server/scope-to-estimate-pipeline.ts`, `shared/geo-override-seed.ts`, `shared/pipeline-orchestrator.ts`, `server/estimate-export.ts`, `server/jobtread-csv-export.ts`, both `tenant-coverage-audit.ts` paths, and the five security-program artifacts named in 4.4.7.
>   - *Root-router registration* — `server/routers.ts`: 41 domain routers imported and mounted in `appRouter`, alongside the separate `_core/systemRouter`, for 42 mounted namespaces; the full namespace-to-router map was read line by line.
>   - *Client namespace references* — `trpc.<namespace>.` reference counts under `client/src` for all 42 mounted namespaces, cross-checked against every L1 cell in both views.
>   - *Module import graph* — the consumer set behind every L5 classification, including dynamic `await import()` edges, which a static-import query alone does not see.
>   - *Zod / input evidence* — `.input(` counts and Zod imports for all routers cited in any layer rationale, and for the routers consuming `server/db.ts`.
>   - *Test-file presence* — the 52 `server/*.test.ts` files, counted, not executed.
>   - *Exact ancestry claims* — `git merge-base --is-ancestor b95ea0bf4741646f418fcc99a22d22a42d24be51 5c29fd07…` → exit code 1 (**not** an ancestor of the base SHA); the same against branch HEAD → exit code 1; the base SHA **is** an ancestor of branch HEAD → exit code 0.
>   - *The Section 1.2 divergence record* — re-confirmed at the base SHA: `AGENTS.md` PRESENT; `docs/adr/`, `docs/engineering/`, `docs/security/`, `docs/security-remediation-handoff.md`, `docs/superpowers/` all ABSENT; all five PRESENT at `f60cf9a56679d4d7083b2c11ac4e2727d53d84c3` on the workflow lineage.
>   - *The Section 4.10 and footnote-11 supersession evidence* — `server/routers.ts:139–140` reads verbatim "`calibration` and `priceAdjustment` supersede the Sprint 22 `learning` namespace above, / which stays mounted for backward compatibility. New work targets these."
>   - *Every active repository-derived statement used by the registry* — each evidence cell, each layer rationale, and each cited line number, re-read against the file at the base SHA.
> - **This was a presence-and-composition verification.** Confirming that test files are present is not running them, and nothing here observes behavior.
>
> **Result of this verification — stated with its failures, not as a clean pass**
>
> > **This section does not claim that complete re-verification succeeded without contradiction.** It did not. The sweep re-observed the whole declared evidence scope at the base SHA, and in doing so found and corrected **nine** factual contradictions, seven of them in statements added by a prior uncommitted revision of this document. Any earlier statement in this document that the re-verification found everything as recorded is **superseded** by the list below.
>

</details>

**Correction inventory retained from the preceding pass** — the nine entries below describe prior corrections, not nine newly discovered defects in this pass. Footnotes 14–15 now supersede their former L6 conclusions; the counts and factual history remain retained:

1. **P-01 evidence cell — import direction inverted.** The cell listed `db` as a consumer of `identity-db`. `server/db.ts` does not import `identity-db`; the edge runs the other way (`identity-db.ts:22`). Corrected; see footnote 18. **No layer changed.**
2. **P-03 evidence cell — unsupported consumer claim.** `_core/auth/supabase-auth` does not import any P-03 module. Removed and replaced with the enumerated real consumer set; see footnote 19. **No layer changed on this account.**
3. **Footnote 13 arithmetic — `tenant-scope` importers.** "14 `-db` modules" was wrong; the observed count is **13** `-db` modules, 14 non-test importers of any kind. Corrected in place.
4. **Footnote 13 module description — `tenant-provisioning-engine` imports.** "imports only taxonomy and constants" was incomplete; line 45 also imports `round1` from `./calibration-engine`. Corrected to the full import list.
5. **Footnote 15 counts — `server/db.ts` consumers.** "48 non-test server modules" and "the seven that are themselves routers" both undercounted by one, because `server/lead-router.ts:65` consumes `./db` via a dynamic `await import()`. Corrected to **49** and **eight**.
6. **P-10 evidence cell — `tenant-coverage-audit` is not a consumer.** The name appears only as a string literal in the `KNOWN_UNSCOPED_MODULES` array. The cell is corrected and the former wording retained as explicit superseded history; see footnote 21. **L5 unchanged.**
7. **Footnote 17 citation — wrong array and line range.** The prior precision note described the array as "`ACCEPTED_GLOBAL_TABLES`-adjacent … (lines 208–220)"; it is `KNOWN_UNSCOPED_MODULES`, lines 202–220. Corrected in footnote 21.
8. **Footnote 12 citation — inline literal not present as written.** `db.update(users).set({ role })` does not appear on any single line; the call is chained across lines 170–175. Citation tightened to the actual lines.
9. **Footnote 14 statement — `tenant-coverage-audit` is not input-free.** "the coverage audit's only inputs are files it reads from disk" was contradicted by its own signatures, which take `schemaSource`, `serverDir` and `checkedAt` as direct arguments. The argument correction is retained; the prior conclusion that this justified L6 N/A is superseded by footnote 14, which now classifies the capability at its mounted router boundary.

**Cumulative correction inventory (including earlier passes).** Each entry is bounded to the named cell and applies the unchanged §4.4.2 rule within the user-authorized correction workflow. This is a correction-history table, not a claim that every entry differs from committed HEAD:

| capability | layer | before | after | footnote |
|---|---|---|---|---|
| C-12 | L5 | `A` | `P` | 28 |
| C-28 | L5 | `A` | `P` | 26 |
| C-35 | L5 | `N/A` | `P` | 29 |
| C-38 | L4 | `N/A` | `P` | 7 |
| P-02 | L4 | `N/A` | `P` | 12 |
| P-03 | L4 | `N/A` | `P` | 13 |
| P-03 | L2 | `N/A` | `P` | 24 |
| P-03 | L6 | `N/A` | `P` | 14 |
| P-06 | L2 | `N/A` | `P` | 25 |
| P-06 | L6 | `N/A` | `P` | 15 |
| P-08 | L2 | `N/A` | `P` | 20 |
| P-08 | L6 | `N/A` | `P` | 16 |
| P-10 | L1 | `N/A` | `P` | 22 |
| P-10 | L2 | `N/A` | `P` | 23 |
| P-10 | L6 | `N/A` | `P` | 17 |

**The L4 definition in 4.4.2 is not amended, broadened, or weakened.** The C-38 and P-03 changes apply its third PRESENT criterion — *an observed derivation-only boundary* — as written; the tension a prior revision recorded is resolved by applying the rule, not by changing it. The P-08/P-10 corrections apply L1, L2 and L6 without an unstated dedicated-namespace requirement; this pass applies the same L2/L6 reading consistently to P-03/P-06. L1 requires an observed entry point, L2 a mounted router, and L6 router-level Zod references. No binding definition is changed.

**Counting criterion for the correction inventories in this section.** A **layer correction** is one changed layer cell in one capability row; the table above counts those and nothing else. An **implementation_status reclassification** is a change to a row's status and is counted separately, never as a layer entry — a row whose status changes is not reducible to a cell edit, so **C-33 and C-32 appear in the status list below and not in the layer table**, and their six `—` cells are part of that reclassification rather than six separate layer corrections. An **evidence_confidence change** is counted separately again.

**Historical cumulative inventory before the P-09 correction in §9 — superseded only as the current cumulative count.** Two `implementation_status` reclassifications have been made across all passes, each `Missing` → `INSUFFICIENT EVIDENCE TO CLASSIFY`: **C-33** (footnote 30) and **C-32** (footnote 33). Two `evidence_confidence` changes accompany them, each `Medium` → `Low` and each assessed on its own grounds under the unchanged 4.4.9 rule: **C-33** (footnote 31) and **C-32** (footnote 34). These four entries are **not** layer corrections and are not counted in the fifteen. The layer table continues to record **fifteen layer corrections across nine capability rows**, unchanged by either reclassification. Wording-only corrections to an evidence cell (P-01, P-02, P-03, P-10) change no layer, no status and no confidence, and are counted in none of the three.

**Corrections made in the pass recorded as "Preceding verification — L5 consistency (C-12, C-35), C-33 disposition, and provenance precision", distinguished from the cumulative record.** *(Locator bound to that section title in a later pass, because "THIS pass" no longer identifies it unambiguously; the content and figures below are that pass's own record and are unchanged.)* That pass makes **two layer corrections** (C-12 L5 `A`→`P`, footnote 28; C-35 L5 `N/A`→`P`, footnote 29), **one `implementation_status` reclassification** (C-33 `Missing`→`INSUFFICIENT EVIDENCE TO CLASSIFY`, footnote 30), and **one `evidence_confidence` change** (C-33 `Medium`→`Low`, footnote 31), across **three distinct capability rows** (C-12, C-33, C-35). It also corrects the contradictory §2.9 no-surface observation and the 4.4.8 totals, both consequences of the C-33 reclassification. Every earlier count in this section describes its own earlier pass and is left as written.

**`implementation_status` changed for exactly one row in that same pass, and the 4.4.8 totals moved accordingly.** C-33 is that row. *(The later pass recorded as "Complementary verification — C-33 rationale, C-32 data lineage, and import counts" changed **no** `implementation_status`, no layer cell and no `evidence_confidence`; it corrected rationales, one import count and §2.9 wording only, so every figure in this paragraph and in the layer table still stands as written.)* The layer corrections changed no status: C-12, C-28 and C-35 each retain `Implemented` because L1 remains `A` in all three, and the six rows corrected in earlier passes (C-38, P-02, P-03, P-06, P-08, P-10) each still satisfy `Connected in Repository`. Recounted directly from the Views A and B rows: `25 + 15 + 5 + 3 = 48`. **No `operational_validation`, `security_status`, `verification_state`, `lifecycle_state` or `roadmap_horizon` changed for any of the 48 rows**, and `evidence_confidence` changed for C-33 only.

> **Correction record (§5.8) — this section's own prior statement.** *Previously stated, now superseded:* "**No `implementation_status` changed, and the 4.4.8 totals are unchanged.** … `25 + 15 + 6 + 2 = 48` stands. **No `operational_validation`, `security_status`, `evidence_confidence` or `lifecycle_state` changed for any of the 48 rows.**" *Now stated:* the paragraph above. *Why:* that sentence was accurate for the pass it described, but is contradicted as an active claim by the C-33 reclassification and confidence change made here. *Scope:* this summary paragraph only. *What this does not imply:* the earlier passes' own bounded records are **not** rewritten — the twelve pre-existing layer entries, their footnotes and their per-pass counts stand exactly as those passes recorded them.

**Corrections from the latest NO-GO (§5.8).** P-03/P-06 L2/L6 are corrected in footnotes 14–15 and 24–25; P-03 signatures and engine citations in footnote 14; P-10 export-reference scope in footnote 22. The former §8 statement "nine factual contradictions, seven of them in statements added by a prior uncommitted revision" is superseded: committed HEAD already contains the P-01, P-03 and P-10 evidence-cell defects (#1, #2 and #6), so the nine-entry list does not support seven later additions. For the original nine-item inventory specifically, **three** defects (#1, #2, #6) are present in committed HEAD and **six** (#3, #4, #5, #7, #8, #9) concern notes 12–23 introduced in the uncommitted revision; those notes are absent at `22c0630f37cfa24c6a076f1f26a517130623573a`. This scoped count supersedes the earlier decision not to assert a replacement count; it is not a provenance count for the expanded inventory. The former "all four affected rows" is superseded by **six distinct rows / twelve cumulative layer corrections** in that preceding pass (five rows / eight entries before it). That pass changed **four cells in two rows**. The follow-up adds C-28/L5, so at the end of that pass the table recorded **seven distinct rows / thirteen cumulative layer corrections**; P-02's additional consumer wording correction changes no layer. The earlier L1/L2-only summary omitted L6 and is superseded by the paragraph above. These are inventory/coverage corrections, not additional status changes. The earlier unresolved C-28 disposition is superseded by footnote 26. The previous assertion that every affected row was Connected is superseded by the separate C-28 Implemented rationale above.

> **Correction record (§5.8) — cumulative layer-table figures.** *Previously stated, now superseded as a description of the table's **current** contents:* "the table now records **seven distinct rows / thirteen cumulative layer corrections**". *Now stated:* recounted directly from the table in this pass, it holds **fifteen layer corrections across nine distinct capability rows** — C-12, C-28, C-35, C-38, P-02, P-03 (three), P-06 (two), P-08 (two) and P-10 (three). *Why:* this pass appends C-12/L5 and C-35/L5, taking the table from thirteen entries across seven rows to fifteen across nine. *Scope:* the running total describing the table's contents only. *What this does not imply:* the superseded figure remains **correct as history** for the pass that wrote it, and is retained above on that basis — it is superseded only as a statement about the table as it now stands. No earlier entry, footnote or per-pass count is altered, and no `implementation_status` follows from any layer entry in the table.

**Provenance — what Git authenticates, and what it does not.** The three/six split above is established by direct comparison against committed HEAD: the P-01, P-03 and P-10 evidence-cell defects (#1, #2, #6) are present in `docs/product/canonical-structr-truth-v1.md` at `22c0630f37cfa24c6a076f1f26a517130623573a`, and footnotes 12–23 — which defects #3, #4, #5, #7, #8 and #9 concern — are absent from that file at that SHA. **That is the whole of what the Git objects authenticate:** the state of the committed file, and the absence of those notes from it.

> **Correction record (§5.8) — provenance authentication.** *Previously stated, now superseded:* the three/six split was presented without distinguishing what Git proves from what is reconstructed, alongside the claim that this pass "reproduced … the three committed evidence-cell defects and absence of notes 12–23 in committed HEAD" — accurate as far as it goes, but read together they invite the reading that Git authenticates the uncommitted drafting history as a whole. *Now stated:* the bounded paragraph above. *Why:* Git holds no object for any intermediate working-tree revision. It therefore **cannot** authenticate that notes #3, #4, #5, #7, #8 and #9 were worded as the inventory quotes them, when they were written, in what order, or by which session; that part rests on the working-tree text and the pass reports, which are **not** Git-authenticated evidence. Attributing those six to "the uncommitted revision" is a sound inference from their absence at HEAD, not a directly observed provenance chain. *Evidence:* `git show 22c0630f…:docs/product/canonical-structr-truth-v1.md` at this pass's window; no snapshot, date or custody chain is reconstructed here, and none is invented. *Scope:* the provenance statements in this section only. *What this does not imply:* the three/six split **stands** — it is compatible with, and derived from, the HEAD comparison. No inventory entry, footnote or classification depends on the drafting order, and nothing here revises §5.3's evidence classifications or §5.4's exact-SHA rules.

Two further checks were re-run and confirm statements this document depends on: the five security-program artifacts named in 4.4.7 are **absent** at the base SHA, and `origin/security/tenant-isolation-remediation-20260821` at `b95ea0bf4741646f418fcc99a22d22a42d24be51` is **not** an ancestor of it (`git merge-base --is-ancestor`, exit code 1). Confirming these changes nothing: every `security_status` remains `Not Evaluated`, and **this verification is not a security evaluation.** Observations recorded in footnote 14 about fail-open branches, and any observation anywhere in this document about `publicProcedure` usage, are structural facts only and are **not** promoted to security verdicts by this pass.

**`verification_state` for all 48 rows**

`REVERIFICATION REQUIRED`, registry-wide, by explicit human decision. The reasoning and its binding consequences are recorded in 4.4.8. In summary: §5.4 forbids a later commit inheriting an earlier verdict, and §5.5 defines current evidence as describing state *now*; these classifications describe the historical base SHA. **`CURRENT` is not redefined by this change.**

**No maturity or status demotion follows from that state.** Per §4.6 and §5.7, `verification_state` is orthogonal to the four dimensions of 4.5. `implementation_status`, `operational_validation`, `security_status`, `evidence_confidence` and `lifecycle_state` are unchanged for every row, and none may be read as demoted on account of this field. The latest `verified_at` above records only the stated bounded checks **at the historical base SHA**, not a complete registry verification, and asserts nothing about HEAD or any future commit.

**Post-commit review is still required before publication.** Committing this document produces a new SHA that carries no verdict from this anchor. An exact-SHA review of the resulting commit, on the reviewed pre-commit SHA and the resulting post-commit SHA as separate labelled anchors per §5.4, remains a precondition of publication and has not been performed.

**Document revision state**

- **Base version — committed.** The version committed at `22c0630f37cfa24c6a076f1f26a517130623573a` on branch `docs/canonical-structr-truth-v1`. That commit remains the historical record of the authoring pass.
- **This documentary revision — NOT COMMITTED.** The `verified_at` anchor, the layer rationales and correction records in 4.4.3 and 4.4.4 (footnotes 7 and 12–27), the cumulative layer corrections listed above, the evidence-cell corrections, and the registry-wide `verification_state` change are working-tree changes that have **not** been staged, committed, or pushed, and carry no commit SHA. They are not part of `22c0630f` and must not be cited as if they were.

**Document status**
`DRAFT — BASE VERSION COMMITTED LOCALLY; THIS REVISION UNCOMMITTED — PENDING INDEPENDENT REVIEW AND PUBLICATION REVIEW`

This verification changes nothing about that status. It supplies a bounded correction-verification time, the 4.4.2 layer rationales, and the corrections listed above; full registry re-verification remains pending; it is **not** an independent review, **not** a security evaluation, **not** an authorization to implement, and **not** an approval to stage, commit, push, merge, publish, or release. Every non-claim in Section 7 stands unchanged.

**Commit SHA**
**The document does not self-assert its own commit SHA.** The resulting commit SHA is recorded by the applicable exact-SHA delivery gate record.


## 9. Approved bounded correction — P-09 and feature evidence maintenance

**Decision and scope.** On 2026-09-10, the user approved the recommendation to correct P-09 and prepare a PR checklist and capability impact matrix in this task (response: “okay! aprovado.”). This records approval of that bounded documentary change. It does not assign the authority holders left open by OD-06, resolve any other open decision, or approve publication. The accompanying [feature evidence maintenance procedure](feature-evidence-maintenance.md) implements that workflow under Section 5; it does not change canonical definitions.

**Evidence anchor.** Repository: `https://github.com/wcvmsilva/structr-ai`. Reviewed historical source SHA: `5c29fd07535695566adc6bcb556b529ac94987ca`. Documentary pre-edit HEAD: `37d7c2a3c7a718b9d3571b093d2034665d7ca587`. `verified_at`: `2026-09-10T17:47:14Z` (bounded source inspection and identity comparison completed before this record time, during the approved local correction following the earlier independent review). All six source files listed below were read, and their complete bytes were compared between the historical source SHA, pre-edit HEAD and working files: identical. This corrects P-09 at the existing historical registry anchor; it does not re-anchor the other 47 rows or assert the current remote state. No application code, tests, build or database was executed. This working revision has no resulting commit SHA yet.

**VERIFIED FACT — bounded source observations at the historical source SHA:**

- `server/pricing-dimensions.ts:35–63, 90–170` defines source labels and identifiers and assigns database/default origins while resolving pricing dimensions.
- `server/scope-to-estimate-pipeline.ts:139–175, 601–668, 839–873` defines and builds a context snapshot with source labels, scope/project references, assembly references, multiplier values, pricing version and generation time. The caller includes it in `draftData` passed to `createEstimateDraft`.
- `server/db.ts:392–424` accepts and passes `draftData` to the insert expression. `drizzle/schema.ts:765–786` includes an estimate `metadata` field. These observations do not establish successful persistence of the snapshot.
- `server/estimate-export.ts:104–146` reads `draft.metadata`, emits export time and exporter identity, and emits `provenance.contextSnapshot` and `scopeDraftId`, allowing null values. `server/estimate-router.ts:756–778` calls that generator in `exportJson`. The inspected producer passes `draftData`, while the exporter reads `metadata`; this review does not establish a connecting transformation or end-to-end preservation.

**INFERENCE — implementation disposition.** These are functional surfaces relevant to provenance, so “No surface observed” is unsupported. Their composition does not establish §3.11's complete coverage of origin, derivation, authority, recording and verification times, completeness, and preservation across transformations for every consequential record. P-09 therefore becomes `INSUFFICIENT EVIDENCE TO CLASSIFY` under §4.4.2, with six `—` layer cells. No dedicated-module requirement is introduced and partial fields are not treated as a complete platform substrate.

**INFERENCE — confidence, assessed separately.** P-09 becomes `Low` under §4.4.9 because correspondence between the inspected surfaces and the full canonical capability remains uncertain. This is a separate evidence-confidence judgment, not a confidence value derived mechanically from implementation status.

**Correction and supersession record (§5.8).** Previously stated in P-09 View A: “No surface observed”, six `A` cells, `Missing`; in View B: `Medium`. Now stated: the observed partial surfaces above, six `—` cells, `INSUFFICIENT EVIDENCE TO CLASSIFY`, and independently justified `Low`. The prior statements are retained here as superseded history. This supersedes only those P-09 cells and their active aggregate consequences: the previous 25 connected / 15 implemented / 4 missing / 4 insufficient totals become **25 / 15 / 3 / 5**; platform subtotals **7 / 2 / 0 / 1**; operational subtotals remain **18 / 13 / 3 / 4**. Confidence changes from 44 Medium / 4 Low to **43 Medium / 5 Low**. The prior §4.4.8 correction records and Section 8 pass reports retain their historical meaning.

**Current cumulative correction inventory.** Three implementation reclassifications (C-33, C-32, P-09) and three independently justified confidence changes (the same IDs). The fifteen layer corrections across nine capabilities in Section 8 remain fifteen: the six P-09 `—` cells belong to its reclassification, using that section's existing counting rule. Earlier two-reclassification/two-confidence totals are superseded only as current cumulative totals.

**Limits.** This is a correction of the evidence interpretation, not an application regression or a completed provenance implementation. All 48 rows retain `REVERIFICATION REQUIRED`, `Not Validated` and `Not Evaluated`; lifecycle and roadmap fields remain unchanged. Section 8's drafting and delivery statements describe their earlier revision; this section records the additional local, uncommitted correction. No independent review of this new patch, security approval, operational validation, commit, push or publication is claimed. A later exact-SHA review must record its own result.
