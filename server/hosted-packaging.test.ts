import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repository = fileURLToPath(new URL("../", import.meta.url));
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "structr-hosted-packaging-"));
  prepareFixture(root);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function prepareFixture(root: string) {
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(
    join(root, "public/index.html"),
    "<!doctype html><main>Synthetic deployed SPA</main>"
  );
  symlinkSync(
    join(repository, "node_modules"),
    join(root, "node_modules"),
    "dir"
  );
  copyFileSync(join(repository, "server.js"), join(root, "server.js"));
  const built = spawnSync(
    process.execPath,
    [
      join(repository, "scripts/build-vercel-server.mjs"),
      join(root, "dist/hosted.js"),
    ],
    {
      cwd: root,
      env: { NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 15_000,
    }
  );
  expect(built.status, built.stderr || built.error?.message).toBe(0);
}

function requestInProduction(
  paths: string[],
  environment: Record<string, string> = {}
) {
  const script = `
    import { createServer } from 'node:http';
    import { Socket } from 'node:net';
    let port;
    let outboundConnections = 0;
    const connect = Socket.prototype.connect;
    Socket.prototype.connect = function (...args) {
      const options = Array.isArray(args[0]) ? args[0][0] : args[0];
      if (!options || options.host !== '127.0.0.1' || Number(options.port) !== port) {
        outboundConnections++;
        throw new Error('Unexpected outbound connection in packaging test');
      }
      return connect.apply(this, args);
    };
    const { default: app } = await import('./server.js');
    const server = createServer(app);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    port = server.address().port;
    try {
      const results = [];
      for (const path of ${JSON.stringify(paths)}) {
        const response = await fetch('http://127.0.0.1:' + server.address().port + path);
        results.push({ status: response.status, body: await response.text(),
          cacheControl: response.headers.get('cache-control'),
          frameOptions: response.headers.get('x-frame-options') });
      }
      console.log(JSON.stringify({ results, outboundConnections }));
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: root,
      // Deliberately do not inherit NODE_OPTIONS, credentials or the Vitest environment.
      env: { NODE_ENV: "production", ...environment },
      encoding: "utf8",
      timeout: 15_000,
    }
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  const output = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
  expect(output.outboundConnections).toBe(0);
  return output.results as Array<{
    status: number;
    body: string;
    cacheControl: string | null;
    frameOptions: string | null;
  }>;
}

describe("native ESM hosted packaging", () => {
  it("serves root and deep SPA routes through the native entrypoint without backend credentials", () => {
    const responses = requestInProduction(["/", "/projects/synthetic"]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.body).toContain("Synthetic deployed SPA");
      expect(response.frameOptions).toBe("DENY");
    }
  });

  it("keeps the business API closed in the real production artifact", () => {
    const [response] = requestInProduction(["/api/trpc/project.list"]);
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ error: "Service unavailable" });
    expect(response.cacheControl).toContain("no-store");
  });

  it("fails closed only for API requests when enabled without backend configuration", () => {
    const [api, page] = requestInProduction(
      ["/api/trpc/project.list", "/projects/synthetic"],
      {
        STRUCTR_HOSTED_API_ENABLED: "true",
      }
    );
    expect(api.status).toBe(503);
    expect(JSON.parse(api.body)).toEqual({ error: "Service unavailable" });
    expect(api.cacheControl).toContain("no-store");
    expect(page.status).toBe(200);
    expect(page.body).toContain("Synthetic deployed SPA");
  });

  it("loads the bundled business application and denies an unauthenticated request before database access", () => {
    const input = encodeURIComponent(
      JSON.stringify({ json: { id: "00000000-0000-4000-8000-000000000001" } })
    );
    const [response] = requestInProduction(
      [`/api/trpc/project.getById?input=${input}`],
      {
        STRUCTR_HOSTED_API_ENABLED: "true",
        TENANT_STRICT: "true",
        AUTH_PROVIDER: "supabase",
        JWT_SECRET: "synthetic-packaging-secret-with-at-least-32-characters",
        DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1:1/packaging",
        SUPABASE_URL: "https://synthetic.invalid",
        OAUTH_SERVER_URL: "https://synthetic.invalid",
      }
    );
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body).error.json.data.code).toBe("UNAUTHORIZED");
  });
});
