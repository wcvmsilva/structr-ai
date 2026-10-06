import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  approvalRows,
  approvalContext as ctx,
} from "./internal-estimate-approval-adapter.fixtures";
import { refreshProjectGeocode, persistGeocodeResult } from "./geo-integration";
import type { Project } from "../drizzle/schema";
import type { GeocodeResult } from "./geo-geocoding";
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  geocodeAddress: vi.fn(),
  loadActiveZonesForEngine: vi.fn(),
  logAudit: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./geo-geocoding", () => ({ geocodeAddress: mocks.geocodeAddress }));
vi.mock("./geo-db", () => ({
  loadActiveZonesForEngine: mocks.loadActiveZonesForEngine,
}));
vi.mock("./audit", () => ({ logAudit: mocks.logAudit }));
function database(row: Project | null) {
  const state = {
    row: structuredClone(row),
    writes: 0,
    commits: 0,
    rollbacks: 0,
  };
  const locks: string[] = [];
  const txs: object[] = [];
  function handle(view: { row: Project | null; writes: number }) {
    function query(selection?: any, update = false) {
      let payload: any;
      const q: any = {
        from: () => q,
        where: () => q,
        limit: () => q,
        for: (v: string) => {
          locks.push(v);
          return q;
        },
        set: (v: any) => {
          payload = structuredClone(v);
          return q;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve()
            .then(() => {
              if (update) {
                view.row = { ...view.row, ...payload };
                view.writes++;
                return [];
              }
              return !view.row
                ? []
                : selection?.matches
                  ? [{ id: view.row.id, matches: true }]
                  : [structuredClone(view.row)];
            })
            .then(resolve, reject),
      };
      return q;
    }
    const h: any = {
      select: (s: any) => query(s),
      update: () => query(undefined, true),
      transaction: async (fn: any) => {
        const staged = { row: structuredClone(view.row), writes: 0 };
        const tx = handle(staged);
        txs.push(tx);
        try {
          const result = await fn(tx);
          view.row = staged.row;
          view.writes += staged.writes;
          state.commits++;
          return result;
        } catch (e) {
          state.rollbacks++;
          throw e;
        }
      },
    };
    return h;
  }
  const db = handle(state);
  mocks.getDb.mockResolvedValue(db);
  return { state, locks, txs };
}
function geocode(): GeocodeResult {
  return {
    success: true,
    latitude: 32.75,
    longitude: -79.9,
    formattedAddress: "Synthetic geocoded address",
    confidence: "high",
    source: "google_maps",
    locationType: "ROOFTOP",
    placeId: "synthetic",
    distanceFromCenter: 5,
    withinServiceRadius: true,
    warning: null,
    addressComponents: null,
  };
}
function zone() {
  return {
    id: approvalRows().zone!.id,
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
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.geocodeAddress.mockResolvedValue(geocode());
  mocks.loadActiveZonesForEngine.mockResolvedValue([zone()]);
  mocks.logAudit.mockResolvedValue({ id: "synthetic-audit" });
});
describe("current address geocode provenance", () => {
  it("persists exact captured input, actual resolver result, detection and same-tx audit", async () => {
    const row = approvalRows().project,
      db = database(row);
    const result = await refreshProjectGeocode(
      ctx.tenantId,
      row.id,
      ctx.actorId
    );
    expect(result.persisted).toBe(true);
    const stored = db.state.row!;
    const evidence = (stored.zoneModifierSnapshot as any).reviewEvidence;
    expect(evidence).toEqual({
      version: "project-geocode-review-v1",
      projectId: row.id,
      tenantId: ctx.tenantId,
      inputAddress: {
        address: row.address,
        city: row.city,
        state: row.state,
        zipCode: row.zip,
        county: row.county,
      },
      geocodedAt: stored.geocodedAt!.toISOString(),
      geocode: {
        success: true,
        latitude: 32.75,
        longitude: -79.9,
        formattedAddress: "Synthetic geocoded address",
        confidence: "high",
        source: "google_maps",
        withinServiceRadius: true,
      },
      zoneDetection: {
        zoneId: zone().id,
        method: "coordinates",
        confidence: "high",
      },
    });
    expect(db.locks).toContain("update");
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit.mock.calls.every(call => call[1] === db.txs[0])).toBe(
      true
    );
  });
  it.each(["address", "city", "state", "zip", "county"] as const)(
    "rejects late result when stored %s changes before locked write",
    async key => {
      const row = approvalRows().project,
        db = database(row);
      mocks.geocodeAddress.mockImplementation(async () => {
        db.state.row![key] = "new input";
        return geocode();
      });
      expect(
        (await refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId))
          .persisted
      ).toBe(false);
      expect(db.state.writes).toBe(0);
      expect(mocks.logAudit).not.toHaveBeenCalled();
    }
  );
  it("rejects tenant mismatch before external lookup", async () => {
    const row = approvalRows().project;
    row.tenantId = "foreign";
    const db = database(row);
    expect(
      (await refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId)).persisted
    ).toBe(false);
    expect(mocks.geocodeAddress).not.toHaveBeenCalled();
    expect(db.state.writes).toBe(0);
  });
  it("rejects tenant changes during lookup", async () => {
    const row = approvalRows().project,
      db = database(row);
    mocks.geocodeAddress.mockImplementation(async () => {
      db.state.row!.tenantId = "foreign";
      return geocode();
    });
    expect(
      (await refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId)).persisted
    ).toBe(false);
    expect(db.state.writes).toBe(0);
  });
  it("rejects deleted project before external lookup", async () => {
    const row = approvalRows().project;
    row.deletedAt = new Date();
    database(row);
    expect(
      (await refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId)).persisted
    ).toBe(false);
    expect(mocks.geocodeAddress).not.toHaveBeenCalled();
  });
  it("rejects deleted project during external lookup", async () => {
    const row = approvalRows().project,
      db = database(row);
    mocks.geocodeAddress.mockImplementation(async () => {
      db.state.row!.deletedAt = new Date();
      return geocode();
    });
    expect(
      (await refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId)).persisted
    ).toBe(false);
    expect(db.state.writes).toBe(0);
  });
  it("rolls back geocode and proof if durable audit fails", async () => {
    const row = approvalRows().project,
      db = database(row);
    mocks.logAudit.mockRejectedValue(new Error("audit unavailable"));
    await expect(
      refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId)
    ).rejects.toThrow("audit unavailable");
    expect(db.state.row).toEqual(row);
    expect(db.state.writes).toBe(0);
    expect(db.state.rollbacks).toBe(1);
  });
  it("treats absent audit record as failure and rolls back", async () => {
    const row = approvalRows().project,
      db = database(row);
    mocks.logAudit.mockResolvedValue(null);
    await expect(
      refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId)
    ).rejects.toThrow();
    expect(db.state.row).toEqual(row);
  });
  it("retains actual outside-radius evidence", async () => {
    const row = approvalRows().project,
      db = database(row);
    mocks.geocodeAddress.mockResolvedValue({
      ...geocode(),
      withinServiceRadius: false,
    });
    await refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId);
    expect(
      (db.state.row!.zoneModifierSnapshot as any).reviewEvidence.geocode
        .withinServiceRadius
    ).toBe(false);
  });
  it("legacy writes without a snapshot strip old review evidence", async () => {
    const row = approvalRows().project,
      db = database(row);
    expect(
      await persistGeocodeResult({ projectId: row.id, geocode: geocode() })
    ).toBe(true);
    expect(
      (db.state.row!.zoneModifierSnapshot as any).reviewEvidence
    ).toBeUndefined();
  });
  it("legacy replacement cannot smuggle review evidence forward", async () => {
    const row = approvalRows().project,
      db = database(row);
    await persistGeocodeResult({
      projectId: row.id,
      geocode: geocode(),
      zoneSnapshot: row.zoneModifierSnapshot as any,
    });
    expect(
      (db.state.row!.zoneModifierSnapshot as any).reviewEvidence
    ).toBeUndefined();
  });
  it("no resolved zone clears previous evidence", async () => {
    const row = approvalRows().project,
      db = database(row);
    mocks.loadActiveZonesForEngine.mockResolvedValue([]);
    await refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId);
    expect(
      (db.state.row!.zoneModifierSnapshot as any)?.reviewEvidence
    ).toBeUndefined();
  });
  it("sends and records exact original address values without filling optional blanks", async () => {
    const row = approvalRows().project;
    Object.assign(row, { address: "  1 Synthetic Lane\r\nUnit Ω  ", city: "Synthetic City", county: "", zip: null });
    const db = database(row);
    const input = { address: row.address, city: row.city, state: row.state, zipCode: null, county: "" };
    expect((await refreshProjectGeocode(ctx.tenantId, row.id, ctx.actorId)).persisted).toBe(true);
    expect(mocks.geocodeAddress).toHaveBeenCalledWith(input);
    expect((db.state.row!.zoneModifierSnapshot as any).reviewEvidence.inputAddress).toEqual(input);
    expect(db.state.row).toMatchObject({ address: row.address, city: row.city, county: "", zip: null });
  });
});
