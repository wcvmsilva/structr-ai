/** Real Monitoring markup with only transport doubled; no browser or database needed. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ metrics: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  fieldLaunch: {
    monitoringMetrics: { useQuery: io.metrics },
    estimateStatusDistribution: { useQuery: () => ({ data: {}, isLoading: false }) },
    recentActivity: { useQuery: () => ({ data: [], isLoading: false }) },
    getFieldLaunchMode: { useQuery: () => ({ data: { enabled: false } }) },
    setFieldLaunchMode: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
  },
  useUtils: () => ({ fieldLaunch: {
    getFieldLaunchMode: { invalidate: vi.fn() }, monitoringMetrics: { invalidate: vi.fn() },
  } }),
} }));
import MonitoringPage from "../client/src/pages/Monitoring";
const metrics = { totalEstimates: 12, estimatesApproved: 3, estimatesRejected: 2, estimatesExported: 4,
  pipelineErrors: 1, overrideFrequency: 5, csvValidationFailures: 6, feedbackReports: 7,
  highVarianceProjects: { state: "unavailable", reason: "EXECUTION_AUTHORITY_NOT_AVAILABLE" }, fieldLaunchEnabled: false };
function cardValue(html: string, label: string) {
  const matched = html.match(new RegExp(`>${label}</p><p[^>]*>([^<]*)</p>`));
  if (!matched) throw new Error(`Missing visible metric value for ${label}`);
  return matched[1];
}
beforeEach(() => { vi.clearAllMocks(); io.metrics.mockReturnValue({ data: metrics, isLoading: false }); });
describe("A1 monitoring variance display", () => {
  it("renders derived variance as unavailable while preserving the eight observed counts", () => {
    const html = renderToStaticMarkup(createElement(MonitoringPage));
    expect(cardValue(html, "High Variance")).toBe("Unavailable");
    expect(html).toContain("Awaiting execution authorization");
    for (const [label, count] of [["Total Estimates", 12], ["Approved", 3], ["Rejected", 2], ["Exported", 4], ["Pipeline Errors", 1], ["Override Events", 5], ["CSV Failures", 6], ["Feedback Reports", 7]] as const) {
      expect(cardValue(html, label)).toBe(String(count));
    }
    expect(html).not.toContain("EXECUTION_AUTHORITY_NOT_AVAILABLE");
  });
  it("does not substitute a false zero for variance when metric data has not arrived", () => {
    io.metrics.mockReturnValue({ data: undefined, isLoading: false });
    const html = renderToStaticMarkup(createElement(MonitoringPage));
    expect(cardValue(html, "High Variance")).toBe("Unavailable");
    expect(html).toContain("Awaiting execution authorization");
  });
});
