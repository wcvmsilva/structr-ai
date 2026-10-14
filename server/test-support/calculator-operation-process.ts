/** Trusted test transport only: production command cannot select these modes. */
import { appendFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCalculatorOperationProcess } from "../../scripts/financial-executor-homologation/operation-runner";
const [commandFile, events, mode, directory, nonce] = process.argv.slice(2);
const record = (value: unknown) =>
  appendFile(events, JSON.stringify(value) + "\n", { mode: 0o600 });
const error = () =>
  Object.assign(
    new Error("SENTINEL_PASSWORD SCRAM-SHA-256$SENTINEL_VERIFIER"),
    { query: "SENTINEL_SQL", params: ["SENTINEL_PARAMS"] }
  );
await runCalculatorOperationProcess(commandFile, {
  openConnection: async input => {
    await record({
      phase: "connection",
      expiresAt: input.expiresAt,
      expected: input.expected,
    });
    if (mode === "ordinary") throw error();
    if (mode === "async") {
      setImmediate(() => {
        throw error();
      });
      return await new Promise<never>(() => {});
    }
    if (mode === "signal") {
      setImmediate(() => process.kill(process.pid, "SIGTERM"));
      return await new Promise<never>(() => {});
    }
    if (mode === "resolve-after-signal") {
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((...args: any[]) => {
        setTimeout(() => (write as any)(...args), 100);
        return true;
      }) as typeof process.stdout.write;
      process.emit("SIGTERM", "SIGTERM");
      return {
        database: {
          transaction: async () => {
            await record({ phase: "unexpected-transaction" });
            throw error();
          },
        } as any,
        close: async () => {
          await record({ phase: "close" });
        },
      };
    }
    if (mode === "transaction" || mode === "close")
      return {
        database: {
          transaction: async () => {
            await record({ phase: "transaction" });
            throw error();
          },
        } as any,
        close: async () => {
          await record({ phase: "close" });
          if (mode === "close") throw error();
        },
      };
    if (
      !directory?.startsWith(
        join(await realpath(tmpdir()), "structr-app-principal-pg-")
      ) ||
      !nonce ||
      input.expected.principal !== "postgres"
    )
      throw new Error();
    if (mode === "owned-admission") {
      await record({ phase: "owned-admission" });
      throw new Error();
    }
    const [{ default: postgres }, { drizzle }] = await Promise.all([
      import("postgres"),
      import("drizzle-orm/postgres-js"),
    ]);
    const client = postgres({
      host: join(directory, "socket"),
      port: 55443,
      database: "postgres",
      user: "postgres",
      password: "owned-synthetic-unused-trust",
      ssl: false,
      prepare: false,
      fetch_types: false,
      max: 1,
      connect_timeout: 2,
      debug: false,
      onnotice: () => undefined,
    });
    const [identity] =
      await client`SELECT current_setting('app_principal_lab.nonce') AS nonce,current_setting('server_version_num') AS version,current_user AS role,session_user AS session,inet_server_addr() AS address`;
    if (
      identity.nonce !== nonce ||
      identity.version !== "170011" ||
      identity.role !== "postgres" ||
      identity.session !== "postgres" ||
      identity.address !== null
    ) {
      await client.end({ timeout: 1 });
      throw new Error();
    }
    return {
      database: drizzle(client, { logger: false }),
      close: async () => {
        await client.end({ timeout: 1 });
        await record({ phase: "close" });
      },
    };
  },
});
