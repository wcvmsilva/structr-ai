/** Real Intake markup, callbacks and query options with controlled hook results.
 * Explicit state rerenders cover presentation, not browser scheduling or hosted authorization. */
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryObserver, focusManager, onlineManager, notifyManager } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  session: vi.fn(), list: vi.fn(), create: vi.fn(), updateStatus: vi.fn(),
  createRequest: vi.fn(), statusRequest: vi.fn(), navigate: vi.fn(),
  intakeInvalidate: vi.fn(), clientsInvalidate: vi.fn(), projectsInvalidate: vi.fn(),
  error: vi.fn(), success: vi.fn(),
  slots: [] as unknown[], cursor: 0, capture: false,
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      if (!io.capture) return actual.useState(initial);
      const index = io.cursor++;
      if (!(index in io.slots)) io.slots[index] = typeof initial === "function" ? initial() : initial;
      return [io.slots[index], (value: unknown) => {
        io.slots[index] = typeof value === "function" ? value(io.slots[index]) : value;
      }];
    },
  };
});
vi.mock("@/lib/trpc", () => ({ trpc: {
  auth: { session: { useQuery: io.session } },
  useUtils: () => ({
    intake: { list: { invalidate: io.intakeInvalidate } },
    clients: { list: { invalidate: io.clientsInvalidate } },
    project: { list: { invalidate: io.projectsInvalidate } },
  }),
  intake: {
    list: { useQuery: io.list },
    create: { useMutation: io.create },
    updateStatus: { useMutation: io.updateStatus },
  },
} }));
vi.mock("wouter", () => ({
  useLocation: () => ["/intake", io.navigate],
  Link: ({ children, href }: { children?: ReactNode; href: string }) => createElement("a", { href }, children),
}));
vi.mock("sonner", () => ({ toast: { error: io.error, success: io.success } }));
import IntakePage from "../client/src/pages/Intake";

const INTAKE = "b4700000-0000-4000-8000-000000000001";
const PROJECT = "b4700000-0000-4000-8000-000000000002";
const form = {
  projectName: "Synthetic kitchen", projectType: "repair", clientFirstName: "Alex",
  clientLastName: "Owner", clientEmail: "", clientPhone: "", address: "100 Example Lane",
  city: "Charleston", county: "Charleston", state: "SC", zipCode: "29401", channel: "direct",
  serviceType: "Kitchen repair", area: "100", finishLevel: "standard", condition: "Fair", notes: "",
};
const intake = {
  id: INTAKE, projectId: PROJECT, status: "draft", channel: "direct",
  serviceType: "Kitchen repair", finishLevel: "standard", notes: "Synthetic private notes",
  rawPayload: { projectName: "Existing kitchen", clientName: "Existing owner" },
};
const sessionData = { provider: "supabase", authenticated: true, supabase: null, estimateReadOnly: false };
function success(data: unknown) {
  return {
    data, error: null, isError: false, isSuccess: true,
    isPending: false, isLoading: false, isFetching: false, isPaused: false,
  };
}
function render() {
  io.cursor = 0;
  io.capture = true;
  let tree: ReactNode;
  try { tree = IntakePage(); } finally { io.capture = false; }
  return { tree, html: renderToStaticMarkup(tree) };
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return "";
}
function find(tree: ReactNode, match: (node: ReactElement<Record<string, any>>) => boolean) {
  let found: ReactElement<Record<string, any>> | undefined;
  function visit(node: ReactNode) {
    if (found || !isValidElement<Record<string, any>>(node)) return;
    if (match(node)) { found = node; return; }
    Children.forEach(node.props.children, visit);
  }
  visit(tree);
  if (!found) throw new Error("Expected Intake control was not rendered");
  return found;
}
function click(label: string) {
  find(render().tree, node => node.type === "button" && text(node.props.children).trim() === label).props.onClick();
}
function field(label: string, value: string) {
  find(render().tree, node => node.props.label === label).props.onChange(value);
}
function fillForm() {
  click("New Intake");
  for (const [label, value] of [
    ["Project Name", form.projectName], ["First Name", form.clientFirstName],
    ["Last Name", form.clientLastName], ["Service Type", form.serviceType],
    ["Property Address", form.address], ["ZIP Code", form.zipCode],
    ["Area / Scope", form.area], ["Condition", form.condition],
  ]) field(label, value);
  find(render().tree, node => node.props.id === "intake-project-type").props.onChange({ target: { value: form.projectType } });
}
async function submit() {
  await find(render().tree, node => node.type === "form").props.onSubmit({ preventDefault: vi.fn() });
}
function expectUnavailable(html: string) {
  expect(io.list).toHaveBeenLastCalledWith({ status: undefined }, expect.objectContaining({ enabled: false }));
  expect(html).not.toMatch(/<(button|form|input|textarea|select|a)\b/);
  expect(html).not.toContain("Existing kitchen");
  expect(html).not.toContain("Existing owner");
  expect(html).not.toContain("Synthetic private notes");
  expect(html).not.toContain("No intake forms yet");
  expect(html).not.toContain("private server detail");
  expect(io.createRequest).not.toHaveBeenCalled();
  expect(io.statusRequest).not.toHaveBeenCalled();
  expect(io.navigate).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks(); io.slots = []; io.cursor = 0; io.capture = false;
  io.session.mockReturnValue(success(sessionData));
  io.list.mockReturnValue(success({ items: [intake], total: 1 }));
  io.createRequest.mockResolvedValue({ id: INTAKE, projectId: PROJECT });
  io.create.mockReturnValue({ mutateAsync: io.createRequest, isPending: false });
  io.updateStatus.mockReturnValue({ mutate: io.statusRequest, isPending: false });
});

