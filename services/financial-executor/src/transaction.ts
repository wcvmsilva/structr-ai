import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { assertVerifiedExecutorOperator, ExecutorAuthError, type VerifiedExecutorOperator } from "./auth";
import type { FinancialExecutorConfig } from "./config";
import { CALCULATOR_ERROR_CODES,FINANCIAL_EXECUTOR_ERROR_CODES,CALCULATOR_OPERATIONS, CALCULATOR_PROTOCOL } from "../../../shared/domain/taxonomy";
import { CalculatorError,calculatorContextCommandSchema, calculatorCalculateCommandSchema, calculatorCreateCommandSchema, calculatorRecoverCommandSchema, canonicalizeCalculator, type CalculatorContextCommand, type CalculateCommand, type CreateCalculatorCommand, type RecoverCalculatorCommand } from "../../../shared/financial-calculator-engine";
import { FinancialExecutorError } from "../../../shared/financial-executor-error";
import { serializeExecutorJson } from "../../../shared/financial-executor-json";

export type ExecutorCommand = CalculatorContextCommand | CalculateCommand | CreateCalculatorCommand | RecoverCalculatorCommand;
declare const transactionBrand: unique symbol;
export type ExecutorTransaction = Readonly<{ [transactionBrand]: true }>;
type RealTransaction = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
const authoritySchema = z.object({ id:z.string().uuid(), sessionRole:z.string(), subject:z.string().uuid(), actorId:z.string().uuid(), tenantId:z.string().uuid(), operations:z.array(z.enum(CALCULATOR_OPERATIONS)).min(1).max(4) }).strict();
export type ExecutorBinding = z.infer<typeof authoritySchema>;
interface Metadata { [key:string]:unknown; backendPid:number; transactionId:string; sessionRole:string; currentRole:string; isolation:string; readOnly:string; serverVersion:number }
interface State {
  tx:RealTransaction; operator:VerifiedExecutorOperator; config:FinancialExecutorConfig; command:ExecutorCommand; commandCanonical:string;
  nowMs:()=>number; deadline:number;workDeadline:number; active:boolean; metadata:Metadata; binding?:ExecutorBinding; clientId?:string;
}
const transactions = new WeakMap<object, State>();
const currentTransaction = new AsyncLocalStorage<ExecutorTransaction>();
function invalid():never { throw new FinancialExecutorError("FINANCIAL_EXECUTOR_TRANSACTION_INVALID"); }
function stateOf(handle:unknown):State {
  if (typeof handle !== "object" || handle === null || currentTransaction.getStore() !== handle) invalid();
  const state=transactions.get(handle);
  if (!state?.active) invalid();
  if (performance.now() >= state.deadline) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_DEADLINE");
  assertVerifiedExecutorOperator(state.operator,state.nowMs());
  return state;
}
function remaining(deadline:number):number {
  const ms=Math.floor(deadline-performance.now());
  if (ms<1) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_DEADLINE");
  return ms; // PostgreSQL treats zero as disabled: never emit it.
}
async function metadata(tx:RealTransaction):Promise<Metadata> {
  const rows=await tx.execute<Metadata>(sql`select pg_backend_pid() as "backendPid", pg_current_xact_id()::text as "transactionId", session_user::text as "sessionRole", current_user::text as "currentRole", current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as "readOnly", current_setting('server_version_num')::integer as "serverVersion"`);
  if(rows.length!==1) invalid();
  return rows[0];
}
function checkMetadata(actual:Metadata, config:FinancialExecutorConfig, previous?:Metadata):void {
  if(actual.sessionRole!==config.database.username || actual.currentRole!==config.database.username) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH");
  if(actual.isolation!=="serializable" || actual.readOnly!=="off" || actual.serverVersion!==170011 || !Number.isSafeInteger(actual.backendPid) || !/^\d+$/.test(actual.transactionId)) invalid();
  if(previous && (actual.backendPid!==previous.backendPid || actual.transactionId!==previous.transactionId)) invalid();
}
async function armStatement(state:State) {
  const budget=remaining(state.workDeadline);
  await state.tx.execute(sql`select set_config('statement_timeout',${String(Math.min(state.config.timeouts.statementMs,budget))},true),set_config('lock_timeout',${String(Math.min(state.config.timeouts.lockMs,budget))},true)`);
}
/** No connection or raw SQL capability escapes through this projection. */
export function assertExecutorTransaction(handle:unknown) {
  const state=stateOf(handle);
  if(!state.binding || !state.clientId) invalid();
  return Object.freeze({backendPid:state.metadata.backendPid,transactionId:state.metadata.transactionId,binding:structuredClone(state.binding),clientId:state.clientId,command:structuredClone(state.command)});
}
type Routine = "context" | "snapshot" | "create" | "recover";
/** Fixed signatures only; neither HTTP input nor lifecycle callbacks select SQL text. */
export async function callCalculatorRoutine(handle:ExecutorTransaction,routine:Routine,command:ExecutorCommand,result?:unknown):Promise<Record<string,any>> {
  const s=stateOf(handle);
  if(canonicalizeCalculator(command)!==s.commandCanonical) invalid();
  if(routine==="create" && command.operation!==CALCULATOR_OPERATIONS[2]) invalid();
  if(routine==="recover" && command.operation!==CALCULATOR_OPERATIONS[2] && command.operation!==CALCULATOR_OPERATIONS[3]) invalid();
  if(routine==="snapshot" && command.operation!==CALCULATOR_OPERATIONS[1] && command.operation!==CALCULATOR_OPERATIONS[2]) invalid();
  await armStatement(s);checkMetadata(await metadata(s.tx),s.config,s.metadata);
  stateOf(handle);
  const payload=canonicalizeCalculator(command);
  const statement=routine==="context" ? sql`select structr_financial.calculator_context_v1(${payload}::jsonb) as result`
    : routine==="snapshot" ? sql`select structr_financial.calculator_snapshot_v1(${payload}::jsonb) as result`
    : routine==="create" ? sql`select structr_financial.calculator_create_v1(${payload}::jsonb,${serializeExecutorJson(result)}::jsonb) as result`
    : routine==="recover" ? sql`select structr_financial.calculator_recover_v1(${payload}::jsonb) as result` : invalid();
  await armStatement(s);const rows=await s.tx.execute<{result:unknown}>(statement);
  stateOf(handle);
  await armStatement(s);checkMetadata(await metadata(s.tx),s.config,s.metadata);
  if(rows.length!==1) invalid();
  const response=z.object({contractVersion:z.literal(CALCULATOR_PROTOCOL.version),binding:authoritySchema,transaction:z.object({backendPid:z.number().int().positive(),transactionId:z.string().regex(/^\d+$/)}).strict(),projectId:z.string().uuid(),intakeFormId:z.string().uuid(),clientId:z.string().uuid()}).passthrough().safeParse(rows[0].result);
  if(!response.success) invalid();
  const r=response.data,b=r.binding,identity=assertVerifiedExecutorOperator(s.operator,s.nowMs());
  if(b.sessionRole!==s.metadata.sessionRole || b.subject!==identity.subject || b.actorId!==s.config.auth.actorId || b.tenantId!==s.config.auth.tenantId || !b.operations.includes(command.operation) || new Set(b.operations).size!==b.operations.length) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH");
  if(r.projectId!==command.projectId || r.intakeFormId!==command.intakeFormId || r.transaction.backendPid!==s.metadata.backendPid || r.transaction.transactionId!==s.metadata.transactionId) invalid();
  if(s.binding && canonicalizeCalculator(b)!==canonicalizeCalculator(s.binding)) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH");
  if(s.clientId && r.clientId!==s.clientId) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH");
  s.binding=b; s.clientId=r.clientId;
  return structuredClone(r);
}
function sqlFailure(error:unknown):{code:string;message?:string}|undefined {
  let value=error;
  for(let n=0;n<4 && typeof value==="object" && value!==null;n++) {
    if("code" in value && typeof value.code==="string") return {code:value.code,message:"message" in value && typeof value.message==="string"?value.message:undefined};
    value="cause" in value ? value.cause : undefined;
  }
  return undefined;
}
export interface ExecutorTransactionDependencies {
  /** Trusted composition/test seam; the production entry never supplies another database. */
  database?:PostgresJsDatabase;
  /** Factory permits replacement after cancellation; production creates two max:1 pools. */
  createDatabase?:()=>PostgresJsDatabase;
  nowMs?:()=>number;
}
type CancellableQuery = PromiseLike<unknown> & { cancel():void };
// postgres.js is pinned to 3.4.8. Its public cancel() discards this promise;
// retaining the exact hook prevents an unhandled CancelRequest network failure.
// Transport completion alone is not a PostgreSQL query/rollback acknowledgement.
type DriverCancellationQuery = CancellableQuery & { canceller:((query:DriverCancellationQuery)=>Promise<void>)|null };
function cancelDriverQuery(query:CancellableQuery) {
  const driverQuery=query as DriverCancellationQuery,canceller=driverQuery.canceller;
  if(typeof canceller!=="function")return;
  driverQuery.canceller=null;
  try {void Promise.resolve(canceller(driverQuery)).catch(()=>undefined);} catch { /* Cleanup still expires at the original deadline. */ }
}
const cancellationControllers = new WeakMap<object,{cancelPending:()=>void}>();
/** Retain real driver query handles; Drizzle remains responsible for BEGIN/COMMIT/ROLLBACK. */
function cancellationFor(db:PostgresJsDatabase) {
  const client=(db as PostgresJsDatabase & {$client:ReturnType<typeof postgres>}).$client;
  if(typeof client?.unsafe!=="function" || typeof client.begin!=="function") invalid();
  const existing=cancellationControllers.get(client);if(existing)return existing;
  const pending=new Set<CancellableQuery>(),wrapped=new WeakSet<object>();
  function observe(scoped:ReturnType<typeof postgres>|postgres.TransactionSql) {
    if(wrapped.has(scoped))return scoped;wrapped.add(scoped);
    const unsafe=scoped.unsafe.bind(scoped);
    scoped.unsafe=((...args:Parameters<typeof unsafe>)=>{
      const query=unsafe(...args);
      if(typeof (query as unknown as DriverCancellationQuery).canceller!=="function")invalid();
      pending.add(query);
      // Drizzle immediately awaits each unsafe query. Observe that same promise,
      // preserving its cancel handle instead of substituting a local rejection.
      void query.then(()=>pending.delete(query),()=>pending.delete(query));
      return query;
    }) as typeof scoped.unsafe;
    return scoped;
  }
  observe(client);
  const begin=client.begin.bind(client);
  client.begin=((options:unknown,callback?:unknown)=>{
    const fn=(typeof options==="function"?options:callback) as (sql:postgres.TransactionSql)=>unknown;
    const scoped=(sql:postgres.TransactionSql)=>fn(observe(sql) as postgres.TransactionSql);
    return typeof options==="function"?begin(scoped):begin(options as string,scoped);
  }) as typeof client.begin;
  const controller={cancelPending:()=>{for(const query of pending)cancelDriverQuery(query);}};
  cancellationControllers.set(client,controller);return controller;
}
/** Cleanup uses the original request deadline; a partition cannot prove COMMIT's outcome. */
async function settleUntil(promise:PromiseLike<unknown>|undefined,deadline:number) {
  if(!promise)return false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([Promise.resolve(promise).then(()=>true,()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),Math.max(0,deadline-performance.now()));})]);}
  finally {if(timer)clearTimeout(timer);}
}
export function createExecutorTransactionRunner(config:FinancialExecutorConfig,dependencies:ExecutorTransactionDependencies={}) {
  const replaceable=!!dependencies.createDatabase || !dependencies.database;
  const createDatabase=dependencies.createDatabase ?? (dependencies.database ? ()=>dependencies.database! : ()=>drizzle(postgres({...config.database,password:config.database.password,max:1,connection:{statement_timeout:config.timeouts.statementMs,lock_timeout:config.timeouts.lockMs,transaction_timeout:config.timeouts.totalMs,application_name:"structr-financial-executor-v1"},onnotice:()=>{}})));
  type Slot={db?:PostgresJsDatabase;busy:boolean;disabled:boolean};
  const slots:Slot[]=Array.from({length:replaceable?config.database.max:1},()=>({busy:false,disabled:false}));
  async function closeDatabase(db:PostgresJsDatabase,timeout=0.25) {
    const client=(db as PostgresJsDatabase & {$client:ReturnType<typeof postgres>}).$client;
    if(typeof client?.end!=="function") invalid();
    await client.end({timeout});
  }
  const nowMs=dependencies.nowMs ?? Date.now;
  let closed=false;
  return Object.freeze({
    async run<T>(operator:VerifiedExecutorOperator,commandInput:unknown,work:(tx:ExecutorTransaction)=>Promise<T>,request?:{deadline:number}):Promise<T> {
      assertVerifiedExecutorOperator(operator,nowMs());
      const parsed=z.union([calculatorContextCommandSchema,calculatorCalculateCommandSchema,calculatorCreateCommandSchema,calculatorRecoverCommandSchema]).safeParse(commandInput);
      if(!parsed.success) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_INPUT_INVALID");
      const slot=slots.find(s=>!s.busy && !s.disabled);
      if(closed || !slot) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_CAPACITY");
      if(request && !Number.isFinite(request.deadline)) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_DEADLINE");
      const command=parsed.data,deadline=Math.min(performance.now()+config.timeouts.totalMs,request?.deadline ?? Infinity);
      const requestBudget=remaining(deadline),cleanupReserve=Math.min(250,Math.max(1,Math.floor(requestBudget/4))),executionDeadline=deadline-cleanupReserve;
      slot.busy=true;
      let executionExpired=false,cleanupAcknowledged=false,transactionAcknowledged=false,transactionStarted=false,closing:Promise<void>|undefined,activeState:State|undefined,hardTimer:ReturnType<typeof setTimeout>|undefined,transactionSettlement:Promise<unknown>|undefined;
      try {
        const db=slot.db ??=createDatabase();
        const cancellation=cancellationFor(db);
        // The deadline starts before BEGIN/acquisition. Each leased slot owns its
        // connection, so cancellation cannot close another request's transaction.
        hardTimer=setTimeout(()=>{
          executionExpired=true;if(activeState)activeState.active=false;
          // Query.cancel sends a PostgreSQL CancelRequest. Keep the original
          // connection alive for its error response and Drizzle's rollback.
          cancellation.cancelPending();
          closing=(async()=>{
            cleanupAcknowledged=await settleUntil(transactionSettlement,deadline) && transactionAcknowledged;
            await closeDatabase(db,Math.max(0,deadline-performance.now())/1000);
          })().catch(()=>undefined);
        },remaining(executionDeadline));
        for(let attempt=1;attempt<=3;attempt++) {
          remaining(executionDeadline); assertVerifiedExecutorOperator(operator,nowMs());
          let callbackSettlement:Promise<T>|undefined;
          try {
            transactionStarted=true;transactionAcknowledged=false;
            const transaction=db.transaction(async realTx=>{
              return (async()=>{
                const budget=remaining(deadline);
                const workBudget=remaining(executionDeadline);
                await realTx.execute(sql`select set_config('transaction_timeout',${String(budget)},true),set_config('statement_timeout',${String(Math.min(config.timeouts.statementMs,workBudget))},true),set_config('lock_timeout',${String(Math.min(config.timeouts.lockMs,workBudget))},true)`);
                const initial=await metadata(realTx); checkMetadata(initial,config);
                const handle=Object.freeze(Object.create(null)) as ExecutorTransaction;
                const state:State={tx:realTx,operator,config,command,commandCanonical:canonicalizeCalculator(command),nowMs,deadline,workDeadline:executionDeadline,active:true,metadata:initial};activeState=state;
                transactions.set(handle,state);
                let timer:ReturnType<typeof setTimeout>|undefined;
                try {
                  callbackSettlement=currentTransaction.run(handle,async()=>{
                    await callCalculatorRoutine(handle,"context",command);
                    const result=await work(handle);
                    await callCalculatorRoutine(handle,"context",command);
                    stateOf(handle);
                    return result;
                  });
                  // Roll back before the server's final safety timeout closes the socket.
                  // The detached lifecycle is awaited below and its handle is invalidated.
                  return await Promise.race([callbackSettlement,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{state.active=false;reject(new FinancialExecutorError("FINANCIAL_EXECUTOR_DEADLINE"));},Math.max(1,executionDeadline-performance.now()));})]);
                } finally { if(timer)clearTimeout(timer);state.active=false; transactions.delete(handle); }
              })();
            },{isolationLevel:"serializable",accessMode:"read write",deferrable:false});
            transactionSettlement=transaction;
            void transaction.then(()=>{transactionAcknowledged=true;},error=>{
              // Driver BEGIN awaits ROLLBACK before ordinary rejection. A lost
              // main transport cannot acknowledge rollback, even if it rejects.
              const code=sqlFailure(error)?.code;
              transactionAcknowledged=(code!==undefined && /^[0-9A-Z]{5}$/.test(code) && !code.startsWith("08")) || error instanceof FinancialExecutorError || error instanceof ExecutorAuthError || error instanceof CalculatorError;
            });
            const committed=await transaction;
            if(executionExpired)throw new FinancialExecutorError("FINANCIAL_EXECUTOR_DEADLINE");
            remaining(deadline);assertVerifiedExecutorOperator(operator,nowMs());
            return committed;
          } catch(error) {
            // Invalidate the opaque handle even if a trusted lifecycle callback
            // itself stalls. Late callbacks cannot obtain a SQL capability.
            await settleUntil(callbackSettlement,deadline);
            if(executionExpired) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_DEADLINE");
            if(error instanceof FinancialExecutorError || error instanceof ExecutorAuthError || error instanceof CalculatorError) throw error;
            const failure=sqlFailure(error),code=failure?.code;
            if(performance.now()>=deadline || ["57014","55P03","25P03","25P04"].includes(code??"")) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_DEADLINE");
            if((code==="40001" || code==="40P01") && attempt<3) continue;
            if(code==="42501" && ["FORBIDDEN","FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH"].includes(failure?.message??"")) throw new FinancialExecutorError("FINANCIAL_EXECUTOR_AUTHORITY_MISMATCH");
            if(code==="42501" && failure?.message==="FINANCIAL_EXECUTOR_TRANSACTION_INVALID") throw new FinancialExecutorError("FINANCIAL_EXECUTOR_TRANSACTION_INVALID");
            if(code==="P0001" && failure?.message) {
              if(CALCULATOR_ERROR_CODES.includes(failure.message as typeof CALCULATOR_ERROR_CODES[number])) throw new CalculatorError(failure.message as typeof CALCULATOR_ERROR_CODES[number]);
              if(FINANCIAL_EXECUTOR_ERROR_CODES.includes(failure.message as typeof FINANCIAL_EXECUTOR_ERROR_CODES[number])) throw new FinancialExecutorError(failure.message as typeof FINANCIAL_EXECUTOR_ERROR_CODES[number]);
            }
            throw new FinancialExecutorError("FINANCIAL_EXECUTOR_DATABASE_FAILURE");
          }
        }
        throw new FinancialExecutorError("FINANCIAL_EXECUTOR_DATABASE_FAILURE");
      } finally {
        if(hardTimer)clearTimeout(hardTimer);await closing;
        const uncertain=transactionStarted && !transactionAcknowledged;
        if(uncertain && !closing && slot.db)await closeDatabase(slot.db,Math.min(250,Math.max(0,deadline-performance.now()))/1000).catch(()=>undefined);
        // A forced local close is not proof of backend quiescence. Preserve the
        // capacity reservation until process restart rather than accumulate new
        // sessions alongside an uncertain old backend.
        if(executionExpired || uncertain){slot.db=undefined;slot.disabled=uncertain || !replaceable || !cleanupAcknowledged;}
        slot.busy=false;
      }
    },
    async close() { closed=true;await Promise.all(slots.flatMap(s=>s.db?[closeDatabase(s.db)]:[])); },
  });
}
export type ExecutorTransactionRunner = ReturnType<typeof createExecutorTransactionRunner>;
