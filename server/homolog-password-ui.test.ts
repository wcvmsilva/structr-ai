/** Real page elements, React SSR and actual event closures with a controlled hook
 * host. Auth/provider calls are the boundary; this is not a mounted-browser proof. */
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
  inside: false,
  index: 0,
  values: [] as any[],
  effects: [] as Array<() => unknown>,
  auth: {} as any,
  recovery: { active: false, status: "inactive", message: null } as any,
  destinations: [] as string[],
  provider: true,
  request: vi.fn(),
  ownRequest: vi.fn(),
  submit: vi.fn(),
  exit: vi.fn(),
}));
vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!ui.inside) return actual.useState(initial);
      const index = ui.index++;
      if (!(index in ui.values))
        ui.values[index] = typeof initial === "function" ? initial() : initial;
      return [
        ui.values[index],
        (value: unknown) => {
          ui.values[index] =
            typeof value === "function" ? value(ui.values[index]) : value;
        },
      ];
    },
    useRef: (initial: unknown) => {
      if (!ui.inside) return actual.useRef(initial);
      const index = ui.index++;
      return (ui.values[index] ??= { current: initial });
    },
    useEffect: (effect: () => unknown, deps: unknown[]) => {
      if (!ui.inside) return actual.useEffect(effect as any, deps);
      ui.effects.push(effect);
    },
    useSyncExternalStore: (subscribe: any, get: any, server: any) =>
      ui.inside ? get() : actual.useSyncExternalStore(subscribe, get, server),
  };
});
vi.mock("../client/src/const", () => ({
  get IS_SUPABASE_AUTH() {
    return ui.provider;
  },
  getLoginUrl: () => "/login",
}));
vi.mock("../client/src/_core/hooks/useAuth", () => ({
  useAuth: () => ui.auth,
}));
vi.mock("../client/src/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));
vi.mock("../client/src/lib/password-recovery-session", () => ({
  getPasswordRecoverySnapshot: () => ui.recovery,
  subscribePasswordRecovery: () => () => {},
  requestPasswordRecovery: (...args: unknown[]) => ui.request(...args),
  requestOwnPasswordRecovery: (...args: unknown[]) => ui.ownRequest(...args),
  submitRecoveredPassword: (...args: unknown[]) => ui.submit(...args),
  exitPasswordRecovery: (...args: unknown[]) => ui.exit(...args),
}));
vi.mock("wouter", async original => ({
  ...(await original<typeof import("wouter")>()),
  useLocation: () => ["/login", (path: string) => ui.destinations.push(path)],
  Link: ({ href, children, ...props }: any) =>
    createElement("a", { href, ...props }, children),
}));

import LoginPage from "../client/src/pages/Login";
import ForgotPassword from "../client/src/pages/ForgotPassword";
import ResetPassword from "../client/src/pages/ResetPassword";
import ChangePassword from "../client/src/pages/ChangePassword";

function render(Page: () => ReactElement | null) {
  ui.index = 0;
  ui.effects = [];
  ui.inside = true;
  let tree: ReactElement | null;
  try {
    tree = Page();
  } finally {
    ui.inside = false;
  }
  const nodes: ReactElement<any>[] = [];
  const walk = (node: any) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isValidElement(node)) return;
    nodes.push(node as ReactElement<any>);
    walk((node.props as any).children);
  };
  walk(tree);
  const markup = renderToStaticMarkup(tree);
  for (const effect of ui.effects) effect();
  return {
    markup,
    input: (name: string) => nodes.find(node => node.props.name === name),
    form: () => nodes.find(node => node.type === "form"),
    button: (text: RegExp) =>
      nodes.find(
        node => node.props.onClick && text.test(renderToStaticMarkup(node))
      ),
    submit: () => nodes.find(node => node.props.type === "submit"),
  };
}
function enter(Page: () => ReactElement | null, name: string, value: string) {
  const input = render(Page).input(name);
  expect(input, `visible input ${name}`).toBeDefined();
  input!.props.onChange({ target: { value } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const event = { preventDefault() {} };
beforeEach(() => {
  ui.values = [];
  ui.destinations = [];
  ui.provider = true;
  ui.recovery = { active: false, status: "inactive", message: null };
  ui.auth = {
    user: null,
    loading: false,
    hasSession: false,
    isAuthenticated: false,
    authError: null,
    refresh: vi.fn(async () => ({ ok: true })),
    logout: vi.fn(async () => {}),
    signIn: vi.fn(async () => ({ ok: true })),
  };
  ui.request
    .mockReset()
    .mockResolvedValue({
      ok: true,
      message: "If eligible, check your email for a reset link.",
    });
  ui.ownRequest
    .mockReset()
    .mockResolvedValue({
      ok: true,
      message: "If eligible, check your email for a reset link.",
    });
  ui.submit
    .mockReset()
    .mockResolvedValue({
      ok: true,
      message: "Password updated. Sign in with your new password.",
    });
  ui.exit.mockReset().mockResolvedValue(undefined);
});

describe("password UI: login entry and retry", () => {
  it.each([false, true])(
    "offers recovery with hasSession=%s, including unavailable profile",
    hasSession => {
      ui.auth.hasSession = hasSession;
      expect(render(LoginPage).markup).toMatch(/href="\/forgot-password"/);
    }
  );
  it("awaits refresh, reports its failure and leaves sign out available", async () => {
    ui.auth.hasSession = true;
    const renewal = deferred<{ ok: false; message: string }>();
    ui.auth.refresh.mockReturnValue(renewal.promise);
    const retry = render(LoginPage).button(/try again/i)!;
    const pending = retry.props.onClick();
    expect(
      render(LoginPage).button(/try again|checking|retrying/i)?.props.disabled
    ).toBe(true);
    expect(render(LoginPage).button(/sign out/i)?.props.disabled).not.toBe(
      true
    );
    renewal.resolve({
      ok: false,
      message: "Session renewal failed. Please sign in again.",
    });
    await pending;
    expect(render(LoginPage).markup).toContain("Session renewal failed.");
  });
  it("renders a safe error when refresh throws, with sign out still usable", async () => {
    ui.auth.hasSession = true;
    ui.auth.refresh.mockRejectedValue(new Error("PRIVATE_TOKEN"));
    await render(LoginPage)
      .button(/try again/i)!
      .props.onClick();
    const result = render(LoginPage);
    expect(result.markup).toMatch(/unable|cannot/i);
    expect(result.markup).not.toContain("PRIVATE_TOKEN");
    expect(result.button(/sign out/i)).toBeDefined();
  });
  it("routes an active recovery to reset instead of a resolved business profile", () => {
    ui.auth.isAuthenticated = true;
    ui.recovery = { active: true, status: "ready", message: null };
    render(LoginPage);
    expect(ui.destinations).toEqual(["/reset-password"]);
  });
});

describe("password UI: recovery request", () => {
  it("submits the entered email and reports the neutral outcome without claiming delivery", async () => {
    enter(ForgotPassword, "email", "operator@example.test");
    const result = render(ForgotPassword);
    expect(result.form()).toBeDefined();
    await result.form()!.props.onSubmit(event);
    expect(ui.request.mock.calls).toEqual([["operator@example.test"]]);
    expect(render(ForgotPassword).markup).toContain(
      "If eligible, check your email"
    );
    expect(ui.destinations).toEqual([]);
  });
  it("prevents duplicate requests while the first request is unresolved", async () => {
    enter(ForgotPassword, "email", "operator@example.test");
    const pending = deferred<{ ok: boolean; message: string }>();
    ui.request.mockReturnValue(pending.promise);
    const submit = render(ForgotPassword).form()!.props.onSubmit;
    const first = submit(event);
    await submit(event);
    expect(render(ForgotPassword).submit()!.props.disabled).toBe(true);
    expect(ui.request.mock.calls).toHaveLength(1);
    pending.resolve({ ok: true, message: "Check your email." });
    await first;
    expect(render(ForgotPassword).submit()!.props.disabled).toBe(false);
  });
  it("displays the safe request error and allows another attempt", async () => {
    enter(ForgotPassword, "email", "operator@example.test");
    ui.request.mockResolvedValue({
      ok: false,
      message: "Too many attempts. Try again later.",
    });
    await render(ForgotPassword).form()!.props.onSubmit(event);
    expect(render(ForgotPassword).markup).toContain("Too many attempts.");
    expect(render(ForgotPassword).submit()!.props.disabled).toBe(false);
  });
  it("does not expose the credential form for the legacy provider", () => {
    ui.provider = false;
    expect(render(ForgotPassword).input("email")).toBeUndefined();
  });
});

describe("password UI: verified reset", () => {
  it.each(["inactive", "expired", "cancelled", "complete"])(
    "never offers password replacement in %s state",
    status => {
      ui.recovery = {
        active: status === "complete",
        status,
        message: "Recovery state changed.",
      };
      const result = render(ResetPassword);
      expect(result.input("password")).toBeUndefined();
      expect(result.button(/sign in|back to sign in/i)).toBeDefined();
    }
  );
  it.each(["ready", "error"])(
    "sends both password fields only when verified and %s",
    async status => {
      ui.recovery = { active: true, status, message: null };
      enter(ResetPassword, "password", "Synthetic new password 7!");
      enter(ResetPassword, "confirmation", "Synthetic new password 7!");
      await render(ResetPassword).form()!.props.onSubmit(event);
      expect(ui.submit.mock.calls).toEqual([
        ["Synthetic new password 7!", "Synthetic new password 7!"],
      ]);
      expect(render(ResetPassword).input("password")?.props.value).not.toBe(
        "Synthetic new password 7!"
      );
      expect(ui.destinations).toEqual([]);
    }
  );
  it("keeps replacement disabled while the provider is processing it", () => {
    ui.recovery = { active: true, status: "submitting", message: null };
    const submit = render(ResetPassword).submit();
    expect(submit, "visible pending password form").toBeDefined();
    expect(submit!.props.disabled).toBe(true);
  });
  it("shows policy errors and clears secrets when recovery expires", async () => {
    ui.recovery = { active: true, status: "ready", message: null };
    enter(ResetPassword, "password", "short");
    enter(ResetPassword, "confirmation", "short");
    ui.submit.mockResolvedValue({
      ok: false,
      message: "Choose a stronger password.",
    });
    await render(ResetPassword).form()!.props.onSubmit(event);
    expect(render(ResetPassword).markup).toContain(
      "Choose a stronger password."
    );
    ui.recovery = {
      active: false,
      status: "expired",
      message: "Request a new link.",
    };
    expect(render(ResetPassword).input("password")).toBeUndefined();
    ui.recovery = { active: true, status: "ready", message: null };
    expect(render(ResetPassword).input("password")!.props.value).toBe("");
  });
  it("waits for recovery cleanup before returning to explicit login", async () => {
    const ending = deferred<void>();
    ui.exit.mockReturnValue(ending.promise);
    const button = render(ResetPassword).button(/sign in/i)!;
    expect(button).toBeDefined();
    const pending = button.props.onClick();
    expect(ui.destinations).toEqual([]);
    ending.resolve();
    await pending;
    expect(ui.destinations).toEqual(["/login"]);
  });
  it("ends an active expired recovery before navigating to request a new link", async () => {
    ui.recovery = {
      active: true,
      status: "expired",
      message: "Request a new link.",
    };
    const ending = deferred<void>();
    ui.exit.mockReturnValue(ending.promise);
    const button = render(ResetPassword).button(/request a new reset link/i);
    expect(
      button,
      "expired recovery must offer cleanup then another request"
    ).toBeDefined();
    const pending = button!.props.onClick();
    expect(ui.destinations).toEqual([]);
    ending.resolve();
    await pending;
    expect(ui.destinations).toEqual(["/forgot-password"]);
  });
});

describe("password UI: current-account link", () => {
  it("does not expose the authenticated change action while profile access is pending", () => {
    ui.auth.loading = true;
    expect(render(ChangePassword).button(/send.*link/i)).toBeUndefined();
    expect(ui.destinations).toEqual([]);
  });
  it("routes an unavailable profile to login without sending mail", () => {
    render(ChangePassword);
    expect(ui.destinations).toEqual(["/login"]);
    expect(ui.ownRequest).not.toHaveBeenCalled();
  });
  it("requests the verified Auth account without passing nullable profile email", async () => {
    ui.auth.isAuthenticated = true;
    ui.auth.user = { id: "profile", email: null };
    const button = render(ChangePassword).button(/send.*link/i)!;
    expect(button).toBeDefined();
    await button.props.onClick();
    expect(ui.ownRequest.mock.calls).toEqual([[]]);
    expect(render(ChangePassword).markup).toContain(
      "If eligible, check your email"
    );
  });
});
