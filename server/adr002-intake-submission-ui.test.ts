/** Real Intake markup/events with a controlled React hook host. Network and auth
 * snapshots are synthetic; this is not a mounted-browser or hosted attestation. */
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MutationObserver, QueryClient, onlineManager } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({
  active: false, cursor: 0, scope: "page", stores: {} as Record<string, unknown[]>,
  effects: [] as Array<() => void | (() => void)>, cleanups: [] as Array<() => void>,
  session: {} as any, profile: {} as any, auth: {} as any, snapshot: {} as any,
  limitedCreateOptions: undefined as Record<string, unknown> | undefined,
  create: vi.fn(), requests: vi.fn(), list: vi.fn(), status: vi.fn(),
  invalidate: vi.fn(), navigate: vi.fn(), success: vi.fn(), error: vi.fn(),
  identityListeners: new Set<() => void>(),
}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  function slot(initial: unknown) {
    const index = io.cursor++;
    const slots = io.stores[io.scope] ??= [];
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  }
  return { ...actual,
    useState: (initial: unknown) => io.active ? slot(initial) : actual.useState(initial),
    useRef: (initial: unknown) => io.active ? slot({ current: initial })[0] : actual.useRef(initial),
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      if (!io.active) return actual.useEffect(effect, deps);
      const [previous, setPrevious] = slot(undefined) as [unknown[] | undefined, (v: unknown) => void];
      if (!previous || deps.some((value, i) => value !== previous[i])) { io.effects.push(effect); setPrevious(deps); }
    },
    useSyncExternalStore: (subscribe: any, get: any, server: any) => io.active ? get() : actual.useSyncExternalStore(subscribe, get, server),
  };
});
vi.mock("@/lib/trpc", () => ({ trpc: {
  auth: { session: { _def: () => ({ path: ["auth", "session"] }), useQuery: () => io.session } },
  useUtils: () => ({
    auth: { me: { getData: () => io.profile }, session: { getData: () => io.session.data } },
    intake: { list: { invalidate: io.invalidate } }, clients: { list: { invalidate: io.invalidate } }, project: { list: { invalidate: io.invalidate } },
  }),
  intake: {
    list: { useQuery: io.list }, create: { useMutation: io.create }, updateStatus: { useMutation: () => ({ mutate: io.status }) },
  },
} }));
vi.mock("@tanstack/react-query", async original => ({
  ...(await original<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ getQueryState: () => ({ status: io.session.isError ? "error" : io.session.isSuccess ? "success" : "pending", fetchStatus: io.session.isFetching ? "fetching" : io.session.isPaused ? "paused" : "idle", error: io.session.error }) }),
}));
vi.mock("@/lib/auth-token", () => ({
  getAuthSessionSnapshot: () => io.snapshot,
  subscribeAuthSession: () => () => {},
  subscribeAuthIdentityChange: (fn: () => void) => { io.identityListeners.add(fn); return () => io.identityListeners.delete(fn); },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => io.auth }));
