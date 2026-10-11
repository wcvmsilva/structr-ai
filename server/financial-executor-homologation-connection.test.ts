import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmod,
  link,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Socket } from "node:net";
import {
  TLSSocket,
  connect as connectTls,
  createServer as createTlsServer,
} from "node:tls";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import {
  EXECUTOR_TEST_CA_PEM,
  EXECUTOR_TEST_CA_SHA256,
} from "./test-support/financial-executor-ca";
import { openCalculatorAdminConnection } from "../scripts/financial-executor-homologation/connection";

const expected = {
  host: "db.syntheticref.supabase.co",
  port: 5432 as const,
  database: "postgres" as const,
  principal: "postgres",
  caSha256: EXECUTOR_TEST_CA_SHA256,
};
const now = Date.parse("2026-10-11T12:00:00Z");
const payload = {
  host: expected.host,
  port: 5432,
  database: "postgres",
  username: "postgres",
  password: "only-new-synthetic-password",
};
const metadata = {
  sessionUser: "postgres",
  currentUser: "postgres",
  database: "postgres",
  serverVersion: "170011",
  tls: true,
};
// Doubles only replace the external database transport. File handling and Drizzle query generation are real.
function transport(rows: unknown[] = [metadata], failure?: unknown) {
  let supplied: any,
    closed = 0;
  const statements: string[] = [];
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: async (query: string) => {
      statements.push(query);
      if (failure) throw failure;
      return rows;
    },
    end: async () => {
      closed++;
    },
  } as unknown as ReturnType<typeof postgres>;
  return {
    createClient: (options: any) => {
      supplied = options;
      (client.options as any).pass = options.password;
      return client;
    },
    get options() {
      return supplied;
    },
    get closed() {
      return closed;
    },
    statements,
  };
}

