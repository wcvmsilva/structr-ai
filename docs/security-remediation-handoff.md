# Structr.ai — Security Remediation Handoff v2

Updated immediately before G3a-1 implementation.

---

## 1. Purpose

This document is the canonical recovery point for the Structr.ai multi-tenant security remediation
program. It exists so that a new Claude Code session, an independent Codex reviewer, ChatGPT, or a
human engineer can resume the work **without reopening settled architectural decisions** and without
re-deriving the program's history from conversation transcripts.

Everything below is tagged by epistemic status. Read the tags; they are load-bearing.

| Tag | Meaning |
| --- | --- |
| **FACT** | Verified against the live repository or GitHub at the time of writing. Reproducible with the stated command. |
| **APPROVED DECISION** | A human-approved architectural or product decision. Binding. Do not relitigate without new human approval. |
| **OPEN ISSUE** | Known, unresolved, tracked. Not fixed. Do not claim otherwise. |
| **FUTURE WORK** | Deliberately deferred to a named later unit. |
| **DEPLOY PRECONDITION** | Must be verified against a live environment before production rollout. **Not** verified by any code-only pass. |

**Live-database state is never stated as fact in this document.** Every security pass in this program
has been code-only. No Supabase or production database has been read or written. Where migration
files imply a database state, that is recorded as migration *intent*, not as observed truth.

---

## 2. Current repository state — FACT

Verified immediately before writing this document.

