/** Test-only PG17 prerequisite probes; no deployable financial boundary. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { makeInternalApprovalSnapshot } from "./internal-estimate-approval-engine.fixtures";
import { startFinancialCalculatorProbe } from "./test-support/financial-calculator";

const enabled = process.env.FINANCIAL_CALCULATOR_PHYSICAL === "1";
describe.skipIf(!enabled)("ADR003 physical prerequisite probe", () => {
  let lab: Awaited<ReturnType<typeof startFinancialCalculatorProbe>>;
  beforeAll(async () => {
    lab = await startFinancialCalculatorProbe();
  }, 90_000);
  afterAll(async () => {
    if (!lab) return;
    const directory = lab.cluster.directory;
    await lab.cluster.stop();
    await expect(access(directory)).rejects.toMatchObject({ code: "ENOENT" });
    console.log(
      "FINANCIAL_PROBE_CLEANUP",
      JSON.stringify({ directory, removed: true })
    );
  }, 30_000);
  async function absent(id: string) {
    expect(
      await lab.admin`SELECT id FROM public.estimate_drafts WHERE id=${id}`
    ).toHaveLength(0);
  }
  it("uses a fresh PG17.11 login with no owner, bypass, inheritance or privileged membership", async () => {
    const [identity] = await lab.caller
      .sql`SELECT session_user, current_user, current_setting('server_version_num') AS version,
      inet_server_addr() AS address, current_setting('listen_addresses') AS listeners`;
    expect(identity).toEqual({
      session_user: "app_runtime",
      current_user: "app_runtime",
      version: "170011",
      address: null,
      listeners: "",
    });
    const [role] =
      await lab.admin`SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname='app_runtime'`;
    expect(role).toEqual({
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });
    expect(
      await lab.admin`SELECT 1 FROM pg_auth_members WHERE member IN ('app_runtime'::regrole,'financial_probe_owner'::regrole)`
    ).toHaveLength(0);
    const [owner] =
      await lab.admin`SELECT rolcanlogin, rolsuper, rolbypassrls, rolinherit, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname='financial_probe_owner'`;
    expect(owner).toEqual({
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
    });
    expect(
      await lab.admin`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND
      (has_table_privilege('app_runtime',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      OR has_any_column_privilege('app_runtime',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))`
    ).toHaveLength(0);
    expect(
      await lab.admin`SELECT 1 FROM pg_class WHERE relowner IN ('app_runtime'::regrole,'financial_probe_owner'::regrole) AND relkind IN ('r','p')`
    ).toHaveLength(0);
    expect(lab.caller.pid).not.toBe(lab.cluster.observer.pid);
  });
  it("records the real definer return, then fails COMMIT and leaves no draft when the check is not flushed", async () => {
    const id = randomUUID();
    let returned: any;
    await expect(
      lab.caller.db.transaction(
        async tx => {
          returned = (
            await tx.execute(
              sql`SELECT financial_calculator_probe.unflushed(${id}::uuid) AS result`
            )
          )[0].result;
        },
        { isolationLevel: "serializable" }
      )
    ).rejects.toMatchObject({ code: "42501" });
    expect(returned).toMatchObject({
      id,
      session: "app_runtime",
      owner: "financial_probe_owner",
    });
    await absent(id);
  });
  it("commits the real draft after the named constraint flush under the definer and final readback", async () => {
    const id = randomUUID();
    let receipt: any;
    const outcome = await lab.caller.db
      .transaction(
        async tx => {
          receipt = (
            await tx.execute(
              sql`SELECT financial_calculator_probe.write_draft(${id}::uuid) AS result`
            )
          )[0].result;
          return "committed";
        },
        { isolationLevel: "serializable" }
      )
      .catch((error: any) => error.code ?? error.cause?.code);
    expect(outcome).toBe("committed");
    expect(receipt).toMatchObject({
      id,
      session: "app_runtime",
      owner: "financial_probe_owner",
      row: { id, status: "draft", source: "assembly_calculator" },
    });
    expect(
      await lab.admin`SELECT id FROM public.estimate_drafts WHERE id=${id}`
    ).toEqual([{ id }]);
  });
  it.each([
    "SELECT * FROM public.estimate_drafts",
    "SELECT id FROM public.estimate_drafts",
    "INSERT INTO public.estimate_drafts(project_id) VALUES(gen_random_uuid())",
    "UPDATE public.estimate_drafts SET notes='forged'",
    "DELETE FROM public.estimate_drafts",
    "SELECT * FROM financial_calculator_probe.binding",
    "SET ROLE financial_probe_owner",
    "SET ROLE app_principal_runner",
    "SET ROLE postgres",
  ])("denies raw or role escalation: %s", async statement => {
    await expect(lab.caller.sql.unsafe(statement)).rejects.toMatchObject({
      code: "42501",
    });
  });
  it("forged GUCs cannot change the protected session binding", async () => {
    const id = randomUUID();
    const row = await lab.caller.db.transaction(
      async tx => {
        await tx.execute(
          sql`SELECT set_config('request.jwt.claims','{"sub":"forged","role":"service_role"}',true), set_config('app.tenant_id','forged',true)`
        );
        return (
          await tx.execute(
            sql`SELECT financial_calculator_probe.write_draft(${id}::uuid) AS result`
          )
        )[0].result;
      },
      { isolationLevel: "serializable" }
    );
    expect(row).toMatchObject({
      session: "app_runtime",
      row: { tenant_id: lab.context.tenant, created_by: lab.context.actor },
    });
  });
  it.each(["IMMEDIATE", "DEFERRED"])(
    "handles caller mode %s and two sequential writes on one real Drizzle connection",
    async mode => {
      const ids = [randomUUID(), randomUUID()];
      const points: any[] = [];
      await lab.caller.db.transaction(
        async tx => {
          await tx.execute(
            sql.raw(`SET CONSTRAINTS public.a1_draft_final ${mode}`)
          );
          points.push(
            (
              await tx.execute(
                sql`SELECT pg_backend_pid() AS pid, txid_current()::text AS txid, current_setting('transaction_isolation') AS isolation`
              )
            )[0]
          );
          for (const id of ids) {
            const receipt: any = (
              await tx.execute(
                sql`SELECT financial_calculator_probe.write_draft(${id}::uuid) AS result`
              )
            )[0].result;
            points.push({
              pid: receipt.pid,
              txid: receipt.txid,
              isolation: receipt.isolation,
            });
            await tx.execute(
              sql`SET CONSTRAINTS public.a1_draft_final DEFERRED`
            );
          }
          points.push(
            (
              await tx.execute(
                sql`SELECT pg_backend_pid() AS pid, txid_current()::text AS txid, current_setting('transaction_isolation') AS isolation`
              )
            )[0]
          );
        },
        { isolationLevel: "serializable" }
      );
      expect(points).toHaveLength(4);
      expect(
        points.every(
          p =>
            p.pid === lab.caller.pid &&
            p.txid === points[0].txid &&
            p.isolation === "serializable"
        )
      ).toBe(true);
      expect(
        await lab.admin`SELECT id FROM public.estimate_drafts WHERE id IN ${lab.admin(ids)}`
      ).toHaveLength(2);
    }
  );
  it("savepoint rollback discards a checked draft and leaves the next write committable", async () => {
    const rolled = randomUUID(),
      kept = randomUUID();
    await lab.caller.db.transaction(
      async tx => {
        await expect(
          tx.transaction(async nested => {
            await nested.execute(
              sql`SELECT financial_calculator_probe.write_draft(${rolled}::uuid)`
            );
            throw new Error("rollback savepoint");
          })
        ).rejects.toThrow("rollback savepoint");
        await tx.execute(
          sql`SELECT financial_calculator_probe.write_draft(${kept}::uuid)`
        );
      },
      { isolationLevel: "serializable" }
    );
    await absent(rolled);
    expect(
      await lab.admin`SELECT id FROM public.estimate_drafts WHERE id=${kept}`
    ).toEqual([{ id: kept }]);
  });
  it("a failure after the checked receipt rolls the whole Drizzle transaction back", async () => {
    const id = randomUUID();
    await expect(
      lab.caller.db.transaction(
        async tx => {
          await tx.execute(
            sql`SELECT financial_calculator_probe.write_draft(${id}::uuid)`
          );
          throw new Error("after receipt");
        },
        { isolationLevel: "serializable" }
      )
    ).rejects.toThrow("after receipt");
    await absent(id);
  });
  // These failures expose the SELECT * dependency of the existing A1 guard.
  it.each([
    [
      "missing draft column",
      "REVOKE SELECT(notes) ON public.estimate_drafts FROM financial_probe_owner",
      "GRANT SELECT(notes) ON public.estimate_drafts TO financial_probe_owner",
    ],
    [
      "missing evidence column",
      "REVOKE SELECT(reason) ON public.estimate_internal_approvals FROM financial_probe_owner",
      "GRANT SELECT(reason) ON public.estimate_internal_approvals TO financial_probe_owner",
    ],
    [
      "new evidence column",
      "ALTER TABLE public.estimate_internal_approval_revocations ADD COLUMN probe_extra text",
      "ALTER TABLE public.estimate_internal_approval_revocations DROP COLUMN probe_extra",
    ],
    [
      "missing row lock grant",
      "REVOKE UPDATE(id) ON public.estimate_drafts FROM financial_probe_owner",
      "GRANT UPDATE(id) ON public.estimate_drafts TO financial_probe_owner",
    ],
  ])("fails atomically on %s", async (_label, damage, restore) => {
    const id = randomUUID();
    await lab.admin.unsafe(damage);
    try {
      await expect(
        lab.caller
          .sql`SELECT financial_calculator_probe.write_draft(${id}::uuid)`
      ).rejects.toMatchObject({ code: "42501" });
      await absent(id);
    } finally {
      await lab.admin.unsafe(restore);
    }
  });
  it.each([
    [
      "absent evidence policy",
      "DROP POLICY financial_probe_read ON public.estimate_internal_approvals",
      "CREATE POLICY financial_probe_read ON public.estimate_internal_approvals FOR SELECT TO financial_probe_owner USING(true)",
    ],
    [
      "restrictive evidence policy",
      "CREATE POLICY probe_hidden ON public.estimate_internal_approvals AS RESTRICTIVE FOR SELECT TO financial_probe_owner USING(false)",
      "DROP POLICY probe_hidden ON public.estimate_internal_approvals",
    ],
  ])(
    "test fixture visibility guard refuses %s before returning a draft",
    async (_label, damage, restore) => {
      const id = randomUUID();
      await lab.admin.unsafe(damage);
      try {
        const outcome = await lab.caller
          .sql`SELECT financial_calculator_probe.write_draft(${id}::uuid)`.then(
          () => "returned draft",
          (error: any) => error.message
        );
        expect(outcome).toBe("FINANCIAL_PROBE_VISIBILITY_UNPROVEN");
        await absent(id);
      } finally {
        await lab.admin.unsafe(restore);
      }
    }
  );
  it("denies direct primitive execution even though its trigger runs inside the definer", async () => {
    await expect(
      lab.caller.sql`SELECT public.internal_approval_trim_v1(' x ')`
    ).rejects.toMatchObject({ code: "42501" });
    await lab.admin.unsafe(
      "GRANT EXECUTE ON FUNCTION public.internal_approval_trim_v1(text) TO PUBLIC"
    );
    try {
      expect(
        await lab.caller
          .sql`SELECT public.internal_approval_trim_v1(' x ') AS value`
      ).toEqual([{ value: "x" }]);
    } finally {
      await lab.admin.unsafe(
        "REVOKE EXECUTE ON FUNCTION public.internal_approval_trim_v1(text) FROM PUBLIC"
      );
    }
    await expect(
      lab.caller.sql`SELECT public.internal_approval_trim_v1(' x ')`
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("a hostile PUBLIC column grant exposes raw data despite no SELECT table ACL", async () => {
    await lab.caller
      .sql`SELECT financial_calculator_probe.write_draft(${randomUUID()}::uuid)`;
    await lab.admin.unsafe(
      "GRANT SELECT(id) ON public.estimate_drafts TO PUBLIC"
    );
    try {
      expect(
        await lab.caller.sql`SELECT id FROM public.estimate_drafts`
      ).not.toHaveLength(0);
      const [privileges] =
        await lab.admin`SELECT has_table_privilege('app_runtime','public.estimate_drafts','SELECT') AS table_select,
        has_column_privilege('app_runtime','public.estimate_drafts','id','SELECT') AS column_select`;
      expect(privileges).toEqual({ table_select: false, column_select: true });
      await expect(
        lab.caller.sql`SELECT notes FROM public.estimate_drafts`
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await lab.admin.unsafe(
        "REVOKE SELECT(id) ON public.estimate_drafts FROM PUBLIC"
      );
    }
    await expect(
      lab.caller.sql`SELECT id FROM public.estimate_drafts`
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("NOINHERIT alone does not prevent a hostile SET-enabled role from exposing data", async () => {
    await lab.caller
      .sql`SELECT financial_calculator_probe.write_draft(${randomUUID()}::uuid)`;
    await lab.admin.unsafe(
      "CREATE ROLE probe_reader NOLOGIN; GRANT USAGE ON SCHEMA public TO probe_reader; GRANT SELECT(id) ON public.estimate_drafts TO probe_reader; GRANT probe_reader TO app_runtime WITH INHERIT FALSE, SET TRUE"
    );
    try {
      await expect(
        lab.caller.sql`SELECT id FROM public.estimate_drafts`
      ).rejects.toMatchObject({ code: "42501" });
      await lab.caller.sql.unsafe("SET ROLE probe_reader");
      expect(
        await lab.caller.sql`SELECT id FROM public.estimate_drafts`
      ).not.toHaveLength(0);
      expect(await lab.caller.sql`SELECT session_user, current_user`).toEqual([
        { session_user: "app_runtime", current_user: "probe_reader" },
      ]);
    } finally {
      await lab.caller.sql.unsafe("RESET ROLE");
      await lab.admin.unsafe(
        "REVOKE probe_reader FROM app_runtime; DROP OWNED BY probe_reader; DROP ROLE probe_reader"
      );
    }
    await expect(
      lab.caller.sql.unsafe("SET ROLE financial_probe_owner")
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("a hostile default grant exposes newly created tables and is visible only after expansion", async () => {
    await lab.admin.unsafe(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA financial_calculator_probe GRANT SELECT ON TABLES TO app_runtime; CREATE TABLE financial_calculator_probe.default_drift(value text); INSERT INTO financial_calculator_probe.default_drift VALUES('synthetic exposed')"
    );
    try {
      expect(
        await lab.caller
          .sql`SELECT * FROM financial_calculator_probe.default_drift`
      ).toEqual([{ value: "synthetic exposed" }]);
    } finally {
      await lab.admin.unsafe(
        "DROP TABLE financial_calculator_probe.default_drift; ALTER DEFAULT PRIVILEGES IN SCHEMA financial_calculator_probe REVOKE SELECT ON TABLES FROM app_runtime"
      );
    }
  });
  it("NULL function ACL means PUBLIC execution and an unknown definer can expose raw rows", async () => {
    await lab.caller
      .sql`SELECT financial_calculator_probe.write_draft(${randomUUID()}::uuid)`;
    await lab.admin.unsafe(
      "CREATE FUNCTION public.probe_unknown_definer() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT count(*) FROM public.estimate_drafts'"
    );
    try {
      const [catalog] =
        await lab.admin`SELECT proacl IS NULL AS default_acl FROM pg_proc WHERE oid='public.probe_unknown_definer()'::regprocedure`;
      expect(catalog.default_acl).toBe(true);
      const [exposed] = await lab.caller
        .sql`SELECT public.probe_unknown_definer()::integer AS count`;
      expect(exposed.count).toBeGreaterThan(0);
      await lab.admin.unsafe(
        "REVOKE EXECUTE ON FUNCTION public.probe_unknown_definer() FROM PUBLIC"
      );
      await expect(
        lab.caller.sql`SELECT public.probe_unknown_definer()`
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await lab.admin.unsafe("DROP FUNCTION public.probe_unknown_definer()");
    }
  });

  it.each([false, true])(
    "real staged contradictory evidence is visible or explicitly refused (restrictive=%s)",
    async hidden => {
      const id = randomUUID();
      await lab.caller
        .sql`SELECT financial_calculator_probe.write_draft(${id}::uuid)`;
      const payload = makeInternalApprovalSnapshot();
      payload.identity = {
        tenantId: lab.context.tenant,
        projectId: lab.context.project,
        clientId: lab.context.client,
        estimateDraftId: id,
        draftVersion: 1,
      };
      payload.commercialContext.policyContext.projectGeo.zoneTenantId =
        lab.context.tenant;
      const evaluation = {
        version: "internal-approval-evaluation-v1",
        policyVersion: "phase2-channel-geo-plus-tenant-exact-v1",
        policyHash: "b".repeat(64),
        commercialChannel: "premium",
        geoRiskClass: "coastal",
        floorKind: "margin",
        effectiveFloorPct: "42",
        priceMinor: "10000",
        costMinor: "4000",
        profitMinor: "6000",
        passed: true,
        violations: [],
        warnings: [],
      };
      // Temporary admin definer exists only to stage real incomplete evidence in the
      // SAME restricted-login transaction. It is removed after this probe; no shared
      // trigger, constraint, FK, or RLS enforcement is disabled to manufacture a row.
      await lab.admin.unsafe(
        await readFile(
          new URL(
            "./test-support/financial-calculator/contradiction.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
      if (hidden)
        await lab.admin.unsafe(
          "CREATE POLICY probe_hidden ON public.estimate_internal_approval_snapshots AS RESTRICTIVE FOR SELECT TO financial_probe_owner USING(false)"
        );
      let staged: any,
        visible: any,
        returned = false;
      try {
        const error = await lab.caller.db
          .transaction(
            async tx => {
              staged = (
                await tx.execute(
                  sql`SELECT financial_calculator_probe.stage_contradiction(${id}::uuid,${JSON.stringify(payload)}::jsonb,${JSON.stringify(evaluation)}::jsonb) AS id`
                )
              )[0].id;
              visible = (
                await tx.execute(
                  sql`SELECT financial_calculator_probe.visible_evidence(${id}::uuid) AS count`
                )
              )[0].count;
              await tx.execute(
                sql`SELECT financial_calculator_probe.check_draft(${id}::uuid)`
              );
              returned = true;
            },
            { isolationLevel: "serializable" }
          )
          .then(
            () => null,
            (error: any) => error.cause ?? error
          );
        expect(staged).toMatch(/^[0-9a-f-]{36}$/);
        expect(visible).toBe(hidden ? 0 : 1);
        expect(returned).toBe(false);
        expect(error).toMatchObject(
          hidden
            ? { code: "42501", message: "FINANCIAL_PROBE_VISIBILITY_UNPROVEN" }
            : { code: "23514", message: "A1_DECISION_STATE_MISMATCH" }
        );
        expect(
          await lab.admin`SELECT id FROM public.estimate_internal_approval_snapshots WHERE estimate_draft_id=${id}`
        ).toHaveLength(0);
        expect(
          await lab.admin`SELECT status FROM public.estimate_drafts WHERE id=${id}`
        ).toEqual([{ status: "draft" }]);
      } finally {
        if (hidden)
          await lab.admin.unsafe(
            "DROP POLICY probe_hidden ON public.estimate_internal_approval_snapshots"
          );
        await lab.admin.unsafe(
          "DROP FUNCTION financial_calculator_probe.stage_contradiction(uuid,jsonb,jsonb); DROP FUNCTION financial_calculator_probe.visible_evidence(uuid); DROP FUNCTION financial_calculator_probe.check_draft(uuid)"
        );
      }
    }
  );

  it("explicit inherited membership can restore raw access even when the login has NOINHERIT", async () => {
    const id = randomUUID();
    await lab.caller
      .sql`SELECT financial_calculator_probe.write_draft(${id}::uuid)`;
    await lab.admin.unsafe(
      "CREATE ROLE probe_inherited NOLOGIN; GRANT SELECT(id) ON public.estimate_drafts TO probe_inherited; GRANT probe_inherited TO app_runtime WITH INHERIT TRUE, SET FALSE"
    );
    try {
      expect(
        await lab.caller
          .sql`SELECT id FROM public.estimate_drafts WHERE id=${id}`
      ).toEqual([{ id }]);
      await expect(
        lab.caller.sql.unsafe("SET ROLE probe_inherited")
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await lab.admin.unsafe(
        "REVOKE probe_inherited FROM app_runtime; DROP OWNED BY probe_inherited; DROP ROLE probe_inherited"
      );
    }
    await expect(
      lab.caller.sql`SELECT id FROM public.estimate_drafts`
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("a second fresh LOGIN cannot forge the allowed session by setting role/tenant GUCs", async () => {
    const denied = await lab.cluster.connect(
      "financial-calculator-unbound-login",
      "app_denied"
    );
    await denied.sql`SELECT set_config('request.jwt.claims','{"role":"app_runtime"}',false), set_config('app.tenant_id',${lab.context.tenant},false)`;
    expect(await denied.sql`SELECT session_user, current_user`).toEqual([
      { session_user: "app_denied", current_user: "app_denied" },
    ]);
    await expect(
      denied.sql`SELECT financial_calculator_probe.write_draft(${randomUUID()}::uuid)`
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      denied.sql.unsafe("SET ROLE app_runtime")
    ).rejects.toMatchObject({ code: "42501" });
  });
});
