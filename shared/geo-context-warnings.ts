/**
 * structr.ai — PHASE 2 Geo Context Warnings
 *
 * PURE normalization of geo signals into a deterministic warning set that the Scope
 * Builder, the pre-visit checklist and the Profit Shield can consume without
 * re-interpreting raw geocode output (docs/phase2-contract.md §5).
 *
 * Every warning has a stable `code`, so downstream consumers match on the code and
 * never on free text.
 */

import { inferGeoRiskClass } from "./profit-shield-engine";
import type { GeoRiskClass } from "./constants/profit-shield";

export const GEO_WARNING_CODES = [
  "geo.geocode_failed",
  "geo.geocode_low_confidence",
  "geo.zone_not_detected",
  "geo.coastal_exposure",
  "geo.barrier_island_exposure",
  "geo.outside_service_radius",
  "geo.high_cost_multiplier",
] as const;

export type GeoWarningCode = (typeof GEO_WARNING_CODES)[number];

export interface GeoWarning {
  code: GeoWarningCode;
  severity: "info" | "warning" | "blocking";
  message: string;
  /** Extra context for the operator (zone name, distance, multiplier). */
  detail?: Record<string, unknown>;
}

export interface GeoContextInput {
  geocodeSuccess?: boolean | null;
  geocodeConfidence?: string | null;
  withinServiceRadius?: boolean | null;
  distanceFromCenter?: number | null;
  zoneName?: string | null;
  /** Zone coastal exposure level from the geo engine ("none" ... "extreme"). */
  coastalExposureLevel?: string | null;
  costMultiplier?: number | string | null;
  /** Zone-level minimum profit shield percentage, when the zone declares one. */
  minProfitShieldPct?: number | string | null;
  /** Warnings already produced by the geocode/zone pipeline. */
  rawWarnings?: string[];
}

export interface GeoContextSummary {
  zoneName: string | null;
  riskClass: GeoRiskClass;
  warnings: GeoWarning[];
  /** Warning codes only — convenient for persistence and assertions. */
  codes: GeoWarningCode[];
  /** True when the geo context is reliable enough to price against. */
  reliable: boolean;
  /** Zone-declared minimum margin, when present (percentage points). */
  zoneMinProfitShieldPct: number | null;
}

/** Confidence values considered unreliable for pricing decisions. */
const LOW_CONFIDENCE = new Set(["low", "approximate", "partial", "failed", "unknown"]);

/**
 * Build the canonical geo warning set for a project.
 *
 * Determinism matters here: the same geo input must always produce the same codes in
 * the same order, because these codes are persisted on the scope draft and compared in
 * tests and audits.
 */
export function buildGeoContextSummary(input: GeoContextInput): GeoContextSummary {
  const warnings: GeoWarning[] = [];
  const zoneName = input.zoneName ?? null;

  // The zone's own coastal exposure level is stronger evidence than the zone name.
  // "extreme" exposure behaves as a barrier island even when the name says nothing.
  const exposure = String(input.coastalExposureLevel ?? "").toLowerCase();
  const riskClass: GeoRiskClass =
    exposure === "extreme"
      ? "barrier_island"
      : exposure === "high" || exposure === "moderate"
        ? "coastal"
        : exposure === "low" || exposure === "none"
          ? inferGeoRiskClass(zoneName) === "barrier_island"
            ? "barrier_island"
            : inferGeoRiskClass(zoneName)
          : inferGeoRiskClass(zoneName);

  if (input.geocodeSuccess === false) {
    warnings.push({
      code: "geo.geocode_failed",
      severity: "blocking",
      message:
        "Address could not be geocoded. Zone, coastal exposure and geographic modifiers are unknown — verify the address before pricing.",
      detail: { rawWarnings: input.rawWarnings ?? [] },
    });
  } else if (
    input.geocodeConfidence &&
    LOW_CONFIDENCE.has(String(input.geocodeConfidence).toLowerCase())
  ) {
    warnings.push({
      code: "geo.geocode_low_confidence",
      severity: "warning",
      message: `Geocode confidence is "${input.geocodeConfidence}". Zone assignment must be confirmed in the field before it can support a final price.`,
      detail: { confidence: input.geocodeConfidence },
    });
  }

  if (!zoneName) {
    warnings.push({
      code: "geo.zone_not_detected",
      severity: "warning",
      message:
        "No geographic zone was detected for this project. Zone modifiers and coastal floors cannot be applied automatically.",
    });
  }

  if (riskClass === "barrier_island") {
    warnings.push({
      code: "geo.barrier_island_exposure",
      severity: "warning",
      message: `Zone "${zoneName}" is a barrier island: logistics, wind design and corrosion detailing raise both cost and the margin floor.`,
      detail: { zoneName },
    });
  } else if (riskClass === "coastal") {
    warnings.push({
      code: "geo.coastal_exposure",
      severity: "warning",
      message: `Zone "${zoneName}" is coastal: salt-air corrosion, wind uplift and flood detailing must be reflected in scope and margin.`,
      detail: { zoneName },
    });
  }

  if (input.withinServiceRadius === false) {
    warnings.push({
      code: "geo.outside_service_radius",
      severity: "warning",
      message: `Project is outside the standard service radius${
        input.distanceFromCenter != null ? ` (${input.distanceFromCenter.toFixed(1)} mi from center)` : ""
      }. Mobilization, crew travel and supervision must be priced explicitly.`,
      detail: { distanceFromCenter: input.distanceFromCenter ?? null },
    });
  }

  const multiplier =
    input.costMultiplier == null ? null : Number(String(input.costMultiplier));
  if (multiplier != null && Number.isFinite(multiplier) && multiplier >= 1.15) {
    warnings.push({
      code: "geo.high_cost_multiplier",
      severity: "info",
      message: `Zone cost multiplier is ${multiplier.toFixed(2)}. Confirm the scope reflects the access and logistics driving that premium.`,
      detail: { costMultiplier: multiplier },
    });
  }

  const codes = warnings.map((w) => w.code);
  const reliable = !codes.includes("geo.geocode_failed") && !codes.includes("geo.zone_not_detected");

  const zoneMin =
    input.minProfitShieldPct == null ? null : Number(String(input.minProfitShieldPct));

  return {
    zoneName,
    riskClass,
    warnings,
    codes,
    reliable,
    zoneMinProfitShieldPct: zoneMin != null && Number.isFinite(zoneMin) ? zoneMin : null,
  };
}

/** Compact string form used by legacy `warningsJson` consumers. */
export function geoWarningsToStrings(summary: GeoContextSummary): string[] {
  return summary.warnings.map((w) => `[${w.code}] ${w.message}`);
}