| Item | Value |
| --- | --- |
| Repository | `wcvmsilva/structr-ai` (`https://github.com/wcvmsilva/structr-ai.git`) |
| Local working copy | `~/Desktop/structr-ai` |
| Security branch | `security/tenant-isolation-remediation-20260821` |
| Local HEAD | `ab131e7719efeb72e749d767020df302e15a742a` |
| Remote HEAD (`git ls-remote`) | `ab131e7719efeb72e749d767020df302e15a742a` |
| Local vs remote | in sync — 0 ahead, 0 behind |
| `origin/main` | `233569d68c014712ce3d25326bda8823aab1987e` |
| PR | [#9](https://github.com/wcvmsilva/structr-ai/pull/9) |
| PR state | `OPEN`, `isDraft: false` |
| PR merge status | `mergedAt: null`, `mergedBy: null`, `mergeCommit: null` — **NOT MERGED** |
| PR base ← head | `main` ← `security/tenant-isolation-remediation-20260821` |
| PR head SHA | `ab131e7719efeb72e749d767020df302e15a742a` |
| Working tree | clean |

### 2.1 Commit chain on the security branch — FACT

Newest first. All SHAs verified with `git log --format="%H %s"` at the time of writing; none copied
from an earlier handoff.

| SHA | Subject | Unit |
| --- | --- | --- |
| `ab131e7719efeb72e749d767020df302e15a742a` | `security: close G1 bundle caller-axis isolation` | **G1 Bundles** |
| `7c5d14877928ecc0e0657c278da8a00b6afe01f7` | `docs: define Structr data ownership model` | ADR / ownership docs |
| `0bc9e60503c348a1e1455f70d1f14939ff2ef5be` | `security: close remaining B2 Class-B route gaps` | Class-B remainder |
| `32ecac01163a7e6019a2b2cf44bdfb676aef0018` | `security: B2 boundary — subcontractor routes fail closed` | Subcontractors |
| `94419e8edd237aacb1bf9ec473d7c22fa7319255` | `security: B2 boundary — project/entity auth + Phase 2 conversion` | Project/entity + Phase 2 |
| `42e678fae94e6fc5a3bbcb32b17bcf105db4f7ab` | `security: B2 tenant isolation — unresolved caller tenant grants zero business access` | **B2 core** |
| `7524290d6fb93280dba881d594bff96ec29564e3` | `security: make leads.diagSchema platform-gated and tenant-scope its profile sample` | Self-review correction |
| `7b2b90b0edcd88071969ad5046ce4d276cf9c575` | `security: scope lead activities to the caller's tenant, graduate lead-db/pipeline-db in the audit` | Self-review correction |
| `7be4951879c465fef3b01f5f7231c316be09ac1f` | `security: enforce tenant isolation and CRM RBAC across lead, client, deal and pipeline domains` | CRM domain |
| `233569d68c014712ce3d25326bda8823aab1987e` | `test(auth): isolate Supabase env in auth tests` | merge-base with `main` |

---

## 3. Fixed operating protocol — APPROVED DECISION

### 3.1 Roles

**Claude Code** — implementer. Traces and designs, writes code and tests, performs measurement and
previous-HEAD execution proof. **Never merges.**

**Codex** — independent, read-only auditor. Does not edit. Re-derives claims independently rather
than accepting them. Execution-verifies important evidence where possible.

**Human** — arbitration. Approves scope expansion, product decisions, commits, pushes, and merge
gates. The only actor who may merge.

### 3.2 Canonical sequence

```
trace/design
  → human approval
  → implementation/measurement
  → human approval
  → atomic commit
  → push
  → independent Codex review
  → next unit
```

### 3.3 Permanent rules

- A green test suite is **not** proof of multi-tenant isolation.
- Inherited classifications must be reverified from HEAD, never trusted.
- Ambiguous blocker/follow-up classification escalates to the human. Do not self-classify.
- No generic bypass — no dev flag, admin flag, or escape hatch that skips tenant authorization.
- Tests that historically blessed insecure behavior are **inverted/renamed with a `HISTORY:` note**,
  never deleted.
- Previous-HEAD execution evidence is required for every load-bearing new test.
- Always distinguish load-bearing assertions from positive controls and documentation controls.
- Mutable operations are verified before being repeated (a step already performed is not re-run
  blindly).
- Documentation commits stay separate from security code commits.

---

## 4. Core architectural decisions — APPROVED DECISION

**The B2 rule:** an authenticated caller with no resolved tenant receives **no business-data
authorization**. `NULL` is not a tenant.

Consequences, all landed:

- `resolveTenantId`'s default/GCHI fallback was **removed**. It now returns `profile.tenantId ?? null`.
- `tenantProcedure` (`server/_core/trpc.ts`) is the caller-axis fail-closed boundary. An
  authenticated caller with no tenant receives `FORBIDDEN` — `"No tenant is assigned to this account (10005)"` —
  before any business helper runs. A silent empty result is deliberately avoided: an unprovisioned
  account and a tenant with no data render identically, and only the rejection is diagnosable.
- **Admin role is not tenant identity.** `adminProcedure` alone is **not** evidence of tenant
  isolation. `adminTenantProcedure` (admin **and** a resolved tenant) exists for administrative
  operations that act on tenant-owned data.
- Project/entity authorization does **not** automatically authorize every tenant-owned entity that a
  request references. Each referenced entity needs its own ownership check. (This is the lesson G1
  learned from `estimateLegacy.sendBundleToEstimate`, which guarded the project and not the bundle.)
- **Ownership and product entitlements are separate concepts.** Entitlement level never changes
  isolation rules.

---

## 5. The two tenant axes — APPROVED DECISION

These must never be conflated. Most misleading security claims in this program's history came from
collapsing them.

**CALLER AXIS** — *who is the authenticated tenant making the request?*
Closed by `tenantProcedure` plus tenant-scoped helpers.

**ROW AXIS** — *which tenant owns the stored row?*
Governed by the row's `tenant_id`, and unresolved for legacy rows where it is `NULL`.

### 5.1 Current per-domain position

**Bundles (G1, closed):** caller axis **closed**. Row axis **open** — while `TENANT_STRICT` is off,
the shared primitives `tenantFilter`/`tenantWhere`/`assertSameTenant` deliberately emit a
transitional `tenant_id IS NULL` arm, so legacy NULL-owned bundles remain readable and mutable by any
*resolved* tenant. That is **F15 / issue #10** and is not G1's claim.

**Geo (G3a, designed, not implemented):** the approved design is **stricter**. NULL-owned `geo_zones`
rows are **unknown provenance** and must be treated as neither tenant policy nor platform-global
reference. There is **no NULL arm** in the geo predicate.

### 5.2 Why the bundle transitional behavior must NOT be generalized to geo — APPROVED DECISION

Three independent reasons:

1. **Blast radius differs.** A visible legacy bundle is a template a tenant may not have authored. A
   visible legacy geo zone is a *priced commercial policy* — labor/material/logistics modifiers,
   contingency, and the Profit Shield floor — that silently changes what another tenant charges and
   how much margin protection they carry.
2. **The repository states the opposite intent for geo.** Migration `0004` §14.2 carries the comment:
   *"Existing geo zones belong to the default tenant, so a second GC starts empty instead of inheriting
   Charleston zones it never validated."* There is no equivalent statement for bundles. The NULL arm
   for bundles is a rollout convenience; for geo it would contradict a committed design statement.
3. **The ADR forbids it.** Invariant 1: *"No commercial or operational tenant data becomes global
   because `tenant_id` is NULL."* Geo policy columns are commercial data. Bundles' transitional arm is
   an accepted, documented, time-boxed exception pending F15 — not a precedent.

**Therefore: the geo predicate is strict equality, implemented locally in `server/geo-db.ts`.
`server/tenant-scope.ts` must NOT be changed** — it is shared with bundles, clients, and leads, where
the NULL arm is deliberate.

---

## 6. G1 Bundles — final closed state

**Commit:** `ab131e7719efeb72e749d767020df302e15a742a` — FACT
**Independent Codex verdict:** **G1 GO** — FACT
**Canonical narrow claim** — APPROVED DECISION:

> **"Bundles caller-axis fail-closed; legacy NULL row isolation remains F15."**

Do not restate this as "bundles are fully tenant-isolated."

### 6.1 Independently re-derived live bundle surface — FACT

Measurement disproved the prior assumption that bundle helpers were reached only from
`bundle-router.ts`.

- **11 live entry points** — the 9 `bundle-router.ts` routes, plus:
  - `preset.delete` (`server/preset-router.ts`) — an **external mutation path** reaching `deleteBundle`
  - `estimateLegacy.sendBundleToEstimate` (`server/estimate-legacy-router.ts`) — an **external
    read/copy path** that read a bundle and persisted its contents into the caller's `estimate_drafts`
- **9 primary bundle helpers** in `server/db.ts`, each now requiring a non-null `tenantId`, making
  omission a compile-time error at the call site.
- `bundle_items` has no `tenant_id` column and is parent-scoped **by design**; item mutations
  authorize through the parent bundle, never by child id alone.

### 6.2 Test evidence — precise classification — FACT

Suite: `server/tenant-b2-bundles.test.ts`.

| Baseline | Result |
| --- | --- |
| Previous HEAD `7c5d14877928ecc0e0657c278da8a00b6afe01f7` | **12 passed / 34 failed** |
| Current HEAD `ab131e77…` | **46 passed** |

**The defensible classification is not "34 security proofs".** It is:

- **32** G1 proof/regression assertions
- **2** G1-sensitive F15 boundary assertions
- **10** positive/regression controls
- **2** F15 documentation controls

Do **not** describe all 34 previous-HEAD failures as independent isolation proof. — APPROVED DECISION

### 6.3 Reviewed scope — FACT

`server/db.ts` was independently reviewed and its G1 delta confirmed **confined to the bundle
surface** (the bundle helper region plus one import line). No non-bundle function signature changed.

---

## 7. G1 open merge blockers — OPEN ISSUE

Recorded **separately** from the G1 tenant-isolation GO. G1 GO does not clear these.

Naming note: `rule-F2` and `rule-F5` are **repository-rule** identifiers. They are unrelated to the
historical `finding-F2` / `finding-F5` taxonomy. Do not conflate.

### rule-F2 — `preset.delete` lacks required audit logging

Codex classification: **pre-existing**, **P2**, **not a G1 caller-axis failure**, **still a PR merge
blocker under repository rules.**

### rule-F5 — bundle-item workflows are multi-statement / non-transactional

Codex classification: **no production-reachable cross-tenant race demonstrated**, **P2 transactional /
repository-rule hardening**, **not a G1 caller-axis failure**, **still a PR merge blocker under
repository rules.**

Neither is part of G3a. Neither may be fixed opportunistically inside another unit.

---

## 8. Data ownership model — current state

Authoritative source: **`docs/adr/ADR-001-structr-data-ownership-model.md`** (commit `7c5d1487`).
Companion: **`docs/security/class-g-reclassification-and-remediation-plan.md`**.

### 8.1 Approved ownership principles — APPROVED DECISION

Four categories: **PLATFORM CANONICAL** · **TENANT WORKSPACE** · **TENANT OVERRIDES** · **SYSTEM**.

Core rules, quoted in substance from the ADR:

- Global content must never contain tenant-specific competitive or operational data.
- Tenant commercial/operational data must never become global merely because `tenant_id` is NULL.
- Globality must be **explicit** — declared in schema and in named route carve-outs, never inferred
  from a NULL column.

Security invariants (permanent architecture rules), abbreviated:

1. No commercial/operational tenant data becomes global because `tenant_id` is NULL.
2. Global ownership must be explicit, never inferred from NULL.
3. Tenant-owned business data requires a resolved caller tenant before business authorization.
4. Platform canonical templates are cloned for tenant customization; tenants do not mutate canonical records.
5. Entitlement level never changes tenant isolation rules.
6. Ownership model and commercial entitlement model are separate concerns.
7. **No legacy `tenant_id IS NULL` row may be assigned to a tenant solely because it is currently
   unowned. Backfill requires row-level provenance evidence or an explicit, audited human
   classification.**

Domain decisions: assemblies = HYBRID · bundles = TENANT-OWNED · geo = **SPLIT** geography from
commercial policy · geographic overrides = TENANT-OWNED.

### 8.2 ADR correction — OPEN ISSUE

The ADR's own text is **not fully accurate** and is corrected here rather than silently reinterpreted.
The history stays; the corrected interpretation is stated explicitly.

**ADR §"Ownership Categories" lists `CHARLESTON_ZONES` as PLATFORM CANONICAL.** G3a measurement
disproves this: the constant carries `laborModifier`, `logisticsModifier`, `materialModifier`,
`contingencyPct`, and `minProfitShieldPct` (values up to 50.0) — commercial tenant policy, not
reference data. **Corrected interpretation:** `CHARLESTON_ZONES` is a *mixed* constant. Its
geographic fields are reference; its modifier and floor fields are GCHI commercial policy and must
not be served to other tenants or used as a fallback.

**ADR §"Geo — SPLIT"** classifies `radiusMiles` and `coastalExposureLevel` as PLATFORM GLOBAL. G3a
measurement classifies both as **ambiguous**: `radiusMiles` is geometry *and* service-area policy;
`coastalExposureLevel` is physically determined *but drives risk pricing*. **Corrected
interpretation:** treat both as ambiguous pending G3b. G3a scopes them with the row (conservative
direction) rather than exposing them as reference.

---

## 9. Corrections register — FACT / OPEN ISSUE

Every correction known at the time of writing. Nothing here is retro-edited into an older document;
history is preserved and corrected in place.

1. **Historical geo route inventory was incomplete.** Independently reproduced surface at HEAD:
   **18 `geoRouter` routes**, **24 routes touching or dependent on `geo_zones`** (13 direct + 11
   indirect), **29 geo-related routes overall**.
2. **"Class-G remaining: 23 routes" is obsolete.** Do not reuse that figure.
3. **Earlier classification of `charlestonZones`, `geocodeAddress`, and `reverseGeocode` as pure
   platform reference was incorrect.**
4. **`CHARLESTON_ZONES` contains commercial tenant policy**, including modifiers and profit-floor
   values.
5. **`checkServiceRadius` / `OPERATING_CENTER` / `MAX_SERVICE_RADIUS_MILES` also carry GCHI operating
   policy** and must not be treated as universal reference data. `checkServiceRadius` was not
   previously flagged.
6. **"No DB read" does not imply "platform reference".** A hard-coded constant can belong to a tenant.
7. **`adminProcedure` is role authorization, not tenant ownership.**
8. **`geo-db.ts`'s allowlist comment in `server/tenant-coverage-audit.ts` — "reference data, tenant
   enforced by the calling router" — is false in both halves** for the current pre-G3a code.
9. **`price-adjustment-db.ts` and `calibration-db.ts` demonstrate scanner false assurance:** the audit
   marks a module scoped if the file merely *contains* tenant-scope symbols, so their unscoped geo
   branches are invisible to it and will remain invisible after G3a.
10. **The geographic-overrides surface is larger than the old three-route inventory.** Discrepancy is
    **unresolved**: Claude counted **13** direct `geoOverride` router routes; Codex reported **15**
    surfaces including indirect consumers. **G2 must independently reconcile this.** Do not record it
    as settled.
11. **Migration `0004` repository evidence establishes intent / state-if-applied-successfully, not
    live database truth.**
12. **PR #9's leading banner contains stale historical HEAD text** (it still cites `0bc9e605` as the
    branch head). Correct only in a controlled PR update; do not silently rewrite history.
