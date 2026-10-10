import { describe, expect, it } from "vitest";
import { assertIsolatedExecutorBundle } from "../scripts/build-financial-executor.mjs";
function artifact(input: string, contents = "export default () => undefined;", bytes = 20) {
  return { metafile: { outputs: { "index.mjs": { inputs: { [input]: { bytesInOutput: bytes } }, imports: [] } } }, outputFiles: [{ path: "/isolated/index.mjs", text: contents }] };
}
describe("isolated executor build boundary", () => {
  it.each(["server/db.ts", "server/_core/env.ts", "server/_core/index.ts", "client/src/App.tsx", "server/test-support/financial-executor-auth.ts", ".env.production"])("refuses emitted forbidden dependency %s", path => {
    expect(() => assertIsolatedExecutorBundle(artifact(path))).toThrowError("Executor build boundary rejected");
  });
  it("permits shared pure engines without requiring a web bundle", () => {
    expect(() => assertIsolatedExecutorBundle(artifact("shared/assembly-engine.ts"))).not.toThrow();
  });
  it.each([
    "const sql = 'postgresql://operator:embedded-password@db.example.invalid/pilot';",
    `const secret = '-----BEGIN PRIVATE KEY-----\\n${"A".repeat(96)}\\n-----END PRIVATE KEY-----';`,
  ])("rejects credential-shaped embedded artifact data %#", contents => {
    expect(() => assertIsolatedExecutorBundle(artifact("services/financial-executor/src/index.ts", contents))).toThrowError("Executor build boundary rejected");
  });
  it("rejects an unresolved runtime web-module import", () => {
    const output = artifact("services/financial-executor/src/index.ts");
    output.metafile.outputs["index.mjs"].imports = [{ path: "../../../server/db.js", external: true }] as never;
    expect(() => assertIsolatedExecutorBundle(output)).toThrowError("Executor build boundary rejected");
  });
});
