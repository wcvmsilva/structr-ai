/** Real form handlers and SSR output; only the Auth facade is controlled.
 * This does not substitute for browser or hosted password-change acceptance. */
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
  inside: false,
  index: 0,
  values: [] as any[],
  effects: [] as Array<() => unknown>,
  auth: {} as any,
  provider: true,
  change: vi.fn(),
  destinations: [] as string[],
  unmounted: false,
  lateStateWrites: 0,
  cleanups: new Map<number, () => void>(),
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
          if (ui.unmounted) ui.lateStateWrites += 1;
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
      const index = ui.index++;
      const previous = ui.values[index] as unknown[] | undefined;
      if (
        previous &&
        previous.length === deps.length &&
        previous.every((value, at) => Object.is(value, deps[at]))
      )
        return;
      ui.values[index] = deps;
      ui.effects.push(() => {
        ui.cleanups.get(index)?.();
        const cleanup = effect();
        if (typeof cleanup === "function")
          ui.cleanups.set(index, cleanup as () => void);
        else ui.cleanups.delete(index);
      });
    },
  };
});
vi.mock("../client/src/const", () => ({
  get IS_SUPABASE_AUTH() {
    return ui.provider;
  },
}));
vi.mock("../client/src/_core/hooks/useAuth", () => ({
  useAuth: () => ui.auth,
}));
vi.mock("../client/src/lib/password-change-session", () => ({
  changeCurrentPassword: (...args: unknown[]) => ui.change(...args),
}));
vi.mock("wouter", async original => ({
  ...(await original<typeof import("wouter")>()),
  useLocation: () => [
    "/settings",
    (path: string) => ui.destinations.push(path),
  ],
}));
import ChangePasswordForm from "../client/src/components/ChangePasswordForm";
import SettingsPage from "../client/src/pages/Settings";
import ChangePassword from "../client/src/pages/ChangePassword";

function renderForm() {
  ui.index = 0;
  ui.effects = [];
  ui.inside = true;
  let tree: ReactElement | null;
  try {
    tree = ChangePasswordForm();
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
    form: nodes.find(node => node.type === "form"),
    input: (name: string) => nodes.find(node => node.props.name === name),
    submit: nodes.find(node => node.props.type === "submit"),
  };
}
function fill(
  currentPassword = "Current password 1!",
  newPassword = "New password 2!",
  confirmation = newPassword
) {
  for (const [name, value] of Object.entries({
    currentPassword,
    newPassword,
    confirmation,
  })) {
    const input = renderForm().input(name);
    expect(input, `accessible ${name} field`).toBeDefined();
    input!.props.onChange({ target: { value } });
  }
}
function page(Component: () => ReactElement) {
  return renderToStaticMarkup(
    createElement(Router, { ssrPath: "/settings" }, createElement(Component))
  );
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
  ui.effects = [];
  ui.destinations = [];
  ui.provider = true;
  ui.unmounted = false;
  ui.lateStateWrites = 0;
  ui.cleanups.clear();
  ui.auth = {
    isAuthenticated: true,
    loading: false,
    user: { id: "operator-profile", email: null },
  };
  ui.change
    .mockReset()
    .mockResolvedValue({ ok: true, message: "Password updated." });
});