13. **G1 test-evidence wording correction:** use the 32 + 2 + 10 + 2 classification from §6.2.
14. **A previous procedure-count statement for `geoRouter` said "4 `adminProcedure`" while naming
    five** — `create`, `update`, `deactivate`, `reactivate`, `seedCharleston`. Future work must
    recompute counts from HEAD before claiming them.

---

## 10. Geo data ownership — approved model — APPROVED DECISION

> **GLOBAL GEOGRAPHY MAY BE SHARED. GCHI OPERATING/COMMERCIAL POLICY MAY NOT.**

**Reference geography** may include genuinely physical/reference attributes: formatted address,
coordinates, ZIP, county, centroid, and physical/coastal classification *where genuinely
reference-only*.

**Tenant commercial/operating policy** includes at minimum: `laborModifier`, `materialModifier`,
`logisticsModifier`, `logisticsComplexity` where operationally tenant-defined, `contingencyPct`,
`minProfitShieldPct`, `costMultiplier`, the calibration/validation fields (`validatedFloorPct`,
`validatedAt`, `validationSampleCount`), service-area/operating-center policy, and any equivalent
commercial policy.

**Storage location does not determine ownership.** A value hard-coded in a shared TypeScript constant
can be tenant commercial policy just as much as a database column. This is the general form of
correction 6.