describe("Intake presentation follows the current session access descriptor", () => {
  it.each(["supabase", "legacy"])("withholds unavailable RPCs and cached Intake UI for %s sessions in limited mode", provider => {
    io.session.mockReturnValue(success({ ...sessionData, provider, estimateReadOnly: true }));
    const { html } = render();
    expectUnavailable(html);
    expect(html).toMatch(/limited access/i);
    expect(html).toMatch(/not available|unavailable/i);
    expect(html).toContain('role="status"');
  });

  it.each([
    ["missing result", success(undefined), "alert"],
    ["null result", success(null), "alert"],
    ["missing descriptor", success({ provider: "supabase", authenticated: true }), "alert"],
    ["numeric descriptor", success({ ...sessionData, estimateReadOnly: 0 }), "alert"],
    ["string descriptor", success({ ...sessionData, estimateReadOnly: "false" }), "alert"],
    ["initial load", { ...success(undefined), isSuccess: false, isPending: true, isLoading: true, isFetching: true }, "status"],
    ["cached direct while pending", { ...success(sessionData), isPending: true }, "status"],
    ["cached direct while loading", { ...success(sessionData), isLoading: true }, "status"],
    ["cached direct during refetch", { ...success(sessionData), isFetching: true }, "status"],
    ["cached direct while paused", { ...success(sessionData), isPaused: true }, "status"],
    ["cached direct without success", { ...success(sessionData), isSuccess: false }, "alert"],
    ["cached direct after failure", { ...success(sessionData), isSuccess: false, isError: true, error: new Error("private server detail") }, "alert"],
    ["cached direct with an error", { ...success(sessionData), error: new Error("private server detail") }, "alert"],
  ])("%s cannot expose the list, form or status controls", (_name, result, role) => {
    io.session.mockReturnValue(result);
    const { html } = render();
    expectUnavailable(html);
    expect(html).toContain(`role="${role}"`);
    expect(html).toMatch(/access/i);
  });

  it.each([
    ["limited mode", success({ ...sessionData, estimateReadOnly: true })],
    ["session refresh", { ...success(sessionData), isFetching: true }],
  ])("withdraws an already open form and expanded cached row during %s", (_name, result) => {
    fillForm();
    const row = find(render().tree, node => node.type === "button" && text(node.props.children).includes("Existing kitchen"));
    row.props.onClick();
    const before = render().html;
    expect(before).toContain("Create Project Intake");
    expect(before).toContain("Move to");
    expect(before).toContain("Synthetic private notes");
    io.session.mockReturnValue(result);
    expectUnavailable(render().html);
  });
});

