# Class-G Reclassification & Remediation Plan — Ownership Model V1

**Read-only pass at HEAD `0bc9e605`** (branch `security/tenant-isolation-remediation-20260821`, verified == remote). Companion to `docs/adr/ADR-001-structr-data-ownership-model.md`. Checkpoint-final revision (2026-08-23). Nothing in this plan was implemented; **no live database state was queried in this pass.**

---

## 0. Material divergence from the prior handoff (report-first, per protocol)

**Migration `drizzle/0004_phase4_learning_multitenant.sql` line ~1178:**

```sql
UPDATE geo_zones
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'gchi' LIMIT 1)
```

The handoff stated all three tables have `tenant_id` "not populated by any writer / all rows NULL." That is **false as a repository claim for `geo_zones`**: migration 0004 is a writer.

**Evidentiary framing (binding for all downstream documents):** *Repository and migration evidence establishes that wherever migration 0004 was applied successfully, `geo_zones` rows were stamped to the GCHI tenant. Live database state was not independently verified in this read-only pass.* (`docs/phase4-notes.md` records 0004 as executed; Supabase was intentionally not queried, per standing constraints.)

This clarification is about **evidentiary precision, not risk reduction**: the security path remains production-capable and merge-relevant. The 8 ungated geo zone-data routes serve whatever those rows contain — including `minProfitShieldPct`, `laborModifier`, `materialModifier` — to any authenticated caller of any tenant, and `pnpm seed:demo` creates a second tenant (`demo-coastal-gc`). For the geo family, "safe by accident of data" cannot be relied on.

`assemblies`, `bundles`, `geographic_overrides`: **repository evidence shows that current repository writers do not stamp `tenant_id` for these paths** (0004 touches none of them; `seed-assemblies.mjs` has zero tenant references; bundle/override writers stamp nothing); **live row state was not independently verified in this read-only pass.** Row provenance for any legacy `tenant_id IS NULL` rows is unproven (§1, Invariant 7).

Secondary drift: `drizzle/schema.ts` defines `geoZones.tenantId` **without** a `.references()` FK, while 0004 adds `fk_geo_zones_tenant` best-effort in SQL (wrapped, `RAISE NOTICE` on skip). Schema/SQL divergence to align during geo work.

---

## 1. Task 1 — Validation of the approved model against current code

### assemblies (approved: HYBRID)
- **Schema:** `tenant_id` nullable FK→tenants (RESTRICT), indexed. On `CRITICAL_TENANT_TABLES`. `region` defaults `charleston_sc`; `coastalModifier`, `trade`, `finishLevel`, `wasteFactor`.
- **tenant_id semantics today:** repository evidence shows current repository writers do not stamp `tenant_id` for these paths; **live row state was not independently verified**. To the extent rows are unstamped, NULL is currently carrying the meaning "the only catalog there is" — which under Invariant 2 cannot mean "canonical."
- **Writers:** `createAssembly`, `updateAssembly`, `deleteAssembly`, `cloneAssembly`, `addComponentToAssembly`, `removeComponentFromAssembly` (all reached only via `adminProcedure`), plus `seed-assemblies.mjs` (no ownership stamping). Note: `adminProcedure` gates on profile role, which per the diagSchema finding is a *tenant* administrator concept, not a platform-operator concept — the write surface is admin-gated, but "every historical row was platform-authored" is a write-path inference, not row-level proof.
- **Readers:** `listAssemblies`, `getAssemblyById`, `getAssembliesByCategory/Trade`, `getAssemblyCategories/Trades/Stats` — consumed by `assembly-router` and also by `scope-router`, `remodel-router`, `geo-override-router`, `estimate-router`, `scope-to-estimate-pipeline` (estimating pipeline dependency — G4 blast radius).
- **Authorization today:** reads `protectedProcedure` (any authenticated caller, tenant resolved or not); writes `adminProcedure`.
- **Contradiction vs model:** current behavior matches the *canonical half* of HYBRID; the *tenant half* does not exist; canonical status is implicit (NULL) instead of explicit.
- **Code-only?** Interim yes, **under the ADR interim rule and approved caller rule** (see G4a). Full HYBRID: no — schema marker + tenant-assembly surface + reader semantics are G4b.