---

## 11. Migration 0004 evidence — FACT (repository) / not live truth

Repository evidence shows migration `drizzle/0004_phase4_learning_multitenant.sql`:

- adds `geo_zones.tenant_id` (plus `validated_floor_pct`, `validated_at`, `validation_sample_count`);
- creates a tenant index and **attempts** FK `fk_geo_zones_tenant → tenants(id) ON DELETE RESTRICT`,
  wrapped so that failure is swallowed as a `RAISE NOTICE` — i.e. **best-effort**;
- stamps existing NULL `geo_zones` rows to tenant slug `gchi` **where the migration successfully ran
  and a `gchi` tenant existed** (the `UPDATE` is conditional on `EXISTS (SELECT 1 FROM tenants WHERE slug = 'gchi')`).

Use this precise statement, verbatim, whenever the topic arises:

> **"Repository evidence establishes that where migration 0004 was applied successfully and the
> expected GCHI tenant existed, `geo_zones` rows were intended to be stamped to GCHI. Live database
> state has not been independently verified in the code-only security passes."**

Additional drift — FUTURE WORK, **G3b, not G3a**:

- `drizzle/schema.ts` keeps `geoZones.tenantId` **nullable**;
- `schema.ts` does **not** mirror the migration's FK intent (unlike `geographicOverrides.tenantId`,
  which does declare the FK);
