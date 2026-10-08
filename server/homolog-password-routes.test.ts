/** Execute the registered lazy routes through real wouter and React streaming SSR. */
import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  auth: {} as any,
  recovery: { active: false, status: "inactive", message: null } as any,
}));
vi.mock("../client/src/_core/hooks/useAuth", () => ({
  useAuth: () => state.auth,
}));
vi.mock("../client/src/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
}));
vi.mock("../client/src/lib/password-recovery-session", () => ({
  getPasswordRecoverySnapshot: () => state.recovery,
  subscribePasswordRecovery: () => () => {},
  requestPasswordRecovery: vi.fn(),
  requestOwnPasswordRecovery: vi.fn(),
  submitRecoveredPassword: vi.fn(),
  exitPasswordRecovery: vi.fn(),
}));
vi.mock("../client/src/components/DashboardLayout", () => ({
  default: () => {
    throw new Error("Business shell reached by a credential route");
  },
}));
import App from "../client/src/App";

async function renderPath(path: string) {
  return new Promise<string>((resolve, reject) => {
    let output = "";
    const stream = new PassThrough();
    stream.on("data", chunk => {
      output += chunk.toString();
    });
    stream.on("end", () => resolve(output));
    const rendered = renderToPipeableStream(
      createElement(Router, { ssrPath: path }, createElement(App)),
      {
        onAllReady() {
          rendered.pipe(stream);
        },
        onError(error) {
          rendered.abort();
          reject(error);
        },
      }
    );
  });
}
beforeEach(() => {
  state.auth = {
    isAuthenticated: true,
    loading: false,
    user: { id: "profile", email: null },
    refresh: vi.fn(),
    logout: vi.fn(),
  };
  state.recovery = { active: false, status: "inactive", message: null };
});
describe("credential routes remain outside business shell", () => {
  it.each([
    ["/forgot-password", /reset.*link|forgot.*password/i],
    ["/reset-password", /reset.*password|new.*password/i],
    ["/change-password", /change.*password/i],
  ] as const)(
    "renders %s without mounting a business page",
    async (path, expected) => {
      await expect(renderPath(path)).resolves.toMatch(expected);
    }
  );
  it("recovery replaces a dashboard destination before the business shell renders", async () => {
    state.recovery = { active: true, status: "ready", message: null };
    await expect(renderPath("/")).resolves.toMatch(
      /new.*password|reset.*password/i
    );
  });
});
