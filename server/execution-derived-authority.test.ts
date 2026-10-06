import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
const io = vi.hoisted(() => ({ db: vi.fn(), access: vi.fn(), entityAccess: vi.fn() }));
vi.mock("./db", () => ({ getDb: io.db }));
vi.mock("./project-access", () => ({ requireProjectAccessTrpc: io.access, requireEntityAccess: io.entityAccess }));
import { collectProjectSamples, runProjectCalibration, runTenantCalibration } from "./calibration-db";
import { computeProjectScopeCompleteness } from "./scope-completeness-db";
import { calibrationRouter } from "./calibration-router";
import { scopeCompletenessRouter } from "./scope-completeness-router";
const TENANT="ed600000-0000-4000-8000-000000000001";
const PROJECT="ed600000-0000-4000-8000-000000000002";
const ACTOR="ed600000-0000-4000-8000-000000000003";
const input={tenantId:TENANT,projectId:PROJECT,actorId:ACTOR};
const unavailable={state:"unavailable",reason:"EXECUTION_AUTHORITY_NOT_AVAILABLE"};
const ctx={tenantId:TENANT,user:{id:ACTOR,role:"admin"}} as any;
beforeEach(()=>{vi.clearAllMocks();io.db.mockResolvedValue(null);io.access.mockResolvedValue({tenantId:TENANT});});
describe("A1 derived execution computations",()=>{
 it.each([
  ["samples",()=>collectProjectSamples(PROJECT)],
  ["project calibration",()=>runProjectCalibration(input)],
  ["open-project calibration",()=>runProjectCalibration({...input,allowOpenProject:true})],
  ["tenant calibration including empty populations",()=>runTenantCalibration({tenantId:TENANT,actorId:ACTOR})],
  ["scope scoring",()=>computeProjectScopeCompleteness(input)],
  ["scope preview",()=>computeProjectScopeCompleteness({...input,persist:false})],
 ] as const)("%s refuses before reading legacy budget or writing a successful report",async(_label,run)=>{
  await expect(run()).rejects.toMatchObject({code:"EXECUTION_AUTHORITY_NOT_AVAILABLE"});
  expect(io.db).not.toHaveBeenCalled();
 });
 it("scope preview returns an unavailable component after project ACL",async()=>{
  expect(await scopeCompletenessRouter.createCaller(ctx).preview({projectId:PROJECT})).toEqual(unavailable);
  expect(io.access).toHaveBeenCalledWith(PROJECT,ACTOR,"read");
  expect(io.db).not.toHaveBeenCalled();
 });
 it.each([
  ["scope score",()=>scopeCompletenessRouter.createCaller(ctx).score({projectId:PROJECT})],
  ["project calibration",()=>calibrationRouter.createCaller(ctx).runProject({projectId:PROJECT})],
  ["tenant calibration",()=>calibrationRouter.createCaller(ctx).runTenant({})],
 ] as const)("%s is a typed refused command, including for admin",async(_label,run)=>{
  await expect(run()).rejects.toMatchObject({code:"PRECONDITION_FAILED",cause:{code:"EXECUTION_AUTHORITY_NOT_AVAILABLE"}});
  expect(io.db).not.toHaveBeenCalled();
 });
 it("does not replace project access denial with an available or unavailable result",async()=>{
  io.access.mockRejectedValue(new TRPCError({code:"FORBIDDEN",message:"Private project"}));
  await expect(scopeCompletenessRouter.createCaller(ctx).preview({projectId:PROJECT})).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(io.db).not.toHaveBeenCalled();
 });
 it("tenant calibration still refuses a missing tenant",async()=>{
  await expect(calibrationRouter.createCaller({...ctx,tenantId:null}).runTenant({})).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(io.db).not.toHaveBeenCalled();
 });
});