- FK creation in SQL is best-effort.

Separately: `drizzle/sync-new-columns.sql` is **not** in `drizzle/meta/_journal.json`. It is an
out-of-band operational drift-repair script dated 2026-03-30 that adds 13 `geo_zones` columns but
**not** `tenant_id`. It creates no ownership drift relevant to G3a and must not be modified.

---

## 12. Two possible live environment states — DEPLOY PRECONDITION

**Neither case is claimed to be the current state. Do not assert which one is true.**

**CASE A — 0004 successfully stamped the required GCHI geo rows.**
Under G3a strict equality: GCHI retains its own policy; other tenants cannot inherit it; a tenant
without policy receives no tenant-specific zone or modifiers. This matches the migration's stated
intent and implies no operational disruption.

**CASE B — required rows remain NULL because the migration or the stamp did not land.**
Under G3a strict equality: those rows become inaccessible, and **even GCHI may fail closed** to
no-zone/default behavior rather than inheriting them.

Case B is an **operational deployment risk, not a justification to weaken code.** The response is the
live verification in §18, followed by a separate data/provenance decision — never a relaxed predicate.

---

## 13. G3a design status — APPROVED DECISION

**G3a design: APPROVED FOR HUMAN-CONTROLLED IMPLEMENTATION SEQUENCING.**

