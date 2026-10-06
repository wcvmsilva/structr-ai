/** C2-A refuses draft artifact entrypoints. Explicit synthetic row utilities stay neutral. */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstimateDraft } from "../drizzle/schema";
import { buildEstimateVersionPreviewV2, projectEstimateVersionDraftV2 } from "../shared/estimate-version-engine";
import { approvalIds, makeInternalApprovalSnapshot } from "./internal-estimate-approval-engine.fixtures";

const effects = vi.hoisted(() => ({ pdf: vi.fn(), bytes: vi.fn(() => new ArrayBuffer(4)) }));
vi.mock("jspdf", () => ({ jsPDF: function PdfProbe() {
  effects.pdf();
  return {
    internal: { pageSize: { getWidth: () => 216, getHeight: () => 279 } },
    setFillColor: vi.fn(), rect: vi.fn(), setTextColor: vi.fn(), setFontSize: vi.fn(),
    setFont: vi.fn(), text: vi.fn(), setDrawColor: vi.fn(), setLineWidth: vi.fn(),
    line: vi.fn(), addPage: vi.fn(), setPage: vi.fn(), getNumberOfPages: () => 1,
    splitTextToSize: (value: string) => [value], output: effects.bytes,
  };
} }));

import { generateJsonExport, generatePdfExport, generatePrintableExport } from "./estimate-export";
import {
  generateCsvRows, generateJobTreadCsvExport, generateCsvString, validateCsvExport,
  normalizeUnit, classifyCostType, lineItemToCsvRow, type JobTreadCsvRow,
} from "./jobtread-csv-export";

const USER = "e8100000-0000-4000-8000-000000000001";
const CHILD = "e8100000-0000-4000-8000-000000000002";
const entries: Array<[string, (draft: EstimateDraft) => unknown]> = [
  ["JSON", draft => generateJsonExport(draft, USER)],
  ["PDF", draft => generatePdfExport(draft, USER)],
  ["printable HTML", draft => generatePrintableExport(draft, USER)],
  ["CSV draft rows", draft => generateCsvRows(draft)],
  ["CSV draft artifact", draft => generateJobTreadCsvExport(draft, USER)],
];
let projected: EstimateDraft;
beforeAll(async () => {
  const snapshot = makeInternalApprovalSnapshot();
  const content = { ...snapshot, version: "estimate-version-copy-source-v2",
    financials: { ...snapshot.financials, currencyBasis: "version_request_confirmation" },
    copyProjection: { assemblyCount: 1, directZone: null } };
  const command = { version: "estimate-version-preview-command-v2", sourceKind: "current_draft",
    sourceDraftId: approvalIds.draft, confirmedCurrencyCode: "USD" };
  const preview = await buildEstimateVersionPreviewV2({ command, content, sourceApprovalId: null, sourceApprovalState: null });
  // Transport identity only; no assertion that a stored row has been authorized or persisted.
  projected = await projectEstimateVersionDraftV2({ preview,
    command: { ...command, version: "estimate-version-command-v2", requestId: approvalIds.request,
      expectedSourceVersion: 1, expectedSourceContentHash: preview.sourceContentHash,
      name: null, reason: "Synthetic artifact hold regression" },
    context: { tenantId: approvalIds.tenant, actorId: approvalIds.actor, projectId: approvalIds.project, clientId: approvalIds.client },
    allocation: { id: CHILD, version: 2, timestamp: "2026-09-20T12:00:00.000Z" } });
});
beforeEach(() => vi.clearAllMocks());

