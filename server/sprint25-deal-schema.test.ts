import { describe, it, expect } from "vitest";
import { deals, dealActivities, dealStageHistory } from "../drizzle/schema";

describe("Sprint 25: Deal Flow Engine Schema", () => {
  it("1. deals table exists and has correct columns", () => {
    // We check if the table object is exported and has column definitions
    expect(deals).toBeDefined();
    
    const config = Object.keys(deals);
    // Basic structural checks for Drizzle table objects
    expect(config.length).toBeGreaterThan(0);
    
    // Verify Drizzle column exports exist (these will throw TS errors if they don't, but we assert at runtime too)
    expect(deals.id).toBeDefined();
    expect(deals.nanoid).toBeDefined();
    expect(deals.leadId).toBeDefined();
    expect(deals.clientId).toBeDefined();
    expect(deals.projectId).toBeDefined();
    expect(deals.title).toBeDefined();
    expect(deals.stage).toBeDefined();
    expect(deals.value).toBeDefined();
    expect(deals.probability).toBeDefined();
    expect(deals.weightedValue).toBeDefined();
    expect(deals.expectedCloseDate).toBeDefined();
    expect(deals.actualCloseDate).toBeDefined();
    expect(deals.lostReason).toBeDefined();
    expect(deals.serviceTypes).toBeDefined(); // JSON array
    expect(deals.channel).toBeDefined();
    expect(deals.region).toBeDefined();
    expect(deals.zone).toBeDefined();
    expect(deals.assignedTo).toBeDefined();
    expect(deals.estimateId).toBeDefined();
    expect(deals.notes).toBeDefined();
    expect(deals.createdAt).toBeDefined();
    expect(deals.updatedAt).toBeDefined();
    expect(deals.createdBy).toBeDefined();
    expect(deals.deletedAt).toBeDefined();
  });

  it("2. dealActivities table exists and has correct columns", () => {
    expect(dealActivities).toBeDefined();
    
    expect(dealActivities.id).toBeDefined();
    expect(dealActivities.dealId).toBeDefined();
    expect(dealActivities.activityType).toBeDefined();
    expect(dealActivities.description).toBeDefined();
    expect(dealActivities.metadata).toBeDefined();
    expect(dealActivities.performedBy).toBeDefined();
    expect(dealActivities.performedAt).toBeDefined();
    expect(dealActivities.createdAt).toBeDefined();
  });

  it("3. dealStageHistory table exists and has correct columns", () => {
    expect(dealStageHistory).toBeDefined();
    
    expect(dealStageHistory.id).toBeDefined();
    expect(dealStageHistory.dealId).toBeDefined();
    expect(dealStageHistory.fromStage).toBeDefined();
    expect(dealStageHistory.toStage).toBeDefined();
    expect(dealStageHistory.changedBy).toBeDefined();
    expect(dealStageHistory.changedAt).toBeDefined();
    expect(dealStageHistory.dwellTimeDays).toBeDefined();
    expect(dealStageHistory.notes).toBeDefined();
  });
});
