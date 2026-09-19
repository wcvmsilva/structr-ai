/** Real React server rendering; only tRPC query results are substituted. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverrideResolverOutput, ResolvedOverride } from "../shared/geo-override-engine";

const queries = vi.hoisted(() => ({ project: vi.fn(), history: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  project: { getById: { useQuery: queries.project } },
  geoOverride: { getLog: { useQuery: queries.history }, previewForDraft: { useQuery: queries.preview } },
} }));
import { GeographicOverridePanel } from "../client/src/components/review/GeographicOverridePanel";

const PROJECT = "c2700000-0000-4000-8000-000000000001";
const DRAFT = "d2700000-0000-4000-8000-000000000001";
const ZONE = "Charleston Coastal";
const ERROR = "Unable to load geographic override information. Please try again.";
const LOADING = "Loading geographic override information";
const EMPTY = "No geographic overrides applied. All assemblies are standard for this zone.";
const NO_ZONE = "No zone detected for this project. Override preview is unavailable.";
const SECRET = "SQL secret tenant payload must never appear";
const empty: OverrideResolverOutput = {
  hasOverrides: false, resolvedItems: [], overrides: [], warnings: [], resolvedAt: "2026-09-18T15:00:00Z",
  stats: { totalInputItems: 1, totalResolvedItems: 1, swapsApplied: 0, additionsApplied: 0,
    warningsGenerated: 0, skippedAlreadyApplied: 0, rulesEvaluated: 0, rulesMatched: 0 },
};
function settled<T>(data: T) {
  return { data, error: null, isError: false, isPending: false, isLoading: false, isFetching: false, isSuccess: true };
}
const render = () => renderToStaticMarkup(createElement(GeographicOverridePanel, { projectId: PROJECT, scopeDraftId: DRAFT }));
function expectNotSuccess(html: string) {
  expect(html).not.toContain(EMPTY);
  expect(html).not.toContain(NO_ZONE);
  expect(html).not.toContain("persisted in audit log");
  expect(html).not.toContain(SECRET);
}

beforeEach(() => {
  vi.resetAllMocks();
  queries.project.mockReturnValue(settled({ zone: ZONE }));
  queries.history.mockReturnValue(settled([]));
  queries.preview.mockReturnValue(settled(empty));
});

describe("geographic overrides query state in rendered HTML", () => {
  it.each(["project", "history", "preview"] as const)("renders a generic alert for %s errors, never an empty success", source => {
    queries[source].mockReturnValue({ ...settled(undefined), isError: true, isSuccess: false, error: new Error(SECRET) });
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain(ERROR);
    expectNotSuccess(html);
  });

  it.each(["project", "history", "preview"] as const)("prioritizes cached %s errors over stale success and active refetch", source => {
    const cached = source === "project" ? { zone: ZONE } : source === "history" ? [{ id: "history" }] : empty;
    queries[source].mockReturnValue({ ...settled(cached), isError: true, isSuccess: false, error: new Error(SECRET), isFetching: true });
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain(ERROR);
    expect(html).not.toContain('role="status"');
    expectNotSuccess(html);
  });

  it.each(["project", "history", "preview"] as const)("shows accessible loading while required %s data is pending", source => {
    queries[source].mockReturnValue({ ...settled(undefined), isPending: true, isLoading: true, isFetching: true, isSuccess: false });
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain(LOADING);
    expectNotSuccess(html);
  });

  it.each(["project", "history", "preview"] as const)("shows loading during an active %s refetch with cached empty success", source => {
    const cached = source === "project" ? { zone: ZONE } : source === "history" ? [] : empty;
    queries[source].mockReturnValue({ ...settled(cached), isFetching: true });
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain(LOADING);
    expectNotSuccess(html);
  });

  it.each(["", "unknown", null])("ignores disabled preview pending/error flags for settled zone %s and preserves history", zone => {
    queries.project.mockReturnValue(settled({ zone }));
    queries.history.mockReturnValue(settled([{ id: "first" }, { id: "second" }]));
    queries.preview.mockReturnValue({ ...settled(undefined), isPending: true, isLoading: true, isError: true, error: new Error(SECRET), isSuccess: false });
    const html = render();
    expect(html).toContain(NO_ZONE);
    expect(html).toContain("2 override(s) persisted in audit log");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain(EMPTY);
    expect(html).not.toContain(SECRET);
    expect(queries.preview).toHaveBeenCalledWith({ scopeDraftId: DRAFT, projectZone: zone ?? "" }, { enabled: false });
  });

  it("waits for history before reporting a successfully missing project zone", () => {
    queries.project.mockReturnValue(settled(null));
    queries.history.mockReturnValue({ ...settled(undefined), isPending: true, isSuccess: false });
    queries.preview.mockReturnValue({ ...settled(undefined), isPending: true, isSuccess: false });
    const html = render();
    expect(html).toContain('role="status"');
    expectNotSuccess(html);
  });

  it("shows a history error before a missing zone even when preview is disabled", () => {
    queries.project.mockReturnValue(settled({ zone: null }));
    queries.history.mockReturnValue({ ...settled([]), isError: true, isSuccess: false, error: new Error(SECRET) });
    const html = render();
    expect(html).toContain(ERROR);
    expectNotSuccess(html);
  });

  it("shows empty success only after all required queries settle and preview explicitly has no overrides", () => {
    const html = render();
    expect(html).toContain(EMPTY);
    expect(html).toContain(ZONE);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('role="status"');
    expect(queries.project).toHaveBeenCalledWith({ id: PROJECT });
    expect(queries.history).toHaveBeenCalledWith({ scopeDraftId: DRAFT });
    expect(queries.preview).toHaveBeenCalledWith({ scopeDraftId: DRAFT, projectZone: ZONE }, { enabled: true });
  });

  it.each(["history", "preview"] as const)("does not treat missing required %s data as an explicit empty result", source => {
    queries[source].mockReturnValue({ ...settled(undefined), isSuccess: false, isPending: true });
    const html = render();
    expect(html).toContain('role="status"');
    expectNotSuccess(html);
  });

  it("keeps existing applied history visible when preview reports no new overrides", () => {
    queries.history.mockReturnValue(settled([{ id: "history" }]));
    const html = render();
    expect(html).toContain("1 override(s) persisted in audit log");
    expect(html).not.toContain(EMPTY);
    expect(html).toContain("Swaps");
  });

  it("preserves populated swap/add/warning details, stats, warnings and history, omitting already-applied details", () => {
    const base: ResolvedOverride = {
      ruleId: "f2700000-0000-4000-8000-000000000001", zone: ZONE, trade: "electrical",
      originalAssemblyId: "e2700000-0000-4000-8000-000000000001", originalAssemblyName: "Standard wiring",
      replacementAssemblyId: "e2700000-0000-4000-8000-000000000002", replacementAssemblyName: "Coastal wiring",
      overrideType: "swap", overrideReason: "Replace for coastal exposure", skippedBecauseAlreadyApplied: false,
    };
    queries.preview.mockReturnValue(settled({
      ...empty, hasOverrides: true,
      overrides: [base, { ...base, overrideType: "add", replacementAssemblyName: "Extra protection" },
        { ...base, overrideType: "warning_only", overrideReason: "Inspect marine rating", replacementAssemblyName: "Do not render warning replacement" },
        { ...base, skippedBecauseAlreadyApplied: true, overrideReason: "Do not render skipped detail" }],
      warnings: ["Verify exposure on site"],
      stats: { ...empty.stats, swapsApplied: 1, additionsApplied: 2, warningsGenerated: 3, rulesMatched: 6 },
    }));
    queries.history.mockReturnValue(settled([{ id: "history" }]));
    const html = render();
    for (const text of ["Swap", "Addition", "Warning", "Standard wiring", "Coastal wiring", "Extra protection",
      "Replace for coastal exposure", "Inspect marine rating", "Override Warnings", "Verify exposure on site",
      "Rules Matched", "1 override(s) persisted in audit log"]) expect(html).toContain(text);
    for (const number of [1, 2, 3, 6]) expect(html).toMatch(new RegExp(`>${number}</p>`));
    expect(html).not.toContain("Do not render warning replacement");
    expect(html).not.toContain("Do not render skipped detail");
    expectNotSuccess(html.replace("1 override(s) persisted in audit log", ""));
  });
});
