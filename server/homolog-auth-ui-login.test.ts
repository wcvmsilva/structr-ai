/** Real Login render/effects and real composed hook under an SSR provider.
 * No claim of a mounted-browser acceptance run. Auth/route boundaries are controlled. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { Router } from "wouter";

const login = vi.hoisted(() => ({
  auth: {} as any,
  effects: [] as Array<() => unknown>,
  destinations: [] as string[],
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => {
    login.effects.push(effect);
  },
}));
vi.mock("../client/src/_core/hooks/useAuth", () => ({
  useAuth: () => login.auth,
}));
vi.mock("../client/src/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));
vi.mock("wouter", async original => ({
  ...(await original<typeof import("wouter")>()),
  useLocation: () => [
    "/login",
    (value: string) => login.destinations.push(value),
  ],
}));

import LoginPage from "../client/src/pages/Login";

function render() {
  login.effects = [];
  const markup = renderToStaticMarkup(
    createElement(Router, { ssrPath: "/login" }, createElement(LoginPage))
  );
  for (const effect of login.effects) effect();
  return markup;
}

beforeEach(() => {
  login.destinations = [];
  login.auth = {
    signIn: async () => ({ ok: true }),
    hasSession: true,
    isAuthenticated: false,
    user: null,
    loading: false,
    authError: null,
    error: null,
    refresh: async () => ({}),
    logout: async () => {},
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("homolog UI: login waits for the protected Structr profile", () => {
  it("does not leave login while the authenticated profile is pending", () => {
    login.auth.loading = true;
    const markup = render();
    expect(login.destinations).toEqual([]);
    expect(markup).toMatch(/checking.*access/i);
  });

  it.each([null, new Error("profile unavailable")])(
    "offers retry and sign out when Auth is valid but the profile is unavailable (%s)",
    error => {
      login.auth.error = error;
      const markup = render();
      expect(login.destinations).toEqual([]);
      expect(markup).toMatch(/try again/i);
      expect(markup).toMatch(/sign out/i);
      expect(markup).not.toMatch(/name="password"/);
    }
  );

  it("returns to the existing requested route only after the profile resolves", () => {
    vi.stubGlobal("window", {
      location: { search: "?redirect=%2Festimates%2Fexisting-draft" },
    });
    login.auth.user = { id: "A1-profile" };
    login.auth.isAuthenticated = true;
    render();
    expect(login.destinations).toEqual(["/estimates/existing-draft"]);
  });

  it.each(["https://foreign.example", "//foreign.example"])(
    "rejects an external redirect target %s",
    target => {
      vi.stubGlobal("window", {
        location: { search: `?redirect=${encodeURIComponent(target)}` },
      });
      login.auth.user = { id: "A1-profile" };
      login.auth.isAuthenticated = true;
      render();
      expect(login.destinations).toEqual(["/"]);
    }
  );

  it("continues to offer credentials when there is no browser session", () => {
    login.auth.hasSession = false;
    const markup = render();
    expect(markup).toContain('name="password"');
    expect(login.destinations).toEqual([]);
  });

  it("successful password authentication alone does not navigate before profile resolution", async () => {
    // Execute the real submit closure, as existing client-effect tests do. There
    // is no DOM renderer dependency in this repository, and SSR does not submit forms.
    const source = readFileSync(
      new URL("../client/src/pages/Login.tsx", import.meta.url),
      "utf8"
    );
    const sf = ts.createSourceFile(
      "Login.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let submit!: ts.FunctionDeclaration;
    const walk = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "handleSubmit")
        submit = node;
      ts.forEachChild(node, walk);
    };
    walk(sf);
    const js = ts.transpileModule(`const actual = (${submit.getText(sf)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const scope = {
      email: "operator@example.test",
      password: "synthetic password",
      hasSession: false,
      signIn: login.auth.signIn,
      setFormError: () => {},
      setSubmitting: () => {},
      setLocation: (value: string) => login.destinations.push(value),
      readRedirectTarget: () => "/",
    };
    const handler = new Function(
      ...Object.keys(scope),
      `${js}\nreturn actual;`
    )(...Object.values(scope));
    await handler({ preventDefault() {} });
    expect(login.destinations).toEqual([]);
  });
});
