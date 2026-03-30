/**
 * Estimate Export Module — Sprint 20
 *
 * Generates export artifacts from estimate drafts:
 *   - PDF: Professional estimate summary document
 *   - JSON: Machine-readable full export with metadata
 *   - Printable HTML: Clean, print-optimized HTML summary
 *
 * DOES NOT modify any core engine — read-only consumption of EstimateDraft.
 */
import { jsPDF } from "jspdf";
import type {
  EstimateDraft,
  EstimateDraftAssemblySelection,
  EstimateDraftLineItem,
} from "../drizzle/schema";

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════

export interface ExportMetadata {
  exportedAt: string;
  exportedBy: string;
  pricingSchemaVersion: string;
  source: string;
  format: "pdf" | "json" | "printable";
}

export interface JsonExport {
  version: "1.0";
  exportMetadata: ExportMetadata;
  draft: {
    id: string;
    bundleName: string | null;
    status: string;
    source: string | null;
    channel: string | null;
    region: string | null;
    finishLevel: string | null;
    pricingSchemaVersion: string | null;
    createdAt: string;
    updatedAt: string;
  };
  financials: {
    subtotalCost: string | null;
    subtotalPrice: string | null;
    grossProfit: string | null;
    grossProfitPct: string | null;
    discountApplied: boolean | null;
    discountAmount: string | null;
    finalTotalPrice: string | null;
  };
  assemblies: EstimateDraftAssemblySelection[];
  lineItems: EstimateDraftLineItem[];
  provenance: {
    contextSnapshot: unknown | null;
    scopeDraftId: string | null;
  };
  notes: string | null;
}

export interface PrintableExport {
  html: string;
  title: string;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function fmtCurrency(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function fmtPct(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return `${num.toFixed(1)}%`;
}

function fmtDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ══════════════════════════════════════════════════════════════════════
// JSON EXPORT
// ══════════════════════════════════════════════════════════════════════

export function generateJsonExport(
  draft: EstimateDraft,
  userId: string
): JsonExport {
  const metadata = (draft.metadata as Record<string, unknown>) ?? {};
  return {
    version: "1.0",
    exportMetadata: {
      exportedAt: new Date().toISOString(),
      exportedBy: userId,
      pricingSchemaVersion: draft.pricingSchemaVersion ?? "unknown",
      source: draft.source ?? "unknown",
      format: "json",
    },
    draft: {
      id: draft.id,
      bundleName: draft.bundleName,
      status: draft.status,
      source: draft.source,
      channel: draft.channel,
      region: draft.region,
      finishLevel: draft.finishLevel,
      pricingSchemaVersion: draft.pricingSchemaVersion,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    },
    financials: {
      subtotalCost: draft.subtotalCost,
      subtotalPrice: draft.subtotalPrice,
      grossProfit: draft.grossProfit,
      grossProfitPct: draft.grossProfitPct,
      discountApplied: draft.discountApplied,
      discountAmount: draft.discountAmount,
      finalTotalPrice: draft.finalTotalPrice,
    },
    assemblies: ((draft.assemblySelections ?? []) as any[]) ?? [],
    lineItems: ((draft.lineItems ?? []) as any[]) ?? [],
    provenance: {
      contextSnapshot: metadata.contextSnapshot ?? null,
      scopeDraftId: draft.scopeDraftId ?? null,
    },
    notes: draft.notes,
  };
}

// ══════════════════════════════════════════════════════════════════════
// PDF EXPORT
// ══════════════════════════════════════════════════════════════════════

export function generatePdfExport(
  draft: EstimateDraft,
  userId: string
): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // ── Header ──
  doc.setFillColor(30, 30, 35);
  doc.rect(0, 0, pageWidth, 40, "F");
  doc.setTextColor(212, 175, 55); // Gold
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("structr.ai", margin, 18);
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 180);
  doc.text("Estimate Summary", margin, 26);
  doc.text(`#EST-${String(draft.id).padStart(5, "0")}`, pageWidth - margin, 18, { align: "right" });
  doc.text(fmtDate(draft.createdAt), pageWidth - margin, 26, { align: "right" });
  y = 48;