**Implementation has NOT started at the time of this handoff.** No G3a code, test, or file exists in
the repository. G3a as a whole is **not** complete and must not be described as such.

Approved decomposition: **G3a-1 → G3a-2 → G3a-3.** Only **G3a-1** is next.

---

## 14. G3a-1 — the next unit

### 14.1 Canonical intended security claim — APPROVED DECISION

> "Geo-zone tenant-policy reads, writes, detection, and project/lead consumption fail closed at the
> caller and explicit-row axes. Explicit foreign-tenant and NULL-owned geo policy are not available as
> tenant policy. No new project/lead snapshot can be populated from another tenant's geo policy. GCHI
> commercial policy is no longer used as a global fallback."

### 14.2 What G3a-1 explicitly does NOT claim — APPROVED DECISION

- permanent **reference-axis** isolation (service radius / operating center remain GCHI constants);
- G2 geographic-override isolation;
- G3b schema decomposition;
- historical snapshot cleanup;
- live database correctness.

### 14.3 Binding product decisions — APPROVED DECISION

**DECISION-1 — `geo.charlestonZones` becomes reference-only.** It must not expose commercial tenant
policy (modifiers, contingency, profit floor, or computed modifier snapshots).

**DECISION-2 — `GEO_NO_ZONE` wording must no longer claim Charleston defaults were applied.**
Approved semantics:

> "No tenant-specific geographic zone was found. Tenant-specific geographic modifiers were not applied."

Do **not** couple user-facing wording to a specific 35% number.

*Implementation note — FACT:* the offending strings are in **`shared/geo-engine.ts`** only —
`GEO_NO_ZONE` ("Could not determine geographic zone. Charleston Metro defaults applied.") and
`GEO_DEFAULT_ZONE` ("Using default Charleston Metro zone. Verify address for accurate pricing."),
both in `validateGeoContext`. The parallel warning system in `shared/geo-context-warnings.ts` uses
code `geo.zone_not_detected` with the message *"No geographic zone was detected for this project. Zone
modifiers and coastal floors cannot be applied automatically."* — **already consistent with DECISION-2
and requiring no change.** See §14.4.

**DECISION-3 — GCHI operating center / service radius must NOT be treated as global tenant policy.**
Binding principle: **GLOBAL GEOGRAPHY MAY BE SHARED. GCHI OPERATING POLICY MAY NOT.** G3a must
preserve reference geocoding where possible, but cannot silently apply GCHI's operating-center and
60-mile service-radius policy to arbitrary tenants. A permanent tenant-configurable service-area
architecture is **G3b**. Within G3a-1 this is documented as a known interim limitation, not claimed as
solved.

### 14.4 Approved file boundary — APPROVED DECISION

**Approved production files:**