### bundles (approved: TENANT-OWNED)
- **Schema:** `tenant_id` nullable FK, indexed; `isCustomizable` default TRUE; `bundleDiscount` default 0.08.
- **tenant_id semantics:** repository evidence shows current repository writers do not stamp `tenant_id` for these paths; **live row state was not independently verified**. These rows were created through a **self-service authenticated surface**; historically that surface was used in a single-tenant reality, but **per-row provenance is unproven by repository evidence**. Under Invariant 7 any legacy NULL rows must be provenance-classified before any backfill — automatic assignment to the bootstrap tenant is not permitted, and the possibility of future platform bundle templates makes automatic tenant assignment additionally unsafe.
- **Writers/readers:** `createBundle`, `getBundleById`, `listBundles`, `updateBundleMeta`, `addItemToBundle`, `updateBundleItemQuantity`, `removeBundleItem`, `duplicateBundle`, `deleteBundle` — all in `server/db.ts`, imported only by `bundle-router.ts`. `KNOWN_UNSCOPED_MODULES` lists a `bundles-db.ts` that does not exist (stale entry; the audit therefore does not "see" the real location in `db.ts`).
- **Authorization today:** all nine routes `protectedProcedure`, including all writes. Any authenticated caller — tenant resolved or not — can create, mutate and delete bundles.
- **Contradiction vs model:** total on the isolation axis; behavioral self-service already matches TENANT intent.
- **Code-only?** **Yes** for the caller axis. Row provenance + stamping = later data operation (F15-class, Invariant 7).

### geo_zones (approved: SPLIT reference vs tenant policy)
- **Schema:** one table mixing PLATFORM GEOGRAPHIC REFERENCE columns (`name`, `zoneName`, `county`, `zipCodes`, `boundaryGeojson`, `centerLat/Lng`, `radiusMiles`, `coastalExposureLevel`) with TENANT GEO POLICY columns (`costMultiplier`, `laborModifier`, `materialModifier`, `logisticsModifier`, `logisticsComplexity`, `contingencyPct`, `minProfitShieldPct`, `validatedFloorPct`, `validatedAt`, `validationSampleCount`). PHASE 4 comment records tenant-property intent. `tenant_id` has index but no FK in `schema.ts` (FK exists best-effort in 0004 SQL).
- **tenant_id semantics:** per §0 — repository and migration evidence establishes GCHI stamping wherever 0004 was applied; live DB state not independently verified in this pass.
- **Writers:** `createGeoZone`, `updateGeoZone`, `deactivate/reactivateGeoZone`, `seedCharlestonZones` (admin), migration 0004 backfill. None caller-tenant-aware.
- **Readers:** `getGeoZoneById/ByName`, `listGeoZones`, `getGeoZoneStats`, `loadActiveZonesForEngine` + `dbZoneToEngineZone` (engine feed choke point), `assignZoneToProject` / `getProjectZoneSnapshot` (project-gated). Modifier consumers: `shared/pricing-engine.ts`, `shared/geo-engine.ts`, `shared/geo-context-warnings.ts`, `server/pricing-router.ts`, `server/price-adjustment-db.ts`, `server/lead-conversion.ts` — G3 blast radius, centralized through the engine feed.
- **Contradiction vs model:** the table *is* the contradiction — two ownership categories in one row; plus tenant-stamped policy (per migration evidence) served ungated.
- **Code-only?** Interim gating: yes. The split itself: no — schema/architecture + migration (G3b), where live 0004 state is legitimately verified.

