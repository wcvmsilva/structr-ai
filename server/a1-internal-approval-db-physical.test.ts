/**
 * Real A1 writer pipeline in an explicitly owned socket-only PostgreSQL laboratory.
 * Only getDb is redirected to the verified laboratory. Adapter, authorization,
 * audit, hash engine, migrations and transaction operations are the real modules.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { appendFile, readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as s from "../drizzle/schema";
import type { EstimateDraftPersistPayload } from "../shared/estimate-engine";
import type { HistoricalSourceInput } from "../shared/historical-estimate-engine";
import type { GeoZoneData } from "../shared/geo-engine";
import { createProjectGeocodeReviewEvidence } from "./project-geocode-review-evidence";
const deps = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => ({ getDb: deps.getDb }));
import { createEstimateDraftFromCalculator } from "./estimate-db";
import {
  recordHistoricalSource,
  importHistoricalEstimate,
} from "./historical-estimate-db";
import {
  getInternalApprovalReview,
  recordInternalEstimateApproval,
  revokeInternalEstimateApproval,
  getInternalApproval,
  type ApproveCommand,
  type RevokeCommand,
} from "./internal-estimate-approval-db";

const labConfig = process.env.A1_TRANSACTION_PHYSICAL_CONFIG;
let connection: ReturnType<typeof postgres>, database: PostgresJsDatabase;
let tenantId: string,
  actorId: string,
  clientId: string,
  projectId: string,
  zoneId: string,
  assemblyId: string;
const at = new Date("2026-09-01T12:00:00.123Z");

function calculatedPayload(): EstimateDraftPersistPayload {
  return {
    bundleName: "Synthetic physical calculated scope",
    channel: "direct",
    region: "charleston_sc",
    finishLevel: "standard",
    lineItems: [
      {
        costGroupName: "Cabinetry & Millwork",
        costItemName: "Synthetic physical shelf",
        description: "Synthetic component",
        quantity: 2,
        unit: "EA",
        unitCostSnapshot: "20.00",
        unitPriceSnapshot: "50.00",
        lineTotalCost: 40,
        lineTotalPrice: 100,
        assemblyId,
        costCode: "12-100",
        taxable: true,
      },
    ],
    assemblySelections: [
      {
        assemblyId,
        assemblyName: "Synthetic assembly",
        assemblyCode: "SYN-PHYSICAL",
        category: "Synthetic",
        quantity: 2,
        unitCost: 20,
        unitPrice: 50,
        extendedCost: 40,
        extendedPrice: 100,
      },
    ],
    subtotalCost: "40.00",
    subtotalPrice: "100.00",
    grossProfit: "60.00",
    grossProfitPct: "60",
    finalTotalPrice: "100.00",
    assemblyCount: 1,
    profitShieldPassed: true,
    profitShieldMinPct: "42",
    notes: "Synthetic reviewed original notes",
    projectId,
    clientId: null,
    source: "assembly_calculator",
    metadata: null,
  };
}
async function formedAndReviewed() {
  const draft = await createEstimateDraftFromCalculator(
    calculatedPayload(),
    actorId,
    tenantId
  );
  const review = await getInternalApprovalReview(
    { id: draft.id, confirmedCurrencyCode: "USD" },
    actorId,
    tenantId
  );
  const command: ApproveCommand = {
    id: draft.id,
    requestId: randomUUID(),
    expectedDraftVersion: draft.version,
    expectedContentHash: review.contentHash,
    expectedPolicyHash: review.policyHash,
    confirmedCurrencyCode: "USD",
    reason: "Synthetic actual writer review",
  };
  return { draft, review, command };
}
function revocationCommand(
  draftId: string,
  approvalId: string,
  contentHash: string
): RevokeCommand {
  return {
    id: draftId,
    approvalId,
    requestId: randomUUID(),
    expectedContentHash: contentHash,
    reason: "Synthetic actual writer revocation",
  };
}
async function persisted(draftId: string) {
  return {
    draft: (
      await database
        .select()
        .from(s.estimateDrafts)
        .where(eq(s.estimateDrafts.id, draftId))
    )[0],
    snapshots: await database
      .select()
      .from(s.estimateInternalApprovalSnapshots)
      .where(eq(s.estimateInternalApprovalSnapshots.estimateDraftId, draftId)),
    approvals: await database
      .select()
      .from(s.estimateInternalApprovals)
      .where(eq(s.estimateInternalApprovals.estimateDraftId, draftId)),
    revocations: await database
      .select()
      .from(s.estimateInternalApprovalRevocations)
      .where(
        eq(s.estimateInternalApprovalRevocations.estimateDraftId, draftId)
      ),
    audits: await database
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.recordId, draftId)),
  };
}

/** Inject a real database audit failure scoped only to this synthetic actor and action. */
async function rejectAudit(
  action: "estimate.internal_approved" | "estimate.internal_approval_revoked"
) {
  const suffix = randomUUID().replaceAll("-", "");
  const fn = `a1_writer_test_audit_${suffix}`,
    trigger = `a1_writer_test_audit_trigger_${suffix}`;
  await connection.unsafe(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id::text = TG_ARGV[0] AND NEW.action = TG_ARGV[1] THEN
        RAISE EXCEPTION 'Synthetic A1 audit failure' USING ERRCODE='40001';
      END IF;
      RETURN NEW;
    END $$`);
  // Both strings are local constants/generated UUIDs, never application input.
  await connection.unsafe(
    `CREATE TRIGGER ${trigger} BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${fn}('${actorId}','${action}')`
  );
  return async () => {
    await connection.unsafe(
      `DROP TRIGGER IF EXISTS ${trigger} ON public.audit_logs`
    );
    await connection.unsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
  };
}

function historicalSource(): HistoricalSourceInput {
  const raw = {
    version: "historical-raw-line-v1" as const,
    quantity: "1",
    unitPrice: "100.00",
    unitEstimatedCost: null,
    linePrice: "100.00",
    lineEstimatedCost: null,
    taxable: null,
    externalCode: null,
  };
  return {
    requestId: randomUUID(),
    projectId,
    clientId,
    sourceKind: "manual_transcription",
    sourceLabel: "Synthetic physical H1 evidence",
    currencyCode: "USD",
    sourceFileId: null,
    declaredSubtotal: null,
    declaredDiscount: null,
    declaredTax: null,
    declaredTotal: "100.00",
    declaredEstimatedCost: null,
    commercialTermsText: null,
    rawTotals: {
      version: "historical-raw-totals-v1",
      subtotal: null,
      discount: null,
      tax: null,
      total: "100.00",
      estimatedCost: null,
    },
    lines: [
      {
        sourceLineKey: "row-1",
        ordinal: 0,
        description: "Synthetic H1 line",
        quantity: "1",
        unit: "EA",
        unitPrice: "100.00",
        unitEstimatedCost: null,
        linePrice: "100.00",
        lineEstimatedCost: null,
        externalCodeSystem: null,
        externalCode: null,
        taxable: null,
        rawValues: raw,
      },
    ],
  };
}

describe.skipIf(!labConfig)(
  "A1 actual approval writer PostgreSQL pipeline",
  () => {
    beforeAll(async () => {
      if (process.env.DATABASE_URL)
        throw new Error("This laboratory test refuses ambient DATABASE_URL");
      const config = JSON.parse(await readFile(labConfig!, "utf8")) as {
        directory: string;
        dataDirectory: string;
        socketDirectory: string;
        database: string;
        user: string;
        port: number;
      };
      const directory = await realpath(config.directory);
      if (
        !directory.startsWith("/private/tmp/structr-a1-") ||
        directory !== resolve(config.directory) ||
        config.database !== "a1_test" ||
        config.user !== "a1_lab" ||
        !Number.isInteger(config.port)
      )
        throw new Error("Not an owned A1 laboratory configuration");
      const dataDirectory = await realpath(config.dataDirectory),
        socketDirectory = await realpath(config.socketDirectory);
      if (
        !dataDirectory.startsWith(directory + sep) ||
        !socketDirectory.startsWith(directory + sep) ||
        dataDirectory !== resolve(config.dataDirectory) ||
        socketDirectory !== resolve(config.socketDirectory)
      )
        throw new Error("Laboratory path escaped the owned directory");
      connection = postgres({
        host: socketDirectory,
        database: config.database,
        username: config.user,
        port: config.port,
        ssl: false,
        max: 1,
        prepare: false,
      });
      const [identity] =
        await connection`select current_database() as database,current_user as username,current_setting('data_directory') as data_directory,current_setting('unix_socket_directories') as socket_directories,current_setting('listen_addresses') as listen_addresses,current_setting('port') as port,inet_server_addr() as server_address`;
      if (
        identity.database !== config.database ||
        identity.username !== config.user ||
        (await realpath(identity.data_directory)) !== dataDirectory ||
        identity.socket_directories !== socketDirectory ||
        identity.listen_addresses !== "" ||
        Number(identity.port) !== config.port ||
        identity.server_address !== null
      ) {
        throw new Error(
          "PostgreSQL identity does not match the owned socket-only laboratory"
        );
      }
      const present =
        await connection`select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('internal_approval_draft_matches_v1','internal_approval_valid_snapshot_v1')`;
      if (present.length !== 2)
        throw new Error("The frozen A1 migration has not been applied");
      database = drizzle(connection);
      deps.getDb.mockImplementation(async () => database);
    }, 30000);
    afterAll(async () => {
      deps.getDb.mockReset();
      await connection?.end();
    });
    beforeEach(async () => {
      tenantId = randomUUID();
      actorId = randomUUID();
      clientId = randomUUID();
      projectId = randomUUID();
      zoneId = randomUUID();
      assemblyId = randomUUID();
      await appendFile(
        new URL("../tmp/a1-db-physical-fixtures.ndjson", import.meta.url),
        JSON.stringify({
          kind: "synthetic-a1-writer-fixture",
          tenantId,
          actorId,
          clientId,
          projectId,
          zoneId,
          assemblyId,
        }) + "\n"
      );
      await database.insert(s.tenants).values({
        id: tenantId,
        name: "Synthetic A1 writer laboratory",
        slug: `a1-writer-${tenantId}`,
        isActive: true,
      });
      await database
        .insert(s.profiles)
        .values({ id: actorId, tenantId, isActive: true, role: "user" });
      await database.insert(s.clients).values({
        id: clientId,
        tenantId,
        name: "Synthetic writer client",
        isActive: true,
      });
      const zone: GeoZoneData = {
        id: zoneId,
        zoneName: "Synthetic coastal zone",
        county: "Synthetic County",
        zipCodes: ["00000"],
        centerLat: 32.75,
        centerLng: -79.9,
        radiusMiles: 10,
        coastalExposureLevel: "moderate",
        logisticsComplexity: "standard",
        laborModifier: 1.1,
        materialModifier: 1.05,
        logisticsModifier: 1,
        contingencyPct: 5,
        minProfitShieldPct: 42,
        isActive: true,
      };
      await database.insert(s.geoZones).values({
        id: zoneId,
        tenantId,
        name: zone.zoneName,
        zoneName: zone.zoneName,
        isActive: true,
        coastalExposureLevel: zone.coastalExposureLevel,
        costMultiplier: "1.10",
        laborModifier: "1.10",
        materialModifier: "1.05",
        logisticsModifier: "1",
        contingencyPct: "5",
        minProfitShieldPct: "42",
      });
      const inputAddress = {
        address: "1 Synthetic Lane",
        city: "Synthetic City",
        state: "SC",
        zipCode: "00000",
        county: "Synthetic County",
      };
      const reviewEvidence = createProjectGeocodeReviewEvidence({
        projectId,
        tenantId,
        inputAddress,
        geocodedAt: at,
        geocode: {
          success: true,
          latitude: 32.75,
          longitude: -79.9,
          formattedAddress: "1 Synthetic Lane, Synthetic City",
          confidence: "high",
          source: "google_maps",
          withinServiceRadius: true,
          locationType: null,
          placeId: null,
          distanceFromCenter: null,
          warning: null,
          addressComponents: null,
        },
        zoneDetection: { zone, method: "coordinates", confidence: "high" },
      });
      await database.insert(s.projects).values({
        id: projectId,
        tenantId,
        clientId,
        ownerUserId: actorId,
        name: "Synthetic actual writer project",
        projectType: "repair",
        channel: "premium",
        geoRiskClass: "coastal",
        address: inputAddress.address,
        city: inputAddress.city,
        state: inputAddress.state,
        zip: inputAddress.zipCode,
        county: inputAddress.county,
        latitude: "32.7500000",
        longitude: "-79.9000000",
        geocodeConfidence: "high",
        geocodeSource: "google_maps",
        geocodedAddress: "1 Synthetic Lane, Synthetic City",
        geocodedAt: at,
        zone: zone.zoneName,
        zoneModifierSnapshot: {
          zoneId,
          zoneName: zone.zoneName,
          laborModifier: 1.1,
          materialModifier: 1.05,
          logisticsModifier: 1,
          contingencyPct: 5,
          minProfitShieldPct: 42,
          coastalExposureLevel: "moderate",
          capturedAt: at.toISOString(),
          reviewEvidence,
        },
      });
    });

    it("forms, reviews, approves, replays, revokes and replays the actual frozen decision without repricing", async () => {
      const { draft, review, command } = await formedAndReviewed();
      expect(review.snapshot.identity).toEqual({
        tenantId,
        projectId,
        clientId,
        estimateDraftId: draft.id,
        draftVersion: 1,
      });
      expect(review.snapshot.financials).toMatchObject({
        finalPriceMinor: "10000",
        estimatedCostMinor: "4000",
      });
      expect((await persisted(draft.id)).snapshots).toHaveLength(0);
      const approved = await recordInternalEstimateApproval(
        command,
        actorId,
        tenantId
      );
      expect(approved).toMatchObject({
        state: "active",
        replayed: false,
        contentHash: review.contentHash,
      });
      expect(
        await recordInternalEstimateApproval(command, actorId, tenantId)
      ).toEqual({ ...approved, replayed: true });
      const revoke = revocationCommand(
        draft.id,
        approved.approvalId,
        approved.contentHash
      );
      const revoked = await revokeInternalEstimateApproval(
        revoke,
        actorId,
        tenantId
      );
      expect(
        await revokeInternalEstimateApproval(revoke, actorId, tenantId)
      ).toEqual({ ...revoked, replayed: true });
      expect(
        await recordInternalEstimateApproval(command, actorId, tenantId)
      ).toMatchObject({
        state: "revoked",
        revocationId: revoked.revocationId,
        replayed: true,
      });
      const state = await persisted(draft.id);
      expect(state.draft).toMatchObject({
        status: "internal_approval_revoked",
        subtotalCost: "40.00",
        finalTotalPrice: "100.00",
        approvedBy: actorId,
      });
      expect(state.snapshots).toHaveLength(1);
      expect(state.approvals).toHaveLength(1);
      expect(state.revocations).toHaveLength(1);
      expect(state.snapshots[0].createdAt.toISOString()).toBe(
        approved.approvedAt
      );
      expect(state.approvals[0].approvedAt.toISOString()).toBe(
        approved.approvedAt
      );
      expect(state.audits.map(row => row.action).sort()).toEqual(
        [
          "estimate.internal_approval_revoked",
          "estimate.internal_approved",
          "estimate_draft.create",
        ].sort()
      );
      expect(
        await getInternalApproval(draft.id, actorId, tenantId)
      ).toMatchObject({
        state: "revoked",
        snapshot: { contentHash: review.contentHash },
      });
    });

    it("preserves the captured review when operational notes and present project policy later change", async () => {
      const { draft, command, review } = await formedAndReviewed();
      const approved = await recordInternalEstimateApproval(
        command,
        actorId,
        tenantId
      );
      await database
        .update(s.estimateDrafts)
        .set({ notes: "Operational note added after decision" })
        .where(eq(s.estimateDrafts.id, draft.id));
      await database
        .update(s.projects)
        .set({ geocodeConfidence: null })
        .where(eq(s.projects.id, projectId));
      expect(
        await recordInternalEstimateApproval(command, actorId, tenantId)
      ).toEqual({ ...approved, replayed: true });
      const read = await getInternalApproval(draft.id, actorId, tenantId);
      expect(read).toMatchObject({
        state: "active",
        snapshot: {
          contentHash: review.contentHash,
          snapshotPayload: {
            presentation: {
              reviewedNotes: "Synthetic reviewed original notes",
            },
          },
        },
      });
    });

    it("rolls status, snapshot, decision and audit back together on an actual audit SQLSTATE40001 without retry", async () => {
      const { draft, command } = await formedAndReviewed();
      const remove = await rejectAudit("estimate.internal_approved");
      const transaction = vi.spyOn(database, "transaction");
      try {
        await expect(
          recordInternalEstimateApproval(command, actorId, tenantId)
        ).rejects.toMatchObject({ name: "InternalApprovalAuditFailure" });
        expect(transaction).toHaveBeenCalledTimes(1);
        const state = await persisted(draft.id);
        expect(state.draft).toMatchObject({
          status: "draft",
          approvedAt: null,
          approvedBy: null,
          lockedAt: null,
        });
        expect(state.snapshots).toEqual([]);
        expect(state.approvals).toEqual([]);
        expect(state.revocations).toEqual([]);
        expect(state.audits.map(row => row.action)).toEqual([
          "estimate_draft.create",
        ]);
      } finally {
        transaction.mockRestore();
        await remove();
      }
      expect(
        await recordInternalEstimateApproval(command, actorId, tenantId)
      ).toMatchObject({ state: "active", replayed: false });
    });

    it("rolls a revocation and its projection back together when durable audit fails", async () => {
      const { draft, command } = await formedAndReviewed();
      const approved = await recordInternalEstimateApproval(
        command,
        actorId,
        tenantId
      );
      const revoke = revocationCommand(
        draft.id,
        approved.approvalId,
        approved.contentHash
      );
      const remove = await rejectAudit("estimate.internal_approval_revoked");
      try {
        await expect(
          revokeInternalEstimateApproval(revoke, actorId, tenantId)
        ).rejects.toMatchObject({ name: "InternalApprovalAuditFailure" });
        const state = await persisted(draft.id);
        expect(state.draft.status).toBe("internally_approved");
        expect(state.revocations).toEqual([]);
        expect(state.audits.map(row => row.action).sort()).toEqual(
          ["estimate_draft.create", "estimate.internal_approved"].sort()
        );
      } finally {
        await remove();
      }
      expect(
        await revokeInternalEstimateApproval(revoke, actorId, tenantId)
      ).toMatchObject({ replayed: false });
    });

    it("keeps actual H1 capture outside A1 even though the historical draft has a price", async () => {
      const source = await recordHistoricalSource(
        historicalSource(),
        actorId,
        tenantId
      );
      const imported = await importHistoricalEstimate(
        {
          requestId: randomUUID(),
          projectId,
          clientId,
          sourceId: source.sourceId,
          selectedLineIds: [source.lineIds[0].id],
          declaredSelectedTotal: "100.00",
          declaredSelectedEstimatedCost: null,
          rawSelectedTotals: {
            version: "historical-raw-selected-v1",
            total: "100.00",
            estimatedCost: null,
          },
          reportedApprovalAt: null,
          reportedApprovalNote: null,
          priorImportId: null,
          expectedRevision: null,
        },
        actorId,
        tenantId
      );
      await expect(
        getInternalApprovalReview(
          { id: imported.draftId, confirmedCurrencyCode: "USD" },
          actorId,
          tenantId
        )
      ).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" });
      const state = await persisted(imported.draftId);
      expect(state.draft.status).toBe("draft");
      expect(state.snapshots).toEqual([]);
      expect(state.approvals).toEqual([]);
    });
  }
);