describe("current direct-mode Intake behavior remains available", () => {
  it.each(["supabase", "legacy"])("preserves the list and status filter for the %s provider", provider => {
    io.session.mockReturnValue(success({ ...sessionData, provider }));
    expect(render().html).toContain("Existing kitchen");
    expect(io.list).toHaveBeenLastCalledWith({ status: undefined }, expect.objectContaining({ enabled: true }));
    click("Reviewed");
    render();
    expect(io.list).toHaveBeenLastCalledWith({ status: "reviewed" }, expect.objectContaining({ enabled: true }));
  });

  it("updates the expanded record with its original identity and next status", () => {
    const row = find(render().tree, node => node.type === "button" && text(node.props.children).includes("Existing kitchen"));
    row.props.onClick();
    click("Move to Parsing");
    expect(io.statusRequest).toHaveBeenCalledTimes(1);
    expect(io.statusRequest).toHaveBeenCalledWith({ id: INTAKE, status: "parsing" });
    io.updateStatus.mock.lastCall![0].onSuccess();
    expect(io.intakeInvalidate).toHaveBeenCalledOnce();
    expect(io.success).toHaveBeenCalledWith("Status updated");
  });

  it("submits one atomic payload and keeps the existing scope handoff", async () => {
    fillForm();
    await submit();
    expect(io.createRequest).toHaveBeenCalledTimes(1);
    expect(io.createRequest).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      newProject: {
        name: form.projectName, projectType: "repair",
        client: { firstName: "Alex", lastName: "Owner", email: undefined, phone: undefined },
        address: form.address, city: "Charleston", county: "Charleston", state: "SC", zip: "29401",
      },
      channel: "direct", serviceType: "Kitchen repair", area: "100", finishLevel: "standard",
      condition: "Fair", notes: undefined,
      rawPayload: {
        projectName: form.projectName, clientName: "Alex Owner", address: form.address,
        city: "Charleston", county: "Charleston", channel: "direct", serviceType: "Kitchen repair",
        area: "100", finishLevel: "standard", condition: "Fair",
      },
    });
    expect(io.clientsInvalidate).toHaveBeenCalledOnce();
    expect(io.projectsInvalidate).toHaveBeenCalledOnce();
    io.create.mock.lastCall![0].onSuccess({ id: INTAKE, projectId: PROJECT });
    expect(io.intakeInvalidate).toHaveBeenCalledOnce();
    expect(io.navigate).toHaveBeenCalledTimes(1);
    expect(io.navigate).toHaveBeenCalledWith(`/scope-generation?projectId=${PROJECT}&intakeFormId=${INTAKE}`);
    expect(render().html).not.toContain("Create Project Intake");
  });

  it("retains the entered form and retry identifier after a server refusal", async () => {
    io.createRequest.mockRejectedValue(new Error("Intake access refused"));
    fillForm();
    await submit();
    expect(io.error).toHaveBeenCalledWith("Intake access refused");
    expect(io.navigate).not.toHaveBeenCalled();
    expect(io.projectsInvalidate).not.toHaveBeenCalled();
    expect(find(render().tree, node => node.props.label === "Project Name").props.value).toBe(form.projectName);
    await submit();
    expect(io.createRequest).toHaveBeenCalledTimes(2);
    expect(io.createRequest.mock.calls[1][0]).toEqual(io.createRequest.mock.calls[0][0]);
  });

  it.each([
    ["Project Name", "Project name is required"],
    ["First Name", "Client first and last name are required"],
    ["Property Address", "Project type, service type, and property address are required"],
  ])("preserves validation of %s before dispatching create", async (label, message) => {
    fillForm(); field(label, " ");
    await submit();
    expect(io.error).toHaveBeenCalledWith(message);
    expect(io.createRequest).not.toHaveBeenCalled();
  });
});