```
server/geo-db.ts
server/geo-router.ts
server/geo-integration.ts
server/project-router.ts
server/lead-conversion.ts
server/lead-router.ts
server/seed.ts
server/tenant-coverage-audit.ts
shared/geo-engine.ts
```

**New test file:** `server/tenant-g3a-geo-zones.test.ts`

**Conditional approval:** `shared/geo-context-warnings.ts` — approved **only if** the `GEO_NO_ZONE`
wording/projection requiring correction is defined there.
**FACT: it is not.** The file exists, but its no-zone warning (`geo.zone_not_detected`) is already
correct, and `GEO_NO_ZONE` lives in `shared/geo-engine.ts`. **The condition is therefore NOT met and
this file must NOT be modified.**

**Not pre-approved:** `server/geo-geocoding.ts`. If G3a-1 requires modifying it, implementation must
**STOP for scope approval**.

**Any other new production file also requires STOP before modification.**

### 14.5 Core technical rules — APPROVED DECISION

- Strict local geo tenant predicate, defined in `server/geo-db.ts`.
- **Do NOT alter `server/tenant-scope.ts`** (shared with bundles/clients/leads; its NULL arm is deliberate).
- `tenantId` required and non-nullable on every tenant-owned geo helper — omission must be a
  compile-time error.
- Explicit tenant equality. **No NULL arm.** NULL means unknown provenance.
- `adminTenantProcedure` for admin operations acting on tenant-owned policy.
- **Final `UPDATE` predicates must repeat tenant ownership** (the rule-F5 lesson applied proactively).
- Foreign and nonexistent IDs remain **non-disclosing** — same code, same message, same shape, no
  differing pre-authorization side effect. Note: the duplicate-name check in `geo.create` must become
  tenant-scoped, or it becomes a new existence oracle.
