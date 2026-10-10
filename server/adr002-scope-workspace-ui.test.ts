/** Real page markup and handlers with controlled hook scheduling. The network
 * boundary is synthetic; these tests do not attest a browser or hosted ACL. */
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  active: false,
  cursor: 0,
  scope: "",
  stores: {} as Record<string, unknown[]>,
  effects: [] as Array<() => void>,
  cleanups: new Map<string, () => void>(),
  visited: new Set<string>(),
  session: {} as any,
  auth: {} as any,
  snapshot: {} as any,
  workspace: {} as any,
  search: "",
  queryOptions: undefined as any,
  client: undefined as any,
  rpc: vi.fn(),
  projectList: vi.fn(),
  intakeList: vi.fn(),
  legacyWorkspace: vi.fn(),
  generate: vi.fn(),
  review: vi.fn(),
  intakeCreate: vi.fn(),
  intakeStatus: vi.fn(),
  createRequest: vi.fn(),
  navigate: vi.fn(),
  identityListeners: new Set<() => void>(),
}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  function slot(initial: unknown) {
    const index = io.cursor++;
    const slots = (io.stores[io.scope] ??= []);
    if (!(index in slots))
      slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      slots[index],
      (value: unknown) => {
        slots[index] =
          typeof value === "function" ? value(slots[index]) : value;
      },
    ];
  }
  return {
    ...actual,
    useState: (initial: unknown) =>
      io.active ? slot(initial) : actual.useState(initial),
    useRef: (initial: unknown) =>
      io.active ? slot({ current: initial })[0] : actual.useRef(initial),
    useMemo: (fn: () => unknown, deps: unknown[]) =>
      io.active ? fn() : actual.useMemo(fn, deps),
    useCallback: (fn: unknown, deps: unknown[]) =>
      io.active ? fn : actual.useCallback(fn as any, deps),
    useSyncExternalStore: (subscribe: any, get: any, server: any) =>
      io.active ? get() : actual.useSyncExternalStore(subscribe, get, server),
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      if (!io.active) return actual.useEffect(effect, deps);
      const key = `${io.scope}/${io.cursor}`;
      const [previous, update] = slot(undefined) as [
        unknown[] | undefined,
        (v: unknown) => void,
      ];
      if (!previous || deps.some((value, i) => value !== previous[i])) {
        io.effects.push(() => {
          io.cleanups.get(key)?.();
          const cleanup = effect();
          if (cleanup) io.cleanups.set(key, cleanup);
        });
        update(deps);
      }
    },
  };
});
vi.mock("@tanstack/react-query", async original => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => io.client,
  useQuery: (options: unknown) => {
    io.queryOptions = options;
    return io.workspace;
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: {
      session: {
        _def: () => ({ path: ["auth", "session"] }),
        useQuery: () => io.session,
      },
    },
    useUtils: () => ({
      client: { scopeGeneration: { loadWorkspace: { query: io.rpc } } },
      auth: {
        me: { getData: () => io.auth.user },
        session: { getData: () => io.session.data },
      },
      intake: { list: { invalidate: vi.fn() } },
      clients: { list: { invalidate: vi.fn() } },
      project: { list: { invalidate: vi.fn() } },
    }),
    project: { list: { useQuery: io.projectList } },
    scopeGeneration: {
      loadWorkspace: { useQuery: io.legacyWorkspace },
      sendToReview: { useMutation: io.review },
    },
    scope: { generate: { useMutation: io.generate } },
    intake: {
      list: { useQuery: io.intakeList },
      create: { useMutation: io.intakeCreate },
      updateStatus: { useMutation: io.intakeStatus },
    },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => io.auth }));
