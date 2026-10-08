/** Credential-controller behavior with only the external Auth/HTTP boundary controlled.
 * These tests do not claim hosted delivery, provider login or business authorization. */
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { createPasswordRecoveryController } from "../client/src/lib/password-recovery";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clock = 1_800_000_000_000;
const password = "Synthetic new password 7!";
function session(
  id = A,
  token = "captured.recovery.token",
  expires = clock / 1000 + 600
): Session {
  return {
    access_token: token,
    refresh_token: "private-refresh",
    token_type: "bearer",
    expires_in: 600,
    expires_at: expires,
    user: {
      id,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-08T00:00:00Z",
    },
  };
}
function response(id = A) {
  return new Response(JSON.stringify(session(id).user), { status: 200 });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(overrides: Record<string, unknown> = {}) {
  let identity: { userId: string | null; generation: number } = {
    userId: A,
    generation: 1,
  };
  let now = clock;
  const reset = vi.fn(
    async (_email: string, _options: { redirectTo: string }) => ({
      data: {},
      error: null as any,
    })
  );
  const fetcher = vi.fn<typeof fetch>(async () => response());
  const controller = createPasswordRecoveryController({
    auth: { resetPasswordForEmail: reset },
    origin: "https://preview.example.invalid",
    supabaseUrl: "https://project.supabase.co",
    publishableKey: "sb_publishable_synthetic",
    getIdentity: () => identity,
    fetch: fetcher,
    now: () => now,
    ...overrides,
  });
  return {
    controller,
    reset,
    fetcher,
    identity: (value: typeof identity) => {
      identity = value;
    },
    time: (value: number) => {
      now = value;
    },
    recover: (value = session()) =>
      controller.handleAuthEvent("PASSWORD_RECOVERY", value),
  };
}

describe("password recovery link request", () => {
  it("uses the SDK PKCE reset API with only the fixed same-origin reset route", async () => {
    const f = fixture();
    const result = await f.controller.requestLink(" person@example.com ");
    expect(result).toEqual({
      ok: true,
      message:
        "If this account can receive password reset emails, a link will arrive shortly.",
    });
    expect(f.reset.mock.calls).toEqual([
      [
        "person@example.com",
        { redirectTo: "https://preview.example.invalid/reset-password" },
      ],
    ]);
    expect(f.controller.getSnapshot().active).toBe(false);
  });
  it.each([
    "",
    "not-an-email",
    "a@",
    "a\n@example.com",
    `${"x".repeat(255)}@example.com`,
  ])("rejects malformed email %j before contacting Auth", async email => {
    const f = fixture();
    expect(await f.controller.requestLink(email)).toEqual({
      ok: false,
      message: "Enter a valid email address.",
    });
    expect(f.reset).not.toHaveBeenCalled();
  });
  it.each(["user_not_found", "email_not_found"])(
    "does not disclose provider account existence for %s",
    async code => {
      const f = fixture();
      f.reset.mockResolvedValue({
        data: {},
        error: { code, status: 400, message: "PRIVATE_ACCOUNT_DETAIL" },
      });
      expect(await f.controller.requestLink("missing@example.com")).toEqual({
        ok: true,
        message:
          "If this account can receive password reset emails, a link will arrive shortly.",
      });
    }
  );
  it("sanitizes provider errors and does not claim delivery on service failure", async () => {
    const f = fixture();
    f.reset.mockResolvedValue({
      data: {},
      error: { status: 500, message: "PRIVATE_PROVIDER_DETAIL" },
    });
    const result = await f.controller.requestLink("person@example.com");
    expect(result.ok).toBe(false);
    expect(result.message).toBe(
      "Unable to request a reset link. Try again shortly."
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  });
  it("sanitizes rejected SDK requests", async () => {
    const f = fixture();
    f.reset.mockRejectedValue(new Error("PRIVATE_TOKEN_PASSWORD"));
    expect(await f.controller.requestLink("person@example.com")).toEqual({
      ok: false,
      message: "Unable to request a reset link. Try again shortly.",
    });
  });
  it.each([
    {
      origin: "https://preview.example.invalid/path?next=https://evil.invalid",
    },
    { origin: "javascript:alert(1)" },
    { origin: "https://user:password@preview.example.invalid" },
    { supabaseUrl: "https://project.supabase.co/?redirect=evil" },
    { supabaseUrl: "http://project.supabase.co" },
    { publishableKey: "service_role_do_not_send" },
  ])(
    "fails closed for invalid API/origin configuration %j",
    async configuration => {
      const f = fixture(configuration);
      expect((await f.controller.requestLink("person@example.com")).ok).toBe(
        false
      );
      f.recover();
      expect((await f.controller.submitPassword(password, password)).ok).toBe(
        false
      );
      expect(f.reset).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  );
});

describe("confirmed recovery and captured credential binding", () => {
  it.each(["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED"] as const)(
    "%s alone never authorizes password replacement",
    async event => {
      const f = fixture();
      f.controller.handleAuthEvent(event, session());
      expect(f.controller.getSnapshot().active).toBe(false);
      expect((await f.controller.submitPassword(password, password)).ok).toBe(
        false
      );
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  );
  it("requires a confirmed SDK PASSWORD_RECOVERY session and exposes no credentials", () => {
    const f = fixture();
    f.recover();
    expect(f.controller.getSnapshot()).toEqual({
      active: true,
      status: "ready",
      message: null,
    });
    expect(JSON.stringify(f.controller.getSnapshot())).not.toMatch(
      /captured|private-refresh|access_token|password/
    );
  });
  it("binds PUT /auth/v1/user to the captured recovery token and validates its user response", async () => {
    const f = fixture();
    f.recover();
    const result = await f.controller.submitPassword(password, password);
    expect(result).toEqual({
      ok: true,
      message: "Password updated. Sign in with your new password.",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = f.fetcher.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/auth/v1/user");
    expect(request).toMatchObject({
      method: "PUT",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: "Bearer captured.recovery.token",
        apikey: "sb_publishable_synthetic",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    expect(f.controller.getSnapshot()).toEqual({
      active: true,
      status: "complete",
      message: result.message,
    });
    expect(JSON.stringify(f.controller.getSnapshot())).not.toContain(password);
  });
  it.each([
    ["short", "short"],
    ["x".repeat(129), "x".repeat(129)],
    [password, "different"],
    ["        ", "        "],
  ])(
    "validates password and confirmation before dispatch",
    async (p, confirm) => {
      const f = fixture();
      f.recover();
      expect((await f.controller.submitPassword(p, confirm)).ok).toBe(false);
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  );
  it("does not trim a valid password", async () => {
    const f = fixture();
    f.recover();
    const p = "  password with spaces  ";
    await f.controller.submitPassword(p, p);
    expect(f.fetcher.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ password: p })
    );
  });
  it("rejects a recovery token that is already expired", async () => {
    const f = fixture();
    f.recover(session(A, undefined, clock / 1000));
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.controller.getSnapshot().status).toBe("expired");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rechecks captured expiry immediately before submission", async () => {
    const f = fixture();
    f.recover();
    f.time(clock + 601_000);
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.controller.getSnapshot().status).toBe("expired");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rejects missing recovery expiration", async () => {
    const f = fixture();
    const value = session();
    delete value.expires_at;
    f.recover(value);
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each([null, B])(
    "logout or identity change to %s before dispatch cancels the captured credential",
    async userId => {
      const f = fixture();
      f.recover();
      f.identity({ userId, generation: 2 });
      expect((await f.controller.submitPassword(password, password)).ok).toBe(
        false
      );
      expect(f.fetcher).not.toHaveBeenCalled();
      expect(f.controller.getSnapshot().active).toBe(false);
    }
  );
  it("a newer generation for the same account invalidates recovery", async () => {
    const f = fixture();
    f.recover();
    f.identity({ userId: A, generation: 2 });
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("SIGNED_IN for a different token cancels recovery even for the same account", async () => {
    const f = fixture();
    f.recover();
    f.controller.handleAuthEvent(
      "SIGNED_IN",
      session(A, "different.session.token")
    );
    expect(f.controller.getSnapshot().active).toBe(false);
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
  });
  it("SIGNED_IN on returning focus preserves the same verified recovery session", async () => {
    const f = fixture();
    f.recover();
    f.controller.handleAuthEvent("SIGNED_IN", session());
    expect(f.controller.getSnapshot()).toEqual({
      active: true,
      status: "ready",
      message: null,
    });
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      true
    );
    expect(f.fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer captured.recovery.token",
    });
  });
  it("same-session SIGNED_IN during a request preserves its immutable credential and result", async () => {
    const f = fixture(),
      pending = deferred<Response>();
    f.fetcher.mockReturnValueOnce(pending.promise);
    f.recover();
    const submitted = f.controller.submitPassword(password, password);
    f.controller.handleAuthEvent("SIGNED_IN", session());
    expect(f.fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
    expect(f.controller.getSnapshot().status).toBe("submitting");
    pending.resolve(response());
    expect((await submitted).ok).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("SIGNED_IN with the same token but a newer identity epoch cancels recovery", async () => {
    const f = fixture();
    f.recover();
    f.identity({ userId: A, generation: 2 });
    f.controller.handleAuthEvent("SIGNED_IN", session());
    expect(f.controller.getSnapshot().active).toBe(false);
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("same-identity passive SIGNED_IN preserves the completed result without retaining a usable credential", async () => {
    const f = fixture();
    f.recover();
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      true
    );
    f.controller.handleAuthEvent("SIGNED_IN", session());
    expect(f.controller.getSnapshot()).toMatchObject({
      active: true,
      status: "complete",
    });
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([A, B])(
    "a changed identity epoch after completion cancels the old result for %s",
    async userId => {
      const f = fixture();
      f.recover();
      expect((await f.controller.submitPassword(password, password)).ok).toBe(
        true
      );
      f.identity({ userId, generation: 2 });
      f.controller.handleAuthEvent("SIGNED_IN", session(userId));
      expect(f.controller.getSnapshot()).toMatchObject({
        active: false,
        status: "cancelled",
      });
      expect((await f.controller.submitPassword(password, password)).ok).toBe(
        false
      );
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    }
  );
  it("renews only from a verified same-identity TOKEN_REFRESHED event", async () => {
    const f = fixture();
    f.recover();
    f.controller.handleAuthEvent(
      "TOKEN_REFRESHED",
      session(A, "renewed.recovery.token")
    );
    await f.controller.submitPassword(password, password);
    expect(f.fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer renewed.recovery.token",
    });
  });
  it("cancellation during subscriber notification prevents dispatch", async () => {
    const f = fixture();
    f.recover();
    f.controller.subscribe(() => {
      if (f.controller.getSnapshot().status === "submitting")
        f.controller.cancel();
    });
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot()).toMatchObject({
      active: false,
      status: "cancelled",
    });
  });
  it("expiry during subscriber notification prevents dispatch", async () => {
    const f = fixture();
    f.recover();
    f.controller.subscribe(() => {
      if (f.controller.getSnapshot().status === "submitting")
        f.time(clock + 601_000);
    });
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().status).toBe("expired");
  });
  it("refresh during an in-flight request cannot replace its captured bearer", async () => {
    const f = fixture(),
      pending = deferred<Response>();
    f.fetcher.mockReturnValueOnce(pending.promise);
    f.recover();
    const submitted = f.controller.submitPassword(password, password);
    f.controller.handleAuthEvent(
      "TOKEN_REFRESHED",
      session(A, "refreshed.during.request")
    );
    pending.resolve(response());
    expect((await submitted).ok).toBe(true);
    expect(f.fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer captured.recovery.token",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled Auth request and returns a sanitized retryable error", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.fetcher.mockImplementationOnce(
        async (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("PRIVATE_TIMEOUT_DETAIL")),
              { once: true }
            );
          })
      );
      f.recover();
      const submitted = f.controller.submitPassword(password, password);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await submitted).toEqual({
        ok: false,
        message: "Unable to update your password. Try again shortly.",
      });
      expect(f.controller.getSnapshot().status).toBe("error");
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancel aborts an in-flight request and a late success cannot restore recovery", async () => {
    const f = fixture(),
      pending = deferred<Response>();
    f.fetcher.mockReturnValue(pending.promise);
    f.recover();
    const submitted = f.controller.submitPassword(password, password);
    const signal = f.fetcher.mock.calls[0][1]?.signal;
    f.controller.cancel();
    expect(signal?.aborted).toBe(true);
    pending.resolve(response());
    expect((await submitted).ok).toBe(false);
    expect(f.controller.getSnapshot()).toMatchObject({
      active: false,
      status: "cancelled",
    });
  });
  it("a late A response cannot change a newly captured B recovery session", async () => {
    const f = fixture(),
      pending = deferred<Response>();
    f.fetcher.mockReturnValueOnce(pending.promise);
    f.recover();
    const submitted = f.controller.submitPassword(password, password);
    f.identity({ userId: B, generation: 2 });
    f.recover(session(B, "new.account.token"));
    pending.resolve(response());
    expect((await submitted).ok).toBe(false);
    expect(f.controller.getSnapshot()).toEqual({
      active: true,
      status: "ready",
      message: null,
    });
    f.fetcher.mockResolvedValueOnce(response(B));
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      true
    );
    expect(f.fetcher.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: "Bearer new.account.token",
    });
  });
  it("rechecks identity after response JSON decoding, not just after fetch resolves", async () => {
    const f = fixture(),
      body = deferred<unknown>();
    f.fetcher.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => body.promise,
    } as Response);
    f.recover();
    const submitted = f.controller.submitPassword(password, password);
    await Promise.resolve();
    f.identity({ userId: B, generation: 2 });
    body.resolve(session().user);
    expect((await submitted).ok).toBe(false);
    expect(f.controller.getSnapshot().active).toBe(false);
  });
  it("duplicate submit does not dispatch another credential update", async () => {
    const f = fixture(),
      pending = deferred<Response>();
    f.fetcher.mockReturnValue(pending.promise);
    f.recover();
    const first = f.controller.submitPassword(password, password);
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      false
    );
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    pending.resolve(response());
    expect((await first).ok).toBe(true);
  });
  it.each([
    {},
    { id: A },
    { user: { id: A } },
    null,
    "invalid",
    session(B).user,
  ])(
    "does not treat HTTP 200 with wrong user/shape %j as success",
    async body => {
      const f = fixture();
      f.fetcher.mockResolvedValue(
        new Response(JSON.stringify(body), { status: 200 })
      );
      f.recover();
      expect((await f.controller.submitPassword(password, password)).ok).toBe(
        false
      );
      expect(f.controller.getSnapshot().status).toBe("error");
    }
  );
  it.each([401, 403])(
    "maps HTTP %s to an expired link without reflecting server details",
    async status => {
      const f = fixture();
      f.fetcher.mockResolvedValue(
        new Response(
          JSON.stringify({ message: password, token: "PRIVATE_TOKEN" }),
          { status }
        )
      );
      f.recover();
      const result = await f.controller.submitPassword(password, password);
      expect(result.ok).toBe(false);
      expect(f.controller.getSnapshot().status).toBe("expired");
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_TOKEN|Synthetic/);
    }
  );
  it("uses a fixed readable provider-policy error instead of echoing its message", async () => {
    const f = fixture();
    f.fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({ code: "weak_password", message: password }),
        { status: 422 }
      )
    );
    f.recover();
    expect(await f.controller.submitPassword(password, password)).toEqual({
      ok: false,
      message:
        "Use a stronger password that meets your account's password policy.",
    });
  });
  it("network failures never expose secrets and permit a valid retry", async () => {
    const f = fixture();
    f.fetcher.mockRejectedValueOnce(new Error(`${password} PRIVATE_TOKEN`));
    f.recover();
    const result = await f.controller.submitPassword(password, password);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_TOKEN|Synthetic/);
    expect((await f.controller.submitPassword(password, password)).ok).toBe(
      true
    );
  });
});
