/** Pure row adapter. Caller owns same-transaction locks, authorization and H1 ancestry checks. */
import type {
  EstimateDraft,
  Project,
  Client,
  Tenant,
  Profile,
  GeoZone,
  TenantSettings,
  ScopeDraft,
} from "../drizzle/schema";
import {
  buildInternalApprovalReview,
  InternalApprovalError,
  normalizeApprovalMinor,
  normalizeApprovalDecimal,
  normalizeApprovalPercent,
  type ReviewResult,
} from "../shared/internal-estimate-approval-engine";
import {
  INTERNAL_APPROVAL_PROTOCOL as P,
  ESTIMATE_VERSION_PROTOCOL_V2 as V,
  INTERNAL_APPROVAL_GEO_RISKS,
  INTERNAL_APPROVAL_EXPOSURES,
} from "../shared/domain/taxonomy";
import { normalizeEstimateVersionCopySourceV2, hashEstimateVersionCopySourceV2, type VersionCopySourceV2 } from "../shared/estimate-version-engine";
import { normalizeChannel } from "../shared/domain/normalization";
import {
  normalizeCommercialChannel,
  PRICING_TO_COMMERCIAL_CHANNEL,
  type CommercialChannel,
} from "../shared/domain/phase2-taxonomy";
import {
  CHANNEL_MIN_MARGIN_PCT,
  CHANNEL_FLOOR_KIND,
  GEO_MIN_MARGIN_PCT,
  PROFIT_SHIELD,
} from "../shared/constants/profit-shield";
import { buildGeoContextSummary } from "../shared/geo-context-warnings";
import {
  classifyCostType,
  normalizeUnit,
  inferCostCode,
} from "./jobtread-csv-export";
import {
  assertPlainData,
  readProjectGeocodeReviewEvidence,
} from "./project-geocode-review-evidence";
export interface InternalApprovalRows {
  draft: EstimateDraft;
  project: Project;
  client: Client;
  tenant: Tenant;
  profile: Profile;
  zone: GeoZone | null;
  settings: TenantSettings | null;
  scopeDraft: ScopeDraft | null;
}
export interface InternalApprovalContext {
  tenantId: string;
  actorId: string;
  confirmedCurrencyCode: "USD";
}
export async function buildEstimateVersionCopyFromRows(rows: InternalApprovalRows, context: InternalApprovalContext): Promise<{content: VersionCopySourceV2; contentHash: string}> {
  const { pricingContext, policyContext, ...rest } = representationInputFromRows(rows, context, V.currencyBasis);
  const content = normalizeEstimateVersionCopySourceV2({
    version: V.copySource,
    ...rest,
    commercialContext: { pricingContext, policyContext },
    copyProjection: {
      assemblyCount: rows.draft.assemblyCount,
      directZone: rows.draft.zone === null ? null : text(rows.draft.zone),
    },
  });
  return { content, contentHash: await hashEstimateVersionCopySourceV2(content) };
}
function unresolved(): never {
  throw new InternalApprovalError("POLICY_CONTEXT_UNRESOLVED");
}
function content(): never {
  throw new InternalApprovalError("INTERNAL_APPROVAL_CONTENT_UNRESOLVED");
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    unresolved();
  return value as Record<string, unknown>;
}
function optionalRecord(value: unknown) {
  return value === null ? {} : record(value);
}
function date(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) content();
  return value.toISOString();
}
function text(value: unknown): string {
  if (typeof value !== "string") content();
  return value.replace(/\r\n?/g, "\n").trim();
}
const nullableText = (value: unknown) => (value == null ? null : text(value));
/**
 * JSON numbers need a safe integer at the source scale (2 money / 6 decimals),
 * a round trip, and distinct adjacent increments. Near the double precision
 * limit two cents can collapse to one value even below MAX_SAFE_INTEGER.
 * Exact decimal strings keep the full Core range. Never round to repair input.
 */
function numericText(value: unknown, scale: number): string {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    content();
  const str = String(value),
    m = /^(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m || (m[2]?.length ?? 0) > scale) content();
  const scaled = BigInt(m[1] + (m[2] ?? "").padEnd(scale, "0"));
  if (
    scaled > BigInt(Number.MAX_SAFE_INTEGER) ||
    Number(scaled) / 10 ** scale !== value ||
    Number(scaled + 1n) / 10 ** scale === value ||
    Number(scaled - 1n) / 10 ** scale === value
  )
    content();
  return str;
}
const minor = (value: unknown) => normalizeApprovalMinor(numericText(value, 2));
const decimal = (value: unknown) =>
  normalizeApprovalDecimal(numericText(value, 6));