- `create` and seed paths must stamp the trusted tenant.
- Seed name discovery must be tenant-scoped (today it is a global `zone_name` lookup, which both
  leaks existence and causes a second tenant's seed to silently skip).
- `CHARLESTON_ZONES` commercial fallback removed from all runtime detection paths.
- Project/lead snapshots may only be populated from same-tenant policy.
- **Historical snapshots remain untouched.**

---

## 15. G3a-2 — planned, NOT started — FUTURE WORK

**Canonical claim:**

> "No price-adjustment or calibration path can read or write another tenant's geo zone; final geo
> mutation predicates include the trusted tenant."

**Expected route family:** `priceAdjustment.propose`, `proposeFromRun`, `previewImpact`,
`applyToPriceBook`, `rollback`, `calibration.runTenant`.

**Likely files:** `server/price-adjustment-db.ts`, `server/calibration-db.ts`,
`server/price-adjustment-router.ts`, `server/calibration-router.ts`, plus dedicated tests.

**Do not start until G3a-1 completes its full cycle and passes independent Codex review.**

---

## 16. G3a-3 — planned, NOT started — FUTURE WORK

**Canonical claim:**

> "No operational geo seed path can create NULL-owned zones or discover another tenant's zone by
> global name."

**Expected file:** `scripts/seed-geo-zones.mjs`. It must eventually require explicit tenant ownership
and **fail loudly** if absent — never infer GCHI, never default.

**Do not start before G3a-2's authorized sequence completes.**

---

## 17. Boundaries of adjacent units

### 17.1 G2 / geographic overrides — FUTURE WORK

G2 remains **independent**. G3a does **not** absorb `geographic_overrides`.

Known state: geo-override logic remains tenant-blind and needs its own fresh measurement. The
historical three-route assumption is **obsolete**. A fresh G2 inventory must reconcile Claude's **13**
direct `geoOverride` router routes against Codex's **15** surfaces including indirect consumers. **Do
not classify this discrepancy as resolved.**

Verified for G3a's benefit only: `server/geo-override-db.ts` treats `zoneId` as an opaque filter column
and never selects from or joins `geoZones`, so scoping `geo_zones` requires no override-code edit.

### 17.2 G3b — FUTURE WORK

Architecture and data work, none of which belongs in code-only remediation:

- permanent reference vs tenant-policy decomposition of `geo_zones`;
- tenant-configurable operating center / service radius;
- `schema.ts` FK alignment with migration intent;
- NULL / provenance decisions;
- live state verification and remediation, as separately authorized;
- possible canonical/reference markers if the product architecture later requires them.

---

## 18. Other open security blockers — OPEN ISSUE

None of the following is resolved. Do not mark any item resolved without current repository evidence.

- **Codex P1-2** — RBAC fail-open / default role semantics.
- **P1-3** — conversion `client:write` enforcement.
- **P1-4** — deal parent ownership / cross-tenant lead.
- **P1-5** — durable F9 ownership/provenance / TOCTOU issue.
- **F15 / issue #10** — row-NULL provenance and backfill program.
- **Legacy OAuth default-tenant provisioning decision.**
- **`withTenant` general override behavior follow-up** — it is stamp-if-absent, not force: a
  pre-existing non-null `tenantId` on the payload is preserved rather than overridden.
- **Non-auth cluster** — historical findings F4 / F5 / F13 / F14 / F16 / F17, as previously tracked.
- **Audit scanner hardening** — two distinct defects: (a) `server/db.ts` is outside the scanner's
  `*-db.ts` / `queries.ts` file-selection rule entirely; (b) file-level tenant-scope detection hides
  unscoped branches inside otherwise-scoped modules (correction 9).
- **`getLeadStats` dead-code follow-up.**
- **`ensureProfileExists` tracked defect.**
- **Write-stamping findings** in `jobtread-export-db` and `previsit-db`.
- **Cross-tenant existence-disclosure observations** outside bundles, where still open.
- **G1 `rule-F2` and `rule-F5`** (§7).

---

## 19. Merge gate

> ## PR #9 MERGE GATE = **NO-GO**
> ## B2 GLOBAL CLAIM = **NOT YET DEFENSIBLE**

- **G1 GO does not mean PR merge GO.**
- **G3a design approval does not mean G3a implementation GO.**

Merge consideration requires **all** of: completed units, independent final Codex review against the
final HEAD, repository-rule blockers closed (including `rule-F2` and `rule-F5`), and deploy/live-state
preconditions satisfied.

---

## 20. Future live deploy precondition — DEPLOY PRECONDITION

**Recorded, NOT executed.** No live database access is authorized by this document.

Before G3a reaches production, the target environment requires live verification of:

1. a `geo_zones` **ownership census**;
2. whether the migration `0004` stamp **exists and applied as expected**;
3. the **count** of `geo_zones` rows where `tenant_id IS NULL`;
4. whether the geo policy rows GCHI depends on are **actually owned by GCHI**;
5. that a second tenant without geo policy receives **no GCHI commercial policy**;
6. that **no assumption is made that NULL means GCHI**.

**If required operational rows are unexpectedly NULL, deployment blocks.** The next action is then a
separate data/provenance decision under ADR Invariant 7.

**Do not write "backfill to GCHI" as the automatic response.** That inference is forbidden.

---

## 21. Next exact action

```
NEXT UNIT:
  G3a-1

STATE:
  design approved
  implementation NOT yet started

NEXT EXECUTION:
  Claude Code implements ONLY G3a-1, using the separately approved
  implementation prompt.

STOP CONDITIONS (halt and request approval):
  - scope expansion
  - any new production file
  - schema or migration need
  - product semantic invention
  - G2 coupling
  - modification of server/geo-geocoding.ts

AFTER IMPLEMENTATION:
  human review
    → commit approval
    → push
    → independent Codex review
    → only then G3a-2
```

---

## 22. Permanent constraints

- No Supabase during code-only remediation.
- No migrations unless separately authorized.
- No backfill unless separately authorized.
- No `TENANT_STRICT` change unless separately authorized.
- No merge of PR #9 until the final gate.
- Codex never edits.
- Claude never merges.
- No silent scope expansion.
- No silent product decision.
- No NULL ownership inference.
- No historical rewrite to hide prior mistakes.
- Corrections are recorded explicitly.
