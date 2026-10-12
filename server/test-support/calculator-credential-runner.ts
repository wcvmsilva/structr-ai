/** Spawn a fresh guarded process; only public paths/owned provenance cross argv. */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
export async function startOwnedCredentialProcess(
  command: unknown,
  owned: { directory: string; nonce: string },
  mode = "physical"
) {
  const scratch = await mkdtemp(
    join(await realpath(tmpdir()), "credential-process-command-")
  );
  const path = scratch + "/command.json";
  await writeFile(path, JSON.stringify(command), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(
        new URL("./calculator-credential-process.ts", import.meta.url)
      ),
      path,
      owned.directory,
      owned.nonce,
      mode,
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { PATH: "/usr/bin:/bin", NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let stdout = "",
    stderr = "",
    pidResolve!: (pid: number) => void;
  const pid = new Promise<number>(resolve => (pidResolve = resolve));
  child.stdout.on("data", chunk => {
    stdout += chunk;
    const ready = stdout
      .split("\n")
      .find(line => line.startsWith('{"readyPid":'));
    if (ready) pidResolve(JSON.parse(ready).readyPid);
  });
  child.stderr.on("data", chunk => {
    stderr += chunk;
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 50000);
  const completed = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>(resolve =>
    child.once("close", async code => {
      clearTimeout(timeout);
      await rm(scratch, { recursive: true, force: true });
      resolve({ code, stdout, stderr });
    })
  );
  return { pid, completed, child };
}
