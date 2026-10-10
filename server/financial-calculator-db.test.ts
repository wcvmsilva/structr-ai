import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  startFinancialCalculatorBoundary,
  setupCalculatorLifecycleFixture,
} from "./test-support/financial-calculator-boundary";
import {
  executorTestConfig,
  signedExecutorOperator,
  EXECUTOR_TEST_NOW_MS,
} from "./test-support/financial-executor-auth";
import {
  createExecutorTransactionRunner,
  callCalculatorRoutine,
} from "../services/financial-executor/src/transaction";
import {
  executeFinancialCalculator,
  loadCalculatorSnapshot,
} from "./financial-calculator-db";
import { withAuditLog } from "./financial-calculator-audit";
import {
  buildCalculatorResult,
  hashCalculatorCanonical,
} from "../shared/financial-calculator-engine";

const enabled = process.env.FINANCIAL_CALCULATOR_LIFECYCLE_PHYSICAL === "1";
describe.skipIf(!enabled)(
  "complete local Calculator executor lifecycle",
  () => {
    let lab: Awaited<ReturnType<typeof startFinancialCalculatorBoundary>>,
      fixture: Awaited<ReturnType<typeof setupCalculatorLifecycleFixture>>,
      runner: ReturnType<typeof createExecutorTransactionRunner>,
      operator: Awaited<ReturnType<typeof signedExecutorOperator>>;
    const command = (assemblyId: string) =>
      ({
        ...fixture.command,
        assemblies: [{ assemblyId, quantity: 1 }],
      }) as any;
    const calculate = (assemblyId: string) =>
      executeFinancialCalculator(
        runner,
        operator,
        command(assemblyId)
      ) as Promise<any>;
    const create = (simulation: any, requestId = randomUUID()) => ({
      ...command(simulation.selections[0].assemblyId),
      operation: "calculator.create",
      requestId,
      expectedSourceHash: simulation.sourceHash,
      expectedCalculationHash: simulation.calculationHash,
    });
    const counts = async () => {
      const [row] =
        await lab.admin`select (select count(*) from public.estimate_drafts)::int as drafts,(select count(*) from structr_financial.calculator_requests)::int as requests,(select count(*) from public.audit_logs where action='estimate_draft.create')::int as audits`;
      return row;
    };
    beforeAll(async () => {
      lab = await startFinancialCalculatorBoundary();
      await lab.install();
      await lab.admin.begin(async tx =>
        tx.unsafe(
          await readFile(
            new URL(
              "../drizzle/0021_financial_calculator_lifecycle.sql",
              import.meta.url
            ),
            "utf8"
          )
        )
      );
      fixture = await setupCalculatorLifecycleFixture(lab);
      const connection = await lab.connectLogin();
      const config = {
        ...executorTestConfig,
        auth: {
          ...executorTestConfig.auth,
          operatorSubject: fixture.ids.subject,
          actorId: fixture.ids.actor,
          tenantId: fixture.ids.tenant,
        },
      };
      operator = await signedExecutorOperator({ config });
      runner = createExecutorTransactionRunner(config, {
        database: connection.db,
        nowMs: () => EXECUTOR_TEST_NOW_MS,
      });
    }, 30000);
    afterAll(async () => lab?.stop());
    it("returns only authorized fixture options for the known pair", async () => {
      const result = await executeFinancialCalculator(
        runner,
        operator,
        fixture.contextCommand as any
      );
      expect(result).toEqual({
        ...fixture.contextCommand,
        clientId: fixture.ids.client,
        options: [
          { assemblyId: fixture.ids.a, name: "A", unit: "EA" },
          { assemblyId: fixture.ids.b, name: "B", unit: "EA" },
          { assemblyId: fixture.ids.c, name: "C", unit: "EA" },
        ],
      });
    });
    it.each([
      ["a", "4000", "10000"],
      ["b", "6000", "9000"],
      ["c", "1", "1"],
    ] as const)(
      "calculates %s from physical rows without writing",
      async (key, cost, price) => {
        const before = await counts(),
          result = await calculate(fixture.ids[key]);
        expect(result.financials.costMinor).toBe(cost);
        expect(result.financials.priceMinor).toBe(price);
        expect(result.lines[0].source.priceId).toMatch(/^c3000000/);
        expect(result).not.toHaveProperty("draft");
        expect(result).not.toHaveProperty("binding");
        expect(await counts()).toEqual(before);
      }
    );
    it.each(["a", "b", "c"] as const)(
      "commits %s with one complete creation audit and durable receipt",
      async key => {
        const simulation = await calculate(fixture.ids[key]);
        const input = create(simulation),
          before = await counts();
        const result: any = await executeFinancialCalculator(
          runner,
          operator,
          input
        );
        expect(result.status).toBe("confirmed");
        expect(result.draft.status).toBe("draft");
        expect(result.creation.draftId).toBe(result.draft.id);
        expect(await counts()).toEqual({
          drafts: before.drafts + 1,
          requests: before.requests + 1,
          audits: before.audits + 1,
        });
        const [persisted] =
          await lab.admin`select r.receipt,a.new_values,a.old_values,d.subtotal_cost::text as cost,d.subtotal_price::text as price from structr_financial.calculator_requests r join public.audit_logs a on a.id=r.audit_id join public.estimate_drafts d on d.id=r.draft_id where r.request_id=${input.requestId}`;
        expect(persisted.old_values).toBe(null);
        expect(persisted.receipt.audit.new_values).toEqual(
          persisted.new_values
        );
        expect(persisted.new_values.draft.id).toBe(result.draft.id);
        expect(persisted.receipt.tenantId).toBe(fixture.ids.tenant);
      }
    );
    it("replays before current pricing and returns the original receipt without duplicate writes", async () => {
      const input = create(await calculate(fixture.ids.a));
      const first = await executeFinancialCalculator(runner, operator, input);
      const before = await counts();
      const priceId = "c3000000-0000-4000-8000-000000000401";
      await lab.admin`update public.cost_code_pricing_history set unit_price=101 where id=${priceId}`;
      try {
        expect(
          await executeFinancialCalculator(runner, operator, input)
        ).toEqual(first);
        expect(await counts()).toEqual(before);
      } finally {
        await lab.admin`update public.cost_code_pricing_history set unit_price=100 where id=${priceId}`;
      }
    });
    it("recovers a confirmed result with a fresh authenticated request", async () => {
      const input = create(await calculate(fixture.ids.a));
      const first: any = await executeFinancialCalculator(
        runner,
        operator,
        input
      );
      const before = await counts();
      const result: any = await executeFinancialCalculator(runner, operator, {
        contractVersion: "calculator-v1",
        operation: "calculator.recover",
        projectId: input.projectId,
        intakeFormId: input.intakeFormId,
        requestId: input.requestId,
      });
      expect(result.draft.id).toBe(first.draft.id);
      expect(result.creation).toEqual(first.creation);
      expect(await counts()).toEqual(before);
    });
    it("returns not_found without creating a new intent or draft", async () => {
      const before = await counts();
      const result: any = await executeFinancialCalculator(runner, operator, {
        contractVersion: "calculator-v1",
        operation: "calculator.recover",
        projectId: fixture.ids.project,
        intakeFormId: fixture.ids.intake,
        requestId: randomUUID(),
      });
      expect(result.status).toBe("not_found");
      expect(result.draft).toBe(null);
      expect(result.creation).toBe(null);
      expect(await counts()).toEqual(before);
    });
    it("same request ID with changed quantity conflicts without duplicate audit", async () => {
      const input = create(await calculate(fixture.ids.a));
      await executeFinancialCalculator(runner, operator, input);
      const before = await counts();
      await expect(
        executeFinancialCalculator(runner, operator, {
          ...input,
          assemblies: [{ assemblyId: fixture.ids.a, quantity: 2 }],
        })
      ).rejects.toMatchObject({ code: "FINANCIAL_EXECUTOR_REQUEST_CONFLICT" });
      expect(await counts()).toEqual(before);
    });
    it("refuses stale source confirmation before any write", async () => {
      const input = create(await calculate(fixture.ids.a));
      const before = await counts();
      input.expectedSourceHash = "0".repeat(64);
      await expect(
        executeFinancialCalculator(runner, operator, input)
      ).rejects.toMatchObject({
        code: "FINANCIAL_EXECUTOR_CONFIRMATION_STALE",
      });
      expect(await counts()).toEqual(before);
    });
    it("refuses stale calculated confirmation before any write", async () => {
      const input = create(await calculate(fixture.ids.a));
      const before = await counts();
      input.expectedCalculationHash = "0".repeat(64);
      await expect(
        executeFinancialCalculator(runner, operator, input)
      ).rejects.toMatchObject({
        code: "FINANCIAL_EXECUTOR_CONFIRMATION_STALE",
      });
      expect(await counts()).toEqual(before);
    });
    it("rejects fabricated transaction and identity objects before a lifecycle callback", async () => {
      let called = false;
      await expect(
        withAuditLog({}, {}, async () => {
          called = true;
          return {};
        })
      ).rejects.toBeDefined();
      expect(called).toBe(false);
      await expect(
        executeFinancialCalculator(
          runner,
          {} as any,
          fixture.contextCommand as any
        )
      ).rejects.toMatchObject({ code: "EXECUTOR_UNAUTHORIZED" });
    });
    it("a post-write audit-helper readback failure aborts the entire creation", async () => {
      const simulation = await calculate(fixture.ids.a),
        input = create(simulation),
        before = await counts();
      await expect(
        runner.run(operator, input, async tx => {
          const snapshot = await loadCalculatorSnapshot(tx, input),
            calculation = await buildCalculatorResult(
              snapshot,
              command(fixture.ids.a)
            ),
            commandHash = await hashCalculatorCanonical(input);
          await withAuditLog(
            tx,
            {
              command: input,
              commandHash,
              binding: {
                id: fixture.ids.binding,
                actorId: fixture.ids.actor,
                tenantId: fixture.ids.tenant,
              },
              clientId: fixture.ids.client,
              calculation,
              policyContext: snapshot.policyContext,
            },
            async () => {
              const result = await callCalculatorRoutine(tx, "create", input, {
                calculation,
                commandHash,
              });
              result.receipt.audit.new_values.draft.subtotal_cost = 0;
              return result;
            }
          );
        })
      ).rejects.toMatchObject({ code: "FINANCIAL_EXECUTOR_RECEIPT_INVALID" });
      expect(await counts()).toEqual(before);
    });
    it("missing persisted receipt cannot be replaced by a callback's fabricated confirmation", async () => {
      const simulation = await calculate(fixture.ids.a),
        input = create(simulation),
        before = await counts();
      await expect(
        runner.run(operator, input, async tx =>
          withAuditLog(
            tx,
            {
              command: input,
              commandHash: await hashCalculatorCanonical(input),
              binding: {
                id: fixture.ids.binding,
                actorId: fixture.ids.actor,
                tenantId: fixture.ids.tenant,
              },
              clientId: fixture.ids.client,
            },
            async () => ({ receipt: null, currentDraft: null })
          )
        )
      ).rejects.toMatchObject({ code: "FINANCIAL_EXECUTOR_RECEIPT_INVALID" });
      expect(await counts()).toEqual(before);
    });
    it("retired operator cannot use recovery to read an already committed receipt", async () => {
      const input = create(await calculate(fixture.ids.a));
      await executeFinancialCalculator(runner, operator, input);
      const before = await counts();
      await lab.admin`update public.profiles set is_active=false where id=${fixture.ids.actor}`;
      try {
        await expect(
          executeFinancialCalculator(runner, operator, {
            contractVersion: "calculator-v1",
            operation: "calculator.recover",
            projectId: input.projectId,
            intakeFormId: input.intakeFormId,
            requestId: input.requestId,
          })
        ).rejects.toMatchObject({
          code: "FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH",
        });
        expect(await counts()).toEqual(before);
      } finally {
        await lab.admin`update public.profiles set is_active=true where id=${fixture.ids.actor}`;
      }
    });
    it("wrong project/intake pair is refused without returning source data", async () => {
      const before = await counts();
      await expect(
        executeFinancialCalculator(runner, operator, {
          ...fixture.contextCommand,
          intakeFormId: randomUUID(),
        } as any)
      ).rejects.toMatchObject({
        code: "FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH",
      });
      expect(await counts()).toEqual(before);
    });
    it("input cannot supply a tenant or an authoritative price", async () => {
      const before = await counts();
      await expect(
        executeFinancialCalculator(runner, operator, {
          ...command(fixture.ids.a),
          tenantId: fixture.ids.tenant,
          unitPrice: 1,
        })
      ).rejects.toMatchObject({ code: "FINANCIAL_EXECUTOR_INPUT_INVALID" });
      expect(await counts()).toEqual(before);
    });
    it("rejects an oversized physical BOM before calculating or forming a draft", async () => {
      const before = await counts();
      const rows =
        await lab.admin`insert into public.assembly_items(id,assembly_id,cost_code_id,cost_type_id,unit_id,description,default_qty_per_unit,waste_factor,component_type,unit_cost_override,is_optional,sort_order)
      select gen_random_uuid(),assembly_id,cost_code_id,cost_type_id,unit_id,'Synthetic overflow component',1,0,'material',null,false,n+1
      from public.assembly_items cross join generate_series(1,1000) n
      where assembly_id=${fixture.ids.a} returning id`;
      try {
        expect(rows).toHaveLength(1000);
        await expect(calculate(fixture.ids.a)).rejects.toMatchObject({
          code: "FINANCIAL_EXECUTOR_CAPACITY",
        });
        expect(await counts()).toEqual(before);
      } finally {
        await lab.admin`delete from public.assembly_items where id in ${lab.admin(rows.map(row => row.id))}`;
      }
    });
  }
);
