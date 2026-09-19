import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareVercelAssets } from "../scripts/prepare-vercel-assets.mjs";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "structr-vercel-assets-"));
  roots.push(root);
  mkdirSync(join(root, "dist/public/assets"), { recursive: true });
  writeFileSync(
    join(root, "dist/public/index.html"),
    '<!doctype html><script src="/assets/app.js"></script>'
  );
  writeFileSync(
    join(root, "dist/public/assets/app.js"),
    'console.log("synthetic")'
  );
  writeFileSync(join(root, "dist/index.js"), "PRIVATE_SERVER_SOURCE");
  return root;
}
afterEach(() =>
  roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true }))
);
describe("native hosted static asset preparation", () => {
  it("copies only the compiled frontend including nested assets", () => {
    const root = fixture();
    prepareVercelAssets(root);
    expect(readFileSync(join(root, "public/index.html"), "utf8")).toContain(
      "/assets/app.js"
    );
    expect(readFileSync(join(root, "public/assets/app.js"), "utf8")).toContain(
      "synthetic"
    );
    expect(existsSync(join(root, "public/index.js"))).toBe(false);
  });
  it("replaces only its own previously generated output", () => {
    const root = fixture();
    prepareVercelAssets(root);
    rmSync(join(root, "dist/public/assets/app.js"));
    writeFileSync(join(root, "dist/public/assets/new.js"), "new");
    prepareVercelAssets(root);
    expect(existsSync(join(root, "public/assets/app.js"))).toBe(false);
    expect(readFileSync(join(root, "public/assets/new.js"), "utf8")).toBe(
      "new"
    );
  });
  it("refuses to overwrite an existing unowned public folder", () => {
    const root = fixture();
    mkdirSync(join(root, "public"));
    writeFileSync(join(root, "public/keep.txt"), "keep");
    expect(() => prepareVercelAssets(root)).toThrow(/not generated/);
    expect(readFileSync(join(root, "public/keep.txt"), "utf8")).toBe("keep");
  });
  it("refuses a missing compiled entry before touching the output", () => {
    const root = fixture();
    rmSync(join(root, "dist/public/index.html"));
    expect(() => prepareVercelAssets(root)).toThrow(/index.html/);
    expect(existsSync(join(root, "public"))).toBe(false);
  });
  it("rejects source links so outside files cannot be published", () => {
    const root = fixture();
    writeFileSync(join(root, "private.txt"), "PRIVATE");
    symlinkSync(
      join(root, "private.txt"),
      join(root, "dist/public/linked.txt")
    );
    expect(() => prepareVercelAssets(root)).toThrow(/symbolic/);
    expect(existsSync(join(root, "public"))).toBe(false);
  });
  it("rejects an output symlink without touching its destination", () => {
    const root = fixture();
    mkdirSync(join(root, "private"));
    writeFileSync(join(root, "private/keep.txt"), "keep");
    symlinkSync(join(root, "private"), join(root, "public"));
    expect(() => prepareVercelAssets(root)).toThrow(/symbolic/);
    expect(readFileSync(join(root, "private/keep.txt"), "utf8")).toBe("keep");
  });
});
