/** Supervised, opt-in local laboratory. Never connects to an existing database. */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLabEnvironment, validateSelection, type OwnedLab } from "../../server/test-support/ed-pilot-lab";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runFile = promisify(execFile);
const bin = "/usr/local/opt/postgresql@17/bin";
const pgEnv = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" };
const args = process.argv.slice(2);
if (args.some(arg => !/^--(mode=(verify|preview)|minutes=\d+|selection-sha256=[a-f0-9]{64})$/.test(arg))) throw new Error("Supported flags: --mode=verify|preview --minutes=1..15 --selection-sha256=<sha256>");
const mode = args.includes("--mode=preview") ? "preview" : "verify";
const minutes = Number(args.find(arg => arg.startsWith("--minutes="))?.split("=")[1] ?? "10");
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 15) throw new Error("Preview lifetime must be 1..15 minutes");
const expectedHash = args.find(arg => arg.startsWith("--selection-sha256="))?.split("=")[1];
if (!expectedHash) throw new Error("Pass the reviewed selection SHA-256 explicitly");
const selectionFile = join(root, "scripts/ed-pilot-lab/selection.synthetic.json");
const selectionBytes = await readFile(selectionFile);
if (createHash("sha256").update(selectionBytes).digest("hex") !== expectedHash) throw new Error("Selection bytes changed since review");
validateSelection(JSON.parse(selectionBytes.toString("utf8")));

const directory = await mkdtemp("/private/tmp/ed-pilot-");
await chmod(directory, 0o700);
const owned: OwnedLab = { directory, dataDirectory: join(directory, "data"), socketDirectory: join(directory, "sock"), database: "postgres", user: "ed_pilot_lab", port: 5432 };
const evidence = join(root, "tmp/ed-pilot/p2", directory.split("/").at(-1)!);
await mkdir(evidence, { mode: 0o700, recursive: true });
await mkdir(owned.socketDirectory, { mode: 0o700 });
const steps: Array<Record<string, unknown>> = [];
let child: ChildProcess | undefined;
let childExited: Promise<number> | undefined;
let cleanupPromise: Promise<void> | undefined;
let interrupted = false;
let forceTimer: ReturnType<typeof setTimeout> | undefined;
function stopChild() {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  forceTimer ??= setTimeout(() => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 10_000);
}
const exists = async (path: string) => access(path).then(() => true, () => false);
async function command(name: string, argv: string[], timeout = 25_000) {
  const startedAt = new Date().toISOString();
  let output = "";
  let exitCode = 0;
  try {
    const result = await runFile(join(bin, name), argv, { env: pgEnv, timeout, maxBuffer: 1_048_576 });
    output = result.stdout + result.stderr;
  } catch (error) {
    exitCode = 1;
    output = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const file = `${name}-${steps.length}.log`;
    await writeFile(join(evidence, file), output, { mode: 0o600 });
    steps.push({ executable: join(bin, name), argv, startedAt, finishedAt: new Date().toISOString(), exitCode, log: file });
  }
}
function cleanup(): Promise<void> {
  return cleanupPromise ??= (async () => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      stopChild();
      // A spawn error is already a failed run; it must not prevent PG cleanup.
      await childExited?.catch(() => undefined);
    }
    const pidFile = join(owned.dataDirectory, "postmaster.pid");
    if (await exists(pidFile)) {
      const [pid, data] = (await readFile(pidFile, "utf8")).split("\n");
      if (!/^\d+$/.test(pid) || data !== owned.dataDirectory) throw new Error("Refusing to stop unverified PostgreSQL owner");
      try { await command("pg_ctl", ["-D", owned.dataDirectory, "-w", "-t", "15", "-m", "fast", "stop"]); }
      catch (error) {
        if (!await exists(pidFile)) throw error;
        const [currentPid, currentData] = (await readFile(pidFile, "utf8")).split("\n");
        if (pid !== currentPid || data !== currentData) throw new Error("PostgreSQL identity changed during cleanup");
        await command("pg_ctl", ["-D", owned.dataDirectory, "-w", "-t", "10", "-m", "immediate", "stop"]);
      }
    }
    if (await exists(pidFile)) throw new Error("Owned PostgreSQL PID file remains after cleanup");
  })();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { interrupted = true; stopChild(); });
let exitCode = 1;
let failure: string | null = null;
try {
  await command("initdb", ["-D", owned.dataDirectory, "--username=ed_pilot_lab", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  if (interrupted) throw new Error("Interrupted before PostgreSQL startup");
  await writeFile(join(owned.dataDirectory, "postgresql.auto.conf"), `listen_addresses = ''\nunix_socket_directories = '${owned.socketDirectory}'\nunix_socket_permissions = 0700\nport = 5432\nmax_connections = 20\nshared_buffers = '12MB'\nlog_min_messages = warning\n`, { mode: 0o600 });
  await command("pg_ctl", ["-D", owned.dataDirectory, "-l", join(evidence, "postgres.log"), "-w", "-t", "15", "start"]);
  if (interrupted) throw new Error("Interrupted before application startup");
  const configFile = join(directory, "lab-config.json");
  await writeFile(configFile, JSON.stringify({ root, owned, evidence, selectionFile, selectionSha256: expectedHash, mode, minutes }), { mode: 0o600 });
  const env = { ...buildLabEnvironment(owned, randomBytes(48).toString("hex")), ED_PILOT_LAB_CONFIG: configFile };
  const log = createWriteStream(join(evidence, "app.log"), { mode: 0o600 });
  child = spawn(process.execPath, ["--import", "tsx", join(root, "scripts/ed-pilot-lab/app.ts")], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.pipe(log, { end: false }); child.stderr?.pipe(log, { end: false });
  childExited = new Promise((resolve, reject) => { child!.once("error", reject); child!.once("exit", code => resolve(code ?? 1)); });
  console.log(JSON.stringify({ mode, supervisorPid: process.pid, applicationPid: child.pid, ownedDirectory: directory, evidenceDirectory: evidence }));
  const watchdog = setTimeout(() => { failure = "Finite lab deadline reached"; stopChild(); }, mode === "preview" ? (minutes + 2) * 60_000 : 180_000);
  try {
    exitCode = await childExited;
    if (exitCode !== 0 && !failure) failure = `Application child exited with code ${exitCode}; inspect app.log and application-checks.json if present`;
  } finally { clearTimeout(watchdog); if (forceTimer) clearTimeout(forceTimer); log.end(); }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  let cleanupVerified = false;
  try { await cleanup(); cleanupVerified = true; } catch (error) { failure = `Cleanup failed: ${String(error)}`; exitCode = 1; }
  if (interrupted) { failure = "Interrupted by supervisor"; exitCode = 1; }
  if (failure) exitCode = 1;
  await writeFile(join(evidence, "run-result.json"), JSON.stringify({ mode, selectionSha256: expectedHash, owned, steps, exitCode, failure, cleanupVerified, finishedAt: new Date().toISOString(), retention: "Stopped owned cluster retained as local evidence; no production connection or migration." }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ exitCode, cleanupVerified, evidenceDirectory: evidence }));
}
process.exitCode = exitCode;
