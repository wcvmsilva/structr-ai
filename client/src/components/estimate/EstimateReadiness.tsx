import type { ProfitShieldEvaluation } from "@shared/profit-shield-engine";
import { round2, safeParseFloat } from "@shared/utils/math";

type QueryState<T> = {
  data: T | undefined;
  error: unknown;
  isError: boolean;
  isSuccess: boolean;
  isPending: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isPaused: boolean;
};

/** A cached success is not a current verification during refetch, pause, or error. */
export function currentQueryData<T>(query: QueryState<T>): T | undefined {
  if (query.error || query.isError || !query.isSuccess || query.isPending || query.isLoading || query.isFetching || query.isPaused) return undefined;
  return query.data;
}

/** discountApplied is a boolean. Display the ratio of the stored monetary amounts. */
export function formatDiscountPercent(draft: { discountAmount: unknown; subtotalPrice: unknown }): string {
  const amount = draft.discountAmount;
  const subtotal = draft.subtotalPrice;
  const validNumber = (value: unknown): value is number | string =>
    (typeof value === "number" || (typeof value === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())))
    && Number.isFinite(Number(value));
  if (!validNumber(amount) || !validNumber(subtotal)) return "Unavailable";
  const discountAmount = safeParseFloat(amount, "discountAmount");
  const subtotalPrice = safeParseFloat(subtotal, "subtotalPrice");
  if (subtotalPrice <= 0 || discountAmount < 0 || discountAmount > subtotalPrice) return "Unavailable";
  return `${round2(discountAmount / subtotalPrice * 100).toFixed(1)}%`;
}

export function ProfitShieldStatus({ query }: { query: QueryState<ProfitShieldEvaluation> }) {
  if (query.error || query.isError) {
    return <div role="alert" className="rounded-xl border border-amber-500/30 p-4 text-sm text-amber-400">Unable to verify Profit Shield. Please try again.</div>;
  }
  const evaluation = currentQueryData(query);
  if (!evaluation) {
    return <div role="status" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Verifying Profit Shield…</div>;
  }
  const unresolved = evaluation.violations.some(item => item.code === "UNKNOWN_CHANNEL");
  const label = unresolved ? "channel unresolved" : evaluation.blocked ? "blocked" : evaluation.passed ? "passed" : "not verified";
  const color = evaluation.passed && !evaluation.blocked && !unresolved ? "text-emerald-400" : "text-amber-400";
  return (
    <section aria-label="Profit Shield" className="rounded-xl border border-border px-4 py-3 space-y-2">
      <p className={`text-sm font-bold ${color}`}>Profit Shield: {label}</p>
      <p className="text-xs text-muted-foreground">Effective floor: {evaluation.effectiveFloorPct.toFixed(1)}% · Evaluated margin: {evaluation.actualPct.toFixed(1)}%</p>
      {unresolved && <p className="text-xs text-amber-400">The displayed floor is a fallback until the commercial channel is resolved.</p>}
      {[...evaluation.violations, ...evaluation.warnings].map((item, index) => <p key={`${item.code}-${index}`} className="text-xs text-amber-400">{item.message}</p>)}
      {evaluation.remediation.length > 0 && <ul className="list-disc pl-4 text-xs text-muted-foreground">{evaluation.remediation.map((message, index) => <li key={index}>{message}</li>)}</ul>}
    </section>
  );
}

type ExportAuthorization = { authorized: boolean; reason: string | null };
export function ExportAuthorizationStatus({ query }: { query: QueryState<ExportAuthorization> }) {
  const authorization = currentQueryData(query);
  return (
    <section aria-label="Export authorization" className="rounded-xl border border-border px-4 py-3 text-sm space-y-1">
      {query.error || query.isError ? (
        <p role="alert" className="text-amber-400">Unable to verify export authorization. Downloads are disabled. Please try again.</p>
      ) : !authorization ? (
        <p role="status" className="text-muted-foreground">Verifying export authorization… Downloads are disabled.</p>
      ) : authorization.authorized ? (
        <p>Export authorization: allowed. CSV export runs additional validation and reconciliation.</p>
      ) : (
        <p className="text-amber-400">Export authorization: blocked. {authorization.reason || "This estimate is not authorized for export."}</p>
      )}
      <p className="text-xs text-muted-foreground">CSV format validation does not authorize export.</p>
    </section>
  );
}
