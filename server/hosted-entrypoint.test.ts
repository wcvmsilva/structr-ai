import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureHostedApplication } from "./_core/hosted-app";

const opened: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    opened
      .splice(0)
      .map(
        s =>
          new Promise<void>((resolve, reject) =>
            s.close(e => (e ? reject(e) : resolve()))
          )
      )
  );
  dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true }));
});
async function start(
  options: Parameters<typeof configureHostedApplication>[1]
) {
  const app = express();
  configureHostedApplication(app, options);
  const server = createServer(app);
  opened.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local port");
  return `http://127.0.0.1:${address.port}`;
}
function assets() {
  const dir = mkdtempSync(join(tmpdir(), "structr-hosted-test-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "index.html"),
    "<!doctype html><main>Synthetic SPA</main>"
  );
  return dir;
}

describe("hosted Express entrypoint", () => {
  it.each([undefined, "", "false", "1", "TRUE", " true "])(
    "keeps API closed with switch %s without loading the database application",
    async value => {
      const load = vi.fn();
      const base = await start({
        publicDirectory: assets(),
        env: { STRUCTR_HOSTED_API_ENABLED: value },
        loadApplication: load,
      });
      const response = await fetch(base + "/api/trpc/estimate.exportJSON");
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ error: "Service unavailable" });
      expect(load).not.toHaveBeenCalled();
    }
  );
  it("serves a deep SPA route while the business API is closed", async () => {
    const load = vi.fn();
    const base = await start({
      publicDirectory: assets(),
      env: {},
      loadApplication: load,
    });
    const response = await fetch(base + "/projects/synthetic");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Synthetic SPA");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(load).not.toHaveBeenCalled();
  });
  it("fails visibly when the compiled SPA is missing rather than claiming a usable deployment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "structr-hosted-test-"));
    dirs.push(dir);
    const base = await start({
      publicDirectory: dir,
      env: {},
      loadApplication: vi.fn(),
    });
    expect((await fetch(base + "/")).status).toBe(503);
  });
  it("preserves API path, query, method and JSON body through the mounted application", async () => {
    const inner = express();
    inner.use(express.json());
    inner.post("/api/trpc/synthetic", (req, res) =>
      res.status(201).json({ query: req.query, body: req.body })
    );
    const load = vi.fn(async () => inner);
    const base = await start({
      publicDirectory: assets(),
      env: { STRUCTR_HOSTED_API_ENABLED: "true" },
      loadApplication: load,
    });
    const response = await fetch(base + "/api/trpc/synthetic?batch=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 1025 }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      query: { batch: "1" },
      body: { amount: 1025 },
    });
    await fetch(base + "/api/trpc/other");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("does not turn missing API routes into an HTML success", async () => {
    const base = await start({
      publicDirectory: assets(),
      env: { STRUCTR_HOSTED_API_ENABLED: "true" },
      loadApplication: async () => express(),
    });
    const response = await fetch(base + "/api/unknown");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Synthetic SPA");
  });
  it("reports initialization failures without exposing connection details", async () => {
    const load = vi.fn(async () => {
      throw new Error("postgres://private:DO_NOT_EXPOSE@database");
    });
    const base = await start({
      publicDirectory: assets(),
      env: { STRUCTR_HOSTED_API_ENABLED: "true" },
      loadApplication: load,
    });
    const response = await fetch(base + "/api/trpc/private");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("DO_NOT_EXPOSE");
  });
  it("retains protected application denial instead of replacing it with SPA output", async () => {
    const inner = express();
    inner.use((_req, res) => res.status(401).json({ error: "Unauthorized" }));
    const base = await start({
      publicDirectory: assets(),
      env: { STRUCTR_HOSTED_API_ENABLED: "true" },
      loadApplication: async () => inner,
    });
    const response = await fetch(base + "/api/trpc/project.list");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
  it("sanitizes a synchronous loader failure", async () => {
    const base = await start({
      publicDirectory: assets(),
      env: { STRUCTR_HOSTED_API_ENABLED: "true" },
      loadApplication: () => {
        throw new Error("DO_NOT_EXPOSE");
      },
    });
    const response = await fetch(base + "/api/trpc/private");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service unavailable" });
  });
  it("sanitizes unexpected downstream errors rather than exposing internal details", async () => {
    const inner = express();
    inner.use((_req, _res, next) => next(new Error("DO_NOT_EXPOSE")));
    const base = await start({
      publicDirectory: assets(),
      env: { STRUCTR_HOSTED_API_ENABLED: "true" },
      loadApplication: async () => inner,
    });
    const response = await fetch(base + "/api/trpc/private");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });
  it("does not serve the SPA in response to a non-API mutation", async () => {
    const base = await start({
      publicDirectory: assets(),
      env: {},
      loadApplication: vi.fn(),
    });
    expect(
      (await fetch(base + "/projects/synthetic", { method: "POST" })).status
    ).toBe(404);
  });
});
