import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(repository, "services/financial-executor/.vercel/output");
const forbiddenInput = /(?:^|\/)(?:client\/|server\/(?:db\.[cm]?[jt]s|_core\/|test-support\/)|\.env(?:\.|$))|\.(?:test|spec)\.[cm]?[jt]s$/;

/** Assert against emitted dependencies and bytes, not merely an entry-point filename. */
export function assertIsolatedExecutorBundle(result) {
  const reject = () => { throw new Error("Executor build boundary rejected"); };
  for (const value of Object.values(result.metafile.outputs)) {
    for (const [input, contribution] of Object.entries(value.inputs)) if (contribution.bytesInOutput > 0 && forbiddenInput.test(input.replaceAll("\\", "/"))) reject();
    for (const imported of value.imports) if (imported.external && !isBuiltin(imported.path)) reject();
  }
  if (!result.outputFiles.length) reject();
  for (const file of result.outputFiles) {
    if (/postgres(?:ql)?:\/\/[^\s"'`/:]+:[^\s"'`@]+@/i.test(file.text)
      || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----(?:\s|\\[nr])+[A-Za-z0-9+/=]{64,}/.test(file.text)
      || /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\b/.test(file.text)) reject();
  }
}

export async function buildFinancialExecutor() {
  const functionDirectory = resolve(output, "functions/api/execute.func");
  const bundled = await build({
    absWorkingDir: repository,
    entryPoints: ["services/financial-executor/api/execute.ts"],
    outfile: resolve(functionDirectory, "index.mjs"),
    platform: "node", target: "node22", format: "esm", bundle: true,
    treeShaking: true, metafile: true, write: false, sourcemap: false, legalComments: "none",
    logLevel: "silent",
  });
  assertIsolatedExecutorBundle(bundled);
  // Only this service's generated output is replaced, after the graph passes the boundary check.
  await rm(output, { recursive: true, force: true });
  await mkdir(functionDirectory, { recursive: true });
  for (const file of bundled.outputFiles) await writeFile(file.path, file.contents);
  await writeFile(resolve(functionDirectory, ".vc-config.json"), JSON.stringify({
    runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs",
    shouldAddHelpers: false, shouldAddSourcemapSupport: false, maxDuration: 35,
  }, null, 2) + "\n");
  await writeFile(resolve(output, "config.json"), JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }, { src: "/.*", status: 404 }] }, null, 2) + "\n");
  await writeFile(resolve(output, "../executor-metafile.json"), JSON.stringify(bundled.metafile, null, 2) + "\n");
  return { outputDirectory: output, bytes: bundled.outputFiles.reduce((total, file) => total + file.contents.length, 0) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildFinancialExecutor();
    console.log(`Isolated financial executor built: ${result.bytes} bytes; dependency and credential-shape checks passed.`);
  } catch {
    console.error("Isolated financial executor build rejected; no deployment performed.");
    process.exitCode = 1;
  }
}