vi.mock("@/lib/auth-token", () => ({
  getAuthSessionSnapshot: () => io.snapshot,
  subscribeAuthSession: () => () => {},
  subscribeAuthIdentityChange: (fn: () => void) => {
    io.identityListeners.add(fn);
    return () => io.identityListeners.delete(fn);
  },
}));
vi.mock("wouter", () => ({
  useSearch: () => io.search,
  useLocation: () => ["/scope-generation", io.navigate],
  Link: ({ children, ...props }: any) => createElement("a", props, children),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import ScopeGenerationPage from "../client/src/pages/ScopeGeneration";
import IntakePage from "../client/src/pages/Intake";
const ACTOR = "a4900000-0000-4000-8000-000000000001";
const TENANT = "a4900000-0000-4000-8000-000000000002";
const PROJECT = "b4900000-0000-4000-8000-000000000001";
const INTAKE = "b4900000-0000-4000-8000-000000000002";
const OTHER = "b4900000-0000-4000-8000-000000000003";
const receipt = { id: INTAKE, projectId: PROJECT, status: "draft" };
function success(data: unknown) {
  return {
    data,
    error: null,
    isError: false,
    isSuccess: true,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isPaused: false,
    refetch: vi.fn(),
  };
}
function envelope() {
  return {
    version: "structr-authenticated-scope-workspace-read-v1",
    context: { actorId: ACTOR, tenantId: TENANT },
    project: {
      id: PROJECT,
      tenantId: TENANT,
      name: "Synthetic kitchen",
      projectType: "repair",
      channel: "direct",
      status: "intake",
      address: "100 Example Lane",
      city: "Charleston",
      state: "SC",
      zipCode: "29401",
      county: "Charleston",
      zone: "coastal",
    },
    intake: {
      id: INTAKE,
      tenantId: TENANT,
      projectId: PROJECT,
      status: "draft",
      serviceType: "Kitchen repair",
      area: "1,200 stored text",
      finishLevel: "standard",
      condition: "Fair",
      channel: "direct",
      notes: "Private saved notes",
      createdAt: new Date("2026-10-09T10:00:00.000Z"),
      updatedAt: new Date("2026-10-09T11:00:00.000Z"),
    },
    scopes: { state: "notLoaded" },
    catalog: { state: "notLoaded" },
  };
}
function render(Page = ScopeGenerationPage) {
  io.visited.clear();
  io.active = true;
  let tree: ReactNode;
  try {
    io.scope = Page.name;
    io.cursor = 0;
    io.visited.add(io.scope);
    tree = Page();
    while (isValidElement<any>(tree) && typeof tree.type === "function") {
      io.scope = `${tree.type.name}:${tree.key ?? ""}`;
      io.cursor = 0;
      io.visited.add(io.scope);
      tree = (tree.type as any)(tree.props);
    }
  } finally {
    io.active = false;
  }
  for (const [key, cleanup] of io.cleanups)
    if (!io.visited.has(key.slice(0, key.lastIndexOf("/")))) {
      cleanup();
      io.cleanups.delete(key);
    }
  for (const effect of io.effects.splice(0)) effect();
  return { tree, html: renderToStaticMarkup(tree) };
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node)
    ? text(node.props.children)
    : "";
}
function find(tree: ReactNode, match: (node: ReactElement<any>) => boolean) {
  let result: ReactElement<any> | undefined;
  function visit(node: ReactNode) {
    if (!isValidElement<any>(node) || result) return;
    if (match(node)) result = node;
    else Children.forEach(node.props.children, visit);
  }
  visit(tree);
  expect(result, "requested control is rendered").toBeDefined();
  return result!;
}
function button(label: string, Page = ScopeGenerationPage) {
  return find(
    render(Page).tree,
    node => node.type === "button" && text(node.props.children).trim() === label
  );
}
function refresh() {
  return button("Refresh project and intake").props.onClick();
}
function fillIntake() {
  button("New Intake", IntakePage).props.onClick();
  for (const [label, value] of [
    ["Project Name", "Kitchen"],
    ["First Name", "Alex"],
    ["Last Name", "Owner"],
    ["Service Type", "Repair"],
    ["Property Address", "100 Example Lane"],
  ]) {
    find(
      render(IntakePage).tree,
      node => node.props.label === label
    ).props.onChange(value);
  }
  find(
    render(IntakePage).tree,
    node => node.props.id === "intake-project-type"
  ).props.onChange({ target: { value: "repair" } });
}
function submitIntake() {
  return find(
    render(IntakePage).tree,
    node => node.type === "form"
  ).props.onSubmit({ preventDefault() {} });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
}
function changeIdentity() {
  io.snapshot = { ...io.snapshot, generation: io.snapshot.generation + 1 };
  for (const listener of io.identityListeners) listener();
}
beforeEach(() => {
  for (const cleanup of io.cleanups.values()) cleanup();
  io.cleanups.clear();
  io.client?.clear();
  vi.clearAllMocks();
  io.stores = {};
  io.effects = [];
  io.identityListeners.clear();
  io.queryOptions = undefined;
  io.client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  io.session = success({
    provider: "supabase",
    authenticated: true,
    supabase: null,
    estimateReadOnly: true,
    intakeFormationEnabled: true,
    scopeWorkspaceReadEnabled: true,
  });
  io.client.setQueryData(
    [["auth", "session"], { type: "query" }],
    io.session.data
  );
  io.auth = {
    user: {
      id: ACTOR,
      tenantId: TENANT,
      externalOpenId: "subject-a",
      role: "user",
      isActive: true,
    },
    isAuthenticated: true,
    loading: false,
    error: null,
  };
  io.snapshot = {
    generation: 1,
    loading: false,
    error: null,
    session: {
      user: { id: "subject-a" },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  };
  io.search = `projectId=${PROJECT}&intakeFormId=${INTAKE}`;
  io.workspace = success(envelope());
  io.rpc.mockResolvedValue(envelope());
  io.projectList.mockReturnValue(success({ items: [] }));
  io.legacyWorkspace.mockReturnValue(success(undefined));
  io.intakeList.mockReturnValue(success({ items: [] }));
  io.intakeCreate.mockReturnValue({ mutateAsync: io.createRequest });
  io.createRequest.mockResolvedValue(receipt);
  io.intakeStatus.mockReturnValue({ mutate: vi.fn() });
  io.generate.mockReturnValue({ mutate: vi.fn() });
  io.review.mockReturnValue({ mutate: vi.fn() });
});

describe("SWR-1 workspace UI", () => {
  it("never mounts legacy lists or writers in the authenticated workspace", () => {
    render();
    for (const forbidden of [
      io.projectList,
      io.intakeList,
      io.legacyWorkspace,
      io.generate,
      io.review,
      io.intakeCreate,
      io.intakeStatus,
    ])
      expect(forbidden).not.toHaveBeenCalled();
  });
  it("reads only the explicit pair and passes cancellation to the endpoint", async () => {
    expect(render().html).toContain("Synthetic kitchen");
    const controller = new AbortController();
    await io.queryOptions.queryFn({ signal: controller.signal });
    expect(io.rpc).toHaveBeenCalledWith(
      { projectId: PROJECT, intakeFormId: INTAKE },
      expect.objectContaining({ signal: controller.signal })
    );
  });
  it("can read while formation is closed because the capability is independent", () => {
    io.session.data.intakeFormationEnabled = false;
    expect(render().html).toContain("Private saved notes");
  });
  it("does not read when only formation is enabled", () => {
    io.session.data.scopeWorkspaceReadEnabled = false;
    expect(render().html).not.toContain("Private saved notes");
    expect(io.queryOptions).toBeUndefined();
    expect(io.projectList).not.toHaveBeenCalled();
  });
  it("withholds a cached descriptor while availability is being rechecked", () => {
    io.session.isFetching = true;
    expect(render().html).not.toContain("Synthetic kitchen");
    expect(io.queryOptions).toBeUndefined();
    expect(io.projectList).not.toHaveBeenCalled();
  });
  it("reports a terminal session descriptor failure without a perpetual loading message", () => {
    io.session.isError = true;
    io.session.error = new Error("private session detail");
    const html = render().html;
    expect(html).toMatch(/role="alert"/);
    expect(html).toMatch(/unavailable/i);
    expect(html).not.toMatch(/Checking|Loading|private session detail|Synthetic kitchen/);
    expect(io.queryOptions).toBeUndefined();
    expect(io.projectList).not.toHaveBeenCalled();
  });
  it("requires a current profile tied to the browser subject", () => {
    io.auth.user.externalOpenId = "different-subject";
    expect(render().html).not.toContain("Private saved notes");
    expect(io.queryOptions).toBeUndefined();
  });
  it.each([
    ["missing intake", `projectId=${PROJECT}`],
    ["missing project", `intakeFormId=${INTAKE}`],
    ["uppercase", `projectId=${PROJECT.toUpperCase()}&intakeFormId=${INTAKE}`],
    [
      "nil",
      `projectId=00000000-0000-0000-0000-000000000000&intakeFormId=${INTAKE}`,
    ],
    [
      "duplicate",
      `projectId=${PROJECT}&projectId=${OTHER}&intakeFormId=${INTAKE}`,
    ],
  ])("does not fetch an invalid URL pair: %s", (_label, search) => {
    io.search = search;
    expect(render().html).toMatch(/project.*intake.*link/i);
    expect(io.queryOptions).toBeUndefined();
  });
  it("shows stored text without turning missing values into quantities or readiness", () => {
    io.workspace.data.intake.condition = null;
    io.workspace.data.project.zone = null;
    const html = render().html;
    expect(html).toContain("1,200 stored text");
    expect(html).toContain("Not provided");
    expect(html).not.toMatch(/Default area|Confidence|Profit Shield|\$0/);
  });
  it("labels unqueried scope and catalog and offers no generation, calculation or review action", () => {
    const html = render().html;
    expect(html).toMatch(/scope.*not (?:loaded|checked|consulted)/i);
    expect(html).toMatch(/catalog.*not (?:loaded|checked|consulted)/i);
    expect(html).not.toMatch(
      />Generate Scope<|>Send to Review<|href="\/calculator|No scope drafts/
    );
  });
  it("hides the entire cached pair during refresh", () => {
    io.workspace.isFetching = true;
    const html = render().html;
    expect(html).not.toMatch(/Synthetic kitchen|Private saved notes/);
    expect(html).toMatch(/loading|checking/i);
  });
  it("shows refusal without stale data or raw server details", () => {
    io.workspace = {
      ...io.workspace,
      isError: true,
      error: {
        data: { code: "FORBIDDEN" },
        message: "private database detail",
      },
    };
    const html = render().html;
    expect(html).toMatch(/access|permission/i);
    expect(html).not.toMatch(
      /Synthetic kitchen|Private saved notes|private database detail/
    );
  });
  it.each(["actor", "tenant", "project", "intake", "link", "partial"])(
    "rejects the entire mismatched response: %s",
    change => {
      const data = io.workspace.data;
      if (change === "actor") data.context.actorId = OTHER;
      if (change === "tenant") data.intake.tenantId = OTHER;
      if (change === "project") data.project.id = OTHER;
      if (change === "intake") data.intake.id = OTHER;
      if (change === "link") data.intake.projectId = OTHER;
      if (change === "partial") delete data.intake;
      expect(render().html).not.toMatch(
        /Synthetic kitchen|Private saved notes/
      );
    }
  );
  it("switches URL pairs without showing the previous pair or accepting its late payload", async () => {
    render();
    const oldOptions = io.queryOptions;
    const pending = deferred<ReturnType<typeof envelope>>();
    io.rpc.mockReturnValue(pending.promise);
    const reading = oldOptions.queryFn({
      signal: new AbortController().signal,
    });
    io.search = `projectId=${PROJECT}&intakeFormId=${OTHER}`;
    expect(render().html).not.toMatch(/Synthetic kitchen|Private saved notes/);
    expect(io.queryOptions.queryKey).not.toEqual(oldOptions.queryKey);
    pending.resolve(envelope());
    await expect(reading).rejects.toThrow();
  });
  it("drops a late response after the sign-in generation changes", async () => {
    render();
    const pending = deferred<ReturnType<typeof envelope>>();
    io.rpc.mockReturnValue(pending.promise);
    const reading = io.queryOptions.queryFn({
      signal: new AbortController().signal,
    });
    changeIdentity();
    pending.resolve(envelope());
    await expect(reading).rejects.toThrow();
  });
  it("does not run a captured refresh after identity changes", () => {
    const handler = button("Refresh project and intake").props.onClick;
    changeIdentity();
    handler();
    expect(io.workspace.refetch).not.toHaveBeenCalled();
  });
  it("refreshes only the read and never replays formation", () => {
    refresh();
    expect(io.workspace.refetch).toHaveBeenCalledTimes(1);
    expect(io.createRequest).not.toHaveBeenCalled();
  });
  it("cancels the actual query observer request and removes its cache when unmounted", async () => {
    io.workspace = {
      ...success(undefined),
      isPending: true,
      isLoading: true,
      isSuccess: false,
    };
    render();
    let signal: AbortSignal | undefined;
    io.rpc.mockImplementation((_input, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const observer = new QueryObserver(io.client, io.queryOptions);
    const stop = observer.subscribe(() => {});
    await Promise.resolve();
    expect(signal?.aborted).toBe(false);
    stop();
    io.session.data.scopeWorkspaceReadEnabled = false;
    render();
    expect(signal?.aborted).toBe(true);
    expect(
      io.client
        .getQueryCache()
        .find({ queryKey: io.queryOptions.queryKey, exact: true })
    ).toBeUndefined();
  });
  it("preserves the direct workspace selector and generation hooks", () => {
    io.session.data.estimateReadOnly = false;
    io.session.data.scopeWorkspaceReadEnabled = false;
    io.search = "";
    expect(render().html).toContain("Choose a project");
    expect(io.projectList).toHaveBeenCalled();
    expect(io.generate).toHaveBeenCalled();
    expect(io.review).toHaveBeenCalled();
    expect(io.queryOptions).toBeUndefined();
  });
});

describe("confirmed intake handoff", () => {
  it("links only the IDs returned by a confirmed receipt", async () => {
    fillIntake();
    await submitIntake();
    const html = render(IntakePage).html;
    expect(html).toContain(
      `/scope-generation?projectId=${PROJECT}&amp;intakeFormId=${INTAKE}`
    );
    expect(html).toContain("View project and intake");
    expect(io.navigate).not.toHaveBeenCalled();
  });
  it("does not infer a link after an uncertain response", async () => {
    io.createRequest.mockRejectedValue(new Error("network unavailable"));
    fillIntake();
    await submitIntake();
    expect(render(IntakePage).html).not.toContain("scope-generation");
    expect(io.createRequest).toHaveBeenCalledTimes(1);
  });
  it("keeps a confirmed receipt without navigation when the read capability is closed", async () => {
    io.session.data.scopeWorkspaceReadEnabled = false;
    fillIntake();
    await submitIntake();
    const html = render(IntakePage).html;
    expect(html).toContain("Intake receipt confirmed");
    expect(html).not.toContain("scope-generation");
  });
  it("does not link a receipt with no current project", async () => {
    io.createRequest.mockResolvedValue({ ...receipt, projectId: null });
    fillIntake();
    await submitIntake();
    expect(render(IntakePage).html).not.toContain("scope-generation");
  });
  it("keeps the confirmed handoff available when formation closes but reading remains enabled", async () => {
    fillIntake();
    await submitIntake();
    io.session.data.intakeFormationEnabled = false;
    const html = render(IntakePage).html;
    expect(html).toContain("Intake receipt confirmed");
    expect(html).toContain(
      `/scope-generation?projectId=${PROJECT}&amp;intakeFormId=${INTAKE}`
    );
    expect(io.createRequest).toHaveBeenCalledTimes(1);
  });
  it("does not navigate a captured receipt link after a session change", async () => {
    fillIntake();
    await submitIntake();
    const link = find(
      render(IntakePage).tree,
      node =>
        typeof node.props.href === "string" &&
        node.props.href.startsWith("/scope-generation")
    );
    const preventDefault = vi.fn();
    changeIdentity();
    link.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(io.navigate).not.toHaveBeenCalled();
    expect(render(IntakePage).html).not.toContain("scope-generation");
  });
});

describe('Calculator contextual workspace navigation',()=>{
 it('offers only the confirmed pair when its independent capability is open',()=>{io.session.data.financialCalculatorEnabled=true;expect(render().html).toContain(`href="/calculator?projectId=${PROJECT}&amp;intakeFormId=${INTAKE}"`);expect(io.projectList).not.toHaveBeenCalled();});
 it('does not expose a calculator link from a mismatched snapshot',()=>{io.session.data.financialCalculatorEnabled=true;io.workspace.data.intake.projectId=OTHER;expect(render().html).not.toContain('href="/calculator');});
});