describe("protected administrative connection candidate", () => {
  let directory: string, secretFile: string, caFile: string;
  beforeEach(async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), "calculator-connection-test-"))
    );
    secretFile = join(directory, "candidate.json");
    caFile = join(directory, "reviewed-public-ca.crt");
    await writeFile(caFile, EXECUTOR_TEST_CA_PEM, { mode: 0o644 });
    await writeFile(secretFile, JSON.stringify(payload), { mode: 0o600 });
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const input = () => ({
    secretFile,
    caFile,
    expected,
    expiresAt: "2026-10-11T13:00:00Z",
    nowMs: () => now,
  });

  it("returns a verified Drizzle handle with caller-owned idempotent cleanup", async () => {
    const t = transport();
    const connection = await openCalculatorAdminConnection(input(), t);
    expect(
      await connection.database.execute(sql`select current_database()`)
    ).toEqual([metadata]);
    await connection.close();
    await connection.close();
    expect(t.closed).toBe(1);
    expect(t.statements[0]).toContain("session_user");
    expect(t.statements[0]).toContain("current_user");
    expect(t.statements[0]).toContain("pg_stat_ssl");
    expect(t.statements.join(" ")).not.toMatch(/set role|set_config/i);
  });
  it("pins chain and hostname verification plus one bounded administrative connection", async () => {
    const t = transport();
    const connection = await openCalculatorAdminConnection(input(), t);
    expect(t.options).toMatchObject({
      host: "db.syntheticref.supabase.co",
      port: 5432,
      database: "postgres",
      username: "postgres",
      ssl: {
        rejectUnauthorized: true,
        servername: "db.syntheticref.supabase.co",
        ca: EXECUTOR_TEST_CA_PEM,
      },
      max: 1,
      connect_timeout: 5,
      idle_timeout: 10,
      max_lifetime: 300,
      prepare: false,
      debug: false,
      fetch_types: false,
    });
    expect(t.options.connection).toEqual({
      application_name: "structr-calculator-homologation-admin-v1",
      statement_timeout: 10000,
      lock_timeout: 3000,
      idle_in_transaction_session_timeout: 10000,
    });
    expect(t.options.password).toBe("only-new-synthetic-password");
    expect(inspect(connection, { depth: 8 })).not.toContain(
      "only-new-synthetic-password"
    );
    expect(JSON.stringify(t.options)).not.toContain(
      "only-new-synthetic-password"
    );
    expect(inspect(t.options)).not.toContain("only-new-synthetic-password");
    await connection.close();
  });
  it.each([0o644, 0o640, 0o660, 0o700])(
    "refuses broad or executable file mode %s before transport",
    async mode => {
      await chmod(secretFile, mode);
      const t = transport();
      await expect(openCalculatorAdminConnection(input(), t)).rejects.toThrow(
        "CALCULATOR_HOMOLOGATION_CONNECTION_REJECTED"
      );
      expect(t.options).toBeUndefined();
    }
  );
  it("refuses a final symlink", async () => {
    const alias = join(directory, "alias");
    await symlink(secretFile, alias);
    const t = transport();
    await expect(
      openCalculatorAdminConnection({ ...input(), secretFile: alias }, t)
    ).rejects.toThrow("CONNECTION_REJECTED");
    expect(t.options).toBeUndefined();
  });
  it("refuses symlinked parent path", async () => {
    const alias = join(directory, "alias");
    await symlink(directory, alias);
    const t = transport();
    await expect(
      openCalculatorAdminConnection(
        { ...input(), secretFile: join(alias, "candidate.json") },
        t
      )
    ).rejects.toThrow("CONNECTION_REJECTED");
    expect(t.options).toBeUndefined();
  });
  it("refuses hardlinked credentials", async () => {
    await link(secretFile, join(directory, "copy"));
    const t = transport();
    await expect(openCalculatorAdminConnection(input(), t)).rejects.toThrow(
      "CONNECTION_REJECTED"
    );
    expect(t.options).toBeUndefined();
  });
  it("refuses relative file paths", async () => {
    const t = transport();
    await expect(
      openCalculatorAdminConnection(
        { ...input(), secretFile: "candidate.json" },
        t
      )
    ).rejects.toThrow("CONNECTION_REJECTED");
    expect(t.options).toBeUndefined();
  });
  it.each([
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({ ...payload, ssl: false }),
    JSON.stringify({ ...payload, password: "" }),
    JSON.stringify({ ...payload, password: "p\nq" }),
    "x".repeat(65537),
  ])(
    "refuses malformed credential bytes without exposing them",
    async bytes => {
      await writeFile(secretFile, bytes);
      const t = transport();
      await expect(openCalculatorAdminConnection(input(), t)).rejects.toThrow(
        /^CALCULATOR_HOMOLOGATION_CONNECTION_REJECTED$/
      );
      expect(t.options).toBeUndefined();
    }
  );
  it.each([
    { host: "db.foreign.supabase.co" },
    { username: "structr_calculator_login_v1" },
    { username: "postgres.syntheticref" },
    { database: "foreign" },
    { port: 6543 },
  ])("refuses credential destination drift %j", async patch => {
    await writeFile(secretFile, JSON.stringify({ ...payload, ...patch }));
    const t = transport();
    await expect(openCalculatorAdminConnection(input(), t)).rejects.toThrow(
      "CONNECTION_REJECTED"
    );
    expect(t.options).toBeUndefined();
  });
  it.each([
    { host: "127.0.0.1" },
    { host: "db.syntheticref.supabase.co,evil.invalid" },
    { principal: "postgres.syntheticref" },
    { port: 6543 },
    { database: "foreign" },
  ])("refuses unsupported independent pins %j", async patch => {
    const t = transport();
    await expect(
      openCalculatorAdminConnection(
        { ...input(), expected: { ...expected, ...patch } } as any,
        t
      )
    ).rejects.toThrow("CONNECTION_REJECTED");
    expect(t.options).toBeUndefined();
  });
  it.each([
    { sessionUser: "other" },
    { currentUser: "other" },
    { database: "other" },
    { tls: false },
    { serverVersion: "170010" },
  ])("closes a connection with failed actual metadata %j", async patch => {
    const t = transport([{ ...metadata, ...patch }]);
    await expect(openCalculatorAdminConnection(input(), t)).rejects.toThrow(
      "CONNECTION_REJECTED"
    );
    expect(t.closed).toBe(1);
  });
  it.each([{ rows: [] }, { rows: [metadata, metadata] }])(
    "requires exactly one metadata row %j",
    async ({ rows }) => {
      const t = transport(rows);
      await expect(openCalculatorAdminConnection(input(), t)).rejects.toThrow(
        "CONNECTION_REJECTED"
      );
      expect(t.closed).toBe(1);
    }
  );
  it("sanitizes TLS/database errors and closes a created client", async () => {
    const t = transport(
      [metadata],
      new Error("private only-new-synthetic-password certificate")
    );
    const error = await openCalculatorAdminConnection(input(), t).catch(
      error => error
    );
    expect(error.message).toBe("CALCULATOR_HOMOLOGATION_CONNECTION_REJECTED");
    expect(inspect(error)).not.toContain("only-new-synthetic-password");
    expect(error.cause).toBeUndefined();
    expect(t.closed).toBe(1);
  });
  it("rejects expired admission before opening", async () => {
    const t = transport();
    await expect(
      openCalculatorAdminConnection(
        { ...input(), expiresAt: "2026-10-11T12:00:00Z" },
        t
      )
    ).rejects.toThrow("CONNECTION_REJECTED");
    expect(t.options).toBeUndefined();
  });
  it("rechecks admission after reading the private file and before opening transport", async () => {
    let n = 0;
    const t = transport();
    await expect(
      openCalculatorAdminConnection(
        { ...input(), nowMs: () => (n++ === 0 ? now : now + 3600000) },
        t
      )
    ).rejects.toThrow("CONNECTION_REJECTED");
    expect(t.options).toBeUndefined();
  });
  it("closes rather than returns a connection that expired during acquisition", async () => {
    let n = 0;
    const t = transport();
    await expect(
      openCalculatorAdminConnection(
        { ...input(), nowMs: () => (n++ < 2 ? now : now + 3600000) },
        t
      )
    ).rejects.toThrow("CONNECTION_REJECTED");
    expect(t.closed).toBe(1);
  });
  it("passes a pinned CA into a successful real local TLS handshake", async () => {
    const keyPath = join(directory, "new-positive-key.pem"),
      certPath = join(directory, "new-positive-cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        `/CN=${expected.host}`,
        "-addext",
        `subjectAltName=DNS:${expected.host}`,
      ],
      { stdio: "ignore" }
    );
    const key = await readFile(keyPath),
      cert = await readFile(certPath, "utf8");
    await writeFile(caFile, cert);
    const caSha256 = createHash("sha256").update(cert).digest("hex");
    const server = createTlsServer({ key, cert }, socket =>
      socket.on("error", () => {})
    );
    const sockets = new Set<import("node:tls").TLSSocket>();
    server.on("secureConnection", socket => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    let authorized = false;
    const t = transport();
    try {
      const connection = await openCalculatorAdminConnection(
        { ...input(), expected: { ...expected, caSha256 } },
        {
          createClient: options => {
            const client = t.createClient(options);
            client.unsafe = (async () => {
              const socket = connectTls({
                host: "127.0.0.1",
                port,
                ...(options.ssl as object),
              });
              await new Promise<void>((resolve, reject) => {
                socket.once("secureConnect", () => {
                  authorized = socket.authorized;
                  socket.end();
                  resolve();
                });
                socket.once("error", reject);
              });
              return [metadata];
            }) as never;
            return client;
          },
        }
      );
      expect(authorized).toBe(true);
      await connection.close();
      expect(t.closed).toBe(1);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("refuses a substituted public CA before opening transport", async () => {
    await writeFile(caFile, "different-public-material");
    const t = transport();
    await expect(openCalculatorAdminConnection(input(), t)).rejects.toThrow(
      "CONNECTION_REJECTED"
    );
    expect(t.options).toBeUndefined();
  });
  it("refuses a missing independent CA pin", async () => {
    const t = transport();
    await expect(
      openCalculatorAdminConnection(
        { ...input(), expected: { ...expected, caSha256: undefined } } as any,
        t
      )
    ).rejects.toThrow("CONNECTION_REJECTED");
    expect(t.options).toBeUndefined();
  });
  it.each(["untrusted chain", "foreign hostname"])(
    "rejects actual local TLS %s before PostgreSQL authentication",
    async failure => {
      const keyPath = join(directory, "new-local-test-key.pem"),
        certPath = join(directory, "new-local-test-cert.pem");
      const name =
        failure === "foreign hostname" ? "foreign.invalid" : expected.host;
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          keyPath,
          "-out",
          certPath,
          "-days",
          "1",
          "-subj",
          `/CN=${name}`,
          "-addext",
          `subjectAltName=DNS:${name}`,
        ],
        { stdio: "ignore" }
      );
      const key = await readFile(keyPath),
        cert = await readFile(certPath),
        sockets = new Set<Socket>();
      const server = createServer(socket => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        socket.once("data", () => {
          socket.write("S");
          const secure = new TLSSocket(socket, { isServer: true, key, cert });
          secure.on("error", () => {});
        });
      });
      await new Promise<void>(resolve =>
        server.listen(0, "127.0.0.1", resolve)
      );
      const port = (server.address() as { port: number }).port;
      let failureCode: string | undefined;
      try {
        await expect(
          openCalculatorAdminConnection(input(), {
            createClient: options => {
              const client = postgres({
                ...options,
                password: options.password,
                host: "127.0.0.1",
                port,
                ssl: {
                  ...(options.ssl as object),
                  ...(failure === "foreign hostname" ? { ca: cert } : {}),
                },
              });
              const unsafe = client.unsafe.bind(client);
              client.unsafe = ((...args: Parameters<typeof unsafe>) => {
                const query = unsafe(...args);
                void query.catch(error => {
                  failureCode = error.code;
                });
                return query;
              }) as typeof client.unsafe;
              return client;
            },
          })
        ).rejects.toThrow(/^CALCULATOR_HOMOLOGATION_CONNECTION_REJECTED$/);
        expect(failureCode).toBe(
          failure === "foreign hostname"
            ? "ERR_TLS_CERT_ALTNAME_INVALID"
            : "DEPTH_ZERO_SELF_SIGNED_CERT"
        );
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }
  );
  it("does not use inherited PG credentials for a missing protected file", async () => {
    const t = transport();
    await rm(secretFile);
    await expect(openCalculatorAdminConnection(input(), t)).rejects.toThrow(
      "CONNECTION_REJECTED"
    );
    expect(t.options).toBeUndefined();
  });
});
