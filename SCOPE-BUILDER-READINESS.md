# GCHI Construction Brain — Scope Builder Readiness Assessment

**Date:** 2026-03-14  
**Auditor:** Manus AI — Lead Systems Architect  
**Purpose:** Verify that the assembly library and intake structure are sufficient for Sprint 12 (Scope Builder)

---

## 1. Assembly Library Audit

### 1.1 Summary

The database currently contains **71 active assemblies** across **16 categories** — significantly more than the originally estimated 58. The growth came from Sprint 7's detailed scope assemblies (58) plus Sprint 8's Supabase bundle imports (13).

### 1.2 Coverage Matrix — Required Trades

The following table maps each required trade to its assembly coverage in the database. Every required trade is represented.

| Required Trade | Category Match | Assembly Count | Finish Levels | Verdict |
|---|---|---|---|---|
| **Kitchen** | `Kitchen` + `kitchen` | 10 detailed + 1 bundle = **11** | standard, premium | **COVERED** — Full gut-to-finish chain (demo, cabinets, countertops, backsplash, plumbing, paint, appliances) |
| **Bathroom** | `Bathroom` + `bathroom` | 10 detailed + 1 bundle = **11** | standard, premium | **COVERED** — Complete remodel chain (demo, tub/shower, toilet, vanity, tile, plumbing, paint, accessories, fan, mirror) |
| **Roofing** | `Roofing` + `roofing` | 8 detailed + 2 bundles = **10** | standard, premium | **COVERED** — Tear-off, shingles (std/architectural), flashing (chimney/pipe/valley), drip edge, ridge cap, gutters |
| **Siding** | `Siding` + `siding` | 4 detailed + 1 bundle = **5** | standard | **COVERED** — Vinyl, fiber cement, trim board, demo. Note: premium siding (James Hardie) not yet differentiated |
| **Windows / Doors** | `Windows / Doors` + `windows` | 7 detailed + 1 bundle = **8** | standard, premium | **COVERED** — Double-hung (std/impact), casement, ext doors (std/premium), int doors, window trim |
| **Deck** | `Deck` + `decking` | 5 detailed + 1 bundle = **6** | standard, premium | **COVERED** — Composite, pressure-treated, demo, railing, stairs |
| **Paint** | `Interior Paint` + `Full Exterior` + `painting` | 4 + 5 + 2 = **11** | standard | **COVERED** — Interior (walls only, walls+ceiling, full room, drywall patch), exterior (full paint, caulking, fascia/soffit, gutters, downspouts) |
| **Flooring** | `Flooring` + `flooring` | 5 detailed + 2 bundles = **7** | standard | **COVERED** — Hardwood, LVP, tile, carpet, demo |

### 1.3 Additional Trades (Bonus Coverage)

Beyond the 8 required trades, the library also includes assemblies for:

| Bonus Trade | Count | Examples |
|---|---|---|
| Concrete | 1 | Concrete Patio 12x12 |
| Drywall | 1 | Drywall Repair/Renovation (per Room) |
| Electrical | 1 | Electrical Panel Upgrade 200A |
| Fencing | 1 | Wood Privacy Fence 6ft (per LF) |

### 1.4 Observations and Risks

**Category naming inconsistency** is the most significant finding. The same trade appears under two different category names — one capitalized (from Sprint 7 detailed seeding) and one lowercase (from Sprint 8 Supabase imports):

| Sprint 7 Category | Sprint 8 Category | Impact |
|---|---|---|
| `Kitchen` (10) | `kitchen` (1) | Scope Builder must do case-insensitive matching |
| `Bathroom` (10) | `bathroom` (1) | Same |
| `Roofing` (8) | `roofing` (2) | Same |
| `Siding` (4) | `siding` (1) | Same |
| `Windows / Doors` (7) | `windows` (1) | Different naming entirely |
| `Deck` (5) | `decking` (1) | Different naming entirely |
| `Flooring` (5) | `flooring` (2) | Same |
| `Interior Paint` + `Full Exterior` (9) | `painting` (2) | Different naming entirely |

**Recommendation:** Before Sprint 12, normalize category names to a single canonical form. The Scope Builder's rule engine should not need to handle 16 categories when there are really 8 core trades plus 4 extras. Two options:

1. **Quick fix (recommended):** The Scope Builder maps intake `serviceType` → canonical trade name using a lookup table, ignoring raw category casing.
2. **Data fix:** Run a one-time migration to normalize all categories to Title Case and merge duplicates (e.g., `kitchen` → `Kitchen`, `decking` → `Deck`).

**Finish level gaps:** Siding, Paint, and Flooring currently only have `standard` finish assemblies. The Scope Builder should handle this gracefully — if a `premium` intake arrives for flooring, it should select the `standard` assembly and flag it for manual review or apply a premium multiplier.

