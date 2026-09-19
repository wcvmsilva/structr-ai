/** Historical capture writes evidence, never commercial or operational authority. */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  clients, estimateDrafts, historicalEstimateImports, historicalEstimateImportLines,
  historicalEstimateSources, historicalEstimateSourceLines, permissions, profiles,
  projectFiles, projectMembers, projects, rolePermissions, roles, tenants,
  type HistoricalEstimateSource, type HistoricalEstimateSourceLine, type HistoricalEstimateImport,
} from '../drizzle/schema';
import {
  buildHistoricalDraftProjection, buildHistoricalSelection, HistoricalEstimateError,
  normalizeHistoricalSource, rawTotalsSchema, rawLineSchema, rawSelectedSchema, historicalReconciliationSchema,
  type HistoricalSourceInput, type HistoricalSelectionInput, type HistoricalSourceSnapshot,
} from '../shared/historical-estimate-engine';
import type { HistoricalErrorCode } from '../shared/domain/taxonomy';
import { getDb } from './db';
import { logAudit } from './audit';
import { PROJECT_ROLE_PERMISSIONS, requireProjectAccessTrpc } from './project-access';

type Transaction = Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];
export type ImportHistoricalEstimateInput = Omit<HistoricalSelectionInput, 'source'> & { sourceId: string };
export interface ListHistoricalSourcesInput {
  projectId: string; limit?: number; cursor?: { createdAt: string; id: string };
}
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
function fail(code: HistoricalErrorCode, message: string): never { throw new HistoricalEstimateError(code, message); }
const capability = { historicalStatus: 'recorded' as const, canApprove: false as const, canExport: false as const, canExecute: false as const };

function checkedJson<T>(validator: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const result = validator.safeParse(value);
  if (!result.success) fail('HISTORICAL_SOURCE_IMMUTABLE', 'Stored historical evidence does not satisfy its versioned contract');
  return result.data;
}
function sourceForRead(source: HistoricalEstimateSource) {
  return { ...source, rawTotals: checkedJson(rawTotalsSchema, source.rawTotals) };
}
function importForRead(record: HistoricalEstimateImport) {
  return { ...record, rawSelectedTotals: checkedJson(rawSelectedSchema, record.rawSelectedTotals), reconciliationFindings: checkedJson(historicalReconciliationSchema, record.reconciliationFindings) };
}


async function database() {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db;
}

/**
 * Revalidate identity and access on the transaction handle. Row locks retain the
 * identities/grants until commit; a cached preflight grant cannot survive revocation.
 * The canonical project-role map is shared with requireProjectAccessTrpc.
 */