const nullableDecimal = (value: unknown) =>
  value == null ? null : decimal(value);
function percent(value: unknown): string {
  try {
    return normalizeApprovalPercent(numericText(value, 6));
  } catch {
    unresolved();
  }
}
function maximum(values: string[]): string {
  const scaled = (value: string) => {
    const [w, f = ""] = value.split(".");
    return BigInt(w + f.padEnd(6, "0"));
  };
  return values.reduce((a, b) => (scaled(a) >= scaled(b) ? a : b));
}
function selectedOverride(map: unknown, key: string): string | null {
  const obj = record(map);
  return Object.hasOwn(obj, key) ? percent(obj[key]) : null;
}
function risk(value: unknown) {
  if (!INTERNAL_APPROVAL_GEO_RISKS.includes(value as any)) unresolved();
  return value as (typeof INTERNAL_APPROVAL_GEO_RISKS)[number];
}
function coherent(
  values: unknown[],
  normalize: (v: string) => string | null
): string | null {
  let known: string | null = null;
  for (const value of values) {
    if (value == null) continue;
    if (typeof value !== "string") unresolved();
    const normalized = normalize(value);
    if (!normalized || (known !== null && known !== normalized)) unresolved();
    known = normalized;
  }
  return known;
}
function channels(
  d: EstimateDraft,
  p: Project,
  s: Record<string, unknown>,
  data: Record<string, unknown>
) {
  const candidates = [
    { raw: d.commercialChannel, basis: "draft.commercialChannel" },
    {
      raw: s.commercialChannel,
      basis: "draft.pricingSnapshot.commercialChannel",
    },
    { raw: data.commercialChannel, basis: "draft.draftData.commercialChannel" },
  ] as const;
  const stored = coherent(
    candidates.map(c => c.raw),
    normalizeCommercialChannel
  ) as CommercialChannel | null;
  const pricing = d.channel === null ? null : normalizeChannel(d.channel);
  if (d.channel !== null && !pricing) unresolved();
  const mapped =
    pricing === null ? null : PRICING_TO_COMMERCIAL_CHANNEL[pricing];
  if (stored !== null && mapped !== null && stored !== mapped) unresolved();
  const channel = stored ?? mapped;
  if (channel === null) unresolved();
  const projectChannel = coherent(
    [p.commercialChannel, p.channel],
    normalizeCommercialChannel
  );
  if (projectChannel !== null && projectChannel !== channel) unresolved();
  const chosen = candidates.find(c => c.raw != null);
  return {
    stored,
    pricing,
    channel,
    basis: chosen?.basis ?? ("draft.channel_mapping" as const),
    raw: chosen ? text(chosen.raw) : text(d.channel),
  };
}
function geo(r: InternalApprovalRows) {
  const p = r.project,
    z = r.zone;
  if (!z) unresolved();
  const s = record(p.zoneModifierSnapshot),
    e = readProjectGeocodeReviewEvidence(p, s);
  if (
    !z.isActive ||
    s.zoneId !== z.id ||
    e.zoneDetection.zoneId !== z.id ||
    s.zoneName !== (z.zoneName ?? z.name) ||
    p.zone !== s.zoneName ||
    s.coastalExposureLevel !== z.coastalExposureLevel ||
    !INTERNAL_APPROVAL_EXPOSURES.includes(z.coastalExposureLevel as any)
  )
    unresolved();
  for (const key of [
    "laborModifier",
    "materialModifier",
    "logisticsModifier",
    "contingencyPct",
    "minProfitShieldPct",
  ] as const) {
    try {
      if (
        z[key] === null ||
        s[key] === null ||
        s[key] === undefined ||
        decimal(z[key]) !== decimal(s[key])
      )
        unresolved();
    } catch {
      unresolved();
    }
  }
  const multiplier =
    z.costMultiplier === null ? null : decimal(z.costMultiplier);
  const summary = buildGeoContextSummary({
    geocodeSuccess: e.geocode.success,
    geocodeConfidence: e.geocode.confidence,
    withinServiceRadius: e.geocode.withinServiceRadius,
    zoneName: p.zone,
    coastalExposureLevel: z.coastalExposureLevel,
    costMultiplier: multiplier,
  });
  const storedRisk = p.geoRiskClass === null ? null : risk(p.geoRiskClass),
    low = z.coastalExposureLevel === "none" || z.coastalExposureLevel === "low";
  if (
    (low && storedRisk === null) ||
    (storedRisk !== null && storedRisk !== summary.riskClass)
  )
    unresolved();
  return {
    risk: summary.riskClass,
    context: {
      zone: s.zoneName,
      zoneId: z.id,
      zoneTenantId: z.tenantId,
      zoneSnapshotCapturedAt: s.capturedAt,
      geocodedAt: date(p.geocodedAt!),
      geocodeConfidence: e.geocode.confidence,
      geocodeSource: e.geocode.source,
      coastalExposureLevel: z.coastalExposureLevel,
      riskResolutionBasis: low ? "persisted_project_risk" : "zone_exposure",
      persistedProjectRiskClass: storedRisk,
      costMultiplier: multiplier,
      zoneMinFloorPct:
        z.minProfitShieldPct === null ? null : percent(z.minProfitShieldPct),
      warningCodes: summary.codes,
    },
  };
}
function lines(value: unknown) {
  if (!Array.isArray(value)) content();
  return value.map((raw, index) => {
    const l = record(raw),
      unit = nullableText(l.unit),
      costCode = nullableText(l.costCode),
      unitCost = nullableDecimal(l.unitCostSnapshot),
      unitPrice = nullableDecimal(l.unitPriceSnapshot),
      group = text(l.costGroupName),
      name = text(l.costItemName);
    const normalized = unit === null ? null : normalizeUnit(unit);
    const csvCode = costCode ?? inferCostCode(group);
    const csv =
      normalized !== null && unitCost !== null && unitPrice !== null
        ? {
            classificationVersion: P.classification,
            costType: classifyCostType(
              group,
              name,
              unitCost === "0" ? 0 : 1,
              unitPrice === "0" ? 0 : 1
            ),
            normalizedUnit: normalized,
            costCode: csvCode,
            costTypeSource: P.costTypeSource,
            unitSource:
              unit === normalized ? "stored_canonical" : "normalizeUnit_v1",
            costCodeSource:
              costCode !== null
                ? "stored"
                : csvCode !== null
                  ? "inferCostCode_v1"
                  : "unknown",
          }
        : null;
    return {
      lineKey: `line:${index + 1}`,
      ordinal: index + 1,
      costGroupName: group,
      costItemName: name,
      description: l.description ?? null,
      quantity: decimal(l.quantity),
      unit,
      unitCostSnapshot: unitCost,
      unitPriceSnapshot: unitPrice,
      lineTotalCostMinor: minor(l.lineTotalCost),
      lineTotalPriceMinor: minor(l.lineTotalPrice),
      assemblyId: l.assemblyId ?? null,
      costCode,
      taxable: l.taxable ?? null,
      csvClassification: csv,
    };
  });
}
function selections(value: unknown) {
  if (!Array.isArray(value)) content();
  return value.map((raw, index) => {
    const s = record(raw);
    return {
      selectionKey: `selection:${index + 1}`,
      ordinal: index + 1,
      assemblyId: s.assemblyId,
      assemblyName: s.assemblyName,
      assemblyCode: nullableText(s.assemblyCode),
      category: nullableText(s.category),
      quantity: decimal(s.quantity),
      unitCost: nullableDecimal(s.unitCost),
      unitPrice: nullableDecimal(s.unitPrice),
      extendedCostMinor: s.extendedCost == null ? null : minor(s.extendedCost),
      extendedPriceMinor:
        s.extendedPrice == null ? null : minor(s.extendedPrice),
    };
  });
}
/** The writer must establish RBAC and historical ancestry before invoking this pure data check. */
export async function buildInternalApprovalReviewFromRows(
  rows: InternalApprovalRows,
  context: InternalApprovalContext
): Promise<ReviewResult> {
  return buildInternalApprovalReview(representationInputFromRows(rows, context, P.currencyBasis));
}

