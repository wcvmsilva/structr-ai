/** Actual singleton + recovery controller; only external Auth/HTTP are controlled. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const io = vi.hoisted(() => ({ client: null as any }));
vi.mock("../client/src/lib/supabase", () => ({
  getSupabaseClient: () => io.client,
  isSupabaseConfigured: () => true,
  SUPABASE_STORAGE_KEY: "structr-supabase-auth",
  SUPABASE_URL: "https://homolog.example.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
}));
let current: Session | null;
let notify: (event: string, session: Session | null) => void;
let storage: Map<string, string>;
const stops: Array<() => void> = [];
function session(id = "operator-A", token = "recovery-A"): Session {
  return {
    access_token: token,
    refresh_token: "synthetic-refresh",
    expires_in: 600,
    expires_at: Math.floor(Date.now() / 1000) + 600,
    token_type: "bearer",
    user: {
      id:
        id === "operator-A"
          ? "11111111-1111-4111-8111-111111111111"
          : "22222222-2222-4222-8222-222222222222",
      email: `${id}@example.test`,
      email_confirmed_at: "2026-10-08T00:00:00Z",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-08T00:00:00Z",
    },
  };
}
function emit(event: string, value: Session | null) {
  current = value;
  notify(event, value);
}
async function start() {
  const auth = await import("../client/src/lib/auth-token");
  const recovery = await import("../client/src/lib/password-recovery-session");
  stops.push(await auth.initSupabaseAuthBridge());
  return { auth, recovery };
}
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_AUTH_PROVIDER", "supabase");
  current = session();
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  vi.stubGlobal("window", {
    location: {
      origin: "https://structr.example.test",
      pathname: "/reset-password",
      search: "?code=synthetic-code",
      hash: "",
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    history: { replaceState: vi.fn() },
  });
  io.client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: current },
        error: null,
      })),
      onAuthStateChange: vi.fn((fn: typeof notify) => {
        notify = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      }),
      signInWithPassword: vi.fn(async () => ({
        data: { session: current, user: current?.user },
        error: null,
      })),
      signOut: vi.fn(async () => {
        emit("SIGNED_OUT", null);
        return { error: null };
      }),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify(session().user), { status: 200 })
    )
  );
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("password callback stays outside the business session", () => {
  it.each(["/reset-password/", "/RESET-PASSWORD"])(
    "quarantines the route variant %s that the router accepts",
    async pathname => {
      window.location.pathname = pathname;
      const { auth } = await start();
      expect(auth.getAuthSessionSnapshot().session).toBeNull();
      expect(await auth.buildAuthHeaders()).toEqual({});
    }
  );
  it("quarantines the persisted recovery session before getSession hydration", async () => {
    const { auth } = await start();
    expect(auth.getAuthSessionSnapshot().session).toBeNull();
    expect(await auth.buildAuthHeaders()).toEqual({});
  });
  it("INITIAL_SESSION cannot grant recovery permission or business access", async () => {
    const { auth, recovery } = await start();
    emit("INITIAL_SESSION", session());
    expect(recovery.getPasswordRecoverySnapshot().active).toBe(false);
    expect(
      await recovery.submitRecoveredPassword(
        "new password 123!",
        "new password 123!"
      )
    ).toMatchObject({ ok: false });
    expect(auth.getAccessToken()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("the provider's verified recovery event arms only the password form after logout", async () => {
    storage.set("structr-supabase-logout-intent", "1");
    const { auth, recovery } = await start();
    emit("PASSWORD_RECOVERY", session());
    expect(recovery.getPasswordRecoverySnapshot()).toMatchObject({
      active: true,
      status: "ready",
    });
    expect(auth.getAuthSessionSnapshot().session).toBeNull();
    expect(await auth.buildAuthHeaders()).toEqual({});
    expect(storage.get("structr-supabase-logout-intent")).toBe("1");
  });
  it("a recovery event also isolates an already authenticated tab on another route", async () => {
    window.location.pathname = "/";
    const { auth, recovery } = await start();
    expect(auth.getAccessToken()).toBe("recovery-A");
    emit("PASSWORD_RECOVERY", session());
    expect(auth.getAccessToken()).toBeNull();
    expect(recovery.getPasswordRecoverySnapshot().status).toBe("ready");
  });
  it("verified recovery dispatches only to Auth using the captured bearer, never a business request", async () => {
    const { auth, recovery } = await start();
    emit("PASSWORD_RECOVERY", session());
    expect(
      await recovery.submitRecoveredPassword(
        "new password 123!",
        "new password 123!"
      )
    ).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://homolog.example.test/auth/v1/user");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer recovery-A"
    );
    expect(init?.body).toBe(JSON.stringify({ password: "new password 123!" }));
    expect(auth.getAuthSessionSnapshot().session).toBeNull();
    expect(recovery.getPasswordRecoverySnapshot().status).toBe("complete");
  });
  it("another identity cancels a pending recovery before any password request", async () => {
    const { auth, recovery } = await start();
    emit("PASSWORD_RECOVERY", session());
    emit("SIGNED_IN", session("operator-B", "normal-B"));
    expect(
      await recovery.submitRecoveredPassword(
        "new password 123!",
        "new password 123!"
      )
    ).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(auth.getAccessToken()).toBeNull();
  });
  it("each verified callback replaces the UI generation even while business identity stays null", async () => {
    const { auth, recovery } = await start();
    emit("PASSWORD_RECOVERY", session());
    const first = auth.getAuthSessionSnapshot().generation;
    const discardUi = vi.fn();
    const stop = auth.subscribeAuthIdentityChange(discardUi);
    emit("PASSWORD_RECOVERY", session("operator-B", "recovery-B"));
    expect(auth.getAuthSessionSnapshot().generation).toBeGreaterThan(first);
    expect(discardUi).toHaveBeenCalledOnce();
    expect(recovery.getPasswordRecoverySnapshot().status).toBe("ready");
    expect(auth.getAuthSessionSnapshot().session).toBeNull();
    stop();
  });
  it("manual local logout immediately invalidates the recovery credential", async () => {
    const { auth, recovery } = await start();
    emit("PASSWORD_RECOVERY", session());
    auth.clearAccessToken();
    expect(recovery.getPasswordRecoverySnapshot().active).toBe(false);
    expect(
      await recovery.submitRecoveredPassword(
        "new password 123!",
        "new password 123!"
      )
    ).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("the same user's provider refresh updates the isolated recovery without opening business access", async () => {
    const { auth, recovery } = await start();
    emit("PASSWORD_RECOVERY", session());
    emit("TOKEN_REFRESHED", session("operator-A", "renewed-recovery"));
    expect(
      await recovery.submitRecoveredPassword(
        "new password 123!",
        "new password 123!"
      )
    ).toMatchObject({ ok: true });
    expect(
      new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get(
        "authorization"
      )
    ).toBe("Bearer renewed-recovery");
    expect(auth.getAccessToken()).toBeNull();
  });
  it("leaving recovery discards the local capture and still requires explicit login", async () => {
    const { auth, recovery } = await start();
    emit("PASSWORD_RECOVERY", session());
    await recovery.exitPasswordRecovery();
    expect(io.client.auth.signOut).not.toHaveBeenCalled();
    expect(recovery.getPasswordRecoverySnapshot().active).toBe(false);
    expect(auth.getAccessToken()).toBeNull();
    emit("INITIAL_SESSION", session());
    expect(auth.getAccessToken()).toBeNull();
  });
  it("leaving an old recovery cannot revoke or erase a newer provider account", async () => {
    const { recovery } = await start();
    emit("PASSWORD_RECOVERY", session());
    emit("SIGNED_IN", session("operator-B", "normal-B"));
    storage.set("structr-supabase-auth", "new-account-session");
    await recovery.exitPasswordRecovery();
    expect(io.client.auth.signOut).not.toHaveBeenCalled();
    expect(storage.get("structr-supabase-auth")).toBe("new-account-session");
    expect(recovery.getPasswordRecoverySnapshot().active).toBe(false);
  });
  it("the request link uses only the current confirmed Auth email, not a profile value", async () => {
    window.location.pathname = "/change-password";
    const { recovery } = await start();
    expect(await recovery.requestOwnPasswordRecovery()).toMatchObject({
      ok: true,
    });
    expect(io.client.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "operator-A@example.test",
      { redirectTo: "https://structr.example.test/reset-password" }
    );
  });
  it("an unconfirmed account cannot request the authenticated change flow", async () => {
    window.location.pathname = "/change-password";
    current!.user.email_confirmed_at = undefined;
    const { recovery } = await start();
    expect(await recovery.requestOwnPasswordRecovery()).toMatchObject({
      ok: false,
    });
    expect(io.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("a change link requested by A cannot be dispatched for B after an async identity switch", async () => {
    window.location.pathname = "/change-password";
    const { recovery } = await start();
    const request = recovery.requestOwnPasswordRecovery();
    emit("SIGNED_IN", session("operator-B", "normal-B"));
    expect(await request).toMatchObject({ ok: false });
    expect(io.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("manual callback URL alone never authorizes a password submission", async () => {
    window.location.search = "?type=recovery";
    const { recovery } = await start();
    expect(
      await recovery.submitRecoveredPassword(
        "new password 123!",
        "new password 123!"
      )
    ).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("a late hydration error cannot erase a newer verified recovery event", async () => {
    let resolve!: (value: any) => void;
    io.client.auth.getSession.mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    const auth = await import("../client/src/lib/auth-token");
    const recovery = await import(
      "../client/src/lib/password-recovery-session"
    );
    const ready = auth.initSupabaseAuthBridge();
    emit("PASSWORD_RECOVERY", session());
    resolve({ data: { session: null }, error: { message: "old read failed" } });
    stops.push(await ready);
    expect(recovery.getPasswordRecoverySnapshot().status).toBe("ready");
    expect(
      await recovery.submitRecoveredPassword(
        "new password 123!",
        "new password 123!"
      )
    ).toMatchObject({ ok: true });
  });
});