### geographic_overrides (approved: TENANT-OWNED)
- **Schema:** `tenant_id` nullable FK→tenants; FKs to `geo_zones`, `assemblies` ×2 (original/replacement), `cost_codes`; `overrideType/Value`, `reason`, `trade`, `finishLevel`.
- **tenant_id semantics:** repository evidence shows current repository writers do not stamp `tenant_id` for these paths; **live row state was not independently verified**. Per-row provenance of any legacy NULL rows is unproven — Invariant 7 applies before any backfill.
- **Writers:** `createOverrideRule`, `updateOverrideRule`, `deactivate/reactivateOverrideRule` (admin), `writeOverrideLogEntries` (draft-gated; also called from `remodel-router`), `clearOverrideLogForDraft`.
- **Readers:** `listOverrideRules` (also consumed by `remodel-router` — verify that call site's gating during G2 measurement), `getOverrideRuleById`, `getOverrideCountsByZoneId` (statsByZone), `getOverrideLogForDraft`, `hasOverridesApplied`.
- **Authorization today:** rule mutations `adminProcedure`; draft-linked reads gated via `requireEntityAccess("scopeDraft", ...)`; `listRules`/`getRule`/`statsByZone` ungated `protectedProcedure`.
- **Contradiction vs model:** rules are tenant exceptions but are authored platform-side (admin) and readable by anyone authenticated.
- **Code-only?** **Yes** for the caller axis; provenance-classified stamping later.

---

## 2. Task 3 — Route-by-route reclassification (the 32)

Legend: **A** platform-global carve-out · **B** tenant-owned · **C** hybrid semantics · **D** schema/architecture split required · **E** human decision still required.

Count reconciliation with the inventory is exact: assembly 9 `protectedProcedure` (incl. inline-style `categories`/`trades`/`stats`), bundle 9, geo 13 protected − 2 gated (`assignToProject`, `getProjectZone` via `requireProjectAccessTrpc`) = 11, geo-override 7 protected − 4 gated (`resolveForDraft`, `previewForDraft`, `getLog`, `hasOverrides` via `requireEntityAccess`) = 3. **9+9+11+3 = 32.**

| # | Route | Data touched | Class | Unit | Notes |
|---|---|---|---|---|---|
| 1 | assembly.list | assemblies (list) | C | G4 | interim: carve-out under ADR interim rule |
| 2 | assembly.getById | assemblies+items | C | G4 | full hybrid: canonical ∪ caller tenant (G4b) |
| 3 | assembly.getByTrade | assemblies | C | G4 | |
| 4 | assembly.getByCategory | assemblies | C | G4 | |
| 5 | assembly.categories | assemblies agg | C | G4 | inline `.query` style |
| 6 | assembly.trades | assemblies agg | C | G4 | |
| 7 | assembly.stats | assemblies agg | C | G4 | |
| 8 | assembly.calculateCost | assemblies+pricing | C | G4 | estimating path |
| 9 | assembly.calculateBatch | assemblies+pricing | C | G4 | |
| 10 | bundle.create | bundles (write) | B | G1 | open write today |
| 11 | bundle.getById | bundles+items | B | G1 | |
| 12 | bundle.list | bundles | B | G1 | |
| 13 | bundle.updateMeta | bundles (write) | B | G1 | |
| 14 | bundle.addItem | bundle_items (write) | B | G1 | parent-scoped via bundle |
| 15 | bundle.updateItemQuantity | bundle_items (write) | B | G1 | |
| 16 | bundle.removeItem | bundle_items (write) | B | G1 | |
| 17 | bundle.duplicate | bundles+items (write) | B | G1 | copy must stay in-tenant |
| 18 | bundle.delete | bundles (write) | B | G1 | |
| 19 | geo.list | geo_zones rows | D | G3 | stamped per migration evidence (§0) |
| 20 | geo.getById | geo_zones row | D | G3 | |
| 21 | geo.getByName | geo_zones row | D | G3 | |
| 22 | geo.detectFromZip | geo_zones rows | D | G3 | returns full zone incl. policy |
| 23 | geo.detectFromCoords | geo_zones rows | D | G3 | |
| 24 | geo.geocodeAndDetectZone | geocode + zones | D | G3 | detection half is the exposure |
| 25 | geo.checkServiceRadius | geo_zones rows | D | G3 | service area = tenant policy |
| 26 | geo.stats | geo_zones agg | D | G3 | aggregates over zone rows |
| 27 | geo.charlestonZones | `CHARLESTON_ZONES` in-code constant | **A** | G3 | pure platform reference; no DB read |
| 28 | geo.geocodeAddress | external geocoding only | **A** | G3 | no tenant data; ops/rate-limit note only |
| 29 | geo.reverseGeocode | external geocoding only | **A** | G3 | |
| 30 | geoOverride.listRules | geographic_overrides | B | G2 | also consumed by remodel-router — trace in measurement |
| 31 | geoOverride.getRule | geographic_overrides | B | G2 | |
| 32 | geoOverride.statsByZone | overrides agg by zone | B | G2 | must become tenant-scoped aggregate |

**Totals: A=3 · B=12 · C=9 · D=8 · E=0. Remaining ambiguity: 0.** No genuinely new product question surfaced.

Context (outside the 32, unchanged): assembly/geo/override `adminProcedure` mutations = platform curation surface today (assembly writes stay platform-side under HYBRID; geo *policy* authoring migrates to tenant surface after the split — G3b design item). `geo.assignToProject`, `geo.getProjectZone`, `geoOverride.resolveForDraft/previewForDraft/getLog/hasOverrides` already gated via hardened project/entity access.

---

## 3. Task 4 — Remediation program

Order approved in principle: **G1 (bundles) → G3a (geo interim gating) → G2 (overrides) → G4a (assemblies carve-out)**. G3a sits second because geo is the only family where repository/migration evidence establishes tenant-stamped commercial rows behind ungated routes.

### Unit G1 — Bundles tenant isolation *(first)*
- **Routes:** the 9 bundle routes. **Files:** `server/bundle-router.ts`, `server/db.ts` (9 bundle helpers).
- **Root cause:** self-service CRUD on `protectedProcedure` with unscoped queries; caller axis.
- **Code-only:** yes. **Schema/migration later:** provenance classification + stamping of any legacy NULL rows (F15-class data op, Invariant 7, separate unit).
- **Approach:** routes → `tenantProcedure`; helpers require `tenantId` and scope via `tenantWhere()`/`withTenant()` (compile-error-on-omission pattern, as F8 did for `client-db.ts`); `bundle_items` authorized through the parent bundle (the `deal_activities`/`lead_activities` parent-lookup pattern). Remove stale `bundles-db.ts` allowlist entry; ensure `db.ts` bundle queries are visible to `pnpm audit:tenant`.
- **Scope boundary — B2 vs F15 (explicit):** `tenantProcedure` + tenant-scoped helpers closes the **caller-axis B2 boundary**. It must **not** be described as complete row-isolation proof for legacy `tenant_id IS NULL` rows unless the current `tenantWhere`/`tenantFilter` semantics actually enforce that — PR #9's own documentation records that `tenantFilter` emits a transitional `IS NULL` arm while `TENANT_STRICT` is off, so legacy NULL bundles may remain readable to any *resolved* tenant until F15 lands. **No F15 remediation inside G1.**
- **G1 measurement must explicitly trace:** (1) unresolved-caller behavior end-to-end; (2) explicit tenant-A vs tenant-B row behavior; (3) legacy `tenant_id IS NULL` row behavior under the new scoping (fixture-based); (4) the current `tenantWhere`/`withTenant`/`tenantFilter` semantics as actually implemented at HEAD (not as documented). Findings on (3)/(4) are reported, not fixed, in G1.
- **Blast radius:** 9 routes; helpers imported nowhere else (re-verify in measurement); client consumers (`Bundles.tsx`, `BundleCart`, `useBundleCalculator`) behaviorally unchanged for same-tenant use.
- **Tests / execution proof:** cross-tenant + unresolved-tenant negatives per operation via `createCaller`, with data-layer call counters; plus explicit NULL-row behavior assertions (fixture-based) labeled as F15-surface documentation, not isolation proof; execution-verified failures against `0bc9e605` (stash-and-restore method already used by 002C–002E).
- **Blocks B2 claim:** **yes** (unresolved caller can write business data). **PR #9:** yes.

### Unit G3a — Geo interim caller gating *(second)*
- **Routes:** the 8 D routes + the 3 A carve-outs. **Files:** `server/geo-router.ts`, `server/geo-db.ts`.
- **Root cause:** ungated reads over rows that migration evidence establishes as tenant-stamped wherever 0004 was applied.
- **Code-only:** yes. Two viable shapes — (i) `tenantProcedure` + tenant-scoped zone reads, or (ii) field-level projection stripping policy columns from unresolved/foreign callers. Recommend (i): simpler, matches B2 semantics, no new response contract. Name `charlestonZones`/`geocodeAddress`/`reverseGeocode` as explicit platform carve-outs. Note: with `TENANT_STRICT` off, `tenantFilter`'s transitional arm means a resolved caller may still read legacy-NULL zones — same B2/F15 separation as G1; measurement documents actual behavior.
- **Blast radius:** engine feed (`loadActiveZonesForEngine`) is server-internal; trace its callers' tenant context in measurement (pricing-engine path).
- **Blocks B2 claim:** **yes** — the live-exposure candidate of this pass. **PR #9:** yes.

### Unit G2 — Geographic overrides tenant isolation *(third)*
- **Routes:** `listRules`, `getRule`, `statsByZone`. **Files:** `server/geo-override-router.ts`, `server/geo-override-db.ts` (+ verify `remodel-router` call sites of `listOverrideRules`/`writeOverrideLogEntries`).
- **Root cause:** tenant exception rules readable by any authenticated caller; helpers tenant-blind.
- **Code-only:** yes. Provenance-classified stamping of any legacy NULL rows later (Invariant 7). Same B2/F15 separation and measurement traces as G1. **Blocks B2:** yes. **PR #9:** yes.

### Unit G4a — Assemblies interim platform-catalog carve-out *(fourth, code-only, governed by the ADR interim rule)*
- **Routes:** the 9 assembly reads. **Files:** `server/assembly-router.ts`, `server/assembly-db.ts` (+ audit-list comment correction in `tenant-coverage-audit.ts`).
- **Design (no NULL==canonical):** the carve-out is implemented as a **transitional exclusion predicate**, not an ownership rule. Read helpers constrain the global surface to `tenant_id IS NULL` with the inference running only in the safe direction: *a stamped row is definitively NOT canonical and is excluded from the global surface.* This proves the ADR's required property — **tenant-owned rows cannot be exposed through the carve-out** — without ever asserting that NULL rows are platform-owned. The predicate is: (a) named (e.g., a `PLATFORM_CATALOG_READ` carve-out registered alongside the existing named carve-outs), (b) documented in code as a temporary stand-in for the G4b explicit marker, with removal tied to G4b, (c) pinned by an execution-verified test that inserts a tenant-stamped assembly fixture and proves the global surface does not return it.
- **Decided (checkpoint 2026-08-23):** the 9 reads require an authenticated caller with a **resolved tenant** (`tenantProcedure`) to consume the platform assembly surface inside the business application. Canonical content stays readable across tenants (any resolved tenant); pre-tenant reachability is rejected — this keeps the B2 carve-out list minimal.
- **Explicitly out of G4a:** the ownership discriminator / canonical marker (G4b) — not pulled into PR #9 unless separately approved.
- **Blocker clause:** if measurement shows the exclusion-predicate design cannot be implemented without asserting NULL-as-canonical (e.g., a reader that must positively identify canonical rows), that is reported as a design blocker per the ADR, not forced. Current assessment: not a blocker — all 9 routes are reads over the whole-table surface, and exclusion suffices.
- **Blocks B2:** required to make the claim defensible with *named* carve-outs per project convention. **PR #9:** yes.

### Units G3b / G4b — Architecture & migration *(separate PR(s))*
- **G3b:** decompose `geo_zones` → platform geo-reference + tenant geo-policy; engine feed rework; per-tenant policy instantiation at onboarding; **verify the 0004 GCHI stamp against live data** (first legitimate DB read); align `schema.ts` FK with SQL; migrate `validatedFloorPct` feedback loop to the tenant policy table.
- **G4b:** explicit canonical marker on assemblies; tenant-assembly CRUD (`tenantProcedure`); clone-from-canonical with the independence invariant; readers become canonical ∪ caller tenant across `scope-router`, `remodel-router`, `estimate-router`, `scope-to-estimate-pipeline`; retire the G4a transitional predicate.
- Plus data ops: **provenance classification** then stamping of any legacy NULL bundles/overrides rows (Invariant 7, F15-class); seeds stamp ownership going forward.
- **Blocks B2:** no, once G1/G3a/G2/G4a land — ROW/architecture axis. **PR #9:** no — defer.

---

## 4. PR #9 boundary

- **In PR #9:** G1, G3a, G2, G4a (caller-axis, code-only, matches the PR's charter) + one-line allowlist hygiene (stale `bundles-db.ts`, tracked `field-launch-db`).
- **Deferred:** G3b, G4b (including the canonical marker — never silently pulled into #9), all provenance classification + stamping/backfills, `TENANT_STRICT`, schema.ts/SQL FK alignment (rides with G3b), any entitlement work.

## 5. Formal corrections register (for the next handoff/PR-description update — do not edit PR #9 now)

1. Handoff §4 and PR #9 description: *"tenant_id columns … not currently populated by their writers"* — inaccurate for `geo_zones`; migration 0004 is a writer. Replace with the evidentiary framing in §0.
2. Handoff §4: *"geo-override — tabela de origem não identificada conclusivamente"* — resolved: `geographic_overrides` (`drizzle/schema.ts` ~L1426).
3. Prior architecture report (pre-checkpoint versions of this document): statements implying (a) independently verified live GCHI stamping, (b) legacy NULL bundles/overrides "belonging to the bootstrap tenant", and (c) verified-NULL live rows for assemblies/bundles/overrides — superseded by §0's evidentiary framing and Invariant 7. This checkpoint revision is authoritative.

## 6. Verdicts

- **B2 GLOBAL CLAIM: NOT YET DEFENSIBLE** — 24 tenant-relevant routes (B+C+D) remain reachable without a resolved caller tenant; migration evidence establishes stamped commercial rows behind the geo routes.
- **PR #9 MERGE GATE: NO-GO** — unchanged. Merge path: G1 → G3a → G2 → G4a → independent Codex review against the final HEAD.
