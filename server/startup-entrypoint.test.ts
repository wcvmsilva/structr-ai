import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
// The real server module may be imported, but this fixture must never bind a
// listener or contact a database, OAuth server, or other network endpoint.
const noNetwork = `
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
net.Socket.prototype.connect = function () { throw new Error('Unexpected network connection in startup fixture'); };
net.Server.prototype.listen = function () { throw new Error('Unexpected listener in startup fixture'); };
syncBuiltinESMExports();
`;

describe("real server entrypoint startup refusal", () => {
  it("exits nonzero for unsafe production tenant mode without opening a listener or exposing secrets", () => {
    const child = spawnSync(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(noNetwork)}`,
      "--import", "tsx", "server/_core/index.ts",
    ], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: "/dev/null",
        TENANT_STRICT: "false",
        AUTH_PROVIDER: "supabase",
        SUPABASE_URL: "https://synthetic.example.invalid",
        OAUTH_SERVER_URL: "https://synthetic.example.invalid",
        DATABASE_URL: "postgres://fixture:PRIVATE_STARTUP_SENTINEL@127.0.0.1:1/synthetic",
        JWT_SECRET: "SYNTHETIC_STARTUP_JWT_SENTINEL_LONG_ENOUGH",
      },
    });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.stderr).toContain("TENANT_STRICT=true is required in production");
    expect(child.stderr + child.stdout).not.toContain("Unexpected network");
    expect(child.stderr + child.stdout).not.toContain("Unexpected listener");
    expect(child.stderr + child.stdout).not.toContain("PRIVATE_STARTUP_SENTINEL");
    expect(child.stderr + child.stdout).not.toContain("SYNTHETIC_STARTUP_JWT_SENTINEL");
    expect(child.stdout).not.toContain("Server running");
    expect(child.status).toBe(1);
  }, 20_000);
});
