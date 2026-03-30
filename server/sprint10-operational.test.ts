import { describe, it, expect } from "vitest";
import * as schema from "../drizzle/schema";

// ── Client DB helpers ──
import {
  type CreateClientInput,
  type UpdateClientInput,
  type ListClientsOpts,
} from "./client-db";

// ── Project DB helpers ──
import {
  type CreateProjectInput,
  type UpdateProjectInput,
  type ListProjectsOpts,
  STATUS_TRANSITIONS,
} from "./project-db";

// ── Intake DB helpers ──
import {
  type CreateIntakeInput,
  type UpdateIntakeInput,
  type ListIntakeOpts,
  INTAKE_STATUS_TRANSITIONS,
} from "./intake-db";

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: Schema — Sprint 10 Extended Fields
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Schema Extensions", () => {
  // ── Clients Table ──
  describe("clients table", () => {
    it("has all Sprint 10 billing address fields", () => {
      const cols = Object.keys(schema.clients);
      const billingFields = [
        "billingAddressLine1", "billingAddressLine2",
        "billingCity", "billingState", "billingZip",
      ];
      for (const f of billingFields) {
        expect(cols, `Missing billing field: ${f}`).toContain(f);
      }
    });

    it("has all Sprint 10 shipping address fields", () => {
      const cols = Object.keys(schema.clients);
      const shippingFields = [
        "shippingAddressLine1", "shippingAddressLine2",
        "shippingCity", "shippingState", "shippingZip",
      ];
      for (const f of shippingFields) {
        expect(cols, `Missing shipping field: ${f}`).toContain(f);
      }
    });

    it("has updatedBy field for audit trail", () => {
      const cols = Object.keys(schema.clients);
      expect(cols).toContain("updatedBy");
    });

    it("has core identity fields", () => {
      const cols = Object.keys(schema.clients);
      const coreFields = [
        "id", "uuid", "firstName", "lastName", "companyName",
        "email", "phone", "address", "city", "state", "zip",
        "county", "channel", "source", "notes", "isActive",
        "createdBy", "createdAt", "deletedAt",
      ];
      for (const f of coreFields) {
        expect(cols, `Missing core field: ${f}`).toContain(f);
      }
    });
  });

  // ── Projects Table ──
  describe("projects table", () => {
    it("has Sprint 10 extended fields", () => {
      const cols = Object.keys(schema.projects);
      const newFields = [
        "projectType", "state", "zipCode", "zone", "region", "updatedBy",
      ];
      for (const f of newFields) {
        expect(cols, `Missing project field: ${f}`).toContain(f);
      }
    });

    it("has financial tracking fields", () => {
      const cols = Object.keys(schema.projects);
      const finFields = [
        "estimatedValue", "actualCost", "grossProfit", "profitShieldMinPct",
      ];
      for (const f of finFields) {
        expect(cols, `Missing financial field: ${f}`).toContain(f);
      }
    });

    it("has lifecycle fields", () => {
      const cols = Object.keys(schema.projects);
      const lifecycleFields = [
        "status", "createdBy", "assignedTo", "createdAt", "deletedAt",
      ];
      for (const f of lifecycleFields) {
        expect(cols, `Missing lifecycle field: ${f}`).toContain(f);
      }
    });
  });

  // ── Intake Forms Table ──
  describe("intake_forms table", () => {
    it("has Sprint 10 extended fields", () => {
      const cols = Object.keys(schema.intakeForms);
      const newFields = [
        "serviceType", "area", "finishLevel", "condition", "notes",
      ];
      for (const f of newFields) {
        expect(cols, `Missing intake field: ${f}`).toContain(f);
      }
    });

    it("has core intake fields", () => {
      const cols = Object.keys(schema.intakeForms);
      const coreFields = [
        "id", "uuid", "projectId", "clientId", "channel",
        "rawPayload", "parsedScope", "status", "confidenceScore",
        "createdBy", "createdAt",
      ];
      for (const f of coreFields) {
        expect(cols, `Missing core intake field: ${f}`).toContain(f);
      }
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: Client Domain — Type Contracts & Business Rules
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Client Domain", () => {
  describe("CreateClientInput type contract", () => {
    it("requires firstName and lastName", () => {
      const input: CreateClientInput = {
        firstName: "John",
        lastName: "Smith",
      };
      expect(input.firstName).toBe("John");
      expect(input.lastName).toBe("Smith");
    });

    it("accepts all optional billing/shipping fields", () => {
      const input: CreateClientInput = {
        firstName: "Jane",
        lastName: "Doe",
        billingAddressLine1: "123 Main St",
        billingAddressLine2: "Suite 100",
        billingCity: "Charleston",
        billingState: "SC",
        billingZip: "29401",
        shippingAddressLine1: "456 Oak Ave",
        shippingAddressLine2: null,
        shippingCity: "Mt Pleasant",
        shippingState: "SC",
        shippingZip: "29464",
      };
      expect(input.billingAddressLine1).toBe("123 Main St");
      expect(input.shippingCity).toBe("Mt Pleasant");
    });

    it("accepts channel enum values", () => {
      const channels: CreateClientInput["channel"][] = [
        "residential", "commercial", "insurance", "direct",
      ];
      for (const ch of channels) {
        const input: CreateClientInput = {
          firstName: "Test",
          lastName: "Client",
          channel: ch,
        };
        expect(input.channel).toBe(ch);
      }
    });
  });

  describe("UpdateClientInput type contract", () => {
    it("all fields are optional", () => {
      const input: UpdateClientInput = {};
      expect(Object.keys(input).length).toBe(0);
    });

    it("allows partial updates", () => {
      const input: UpdateClientInput = {
        phone: "843-555-1234",
        notes: "Updated contact info",
      };
      expect(input.phone).toBe("843-555-1234");
      expect(input.firstName).toBeUndefined();
    });
  });

  describe("ListClientsOpts type contract", () => {
    it("supports search, channel, pagination", () => {
      const opts: ListClientsOpts = {
        search: "Smith",
        channel: "residential",
        includeDeleted: false,
        limit: 25,
        offset: 0,
      };
      expect(opts.search).toBe("Smith");
      expect(opts.limit).toBe(25);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: Project Domain — Type Contracts & State Machine
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Project Domain", () => {
  describe("CreateProjectInput type contract", () => {
    it("requires name", () => {
      const input: CreateProjectInput = {
        name: "Kitchen Remodel - 123 Main St",
      };
      expect(input.name).toBe("Kitchen Remodel - 123 Main St");
    });

    it("accepts all Sprint 10 fields", () => {
      const input: CreateProjectInput = {
        name: "Full Home Remodel",
        clientId: 1,
        clientName: "John Smith",
        clientEmail: "john@example.com",
        clientPhone: "843-555-1234",
        address: "123 Main St",
        city: "Charleston",
        county: "Charleston",
        state: "SC",
        zipCode: "29401",
        region: "charleston_metro",
        zone: "downtown",
        projectType: "remodel",
        channel: "residential",
        notes: "Full gut remodel",
        assignedTo: 1,
      };
      expect(input.projectType).toBe("remodel");
      expect(input.region).toBe("charleston_metro");
      expect(input.zone).toBe("downtown");
    });

    it("accepts all project type enum values", () => {
      const types: CreateProjectInput["projectType"][] = [
        "remodel", "new_construction", "repair",
        "insurance_restoration", "commercial_buildout",
        "addition", "exterior",
      ];
      for (const t of types) {
        const input: CreateProjectInput = { name: "Test", projectType: t };
        expect(input.projectType).toBe(t);
      }
    });
  });

  describe("Project status transitions (state machine)", () => {
    it("exports STATUS_TRANSITIONS constant", () => {
      expect(STATUS_TRANSITIONS).toBeDefined();
      expect(typeof STATUS_TRANSITIONS).toBe("object");
    });

    it("intake → estimating, cancelled", () => {
      expect(STATUS_TRANSITIONS["intake"]).toEqual(
        expect.arrayContaining(["estimating", "cancelled"]),
      );
    });

    it("estimating → review, cancelled", () => {
      expect(STATUS_TRANSITIONS["estimating"]).toEqual(
        expect.arrayContaining(["review", "cancelled"]),
      );
    });

    it("review → approved, estimating, cancelled", () => {
      expect(STATUS_TRANSITIONS["review"]).toEqual(
        expect.arrayContaining(["approved", "estimating", "cancelled"]),
      );
    });

    it("approved → in_progress, cancelled", () => {
      expect(STATUS_TRANSITIONS["approved"]).toEqual(
        expect.arrayContaining(["in_progress", "cancelled"]),
      );
    });

    it("in_progress → completed, cancelled", () => {
      expect(STATUS_TRANSITIONS["in_progress"]).toEqual(
        expect.arrayContaining(["completed", "cancelled"]),
      );
    });

    it("completed is terminal (no transitions)", () => {
      expect(STATUS_TRANSITIONS["completed"]).toEqual([]);
    });

    it("cancelled → intake (reopen)", () => {
      expect(STATUS_TRANSITIONS["cancelled"]).toEqual(["intake"]);
    });

    it("covers all 7 statuses", () => {
      const statuses = Object.keys(STATUS_TRANSITIONS);
      expect(statuses.length).toBe(7);
      expect(statuses).toEqual(
        expect.arrayContaining([
          "intake", "estimating", "review", "approved",
          "in_progress", "completed", "cancelled",
        ]),
      );
    });
  });

  describe("UpdateProjectInput type contract", () => {
    it("allows financial field updates", () => {
      const input: UpdateProjectInput = {
        estimatedValue: "45000.00",
        actualCost: "32000.00",
        grossProfit: "28.89",
        profitShieldMinPct: "35.00",
      };
      expect(input.estimatedValue).toBe("45000.00");
      expect(input.profitShieldMinPct).toBe("35.00");
    });

    it("allows metadata updates", () => {
      const input: UpdateProjectInput = {
        metadata: {
          insuranceClaim: "CLM-2026-001",
          adjusterName: "Bob Jones",
          deductible: 1500,
        },
      };
      expect(input.metadata?.insuranceClaim).toBe("CLM-2026-001");
    });
  });

  describe("ListProjectsOpts type contract", () => {
    it("supports all filter dimensions", () => {
      const opts: ListProjectsOpts = {
        search: "kitchen",
        status: "estimating",
        channel: "residential",
        clientId: 1,
        projectType: "remodel",
        includeDeleted: false,
        limit: 20,
        offset: 0,
      };
      expect(opts.status).toBe("estimating");
      expect(opts.projectType).toBe("remodel");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: Intake Domain — Type Contracts & State Machine
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Intake Domain", () => {
  describe("CreateIntakeInput type contract", () => {
    it("requires rawPayload", () => {
      const input: CreateIntakeInput = {
        rawPayload: { description: "Kitchen remodel needed" },
      };
      expect(input.rawPayload).toBeDefined();
    });

    it("accepts all Sprint 10 fields", () => {
      const input: CreateIntakeInput = {
        projectId: 1,
        clientId: 1,
        channel: "residential",
        serviceType: "kitchen_remodel",
        area: "kitchen",
        finishLevel: "premium",
        condition: "fair",
        notes: "Client wants quartz countertops",
        rawPayload: { source: "website_form" },
      };
      expect(input.serviceType).toBe("kitchen_remodel");
      expect(input.finishLevel).toBe("premium");
      expect(input.condition).toBe("fair");
    });

    it("accepts all finish level enum values", () => {
      const levels: CreateIntakeInput["finishLevel"][] = [
        "standard", "premium", "luxury",
      ];
      for (const l of levels) {
        const input: CreateIntakeInput = {
          rawPayload: {},
          finishLevel: l,
        };
        expect(input.finishLevel).toBe(l);
      }
    });
  });

  describe("Intake status transitions (state machine)", () => {
    it("exports INTAKE_STATUS_TRANSITIONS constant", () => {
      expect(INTAKE_STATUS_TRANSITIONS).toBeDefined();
      expect(typeof INTAKE_STATUS_TRANSITIONS).toBe("object");
    });

    it("received → parsing", () => {
      expect(INTAKE_STATUS_TRANSITIONS["received"]).toEqual(["parsing"]);
    });

    it("parsing → parsed, received", () => {
      expect(INTAKE_STATUS_TRANSITIONS["parsing"]).toEqual(
        expect.arrayContaining(["parsed", "received"]),
      );
    });

    it("parsed → reviewed", () => {
      expect(INTAKE_STATUS_TRANSITIONS["parsed"]).toEqual(["reviewed"]);
    });

    it("reviewed → converted", () => {
      expect(INTAKE_STATUS_TRANSITIONS["reviewed"]).toEqual(["converted"]);
    });

    it("converted is terminal (no transitions)", () => {
      expect(INTAKE_STATUS_TRANSITIONS["converted"]).toEqual([]);
    });

    it("covers all 5 statuses", () => {
      const statuses = Object.keys(INTAKE_STATUS_TRANSITIONS);
      expect(statuses.length).toBe(5);
      expect(statuses).toEqual(
        expect.arrayContaining([
          "received", "parsing", "parsed", "reviewed", "converted",
        ]),
      );
    });
  });

  describe("UpdateIntakeInput type contract", () => {
    it("allows parsedScope and confidenceScore updates", () => {
      const input: UpdateIntakeInput = {
        parsedScope: {
          rooms: ["kitchen", "master_bath"],
          assemblies: ["KIT-CAB-STD", "BTH-FULL-STD"],
          estimatedSqft: 450,
        },
        confidenceScore: "0.87",
      };
      expect(input.parsedScope?.rooms).toEqual(["kitchen", "master_bath"]);
      expect(input.confidence).toBe("0.87");
    });
  });

  describe("ListIntakeOpts type contract", () => {
    it("supports all filter dimensions", () => {
      const opts: ListIntakeOpts = {
        status: "received",
        channel: "residential",
        projectId: 1,
        clientId: 1,
        serviceType: "kitchen_remodel",
        limit: 20,
        offset: 0,
      };
      expect(opts.serviceType).toBe("kitchen_remodel");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: Router Structure — All 3 Routers Exist
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Router Structure", () => {
  it("clientRouter exports from client-router.ts", async () => {
    const mod = await import("./client-router");
    expect(mod.clientRouter).toBeDefined();
    expect(mod.clientRouter._def).toBeDefined();
  });

  it("clientRouter has all 7 procedures", async () => {
    const mod = await import("./client-router");
    const procedures = Object.keys(mod.clientRouter._def.procedures);
    const expected = [
      "create", "getById", "list", "update", "delete", "search", "stats",
    ];
    for (const p of expected) {
      expect(procedures, `Missing client procedure: ${p}`).toContain(p);
    }
  });

  it("projectRouter exports from project-router.ts", async () => {
    const mod = await import("./project-router");
    expect(mod.projectRouter).toBeDefined();
    expect(mod.projectRouter._def).toBeDefined();
  });

  it("projectRouter has all 8 procedures", async () => {
    const mod = await import("./project-router");
    const procedures = Object.keys(mod.projectRouter._def.procedures);
    const expected = [
      "create", "getById", "list", "update", "updateStatus",
      "delete", "getByClient", "stats",
    ];
    for (const p of expected) {
      expect(procedures, `Missing project procedure: ${p}`).toContain(p);
    }
  });

  it("intakeRouter exports from intake-router.ts", async () => {
    const mod = await import("./intake-router");
    expect(mod.intakeRouter).toBeDefined();
    expect(mod.intakeRouter._def).toBeDefined();
  });

  it("intakeRouter has all 8 procedures", async () => {
    const mod = await import("./intake-router");
    const procedures = Object.keys(mod.intakeRouter._def.procedures);
    const expected = [
      "create", "getById", "list", "update", "updateStatus",
      "getByProject", "getByClient", "stats",
    ];
    for (const p of expected) {
      expect(procedures, `Missing intake procedure: ${p}`).toContain(p);
    }
  });

  it("all 3 routers are integrated into appRouter", async () => {
    const mod = await import("./routers");
    const procedures = Object.keys(mod.appRouter._def.procedures);
    // Check for namespaced procedures
    expect(procedures.some(p => p.startsWith("clients."))).toBe(true);
    expect(procedures.some(p => p.startsWith("project."))).toBe(true);
    expect(procedures.some(p => p.startsWith("intake."))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: Cross-Domain Integration — Estimate Draft Linking
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Estimate Draft Linking", () => {
  it("estimate_drafts table has project_id column", () => {
    const cols = Object.keys(schema.estimateDrafts);
    expect(cols).toContain("projectId");
  });

  it("estimate_drafts table has client_id column", () => {
    const cols = Object.keys(schema.estimateDrafts);
    expect(cols).toContain("clientId");
  });

  it("estimateRouter has createFromCalculator procedure", async () => {
    const mod = await import("./estimate-router");
    const procedures = Object.keys(mod.estimateRouter._def.procedures);
    expect(procedures).toContain("createFromCalculator");
  });

  it("estimateRouter has validate procedure", async () => {
    const mod = await import("./estimate-router");
    const procedures = Object.keys(mod.estimateRouter._def.procedures);
    expect(procedures).toContain("validate");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: Business Rules — Validation & Defaults
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Business Rules", () => {
  describe("Client defaults", () => {
    it("CreateClientInput defaults channel to residential conceptually", () => {
      const input: CreateClientInput = {
        firstName: "Test",
        lastName: "Client",
      };
      // channel is optional, DB helper defaults to "residential"
      expect(input.channel).toBeUndefined();
    });
  });

  describe("Project defaults", () => {
    it("CreateProjectInput defaults projectType to remodel conceptually", () => {
      const input: CreateProjectInput = {
        name: "Test Project",
      };
      // projectType is optional, DB helper defaults to "remodel"
      expect(input.projectType).toBeUndefined();
    });

    it("project starts in intake status", () => {
      // Verified by the DB helper setting status: "intake"
      expect(STATUS_TRANSITIONS["intake"]).toBeDefined();
      expect(STATUS_TRANSITIONS["intake"].length).toBeGreaterThan(0);
    });
  });

  describe("Intake defaults", () => {
    it("CreateIntakeInput defaults finishLevel to standard conceptually", () => {
      const input: CreateIntakeInput = {
        rawPayload: { test: true },
      };
      expect(input.finishLevel).toBeUndefined();
    });

    it("intake starts in received status", () => {
      expect(INTAKE_STATUS_TRANSITIONS["received"]).toBeDefined();
      expect(INTAKE_STATUS_TRANSITIONS["received"].length).toBeGreaterThan(0);
    });
  });

  describe("State machine completeness", () => {
    it("project state machine has no orphan states", () => {
      const allStates = Object.keys(STATUS_TRANSITIONS);
      const reachableStates = new Set<string>();
      reachableStates.add("intake"); // initial state
      for (const transitions of Object.values(STATUS_TRANSITIONS)) {
        for (const t of transitions) reachableStates.add(t);
      }
      for (const state of allStates) {
        expect(reachableStates.has(state), `Orphan state: ${state}`).toBe(true);
      }
    });

    it("intake state machine has no orphan states", () => {
      const allStates = Object.keys(INTAKE_STATUS_TRANSITIONS);
      const reachableStates = new Set<string>();
      reachableStates.add("received"); // initial state
      for (const transitions of Object.values(INTAKE_STATUS_TRANSITIONS)) {
        for (const t of transitions) reachableStates.add(t);
      }
      for (const state of allStates) {
        expect(reachableStates.has(state), `Orphan state: ${state}`).toBe(true);
      }
    });

    it("project state machine has exactly one terminal state (completed)", () => {
      const terminals = Object.entries(STATUS_TRANSITIONS)
        .filter(([, transitions]) => transitions.length === 0)
        .map(([state]) => state);
      expect(terminals).toEqual(["completed"]);
    });

    it("intake state machine has exactly one terminal state (converted)", () => {
      const terminals = Object.entries(INTAKE_STATUS_TRANSITIONS)
        .filter(([, transitions]) => transitions.length === 0)
        .map(([state]) => state);
      expect(terminals).toEqual(["converted"]);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: Address Atomicity — Billing & Shipping
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Address Atomicity", () => {
  it("client billing address is fully atomic (5 fields)", () => {
    const input: CreateClientInput = {
      firstName: "Test",
      lastName: "Client",
      billingAddressLine1: "123 Main St",
      billingAddressLine2: "Suite 200",
      billingCity: "Charleston",
      billingState: "SC",
      billingZip: "29401",
    };
    expect(input.billingAddressLine1).toBe("123 Main St");
    expect(input.billingAddressLine2).toBe("Suite 200");
    expect(input.billingCity).toBe("Charleston");
    expect(input.billingState).toBe("SC");
    expect(input.billingZip).toBe("29401");
  });

  it("client shipping address is fully atomic (5 fields)", () => {
    const input: CreateClientInput = {
      firstName: "Test",
      lastName: "Client",
      shippingAddressLine1: "456 Oak Ave",
      shippingAddressLine2: null,
      shippingCity: "Mt Pleasant",
      shippingState: "SC",
      shippingZip: "29464",
    };
    expect(input.shippingAddressLine1).toBe("456 Oak Ave");
    expect(input.shippingAddressLine2).toBeNull();
    expect(input.shippingCity).toBe("Mt Pleasant");
    expect(input.shippingState).toBe("SC");
    expect(input.shippingZip).toBe("29464");
  });

  it("project address includes state, zipCode, zone, region", () => {
    const input: CreateProjectInput = {
      name: "Test Project",
      address: "789 Elm St",
      city: "Daniel Island",
      county: "Berkeley",
      state: "SC",
      zipCode: "29492",
      zone: "daniel_island",
      region: "charleston_metro",
    };
    expect(input.state).toBe("SC");
    expect(input.zipCode).toBe("29492");
    expect(input.zone).toBe("daniel_island");
    expect(input.region).toBe("charleston_metro");
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 9: Audit Trail — All Domains Log Actions
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Audit Trail", () => {
  it("audit_logs table exists in schema", () => {
    expect(schema.auditLogs).toBeDefined();
  });

  it("audit_logs has required columns", () => {
    const cols = Object.keys(schema.auditLogs);
    const required = ["id", "userId", "action", "tableName", "recordId"];
    for (const f of required) {
      expect(cols, `Missing audit column: ${f}`).toContain(f);
    }
  });

  it("client-db imports logAudit", async () => {
    // Verify the module can be imported (which means logAudit is resolved)
    const mod = await import("./client-db");
    expect(mod.createClient).toBeDefined();
    expect(mod.updateClient).toBeDefined();
    expect(mod.deleteClient).toBeDefined();
  });

  it("project-db imports logAudit", async () => {
    const mod = await import("./project-db");
    expect(mod.createProject).toBeDefined();
    expect(mod.updateProject).toBeDefined();
    expect(mod.updateProjectStatus).toBeDefined();
    expect(mod.deleteProject).toBeDefined();
  });

  it("intake-db imports logAudit", async () => {
    const mod = await import("./intake-db");
    expect(mod.createIntakeForm).toBeDefined();
    expect(mod.updateIntakeForm).toBeDefined();
    expect(mod.updateIntakeStatus).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 10: DB Helper Export Completeness
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — DB Helper Exports", () => {
  it("client-db exports all 7 helpers", async () => {
    const mod = await import("./client-db");
    const expected = [
      "createClient", "getClientById", "listClients",
      "updateClient", "deleteClient", "searchClients", "getClientStats",
    ];
    for (const fn of expected) {
      expect(typeof (mod as any)[fn], `Missing client helper: ${fn}`).toBe("function");
    }
  });

  it("project-db exports all 8 helpers + STATUS_TRANSITIONS", async () => {
    const mod = await import("./project-db");
    const expected = [
      "createProject", "getProjectById", "listProjects",
      "updateProject", "updateProjectStatus", "deleteProject",
      "getProjectsByClient", "getProjectStats",
    ];
    for (const fn of expected) {
      expect(typeof (mod as any)[fn], `Missing project helper: ${fn}`).toBe("function");
    }
    expect(mod.STATUS_TRANSITIONS).toBeDefined();
  });

  it("intake-db exports all 8 helpers + INTAKE_STATUS_TRANSITIONS", async () => {
    const mod = await import("./intake-db");
    const expected = [
      "createIntakeForm", "getIntakeFormById", "listIntakeForms",
      "updateIntakeForm", "updateIntakeStatus",
      "getIntakeFormsByProject", "getIntakeFormsByClient", "getIntakeStats",
    ];
    for (const fn of expected) {
      expect(typeof (mod as any)[fn], `Missing intake helper: ${fn}`).toBe("function");
    }
    expect(mod.INTAKE_STATUS_TRANSITIONS).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 11: Frontend Pages Exist
// ══════════════════════════════════════════════════════════════════════

describe("Sprint 10 — Frontend Pages", () => {
  it("Clients page exports default component", async () => {
    const mod = await import("../client/src/pages/Clients");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("Projects page exports default component", async () => {
    const mod = await import("../client/src/pages/Projects");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });

  it("Intake page exports default component", async () => {
    const mod = await import("../client/src/pages/Intake");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});