function draft(patch: Partial<EstimateDraft> = {}): EstimateDraft {
  return { ...structuredClone(projected), a1VersionRequestId: null, a1VersionRequestHash: null,
    source: "assembly_calculator", status: "draft", assemblySelections: [], lineItems: [],
    approvedBy: null, approvedAt: null, lockedAt: null, ...patch };
}
function held(action: () => unknown) {
  let returned: unknown;
  let failure: unknown;
  try { returned = action(); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE", operation: "export" });
  expect(returned).toBeUndefined();
  expect(effects.pdf).not.toHaveBeenCalled();
  expect(effects.bytes).not.toHaveBeenCalled();
}

describe.each(entries)("%s draft artifact hold", (_name, generate) => {
  it.each([
    ["calculated draft", {}],
    ["legacy approved stamps", { status: "approved", approvedBy: USER,
      approvedAt: new Date("2026-09-20T12:00:00Z"), lockedAt: new Date("2026-09-20T12:00:00Z"), profitShieldPassed: true }],
    ["internal approval", { status: "internally_approved", approvedBy: USER }],
    ["revoked internal approval", { status: "internal_approval_revoked", approvedBy: USER }],
    ["historical source", { source: "historical_import" }],
    ["partial version marker", { source: "version", a1VersionRequestId: USER, a1VersionRequestHash: null }],
  ] satisfies Array<[string, Partial<EstimateDraft>]>)("refuses %s without a returned artifact", (_kind, patch) => {
    held(() => generate(draft(patch)));
  });

  it("refuses a real v2 projection with exact strings and no old per-line GP", () => {
    const before = structuredClone(projected);
    held(() => generate(projected));
    expect(projected).toEqual(before);
  });

  it("refuses forged approval over a real v2 projection", () => {
    held(() => generate({ ...projected, status: "approved", approvedBy: USER,
      approvedAt: new Date("2026-09-20T12:00:00Z"), profitShieldPassed: true }));
  });

  it("refuses before reading any draft field or instantiating an artifact generator", () => {
    const touched = vi.fn(() => { throw new Error("Synthetic draft must remain unread"); });
    const unreadable = new Proxy(draft(), { get: touched, ownKeys: touched, getOwnPropertyDescriptor: touched });
    held(() => generate(unreadable));
    expect(touched).not.toHaveBeenCalled();
  });

  it("rejects even malformed direct input using the domain hold, without a parsing fallback", () => {
    held(() => generate(undefined as unknown as EstimateDraft));
  });

  it("keeps repeated calls unavailable without mutating the original draft", () => {
    const source = draft({ notes: "Synthetic unchanged operational note" });
    const before = structuredClone(source);
    held(() => generate(source)); held(() => generate(source));
    expect(source).toEqual(before);
  });
});

const explicitRow = (patch: Partial<JobTreadCsvRow> = {}): JobTreadCsvRow => ({
  "Cost Group Name": "Synthetic group", "Cost Item Name": "Synthetic item", Description: "Synthetic row",
  Quantity: "2", Unit: "Each", "Unit Cost": "0.10", "Unit Price": "0.15", "Cost Type": "Materials", Taxable: "False", ...patch,
});

describe("neutral explicit-row format controls", () => {
  it("preserves known taxable false and arithmetic in explicit validation", () => {
    const report = validateCsvExport([explicitRow()]);
    expect(report).toMatchObject({ isValid: true, totalRows: 1, validRows: 1, invalidRows: 0,
      summary: { totalCost: 0.20, totalPrice: 0.30 } });
    expect(report.rows[0].Taxable).toBe("False");
    expect(report).not.toHaveProperty("csvString");
  });
  it("serializes only supplied columns, preserving BOM, quotes, newline and fractional rate text", () => {
    expect(generateCsvString([explicitRow({ Description: 'Synthetic, "quoted"\nline', "Unit Price": "0.000001" })])).toBe(
      '\uFEFFCost Group Name,Cost Item Name,Description,Quantity,Unit,Unit Cost,Unit Price,Cost Type,Taxable\n' +
      'Synthetic group,Synthetic item,"Synthetic, ""quoted""\nline",2,Each,0.10,0.000001,Materials,False\n');
  });
  it("reports invalid explicit units instead of claiming format success", () => {
    const report = validateCsvExport([explicitRow({ Unit: "Synthetic unknown unit" })]);
    expect(report.isValid).toBe(false); expect(report.invalidRows).toBe(1);
    expect(report.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "Unit" })]));
    expect(report.rows[0].Taxable).toBe("False");
  });
  it("retains neutral unit normalization and explicit classification", () => {
    expect(normalizeUnit("LF")).toBe("Linear Feet");
    expect(classifyCostType("Roofing", "Shingle Installation", 3000, 5000)).toBe("Subcontractor");
  });
  it("retains explicit line conversion without changing its caller's data", () => {
    const item = { costGroupName: "Interior Finishes", costItemName: "Synthetic flooring", description: null,
      unit: "SF", quantity: 2, unitCostSnapshot: 1.25, unitPriceSnapshot: 2.5, taxable: false };
    const before = structuredClone(item);
    expect(lineItemToCsvRow(item)).toMatchObject({ Unit: "Square Feet", Quantity: "2",
      "Unit Cost": "1.25", "Unit Price": "2.50", Taxable: "False" });
    expect(item).toEqual(before);
  });
});
