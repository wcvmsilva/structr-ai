# ADR-001 — Structr Data Ownership Model

- **Status:** Accepted
- **Date:** 2026-08-23 (precision revision and documentation checkpoint approval same date)
- **Decider:** Wellington (Owner), approved via Product/Architecture direction document; precision corrections and G4a caller rule approved per follow-up directions
- **Technical validation:** Read-only repository pass at HEAD `0bc9e605` (branch `security/tenant-isolation-remediation-20260821`). No live database state was queried.
- **Companion:** `docs/security/class-g-reclassification-and-remediation-plan.md`

*(No prior ADR or numbering convention existed in the repository as of `0bc9e605` — verified, not assumed. ADR-001 is the first entry; zero-padded three-digit numbering is proposed as the convention going forward.)*

---

## Context

The tenant-isolation remediation (PR #9) left 32 routes classified **Class-G**: routes over `assemblies`, `bundles`, `geo_zones` and `geographic_overrides` that carry no tenant gate, over tables that carry a `tenant_id` column. The route inventory was complete (0 unclassified) and all Class-B caller-axis vulnerabilities were closed, but these 32 routes could not be remediated because no product decision existed about **who owns this data**.

Evidence that forced the decision:

1. `server/tenant-coverage-audit.ts` (`KNOWN_UNSCOPED_MODULES`) carries the comment *"Catalog and price-book helpers: reference data, tenant enforced by the calling router"* over `assembly-db.ts`, `geo-db.ts` and `bundles-db.ts`. The routers do **not** enforce tenant. This comment is the documented root cause of the earlier C→G misclassification.
2. `drizzle/schema.ts` (geo_zones) carries the comment *"PHASE 4 — zones become tenant property so a second GC starts with its own..."* — a prior, tracked intent toward tenant ownership that was never enforced at the route layer.
3. **Repository and migration evidence establishes that wherever migration `drizzle/0004_phase4_learning_multitenant.sql` was applied successfully, `geo_zones` rows were stamped to the GCHI tenant** (`UPDATE geo_zones SET tenant_id = (SELECT id FROM tenants WHERE slug = 'gchi' ...)`, ~L1178; `docs/phase4-notes.md` records 0004 as executed). **Live database state was not independently verified in this read-only pass.** This is an evidentiary-precision statement, not a risk reduction: the security path remains production-capable and merge-relevant, and the "safe by accident of data" premise cannot be relied on for this family.
4. `tenant_settings` already implements a hybrid precedent: Profit Shield effective floor is `MAX(platform, channel, geo, tenant override)` (`docs/phase4-contract.md` §5.1). "Global baseline + tenant override" is an existing pattern in this product, not a new invention.
5. `bundles` rows carry `isCustomizable: true` by schema default and all nine bundle routes — including create/duplicate/delete — are self-service `protectedProcedure`, with no admin gate and no tenant scoping.

## Decision

Structr adopts a four-category ownership architecture. Every business table and every route must belong to exactly one category, explicitly.

### Ownership Categories

1. **PLATFORM CANONICAL** — Content owned and curated by Structr, available across tenants. Read-only to tenants. Examples: canonical assemblies, geographic reference (counties, cities, ZIP codes, canonical regions, boundaries), built-in Charleston zone constants (`CHARLESTON_ZONES`).
2. **TENANT WORKSPACE** — Operational, commercial, pricing, project, client, estimating, supplier, cost, labor, margin, and tenant-customized data owned by exactly one tenant.
3. **TENANT OVERRIDES** — Tenant-specific rules and exceptions layered over global/canonical data (e.g., geographic overrides, profit-shield overrides).
4. **SYSTEM** — Internal platform/diagnostic data that is neither commercial tenant data nor shared business content (e.g., system-actor audit rows, schema diagnostics).

### Core rules

- GLOBAL content must never contain tenant-specific competitive or operational data.
- Tenant commercial/operational data must never become global merely because `tenant_id` is NULL.
- Globality must be explicit in the ownership model — declared in schema and in named route carve-outs, never inferred from a NULL column.

## Domain Decisions

### Assemblies — HYBRID

- **A. Structr canonical assemblies:** platform-owned, curated by Structr, read-only to tenants, reusable across tenants. Current admin-only write surface (`create/update/delete/clone/addComponent/removeComponent` behind `adminProcedure`) already matches this half.
- **B. Tenant assemblies:** owned by one tenant; may be created from scratch or cloned from a canonical assembly; may customize materials, labor, productivity, pricing, scope and related data.
- **Invariant:** cloning a platform assembly creates an independent tenant-owned object. Future edits to the canonical assembly must not silently mutate the tenant copy.
- **Schema consequence:** canonical status must be explicit (an ownership discriminator / canonical marker), because `tenant_id IS NULL` cannot mean "canonical" under the core rules. The discriminator is **G4b scope** and must not be silently pulled into PR #9 unless separately approved.
- **Interim rule (governs G4a):** the current platform-curated assembly surface may receive a **named, temporary platform-catalog carve-out only if the implementation can prove that tenant-owned rows cannot be exposed through that carve-out**. Any future tenant-owned assembly row must be excluded from the global surface. `tenant_id IS NULL` must never be established as a permanent or implicit ownership rule; at most it may serve as a **transitional exclusion predicate** (a stamped row is definitively NOT canonical and is excluded from the global surface), documented as a temporary stand-in whose removal is tied to G4b. If a safe interim carve-out cannot be designed without treating NULL as the canonical marker, that is a **design blocker to be reported**, not forced.
- **Approved caller rule (checkpoint 2026-08-23):** consuming the platform assembly surface **inside the business application requires an authenticated caller with a resolved tenant**. Canonical content remains readable across tenants (any resolved tenant); pre-tenant callers are rejected.

### Bundles — TENANT-OWNED

- Operational bundles belong to exactly one tenant. Create/update/delete/duplicate must never cross tenant boundaries.
- Optional future capability: Structr MAY provide GLOBAL bundle templates (PLATFORM CANONICAL), instantiated into tenant workspaces — not implemented in this decision.
- **Legacy rows:** repository evidence shows that current repository writers do not stamp `tenant_id` for these paths; **live row state was not independently verified**. Any legacy `tenant_id IS NULL` bundles are of **unproven per-row provenance** and must be provenance-classified before any future backfill (Invariant 7); the possibility of future platform bundle templates makes automatic tenant assignment unsafe.

### Geo — SPLIT geography from commercial policy

The current `geo_zones` table mixes two ownership categories in one row and must be architecturally separated:

- **A. Geographic reference — PLATFORM GLOBAL:** counties, cities, ZIP codes, canonical regions, boundaries, centroids, radii, coastal exposure classification. (Current columns: `name`, `zoneName`, `county`, `zipCodes`, `boundaryGeojson`, `centerLat/Lng`, `radiusMiles`, `coastalExposureLevel`.)
- **B. Tenant geo policy — TENANT:** labor modifier, material modifier, logistics factor, travel surcharge, mobilization factor, minimum margin/profit rules, delivery/access constraints, tenant-specific geographic pricing behavior, service-area selection. (Current columns: `costMultiplier`, `laborModifier`, `materialModifier`, `logisticsModifier`, `logisticsComplexity`, `contingencyPct`, `minProfitShieldPct`, `validatedFloorPct`, `validatedAt`, `validationSampleCount`.)
- These are **two ownership domains**, not one.

### Geographic Overrides — TENANT-OWNED

Overrides are tenant-specific exceptions layered over geographic reference, assemblies, pricing or related business rules. `geographic_overrides` (FKs to `tenants`, `geo_zones`, `assemblies` ×2, `cost_codes`) is TENANT WORKSPACE / TENANT OVERRIDES data.

- **Legacy rows:** repository evidence shows that current repository writers do not stamp `tenant_id` for these paths; **live row state was not independently verified**. Any legacy `tenant_id IS NULL` override rules are of unproven per-row provenance and fall under Invariant 7 before any backfill.

## Security Invariants (permanent architecture rules)

1. No commercial or operational tenant data becomes global because `tenant_id` is NULL.
2. Global ownership must be explicit, never inferred from a NULL `tenant_id`.
3. Tenant-owned business data requires a resolved caller tenant before business authorization.
4. Platform canonical templates are cloned/instantiated for tenant customization; tenants do not directly mutate canonical platform records.
5. Commercial plan/entitlement level never changes the fundamental tenant isolation rules.
6. Ownership model and commercial entitlement model are separate concerns.
7. **No legacy `tenant_id IS NULL` row may be assigned to a tenant solely because it is currently unowned. Backfill requires row-level provenance evidence or an explicit, audited human classification.**

## Consequences

- **Route authorization:** every previously Class-G route is reclassified as PLATFORM GLOBAL (explicit named carve-out), TENANT-OWNED (tenant authorization required), HYBRID (route must distinguish platform vs tenant records), or SCHEMA/ARCHITECTURE SPLIT REQUIRED. Silence is no longer a valid state; carve-outs are named in code, consistent with the existing convention (`tenantSettings.provision`, `auth.*`, `system.health`).
- **Bundles** routes move behind resolved-tenant authorization with tenant-scoped queries. This closes the **caller axis (B2)** only; it is **not** row-isolation proof for legacy `tenant_id IS NULL` rows unless the current `tenantWhere`/`tenantFilter` semantics actually enforce that. Legacy NULL row ownership remains the **F15 / row axis**, remediated by provenance-classified backfill (Invariant 7), never inside the caller-axis unit.
- **Geographic overrides** routes move behind resolved-tenant authorization; `geo-override-db.ts` helpers become tenant-requiring. Same B2/F15 separation applies.
- **Geo** requires table decomposition (reference vs policy). Until the split lands, the ungated zone-reading routes must not remain reachable without a resolved tenant, because migration evidence establishes the rows carry a tenant's commercial policy wherever 0004 was applied.
- **Assemblies** reads become "canonical ∪ caller-tenant" once tenant assemblies exist; until then, canonical reads receive the interim carve-out **under the interim rule and approved caller rule above** (non-exposure proof required; NULL only as transitional exclusion predicate; resolved caller required; removal tied to G4b).
- The `KNOWN_UNSCOPED_MODULES` comment claiming router-side enforcement is corrected, and the stale `bundles-db.ts` entry (file does not exist; bundle queries live in `server/db.ts`) is removed.
- Drizzle schema drift: `geo_zones.tenantId` lacks a `.references()` in `drizzle/schema.ts` while migration 0004 adds `fk_geo_zones_tenant` best-effort in SQL. Schema and SQL are aligned as part of the geo work.

## Migration Implications

- **Bundles / geographic_overrides:** repository writers do not stamp `tenant_id`; live row state was not independently verified. Any legacy `tenant_id IS NULL` rows require **provenance classification first** (Invariant 7) — row-level evidence or explicit, audited human classification — and only then an audited stamp/backfill (same treatment class as F15 / issue #10). No row is assigned to any tenant merely for being unowned. No backfill is executed under this ADR.
- **Geo:** decomposition migration (reference table + tenant geo-policy table); the 0004 GCHI stamp is verified against live data as part of that work (the first point where DB state is legitimately read); per-tenant policy instantiation at onboarding (a second GC starts with its own policy — the Phase 4 intent); engine feed rework (`loadActiveZonesForEngine` → per-tenant policy resolution).
- **Assemblies:** explicit canonical marker (G4b); tenant-assembly rows introduced by the hybrid unit; seeds must stamp ownership explicitly (`seed-assemblies.mjs` currently writes no ownership information).
- Seed scripts and in-app seeders (`seedCharleston`, `seedCoastalRules`, `server/seed.ts`) must stamp ownership explicitly going forward.

## Relationship to Commercial Plans / Entitlements

Ownership is a security/architecture concern; entitlement is a packaging concern. They never mix (Invariants 5–6). Capability packaging may later use placeholders (Core / Pro / Business-Enterprise) over: Core Platform capabilities, Tenant-owned capabilities, Hybrid capabilities, Advanced/Enterprise capabilities. No plans, entitlements, billing, feature flags, trials or upgrade paths are defined or implemented by this ADR.

## Explicit Non-Goals

- No Class-G remediation implementation.
- No production authorization change, migration, backfill, Supabase change, or `TENANT_STRICT` change.
- No live database verification in this pass (explicitly deferred to the geo/F15 data units).
- No plan/entitlement/billing implementation.
- No PR #9 modification or merge.
- No UI changes.

## Class-G Implications (summary)

Reclassification of the 32 Class-G routes under this model, against code at `0bc9e605`:

| Class | Count | Meaning |
|---|---|---|
| A — PLATFORM GLOBAL (named carve-out) | 3 | `geo.charlestonZones` (in-code constant), `geo.geocodeAddress`, `geo.reverseGeocode` |
| B — TENANT-OWNED (tenant auth required) | 12 | all 9 bundle routes + `geoOverride.listRules`, `getRule`, `statsByZone` |
| C — HYBRID (platform vs tenant record semantics) | 9 | all 9 assembly read routes |
| D — SCHEMA/ARCHITECTURE SPLIT REQUIRED | 8 | geo zone-data reads: `list`, `getById`, `getByName`, `detectFromZip`, `detectFromCoords`, `geocodeAndDetectZone`, `checkServiceRadius`, `stats` |
| E — HUMAN DECISION STILL REQUIRED | 0 | — |

Full route-by-route table, remediation units (G1–G4) and PR #9 boundary: see `docs/security/class-g-reclassification-and-remediation-plan.md`.

## References

- Direction documents: "Structr Product/Data Ownership Model V1" (approved 2026-08-23) + precision corrections + documentation checkpoint (same date)
- PR #9 — `security/tenant-isolation-remediation-20260821`, HEAD `0bc9e605`
- `drizzle/schema.ts` — `assemblies` (~L139), `bundles` (~L191), `geoZones` (~L942, PHASE 4 comment ~L962), `geographicOverrides` (~L1426), `tenantSettings` profit-shield overrides (~L2172)
- `drizzle/0004_phase4_learning_multitenant.sql` — geo_zones tenant backfill (~L1178), best-effort FK (~L559)
- `docs/phase4-contract.md` §5 (multi-tenant readiness, Profit Shield MAX rule), `docs/phase4-notes.md`
- `server/tenant-coverage-audit.ts` — `CRITICAL_TENANT_TABLES`, `KNOWN_UNSCOPED_MODULES`
