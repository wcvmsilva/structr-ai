import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Bundle local imports for native Node ESM while retaining lazy API initialization.
// An explicit output path lets smoke tests use an isolated deployment directory.
await build({
  absWorkingDir: root,
  entryPoints: ["server/_core/hosted-app.ts"],
  outfile: resolve(process.argv[2] ?? resolve(root, "dist/hosted.js")),
  platform: "node",
  packages: "external",
  bundle: true,
  format: "esm",
  target: "node22",
});
