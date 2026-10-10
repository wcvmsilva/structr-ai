import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { useSearch } from "wouter";
import {
  scopeWorkspaceReadCommandSchema,
  type ScopeWorkspaceRead,
  type ScopeWorkspaceReadCommand,
} from "@shared/scope-workspace-read";
import { ADR002_PROTOCOL } from "@shared/domain/taxonomy";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { currentQueryData } from "@/components/estimate/EstimateReadiness";
import {
  getAuthSessionSnapshot,
  subscribeAuthSession,
  subscribeAuthIdentityChange,
} from "@/lib/auth-token";

type SessionDescriptor = inferRouterOutputs<AppRouter>["auth"]["session"];
type SessionQuery = Parameters<typeof currentQueryData<SessionDescriptor>>[0];
type Identity = {
  actorId: string;
  tenantId: string;
  subject: string;
  generation: number;
};

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-3">
      <h1 className="text-2xl font-bold">Project and intake</h1>
      <p role="status">{children}</p>
    </div>
  );
}

/** The URL identifies only the requested pair. The server authorizes each read. */
export function AuthenticatedScopeWorkspace({
  sessionQuery,
}: {
  sessionQuery: SessionQuery;
}) {
  const auth = useAuth();
  const browser = useSyncExternalStore(
    subscribeAuthSession,
    getAuthSessionSnapshot,
    getAuthSessionSnapshot
  );
  const search = new URLSearchParams(useSearch());
  const parsed = scopeWorkspaceReadCommandSchema.safeParse({
    projectId: search.get("projectId"),
    intakeFormId: search.get("intakeFormId"),
  });
  if (
    !parsed.success ||
    search.getAll("projectId").length !== 1 ||
    search.getAll("intakeFormId").length !== 1
  ) {
    return (
      <Notice>
        Open a project and intake link with both IDs to view the saved records.
      </Notice>
    );
  }
  if (
    !auth.isAuthenticated ||
    auth.loading ||
    auth.error ||
    !auth.user?.tenantId ||
    browser.loading ||
    browser.error ||
    !browser.session ||
    auth.user.externalOpenId !== browser.session.user.id
  ) {
    return (
      <Notice>
        Sign in with an account that has access to this project and intake.
      </Notice>
    );
  }
  const identity: Identity = {
    actorId: auth.user.id,
    tenantId: auth.user.tenantId,
    subject: browser.session.user.id,
    generation: browser.generation,
  };
  // Remount the read boundary on any identity or pair change. No old view state
  // or pending handler can be transferred to the new request.
  const key = JSON.stringify([
    identity.actorId,
    identity.tenantId,
    identity.subject,
    identity.generation,
    parsed.data.projectId,
    parsed.data.intakeFormId,
  ]);
  return (
    <WorkspaceSnapshot
      key={key}
      identity={identity}
      command={parsed.data}
      sessionQuery={sessionQuery}
    />
  );
}

function matchesSnapshot(
  value: unknown,
  command: ScopeWorkspaceReadCommand,
  identity: Identity
): value is ScopeWorkspaceRead {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ScopeWorkspaceRead>;
  return (
    snapshot.version === ADR002_PROTOCOL.scopeWorkspaceRead &&
    snapshot.context?.actorId === identity.actorId &&
    snapshot.context.tenantId === identity.tenantId &&
    snapshot.project?.id === command.projectId &&
    snapshot.project.tenantId === identity.tenantId &&
    snapshot.intake?.id === command.intakeFormId &&
    snapshot.intake.projectId === command.projectId &&
    snapshot.intake.tenantId === identity.tenantId &&
    snapshot.scopes?.state === "notLoaded" &&
    snapshot.catalog?.state === "notLoaded"
  );
}

