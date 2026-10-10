import { afterEach, describe, expect, it, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { createFinancialExecutorHttpAdapter } from "../services/financial-executor/src/http";
import { createFinancialExecutorHandler } from "../services/financial-executor/src/handler";
import { signedExecutorAuthFixture } from "./test-support/financial-executor-auth";
import { calculatorIds } from "./test-support/calculator-engine-fixture";

const resources: Duplex[] = [];
afterEach(() => { vi.useRealTimers(); for (const resource of resources.splice(0)) resource.destroy(); });
const command = { contractVersion: "calculator-v1", operation: "calculator.context", projectId: calculatorIds.project, intakeFormId: calculatorIds.intake };
const result = { ...command, clientId: calculatorIds.client, options: [{ assemblyId: calculatorIds.a, name: "Synthetic A", unit: "EA" }] };

async function fixture(clock = () => performance.now()) {
  const auth = await signedExecutorAuthFixture();
  let executions = 0;
  let deadline: number | undefined;
  const handler = createFinancialExecutorHandler({ authenticator: auth.authenticator, monotonicNowMs: clock,
    execute: async (_operator, _command, options) => { executions++; deadline = options.deadline; return result as never; } });
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  resources.push(socket);
  const request = new IncomingMessage(socket as Socket);
  request.method = "POST";
  request.headers = { ...auth.request.headers, "content-type": "application/json" };
  request.rawHeaders = [...auth.request.rawHeaders, "Content-Type", "application/json"];
  request.on("error", () => {});
  const response = new ServerResponse(request);
  response.assignSocket(socket as Socket);
  const adapter = createFinancialExecutorHttpAdapter(handler, { monotonicNowMs: clock });
  return { adapter, request, response, executions: () => executions, deadline: () => deadline,
    received: () => JSON.parse(Buffer.concat(chunks).toString("utf8").split("\r\n\r\n").slice(1).join("\r\n\r\n")),
    finish: (body: string | Buffer) => { request.complete = true; request.push(Buffer.isBuffer(body) ? body : Buffer.from(body)); request.push(null); },
  };
}

describe("financial executor raw Node HTTP reader", () => {
  it("reads real IncomingMessage bytes and sends only the public projection", async () => {
    const f = await fixture();
    const work = f.adapter(f.request, f.response);
    f.finish(JSON.stringify(command));
    await work;
    expect(f.response.statusCode).toBe(200);
    expect(f.response.getHeader("cache-control")).toBe("no-store");
    expect(f.received()).toEqual(result);
    expect(f.executions()).toBe(1);
  });
  it("preserves the budget spent receiving the body", async () => {
    let now = 1000;
    const f = await fixture(() => now);
    const work = f.adapter(f.request, f.response);
    now = 9000;
    f.finish(JSON.stringify(command));
    await work;
    expect(f.response.statusCode).toBe(200);
    expect(f.deadline()).toBe(31000);
  });
  it("refuses a declared body beyond 64 KiB without waiting for bytes", async () => {
    const f = await fixture();
    f.request.headers["content-length"] = "65537";
    await f.adapter(f.request, f.response);
    expect(f.response.statusCode).toBe(413);
    expect(f.executions()).toBe(0);
  });
  it("refuses chunked bytes exceeding 64 KiB before the stream ends", async () => {
    const f = await fixture();
    const work = f.adapter(f.request, f.response);
    f.request.push(Buffer.alloc(65537, 32));
    await work;
    expect(f.response.statusCode).toBe(413);
    expect(f.executions()).toBe(0);
  });
  it("does not write a success when an incomplete IncomingMessage destroys its socket", async () => {
    const f = await fixture();
    const work = f.adapter(f.request, f.response);
    f.request.push(Buffer.from(JSON.stringify(command)));
    f.request.push(null);
    await work;
    expect(f.response.destroyed).toBe(true);
    expect(f.response.writableEnded).toBe(false);
    expect(f.executions()).toBe(0);
  });
  it("rejects an aborted stream before authentication or execution", async () => {
    const f = await fixture();
    const work = f.adapter(f.request, f.response);
    f.request.emit("aborted");
    await work;
    expect(f.response.statusCode).toBe(400);
    expect(f.executions()).toBe(0);
  });
  it("contains the follow-up stream error emitted after a request abort", async () => {
    const f = await fixture();
    f.request.removeAllListeners("error");
    const work = f.adapter(f.request, f.response);
    f.request.emit("aborted");
    await work;
    expect(() => f.request.emit("error", new Error("connection reset after abort"))).not.toThrow();
    expect(f.executions()).toBe(0);
  });
  it("sanitizes stream failures", async () => {
    const f = await fixture();
    const work = f.adapter(f.request, f.response);
    f.request.emit("error", new Error("private incoming stream detail"));
    await work;
    expect(f.response.statusCode).toBe(400);
    expect(f.received()).toEqual({ error: { code: "FINANCIAL_EXECUTOR_INPUT_INVALID" } });
    expect(f.executions()).toBe(0);
  });
  it("uses fatal UTF-8 decoding instead of replacing malformed bytes", async () => {
    const f = await fixture();
    const work = f.adapter(f.request, f.response);
    f.finish(Buffer.concat([Buffer.from('{"operation":"'), Buffer.from([0xc0, 0xaf]), Buffer.from('"}')]));
    await work;
    expect(f.response.statusCode).toBe(400);
    expect(f.executions()).toBe(0);
  });
  it("refuses a body helper that already consumed the original byte stream", async () => {
    const f = await fixture();
    (f.request as IncomingMessage & { body: unknown }).body = command;
    await f.adapter(f.request, f.response);
    expect(f.response.statusCode).toBe(400);
    expect(f.executions()).toBe(0);
  });
  it("times out a never-completed body within the original 30-second budget", async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const work = f.adapter(f.request, f.response);
    await vi.advanceTimersByTimeAsync(30000);
    await work;
    expect(f.response.statusCode).toBe(503);
    expect(f.received()).toEqual({ error: { code: "FINANCIAL_EXECUTOR_DEADLINE" } });
    expect(f.executions()).toBe(0);
  });
});
