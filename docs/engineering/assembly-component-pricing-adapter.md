# Assembly component pricing adapter

This maintenance change repairs the existing database-to-engine contract. The physical `assembly_items` shape provides `defaultQtyPerUnit`, `unitId` and a legacy scalar `priceBookItem`; calculation consumers expected `quantity`, a unit label and a joined price object. A real router characterization returned `NaN` quantities/totals when that raw object reached the engine. No schema, catalog row, price or ownership classification is changed.

## Contracts

[getAssemblyById](../../server/assembly-db.ts) preserves raw detail by default. CRUD and clone callers can still inspect an unpriced or legacy composition; this does not approve it for pricing. The existing calculation paths explicitly pass `{ requirePricing: true }`: assembly calculation, bundle calculation, estimate creation, and the scope-to-estimate pipeline. `getComponentsForAssembly` returns the strict priced graph. Detail-only estimate input validation retains its earlier raw existence/active check and is not a pricing acceptance gate.

Both detail and strict graph reads run inside a read-only, repeatable-read transaction. The strict path reads the parent, components, tenant calendar, secondary settings if present, cost codes, units, cost types and price history. Referenced catalog records are fetched in batches; repeated components do not create per-component queries.

| Engine-facing value | Source and rule |
|---|---|
| `quantity` | Exact `defaultQtyPerUnit` decimal string; finite/nonnegative validation, no inferred quantity |
| `unit` | Referenced unit abbreviation, or its stored name when the abbreviation is absent |
| `componentType` | Existing valid component type first; only when NULL, the exact known cost-type name, case-insensitive. Unknown labels are errors; no default-to-material classification. |
| `costCode`, `costType` | Referenced rows retained on the component |
| `priceBookItemReference` | Original legacy scalar, preserved without pretending it is a pricing-history foreign key |
| `priceBookItem.id` | Logical `costCode.id` UUID; the engine accepts UUID strings and legacy numeric IDs |
| `pricingRecordId` | Separate selected `cost_code_pricing_history.id`, for source provenance |
| `pricingEvaluationDate` | Server-clock date in the authoritative `tenants.timezone` |
| Unit cost and sell price | Existing values from exactly one eligible price history row; finite and nonnegative, including explicit zero. No margin-derived price, first-row choice or latest-row fallback. |
| Waste / cost override | Original component values retained and validated; no percentage/fraction conversion or invented default. A cost override does not waive the need for an existing sell price. |

The existing canonical component names are centralized in [taxonomy](../../shared/domain/taxonomy.ts), with their normalizer in [normalization](../../shared/domain/normalization.ts). The engine's arithmetic is unchanged.

## Fail-closed price selection

For a nonempty BOM, the assembly must have a tenant and that tenant must exist with a valid timezone. An existing secondary `tenant_settings` row must agree; absence of that optional row does not replace or negate the authoritative tenant calendar. No caller selects a pricing date. Ownerless legacy assemblies remain readable as raw detail, but cannot be priced through this adapter.

Each referenced cost code must belong to the assembly's exact tenant. NULL is not interpreted as canonical. Price history must match both the code and its **exact unit**; a NULL or different history unit is not a conversion rule. The selected record must be active and satisfy `[effective_date, expiration_date)` on the evaluation date, with NULL expiration meaning unbounded. Invalid intervals, overlapping eligible records, no eligible record, missing cost/price, unknown type or missing referenced unit/type/code cause a descriptive error before the engine receives a partial graph.

These checks do not authorize the caller to the assembly. The legacy caller-to-parent catalog boundary, tenant-independent cost types/units, canonical/tenant ownership model, timezone writer/version controls and other G4b work remain separate. No catalog is newly classified and no global tenant-safety or field-readiness claim is made. Existing engine payload mapping does not yet persist `pricingRecordId` on every output line; the returned source field is not proof of end-to-end retained price provenance.

## Evidence

[Behavioral tests](../../server/assembly-component-pricing.test.ts) use the real helper and engine, a declared transactional database double, and the real assembly calculation endpoint. They cover exact mapping and totals, raw detail/clone compatibility, tenant/calendar boundaries, unit identity, missing/ambiguous prices, adjacent half-open intervals, invalid decimals, valid zeros, explicit type precedence and batched transactional reads.

The original helper failed 34 cases and passed 2. Calendar coverage expanded that baseline to 41 failures and 2 passes. Raw-detail/clone regressions produced 2 expected failures after strict mapping was first introduced, then were corrected by separating raw reads from explicit pricing. The real calculation-endpoint test independently failed while its caller still requested raw details, returning `NaN` totals rather than denying missing pricing. Final focused and combined-candidate validation are recorded by the coordinator; unit/database-double tests do not establish actual PostgreSQL persistence or browser behavior.