function WorkspaceSnapshot({
  identity,
  command,
  sessionQuery,
}: {
  identity: Identity;
  command: ScopeWorkspaceReadCommand;
  sessionQuery: SessionQuery;
}) {
  const utils = trpc.useUtils();
  const client = useQueryClient();
  const active = useRef(true);
  const latestSessionQuery = useRef(sessionQuery);
  latestSessionQuery.current = sessionQuery;
  const queryKey = [
    "scope-workspace-read",
    identity.actorId,
    identity.tenantId,
    identity.subject,
    identity.generation,
    command.projectId,
    command.intakeFormId,
  ] as const;

  function current() {
    const browser = getAuthSessionSnapshot();
    const profile = utils.auth.me.getData();
    const descriptor = currentQueryData(latestSessionQuery.current);
    const state = client.getQueryState(
      getQueryKey(trpc.auth.session, undefined, "query")
    );
    return (
      active.current &&
      !browser.loading &&
      !browser.error &&
      !!browser.session &&
      browser.generation === identity.generation &&
      browser.session.user.id === identity.subject &&
      profile?.id === identity.actorId &&
      profile.tenantId === identity.tenantId &&
      profile.externalOpenId === identity.subject &&
      descriptor?.estimateReadOnly === true &&
      descriptor.authenticated === true &&
      descriptor.scopeWorkspaceReadEnabled === true &&
      utils.auth.session.getData() === descriptor &&
      state?.status === "success" &&
      state.fetchStatus === "idle" &&
      !state.error
    );
  }

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!current() || signal.aborted)
        throw new Error("Project and intake access changed.");
      const result = await utils.client.scopeGeneration.loadWorkspace.query(
        command,
        { signal }
      );
      if (
        !current() ||
        signal.aborted ||
        !matchesSnapshot(result, command, identity)
      )
        throw new Error("Project and intake could not be verified.");
      return result;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "always",
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    active.current = true;
    const clear = () => {
      active.current = false;
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    };
    const stop = subscribeAuthIdentityChange(clear);
    return () => {
      stop();
      clear();
    };
  }, [
    client,
    identity.actorId,
    identity.tenantId,
    identity.subject,
    identity.generation,
    command.projectId,
    command.intakeFormId,
  ]);

  const data = currentQueryData(query);
  const snapshot =
    current() && matchesSnapshot(data, command, identity) ? data : undefined;
  const errorCode = (query.error as { data?: { code?: string } } | null)?.data
    ?.code;
  const unavailable =
    query.isError ||
    query.error ||
    (query.isSuccess && !query.isFetching && !snapshot);
  return (
    <div className="max-w-4xl space-y-5">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Project and intake</h1>
        <p className="text-sm text-muted-foreground">
          View the saved project and its linked intake.
        </p>
      </header>
      <button
        className="rounded-lg border border-border px-4 py-2 text-sm"
        disabled={query.isFetching || !current()}
        onClick={() => {
          if (current()) void query.refetch();
        }}
      >
        Refresh project and intake
      </button>
      {unavailable ? (
        <p role="alert">
          {errorCode === "FORBIDDEN" || errorCode === "UNAUTHORIZED"
            ? "You do not have access to this project and intake."
            : errorCode === "NOT_FOUND"
              ? "This project and intake could not be found."
              : "Could not load project and intake. Please try again."}
        </p>
      ) : !snapshot ? (
        <p role="status">Loading project and intake…</p>
      ) : (
        <>
          <StoredFields
            title="Project"
            fields={[
              ["Project", snapshot.project.name],
              ["Project ID", snapshot.project.id],
              ["Type", snapshot.project.projectType],
              ["Status", snapshot.project.status],
              ["Channel", snapshot.project.channel],
              ["Address", snapshot.project.address],
              ["City", snapshot.project.city],
              ["State", snapshot.project.state],
              ["ZIP code", snapshot.project.zipCode],
              ["County", snapshot.project.county],
              ["Saved zone", snapshot.project.zone],
            ]}
          />
          <StoredFields
            title="Intake"
            fields={[
              ["Intake ID", snapshot.intake.id],
              ["Status", snapshot.intake.status],
              ["Service type", snapshot.intake.serviceType],
              ["Area", snapshot.intake.area],
              ["Finish level", snapshot.intake.finishLevel],
              ["Condition", snapshot.intake.condition],
              ["Channel", snapshot.intake.channel],
              ["Notes", snapshot.intake.notes],
              ["Created", snapshot.intake.createdAt.toLocaleString()],
              ["Updated", snapshot.intake.updatedAt.toLocaleString()],
            ]}
          />
          <section
            aria-label="Next steps"
            className="rounded-xl border border-border bg-card p-4 space-y-2 text-sm"
          >
            <p>Scope drafts: not loaded. Catalog: not loaded.</p>
            {currentQueryData(sessionQuery)?.financialCalculatorEnabled === true ? (
              <a className="inline-flex rounded-lg border border-border px-4 py-2 font-medium" href={`/calculator?projectId=${snapshot.project.id}&intakeFormId=${snapshot.intake.id}`}>Open project Calculator</a>
            ) : <p>Scope generation, calculations and review are unavailable here.</p>}
            <p className="text-muted-foreground">
              The saved zone and intake describe the records only; they do not
              confirm geographic checks, pricing or approval.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function StoredFields({
  title,
  fields,
}: {
  title: string;
  fields: Array<[string, string | null]>;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-border bg-card p-4 space-y-3"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <dl className="grid gap-4 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap break-words text-sm">
              {value === null ? "Not provided" : value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
