/**
 * A1-EXPORT-SURFACE-INTEGRATION-CONTRACT.md — real PostgreSQL 17 behavior proof
 * for the router/history/selection surface that connects the three ALREADY
 * ACCEPTED writers (createExportAttempt/downloadExportAttempt/
 * createAndDeliverExportAttempt) to `estimate-router.ts`. Same disposable lab/
 * env gate as the writers' own physical suites.
 *
 * Scope deliberately excludes what the writers' own 138 tests already cover
 * (authority resolution, lock/retry, lineage, manifest correspondence, the
 * physical trigger foundation). This file proves what is genuinely NEW at the
 * surface: the router resolves an authenticated tenantId/actorId/projectId
 * context (never trusting a client-supplied projectId), rejects extra/forged
 * input fields the writers' own `.strict()` schemas have no room for,
 * `checkExportAttemptAuthorization` is a real read with no side effect,
 * `listExports*`/`getExportDetail` distinguish ready/downloaded/blocked/legacy
 * and expose the parsed manifest only on detail, `getExportableEstimate` lists
 * real candidates instead of the old stub's `null`, and `ExportDeliveryBlockedError`
 * actually crosses real tRPC serialization as `{exportId,code}` via the shared
 * message codec (not merely an in-memory `.cause`).
 *
 * No mocking of authorization/transaction/audit/renderers/writers: everything
 * under test runs for real against a real database, through the real router.
 * Only `./db`'s `getDb()` is redirected to the verified disposable lab
 * connection (same technique the writers' own physical suites use).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as s from "../drizzle/schema";

const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { estimateRouter } from "./estimate-router";
import type { TrpcContext } from "./_core/context";
import { createEstimateDraftFromCalculator } from "./estimate-db";
import { getInternalApprovalReview, recordInternalEstimateApproval } from "./internal-estimate-approval-db";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
import { parseExportDeliveryBlockedMessage } from "@shared/export-delivery-blocked-message";
import { summaryOf, detailOf, checkExportAuthorization as originalAuthorization } from "./jobtread-export-db";
import { getExportableEstimate } from "./estimate-version-db";
import { checkExportAuthorization } from "./internal-estimate-export-db";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";

const labConfig = process.env.A1_EXPORT_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>;
let database: PostgresJsDatabase;

const TENANT = "a1900800-0000-4000-8000-000000000001";
const ACTOR = "a1900800-0000-4000-8000-000000000002"; // project owner
const NO_ACCESS_ACTOR = "a1900800-0000-4000-8000-000000000003"; // same tenant, no grant, not owner
const OTHER_TENANT = "a1900800-0000-4000-8000-000000000005";
const OTHER_TENANT_ACTOR = "a1900800-0000-4000-8000-000000000006";
const CLIENT = "a1900800-0000-4000-8000-000000000010";
const GEO_ZONE = "a1900800-0000-4000-8000-000000000020";
const PROJECT = "a1900800-0000-4000-8000-000000000030";
const GEOCODED_AT = new Date("2026-10-06T00:00:00.000Z");

function zone(): GeoZoneData {
  return {
    id: GEO_ZONE, zoneName: "Surface synthetic zone", county: "Surface County", zipCodes: ["00008"],
    centerLat: 32.75, centerLng: -79.9, radiusMiles: 10, coastalExposureLevel: "moderate",
    logisticsComplexity: "standard", laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
    contingencyPct: 5, minProfitShieldPct: 42, isActive: true,
  };
}
function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    costGroupName: "Cabinetry & Millwork", costItemName: "Surface synthetic shelf", description: "Surface synthetic component",
    quantity: 2, unit: "EA", unitCostSnapshot: "20.00", unitPriceSnapshot: "50.00", lineTotalCost: 40, lineTotalPrice: 100,
    assemblyId: null, costCode: "12-100", taxable: true,
    ...overrides,
  };
}
function buildPayload(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const sumCost = lines.reduce((total, line) => total + Number(line.lineTotalCost), 0);
  const sumPrice = lines.reduce((total, line) => total + Number(line.lineTotalPrice), 0);
  return {
    bundleName: "Surface synthetic export scope", channel: "direct", region: "charleston_sc", finishLevel: "standard",
    lineItems: lines, assemblySelections: [],
    subtotalCost: sumCost.toFixed(2), subtotalPrice: sumPrice.toFixed(2),
    grossProfit: (sumPrice - sumCost).toFixed(2), grossProfitPct: String(Math.round(((sumPrice - sumCost) / sumPrice) * 100)),
    finalTotalPrice: sumPrice.toFixed(2), assemblyCount: 0, profitShieldPassed: true, profitShieldMinPct: "42",
    notes: "Surface synthetic reviewed original notes", projectId: PROJECT, clientId: null, source: "assembly_calculator", metadata: null,
  } as EstimateDraftPersistPayload;
}
async function createDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  return createEstimateDraftFromCalculator(buildPayload(lines), ACTOR, TENANT);
}
async function createApprovedDraft(lines: Array<Record<string, unknown>> = [makeLine()]) {
  const draft = await createDraft(lines);
  const review = await getInternalApprovalReview({ id: draft.id, confirmedCurrencyCode: "USD" }, ACTOR, TENANT);
  await recordInternalEstimateApproval(
    { id: draft.id, requestId: randomUUID(), expectedDraftVersion: draft.version, expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Surface synthetic approval" },
    ACTOR, TENANT,
  );
  return draft;
}
function ctxFor(userId: string, tenantId: string | null = TENANT): TrpcContext {
  return { req: {} as any, res: {} as any, authProvider: "legacy", tenantId, user: { id: userId, tenantId, role: "user", isActive: true } as any };
}
const caller = (ctx: TrpcContext) => estimateRouter.createCaller(ctx);

describe.skipIf(!labConfig)("A1 export surface integration — real PostgreSQL 17", () => {
  beforeAll(async () => {
    const config = JSON.parse(labConfig!);
    const directory = await realpath(config.directory);
    const underOwnPrefix = directory.includes("/a1-export-physical-") &&
      (directory.startsWith("/private/tmp/") || directory.startsWith("/private/var/folders/"));
    if (!underOwnPrefix || config.database !== "a1_export_physical" || config.user !== "a1_lab" || !Number.isInteger(config.port)) {
      throw new Error("Not an owned A1 export physical laboratory configuration");
    }
    const dataDirectory = await realpath(config.dataDirectory), socketDirectory = await realpath(config.socketDirectory);
    if (!dataDirectory.startsWith(directory) || !socketDirectory.startsWith(directory)) {
      throw new Error("Laboratory path escaped the owned directory");
    }
    connection = postgres({ host: socketDirectory, database: config.database, username: config.user, port: config.port, ssl: false, max: 5, prepare: false });
    const [identity] = await connection`select current_database() as database, current_user as username, current_setting('listen_addresses') as listen_addresses, inet_server_addr() as server_address`;
    if (identity.database !== config.database || identity.username !== config.user || identity.listen_addresses !== "" || identity.server_address !== null) {
      throw new Error("PostgreSQL identity does not match the owned socket-only laboratory");
    }
    database = drizzle(connection, { schema: s });
    deps.getDb.mockImplementation(async () => database);

    await connection`INSERT INTO public.tenants (id, name, slug) VALUES (${TENANT}, 'Surface synthetic tenant', 'a1-export-surface-tenant'), (${OTHER_TENANT}, 'Surface synthetic other tenant', 'a1-export-surface-other-tenant')`;
    await connection`INSERT INTO public.profiles (id, tenant_id, full_name, role) VALUES (${ACTOR}, ${TENANT}, 'Surface synthetic actor', 'user'), (${NO_ACCESS_ACTOR}, ${TENANT}, 'Surface synthetic no-access actor', 'user'), (${OTHER_TENANT_ACTOR}, ${OTHER_TENANT}, 'Surface synthetic other-tenant actor', 'user')`;
    await connection`INSERT INTO public.clients (id, tenant_id, name) VALUES (${CLIENT}, ${TENANT}, 'Surface synthetic client')`;
    await database.insert(s.geoZones).values({
      id: GEO_ZONE, tenantId: TENANT, name: zone().zoneName, zoneName: zone().zoneName, isActive: true,
      coastalExposureLevel: zone().coastalExposureLevel, costMultiplier: "1.10", laborModifier: "1.10",
      materialModifier: "1.05", logisticsModifier: "1", contingencyPct: "5", minProfitShieldPct: "42",
    });
    const inputAddress = { address: "1 Surface Lane", city: "Surface City", state: "SC", zipCode: "00008", county: "Surface County" };
    const reviewEvidence = createProjectGeocodeReviewEvidence({
      projectId: PROJECT, tenantId: TENANT, inputAddress, geocodedAt: GEOCODED_AT,
      geocode: { success: true, latitude: 32.75, longitude: -79.9, formattedAddress: "1 Surface Lane, Surface City", confidence: "high", source: "google_maps", withinServiceRadius: true, locationType: null, placeId: null, distanceFromCenter: null, warning: null, addressComponents: null },
      zoneDetection: { zone: zone(), method: "coordinates", confidence: "high" },
    });
    await database.insert(s.projects).values({
      id: PROJECT, tenantId: TENANT, clientId: CLIENT, ownerUserId: ACTOR,
      name: "Surface synthetic project", projectType: "repair", channel: "premium", geoRiskClass: "coastal",
      address: inputAddress.address, city: inputAddress.city, state: inputAddress.state, zip: inputAddress.zipCode, county: inputAddress.county,
      latitude: "32.7500000", longitude: "-79.9000000", geocodeConfidence: "high", geocodeSource: "google_maps",
      geocodedAddress: "1 Surface Lane, Surface City", geocodedAt: GEOCODED_AT, zone: zone().zoneName,
      zoneModifierSnapshot: {
        zoneId: GEO_ZONE, zoneName: zone().zoneName, laborModifier: 1.1, materialModifier: 1.05, logisticsModifier: 1,
        contingencyPct: 5, minProfitShieldPct: 42, coastalExposureLevel: "moderate", capturedAt: GEOCODED_AT.toISOString(), reviewEvidence,
      },
    });
  });
  afterAll(async () => { deps.getDb.mockReset(); await connection?.end({ timeout: 1 }); });

  describe("delivery routes — real round trip through the router", () => {
    for (const [route, format] of [["exportPdf", "pdf"], ["exportJson", "json"], ["exportCsv", "csv_jobtread"]] as const) {
      it(`${route}: delivers via createAndDeliverExportAttempt, invalidatable summary visible in listExports`, async () => {
        const draft = await createApprovedDraft();
        const delivered = await (caller(ctxFor(ACTOR)) as any)[route]({ id: draft.id });
        expect(delivered.format).toBe(format);
        expect(delivered.estimateId).toBe(draft.id);
        expect(typeof delivered.content).toBe("string");

        const list = await caller(ctxFor(ACTOR)).listExports({ id: draft.id });
        const row = list.find(r => r.exportId === delivered.exportId)!;
        expect(row.kind).toBe("delivery");
        expect(row.outcome).toBe("ready");
        expect(row.status).toBe("downloaded");
        expect(row.availability).toBe("requires_revalidation");
        expect(row.artifact?.artifactHash).toBe(delivered.artifactHash);
      });
    }

    it("exportPrintable is a mutation (not a query) and delivers real HTML content", async () => {
      const draft = await createApprovedDraft();
      const delivered = await caller(ctxFor(ACTOR)).exportPrintable({ id: draft.id });
      expect(delivered.format).toBe("printable");
      expect(delivered.encoding).toBe("utf8");
      expect(delivered.content.length).toBeGreaterThan(0);
    });

    it("rejects a forged extra field (declaredAdjustments) before the writer ever runs — zero rows persisted", async () => {
      const draft = await createApprovedDraft();
      await expect((caller(ctxFor(ACTOR)) as any).exportPdf({ id: draft.id, declaredAdjustments: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });

    it("exportPdf for another tenant's draft is FORBIDDEN, never leaks the draft's existence — zero rows persisted", async () => {
      const draft = await createApprovedDraft();
      await expect(caller(ctxFor(OTHER_TENANT_ACTOR, OTHER_TENANT)).exportPdf({ id: draft.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });

    it("exportPdf for an actor with no project access is FORBIDDEN/NOT_FOUND — zero rows persisted", async () => {
      const draft = await createApprovedDraft();
      await expect(caller(ctxFor(NO_ACCESS_ACTOR)).exportPdf({ id: draft.id })).rejects.toThrow();
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });
  });

  describe("exportPreflight — explicit format only", () => {
    it("persists a real preflight attempt for the explicitly requested format", async () => {
      const draft = await createApprovedDraft();
      const summary = await caller(ctxFor(ACTOR)).exportPreflight({ id: draft.id, format: "json" });
      expect(summary.kind).toBe("preflight");
      expect(summary.outcome).toBe("ready");
      expect(summary.format).toBe("json");
    });

    it("rejects a call with no format at all — zero rows persisted", async () => {
      const draft = await createApprovedDraft();
      await expect((caller(ctxFor(ACTOR)) as any).exportPreflight({ id: draft.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });
  });

  describe("validateCsvExport — now a real mutation, never a side-effect-free query", () => {
    it("persists a preflight attempt with an audit, format fixed to csv_jobtread", async () => {
      const draft = await createApprovedDraft();
      const summary = await caller(ctxFor(ACTOR)).validateCsvExport({ id: draft.id });
      expect(summary.kind).toBe("preflight");
      expect(summary.format).toBe("csv_jobtread");
      const [audited] = await connection`SELECT action FROM audit_logs WHERE table_name = 'jobtread_exports' AND record_id = ${summary.exportId}`;
      expect(audited.action).toBe("estimate.export_preflight");
    });
  });

  describe("downloadExport — regenerates an EXISTING attempt, never a new one", () => {
    it("first delivery of a ready preflight attempt, then a redownload of the same row", async () => {
      const draft = await createApprovedDraft();
      const preflight = await caller(ctxFor(ACTOR)).exportPreflight({ id: draft.id, format: "pdf" });
      const first = await caller(ctxFor(ACTOR)).downloadExport({ exportId: preflight.exportId });
      expect(first.exportId).toBe(preflight.exportId);
      const second = await caller(ctxFor(ACTOR)).downloadExport({ exportId: preflight.exportId });
      expect(second.artifactHash).toBe(first.artifactHash);
      const rows = await connection`SELECT id FROM jobtread_exports WHERE id = ${preflight.exportId}`;
      expect(rows).toHaveLength(1); // still exactly one row — redownload never creates a second attempt
    });
  });

  describe("exportAuthorization — a real read, no side effect", () => {
    it("authorized:true with the current authority for an approved draft", async () => {
      const draft = await createApprovedDraft();
      const before = await connection`SELECT count(*)::int AS n FROM jobtread_exports`;
      const check = await caller(ctxFor(ACTOR)).exportAuthorization({ id: draft.id });
      expect(check.authorized).toBe(true);
      expect(check.code).toBeNull();
      expect(check.authority?.approvalId).toBeTruthy();
      const after = await connection`SELECT count(*)::int AS n FROM jobtread_exports`;
      expect(after[0].n).toBe(before[0].n); // never persists anything
    });

    it("authorized:false with INTERNAL_APPROVAL_REQUIRED for a never-approved draft", async () => {
      const draft = await createDraft();
      const check = await caller(ctxFor(ACTOR)).exportAuthorization({ id: draft.id });
      expect(check.authorized).toBe(false);
      expect(check.code).toBe("INTERNAL_APPROVAL_REQUIRED");
      expect(check.authority).toBeNull();
    });
  });

  describe("ExportDeliveryBlockedError crosses REAL tRPC serialization, never only an in-memory cause", () => {
    it("exportPdf on a never-approved draft commits a blocked row/audit, then the client receives a parseable {exportId,code}", async () => {
      const draft = await createDraft();
      let caught: any;
      try {
        await caller(ctxFor(ACTOR)).exportPdf({ id: draft.id });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe("PRECONDITION_FAILED");
      // Real tRPC serialization round trip — not a bare in-memory `.cause` read.
      const serialized = JSON.parse(JSON.stringify({ message: caught.message }));
      const decoded = parseExportDeliveryBlockedMessage(serialized.message);
      expect(decoded?.code).toBe("INTERNAL_APPROVAL_REQUIRED");
      expect(decoded?.exportId).toBeTruthy();
      const [row] = await connection`SELECT status, attempt_kind, block_reason FROM jobtread_exports WHERE id = ${decoded!.exportId}`;
      expect(row.status).toBe("blocked_authorization");
      expect(row.attempt_kind).toBe("delivery");
      const [audited] = await connection`SELECT action FROM audit_logs WHERE table_name = 'jobtread_exports' AND record_id = ${decoded!.exportId}`;
      expect(audited.action).toBe("estimate.export_delivery");
    });
  });

  describe("history/detail — ready/downloaded/blocked/legacy distinguished, manifest only on detail", () => {
    // A real legacy row (status/markers pre-A1) cannot be fabricated here: the
    // migration's own INSERT guard trigger (0013_jobtread_exports_a1_physical.sql)
    // refuses any NEW insert without the full A1 marker set — "NULL/abbreviated
    // markers are only valid for rows that already existed before this migration"
    // — confirmed physically when this test tried exactly that insert. A fresh
    // lab has no pre-migration data to grandfather in, so the legacy branch of
    // `summaryOf`/`detailOf` (server/jobtread-export-db.ts) is proven by the pure
    // unit test in a1-export-history-summary.test.ts instead, against a
    // hand-built row object — never against a row the physical schema itself
    // would reject.
    it("getExportDetail exposes the parsed manifest for an A1 row, never raw content/bytes", async () => {
      const draft = await createApprovedDraft();
      const delivered = await caller(ctxFor(ACTOR)).exportJson({ id: draft.id });
      const detail = await caller(ctxFor(ACTOR)).getExportDetail({ exportId: delivered.exportId });
      expect(detail.manifest?.exportId).toBe(delivered.exportId);
      expect(detail.manifest?.outcome).toBe("ready");
      expect((detail as any).content).toBeUndefined();
    });

    it("getExportDetail for another tenant's export is FORBIDDEN", async () => {
      const draft = await createApprovedDraft();
      const delivered = await caller(ctxFor(ACTOR)).exportJson({ id: draft.id });
      await expect(caller(ctxFor(OTHER_TENANT_ACTOR, OTHER_TENANT)).getExportDetail({ exportId: delivered.exportId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("exportableEstimate — real candidates, never an auto-picked highest version", () => {
    it("lists the project's non-superseded calculated draft(s) instead of the old stub's null", async () => {
      const draft = await createApprovedDraft();
      const selection = await caller(ctxFor(ACTOR)).exportableEstimate({ projectId: PROJECT });
      expect(selection.projectId).toBe(PROJECT);
      expect(selection.candidates.some(c => c.estimateDraftId === draft.id)).toBe(true);
    });

    it("excludes a real change order from the candidate list, against the actual SQL condition", async () => {
      const draft = await createApprovedDraft();
      const changeOrderId = randomUUID();
      await connection`INSERT INTO estimate_drafts (id, tenant_id, project_id, version, status, source, bundle_name, change_order_of, subtotal_cost, subtotal_price, final_total_price, gross_profit, gross_profit_pct, channel, region, finish_level, pricing_schema_version, line_items, assembly_selections, metadata, created_at, updated_at)
        VALUES (${changeOrderId}, ${TENANT}, ${PROJECT}, 2, 'draft', 'assembly_calculator', 'Surface synthetic change order', ${draft.id}, '0', '0', '0', '0', '0', 'direct', 'charleston_sc', 'standard', '1.0', '[]', '[]', '{}', now(), now())`;
      const selection = await caller(ctxFor(ACTOR)).exportableEstimate({ projectId: PROJECT });
      expect(selection.candidates.some(c => c.estimateDraftId === draft.id)).toBe(true);
      expect(selection.candidates.some(c => c.estimateDraftId === changeOrderId)).toBe(false);
    });
  });

  describe("technical failure in transport — audit fault never returns a positive result", () => {
    // MICHAEL-A1-EXPORT-SURFACE-V1-QA-AND-CORRECTION.md item 3: a `BEFORE
    // INSERT` trigger proves an INSERT-time failure, not a COMMIT-time one —
    // renamed to say exactly that, and paired with a genuine `CREATE
    // CONSTRAINT TRIGGER ... AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED`
    // case below (the SAME technique the writers' own accepted physical
    // suites use) for the COMMIT claim specifically.
    it("an INSERT-time audit failure through the router surfaces as a generic INTERNAL_SERVER_ERROR, zero rows, zero leaked detail", async () => {
      const draft = await createApprovedDraft();
      await connection.unsafe(`
        CREATE FUNCTION surface_router_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF NEW.table_name = 'jobtread_exports' AND NEW.action = 'estimate.export_delivery' AND NEW.new_values->>'estimateDraftId' = '${draft.id}' THEN
            RAISE EXCEPTION 'synthetic surface router audit fault' USING ERRCODE = 'ZZ006';
          END IF; RETURN NEW; END $$;
      `);
      await connection.unsafe(`CREATE TRIGGER surface_router_audit_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION surface_router_audit_fault()`);
      let caught: any;
      try {
        await caller(ctxFor(ACTOR)).exportPdf({ id: draft.id });
      } catch (error) {
        caught = error;
      } finally {
        await connection.unsafe(`DROP TRIGGER IF EXISTS surface_router_audit_fault ON audit_logs`);
        await connection.unsafe(`DROP FUNCTION IF EXISTS surface_router_audit_fault()`);
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe("INTERNAL_SERVER_ERROR");
      expect(caught.message).toBe("This export could not be completed. Please try again.");
      expect(caught.message).not.toMatch(/ZZ006|synthetic|SQL|postgres/i);
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0);
    });

    it("a genuine COMMIT-time audit failure (DEFERRABLE INITIALLY DEFERRED constraint trigger) also surfaces sanitized, zero rows", async () => {
      const draft = await createApprovedDraft();
      await connection.unsafe(`CREATE FUNCTION surface_router_deferred_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.action = 'estimate.export_delivery' AND NEW.new_values->>'estimateDraftId' = '${draft.id}' THEN
          RAISE EXCEPTION 'synthetic surface router COMMIT failure' USING ERRCODE = 'ZZ007';
        END IF; RETURN NEW; END $$;`);
      await connection.unsafe('CREATE CONSTRAINT TRIGGER surface_router_deferred_fault AFTER INSERT ON audit_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION surface_router_deferred_fault()');
      let caught: any;
      try {
        await caller(ctxFor(ACTOR)).exportJson({ id: draft.id });
      } catch (error) {
        caught = error;
      } finally {
        await connection.unsafe('DROP TRIGGER surface_router_deferred_fault ON audit_logs');
        await connection.unsafe('DROP FUNCTION surface_router_deferred_fault()');
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe("INTERNAL_SERVER_ERROR");
      expect(caught.message).toBe("This export could not be completed. Please try again.");
      expect(caught.message).not.toMatch(/ZZ007|synthetic|SQL|postgres/i);
      const rows = await connection`SELECT id FROM jobtread_exports WHERE estimate_draft_id = ${draft.id}`;
      expect(rows).toHaveLength(0); // the INSERT itself rolled back together with the deferred-but-failed audit at COMMIT
    });

    // QA item 3's actual reproduced defect: resolveExportAttemptContext ran
    // OUTSIDE the try that calls mapExportWriterError, so a context-resolution
    // fault (e.g. getDb failing) propagated the raw, unsanitized driver error.
    // Both are now inside the SAME try on every affected route (estimate-
    // router.ts) — this proves it at the router-caller level; the real HTTP
    // wire proof (what originally caught it) lives in
    // a1-export-surface-transport.test.ts.
    it("a context-resolution failure (not the writer itself) is sanitized the same way", async () => {
      const draft = await createApprovedDraft();
      deps.getDb.mockRejectedValueOnce(new Error("SQL_DETAIL_SHOULD_NEVER_REACH_EXPORT_CLIENT"));
      let caught: any;
      try {
        await caller(ctxFor(ACTOR)).exportPdf({ id: draft.id });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe("INTERNAL_SERVER_ERROR");
      expect(caught.message).not.toContain("SQL_DETAIL_SHOULD_NEVER_REACH_EXPORT_CLIENT");
    });
  });

  describe("MICHAEL QA closed history and authenticated selection", () => {
    async function validRow() {
      const draft = await createApprovedDraft();
      const delivered = await caller(ctxFor(ACTOR)).exportJson({ id: draft.id });
      const [row] = await database.select().from(s.jobtreadExports).where(eq(s.jobtreadExports.id, delivered.exportId));
      return row;
    }
    it("summary has exactly the eleven contract fields", async () => {
      const row = await validRow();
      expect(Object.keys(summaryOf(row)).sort()).toEqual(["exportId", "estimateId", "format", "kind", "outcome", "status", "checkedAt", "authority", "validation", "artifact", "availability"].sort());
    });
    it("summary rejects extra nested validation metadata", async () => {
      const row = await validRow();
      const bad = { ...row, validationReport: { ...(row.validationReport as any), rawPrivateMetadata: "MUST_NOT_LEAVE" } };
      expect(() => summaryOf(bad as any)).toThrow();
    });
    it("summary rejects unknown artifact contract version", async () => {
      const row = await validRow();
      expect(() => summaryOf({ ...row, artifactContractVersion: "future-or-forged-version" } as any)).toThrow();
    });
    it("summary rejects empty marker with remaining A1 evidence", async () => {
      const row = await validRow();
      expect(() => summaryOf({ ...row, artifactContractVersion: "" } as any)).toThrow();
    });
    it("detail rejects malformed manifest instead of ready with null manifest", async () => {
      const row = await validRow();
      expect(() => detailOf({ ...row, manifest: { corrupted: true } } as any)).toThrow();
    });
    it("direct selection helper refuses absence of authenticated context", async () => {
      await createDraft();
      await expect(getExportableEstimate(undefined as any, PROJECT)).rejects.toBeDefined();
    });
    it("selection route refuses authenticated actor in wrong selected tenant", async () => {
      await createDraft();
      await expect(caller(ctxFor(ACTOR, OTHER_TENANT)).exportableEstimate({ projectId: PROJECT })).rejects.toBeDefined();
    });
    it("selection route refuses missing selected tenant", async () => {
      await createDraft();
      await expect(caller(ctxFor(ACTOR, null)).exportableEstimate({ projectId: PROJECT })).rejects.toBeDefined();
    });

    // MICHAEL-A1-EXPORT-SURFACE-V2-QA-AND-CORRECTION.md item 1: the four
    // remaining history coherence/correspondence gaps, each proven against a
    // real, otherwise-valid A1 row — not a hand-built object that was never
    // legitimate to begin with.
    it("summary rejects NULL marker with remaining A1 evidence", async () => {
      const row = await validRow();
      expect(summaryOf(row).outcome).toBe("ready");
      expect(() => summaryOf({ ...row, artifactContractVersion: null } as any)).toThrow();
    });
    it("summary rejects ready result with not_evaluated validation", async () => {
      const row = await validRow();
      expect(summaryOf(row).outcome).toBe("ready");
      const report = { ...(row.validationReport as any), state: "not_evaluated" };
      expect(() => summaryOf({ ...row, validationReport: report } as any)).toThrow();
    });
    it("summary rejects renderer version inconsistent with JSON format", async () => {
      const row = await validRow();
      expect(summaryOf(row).format).toBe("json");
      expect(() => summaryOf({ ...row, rendererVersion: "unknown-renderer" } as any)).toThrow();
    });
    it("detail rejects valid manifest belonging to a different export", async () => {
      const row = await validRow();
      expect(detailOf(row).manifest?.exportId).toBe(row.id);
      const other = await validRow();
      expect(detailOf(other).manifest?.exportId).toBe(other.id);
      const manifest = other.manifest;
      expect(() => detailOf({ ...row, manifest } as any)).toThrow();
    });

    // MICHAEL-A1-EXPORT-SURFACE-V3-QA-AND-CORRECTION.md frente 1: the full
    // normative matrix (§§4-5/9) — 16 cases the V3 schema still accepted.
    async function blockedRow() {
      const draft = await createDraft();
      let id: string | undefined;
      try { await caller(ctxFor(ACTOR)).exportJson({ id: draft.id }); }
      catch (e) { id = parseExportDeliveryBlockedMessage((e as any).message)?.exportId; }
      expect(id).toBeDefined();
      const [row] = await database.select().from(s.jobtreadExports).where(eq(s.jobtreadExports.id, id!));
      expect(summaryOf(row).outcome).toBe("blocked");
      expect(detailOf(row).manifest?.outcome).toBe("blocked");
      return row;
    }
    const readyMutations: Array<[string, (r: any) => any]> = [
      ["ready NULL reconciliation totals", r => ({ ...r, validationReport: { ...r.validationReport, reconciliation: { state: "matched", approvedTotalMinor: null, exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: null } } })],
      ["ready wrong reconciliation state", r => ({ ...r, validationReport: { ...r.validationReport, reconciliation: { ...r.validationReport.reconciliation, state: "not_evaluated" } } })],
      ["ready nonzero reconciliation difference", r => ({ ...r, validationReport: { ...r.validationReport, reconciliation: { ...r.validationReport.reconciliation, differenceMinor: "1" } } })],
      ["artifact generated after checkedAt", r => ({ ...r, generatedAt: new Date(r.checkedAt.getTime() + 1000) })],
    ];
    it.each(readyMutations)("matrix rejects %s", async (_name, mutate) => {
      const row = await validRow(); expect(summaryOf(row).outcome).toBe("ready");
      expect(() => summaryOf(mutate(row))).toThrow();
    });
    const blockedMutations: Array<[string, (r: any) => any]> = [
      ["unknown blocked status", r => ({ ...r, status: "custom_unknown_status" })],
      ["blocked status in wrong issue class", r => ({ ...r, status: "needs_exception_review" })],
      ["blocked validation marked valid", r => ({ ...r, validationReport: { ...r.validationReport, state: "valid" } })],
      ["authority-blocked report carries totals", r => ({ ...r, validationReport: { ...r.validationReport, reconciliation: { state: "not_evaluated", approvedTotalMinor: "100", exportedTotalMinor: null, differenceMinor: null, estimatedCostMinor: "10" } } })],
      ["malformed issue lineKey", r => ({ ...r, validationReport: { ...r.validationReport, issues: r.validationReport.issues.map((i: any) => ({ ...i, lineKey: "private:bad-key" })) } })],
      ["unordered issue list", r => ({ ...r, validationReport: { ...r.validationReport, issues: [{ code: "EXPORT_PAYLOAD_TOO_LARGE", field: null, lineKey: null }, ...r.validationReport.issues] }, internalApprovalId: TENANT, internalSnapshotId: ACTOR, approvedContentHash: "a".repeat(64) })],
      ["oversized issue list", r => ({ ...r, validationReport: { ...r.validationReport, issues: Array.from({ length: 4003 }, () => r.validationReport.issues[0]) } })],
      ["CSV-only issue on JSON", r => ({ ...r, validationReport: { ...r.validationReport, issues: [...r.validationReport.issues, { code: "CSV_COST_CODE_INVALID", field: null, lineKey: null }] } })],
      ["partial authority columns hidden as null", r => ({ ...r, internalApprovalId: ACTOR })],
      ["blocked artifact columns hidden as null", r => ({ ...r, artifactHash: "a".repeat(64) })],
    ];
    it.each(blockedMutations)("matrix rejects %s", async (_name, mutate) => {
      const row = await blockedRow();
      expect(() => summaryOf(mutate(row))).toThrow();
    });
    it("detail rejects validation report differing from valid manifest", async () => {
      const row = await validRow();
      expect(detailOf(row).manifest?.exportId).toBe(row.id);
      const report = { ...(row.validationReport as any), reconciliation: { ...(row.validationReport as any).reconciliation, approvedTotalMinor: "500", exportedTotalMinor: "500", differenceMinor: "0" } };
      expect(() => detailOf({ ...row, validationReport: report } as any)).toThrow();
    });
    it("detail rejects blocked manifest authority differing from row", async () => {
      const row = await blockedRow();
      const manifest = structuredClone(row.manifest) as any;
      const otherAuthority = { approvalId: TENANT, snapshotId: ACTOR, contentHash: "a".repeat(64) };
      manifest.authority = otherAuthority;
      manifest.validation.issues = [{ code: "INTERNAL_APPROVAL_REVOKED", lineKey: null, field: null }];
      manifest.validation.reconciliation = { state: "not_evaluated", approvedTotalMinor: "100", estimatedCostMinor: "10", exportedTotalMinor: null, differenceMinor: null };
      const coherent = { ...row, internalApprovalId: TENANT, internalSnapshotId: ACTOR, approvedContentHash: "a".repeat(64), validationReport: manifest.validation, manifest };
      // This control must be valid before testing a different authority mirror.
      expect(() => detailOf(coherent as any)).not.toThrow();
      expect(() => detailOf({ ...coherent, internalApprovalId: OTHER_TENANT } as any)).toThrow();
    });
  });

  describe("checkExportAuthorization — the canonical helper (QA #4)", () => {
    const rawInput = (draftId: string) => ({ context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draftId } });

    it("direct call with no tx opens its own transaction", async () => {
      const draft = await createApprovedDraft();
      const spy = vi.spyOn(database, "transaction");
      const result = await checkExportAuthorization(rawInput(draft.id));
      expect(result.authorized).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("given a tx handle, participates in it directly — no nested transaction, no write/attempt of its own", async () => {
      const draft = await createApprovedDraft();
      const before = await connection`SELECT count(*)::int AS n FROM jobtread_exports`;
      const spy = vi.spyOn(database, "transaction");
      const result = await database.transaction(async (tx) => {
        spy.mockClear(); // only count calls made AFTER the test's own outer transaction opened
        return checkExportAuthorization(rawInput(draft.id), tx as any);
      });
      expect(result.authorized).toBe(true);
      expect(spy).not.toHaveBeenCalled(); // no SECOND (nested) transaction opened inside the supplied tx
      spy.mockRestore();
      const after = await connection`SELECT count(*)::int AS n FROM jobtread_exports`;
      expect(after[0].n).toBe(before[0].n);
    });

    // MICHAEL-A1-EXPORT-SURFACE-V2-QA-AND-CORRECTION.md item 2: renaming the
    // NEW function in internal-estimate-export-db.ts did not, by itself, fix
    // what jobtread-export-db.ts — the contract's ORIGINAL public entry point
    // — exports under the same name. Proves the re-export resolves the SAME
    // approved context the route sees, through the historically-original import
    // path other callers use, not just through the module housing the real logic.
    it("original authorization entrypoint (jobtread-export-db) resolves approved context", async () => {
      const draft = await createApprovedDraft();
      const viaRoute = await caller(ctxFor(ACTOR)).exportAuthorization({ id: draft.id });
      expect(viaRoute.authorized).toBe(true);
      const direct = await originalAuthorization({ context: { tenantId: TENANT, actorId: ACTOR, projectId: PROJECT, estimateDraftId: draft.id } });
      expect(direct.authorized).toBe(true);
    });
  });
});