describe("Settings current-password form", () => {
  it.each([
    ["Settings", SettingsPage],
    ["existing change-password route", ChangePassword],
  ] as const)(
    "renders all three credential inputs in %s",
    (_name, Component) => {
      const markup = page(Component);
      expect(markup).toMatch(/Current password/);
      expect(markup).toMatch(/New password/);
      expect(markup).toMatch(/Confirm new password/);
      expect(markup).toContain('autoComplete="current-password"');
      expect(markup.match(/autoComplete="new-password"/g)).toHaveLength(2);
      expect(markup.match(/type="password"/g)).toHaveLength(3);
    }
  );
  it.each(["legacy", "pending", "unauthenticated"])(
    "does not expose a password mutation in %s state",
    state => {
      if (state === "legacy") ui.provider = false;
      if (state === "pending") ui.auth.loading = true;
      if (state === "unauthenticated") {
        ui.auth.isAuthenticated = false;
        ui.auth.user = null;
      }
      expect(renderForm().form).toBeUndefined();
      expect(page(SettingsPage)).not.toContain('name="currentPassword"');
    }
  );
  it.each([
    ["", "New password 2!", "New password 2!", /current password/i],
    ["Current password 1!", "", "", /8|eight/i],
    ["Current password 1!", "1234567", "1234567", /8|eight/i],
    ["Current password 1!", "New password 2!", "different", /match/i],
    [
      "Current password 1!",
      "Current password 1!",
      "Current password 1!",
      /different|same/i,
    ],
  ] as const)(
    "rejects invalid fields before sending credentials (%s/%s)",
    async (current, next, confirmation, message) => {
      fill(current, next, confirmation);
      await renderForm().form!.props.onSubmit(event);
      expect(renderForm().markup).toMatch(message);
      expect(ui.change).not.toHaveBeenCalled();
      expect(renderForm().submit!.props.disabled).toBe(false);
    }
  );
  it("accepts the eight-character boundary and forwards the exact three fields", async () => {
    fill(" current password ", "12345678");
    await renderForm().form!.props.onSubmit(event);
    expect(ui.change.mock.calls).toEqual([
      [" current password ", "12345678", "12345678"],
    ]);
    expect(ui.destinations).toEqual([]);
  });
  it("locks every field and rejects duplicate submits until the result settles", async () => {
    fill();
    const pending = deferred<{ ok: boolean; message: string }>();
    ui.change.mockReturnValue(pending.promise);
    const submit = renderForm().form!.props.onSubmit;
    const first = submit(event);
    await submit(event);
    const busy = renderForm();
    expect(busy.submit!.props.disabled).toBe(true);
    for (const name of ["currentPassword", "newPassword", "confirmation"])
      expect(busy.input(name)!.props.disabled).toBe(true);
    expect(ui.change.mock.calls).toHaveLength(1);
    pending.resolve({
      ok: false,
      message: "Unable to change password. Try again.",
    });
    await first;
    expect(renderForm().submit!.props.disabled).toBe(false);
  });
  it("shows the safe provider failure and permits correction without navigation", async () => {
    fill();
    ui.change.mockResolvedValue({
      ok: false,
      message:
        "Unable to change password. Check your current password and try again.",
    });
    await renderForm().form!.props.onSubmit(event);
    expect(renderForm().markup).toContain("Check your current password");
    expect(renderForm().submit!.props.disabled).toBe(false);
    expect(ui.destinations).toEqual([]);
  });
  it("sanitizes unexpected failures and leaves the form usable", async () => {
    fill();
    ui.change.mockRejectedValue(new Error("PRIVATE_PASSWORD_TOKEN"));
    await renderForm().form!.props.onSubmit(event);
    const result = renderForm();
    expect(result.markup).toMatch(/unable|cannot/i);
    expect(result.markup).not.toContain("PRIVATE_PASSWORD_TOKEN");
    expect(result.submit!.props.disabled).toBe(false);
  });
  it("clears all credentials on success and confirms the result without navigation", async () => {
    fill();
    await renderForm().form!.props.onSubmit(event);
    const result = renderForm();
    for (const name of ["currentPassword", "newPassword", "confirmation"])
      expect(result.input(name)!.props.value).toBe("");
    expect(result.markup).toContain("Password updated.");
    expect(ui.destinations).toEqual([]);
  });
  it("discards entered fields when profile access disappears", () => {
    fill();
    ui.auth.isAuthenticated = false;
    ui.auth.user = null;
    expect(renderForm().form).toBeUndefined();
    ui.auth.isAuthenticated = true;
    ui.auth.user = { id: "operator-profile", email: null };
    const result = renderForm();
    for (const name of ["currentPassword", "newPassword", "confirmation"])
      expect(result.input(name)!.props.value).toBe("");
  });
  it("never renders A's entered credentials when B becomes authorized without an intervening logout", () => {
    fill();
    ui.auth.user = { id: "profile-B", email: null };
    const firstB = renderForm();
    for (const name of ["currentPassword", "newPassword", "confirmation"])
      expect(firstB.input(name)?.props.value ?? "").toBe("");
    const readyB = renderForm();
    for (const name of ["currentPassword", "newPassword", "confirmation"])
      expect(readyB.input(name)!.props.value).toBe("");
  });
  it("ignores A's late result and finally while B's own change is pending", async () => {
    fill();
    const a = deferred<{ ok: boolean; message: string }>();
    const b = deferred<{ ok: boolean; message: string }>();
    ui.change.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const pendingA = renderForm().form!.props.onSubmit(event);
    ui.auth.user = { id: "profile-B", email: null };
    renderForm();
    fill("Current password B!", "New password for B!");
    const pendingB = renderForm().form!.props.onSubmit(event);
    expect(ui.change.mock.calls).toHaveLength(2);
    a.resolve({ ok: true, message: "Account A password changed." });
    await pendingA;
    const duringB = renderForm();
    expect(duringB.markup).not.toContain("Account A password changed.");
    expect(duringB.input("newPassword")!.props.value).toBe(
      "New password for B!"
    );
    expect(duringB.submit!.props.disabled).toBe(true);
    b.resolve({ ok: true, message: "Password updated." });
    await pendingB;
    expect(renderForm().input("newPassword")!.props.value).toBe("");
  });
  it("does not write feedback or pending state after the form unmounts", async () => {
    fill();
    const request = deferred<{ ok: boolean; message: string }>();
    ui.change.mockReturnValue(request.promise);
    const pending = renderForm().form!.props.onSubmit(event);
    ui.unmounted = true;
    for (const cleanup of ui.cleanups.values()) cleanup();
    request.resolve({ ok: true, message: "Password updated." });
    await pending;
    expect(ui.lateStateWrites).toBe(0);
  });
  it("bounds current and replacement credential fields to the controller's limits", () => {
    const form = renderForm();
    expect(form.input("currentPassword")?.props.maxLength).toBe(1024);
    expect(form.input("newPassword")?.props.maxLength).toBe(128);
    expect(form.input("confirmation")?.props.maxLength).toBe(128);
  });
});
