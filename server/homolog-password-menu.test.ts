/** Render the real account menu with the portal primitive opened for SSR. */
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
const mode = vi.hoisted(() => ({ supabase: true }));
vi.mock("../client/src/const", () => ({
  get IS_SUPABASE_AUTH() {
    return mode.supabase;
  },
  getLoginUrl: () => "/login",
}));
vi.mock("../client/src/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    loading: false,
    user: { role: "user", email: null },
    logout: async () => {},
  }),
}));
vi.mock("../client/src/components/ui/dropdown-menu", () => {
  const content = ({ children }: any) =>
    createElement(Fragment, null, children);
  return {
    DropdownMenu: content,
    DropdownMenuContent: content,
    DropdownMenuItem: content,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: content,
  };
});
import DashboardLayout from "../client/src/components/DashboardLayout";
beforeEach(() => {
  mode.supabase = true;
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
function menu() {
  return renderToStaticMarkup(
    createElement(
      Router,
      { ssrPath: "/" },
      createElement(DashboardLayout, {
        children: createElement("p", null, "Existing dashboard"),
      })
    )
  );
}
describe("account menu password access", () => {
  it("offers the current-account password link for Supabase", () => {
    const markup = menu();
    expect(markup).toMatch(/href="\/change-password"/);
    expect(markup).toMatch(/change password/i);
    expect(markup).toMatch(/sign out/i);
  });
  it("keeps password recovery absent in the legacy provider", () => {
    mode.supabase = false;
    const markup = menu();
    expect(markup).not.toContain("/change-password");
    expect(markup).toMatch(/sign out/i);
  });
});
