/** Native credential update controller; only the external HTTP boundary is controlled. */
import { describe, expect, it, vi } from "vitest";
import {
  createPasswordChanger,
  type PasswordChangeContext,
} from "../client/src/lib/password-change";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clock = 1_800_000_000_000,
  current = " Synthetic current password ",
  next = " Synthetic new password! ";
const user = (id = A) => ({
  id,
  aud: "authenticated",
  created_at: "2026-10-08T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
});
const response = (id = A) =>
  new Response(JSON.stringify(user(id)), { status: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(config: Record<string, unknown> = {}) {
  let context: PasswordChangeContext | null = {
    userId: A,
    token: "captured.account.token",
    expiresAt: clock + 600_000,
    generation: 3,
    action: 5,
  };
  let now = clock;
  const getContext = vi.fn(() => context);
  const fetcher = vi.fn<typeof fetch>(async () => response());
  const changer = createPasswordChanger({
    supabaseUrl: "https://project.supabase.co",
    publishableKey: "sb_publishable_fixture",
    getContext,
    fetch: fetcher,
    now: () => now,
    ...config,
  });
  return {
    changer,
    fetcher,
    getContext,
    context: () => context,
    setContext: (value: PasswordChangeContext | null) => {
      context = value;
    },
    time: (value: number) => {
      now = value;
    },
  };
}

describe("native current-password change", () => {
  it("sends both password fields once with the captured bearer and leaves the context unchanged", async () => {
    const f = fixture(),
      before = { ...f.context() };
    expect(await f.changer.change(current, next, next)).toEqual({
      ok: true,
      message: "Password updated.",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls[0][0]).toBe(
      "https://project.supabase.co/auth/v1/user"
    );
    expect(f.fetcher.mock.calls[0][1]).toMatchObject({
      method: "PUT",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: "Bearer captured.account.token",
        apikey: "sb_publishable_fixture",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: next, current_password: current }),
    });
    expect(f.context()).toEqual(before);
  });
  it.each([
    ["", next, next],
    ["x".repeat(1025), next, next],
    [current, "short", "short"],
    [current, "x".repeat(129), "x".repeat(129)],
    [current, "        ", "        "],
    [current, next, "mismatch"],
    [current, current, current],
  ])(
    "rejects invalid old/new/confirmation values before HTTP",
    async (old, newPassword, confirmation) => {
      const f = fixture();
      expect((await f.changer.change(old, newPassword, confirmation)).ok).toBe(
        false
      );
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  );
  it("preserves even whitespace bytes in the current password", async () => {
    const f = fixture();
    expect((await f.changer.change(" ", next, next)).ok).toBe(true);
    expect(f.fetcher.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ password: next, current_password: " " })
    );
  });
  it.each([
    null,
    { userId: A, token: "token", expiresAt: clock, generation: 3, action: 5 },
    {
      userId: A,
      token: "bad\ntoken",
      expiresAt: clock + 1000,
      generation: 3,
      action: 5,
    },
    {
      userId: "malformed",
      token: "token",
      expiresAt: clock + 1000,
      generation: 3,
      action: 5,
    },
    {
      userId: A,
      token: "token",
      expiresAt: Infinity,
      generation: 3,
      action: 5,
    },
  ])(
    "rejects missing, expired or malformed context without HTTP",
    async context => {
      const f = fixture();
      f.setContext(context);
      expect((await f.changer.change(current, next, next)).ok).toBe(false);
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  );
  it.each([
    { supabaseUrl: "http://project.supabase.co" },
    { supabaseUrl: "https://user:password@project.supabase.co" },
    { supabaseUrl: "https://project.supabase.co/other?redirect=evil" },
    { publishableKey: "service_role_forbidden" },
  ])("rejects invalid API configuration %j before dispatch", async config => {
    const f = fixture(config);
    expect((await f.changer.change(current, next, next)).ok).toBe(false);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each(["userId", "generation", "action"] as const)(
    "rechecks %s immediately before dispatch",
    async field => {
      const f = fixture(),
        first = f.context()!,
        second = { ...first, [field]: field === "userId" ? B : 99 };
      f.getContext.mockReturnValueOnce(first).mockReturnValue(second);
      expect((await f.changer.change(current, next, next)).ok).toBe(false);
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  );
  it.each(["userId", "generation", "action"] as const)(
    "rejects a late result after %s changes",
    async field => {
      const f = fixture(),
        pending = deferred<Response>();
      f.fetcher.mockReturnValueOnce(pending.promise);
      const change = f.changer.change(current, next, next);
      f.setContext({ ...f.context()!, [field]: field === "userId" ? B : 99 });
      pending.resolve(response());
      expect((await change).ok).toBe(false);
    }
  );
  it("rejects logout during JSON decoding", async () => {
    const f = fixture(),
      body = deferred<unknown>();
    f.fetcher.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => body.promise,
    } as Response);
    const change = f.changer.change(current, next, next);
    await Promise.resolve();
    f.setContext(null);
    body.resolve(user());
    expect((await change).ok).toBe(false);
  });
  it("keeps the original credential if the context object is mutated by token refresh", async () => {
    const f = fixture(),
      pending = deferred<Response>();
    f.fetcher.mockReturnValueOnce(pending.promise);
    const change = f.changer.change(current, next, next);
    f.context()!.token = "new.refresh.token";
    pending.resolve(response());
    expect((await change).ok).toBe(true);
    expect(f.fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer captured.account.token",
    });
  });
  it("rejects duplicate pending requests", async () => {
    const f = fixture(),
      pending = deferred<Response>();
    f.fetcher.mockReturnValueOnce(pending.promise);
    const first = f.changer.change(current, next, next);
    expect((await f.changer.change(current, next, next)).ok).toBe(false);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    pending.resolve(response());
    expect((await first).ok).toBe(true);
  });
  it("cancel aborts only the current attempt; its late response cannot affect a new account attempt", async () => {
    const f = fixture(),
      firstResponse = deferred<Response>(),
      secondResponse = deferred<Response>();
    f.fetcher
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise);
    const first = f.changer.change(current, next, next);
    const signal = f.fetcher.mock.calls[0][1]?.signal;
    f.changer.cancel();
    expect(signal?.aborted).toBe(true);
    f.setContext({
      ...f.context()!,
      userId: B,
      token: "second.account.token",
      generation: 4,
    });
    const second = f.changer.change(current, next, next);
    firstResponse.resolve(response());
    expect((await first).ok).toBe(false);
    expect((await f.changer.change(current, next, next)).ok).toBe(false);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    secondResponse.resolve(response(B));
    expect((await second).ok).toBe(true);
  });
  it.each([{}, { id: A }, user(B), null, "unexpected"])(
    "HTTP200 with malformed/wrong user %j is not success",
    async body => {
      const f = fixture();
      f.fetcher.mockResolvedValue(
        new Response(JSON.stringify(body), { status: 200 })
      );
      expect((await f.changer.change(current, next, next)).ok).toBe(false);
    }
  );
  it("sanitizes malformed JSON and permits a later retry", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(
      new Response("INVALID_SECRET_BODY", { status: 200 })
    );
    const result = await f.changer.change(current, next, next);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("SECRET");
    expect((await f.changer.change(current, next, next)).ok).toBe(true);
  });
  it("sanitizes network errors without clearing the caller's session", async () => {
    const f = fixture(),
      before = { ...f.context() };
    f.fetcher.mockRejectedValueOnce(
      new Error(`${current} ${next} PRIVATE_TOKEN`)
    );
    expect(await f.changer.change(current, next, next)).toEqual({
      ok: false,
      message: "Unable to update your password. Try again shortly.",
    });
    expect(f.context()).toEqual(before);
    expect((await f.changer.change(current, next, next)).ok).toBe(true);
  });
  it("times out a stalled HTTP operation after15seconds", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.fetcher.mockImplementationOnce(
        async (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("PRIVATE_TIMEOUT")),
              { once: true }
            );
          })
      );
      const change = f.changer.change(current, next, next);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await change).toEqual({
        ok: false,
        message: "Unable to update your password. Try again shortly.",
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("maps provider password policy codes without echoing the response body", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValue(
      new Response(JSON.stringify({ code: "weak_password", message: next }), {
        status: 422,
      })
    );
    expect(await f.changer.change(current, next, next)).toEqual({
      ok: false,
      message:
        "Use a stronger password that meets your account's password policy.",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["current_password_invalid", 400, "Your current password is incorrect."],
    ["current_password_required", 400, "Enter your current password."],
    [
      "same_password",
      422,
      "Choose a new password different from your current password.",
    ],
    [
      "reauthentication_needed",
      400,
      "Sign in again before changing your password.",
    ],
    [
      "reauthentication_not_valid",
      422,
      "Sign in again before changing your password.",
    ],
    [
      "insufficient_aal",
      401,
      "Complete the required sign-in verification before changing your password.",
    ],
  ])(
    "maps native %s without retrying or dropping current_password",
    async (code, status, message) => {
      const f = fixture();
      f.fetcher.mockResolvedValue(
        new Response(
          JSON.stringify({ code, message: `${current} PRIVATE_DETAIL` }),
          { status: Number(status) }
        )
      );
      expect(await f.changer.change(current, next, next)).toEqual({
        ok: false,
        message,
      });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.fetcher.mock.calls[0][1]?.body).toBe(
        JSON.stringify({ password: next, current_password: current })
      );
    }
  );
});
