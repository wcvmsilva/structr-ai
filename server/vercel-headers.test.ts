import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCspDirectives } from "./_core/csp";

const config = JSON.parse(
  readFileSync(new URL("../vercel.json", import.meta.url), "utf8")
);

/** Evaluate the universal path rule used by this configuration, not Express middleware. */
function cdnHeaders(path: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const rule of config.headers ?? []) {
    // This test intentionally supports only Vercel's documented universal rule.
    // A narrower or conditional rule must not silently count as CDN-wide coverage.
    if (rule.source !== "/(.*)" || rule.has?.length || rule.missing?.length)
      continue;
    if (!/^\/.*$/.test(path)) continue;
    for (const header of rule.headers)
      headers.set(header.key.toLowerCase(), header.value);
  }
  return headers;
}

function parsePolicy(value: string) {
  return Object.fromEntries(
    value
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values];
      })
  );
}

describe("native hosted CDN response header contract", () => {
  it.each(["/", "/index.html", "/projects/synthetic", "/assets/synthetic.js"])(
    "protects %s even when the CDN bypasses Express",
    path => {
      const headers = cdnHeaders(path);
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin"
      );
      const policy = headers.get("content-security-policy-report-only");
      expect(policy).toBeTypeOf("string");
      // Compare semantic directives to the existing production policy, with no
      // optional environment-specific report endpoint or Supabase socket origin.
      const expected = Object.fromEntries(
        Object.entries(
          buildCspDirectives({
            isDevelopment: false,
            supabaseUrl: "",
            reportUri: "",
          })
        ).map(([key, values]) => [
          key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`),
          values,
        ])
      );
      expect(parsePolicy(policy!)).toEqual(expected);
      expect(parsePolicy(policy!)["frame-ancestors"]).toEqual(["'none'"]);
      expect(parsePolicy(policy!)["script-src"]).not.toContain("'unsafe-eval'");
      // A new enforced policy would bypass the existing progressive rollout.
      expect(headers.has("content-security-policy")).toBe(false);
    }
  );
});
