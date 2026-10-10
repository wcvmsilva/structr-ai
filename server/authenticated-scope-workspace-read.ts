import { ADR002_PROTOCOL } from "../shared/domain/taxonomy";
import {
  scopeWorkspaceReadCommandSchema,
  scopeWorkspaceReadIdentitySchema,
  scopeWorkspaceReadWireSchema,
  type ScopeWorkspaceRead,
} from "../shared/scope-workspace-read";
import type { TrpcContext } from "./_core/context";
import {
  AuthenticatedDataApiError,
  callAuthenticatedScopeWorkspaceRead,
} from "./authenticated-data-api";

export function decodeAuthenticatedScopeWorkspaceRead(
  raw: unknown,
  command: unknown,
  expectedIdentity: unknown
): ScopeWorkspaceRead {
  const input = scopeWorkspaceReadCommandSchema.safeParse(command);
  if (!input.success) throw new AuthenticatedDataApiError("invalid_request");
  const identity = scopeWorkspaceReadIdentitySchema.safeParse(expectedIdentity);
  const parsed = scopeWorkspaceReadWireSchema.safeParse(raw);
  if (!identity.success || !parsed.success)
    throw new AuthenticatedDataApiError("unavailable");
  const result = parsed.data;
  if (
    result.context.actorId !== identity.data.actorId ||
    result.context.tenantId !== identity.data.tenantId ||
    result.project.id !== input.data.projectId ||
    result.intake.id !== input.data.intakeFormId ||
    result.intake.projectId !== result.project.id ||
    result.project.tenantId !== result.context.tenantId ||
    result.intake.tenantId !== result.context.tenantId
  )
    throw new AuthenticatedDataApiError("unavailable");
  return {
    ...result,
    intake: {
      ...result.intake,
      createdAt: new Date(result.intake.createdAt),
      updatedAt: new Date(result.intake.updatedAt),
    },
  };
}

type ScopeWorkspaceContext = Pick<
  TrpcContext,
  "req" | "user" | "tenantId" | "authProvider" | "authenticatedDataApiSession"
>;
/** Bootstrap coherence is a prerequisite, not authorization; the RPC reauthorizes under its locks. */
export async function loadAuthenticatedScopeWorkspace(
  context: ScopeWorkspaceContext,
  command: unknown
): Promise<ScopeWorkspaceRead> {
  const session = context.authenticatedDataApiSession,
    user = context.user;
  const identity = scopeWorkspaceReadIdentitySchema.safeParse({
    actorId: user?.id,
    tenantId: context.tenantId,
  });
  if (
    !identity.success ||
    context.authProvider !== "supabase" ||
    !session ||
    session.version !== ADR002_PROTOCOL.session ||
    user?.isActive !== true ||
    user.tenantId !== identity.data.tenantId ||
    session.profile?.isActive !== true ||
    session.profile.id !== identity.data.actorId ||
    session.profile.tenantId !== identity.data.tenantId ||
    session.tenantId !== identity.data.tenantId
  )
    throw new AuthenticatedDataApiError("forbidden");
  const raw = await callAuthenticatedScopeWorkspaceRead(context.req, command);
  return decodeAuthenticatedScopeWorkspaceRead(raw, command, identity.data);
}