  // ── Estimate Info ──
  doc.setTextColor(60, 60, 60);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const infoLines = [
    `Name: ${draft.bundleName}`,
    `Status: ${capitalize(draft.status)}`,
    `Source: ${draft.source ?? "N/A"}`,
    `Channel: ${capitalize(draft.channel ?? "direct")}`,
    `Region: ${draft.region ?? "N/A"}`,
    `Finish Level: ${capitalize(draft.finishLevel ?? "standard")}`,
    `Pricing Schema: v${draft.pricingSchemaVersion ?? "1.0"}`,
  ];
  for (const line of infoLines) {
    doc.text(line, margin, y);
    y += 5;
  }
  y += 3;

  // ── Financial Summary ──
  doc.setDrawColor(212, 175, 55);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + contentWidth, y);
  y += 6;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 35);
  doc.text("Financial Summary", margin, y);
  y += 7;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const financials = [
    ["Subtotal Cost", fmtCurrency(String(draft.subtotalCost ?? "0"))],
    ["Subtotal Price", fmtCurrency(String(draft.subtotalPrice ?? "0"))],
    ["Gross Profit", fmtCurrency(String(draft.grossProfit ?? "0"))],
    ["Gross Profit %", fmtPct(String(draft.grossProfitPct ?? "0"))],
    ["Discount Applied", fmtPct(String(draft.discountApplied ?? false))],
    ["Discount Amount", fmtCurrency(String(draft.discountAmount ?? "0"))],
  ];
  for (const [label, value] of financials) {
    doc.setTextColor(100, 100, 100);
    doc.text(label, margin, y);
    doc.setTextColor(30, 30, 35);
    doc.text(value, margin + 60, y);
    y += 5;
  }
  y += 2;
  doc.setDrawColor(212, 175, 55);
  doc.line(margin, y, margin + contentWidth, y);
  y += 5;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 35);
  doc.text("TOTAL PRICE", margin, y);
  doc.text(fmtCurrency(String(draft.finalTotalPrice ?? "0")), margin + 60, y);
  y += 10;

  // ── Assembly Selections ──
  const assemblies = ((draft.assemblySelections ?? []) as any[]) ?? [];
  if (assemblies.length > 0) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 35);
    doc.text("Assembly Selections", margin, y);
    y += 7;

    // Table header
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y - 4, contentWidth, 6, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 80);
    doc.text("Assembly", margin + 1, y);
    doc.text("Category", margin + 55, y);
    doc.text("Qty", margin + 95, y);
    doc.text("Unit Cost", margin + 110, y);
    doc.text("Unit Price", margin + 135, y);
    doc.text("Ext. Price", margin + 160, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    for (const asm of assemblies) {
      if (y > 260) {
        doc.addPage();
        y = margin;
      }
      doc.setTextColor(30, 30, 35);
      doc.text(asm.assemblyName.substring(0, 30), margin + 1, y);
      doc.setTextColor(100, 100, 100);
      doc.text(asm.category.substring(0, 20), margin + 55, y);
      doc.text(String(asm.quantity), margin + 95, y);
      doc.text(fmtCurrency(asm.unitCost), margin + 110, y);
      doc.text(fmtCurrency(asm.unitPrice), margin + 135, y);
      doc.setTextColor(30, 30, 35);
      doc.text(fmtCurrency(asm.extendedPrice), margin + 160, y);
      y += 4.5;
    }
    y += 5;
  }

  // ── Profit Shield Status ──
  if (y > 250) {
    doc.addPage();
    y = margin;
  }
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  const shieldPassed = draft.profitShieldPassed;
  doc.setTextColor(shieldPassed ? 34 : 220, shieldPassed ? 197 : 38, shieldPassed ? 94 : 38);
  doc.text(
    `Profit Shield: ${shieldPassed ? "PASSED" : "FAILED"} (min ${draft.profitShieldMinPct ?? "35.00"}%)`,
    margin,
    y
  );
  y += 8;

  // ── Notes ──
  if (draft.notes) {
    if (y > 250) {
      doc.addPage();
      y = margin;
    }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 35);
    doc.text("Notes", margin, y);
    y += 5;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    const noteLines = doc.splitTextToSize(draft.notes, contentWidth);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 4;
  }

  // ── Footer ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `structr.ai — Estimate #EST-${String(draft.id).padStart(5, "0")} — Page ${i}/${totalPages}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" }
    );
    doc.text(
      `Generated ${new Date().toISOString()} — Pricing Schema v${draft.pricingSchemaVersion ?? "1.0"}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 4,
      { align: "center" }
    );
  }

  // Return as Buffer
  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

// ══════════════════════════════════════════════════════════════════════
// PRINTABLE HTML EXPORT
// ══════════════════════════════════════════════════════════════════════

export function generatePrintableExport(
  draft: EstimateDraft,
  userId: string
): PrintableExport {
  const assemblies = ((draft.assemblySelections ?? []) as any[]) ?? [];
  const lineItems = ((draft.lineItems ?? []) as any[]) ?? [];
  const metadata = (draft.metadata as Record<string, unknown>) ?? {};
  const contextSnapshot = metadata.contextSnapshot as Record<string, unknown> | null;

  const title = `Estimate #EST-${String(draft.id).padStart(5, "0")} — ${draft.bundleName}`;

  const assemblyRows = assemblies
    .map(
      (a) => `
      <tr>
        <td>${a.assemblyName}</td>
        <td>${a.category}</td>
        <td class="center">${a.quantity}</td>
        <td class="right">${fmtCurrency(a.unitCost)}</td>
        <td class="right">${fmtCurrency(a.unitPrice)}</td>
        <td class="right bold">${fmtCurrency(a.extendedPrice)}</td>
        <td class="right">${fmtPct(a.grossProfitPct)}</td>
      </tr>`
    )
    .join("\n");

  const lineItemRows = lineItems
    .map(
      (li) => `
      <tr>
        <td>${li.costItemName}</td>
        <td>${li.costGroupName}</td>
        <td class="center">${li.quantity}</td>
        <td>${li.unit}</td>
        <td class="right">${fmtCurrency(li.unitPriceSnapshot)}</td>
        <td class="right bold">${fmtCurrency(li.lineTotalPrice)}</td>
        <td class="right">${fmtPct(li.grossProfitPct)}</td>
      </tr>`
    )
    .join("\n");

  const provenanceSection = contextSnapshot
    ? `
    <div class="section">
      <h2>Pricing Provenance</h2>
      <table class="info-table">
        <tr><td class="label">Channel</td><td>${(contextSnapshot as any).channel ?? "N/A"} (${(contextSnapshot as any).channelSource ?? "default"})</td></tr>
        <tr><td class="label">Finish Level</td><td>${(contextSnapshot as any).finishLevel ?? "N/A"} (${(contextSnapshot as any).finishLevelSource ?? "default"})</td></tr>
        <tr><td class="label">Region</td><td>${(contextSnapshot as any).region ?? "N/A"} (${(contextSnapshot as any).regionSource ?? "default"})</td></tr>
        <tr><td class="label">Zone</td><td>${(contextSnapshot as any).zone ?? "N/A"}</td></tr>
        <tr><td class="label">Pricing Schema</td><td>v${draft.pricingSchemaVersion ?? "1.0"}</td></tr>
      </table>
      ${
        (contextSnapshot as any).multipliersApplied
          ? `<h3>Multipliers Applied</h3>
          <table class="info-table">
            ${Object.entries((contextSnapshot as any).multipliersApplied)
              .map(([k, v]) => `<tr><td class="label">${k}</td><td>${v}</td></tr>`)
              .join("\n")}
          </table>`
          : ""
      }
    </div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e1e23; line-height: 1.5; padding: 20mm; max-width: 210mm; margin: 0 auto; }
    @media print { body { padding: 10mm; } }
    .header { border-bottom: 3px solid #d4af37; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 22px; color: #1e1e23; }
    .header .subtitle { font-size: 12px; color: #666; margin-top: 4px; }
    .header .est-id { float: right; font-size: 14px; font-weight: bold; color: #d4af37; }
    .section { margin-bottom: 20px; }
    .section h2 { font-size: 14px; color: #d4af37; border-bottom: 1px solid #e5e5e5; padding-bottom: 4px; margin-bottom: 8px; }
    .section h3 { font-size: 12px; color: #666; margin: 8px 0 4px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .info-item { font-size: 11px; }
    .info-item .label { color: #888; }
    .info-item .value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; }
    th { background: #f5f5f5; padding: 6px 8px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #ddd; }
    td { padding: 5px 8px; border-bottom: 1px solid #eee; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 600; }
    .total-row { background: #fafafa; font-weight: 700; font-size: 13px; }
    .total-row td { border-top: 2px solid #d4af37; padding: 8px; }
    .shield { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; }
    .shield.passed { background: #dcfce7; color: #166534; }
    .shield.failed { background: #fee2e2; color: #991b1b; }
    .info-table { width: auto; }
    .info-table td { padding: 3px 12px 3px 0; border: none; font-size: 11px; }
    .info-table .label { color: #888; font-weight: 600; min-width: 140px; }
    .notes { background: #f9f9f9; padding: 10px; border-radius: 4px; font-size: 11px; color: #444; white-space: pre-wrap; }
    .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 9px; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <span class="est-id">#EST-${String(draft.id).padStart(5, "0")}</span>
    <h1>structr.ai</h1>
    <div class="subtitle">Estimate Summary — ${fmtDate(draft.createdAt)}</div>
  </div>

  <div class="section">
    <h2>Estimate Details</h2>
    <div class="info-grid">
      <div class="info-item"><span class="label">Name:</span> <span class="value">${draft.bundleName}</span></div>
      <div class="info-item"><span class="label">Status:</span> <span class="value">${capitalize(draft.status)}</span></div>
      <div class="info-item"><span class="label">Source:</span> <span class="value">${draft.source ?? "N/A"}</span></div>
      <div class="info-item"><span class="label">Channel:</span> <span class="value">${capitalize(draft.channel ?? "direct")}</span></div>
      <div class="info-item"><span class="label">Region:</span> <span class="value">${draft.region ?? "N/A"}</span></div>
      <div class="info-item"><span class="label">Finish Level:</span> <span class="value">${capitalize(draft.finishLevel ?? "standard")}</span></div>
    </div>
  </div>

  <div class="section">
    <h2>Financial Summary</h2>
    <table class="info-table">
      <tr><td class="label">Subtotal Cost</td><td>${fmtCurrency(String(draft.subtotalCost ?? "0"))}</td></tr>
      <tr><td class="label">Subtotal Price</td><td>${fmtCurrency(String(draft.subtotalPrice ?? "0"))}</td></tr>
      <tr><td class="label">Gross Profit</td><td>${fmtCurrency(String(draft.grossProfit ?? "0"))}</td></tr>
      <tr><td class="label">Gross Profit %</td><td>${fmtPct(String(draft.grossProfitPct ?? "0"))}</td></tr>
      <tr><td class="label">Discount</td><td>${fmtPct(String(draft.discountApplied ?? false))} (${fmtCurrency(String(draft.discountAmount ?? "0"))})</td></tr>
    </table>
    <table>
      <tr class="total-row">
        <td>TOTAL PRICE</td>
        <td class="right">${fmtCurrency(String(draft.finalTotalPrice ?? "0"))}</td>
      </tr>
    </table>
    <div style="margin-top: 8px;">
      <span class="shield ${draft.profitShieldPassed ? "passed" : "failed"}">
        Profit Shield: ${draft.profitShieldPassed ? "PASSED" : "FAILED"} (min ${draft.profitShieldMinPct ?? "35.00"}%)
      </span>
    </div>
  </div>

  ${
    assemblies.length > 0
      ? `<div class="section">
    <h2>Assembly Selections (${assemblies.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Assembly</th>
          <th>Category</th>
          <th class="center">Qty</th>
          <th class="right">Unit Cost</th>
          <th class="right">Unit Price</th>
          <th class="right">Ext. Price</th>
          <th class="right">GP %</th>
        </tr>
      </thead>
      <tbody>
        ${assemblyRows}
      </tbody>
    </table>
  </div>`
      : ""
  }

  ${
    lineItems.length > 0
      ? `<div class="section">
    <h2>Line Items (${lineItems.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Group</th>
          <th class="center">Qty</th>
          <th>Unit</th>
          <th class="right">Unit Price</th>
          <th class="right">Line Total</th>
          <th class="right">GP %</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemRows}
      </tbody>
    </table>
  </div>`
      : ""
  }

  ${provenanceSection}

  ${
    draft.notes
      ? `<div class="section">
    <h2>Notes</h2>
    <div class="notes">${draft.notes}</div>
  </div>`
      : ""
  }

  <div class="footer">
    structr.ai — Charleston, SC — Estimate #EST-${String(draft.id).padStart(5, "0")} — 
    Pricing Schema v${draft.pricingSchemaVersion ?? "1.0"} — Generated ${new Date().toISOString()}
  </div>
</body>
</html>`;

  return { html, title };
}