function observeIntake(retry: boolean | number = false) {
  const originalFocus = focusManager.isFocused();
  const originalOnline = onlineManager.isOnline();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry, retryDelay: 0, gcTime: Infinity } },
  });
  const sessionRequest = vi.fn(async () => ({ ...sessionData }));
  const listRequest = vi.fn(async () => ({ items: [intake], total: 1 }));
  const sessionOptions = { queryKey: ["auth", "session"], queryFn: sessionRequest };
  const sessionObserver = new QueryObserver(queryClient, sessionOptions);
  io.session.mockImplementation(() => sessionObserver.getCurrentResult());
  render();
  sessionObserver.setOptions({ ...sessionOptions, ...io.session.mock.lastCall?.[1] });
  const listOptions = () => ({
    queryKey: ["intake", "list", io.list.mock.lastCall![0]],
    queryFn: listRequest,
    ...io.list.mock.lastCall![1],
  });
  const listObserver = new QueryObserver(queryClient, listOptions());
  io.list.mockImplementation(() => listObserver.getCurrentResult());
  let view = render();
  let active = true;
  const rerender = () => {
    if (!active) return;
    view = render();
    listObserver.setOptions(listOptions());
  };
  queryClient.mount();
  // React Query defers its store notifications through batchCalls. A synchronous
  // subscriber would close enabled before the event reached the list, hiding the race.
  const stopSession = sessionObserver.subscribe(notifyManager.batchCalls(rerender));
  const stopList = listObserver.subscribe(notifyManager.batchCalls(rerender));
  return {
    sessionRequest,
    listRequest,
    sessionObserver,
    listObserver,
    html: () => view.html,
    rerender,
    dispose() {
      active = false;
      stopSession();
      stopList();
      queryClient.unmount();
      queryClient.clear();
      focusManager.setFocused(originalFocus);
      onlineManager.setOnline(originalOnline);
    },
  };
}

describe("Intake idle-query revalidation with real QueryClient observers", () => {
  it.each([
    ["focus", "direct"], ["focus", "limited"], ["focus", "error"],
    ["reconnect", "direct"], ["reconnect", "limited"], ["reconnect", "error"],
  ] as const)("%s waits for session verification before a list request when the result is %s", async (event, outcome) => {
    const observed = observeIntake();
    let resolveSession!: (value: typeof sessionData) => void;
    let rejectSession!: (error: Error) => void;
    const refreshedSession = new Promise<typeof sessionData>((resolve, reject) => {
      resolveSession = resolve;
      rejectSession = reject;
    });
    try {
      await vi.waitFor(() => {
        expect(observed.sessionRequest).toHaveBeenCalledTimes(1);
        expect(observed.listRequest).toHaveBeenCalledTimes(1);
        expect(observed.sessionObserver.getCurrentResult().fetchStatus).toBe("idle");
        expect(observed.listObserver.getCurrentResult().fetchStatus).toBe("idle");
        expect(observed.html()).toContain("Existing kitchen");
      });
      observed.sessionRequest.mockReturnValueOnce(refreshedSession);
      if (event === "focus") {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      } else {
        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
      }
      await vi.waitFor(() => {
        expect(observed.sessionRequest).toHaveBeenCalledTimes(2);
        expect(observed.html()).toContain("Checking intake access");
      });
      // Session transport is still deferred; the same focus/online batch must
      // not dispatch an intake request using the previous direct descriptor.
      expect(observed.sessionObserver.getCurrentResult().fetchStatus).toBe("fetching");
      expect(observed.listRequest).toHaveBeenCalledTimes(1);
      if (outcome === "error") rejectSession(new Error("private server detail"));
      else resolveSession({ ...sessionData, estimateReadOnly: outcome === "limited" });
      await vi.waitFor(() => {
        expect(observed.sessionObserver.getCurrentResult().fetchStatus).toBe("idle");
        if (outcome === "direct") {
          expect(observed.listRequest).toHaveBeenCalledTimes(2);
          expect(observed.listObserver.getCurrentResult().fetchStatus).toBe("idle");
          expect(observed.html()).toContain("Existing kitchen");
        } else {
          expect(observed.html()).toContain(outcome === "limited" ? "Limited access" : "Intake access unavailable");
          expectUnavailable(observed.html());
          expect(observed.listRequest).toHaveBeenCalledTimes(1);
        }
      });
    } finally {
      resolveSession(sessionData);
      observed.dispose();
    }
  });
});