async function lockContext(tx: Transaction, projectId: string, clientId: string | null, actorId: string, tenantId: string, permission: 'read' | 'write') {
  if (!tenantId || !actorId) fail('HISTORICAL_SCOPE_FORBIDDEN', 'A resolved tenant and actor are required');
  const [project] = await tx.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId))).limit(1).for('update');
  if (!project) fail('HISTORICAL_NOT_FOUND', 'Project not found');
  if (project.tenantId !== tenantId || !project.clientId || (clientId !== null && project.clientId !== clientId)) fail('HISTORICAL_IDENTITY_MISMATCH', 'Project identity does not match the capture context');
  if (project.deletedAt) fail('HISTORICAL_SCOPE_FORBIDDEN', 'Project is not active');
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1).for('share');
  if (!tenant || tenant.id !== tenantId || !tenant.isActive) fail('HISTORICAL_SCOPE_FORBIDDEN', 'Tenant is not active');
  const [actor] = await tx.select().from(profiles).where(and(eq(profiles.id, actorId), eq(profiles.tenantId, tenantId))).limit(1).for('share');
  if (!actor || actor.id !== actorId || actor.tenantId !== tenantId || !actor.isActive) fail('HISTORICAL_SCOPE_FORBIDDEN', 'Actor is not active in this tenant');
  const [client] = await tx.select().from(clients).where(and(eq(clients.id, project.clientId), eq(clients.tenantId, tenantId))).limit(1).for('share');
  if (!client || client.id !== project.clientId || client.tenantId !== tenantId) fail('HISTORICAL_IDENTITY_MISMATCH', 'Client identity does not match the capture context');
  if (!client.isActive || client.deletedAt) fail('HISTORICAL_SCOPE_FORBIDDEN', 'Client is not active');
  if (actor.role === 'admin' || project.ownerUserId === actor.id) return project;
  const [member] = await tx.select().from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, actor.id))).limit(1).for('share');
  if (member && member.isActive) {
    const allowed = new Set<string>([...(PROJECT_ROLE_PERMISSIONS[member.projectRole] ?? []), ...(Array.isArray(member.permissions) ? member.permissions.filter((p): p is string => typeof p === 'string') : [])]);
    if (!allowed.has(permission)) fail('HISTORICAL_SCOPE_FORBIDDEN', 'Project permission is required');
    return project;
  }
  // Re-read real RBAC rows instead of the 30-second permission cache.
  const [role] = actor.role ? await tx.select().from(roles).where(eq(roles.name, actor.role)).limit(1).for('share') : [];
  if (role) {
    const grants = await tx.select({ resource: permissions.resource, action: permissions.action }).from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(and(eq(rolePermissions.roleId, role.id), eq(permissions.resource, 'project'), eq(permissions.action, permission))).for('share');
    if (grants.some(grant => grant.resource === 'project' && grant.action === permission)) return project;
  }
  fail('HISTORICAL_SCOPE_FORBIDDEN', 'Project permission is required');
}