vi.mock("wouter", () => ({ useLocation: () => ["/intake", io.navigate], Link: () => null }));
vi.mock("sonner", () => ({ toast: { success: io.success, error: io.error } }));
import IntakePage from "../client/src/pages/Intake";
const receipt = { id: "b4700000-0000-4000-8000-000000000001", projectId: "b4700000-0000-4000-8000-000000000002", status: "draft" };
function success(data: unknown) { return { data, error: null, isError: false, isSuccess: true, isPending: false, isLoading: false, isFetching: false, isPaused: false }; }
function render() {
  io.cursor = 0; io.scope = "page"; io.active = true;
  let tree: ReactNode;
  try {
    tree = IntakePage();
    if (isValidElement(tree) && typeof tree.type === "function") {
      io.cursor = 0; io.scope = "limited";
      tree = (tree.type as any)(tree.props);
    }
  } finally { io.active = false; }
  for (const effect of io.effects.splice(0)) { const cleanup = effect(); if (cleanup) io.cleanups.push(cleanup); }
  return { tree, html: renderToStaticMarkup(tree) };
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function find(match: (node: ReactElement<any>) => boolean) {
  let result: ReactElement<any> | undefined;
  function visit(node: ReactNode) { if (!isValidElement<any>(node) || result) return; if (match(node)) result = node; else Children.forEach(node.props.children, visit); }
  visit(render().tree);
  expect(result, "the requested Intake control should be available").toBeDefined();
  return result!;
}
function click(label: string) { return find(node => node.type === "button" && text(node.props.children).trim() === label).props.onClick(); }
function field(label: string, value: string) { find(node => node.props.label === label).props.onChange(value); }
function fill() {
  click("New Intake");
  for (const [label, value] of [["Project Name", "Kitchen"], ["First Name", "Alex"], ["Last Name", "Owner"], ["Service Type", "Repair"], ["Property Address", "100 Example Lane"]]) field(label, value);
  find(node => node.props.id === "intake-project-type").props.onChange({ target: { value: "repair" } });
}
function submit() { return find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); }
function deferred() { let resolve!: (value: typeof receipt) => void; let reject!: (error: Error) => void; const promise = new Promise<typeof receipt>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function identityChange(kind: string) {
  if (kind === "actor") { io.auth.user = { ...io.auth.user, id: "actor-b" }; }
  if (kind === "tenant") { io.auth.user = { ...io.auth.user, tenantId: "tenant-b" }; }
  io.profile = io.auth.user;
  if (kind === "generation") io.snapshot = { ...io.snapshot, generation: io.snapshot.generation + 2 };
  if (kind === "logout") { io.snapshot = { ...io.snapshot, session: null, generation: io.snapshot.generation + 1 }; io.auth = { ...io.auth, user: null, isAuthenticated: false }; }
}
beforeEach(() => {
  for (const cleanup of io.cleanups.splice(0)) cleanup();
  vi.clearAllMocks(); io.limitedCreateOptions = undefined; io.stores = {}; io.effects = []; io.identityListeners.clear();
  io.session = success({ provider: "supabase", authenticated: true, supabase: { url: "https://example.invalid", publishableKey: "sb_publishable_synthetic" }, estimateReadOnly: true, intakeFormationEnabled: true });
  io.auth = { user: { id: "actor-a", tenantId: "tenant-a", externalOpenId: "subject-a", name: "Synthetic Operator", email: "operator@example.invalid", role: "admin", authProvider: "supabase", permissions: [], isActive: true }, loading: false, error: null, isAuthenticated: true, hasSession: true, authError: null, provider: "supabase", supabaseUser: { id: "subject-a" }, refresh: vi.fn(), signIn: vi.fn(), logout: vi.fn() };
  io.profile = io.auth.user;
  io.snapshot = { generation: 1, loading: false, error: null, session: { access_token: "synthetic-token", refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "subject-a", aud: "authenticated", created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} } } };
  io.list.mockReturnValue(success({ items: [{ ...receipt, rawPayload: { projectName: "Private cached project" } }] }));
  io.requests.mockResolvedValue(receipt);
  io.create.mockImplementation((options: Record<string, unknown>) => {
    if (io.scope === "limited") io.limitedCreateOptions = options;
    return { mutateAsync: io.requests, isPending: false };
  });
});

