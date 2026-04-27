import { describe, it, expect } from "vitest";
import { deals, dealActivities, dealStageHistory } from "../drizzle/schema";

describe("Sprint 25: Deal Flow Engine Schema", () => {
  it("1. deals table exists and has correct columns", () => {
    expect(deals).toBeDefined();

    const config = Object.keys(deals);
    expect(config.length).toBeGreaterThan(0);

    expect(deals.id).toBeDefined();
    expect(deals.leadId).toBeDefined();
    expect(deals.name).toBeDefined();
    expect(deals.stage).toBeDefined();
    expect(deals.value).toBeDefined();
    expect(deals.closureDate).toBeDefined();
    expect(deals.notes).toBeDefined();
    expect(deals.createdAt).toBeDefined();
    expect(deals.updatedAt).toBeDefined();
  });

  it("2. dealActivities table exists and has correct columns", () => {
    expect(dealActivities).toBeDefined();

    expect(dealActivities.id).toBeDefined();
    expect(dealActivities.dealId).toBeDefined();
    expect(dealActivities.activityType).toBeDefined();
    expect(dealActivities.description).toBeDefined();
    expect(dealActivities.performedBy).toBeDefined();
    expect(dealActivities.createdAt).toBeDefined();
  });

  it("3. dealStageHistory table exists and has correct columns", () => {
    expect(dealStageHistory).toBeDefined();

    expect(dealStageHistory.id).toBeDefined();
    expect(dealStageHistory.dealId).toBeDefined();
    expect(dealStageHistory.previousStage).toBeDefined();
    expect(dealStageHistory.newStage).toBeDefined();
    expect(dealStageHistory.changedBy).toBeDefined();
    expect(dealStageHistory.changedAt).toBeDefined();
  });
});
