/** Child bootstrap for the exact production one-shot entry function. The CLI
 * production entry has no way to select this owned socket transport seam. */
import { runCalculatorCredentialProcess } from "../../scripts/financial-executor-homologation/credential-runner";
import { join } from "node:path";
const [commandFile, directory, nonce, mode] = process.argv.slice(2);
await runCalculatorCredentialProcess(commandFile, {
  openConnection: async input => {
    if (mode === "admission") {
      process.stdout.write(
        JSON.stringify({ connectionAdmission: input.expiresAt }) + "\n"
      );
      throw new Error("OWNED_ADMISSION_OBSERVED");
    }
    if (mode === "ordinary")
      throw Object.assign(
        new Error("synthetic-password SCRAM-SHA-256$synthetic-verifier"),
        {
          query: "synthetic-password",
          params: ["synthetic-verifier"],
          cause: new Error("synthetic-password"),
        }
      );
    if (mode === "async") {
      setImmediate(() => {
        throw Object.assign(
          new Error("synthetic-password SCRAM-SHA-256$synthetic-verifier"),
          { query: "synthetic-password", params: ["synthetic-verifier"] }
        );
      });
      return await new Promise<never>(() => {});
    }
    if (
      !directory?.startsWith("/private/tmp/structr-app-principal-pg-") ||
      !nonce ||
      input.expected.principal !== "postgres"
    )
      throw new Error();
    if (
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.now()
    )
      throw new Error();
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
      max: 1,
      connect_timeout: 2,
      debug: false,
      onnotice: () => undefined,
    });
    const [identity] =
      await client`SELECT pg_backend_pid() AS pid,current_setting('app_principal_lab.nonce') AS nonce,current_setting('server_version_num') AS version,current_user AS role,session_user AS session,inet_server_addr() AS address`;
    if (
      identity.nonce !== nonce ||
      identity.version !== "170011" ||
      identity.role !== "postgres" ||
      identity.session !== "postgres" ||
      identity.address !== null
    )
      throw new Error();
    process.stdout.write(JSON.stringify({ readyPid: identity.pid }) + "\n");
    return {
      database: drizzle(client, { logger: false }),
      close: () => client.end({ timeout: 1 }),
    };
  },
});