describe("limited intake submission", () => {
  it("offers initial formation but no list, filter, status or scope controls", () => {
    expect(render().html).toContain("New Intake"); fill();
    expect(render().html).toContain("Create Project Intake");
    expect(render().html).not.toMatch(/Private cached project|Filter:|Move to|Continue to scope/);
    expect(io.list.mock.calls.every(call => call[1].enabled === false)).toBe(true);
  });
  it.each(["isFetching", "isPending", "isLoading", "isPaused", "isError"])("withdraws actions while descriptor is %s", state => {
    io.session[state] = true;
    expect(render().html).not.toMatch(/<(button|form|input)\b/);
  });
  it("withholds actions when the enabled descriptor omits the required limited mode", () => {
    io.session = success({ ...io.session.data, estimateReadOnly: undefined });
    expect(render().html).not.toMatch(/<(button|form|input)\b/);
  });
  it("withholds actions for an unauthenticated descriptor even if its feature bit is true", () => {
    io.session = success({ ...io.session.data, authenticated: false });
    expect(render().html).not.toMatch(/<(button|form|input)\b/);
  });
  it.each(["actor", "tenant", "generation", "logout"])("will not send an old draft after %s changes before the first submit", async kind => {
    fill(); const handler = find(node => node.type === "form").props.onSubmit;
    identityChange(kind); await handler({ preventDefault() {} });
    expect(io.requests).not.toHaveBeenCalled();
    expect(render().html).not.toContain("Create Project Intake");
  });
  it("keeps a locally invalid draft editable before any possible send", async () => {
    fill(); field("First Name", " "); await submit();
    expect(io.requests).not.toHaveBeenCalled();
    field("First Name", "Taylor"); await submit();
    expect(io.requests.mock.calls[0][0].newProject.client.firstName).toBe("Taylor");
  });
  it("detaches and deeply freezes one payload and suppresses repeated submit", async () => {
    const pending = deferred(); io.requests.mockReturnValue(pending.promise); fill();
    const handler = find(node => node.type === "form").props.onSubmit;
    const first = handler({ preventDefault() {} }); const second = handler({ preventDefault() {} });
    const payload = io.requests.mock.calls[0][0];
    expect(io.requests).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(payload)).toBe(true); expect(Object.isFrozen(payload.newProject.client)).toBe(true); expect(Object.isFrozen(payload.rawPayload)).toBe(true);
    field("Project Name", "Changed");
    expect(find(node => node.props.label === "Project Name").props.value).toBe("Kitchen");
    expect(payload.newProject.name).toBe("Kitchen");
    pending.resolve(receipt); await first; await second;
  });
  it("resends the exact command explicitly after a lost response and never creates an offline retry queue", async () => {
    io.requests.mockRejectedValueOnce(new Error("network lost")); fill(); await submit();
    const original = io.requests.mock.calls[0][0]; const bytes = JSON.stringify(original);
    expect(render().html).toContain("may already have been saved"); expect(render().html).not.toMatch(/rolled back|retry to verify/i);
    expect(io.limitedCreateOptions).toMatchObject({ retry: false, networkMode: "always" });
    await click("Resend same request");
    expect(io.requests).toHaveBeenCalledTimes(2); expect(io.requests.mock.calls[1]).toHaveLength(1);
    expect(io.requests.mock.calls[1][0]).toBe(original); expect(JSON.stringify(io.requests.mock.calls[1][0])).toBe(bytes);
    expect(io.invalidate).not.toHaveBeenCalled(); expect(io.navigate).not.toHaveBeenCalled();
  });
  it.each(["actor", "tenant", "generation", "logout"])("blocks a captured resend before dispatch after %s changes without a rerender", async kind => {
    io.requests.mockRejectedValueOnce(new Error("lost")); fill(); await submit();
    const retry = find(node => node.type === "button" && text(node.props.children) === "Resend same request").props.onClick;
    identityChange(kind); await retry();
    expect(io.requests).toHaveBeenCalledTimes(1); expect(io.success).not.toHaveBeenCalled(); expect(io.navigate).not.toHaveBeenCalled();
  });
  it.each(["actor", "tenant", "generation", "logout"])("discards pending completion after %s changes", async kind => {
    const pending = deferred(); io.requests.mockReturnValue(pending.promise); fill(); const sending = submit();
    identityChange(kind); pending.resolve(receipt); await sending;
    expect(render().html).not.toContain(receipt.id); expect(io.success).not.toHaveBeenCalled(); expect(io.error).not.toHaveBeenCalled(); expect(io.invalidate).not.toHaveBeenCalled(); expect(io.navigate).not.toHaveBeenCalled();
  });
  it("discards an old error and finally callback after logout/login as the same user", async () => {
    const pending = deferred(); io.requests.mockReturnValue(pending.promise); fill(); const sending = submit();
    identityChange("generation"); pending.reject(new Error("private server detail")); await sending;
    expect(render().html).not.toContain("Resend same request"); expect(io.error).not.toHaveBeenCalled(); expect(io.invalidate).not.toHaveBeenCalled();
  });
  it.each(["actor", "tenant"])("cannot revive a discarded result when the prior %s returns", async kind => {
    const pending = deferred(); io.requests.mockReturnValue(pending.promise); fill(); const sending = submit();
    const original = io.auth.user; identityChange(kind); render();
    io.auth.user = original; io.profile = original; pending.resolve(receipt); await sending;
    expect(render().html).not.toContain(receipt.id); expect(render().html).not.toContain("Resend same request");
  });
  it("holds the result privately through a profile refresh error without losing same-session recovery", async () => {
    const pending = deferred(); io.requests.mockReturnValue(pending.promise); fill(); const sending = submit();
    io.auth = { ...io.auth, user: null, error: new Error("profile refresh unavailable"), isAuthenticated: false }; render();
    pending.resolve(receipt); await sending;
    expect(render().html).not.toContain(receipt.id); expect(render().html).not.toMatch(/<(button|form|input)\b/);
    io.auth = { ...io.auth, user: io.profile, error: null, isAuthenticated: true };
    expect(render().html).toContain(receipt.id);
  });
  it("accepts ordinary token renewal without abandoning the request", async () => {
    const pending = deferred(); io.requests.mockReturnValue(pending.promise); fill(); const sending = submit();
    io.snapshot = { ...io.snapshot, session: { ...io.snapshot.session, access_token: "refreshed-token" } };
    pending.resolve(receipt); await sending; expect(render().html).toContain(receipt.id);
  });
  it("shows the current replay receipt even when the project link is null", async () => {
    io.requests.mockResolvedValue({ ...receipt, projectId: null, status: "reviewed" }); fill(); await submit();
    const html = render().html; expect(html).toContain(receipt.id); expect(html).toContain("reviewed"); expect(html).toContain("Unavailable");
    expect(html).toMatch(/Geocoding.*pending/i); expect(html).toMatch(/calculation.*pending/i); expect(html).toMatch(/scope.*pending/i);
    expect(html).not.toContain("scope-generation"); expect(io.invalidate).not.toHaveBeenCalled(); expect(io.navigate).not.toHaveBeenCalled();
  });
  it("closing after a possible send preserves recovery and forbids an automatic new request", async () => {
    io.requests.mockRejectedValueOnce(new Error("lost")); fill(); await submit(); const sent = io.requests.mock.calls[0][0];
    click("Close form"); expect(render().html).not.toContain("Create Project Intake");
    expect(render().html).toContain("Resend same request"); expect(render().html).not.toContain("New Intake");
    await click("Resend same request"); expect(io.requests.mock.calls[1][0]).toBe(sent);
  });
  it("cancel before sending discards the draft", () => { fill(); click("Cancel"); click("New Intake"); expect(find(node => node.props.label === "Project Name").props.value).toBe(""); });
  it("preserves recovery across descriptor refetch and disable, withholding every action", async () => {
    io.requests.mockRejectedValueOnce(new Error("lost")); fill(); await submit(); const sent = io.requests.mock.calls[0][0];
    io.session = { ...io.session, isFetching: true }; expect(render().html).not.toMatch(/<(button|form|input)\b/);
    io.session = success({ ...io.session.data, intakeFormationEnabled: false }); expect(render().html).not.toMatch(/<(button|form|input)\b/);
    io.session = success({ ...io.session.data, intakeFormationEnabled: true }); await click("Resend same request"); expect(io.requests.mock.calls[1][0]).toBe(sent);
  });
  it("ignores a response after component unmount", async () => {
    const pending = deferred(); io.requests.mockReturnValue(pending.promise); fill(); const sending = submit();
    for (const cleanup of io.cleanups.splice(0)) cleanup(); pending.resolve(receipt); await sending;
    expect(render().html).not.toContain(receipt.id);
    expect(io.success).not.toHaveBeenCalled(); expect(io.error).not.toHaveBeenCalled(); expect(io.invalidate).not.toHaveBeenCalled(); expect(io.navigate).not.toHaveBeenCalled();
  });
  it("preserves the direct workflow's offline wait until reconnect", async () => {
    io.session = success({ ...io.session.data, estimateReadOnly: false, intakeFormationEnabled: false });
    render();
    const options = io.create.mock.lastCall![0];
    const client = new QueryClient();
    const previousOnline = onlineManager.isOnline();
    let attempts = 0;
    const observer = new MutationObserver(client, { ...options, mutationFn: async () => { attempts++; return receipt; } });
    client.mount(); onlineManager.setOnline(false);
    const result = observer.mutate(undefined);
    try {
      await Promise.resolve();
      expect(observer.getCurrentResult().isPaused).toBe(true);
      expect(attempts).toBe(0);
      onlineManager.setOnline(true);
      await result;
      expect(attempts).toBe(1);
      expect(observer.getCurrentResult().status).toBe("success");
    } finally {
      onlineManager.setOnline(true);
      await result;
      client.unmount(); client.clear(); onlineManager.setOnline(previousOnline);
    }
  });
  it("does not queue or retry an offline mutation when browser mutation defaults would", async () => {
    fill();
    const options = io.limitedCreateOptions;
    expect(options).toBeDefined();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 3, retryDelay: 0, networkMode: "online" } } });
    const previousOnline = onlineManager.isOnline();
    let attempts = 0;
    const observer = new MutationObserver(client, { ...options, mutationFn: async () => { attempts++; throw new Error("offline"); } });
    client.mount(); onlineManager.setOnline(false);
    try {
      const result = observer.mutate(undefined).catch(() => undefined);
      await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("error"));
      expect(observer.getCurrentResult().isPaused).toBe(false);
      onlineManager.setOnline(true); await result;
      expect(attempts).toBe(1);
    } finally { client.unmount(); client.clear(); onlineManager.setOnline(previousOnline); }
  });
});