---

## 2. Intake Structure Audit

### 2.1 Required Fields for Scope Builder

The following table evaluates each field the Scope Builder needs against what the intake schema currently captures.

| Required Field | Schema Column | Type | Present? | Notes |
|---|---|---|---|---|
| **service_type** | `intakeForms.serviceType` | `varchar(128)` | **YES** | Free-text, indexed. Values like "kitchen_remodel", "roof_replacement", etc. |
| **area / dimensions** | `intakeForms.area` | `varchar(255)` | **YES** | Free-text field for "12x14 kitchen", "1,800 sqft roof", etc. |
| **finish_level** | `intakeForms.finishLevel` | `enum(standard, premium, luxury)` | **YES** | Structured enum — directly maps to assembly `finishLevel` |
| **condition** | `intakeForms.condition` | `varchar(255)` | **YES** | Free-text for "water damage", "original 1960s", etc. |
| **region** | `projects.region` + `projects.zone` + `projects.zipCode` | `varchar` | **YES** | Region is on the project (linked via `intakeForms.projectId`). Geo engine can detect zone from ZIP. |
| **channel** | `intakeForms.channel` | `enum(residential, commercial, insurance)` | **YES** | Directly available on the intake form |

### 2.2 Additional Intake Data Available

The intake form also captures several fields that enhance the Scope Builder's intelligence:

| Field | Purpose for Scope Builder |
|---|---|
| `rawPayload` (JSON) | Full unstructured intake data — can contain room counts, specific material preferences, photos, etc. |
| `parsedScope` (JSON) | AI-parsed scope output — can store the Scope Builder's recommendations |
| `confidenceScore` (decimal) | Scope Builder can set confidence on its auto-generated scope |
| `notes` (text) | Client-specific notes that may affect assembly selection |
| `projectId` → `projects.projectType` | Remodel vs new construction vs repair — affects which assemblies apply |
| `projectId` → `projects.zoneModifierSnapshot` | Geographic modifiers already snapshotted on the project |

### 2.3 Scope Suggestions Table

The `scope_suggestions` table is already defined and ready for Sprint 12:

| Column | Type | Purpose |
|---|---|---|
| `intakeFormId` | FK → intake_forms | Links suggestion to its source intake |
| `assemblyId` | FK → assemblies | The recommended assembly |
| `suggestedScope` | text | Human-readable scope description |
| `confidenceScore` | decimal | AI confidence in this suggestion |
| `estimatedCost` / `estimatedPrice` | decimal | Pre-calculated cost/price |
| `status` | enum(pending, accepted, rejected, modified) | Review workflow |
| `reviewedBy` / `reviewNotes` | int / text | Human review trail |

This table has indexes on `intakeFormId`, `assemblyId`, and `status` — ready for the Scope Builder to write to.

### 2.4 Data Flow Validation

The intended Scope Builder flow is fully supported by the current schema:

```
Client → Project (region, zone, zipCode, projectType, channel)
  → Intake Form (serviceType, area, finishLevel, condition, channel)
    → Geo Engine (detectZone from project.zipCode → zone modifiers)
      → Scope Builder (match serviceType + finishLevel + condition → assemblies)
        → Scope Suggestions (assemblyId, estimatedCost, estimatedPrice, confidence)
          → Estimate (convert accepted suggestions → estimate line items)
```

Every link in this chain has the required foreign keys and data fields.

---

## 3. Verdict

### Assembly Library: **GREEN — Sufficient**

All 8 required trades are covered with 71 assemblies. The library provides both detailed scope-level assemblies (for granular estimates) and bundle-level assemblies (for quick quotes). The only pre-Sprint 12 action needed is deciding how the Scope Builder handles the category naming inconsistency — a lookup table in the engine is the cleanest approach.

### Intake Structure: **GREEN — Sufficient**

All 6 required fields (`service_type`, `area`, `finish_level`, `condition`, `region/channel`) are present in the schema. The `rawPayload` JSON field provides extensibility for any additional data the Scope Builder may need. The `scope_suggestions` table is already defined and indexed, ready to receive Scope Builder output.

### Readiness for Sprint 12: **GREEN — Proceed**

The foundation is technically sound. The Scope Builder can be implemented as a pure engine (`shared/scope-engine.ts`) that:

1. Takes intake data (serviceType, area, finishLevel, condition) + project context (zone, channel, projectType)
2. Matches against assembly library using a rule table
3. Produces `ScopeSuggestion[]` with confidence scores
4. Writes to `scope_suggestions` table via a DB helper
5. Exposes via tRPC router for UI consumption

No schema migrations are required. No refactoring is needed. The existing pattern (engine → db helper → router) scales cleanly to this new domain.
