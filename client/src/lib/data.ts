// structr.ai - Mock Data & Business Logic
// Design: structr.ai — Dark Mode + Gold Accents

export interface Assembly {
  name: string;
  code: string;
  directCost: number;
  sellPrice: number;
  crewHours: number;
  unit: string;
  items: number;
}

export interface AssemblyGroup {
  name: string;
  assemblies: Assembly[];
}

export const ASSEMBLIES: AssemblyGroup[] = [
  {
    name: "01 - Permits & General Conditions",
    assemblies: [
      { name: "Building Permit Package", code: "ASM-0101", directCost: 4850, sellPrice: 7200, crewHours: 0, unit: "EA", items: 12 },
    ],
  },
  {
    name: "03 - Concrete & Foundation",
    assemblies: [
      { name: "Concrete Patio 12x12", code: "ASM-0301", directCost: 2340, sellPrice: 3900, crewHours: 16, unit: "EA", items: 8 },
      { name: "Foundation Repair (Pier System)", code: "ASM-0302", directCost: 5200, sellPrice: 8500, crewHours: 24, unit: "EA", items: 6 },
    ],
  },
  {
    name: "06 - Framing & Carpentry",
    assemblies: [
      { name: "Standard Deck 10x12 (Wood)", code: "ASM-0601", directCost: 3200, sellPrice: 5400, crewHours: 24, unit: "EA", items: 14 },
      { name: "Wood Privacy Fence 6ft (per LF)", code: "ASM-0602", directCost: 28.5, sellPrice: 47, crewHours: 0.15, unit: "LF", items: 7 },
    ],
  },
  {
    name: "07 - Roofing & Waterproofing",
    assemblies: [
      { name: "Full Roof Replacement (Architectural)", code: "ASM-0701", directCost: 8500, sellPrice: 14200, crewHours: 32, unit: "SQ", items: 11 },
      { name: "Gutter Installation (per LF)", code: "ASM-0702", directCost: 8.5, sellPrice: 15, crewHours: 0.08, unit: "LF", items: 5 },
    ],
  },
  {
    name: "08 - Exterior Enclosure",
    assemblies: [
      { name: "Vinyl Siding Replacement", code: "ASM-0801", directCost: 4.8, sellPrice: 8.5, crewHours: 0.06, unit: "SF", items: 9 },
      { name: "Window Replacement (per Window)", code: "ASM-0802", directCost: 485, sellPrice: 820, crewHours: 3, unit: "EA", items: 6 },
    ],
  },
  {
    name: "09 - Interior Finishes",
    assemblies: [
      { name: "Bathroom Remodel (Standard)", code: "ASM-0901", directCost: 8200, sellPrice: 13800, crewHours: 56, unit: "EA", items: 22 },
      { name: "Kitchen Remodel (Standard)", code: "ASM-0902", directCost: 18500, sellPrice: 31000, crewHours: 80, unit: "EA", items: 28 },
      { name: "Drywall Repair/Renovation (per Room)", code: "ASM-0903", directCost: 680, sellPrice: 1150, crewHours: 8, unit: "EA", items: 6 },
    ],
  },
  {
    name: "09B - Flooring",
    assemblies: [
      { name: "Hardwood Floor Installation", code: "ASM-09B1", directCost: 8.5, sellPrice: 14.5, crewHours: 0.05, unit: "SF", items: 7 },
      { name: "LVP Flooring Installation", code: "ASM-09B2", directCost: 5.2, sellPrice: 9, crewHours: 0.04, unit: "SF", items: 6 },
    ],
  },
  {
    name: "09C - Painting",
    assemblies: [
      { name: "Interior Painting (per Room)", code: "ASM-09C1", directCost: 420, sellPrice: 720, crewHours: 6, unit: "EA", items: 5 },
      { name: "Exterior Painting (Full House)", code: "ASM-09C2", directCost: 4800, sellPrice: 8200, crewHours: 40, unit: "EA", items: 8 },
    ],
  },
  {
    name: "16 - Electrical",
    assemblies: [
      { name: "Electrical Panel Upgrade 200A", code: "ASM-1601", directCost: 2800, sellPrice: 4600, crewHours: 12, unit: "EA", items: 7 },
    ],
  },
];

export const PRESET_BUNDLES: Record<string, string[]> = {
  "Kitchen & Bath Combo": [
    "Kitchen Remodel (Standard)",
    "Bathroom Remodel (Standard)",
    "Interior Painting (per Room)",
    "LVP Flooring Installation",
  ],
  "Full Exterior Package": [
    "Full Roof Replacement (Architectural)",
    "Vinyl Siding Replacement",
    "Exterior Painting (Full House)",
    "Gutter Installation (per LF)",
    "Window Replacement (per Window)",
  ],
  "General Restoration": [
    "Drywall Repair/Renovation (per Room)",
    "Interior Painting (per Room)",
    "Hardwood Floor Installation",
    "Electrical Panel Upgrade 200A",
  ],
};

export const MIN_GROSS_PROFIT = 35.0;

// ── Helper Functions ──

export function getAllAssemblyNames(): string[] {
  return ASSEMBLIES.flatMap((g) => g.assemblies.map((a) => a.name));
}

export function getAssemblyByName(name: string): Assembly | undefined {
  for (const group of ASSEMBLIES) {
    const found = group.assemblies.find((a) => a.name === name);
    if (found) return found;
  }
  return undefined;
}

export function calcGrossProfit(sell: number, cost: number): number {
  if (sell <= 0) return 0;
  return ((sell - cost) / sell) * 100;
}

export function fmtCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export interface DiscountResult {
  appliedDiscount: number;
  finalSell: number;
  wasAdjusted: boolean;
}

export function autoAdjustDiscount(
  totalCost: number,
  totalSell: number,
  requestedDiscount: number
): DiscountResult {
  const discountedSell = totalSell * (1 - requestedDiscount / 100);
  const gp = calcGrossProfit(discountedSell, totalCost);

  if (gp >= MIN_GROSS_PROFIT) {
    return { appliedDiscount: requestedDiscount, finalSell: discountedSell, wasAdjusted: false };
  }

  // Auto-adjust: find max discount that maintains 35% GP
  const minSell = totalCost / (1 - MIN_GROSS_PROFIT / 100);
  const maxDiscount = Math.max(0, ((totalSell - minSell) / totalSell) * 100);
  const adjustedSell = totalSell * (1 - maxDiscount / 100);

  return { appliedDiscount: maxDiscount, finalSell: adjustedSell, wasAdjusted: true };
}

export function generateJobTreadCSV(
  selectedAssemblies: Assembly[],
  appliedDiscount: number
): string {
  const headers = [
    "Cost Group Name",
    "Cost Item Name",
    "Description",
    "Quantity",
    "Unit",
    "Unit Cost",
    "Unit Price",
    "Cost Type",
    "Taxable",
  ];

  const rows = selectedAssemblies.map((asm) => [
    asm.code.split("-")[0] || "",
    asm.name,
    `Bundle assembly: ${asm.name}`,
    "1",
    asm.unit,
    asm.directCost.toFixed(2),
    (asm.sellPrice * (1 - appliedDiscount / 100)).toFixed(2),
    "Subcontractor",
    "No",
  ]);

  return [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
}
