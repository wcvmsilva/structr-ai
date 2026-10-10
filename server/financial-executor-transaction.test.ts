import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { startAppPrincipalPostgres, type AppPrincipalCluster } from "./test-support/app-principal-postgres";
import { executorTestConfig, EXECUTOR_TEST_NOW_MS, signedExecutorOperator } from "./test-support/financial-executor-auth";
import { createExecutorTransactionRunner, assertExecutorTransaction, callCalculatorRoutine } from "../services/financial-executor/src/transaction";

const enabled = process.env.FINANCIAL_EXECUTOR_TX_PHYSICAL === "1";
const projectId = "55555555-5555-4555-8555-555555555555", intakeFormId = "66666666-6666-4666-8666-666666666666";
const command = { contractVersion:"calculator-v1", operation:"calculator.create", projectId,intakeFormId,requestId:"77777777-7777-4777-8777-777777777777",assemblies:[{assemblyId:"88888888-8888-4888-8888-888888888888",quantity:1}],expectedSourceHash:"a".repeat(64),expectedCalculationHash:"b".repeat(64) };
describe.skipIf(!enabled)("executor transaction transport on owned PostgreSQL17", () => {
  let cluster: AppPrincipalCluster, connection: Awaited<ReturnType<AppPrincipalCluster["connect"]>>;
  beforeAll(async () => {
    cluster = await startAppPrincipalPostgres(postgres);
    await cluster.observer.sql.unsafe(`
      CREATE ROLE structr_calculator_login_v1 LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE SCHEMA structr_financial;
      CREATE TABLE structr_financial.tx_probe (id integer GENERATED ALWAYS AS IDENTITY, value text);
      CREATE SEQUENCE structr_financial.retry_probe;
      CREATE FUNCTION structr_financial.calculator_context_v1(command jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
        SELECT jsonb_build_object('contractVersion','calculator-v1','binding',jsonb_build_object('id','99999999-9999-4999-8999-999999999999','sessionRole',session_user,'subject','11111111-1111-4111-8111-111111111111','actorId','22222222-2222-4222-8222-222222222222','tenantId','33333333-3333-4333-8333-333333333333','operations',jsonb_build_array('calculator.context','calculator.calculate','calculator.create','calculator.recover')),'transaction',jsonb_build_object('backendPid',pg_backend_pid(),'transactionId',pg_current_xact_id()::text),'projectId',command->>'projectId','intakeFormId',command->>'intakeFormId','clientId','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','options',jsonb_build_array())
      $$;
      CREATE FUNCTION structr_financial.calculator_create_v1(command jsonb,result jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        IF result->>'mode'='sleep' THEN PERFORM pg_sleep(1); END IF;
        IF result->>'mode'='retry' AND nextval('structr_financial.retry_probe') < 3 THEN RAISE EXCEPTION 'retry' USING ERRCODE='40001'; END IF;
        IF result->>'mode'='always_retry' THEN RAISE EXCEPTION 'retry' USING ERRCODE='40P01'; END IF;
        IF result->>'mode'='fail' THEN RAISE EXCEPTION 'private SQL secret' USING ERRCODE='23514'; END IF;
        INSERT INTO structr_financial.tx_probe(value) VALUES(result->>'value');
        RETURN structr_financial.calculator_context_v1(command) || jsonb_build_object('saved',true);
      END $$;
      REVOKE ALL ON SCHEMA structr_financial FROM PUBLIC;
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA structr_financial FROM PUBLIC;
      GRANT USAGE ON SCHEMA structr_financial TO structr_calculator_login_v1;
      GRANT EXECUTE ON FUNCTION structr_financial.calculator_context_v1(jsonb),structr_financial.calculator_create_v1(jsonb,jsonb) TO structr_calculator_login_v1;
    `);
    connection = await cluster.connect("executor-tx", "structr_calculator_login_v1");
  }, 30000);
  afterAll(async () => cluster?.stop());
  const runner = (extra: Record<string,unknown> = {}, config = executorTestConfig) => createExecutorTransactionRunner(config,{database:connection.db,nowMs:()=>EXECUTOR_TEST_NOW_MS,...extra});
  const count = async (value:string) => Number((await cluster.observer.sql`select count(*) as n from structr_financial.tx_probe where value=${value}`)[0].n);

  it("uses one real serializable read-write PID/xact through commit", async () => {
    const identity=await signedExecutorOperator(); let txSeen:unknown;
    const result=await runner().run(identity,command,async (tx:any) => { txSeen=tx; const before=assertExecutorTransaction(tx); const saved=await callCalculatorRoutine(tx,"create",command,{value:"committed"}); expect(saved.transaction.backendPid).toBe(before.backendPid); expect(saved.transaction.transactionId).toBe(before.transactionId); return saved.saved; });
    expect(result).toBe(true); expect(await count("committed")).toBe(1);
    expect(()=>assertExecutorTransaction(txSeen)).toThrow();
  });
  it("refuses a fabricated transaction handle before SQL", async()=>{
    await expect(callCalculatorRoutine({kind:"financial-executor-transaction"},"create",command,{value:"forged"})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_TRANSACTION_INVALID"}); expect(await count("forged")).toBe(0);
  });
  it("refuses a fabricated verified identity before callback", async()=>{
    let entered=false; await expect(runner().run({subject:executorTestConfig.auth.operatorSubject},command,async()=>{entered=true;})).rejects.toMatchObject({code:"EXECUTOR_UNAUTHORIZED"}); expect(entered).toBe(false);
  });
  it("rolls back a lifecycle failure after a real INSERT",async()=>{
    const fresh=await cluster.connect("unknown-lifecycle-error","structr_calculator_login_v1");
    await expect(runner({database:fresh.db}).run(await signedExecutorOperator(),command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{value:"rollback"}); throw new Error("private failure");})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DATABASE_FAILURE"}); expect(await count("rollback")).toBe(0);
  });
  it("retries the complete transaction for serialization failure only",async()=>{
    await cluster.observer.sql`select setval('structr_financial.retry_probe',1,false)`;
    let attempts=0; await runner().run(await signedExecutorOperator(),command,async(tx:any)=>{attempts++;await callCalculatorRoutine(tx,"create",command,{mode:"retry",value:"retried"});}); expect(attempts).toBe(3); expect(await count("retried")).toBe(1);
  });
  it.each([0.01,33.33333333333333])("transports finite decimal financial JSON without changing the integer hash grammar (%s)",async value=>{
    await runner().run(await signedExecutorOperator(),command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{value:`decimal-${value}`,financial:value});});expect(await count(`decimal-${value}`)).toBe(1);
  });
  it("stops after three whole deadlock attempts",async()=>{
    let attempts=0; await expect(runner().run(await signedExecutorOperator(),command,async(tx:any)=>{attempts++;await callCalculatorRoutine(tx,"create",command,{mode:"always_retry",value:"never"});})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DATABASE_FAILURE"}); expect(attempts).toBe(3);expect(await count("never")).toBe(0);
  });
  it("does not retry a non-serialization SQL error or expose its text",async()=>{
    let attempts=0;const error=await runner().run(await signedExecutorOperator(),command,async(tx:any)=>{attempts++;await callCalculatorRoutine(tx,"create",command,{mode:"fail"});}).catch((e:unknown)=>e); expect(attempts).toBe(1);expect(error).toMatchObject({code:"FINANCIAL_EXECUTOR_DATABASE_FAILURE"});expect(String(error)).not.toContain("private SQL secret");
  });
  it("refuses an admin connection despite a valid human JWT",async()=>{
    let entered=false;await expect(runner({database:cluster.observer.db}).run(await signedExecutorOperator(),command,async()=>{entered=true;})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH"});expect(entered).toBe(false);
  });
  it("checks expiry again before the write and rolls back",async()=>{
    let now=EXECUTOR_TEST_NOW_MS;const identity=await signedExecutorOperator({nowMs:()=>now,expiresAtMs:now+1000});await expect(runner({nowMs:()=>now}).run(identity,command,async(tx:any)=>{now+=1001;await callCalculatorRoutine(tx,"create",command,{value:"expired"});})).rejects.toMatchObject({code:"EXECUTOR_UNAUTHORIZED"});expect(await count("expired")).toBe(0);
  });
  it("checks expiry before commit even when lifecycle already inserted",async()=>{
    let now=EXECUTOR_TEST_NOW_MS;const identity=await signedExecutorOperator({nowMs:()=>now,expiresAtMs:now+1000});await expect(runner({nowMs:()=>now}).run(identity,command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{value:"expired-at-end"});now+=1001;})).rejects.toMatchObject({code:"EXECUTOR_UNAUTHORIZED"});expect(await count("expired-at-end")).toBe(0);
  });
  it("a PostgreSQL total timeout terminates and rolls back before returning",async()=>{
    const short={...executorTestConfig,timeouts:{totalMs:120,statementMs:80,lockMs:40}} as unknown as typeof executorTestConfig;
    const fresh=await cluster.connect("idle-deadline","structr_calculator_login_v1");
    await expect(runner({database:fresh.db},short).run(await signedExecutorOperator(),command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{value:"deadline"});await new Promise(resolve=>setTimeout(resolve,180));})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DEADLINE"});expect(await count("deadline")).toBe(0);
  });
  it("a statement timeout aborts the operation without a delayed INSERT",async()=>{
    const short={...executorTestConfig,timeouts:{totalMs:800,statementMs:70,lockMs:40}} as unknown as typeof executorTestConfig;
    await expect(runner({},short).run(await signedExecutorOperator(),command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{mode:"sleep",value:"statement-timeout"});})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DEADLINE"});expect(await count("statement-timeout")).toBe(0);
  });
  it("a late long SQL statement is cancelled before the transaction safety deadline",async()=>{
    const short={...executorTestConfig,timeouts:{totalMs:250,statementMs:180,lockMs:60}} as unknown as typeof executorTestConfig;
    const fresh=await cluster.connect("late-statement","structr_calculator_login_v1");
    const started=performance.now();
    await expect(runner({database:fresh.db},short).run(await signedExecutorOperator(),command,async(tx:any)=>{await new Promise(resolve=>setTimeout(resolve,160));await callCalculatorRoutine(tx,"create",command,{mode:"sleep",value:"late-sql"});})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DEADLINE"});expect(performance.now()-started).toBeLessThan(280);expect(await count("late-sql")).toBe(0);
  });
  it("refuses using a handle from another active operation",async()=>{
    const identity=await signedExecutorOperator();const other=await cluster.connect("other-operation","structr_calculator_login_v1");
    await runner().run(identity,command,async(tx:any)=>{await createExecutorTransactionRunner(executorTestConfig,{database:other.db,nowMs:()=>EXECUTOR_TEST_NOW_MS}).run(identity,command,async()=>{await expect(callCalculatorRoutine(tx,"create",command,{value:"cross-operation"})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_TRANSACTION_INVALID"});});}); expect(await count("cross-operation")).toBe(0);
  });
  it("refuses changing the command within a transaction",async()=>{
    await runner().run(await signedExecutorOperator(),command,async(tx:any)=>{await expect(callCalculatorRoutine(tx,"create",{...command,projectId:intakeFormId},{value:"changed-command"})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_TRANSACTION_INVALID"});});expect(await count("changed-command")).toBe(0);
  });
  it("enforces bounded capacity without queueing a third operation",async()=>{
    const first=await cluster.connect("capacity-one","structr_calculator_login_v1"),second=await cluster.connect("capacity-two","structr_calculator_login_v1");
    const databases=[first.db,second.db];const r=runner({database:undefined,createDatabase:()=>databases.shift()!});
    const identity=await signedExecutorOperator();let entered=0;let release!:()=>void;const block=new Promise<void>(resolve=>release=resolve);
    try {const one=r.run(identity,command,async()=>{entered++;await block;});const two=r.run(identity,command,async()=>{entered++;await block;});while(entered<1)await new Promise(resolve=>setTimeout(resolve,5));await expect(r.run(identity,command,async()=>{})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_CAPACITY"});release();await Promise.all([one,two]);expect(entered).toBe(2);}finally{release();}
  });
  it("cancels stalled acquisition without closing another slot, then replaces the failed slot",async()=>{
    const connections=await Promise.all([cluster.connect("acquire-one","structr_calculator_login_v1"),cluster.connect("acquire-two","structr_calculator_login_v1"),cluster.connect("acquire-replacement","structr_calculator_login_v1")]);
    const first=connections[0],ordinary=first.db.transaction.bind(first.db);let delayed=true;
    // A real PG statement delays initialization before the business callback.
    first.db.transaction=((fn:any,options:any)=>ordinary(async tx=>{if(delayed){delayed=false;await tx.execute(sql`select pg_advisory_xact_lock(723901), pg_sleep(1)`);}return fn(tx);},options)) as typeof first.db.transaction;
    const databases=connections.map(c=>c.db);const r=runner({database:first.db,createDatabase:()=>databases.shift()!});
    const identity=await signedExecutorOperator(),started=performance.now();
    const slow=r.run(identity,command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{value:"cancelled-acquisition"});},{deadline:performance.now()+100});
    const healthy=r.run(identity,command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{value:"other-slot"});return "healthy";});
    void Promise.allSettled([slow,healthy]);
    await expect(slow).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DEADLINE"});expect(performance.now()-started).toBeLessThan(350);
    await cluster.observer.sql`select pg_stat_clear_snapshot()`;
    expect(await cluster.observer.sql`select pid from pg_stat_activity where pid=${first.pid} and state in ('active','idle in transaction','idle in transaction (aborted)')`).toEqual([]);
    expect(await cluster.observer.sql`select pid from pg_locks where pid=${first.pid}`).toEqual([]);
    expect(await healthy).toBe("healthy");
    await r.run(identity,command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{value:"replacement-slot"});});
    expect(await count("cancelled-acquisition")).toBe(0);expect(await count("other-slot")).toBe(1);expect(await count("replacement-slot")).toBe(1);await r.close();
  });
  it("bounds cleanup and contains a failed CancelRequest connection without resubmitting",async()=>{
    const fresh=await cluster.connect("cancel-channel-failure","structr_calculator_login_v1");
    const ordinary=fresh.db.transaction.bind(fresh.db);
    fresh.db.transaction=((fn:any,options:any)=>ordinary(async tx=>{await tx.execute(sql`select pg_sleep(1)`);return fn(tx);},options)) as typeof fresh.db.transaction;
    // The already-connected query socket is unchanged. Only a newly opened
    // cancellation socket reaches this nonexistent path inside our owned cluster.
    const options=fresh.sql.options as typeof fresh.sql.options & {path:string};
    const originalPath=options.path;options.path=`${cluster.directory}/absent-cancel-socket`;
    const r=runner({database:fresh.db});let entered=false;
    try {
      const started=performance.now();
      await expect(r.run(await signedExecutorOperator(),command,async(tx:any)=>{entered=true;await callCalculatorRoutine(tx,"create",command,{value:"cancel-transport-failed"});},{deadline:performance.now()+100})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DEADLINE"});
      expect(performance.now()-started).toBeLessThan(250);
      expect(entered).toBe(false);
      await new Promise(resolve=>setTimeout(resolve,1100));
      expect(await count("cancel-transport-failed")).toBe(0);
      await expect(r.run(await signedExecutorOperator(),command,async()=>{})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_CAPACITY"});
    } finally {options.path=originalPath;await r.close();}
  });
  it("quarantines an unacknowledged cancellation instead of replacing a still-active backend",async()=>{
    const connections=await Promise.all([cluster.connect("uncertain-one","structr_calculator_login_v1"),cluster.connect("uncertain-two","structr_calculator_login_v1"),cluster.connect("uncertain-spare","structr_calculator_login_v1")]);
    const first=connections[0],ordinary=first.db.transaction.bind(first.db);
    first.db.transaction=((fn:any,options:any)=>ordinary(async tx=>{await tx.execute(sql`select pg_sleep(3)`);return fn(tx);},options)) as typeof first.db.transaction;
    const options=first.sql.options as typeof first.sql.options & {path:string},originalPath=options.path;
    options.path=`${cluster.directory}/absent-quarantine-cancel-socket`;
    const databases=connections.map(connection=>connection.db),r=runner({database:undefined,createDatabase:()=>databases.shift()!});
    const identity=await signedExecutorOperator();
    let release!:()=>void,entered!:()=>void;
    const block=new Promise<void>(resolve=>release=resolve),healthyEntered=new Promise<void>(resolve=>entered=resolve);
    const slow=r.run(identity,command,async()=>{}, {deadline:performance.now()+120});
    const healthy=r.run(identity,command,async()=>{entered();await block;return "healthy";});
    void Promise.allSettled([slow,healthy]);
    try {
      await healthyEntered;
      await expect(slow).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DEADLINE"});
      await cluster.observer.sql`select pg_stat_clear_snapshot()`;
      expect(await cluster.observer.sql`select pid from pg_stat_activity where pid=${first.pid} and state='active'`).toEqual([{pid:first.pid}]);
      await expect(r.run(identity,command,async(tx:any)=>{await callCalculatorRoutine(tx,"create",command,{value:"uncertain-replacement"});})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_CAPACITY"});
      expect(await count("uncertain-replacement")).toBe(0);
    } finally {release();await healthy;options.path=originalPath;await r.close();}
  });
  it("quarantines an uncertain main-connection failure that happens before its deadline",async()=>{
    const connections=await Promise.all([cluster.connect("early-loss-one","structr_calculator_login_v1"),cluster.connect("early-loss-two","structr_calculator_login_v1")]);
    const first=connections[0],ordinary=first.db.transaction.bind(first.db);
    first.db.transaction=((fn:any,options:any)=>ordinary(async tx=>{await tx.execute(sql`select pg_sleep(3)`);return fn(tx);},options)) as typeof first.db.transaction;
    const databases=connections.map(connection=>connection.db),r=runner({database:undefined,createDatabase:()=>databases.shift()!});
    const identity=await signedExecutorOperator();let release!:()=>void,entered!:()=>void;
    const block=new Promise<void>(resolve=>release=resolve),healthyEntered=new Promise<void>(resolve=>entered=resolve);
    const lost=r.run(identity,command,async()=>{}),healthy=r.run(identity,command,async()=>{entered();await block;});
    void Promise.allSettled([lost,healthy]);
    try {
      await healthyEntered;
      const until=performance.now()+1000;
      while(true){await cluster.observer.sql`select pg_stat_clear_snapshot()`;const rows=await cluster.observer.sql`select pid from pg_stat_activity where pid=${first.pid} and wait_event='PgSleep'`;if(rows.length)break;if(performance.now()>until)throw new Error("Owned backend did not reach its query");await new Promise(resolve=>setTimeout(resolve,5));}
      await first.sql.end({timeout:0});
      await expect(lost).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_DATABASE_FAILURE"});
      await cluster.observer.sql`select pg_stat_clear_snapshot()`;
      expect(await cluster.observer.sql`select pid from pg_stat_activity where pid=${first.pid} and state='active'`).toEqual([{pid:first.pid}]);
      await expect(r.run(identity,command,async()=>{})).rejects.toMatchObject({code:"FINANCIAL_EXECUTOR_CAPACITY"});
    } finally {release();await healthy;await r.close();}
  });
});
