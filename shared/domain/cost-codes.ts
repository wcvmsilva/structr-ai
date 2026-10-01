/**
 * structr.ai Master Cost Codes — validated against the JobTread cost-codes catalog.
 * Each cost code is a string identifier used for backend accounting.
 * This list covers all standard structr.ai construction cost codes.
 *
 * Extracted verbatim from `server/jobtread-csv-export.ts` (same values, same order) so
 * a pure shared module (A1 export engine) can reference the frozen catalog without
 * importing a server module. `jobtread-csv-export.ts` re-exports this constant under
 * its original name; no value changed.
 */
export const VALID_COST_CODES: string[] = [
  // General Conditions
  "01-100", "01-200", "01-300", "01-400", "01-500", "01-600", "01-700", "01-800",
  // Site Work & Excavation
  "02-100", "02-200", "02-300", "02-400", "02-500", "02-600", "02-700",
  // Foundation & Concrete
  "03-100", "03-200", "03-300", "03-400", "03-500", "03-600",
  // Framing & Structural
  "04-100", "04-200", "04-300", "04-400", "04-500", "04-600", "04-700",
  // Exterior Envelope
  "05-100", "05-200", "05-300", "05-400", "05-500", "05-600",
  // Roofing
  "06-100", "06-200", "06-300", "06-400", "06-500",
  // Doors & Windows
  "07-100", "07-200", "07-300", "07-400", "07-500",
  // Insulation & Air Sealing
  "08-100", "08-200", "08-300", "08-400",
  // Drywall & Plaster
  "09-100", "09-200", "09-300", "09-400",
  // Interior Finishes
  "10-100", "10-200", "10-300", "10-400", "10-500",
  // Flooring
  "11-100", "11-200", "11-300", "11-400", "11-500",
  // Cabinetry & Millwork
  "12-100", "12-200", "12-300", "12-400",
  // Painting & Wall Covering
  "13-100", "13-200", "13-300",
  // Appliances & Fixtures
  "14-100", "14-200", "14-300",
  // Plumbing
  "15-100", "15-200", "15-300", "15-400", "15-500",
  // Mechanical (HVAC)
  "16-100", "16-200", "16-300", "16-400", "16-500",
  // Electrical
  "17-100", "17-200", "17-300", "17-400", "17-500", "17-600",
  // Landscaping & Hardscape
  "18-100", "18-200", "18-300", "18-400",
  // Exterior Improvements
  "19-100", "19-200", "19-300", "19-400", "19-500",
  // Permits & Fees
  "20-100", "20-200", "20-300", "20-400",
  // Cleanup & Final
  "21-100", "21-200", "21-300",
  // Specialty / Coastal
  "22-100", "22-200", "22-300", "22-400",
];
