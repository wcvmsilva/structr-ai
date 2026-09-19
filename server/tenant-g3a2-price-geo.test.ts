/** G3a-2 behavioral boundary proof. This permissive double DOES NOT execute tenant predicates
 * or SQL readback comparisons. It returns rows by id and injects `matches` explicitly.
 * PostgreSQL integration separately proves SQL semantics and concurrent execution. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableName, sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as adjustmentEngine from '@shared/price-adjustment-engine';
import { validateGeoFactors, type CalibrationFinding } from '@shared/calibration-engine';

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn(), settings: vi.fn(), event: vi.fn() }));
vi.mock('./db', () => ({ getDb: mocks.getDb }));
vi.mock('./audit-trail', () => ({ recordAuditAsync: mocks.audit }));
vi.mock('./tenant-settings-db', () => ({ getTenantSettings: mocks.settings }));
vi.mock('./calibration-db', () => ({ getCalibrationEvent: vi.fn(), markEventActioned: mocks.event }));
import { applyAdjustment, rollbackAdjustment, proposeAdjustment, proposeFromFindings, previewImpact, hasLiveAdjustment } from './price-adjustment-db';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const USER = '20000000-0000-4000-8000-000000000001';
const Z = '30000000-0000-4000-8000-000000000001';
const ZB = '30000000-0000-4000-8000-000000000002';
const ID = '40000000-0000-4000-8000-000000000001';
const CC = '50000000-0000-4000-8000-000000000001';
const OLD = '60000000-0000-4000-8000-000000000001';
const NEW = '60000000-0000-4000-8000-000000000002';
const now = new Date('2026-01-01T00:00:00Z');
type Row = Record<string, any>;
type State = Record<string, Row[]>;
type Op = { kind: string; table: string; executor: object; lock: string | null; sql: string; params: unknown[]; set?: Row; confirmation: boolean };
const dialect = new PgDialect();
let state: State;
let ops: Op[];
let txOptions: unknown[];
let commits: number;
let commitFail: boolean;
let fault: ((op: Op) => 'zero' | 'throw' | undefined) | undefined;
let onBegin: (() => void) | undefined;
let matches: Record<string, unknown>;
let liveCount: number;
let appliedRows: Row[];
function snapshot() { return { targetType: 'geo_factor', targetId: Z, previousUnitCostCents: null, previousUnitPriceCents: null, previousFactor: 40, previousPricingHistoryId: null, capturedAt: now.toISOString() }; }
function adjustment(overrides: Row = {}) { return { id: ID, tenantId: A, targetType: 'geo_factor', geoZoneId: Z, costCodeId: null, assemblyId: null, trade: null, status: 'approved', adjustmentPct: '10', reason: 'Evidence supports revision', approvedBy: USER, sourceCalibrationId: null, rollbackSnapshot: null, appliedBy: null, appliedAt: null, appliedPricingHistoryId: null, previousValue: '40', newValue: '44', previousUnitCostCents: null, newUnitCostCents: null, updatedBy: null, updatedAt: now, rolledBackBy: null, rolledBackAt: null, rollbackReason: null, deletedAt: null, ...overrides }; }
function zone(overrides: Row = {}) { return { id: Z, tenantId: A, name: 'Metro', minProfitShieldPct: '40', updatedAt: now, laborModifier: '1.12', materialModifier: '1.08', ...overrides }; }
function executor(read: () => State) {
  const handle: any = {};
  function chain(kind: string, table?: any, fields?: Row) {
    let where: SQL | undefined; let values: Row | undefined; let lock: string | null = null; let returning = false;
    const q: any = {};
    q.from = (t: any) => { table = t; return q; };
    q.where = (w: SQL) => { where = w; return q; };
    q.set = q.values = (v: Row) => { values = v; return q; };
    q.limit = q.orderBy = q.offset = q.groupBy = () => q;
    q.for = (mode: string) => { lock = mode; return q; };
    q.returning = () => { returning = true; return q; };
    q.then = (resolve: any, reject: any) => Promise.resolve().then(() => {
      const name = getTableName(table);
      const projection = fields ? sql.join(Object.values(fields).map(v => sql`${v}`), sql`, `) : sql`*`;
      const expression = kind === 'select' ? sql`select ${projection} from ${table} where ${where ?? sql`true`} ${lock ? sql`for update` : sql``}` : sql`${sql.raw(kind)} ${table} where ${where ?? sql`true`}`;
      const compiled = dialect.sqlToQuery(expression);
      const op: Op = { kind, table: name, executor: handle, lock, ...compiled, set: values, confirmation: !!fields?.matches };
      ops.push(op);
      const failure = fault?.(op);
      if (failure === 'throw') throw new Error('injected SQL failure');
      if (failure === 'zero') return [];
      const rows = read()[name] ?? [];
      // Permissive lookup by id only: never interpret tenant/status/target predicates.
      const idParameter = compiled.sql.match(/\"id\" = \$(\d+)/);
      const id = idParameter ? compiled.params[Number(idParameter[1]) - 1] : undefined;
      const selected = id !== undefined ? rows.filter(r => r.id === id) : rows;
      if (kind === 'select') {
        if (fields?.count) return [{ count: liveCount }];
        if (fields?.status && !fields?.matches) return structuredClone(appliedRows);
        if (fields?.targetType && !fields?.id) return [];
        return selected.map(r => ({ ...structuredClone(r), ...(fields?.matches ? { matches: matches[name] } : {}) }));
      }
      if (kind === 'insert') {
        const created = { id: name === 'cost_code_pricing_history' ? NEW : `proposal-${rows.length}`, ...structuredClone(values) };
        (read()[name] ??= []).push(created);
        return returning ? [structuredClone(created)] : [];
      }
      selected.forEach(r => Object.assign(r, structuredClone(values)));
      return returning ? structuredClone(selected) : [];
    }).then(resolve, reject);
    return q;
  }
  handle.select = (fields?: Row) => chain('select', undefined, fields);
  handle.update = (table: any) => chain('update', table);
  handle.insert = (table: any) => chain('insert', table);
  handle.transaction = async (fn: any, options: unknown) => {
    txOptions.push(options); onBegin?.();
    const staged = structuredClone(state);
    const tx = executor(() => staged);
    const result = await fn(tx);
    if (commitFail) throw new Error('injected precommit failure');
    state = staged; commits++;
    return result;
  };
  return handle;
}
let root: any;
beforeEach(() => {
  vi.clearAllMocks();
  state = { geo_zones: [zone()], price_adjustments: [adjustment()], cost_codes: [{ id: CC, tenantId: A, code: 'C1', name: 'Labor' }], cost_code_pricing_history: [{ id: OLD, costCodeId: CC, unitCost: '10', unitPrice: '20', isActive: true }] };
  ops = []; txOptions = []; commits = 0; commitFail = false; fault = undefined; onBegin = undefined; liveCount = 0; appliedRows = [];
  matches = { geo_zones: true, price_adjustments: true };
  root = executor(() => state); mocks.getDb.mockResolvedValue(root); mocks.settings.mockResolvedValue({}); mocks.event.mockResolvedValue(undefined);
  vi.stubEnv('TENANT_STRICT', 'false');
});
afterEach(() => vi.unstubAllEnvs());
const propose = (overrides: Row = {}) => proposeAdjustment({ tenantId: A, targetType: 'geo_factor', geoZoneId: Z, adjustmentPct: 10, reason: 'Evidence supports revision', actorId: USER, ...overrides });
const apply = (overrides: Row = {}) => applyAdjustment({ adjustmentId: ID, tenantId: A, actorId: USER, ...overrides });
const rollback = (overrides: Row = {}) => rollbackAdjustment({ adjustmentId: ID, tenantId: A, actorId: USER, reason: 'Restore approved baseline', ...overrides });
async function unchanged(action: () => Promise<unknown>, code?: string) {
  const before = structuredClone(state);
  if (code) await expect(action()).rejects.toMatchObject({ code });
  else await expect(action()).rejects.toThrow();
  expect(state).toEqual(before); expect(mocks.audit).not.toHaveBeenCalled(); expect(commits).toBe(0);
}
function finding(id: string): CalibrationFinding {
  const [result] = validateGeoFactors(Array.from({ length: 20 }, (_, index) => ({
    projectId: `project-${index}`,
    geoZoneId: id,
    configuredFloorPct: 40,
    realizedGrossProfitPct: 30,
  })));
  return { ...result, findingKey: `geo:${id}` };
}

describe('proposal strict geo ownership', () => {
  it.each([B, null])('rejects permissively returned owner %s without writes or audit', async owner => {
    state.geo_zones = [zone({ tenantId: owner })]; await unchanged(() => propose(), 'TARGET_NOT_FOUND');
  });
  it('preserves own proposal format and compiled strict tenant predicate', async () => {
    const result = await propose(); expect(result.adjustment).toMatchObject({ status: 'proposed', previousValue: '40', newValue: '44', tenantId: A });
    expect(result.warnings).toEqual([]); expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'price_adjustment.proposed' }));
    const op = ops.find(o => o.table === 'geo_zones')!; expect(op.params).toEqual([A, Z]); expect(op.sql).toContain('"tenant_id" ='); expect(op.sql).not.toMatch(/IS NULL/i); expect(op.executor).toBe(root);
  });
  it('rejects missing zone', async () => { state.geo_zones = []; await unchanged(() => propose(), 'TARGET_NOT_FOUND'); });
  it('rejects unresolved tenant', async () => { await unchanged(() => propose({ tenantId: '' })); });
  it('rejects absent target id', async () => { await unchanged(() => propose({ geoZoneId: null })); });
  it('reports partial mixed batch without rejected success audit', async () => {
    state.geo_zones.push(zone({ id: ZB, tenantId: B }));
    const result = await proposeFromFindings({ tenantId: A, actorId: USER, findings: [finding(ZB), finding(Z)] });
    expect(result.created).toHaveLength(1); expect(result.created[0].geoZoneId).toBe(Z); expect(result.proposals).toHaveLength(2); expect(result.skipped).toEqual([expect.objectContaining({ findingKey: `geo:${ZB}` })]); expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
  it('propagates database failure without insertion or audit', async () => { fault = o => o.table === 'geo_zones' ? 'throw' : undefined; await unchanged(() => propose()); });
});

function assertGeoTransaction() {
  expect(txOptions).toEqual([{ isolationLevel: 'read committed' }]);
  const locks = ops.filter(o => o.lock);
  expect(locks.map(o => o.table)).toEqual(['price_adjustments', 'geo_zones']);
  expect(locks.every(o => o.lock === 'update')).toBe(true);
  const targetOps = ops.filter(o => o.table === 'geo_zones' || (o.table === 'price_adjustments' && o.executor !== root));
  expect(new Set(targetOps.map(o => o.executor)).size).toBe(1); expect(targetOps[0].executor).not.toBe(root);
  const confirmations = ops.filter(o => o.confirmation);
  expect(confirmations.map(o => o.table)).toEqual(['geo_zones', 'price_adjustments']);
  const lastWrite = ops.findLastIndex(o => o.kind === 'update');
  expect(ops.indexOf(confirmations[0])).toBeGreaterThan(lastWrite);
  for (const o of targetOps.filter(o => o.table === 'geo_zones')) { expect(o.params).toContain(A); expect(o.params).toContain(Z); expect(o.sql).not.toMatch(/IS NULL/i); }
  for (const o of targetOps.filter(o => o.table === 'price_adjustments' && (o.kind === 'update' || o.confirmation))) {
    expect(o.params).toEqual(expect.arrayContaining([ID, A, 'geo_factor', Z]));
  }
}
describe('geo application atomic transition', () => {
  it('commits both writes then reads both exact rows on the same locked executor', async () => {
    const result = await apply(); expect(result.adjustment).toMatchObject({ status: 'applied', appliedBy: USER, newValue: '44', rollbackSnapshot: { previousFactor: 40 } });
    expect(result).toMatchObject({ pricingHistoryId: null, previousUnitCostCents: null, newUnitCostCents: null, summary: 'Geo zone Metro: adjusted by 10%.' });
    expect(state.geo_zones[0].minProfitShieldPct).toBe('44'); expect(commits).toBe(1); assertGeoTransaction();
    expect(ops.filter(o => o.table === 'price_adjustments' && o.executor === root)).toHaveLength(1);
    const confirm = ops.find(o => o.table === 'price_adjustments' && o.confirmation)!;
    for (const field of ['status','applied_by','applied_at','applied_pricing_history_id','rollback_snapshot','previous_unit_cost_cents','new_unit_cost_cents','previous_value','new_value','updated_by','updated_at']) expect(confirm.sql).toContain(`"${field}" IS NOT DISTINCT FROM`);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'price_adjustment.applied', before: { target: { geoZone: zone() }, status: 'approved' } }));
  });
  it.each([B, null])('refuses foreign or NULL-owned zone %s', async owner => { state.geo_zones = [zone({ tenantId: owner })]; await unchanged(() => apply(), 'TARGET_NOT_FOUND'); });
  it('refuses absent zone', async () => { state.geo_zones = []; await unchanged(() => apply(), 'TARGET_NOT_FOUND'); });
  it.each([null, 'Infinity', 'NaN'])('refuses invalid current factor %s', async value => { state.geo_zones[0].minProfitShieldPct = value; await unchanged(() => apply(), 'ADJUSTMENT_VALIDATION_FAILED'); });
  it('refuses an explicitly injected nonfinite engine result', async () => { const spy = vi.spyOn(adjustmentEngine, 'computeApplication').mockReturnValueOnce({ newFactor: Infinity, newUnitCostCents: null, newUnitPriceCents: null, snapshot: { ...snapshot(), targetType: 'geo_factor' } }); try { await unchanged(() => apply(), 'ADJUSTMENT_VALIDATION_FAILED'); } finally { spy.mockRestore(); } });
  it.each(['geo_zones', 'price_adjustments'])('rolls back on zero-row %s UPDATE', async table => { fault = o => o.kind === 'update' && o.table === table ? 'zero' : undefined; await unchanged(() => apply(), 'ADJUSTMENT_VALIDATION_FAILED'); });
  it.each(['geo_zones', 'price_adjustments'])('rolls back divergent %s confirmation', async table => { matches[table] = false; await unchanged(() => apply(), 'ADJUSTMENT_VALIDATION_FAILED'); });
  it.each(['geo_zones', 'price_adjustments'])('rolls back missing %s confirmation', async table => { fault = o => o.confirmation && o.table === table ? 'zero' : undefined; await unchanged(() => apply(), 'ADJUSTMENT_VALIDATION_FAILED'); });
  it('does not accept truthy nonboolean SQL comparison', async () => { matches.geo_zones = 'true'; await unchanged(() => apply(), 'ADJUSTMENT_VALIDATION_FAILED'); });
  it('rolls back a SQL error after zone write', async () => { fault = o => o.kind === 'update' && o.table === 'price_adjustments' ? 'throw' : undefined; await unchanged(() => apply()); });
  it('discards both staged rows when commit fails', async () => { commitFail = true; await unchanged(() => apply()); });
  it('refuses status not approved', async () => { state.price_adjustments[0].status = 'proposed'; await unchanged(() => apply(), 'INVALID_ADJUSTMENT_TRANSITION'); });
  it('refuses missing actor', async () => { await unchanged(() => apply({ actorId: '' })); });
  it('preserves autoApply prohibition', async () => { mocks.settings.mockResolvedValue({ autoApplyAdjustments: true }); await unchanged(() => apply(), 'AUTO_APPLY_FORBIDDEN'); });
  it('preserves PA-005 broad second-stage legacy veto inside tx', async () => { liveCount = 1; appliedRows = [{ id: 'other-target', status: 'applied' }]; await unchanged(() => apply(), 'DUPLICATE_LIVE_ADJUSTMENT'); expect(ops.filter(o => o.table === 'price_adjustments' && o.executor !== root)).toHaveLength(3); });
  it('preserves PA-005 allowing another proposed row when second-stage empty', async () => { liveCount = 1; await apply(); expect(commits).toBe(1); });
  it('loads changed percentage and factor under locks', async () => { onBegin = () => { state.price_adjustments[0].adjustmentPct = '20'; state.geo_zones[0].minProfitShieldPct = '50'; }; const result = await apply(); expect(result.adjustment).toMatchObject({ newValue: '60', previousValue: '50', rollbackSnapshot: { previousFactor: 50 } }); });
  it.each([{ targetType: 'assembly' }, { tenantId: B }])('rejects changed locked adjustment %j', async change => {
    onBegin = () => { Object.assign(state.price_adjustments[0], change); }; await expect(apply()).rejects.toMatchObject({ code: 'INVALID_ADJUSTMENT_TRANSITION' }); expect(commits).toBe(0); expect(mocks.audit).not.toHaveBeenCalled(); expect(state.geo_zones[0]).toEqual(zone());
  });
  it('preserves postcommit event failure and absence of later success audit', async () => {
    state.price_adjustments[0].sourceCalibrationId = 'event'; mocks.event.mockRejectedValue(new Error('event failure'));
    await expect(apply()).rejects.toThrow('event failure'); expect(commits).toBe(1); expect(state.geo_zones[0].minProfitShieldPct).toBe('44'); expect(state.price_adjustments[0].status).toBe('applied'); expect(mocks.audit).not.toHaveBeenCalled();
  });
});

describe('nongeo apply compatibility and conditional transition', () => {
  it.each(['cost_code', 'assembly', 'duration_factor'])('preserves %s serial application', async targetType => {
    state.price_adjustments = [adjustment({ targetType, geoZoneId: null, costCodeId: targetType === 'cost_code' ? CC : null, assemblyId: targetType === 'assembly' ? 'assembly' : null, trade: targetType === 'duration_factor' ? 'framing' : null })];
    const result = await apply(); expect(result.adjustment.status).toBe('applied'); expect(ops.some(o => o.table === 'geo_zones')).toBe(false);
    if (targetType === 'cost_code') { expect(result.pricingHistoryId).toBe(NEW); expect(result.newUnitCostCents).toBe(1100); expect(state.cost_code_pricing_history).toEqual([expect.objectContaining({ id: OLD, isActive: false }), expect.objectContaining({ id: NEW, unitCost: '11', unitPrice: '22' })]); }
  });
  it.each(['status','targetType','costCodeId','assemblyId','geoZoneId','trade'])('aborts nongeo effects when final conditional %s differs', async field => {
    state.price_adjustments = [adjustment({ targetType: 'cost_code', geoZoneId: null, costCodeId: CC })];
    let concurrentlyChanged: State;
    onBegin = () => { state.price_adjustments[0][field] = field === 'status' ? 'rejected' : 'concurrent-target'; concurrentlyChanged = structuredClone(state); };
    fault = o => {
      if (o.kind !== 'update' || o.table !== 'price_adjustments') return;
      // Inject zero RETURNING only when production actually expresses the observed-field guard.
      const column = ({ status: 'status', targetType: 'target_type', costCodeId: 'cost_code_id', assemblyId: 'assembly_id', geoZoneId: 'geo_zone_id', trade: 'trade' })[field]!;
      return o.sql.includes(`"${column}"`) ? 'zero' : undefined;
    };
    await expect(apply()).rejects.toMatchObject({ code: 'INVALID_ADJUSTMENT_TRANSITION' });
    expect(state).toEqual(concurrentlyChanged!); expect(commits).toBe(0); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('preview does not resolve or write geo targets', async () => { state.geo_zones = []; const result = await previewImpact({ adjustmentId: ID, tenantId: A, historicalVolumeCents: 10000 }); expect(result.adjustmentPct).toBe(10); expect(ops.some(o => o.table === 'geo_zones')).toBe(false); expect(mocks.audit).not.toHaveBeenCalled(); });
});

describe('geo rollback exact restoration', () => {
  beforeEach(() => { state.price_adjustments = [adjustment({ status: 'applied', rollbackSnapshot: snapshot(), appliedBy: USER, appliedAt: now })]; state.geo_zones[0].minProfitShieldPct = '44'; });
  it('restores factor and confirms snapshot plus all six rollback fields before commit', async () => {
    const result = await rollback(); expect(result).toMatchObject({ adjustment: { status: 'rolled_back', rolledBackBy: USER, rollbackReason: 'Restore approved baseline' }, restored: { factor: 40, unitCostCents: null, unitPriceCents: null, pricingHistoryId: null } });
    expect(state.geo_zones[0].minProfitShieldPct).toBe('40'); assertGeoTransaction(); expect(commits).toBe(1);
    const confirm = ops.find(o => o.confirmation && o.table === 'price_adjustments')!;
    for (const name of ['status','rolled_back_by','rolled_back_at','rollback_reason','updated_by','updated_at','rollback_snapshot']) expect(confirm.sql).toContain(`"${name}" IS NOT DISTINCT FROM`);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'price_adjustment.rolled_back', before: expect.objectContaining({ status: 'applied' }), metadata: { restored: result.restored, integrity: { intact: true, issues: [] } } }));
    expect(ops.filter(o => o.executor === root && o.table === 'price_adjustments')).toHaveLength(1);
  });
  it.each([B, null])('refuses zone owned by %s', async owner => { state.geo_zones[0].tenantId = owner; await unchanged(() => rollback(), 'TARGET_NOT_FOUND'); });
  it('refuses absent zone without status advance', async () => { state.geo_zones = []; await unchanged(() => rollback(), 'TARGET_NOT_FOUND'); });
  it('preserves missing snapshot error', async () => { state.price_adjustments[0].rollbackSnapshot = null; await unchanged(() => rollback(), 'MISSING_ROLLBACK_SNAPSHOT'); });
  it.each([{ targetType: 'cost_code' }, { targetId: ZB }, { previousFactor: null }, { previousFactor: Infinity }, { previousFactor: NaN }, { previousFactor: '40' }])('refuses incompatible snapshot %j', async change => {
    Object.assign(state.price_adjustments[0].rollbackSnapshot, change); await unchanged(() => rollback(), 'ROLLBACK_INTEGRITY_FAILED');
  });
  it.each(['geo_zones','price_adjustments'])('aborts zero-row %s UPDATE', async table => { fault = o => o.kind === 'update' && o.table === table ? 'zero' : undefined; await unchanged(() => rollback(), 'ROLLBACK_INTEGRITY_FAILED'); });
  it.each(['geo_zones','price_adjustments'])('aborts divergent %s readback including snapshot protection', async table => { matches[table] = false; await unchanged(() => rollback(), 'ROLLBACK_INTEGRITY_FAILED'); });
  it.each(['geo_zones','price_adjustments'])('aborts absent %s readback', async table => { fault = o => o.confirmation && o.table === table ? 'zero' : undefined; await unchanged(() => rollback(), 'ROLLBACK_INTEGRITY_FAILED'); });
  it('does not convert a readback SQL failure into success', async () => { fault = o => o.confirmation ? 'throw' : undefined; await unchanged(() => rollback()); });
  it('discards all writes on precommit failure', async () => { commitFail = true; await unchanged(() => rollback()); });
  it('rejects integrity mismatch even if injected SQL match is true', async () => { state.price_adjustments[0].rollbackSnapshot.previousUnitCostCents = 100; await unchanged(() => rollback(), 'ROLLBACK_INTEGRITY_FAILED'); });
  it('requires rollback reason', async () => { await unchanged(() => rollback({ reason: '' })); });
  it('requires current applied status', async () => { state.price_adjustments[0].status = 'approved'; await unchanged(() => rollback(), 'INVALID_ADJUSTMENT_TRANSITION'); });
  it('uses snapshot from current locked adjustment', async () => { onBegin = () => { state.price_adjustments[0].rollbackSnapshot.previousFactor = 35; }; const result = await rollback(); expect(result.restored.factor).toBe(35); expect(state.geo_zones[0].minProfitShieldPct).toBe('35'); });
});

describe('nongeo rollback compatibility', () => {
  it.each(['cost_code','assembly','duration_factor'])('preserves %s serial rollback', async targetType => {
    state.price_adjustments = [adjustment({ status: 'applied', targetType, geoZoneId: null, costCodeId: targetType === 'cost_code' ? CC : null, assemblyId: targetType === 'assembly' ? 'assembly' : null, trade: targetType === 'duration_factor' ? 'framing' : null, appliedPricingHistoryId: NEW, rollbackSnapshot: { ...snapshot(), targetType, targetId: CC, previousFactor: null, previousUnitCostCents: targetType === 'cost_code' ? 1000 : null, previousPricingHistoryId: targetType === 'cost_code' ? OLD : null } })];
    state.cost_code_pricing_history[0].isActive = false; state.cost_code_pricing_history.push({ id: NEW, costCodeId: CC, unitCost: '11', unitPrice: '22', isActive: true });
    const result = await rollback(); expect(result.adjustment.status).toBe('rolled_back'); expect(ops.some(o => o.table === 'geo_zones')).toBe(false);
    if (targetType === 'cost_code') { expect(state.cost_code_pricing_history[0].isActive).toBe(true); expect(state.cost_code_pricing_history[1].isActive).toBe(false); }
  });
  it('rolls back cost history effects when observed final guard returns zero', async () => {
    state.price_adjustments = [adjustment({ status: 'applied', targetType: 'cost_code', geoZoneId: null, costCodeId: CC, appliedPricingHistoryId: OLD, rollbackSnapshot: { ...snapshot(), targetType: 'cost_code', targetId: CC, previousFactor: null, previousUnitCostCents: 1000 } })];
    fault = o => o.kind === 'update' && o.table === 'price_adjustments' && o.sql.includes('"target_type"') ? 'zero' : undefined;
    await unchanged(() => rollback(), 'INVALID_ADJUSTMENT_TRANSITION');
  });
  it('hasLiveAdjustment retains false when database unavailable', async () => { mocks.getDb.mockResolvedValue(null); await expect(hasLiveAdjustment({ tenantId: A, targetType: 'geo_factor', geoZoneId: Z })).resolves.toBe(false); });
});