/** Share row normalization, never a temporary approval representation for copying. */
function representationInputFromRows(
  rows: InternalApprovalRows,
  context: InternalApprovalContext,
  currencyBasis: typeof P.currencyBasis | typeof V.currencyBasis,
) {
  assertPlainData(rows, true);
  assertPlainData(context);
  const {
    draft: d,
    project: p,
    client,
    tenant,
    profile,
    zone,
    settings,
    scopeDraft,
  } = rows;
  if (
    !context.tenantId ||
    context.actorId !== profile.id ||
    tenant.id !== context.tenantId ||
    !tenant.isActive ||
    !profile.isActive ||
    !client.isActive ||
    p.deletedAt !== null ||
    client.deletedAt !== null ||
    [d, p, client, profile].some(v => v.tenantId !== context.tenantId) ||
    (zone !== null && zone.tenantId !== context.tenantId) ||
    (settings !== null && settings.tenantId !== context.tenantId) ||
    d.projectId !== p.id ||
    d.clientId !== client.id ||
    p.clientId !== client.id
  )
    content();
  // Dates belong to typed timestamp columns, never to a stored JSON envelope.
  for (const value of [
    d.pricingSnapshot,
    d.draftData,
    d.lineItems,
    d.assemblySelections,
    p.zoneModifierSnapshot,
  ])
    assertPlainData(value);
  if (settings) {
    assertPlainData(settings.profitShieldOverrides);
    assertPlainData(settings.geoFloorOverrides);
  }
  const snap = optionalRecord(d.pricingSnapshot),
    data = optionalRecord(d.draftData),
    channel = channels(d, p, snap, data),
    g = geo(rows);
  const storedRisk = coherent([snap.geoRiskClass, data.geoRiskClass], v =>
    risk(v)
  );
  const pricedZone = coherent([d.zone, snap.zone, data.zone], v => text(v));
  const selectedSettings =
    settings === null
      ? {
          settingsId: null,
          settingsUpdatedAt: null,
          channelOverridePct: null,
          geoOverridePct: null,
        }
      : {
          settingsId: settings.id,
          settingsUpdatedAt: date(settings.updatedAt),
          channelOverridePct: selectedOverride(
            settings.profitShieldOverrides,
            channel.channel
          ),
          geoOverridePct: selectedOverride(settings.geoFloorOverrides, g.risk),
        };
  const channelBase = String(CHANNEL_MIN_MARGIN_PCT[channel.channel]),
    geoBase = String(GEO_MIN_MARGIN_PCT[g.risk]);
  if (
    d.scopeDraftId !== null &&
    (!scopeDraft ||
      scopeDraft.id !== d.scopeDraftId ||
      scopeDraft.projectId !== p.id ||
      scopeDraft.tenantId !== context.tenantId)
  )
    content();
  // No price, identity, unit, catalogue, currency or risk default is synthesized here.
  const input = {
    identity: {
      tenantId: context.tenantId,
      projectId: p.id,
      clientId: client.id,
      estimateDraftId: d.id,
      draftVersion: d.version,
    },
    origin: {
      source: d.source,
      sourceCreatedAt: date(d.createdAt),
      pricingSchemaVersion: d.pricingSchemaVersion,
      estimateId: d.estimateId,
      intakeFormId: d.intakeFormId,
      bundleId: d.bundleId,
      supersedesId: d.supersedesId,
      changeOrderOf: d.changeOrderOf,
      lineageBasis: P.lineageBasis,
    },
    presentation: { bundleName: d.bundleName, reviewedNotes: d.notes },
    financials: {
      currencyCode: context.confirmedCurrencyCode,
      currencyBasis,
      subtotalPriceMinor: minor(d.subtotalPrice),
      discountApplied: d.discountApplied,
      discountMinor: minor(d.discountAmount),
      finalPriceMinor: minor(d.finalTotalPrice),
      estimatedCostMinor: minor(d.subtotalCost),
    },
    lines: lines(d.lineItems),
    assemblySelections: selections(d.assemblySelections),
    pricingContext: {
      pricingChannel: channel.pricing,
      finishLevel: d.finishLevel,
      region: d.region,
      zone: pricedZone,
      trade: d.trade,
      coastalModifier: nullableDecimal(d.coastalModifier),
      storedCommercialChannel: channel.stored,
      storedGeoRiskClass: storedRisk,
      storedRiskBasis:
        storedRisk === null ? "unknown" : "persisted_pricing_context",
    },
    policyContext: {
      version: P.policy,
      evaluatorVersion: P.evaluator,
      commercialChannel: channel.channel,
      channelBasis: channel.basis,
      channelRawValue: channel.raw,
      geoRiskClass: g.risk,
      riskBasis: P.riskBasis,
      projectGeo: g.context,
      tenantSettings: selectedSettings,
      floors: {
        channelBasePct: channelBase,
        geoBasePct: geoBase,
        effectiveFloorPct: maximum(
          [
            channelBase,
            geoBase,
            selectedSettings.channelOverridePct,
            selectedSettings.geoOverridePct,
          ].filter((v): v is string => v !== null)
        ),
        globalWarningPct: percent(
          normalizeApprovalMinor(String(PROFIT_SHIELD.GLOBAL_MIN_GP))
        ),
        individualWarningPct: percent(
          normalizeApprovalMinor(String(PROFIT_SHIELD.INDIVIDUAL_WARNING_GP))
        ),
        floorKind:
          CHANNEL_FLOOR_KIND[channel.channel] === "fee" ? "fee" : "margin",
      },
    },
    scopeReference:
      d.scopeDraftId === null
        ? { association: "none", scopeDraftId: null, reviewSnapshotId: null }
        : {
            association: "draft_link_only",
            scopeDraftId: d.scopeDraftId,
            reviewSnapshotId: null,
          },
  };
  return input;
}