describe("Intake read failures do not claim an empty or current list", () => {
  it.each(["no cached data", "cached rows"])("shows a sanitized read error with %s while preserving the direct creation form", cache => {
    const row = find(render().tree, node => node.type === "button" && text(node.props.children).includes("Existing kitchen"));
    row.props.onClick();
    expect(render().html).toContain("Move to");
    io.list.mockReturnValue({
      ...success(cache === "cached rows" ? { items: [intake], total: 1 } : undefined),
      isSuccess: false,
      isError: true,
      error: new Error("private server detail"),
    });
    const { html } = render();
    expect(html).toContain("Unable to load intake forms");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("private server detail");
    expect(html).not.toContain("Existing kitchen");
    expect(html).not.toContain("Existing owner");
    expect(html).not.toContain("Synthetic private notes");
    expect(html).not.toContain("Move to");
    expect(html).not.toContain("Continue to scope");
    expect(html).not.toContain("No intake forms");
    click("New Intake");
    expect(render().html).toContain("Create Project Intake");
    expect(io.createRequest).not.toHaveBeenCalled();
    expect(io.statusRequest).not.toHaveBeenCalled();
  });

  it("keeps a successful empty list distinct from a read failure", () => {
    io.list.mockReturnValue(success({ items: [], total: 0 }));
    const { html } = render();
    expect(html).toContain("No intake forms yet");
    expect(html).not.toContain("Unable to load intake forms");
    expect(html).not.toContain('role="alert"');
  });

  it.each(["direct", "limited"])("does not queue an offline filter read for reconnect before the %s session result", async outcome => {
    // Model browser retry defaults explicitly: the Node query core defaults to
    // zero retries, which would otherwise hide an omitted list retry override.
    const observed = observeIntake(3);
    let resolveSession!: (value: typeof sessionData) => void;
    const refreshedSession = new Promise<typeof sessionData>(resolve => { resolveSession = resolve; });
    try {
      await vi.waitFor(() => {
        expect(observed.sessionRequest).toHaveBeenCalledTimes(1);
        expect(observed.listRequest).toHaveBeenCalledTimes(1);
        expect(observed.sessionObserver.getCurrentResult().fetchStatus).toBe("idle");
        expect(observed.listObserver.getCurrentResult().fetchStatus).toBe("idle");
        expect(observed.html()).toContain("Existing kitchen");
      });
      onlineManager.setOnline(false);
      observed.listRequest.mockRejectedValue(new Error("private offline transport detail"));
      click("Reviewed");
      observed.rerender();
      // A faulty default query settles into paused here; the corrected query
      // makes one failed attempt and settles into error without a retry queue.
      await vi.waitFor(() => {
        expect(observed.listObserver.getCurrentResult().fetchStatus).not.toBe("fetching");
      });
      observed.rerender();
      const offlineState = observed.listObserver.getCurrentResult();
      const offlineHtml = observed.html();
      const requestsBeforeReconnect = observed.listRequest.mock.calls.length;
      observed.sessionRequest.mockReturnValueOnce(refreshedSession);
      observed.listRequest.mockResolvedValue({ items: [intake], total: 1 });
      onlineManager.setOnline(true);
      await vi.waitFor(() => {
        expect(observed.sessionRequest).toHaveBeenCalledTimes(2);
        expect(observed.html()).toContain("Checking intake access");
      });
      expect(observed.sessionObserver.getCurrentResult().fetchStatus).toBe("fetching");
      expect(observed.listRequest).toHaveBeenCalledTimes(requestsBeforeReconnect);
      expect(requestsBeforeReconnect).toBe(2);
      expect(offlineState.fetchStatus).toBe("idle");
      expect(offlineState.isError).toBe(true);
      expect(offlineHtml).toContain("Unable to load intake forms");
      expect(offlineHtml).not.toContain("private offline transport detail");
      expect(offlineHtml).not.toContain("No intake forms");
      resolveSession({ ...sessionData, estimateReadOnly: outcome === "limited" });
      await vi.waitFor(() => {
        expect(observed.sessionObserver.getCurrentResult().fetchStatus).toBe("idle");
        if (outcome === "direct") {
          expect(observed.listRequest).toHaveBeenCalledTimes(3);
          expect(observed.html()).toContain("Existing kitchen");
          expect(observed.html()).not.toContain("Unable to load intake forms");
          expect(io.list.mock.lastCall![0]).toEqual({ status: "reviewed" });
        } else {
          expect(observed.listRequest).toHaveBeenCalledTimes(2);
          expect(observed.html()).toContain("Limited access");
          expect(observed.html()).not.toContain("Existing kitchen");
        }
      });
    } finally {
      resolveSession(sessionData);
      observed.dispose();
    }
  });
});
