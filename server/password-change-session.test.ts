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
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
function bearer(
  label = "operator-A",
  methods: unknown = [{ method: "password", timestamp: 1791489600 }]
) {
  return [
    "eyJhbGciOiJIUzI1NiJ9",
    Buffer.from(JSON.stringify({ sub: A, label, amr: methods })).toString(
      "base64url"
    ),
    "synthetic-signature",
  ].join(".");
}
function session(id = A, token = bearer()): Session {
  return {
    access_token: token,
    refresh_token: "synthetic-refresh",
    expires_in: 600,
    expires_at: Math.floor(Date.now() / 1000) + 600,
    token_type: "bearer",
    user: {
      id,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-08T00:00:00Z",
    },
  };
}
let current: Session | null,
  notify: (event: string, value: Session | null) => void;
const stops: Array<() => void> = [];
function emit(event: string, value: Session | null) {
  current = value;
  notify(event, value);
}
async function start() {
  const auth = await import("../client/src/lib/auth-token");
  const facade = await import("../client/src/lib/password-change-session");
  stops.push(await auth.initSupabaseAuthBridge());
  return { auth, facade };
}
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_AUTH_PROVIDER", "supabase");
  current = session();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("window", {
    location: { origin: "https://structr.example.test", pathname: "/settings" },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  io.client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: current },
        error: null,
      })),
      onAuthStateChange: vi.fn((listener: typeof notify) => {
        notify = listener;
        return { data: { subscription: { unsubscribe() {} } } };
      }),
      signInWithPassword: vi.fn(async () => ({
        data: { session: current, user: current?.user },
        error: null,
      })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authenticated Settings password change", () => {
  it.each(["otp", "magiclink", "recovery"])(
    "rejects a persisted %s session even without a recovery event",
    async method => {
      current = session(
        A,
        bearer("exempt", [{ method: "password" }, { method }])
      );
      const { facade } = await start();
      expect(
        await facade.changeCurrentPassword(
          "current password",
          "new password 123",
          "new password 123"
        )
      ).toMatchObject({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([null, [], [{ method: "totp" }], [{ method: 12 }], "password"])(
    "fails closed for missing or malformed password AMR %j",
    async amr => {
      current = session(A, bearer("malformed", amr));
      const { facade } = await start();
      expect(
        await facade.changeCurrentPassword(
          "current password",
          "new password 123",
          "new password 123"
        )
      ).toMatchObject({ ok: false });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it("accepts password plus second-factor AMR without weakening provider checks", async () => {
    current = session(
      A,
      bearer("mfa", [
        { method: "password", timestamp: 1791489600 },
        { method: "totp", timestamp: 1791489600 },
      ])
    );
    const { facade } = await start();
    expect(
      await facade.changeCurrentPassword(
        "current password",
        "new password 123",
        "new password 123"
      )
    ).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("sends both password fields to Auth with the captured operator and preserves the business session", async () => {
    const { auth, facade } = await start();
    const original = auth.getAuthSessionSnapshot();
    expect(
      await facade.changeCurrentPassword(
        "current password",
        "new password 123",
        "new password 123"
      )
    ).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://homolog.example.test/auth/v1/user");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${bearer()}`
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      current_password: "current password",
      password: "new password 123",
    });
    expect(auth.getAuthSessionSnapshot()).toBe(original);
    expect(io.client.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(io.client.auth.signOut).not.toHaveBeenCalled();
  });
  it("refuses a locally signed-out operator even when the provider still has its session", async () => {
    const { auth, facade } = await start();
    auth.clearAccessToken();
    expect(
      await facade.changeCurrentPassword(
        "current password",
        "new password 123",
        "new password 123"
      )
    ).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cannot use an email-recovery credential for the current-password form", async () => {
    const { auth, facade } = await start();
    emit("PASSWORD_RECOVERY", session());
    expect(
      await facade.changeCurrentPassword(
        "current password",
        "new password 123",
        "new password 123"
      )
    ).toMatchObject({ ok: false });
    expect(auth.getAccessToken()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("expires stale credentials before dispatch instead of writing unauthenticated", async () => {
    current!.expires_at = Math.floor(Date.now() / 1000) - 1;
    const { facade } = await start();
    expect(
      await facade.changeCurrentPassword(
        "current password",
        "new password 123",
        "new password 123"
      )
    ).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not carry a successful response for A into the replacement operator B", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const { auth, facade } = await start();
    const pending = facade.changeCurrentPassword(
      "current password",
      "new password 123",
      "new password 123"
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    emit("SIGNED_IN", session(B, bearer("operator-B")));
    resolve(new Response(JSON.stringify(session().user), { status: 200 }));
    expect(await pending).toMatchObject({ ok: false });
    expect(auth.getAccessToken()).toBe(bearer("operator-B"));
    expect(io.client.auth.signOut).not.toHaveBeenCalled();
  });
  it("manual logout aborts the pending request and prevents a late success", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const { auth, facade } = await start();
    const pending = facade.changeCurrentPassword(
      "current password",
      "new password 123",
      "new password 123"
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    auth.clearAccessToken();
    expect(signal?.aborted).toBe(true);
    resolve(new Response(JSON.stringify(session().user), { status: 200 }));
    expect(await pending).toMatchObject({ ok: false });
  });
  it("a same-account explicit login invalidates an older in-flight password intent", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const { auth, facade } = await start();
    const pending = facade.changeCurrentPassword(
      "current password",
      "new password 123",
      "new password 123"
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await auth.signInSupabaseSession(
      "operator@example.test",
      "synthetic-login"
    );
    resolve(new Response(JSON.stringify(session().user), { status: 200 }));
    expect(await pending).toMatchObject({ ok: false });
  });
  it("automatic renewal of the same operator does not replace the credential already dispatched", async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const { auth, facade } = await start();
    const pending = facade.changeCurrentPassword(
      "current password",
      "new password 123",
      "new password 123"
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    emit("TOKEN_REFRESHED", session(A, bearer("renewed-A")));
    resolve(new Response(JSON.stringify(session().user), { status: 200 }));
    expect(await pending).toMatchObject({ ok: true });
    expect(
      new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get(
        "Authorization"
      )
    ).toBe(`Bearer ${bearer()}`);
    expect(auth.getAccessToken()).toBe(bearer("renewed-A"));
  });
});
