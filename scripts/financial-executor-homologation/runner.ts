/** Plan only: intentionally no hosted execution path or database driver. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, planCalculatorHomologation } from "./contract";
async function protectedManifest(path: string): Promise<unknown> {
  if (!isAbsolute(path)) fail("PROTECTED_FILE");
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
  } catch {
    fail("PROTECTED_FILE");
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o077) !== 0 ||
      before.size < 1 ||
      before.size > 65536
    )
      fail("PROTECTED_FILE");
    const source = await handle.readFile("utf8"),
      after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.mode !== after.mode
    )
      fail("PROTECTED_FILE");
    try {
      return JSON.parse(source);
    } catch {
      fail("MANIFEST_INVALID");
    }
  } finally {
    await handle.close();
  }
}
export async function runCalculatorHomologationPlan(args: readonly string[]) {
  if (args.length !== 2 || args[0] !== "--plan") fail("PLAN_ONLY");
  return planCalculatorHomologation(await protectedManifest(args[1]));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runCalculatorHomologationPlan(process.argv.slice(2)).then(
    result => {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    },
    error => {
      const safe =
        error instanceof Error &&
        /^CALCULATOR_HOMOLOGATION_(PLAN_ONLY|PROTECTED_FILE|MANIFEST_INVALID)$/.test(
          error.message
        )
          ? error.message
          : "CALCULATOR_HOMOLOGATION_PLAN_FAILED";
      process.stderr.write(safe + "\n");
      process.exitCode = 1;
    }
  );
}
