import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
let entry: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "structr-frontend-bundling-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
  symlinkSync(
    join(repository, "node_modules"),
    join(root, "node_modules"),
    "dir"
  );
  writeFileSync(
    join(root, "entry.js"),
    `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Slot } from '@radix-ui/react-slot';
    import { Root as Dialog } from '@radix-ui/react-dialog';
    globalThis.__uiDependencies = [createRoot, Dialog];
    globalThis.__frontendProbe = React.createElement(Slot, { 'data-probe': 'ready' },
      React.createElement('button', { type: 'button' }, 'UI initialized'));
  `
  );
  const output = join(root, "output");
  mkdirSync(output);
  const built = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { build } from 'vite';
    await build({
      configFile: ${JSON.stringify(join(repository, "vite.config.ts"))},
      envFile: false,
      logLevel: 'silent',
      build: {
        outDir: ${JSON.stringify(output)},
        manifest: true,
        rollupOptions: { input: {
          app: ${JSON.stringify(join(repository, "client/index.html"))},
          probe: ${JSON.stringify(join(root, "entry.js"))}
        } }
      }
    });
  `,
    ],
    {
      cwd: root,
      env: { NODE_ENV: "production" },
      encoding: "utf8",
      timeout: 25_000,
    }
  );
  expect(built.status, built.stderr || built.error?.message).toBe(0);
  const manifest = JSON.parse(
    readFileSync(join(output, ".vite/manifest.json"), "utf8")
  );
  const emitted = Object.values(manifest).find(
    (chunk: any) => chunk.isEntry && chunk.name === "probe"
  ) as { file: string };
  entry = join(output, emitted.file);
}, 30_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("production frontend module initialization", () => {
  it("initializes React before Radix and renders the compiled UI without a module-cycle crash", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { renderToStaticMarkup } from 'react-dom/server';
      await import(${JSON.stringify(entry)});
      console.log(renderToStaticMarkup(globalThis.__frontendProbe));
    `,
      ],
      {
        cwd: root,
        env: { NODE_ENV: "production" },
        encoding: "utf8",
        timeout: 10_000,
      }
    );
    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout).toContain('data-probe="ready"');
    expect(result.stdout).toContain(">UI initialized</button>");
  });
});