function assertContext(row: {tenantId: string; projectId: string; clientId: string}, tenantId: string, projectId?: string, clientId?: string) {
  if (row.tenantId !== tenantId || (projectId !== undefined && row.projectId !== projectId) || (clientId !== undefined && row.clientId !== clientId)) {
    fail('HISTORICAL_IDENTITY_MISMATCH', 'Historical record does not belong to the authorized context');
  }
}
async function sourceLines(tx: Transaction, sourceId: string, tenantId: string) {
  const lines = await tx.select().from(historicalEstimateSourceLines)
    .where(and(eq(historicalEstimateSourceLines.sourceId, sourceId), eq(historicalEstimateSourceLines.tenantId, tenantId)))
    .orderBy(asc(historicalEstimateSourceLines.ordinal));
  if (lines.some(line => line.sourceId !== sourceId || line.tenantId !== tenantId)) fail('HISTORICAL_IDENTITY_MISMATCH', 'Historical line context mismatch');
  return lines.map(line => ({ ...line, rawValues: checkedJson(rawLineSchema, line.rawValues) }));
}
function sourceResult(source: HistoricalEstimateSource, lines: HistoricalEstimateSourceLine[], replayed: boolean) {
  return { sourceId: source.id, contentHash: source.contentHash, lineIds: lines.map(line => ({ sourceLineKey: line.sourceLineKey, id: line.id })), warnings: source.currencyCode === null ? ['Currency not provided'] : [], replayed };
}
function importResult(row: HistoricalEstimateImport, replayed: boolean) {
  return { importId: row.id, draftId: row.estimateDraftId, sourceId: row.sourceId, revision: row.revision, reconciliationState: row.reconciliationState, reconciliationFindings: checkedJson(historicalReconciliationSchema, row.reconciliationFindings), ...capability, replayed };
}
async function operationLock(tx: Transaction, tenantId: string, operation: string, requestId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${`${operation}:${requestId}`}))`);
}

export async function recordHistoricalSource(input: HistoricalSourceInput, actorId: string, tenantId: string) {
  await requireProjectAccessTrpc(input.projectId, actorId, 'write');
  const normalized = normalizeHistoricalSource(input);
  const requestHash = fingerprint(normalized.canonicalRequest), contentHash = fingerprint(normalized.canonicalContent);
  const db = await database();
  return db.transaction(async tx => {
    await lockContext(tx, input.projectId, input.clientId, actorId, tenantId, 'write');
    await operationLock(tx, tenantId, 'historical-source', input.requestId);
    if (normalized.sourceFileId) {
      const [file] = await tx.select().from(projectFiles).where(and(eq(projectFiles.id, normalized.sourceFileId), eq(projectFiles.tenantId, tenantId), eq(projectFiles.projectId, input.projectId))).limit(1).for('share');
      if (!file || file.tenantId !== tenantId || file.projectId !== input.projectId) fail('HISTORICAL_IDENTITY_MISMATCH', 'Source file does not belong to the project');
    }
    const [prior] = await tx.select().from(historicalEstimateSources).where(and(eq(historicalEstimateSources.tenantId, tenantId), eq(historicalEstimateSources.requestId, input.requestId))).limit(1);
    if (prior) {
      assertContext(prior, tenantId, input.projectId, input.clientId);
      if (prior.requestHash !== requestHash) fail('HISTORICAL_REQUEST_CONFLICT', 'Request was already used for different source content');
      return sourceResult(prior, await sourceLines(tx, prior.id, tenantId), true);
    }
    const [duplicate] = await tx.select().from(historicalEstimateSources).where(and(eq(historicalEstimateSources.tenantId, tenantId), eq(historicalEstimateSources.projectId, input.projectId), eq(historicalEstimateSources.clientId, input.clientId), eq(historicalEstimateSources.contractVersion, normalized.contractVersion), eq(historicalEstimateSources.contentHash, contentHash))).limit(1);
    if (duplicate) fail('HISTORICAL_CONTENT_ALREADY_RECORDED', 'This source content was already captured');
    const { lines, canonicalContent: _content, canonicalRequest: _request, ...values } = normalized;
    const [source] = await tx.insert(historicalEstimateSources).values({ ...values, tenantId, recordedBy: actorId, requestHash, contentHash }).returning();
    if (!source) throw new Error('Historical source insert returned no row');
    const savedLines = await tx.insert(historicalEstimateSourceLines).values(lines.map(({ canonicalContent, ...line }) => ({ ...line, tenantId, sourceId: source.id, lineHash: fingerprint(canonicalContent) }))).returning();
    await logAudit({ userId: actorId, action: 'historical.source.record', tableName: 'historical_estimate_sources', recordId: source.id, before: null, after: { tenantId, projectId: input.projectId, clientId: input.clientId, sourceId: source.id, contractVersion: source.contractVersion, contentHash, requestHash, lineCount: lines.length } }, tx);
    return sourceResult(source, savedLines, false);
  });
}

function minorToDecimal(value: string | null): string | null {
  if (value === null) return null;
  const cents = BigInt(value);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}
/** Re-normalization checks stored values without recomputing assemblies or pricing. */
function snapshot(source: HistoricalEstimateSource, lines: HistoricalEstimateSourceLine[]): HistoricalSourceSnapshot {
  if (source.currencyCode !== null && source.currencyCode !== 'USD') fail('HISTORICAL_INVALID_INPUT', 'Historical currency is unsupported');
  if (source.sourceKind !== 'manual_transcription' && source.sourceKind !== 'file_extract') fail('HISTORICAL_INVALID_INPUT', 'Historical source kind is unsupported');
  if (lines.length !== source.expectedLineCount) fail('HISTORICAL_SOURCE_IMMUTABLE', 'Historical source line set is incomplete');
  const normalized = normalizeHistoricalSource({
    requestId: source.requestId, projectId: source.projectId, clientId: source.clientId,
    sourceKind: source.sourceKind, sourceLabel: source.sourceLabel, currencyCode: source.currencyCode,
    sourceFileId: source.sourceFileId, declaredSubtotal: minorToDecimal(source.declaredSubtotalMinor), declaredDiscount: minorToDecimal(source.declaredDiscountMinor), declaredTax: minorToDecimal(source.declaredTaxMinor), declaredTotal: minorToDecimal(source.declaredTotalMinor), declaredEstimatedCost: minorToDecimal(source.declaredEstimatedCostMinor), commercialTermsText: source.commercialTermsText,
    rawTotals: checkedJson(rawTotalsSchema, source.rawTotals),
    lines: lines.map(line => ({sourceLineKey:line.sourceLineKey,ordinal:line.ordinal,description:line.description,quantity:line.quantity,unit:line.unit,unitPrice:line.unitPrice,unitEstimatedCost:line.unitEstimatedCost,linePrice:minorToDecimal(line.linePriceMinor),lineEstimatedCost:minorToDecimal(line.lineEstimatedCostMinor),externalCodeSystem:line.externalCodeSystem,externalCode:line.externalCode,taxable:line.taxable,rawValues:checkedJson(rawLineSchema, line.rawValues)})),
  });
  if (fingerprint(normalized.canonicalContent) !== source.contentHash) fail('HISTORICAL_SOURCE_IMMUTABLE', 'Historical source integrity check failed');
  return { id:source.id, projectId:source.projectId, clientId:source.clientId, currencyCode:source.currencyCode, contentHash:source.contentHash,
    lines: normalized.lines.map((line,index) => {
      const saved = lines[index];
      if (fingerprint(line.canonicalContent) !== saved.lineHash) fail('HISTORICAL_SOURCE_IMMUTABLE', 'Historical line integrity check failed');
      return {...line,id:saved.id,lineHash:saved.lineHash};
    }),
  };
}

export async function importHistoricalEstimate(input: ImportHistoricalEstimateInput, actorId: string, tenantId: string) {
  await requireProjectAccessTrpc(input.projectId, actorId, 'write');
  const db = await database();
  return db.transaction(async tx => {
    await lockContext(tx, input.projectId, input.clientId, actorId, tenantId, 'write');
    await operationLock(tx, tenantId, 'historical-selection', input.requestId);
    const [source] = await tx.select().from(historicalEstimateSources).where(and(eq(historicalEstimateSources.id, input.sourceId), eq(historicalEstimateSources.tenantId, tenantId))).limit(1);
    if (!source) fail('HISTORICAL_NOT_FOUND', 'Historical source not found');
    assertContext(source, tenantId, input.projectId, input.clientId);
    const { sourceId: _sourceId, ...selectionInput } = input;
    const selection = buildHistoricalSelection({ ...selectionInput, source: snapshot(source, await sourceLines(tx, source.id, tenantId)) });
    const requestHash = fingerprint(selection.canonicalRequest), selectionHash = fingerprint(selection.canonicalContent);
    const [replay] = await tx.select().from(historicalEstimateImports).where(and(eq(historicalEstimateImports.tenantId, tenantId), eq(historicalEstimateImports.requestId, input.requestId))).limit(1);
    if (replay) {
      assertContext(replay, tenantId, input.projectId, input.clientId);
      if (replay.requestHash !== requestHash) fail('HISTORICAL_REQUEST_CONFLICT', 'Request was already used for different selection content');
      return importResult(replay, true);
    }
    if (input.priorImportId) {
      const [prior] = await tx.select().from(historicalEstimateImports).where(and(eq(historicalEstimateImports.id, input.priorImportId), eq(historicalEstimateImports.tenantId, tenantId))).limit(1).for('update');
      if (!prior) fail('HISTORICAL_NOT_FOUND', 'Predecessor selection not found');
      assertContext(prior, tenantId, input.projectId, input.clientId);
      if (prior.revision !== input.expectedRevision) fail('HISTORICAL_REVISION_CONFLICT', 'The predecessor revision changed');
      const [successor] = await tx.select().from(historicalEstimateImports).where(and(eq(historicalEstimateImports.tenantId, tenantId), eq(historicalEstimateImports.priorImportId, prior.id))).limit(1);
      if (successor) fail('HISTORICAL_REVISION_CONFLICT', 'This predecessor already has a revision');
    }
    const [duplicate] = await tx.select().from(historicalEstimateImports).where(and(eq(historicalEstimateImports.tenantId, tenantId), eq(historicalEstimateImports.projectId, input.projectId), eq(historicalEstimateImports.clientId, input.clientId), eq(historicalEstimateImports.sourceId, source.id), eq(historicalEstimateImports.selectionHash, selectionHash))).limit(1);
    if (duplicate) fail('HISTORICAL_CONTENT_ALREADY_RECORDED', 'This historical selection was already captured');
    const [draft] = await tx.insert(estimateDrafts).values({ ...buildHistoricalDraftProjection(selection), tenantId, createdBy: actorId }).returning();
    if (!draft) throw new Error('Historical draft insert returned no row');
    const [record] = await tx.insert(historicalEstimateImports).values({
      tenantId,projectId:input.projectId,clientId:input.clientId,sourceId:source.id,estimateDraftId:draft.id,
      requestId:input.requestId,recordedBy:actorId,requestHash,selectionHash,contractVersion:selection.contractVersion,
      priorImportId:selection.priorImportId,revision:selection.revision,
      declaredSelectedTotalMinor:selection.declaredSelectedTotalMinor,declaredSelectedEstimatedCostMinor:selection.declaredSelectedEstimatedCostMinor,
      reconciliationState:selection.reconciliation.state,reconciliationFindings:selection.reconciliation,
      rawSelectedTotals:selection.rawSelectedTotals,reportedApprovalAt:selection.reportedApprovalAt ? new Date(selection.reportedApprovalAt) : null,
      reportedApprovalNote:selection.reportedApprovalNote,expectedLineCount:selection.expectedLineCount,
    }).returning();
    if (!record) throw new Error('Historical selection insert returned no row');
    await tx.insert(historicalEstimateImportLines).values(selection.selectedLines.map((line,position)=>({tenantId,importId:record.id,sourceId:source.id,sourceLineId:line.id,position})));
    await logAudit({ userId:actorId,action:'historical.selection.record',tableName:'historical_estimate_imports',recordId:record.id,before:null,after:{tenantId,projectId:input.projectId,clientId:input.clientId,sourceId:source.id,importId:record.id,draftId:draft.id,contractVersion:selection.contractVersion,requestHash,selectionHash,revision:record.revision,lineCount:selection.expectedLineCount,reconciliationState:record.reconciliationState} },tx);
    return importResult(record,false);
  });
}

export async function getHistoricalSource(sourceId: string, actorId: string, tenantId: string) {
  const db = await database();
  const [source] = await db.select().from(historicalEstimateSources).where(and(eq(historicalEstimateSources.id, sourceId), eq(historicalEstimateSources.tenantId, tenantId))).limit(1);
  if (!source) fail('HISTORICAL_NOT_FOUND', 'Historical source not found');
  assertContext(source,tenantId);
  await requireProjectAccessTrpc(source.projectId,actorId,'read');
  return db.transaction(async tx=>{
    await lockContext(tx,source.projectId,source.clientId,actorId,tenantId,'read');
    const lines=await sourceLines(tx,source.id,tenantId);
    const imports=await tx.select().from(historicalEstimateImports).where(and(eq(historicalEstimateImports.sourceId,source.id),eq(historicalEstimateImports.tenantId,tenantId),eq(historicalEstimateImports.projectId,source.projectId),eq(historicalEstimateImports.clientId,source.clientId))).orderBy(desc(historicalEstimateImports.createdAt),desc(historicalEstimateImports.id));
    return {...sourceForRead(source),lines,imports:imports.filter(row=>row.tenantId===tenantId&&row.projectId===source.projectId&&row.clientId===source.clientId&&row.sourceId===source.id).map(row=>({id:row.id,revision:row.revision,createdAt:row.createdAt,declaredSelectedTotalMinor:row.declaredSelectedTotalMinor,reconciliationState:row.reconciliationState}))};
  });
}

export async function getHistoricalImport(importId: string, actorId: string, tenantId: string) {
  const db=await database();
  const [record]=await db.select().from(historicalEstimateImports).where(and(eq(historicalEstimateImports.id,importId),eq(historicalEstimateImports.tenantId,tenantId))).limit(1);
  if(!record)fail('HISTORICAL_NOT_FOUND','Historical selection not found');
  assertContext(record,tenantId);
  await requireProjectAccessTrpc(record.projectId,actorId,'read');
  return db.transaction(async tx=>{
    await lockContext(tx,record.projectId,record.clientId,actorId,tenantId,'read');
    const [source]=await tx.select().from(historicalEstimateSources).where(and(eq(historicalEstimateSources.id,record.sourceId),eq(historicalEstimateSources.tenantId,tenantId))).limit(1);
    if(!source)fail('HISTORICAL_NOT_FOUND','Historical source not found');
    assertContext(source,tenantId,record.projectId,record.clientId);
    const allLines=await sourceLines(tx,source.id,tenantId);
    const links=await tx.select().from(historicalEstimateImportLines).where(and(eq(historicalEstimateImportLines.importId,record.id),eq(historicalEstimateImportLines.sourceId,source.id),eq(historicalEstimateImportLines.tenantId,tenantId))).orderBy(asc(historicalEstimateImportLines.position));
    if(links.length!==record.expectedLineCount)fail('HISTORICAL_SOURCE_IMMUTABLE','Historical selection line set is incomplete');
    const lines=links.map(link=>{
      if(link.tenantId!==tenantId||link.importId!==record.id||link.sourceId!==source.id)fail('HISTORICAL_IDENTITY_MISMATCH','Historical selection line context mismatch');
      const line=allLines.find(candidate=>candidate.id===link.sourceLineId);
      if(!line)fail('HISTORICAL_SOURCE_IMMUTABLE','Historical selection line is missing');
      return line;
    });
    return {...importForRead(record),draftId:record.estimateDraftId,source:{...sourceForRead(source),lines:allLines},lines,...capability};
  });
}

export async function listHistoricalSources(input: ListHistoricalSourcesInput, actorId: string, tenantId: string) {
  await requireProjectAccessTrpc(input.projectId,actorId,'read');
  const limit=input.limit??25;
  if(!Number.isInteger(limit)||limit<1||limit>100)fail('HISTORICAL_INVALID_INPUT','List limit must be between 1 and 100');
  const cursorDate=input.cursor?new Date(input.cursor.createdAt):null;
  if(cursorDate&&!Number.isFinite(cursorDate.getTime()))fail('HISTORICAL_INVALID_INPUT','Invalid list cursor');
  const db=await database();
  return db.transaction(async tx=>{
    const project=await lockContext(tx,input.projectId,null,actorId,tenantId,'read');
    const cursor=input.cursor&&cursorDate?or(lt(historicalEstimateSources.createdAt,cursorDate),and(eq(historicalEstimateSources.createdAt,cursorDate),lt(historicalEstimateSources.id,input.cursor.id))):undefined;
    const result=await tx.select().from(historicalEstimateSources).where(and(eq(historicalEstimateSources.tenantId,tenantId),eq(historicalEstimateSources.projectId,project.id),eq(historicalEstimateSources.clientId,project.clientId!),cursor)).orderBy(desc(historicalEstimateSources.createdAt),desc(historicalEstimateSources.id)).limit(limit+1);
    result.forEach(row=>assertContext(row,tenantId,project.id,project.clientId!));
    const items=result.slice(0,limit).map(sourceForRead),last=items.at(-1);
    return {items,nextCursor:result.length>limit&&last?{createdAt:last.createdAt.toISOString(),id:last.id}:null};
  });
}
